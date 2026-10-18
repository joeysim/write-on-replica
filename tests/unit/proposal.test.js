import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offered, makeProposal, counts, ghostProposal, makeMarks, applyFixes, followMarks, positionAfterFix } from '../../web/src/doc/proposal.js';
import { alignDeletion } from '../../web/src/doc/trim.js';
import { htmlToBlocks, blocksToHtml, plainText } from '../../web/src/doc/format.js';
import { textOf, normalizeBlocks, insertText, deleteRange, splitBlock, mergeBackward } from '../../web/src/doc/blocks.js';

const B = (html) => htmlToBlocks(html);
const H = (blocks) => blocksToHtml(blocks);

const P1 = 'Much of the trouble, in my view, comes from wanting it all. It rarely works.';
const DOC =
  '<p># A title here</p><p><br></p>' +
  `<p>${P1}</p><p><br></p>` +
  '<p>Keep <span data-ghost>this aside </span>short and <span data-vid="aaaaaaa">really plain</span> today.</p>';
const GROUPS = { aaaaaaa: { scope: 'word', variants: ['really plain', 'simple'], active: 0 } };

/** The proposal the model's answer would make: `trimmed` maps a paragraph number to its shortened text. */
const propose = (blocks, trimmed) => {
  const paragraphs = offered(blocks);
  const items = Object.entries(trimmed).map(([n, text]) => ({ n: Number(n), ...alignDeletion(paragraphs.find((p) => p.n === Number(n)).text, text) }));
  return makeProposal(paragraphs, items);
};
const cutText = (blocks, cut) => cut.ranges.map((r) => textOf(blocks[cut.block]).slice(r.start, r.end));

// --- what the model is offered --------------------------------------------------------------------

test('the model is offered the paragraphs, numbered, without headings, blank lines or ghosted text', () => {
  const paragraphs = offered(B(DOC));
  assert.deepEqual(
    paragraphs.map(({ n, block, text }) => ({ n, block, text })),
    [
      { n: 1, block: 2, text: P1 },
      { n: 2, block: 4, text: 'Keep short and really plain today.' },
    ],
  );
  // Each character knows where it stands in its block.
  assert.deepEqual(paragraphs[1].map.slice(0, 8), [0, 1, 2, 3, 4, 16, 17, 18]);
  assert.equal(paragraphs[1].map.length, paragraphs[1].text.length);
});

// The typo pass looks for slips in the headings as well.
test('the headings can be offered too, numbered in their place, and fixed in place', () => {
  const blocks = B(DOC);
  const paragraphs = offered(blocks, { headings: true });
  assert.deepEqual(
    paragraphs.map(({ n, block, text }) => ({ n, block, text })),
    [
      { n: 1, block: 0, text: 'A title here' },
      { n: 2, block: 2, text: P1 },
      { n: 3, block: 4, text: 'Keep short and really plain today.' },
    ],
  );
  const fixed = applyFixes(blocks, makeMarks(paragraphs, [{ n: 1, start: 0, end: 1, replace: 'The', reason: 'For the test.' }]));
  assert.deepEqual([fixed[0].kind, textOf(fixed[0])], ['h', 'The title here']);
});

test('where ghosted text is left out, the gap it leaves is closed up', () => {
  // Found with the real model: offered "what could go.  It never rewrites", it reported a doubled space.
  const blocks = B(
    '<p>It dims what could go. <span data-ghost>You decide what goes.</span> It never rewrites.</p>' +
      '<p><span data-ghost>An aside.</span> Starts here <span data-ghost>(or not)</span>, and ends <span data-ghost>somewhere</span></p>',
  );
  const [first, second] = offered(blocks);
  assert.equal(first.text, 'It dims what could go. It never rewrites.');
  assert.equal(second.text, 'Starts here, and ends');
  for (const paragraph of [first, second]) {
    assert.equal(paragraph.map.length, paragraph.text.length);
    const whole = textOf(blocks[paragraph.block]);
    for (let i = 0; i < paragraph.text.length; i++) assert.equal(whole[paragraph.map[i]], paragraph.text[i], `character ${i} knows its place`);
  }
});

test('a paragraph that is ghosted whole is not offered', () => {
  const paragraphs = offered(B('<p><span data-ghost>All of this is set aside.</span></p><p>This is not.</p>'));
  assert.deepEqual(paragraphs.map((p) => p.text), ['This is not.']);
  assert.equal(paragraphs[0].n, 1);
});

// --- the proposal -----------------------------------------------------------------------------------

test('each cut knows the stretch of its block it would take, in the order of the document', () => {
  const blocks = B(DOC);
  const proposal = propose(blocks, { 2: 'Keep short and plain today.', 1: 'The trouble comes from wanting it all.' });
  assert.deepEqual(
    proposal.cuts.map((cut) => [cut.id, cut.block, cutText(blocks, cut).join('|')]),
    [
      ['c1', 2, 'Much of '],
      ['c2', 2, ', in my view,'],
      ['c3', 2, ' It rarely works.'],
      ['c4', 4, 'really '],
    ],
  );
});

test('a cut that runs across ghosted text takes what is either side of it and leaves the ghosted text', () => {
  const blocks = B(DOC);
  const proposal = propose(blocks, { 2: 'And really plain today.' });
  assert.equal(proposal.cuts.length, 1);
  assert.deepEqual(cutText(blocks, proposal.cuts[0]), ['Keep ', 'short ']);
});

// --- the numbers on the card ------------------------------------------------------------------------

test('the count is of every word that is not ghosted, headings included, before and after the cuts', () => {
  const blocks = B(DOC);
  const proposal = propose(blocks, { 1: 'The trouble comes from wanting it all.', 2: 'Keep short and plain today.' });
  assert.deepEqual(counts(blocks, proposal), { before: 24, after: 15 });
});

test('a cut the writer keeps is not counted as made', () => {
  const blocks = B(DOC);
  const proposal = propose(blocks, { 1: 'The trouble comes from wanting it all.' });
  assert.deepEqual(counts(blocks, proposal), { before: 24, after: 16 });
  assert.deepEqual(counts(blocks, proposal, new Set(['c3'])), { before: 24, after: 19 });
  assert.deepEqual(counts(blocks, proposal, new Set(['c1', 'c2', 'c3'])), { before: 24, after: 24 });
});

// --- making the cuts --------------------------------------------------------------------------------
//
// "Make the cuts" ghosts the cuts. It deletes nothing and changes no letter: the words stay where
// they are, set aside, and Ghost brings any of them back. The piece as it reads (the Markdown
// tab, Post to X) leaves ghosted words out.

const reads = (blocks) => plainText({ html: H(blocks) }, { withoutGhost: true });

test('making the cuts ghosts what was proposed, and deletes nothing', () => {
  const blocks = B(DOC);
  const proposal = propose(blocks, { 1: 'The trouble comes from wanting it all.' });
  const made = ghostProposal(blocks, proposal);
  assert.equal(textOf(made[2]), P1, 'every word is still there');
  assert.equal(H([made[2]]), '<p><span data-ghost>Much of </span>the trouble<span data-ghost>, in my view,</span> comes from wanting it all.<span data-ghost> It rarely works.</span></p>');
  assert.equal(reads(made).split('\n')[2], 'the trouble comes from wanting it all.', 'it reads trimmed, and no letter is changed');
});

test('a cut that is kept is not ghosted', () => {
  const blocks = B(DOC);
  const proposal = propose(blocks, { 1: 'The trouble comes from wanting it all.' });
  assert.equal(H([ghostProposal(blocks, proposal, new Set(['c1']))[2]]), '<p>Much of the trouble<span data-ghost>, in my view,</span> comes from wanting it all.<span data-ghost> It rarely works.</span></p>');
  assert.equal(ghostProposal(blocks, proposal, new Set(['c1', 'c2', 'c3']))[2], blocks[2], 'with every cut kept, nothing changes');
});

test('other blocks are the same blocks as before', () => {
  const blocks = B(DOC);
  const proposal = propose(blocks, { 1: 'The trouble comes from wanting it all.' });
  const made = ghostProposal(blocks, proposal);
  assert.equal(made[0], blocks[0]);
  assert.equal(made[4], blocks[4]);
});

test('a cut inside a group ghosts those words of what the group shows, and the group stays', () => {
  const blocks = B(DOC);
  const proposal = propose(blocks, { 2: 'Keep short today.' });
  const made = normalizeBlocks(ghostProposal(blocks, proposal), structuredClone(GROUPS));
  assert.equal(textOf(made.blocks[4]), 'Keep this aside short and really plain today.');
  assert.deepEqual(Object.keys(made.groups), ['aaaaaaa'], 'the group is still there');
  assert.equal(reads(made.blocks).split('\n').at(-1), 'Keep short today.');
});

test('a paragraph cut whole is ghosted whole, and the blank lines around it stay', () => {
  const blocks = B('<p><br></p><p># A title</p><p><br></p><p>The first stays.</p><p><br></p><p>The second goes. All of it.</p><p><br></p><p>The third stays.</p>');
  const paragraphs = offered(blocks);
  const proposal = makeProposal(paragraphs, [{ n: 2, runs: [{ index: 0, start: 0, end: paragraphs[1].text.length }], caseFixes: [] }]);
  const made = ghostProposal(blocks, proposal);
  assert.equal(made.length, blocks.length);
  assert.equal(H([made[5]]), '<p><span data-ghost>The second goes. All of it.</span></p>');
  assert.equal(reads(made), '# A title\n\nThe first stays.\n\nThe third stays.', 'and the piece reads without it');
});

test('what was ghosted before stays ghosted, and a cut either side of it reads with one space', () => {
  const blocks = B('<p>Open the Lab. It reads the page. <span data-ghost>You decide.</span> It never rewrites.</p>');
  const paragraphs = offered(blocks);
  const { text } = paragraphs[0];
  const at = (sentence) => ({ start: text.indexOf(sentence), end: text.indexOf(sentence) + sentence.length });
  const proposal = makeProposal(paragraphs, [{ n: 1, runs: [{ index: 0, ...at('It reads the page.') }, { index: 1, ...at('It never rewrites.') }], caseFixes: [] }]);
  assert.equal(H(ghostProposal(blocks, proposal)), '<p>Open the Lab. <span data-ghost>It reads the page.</span> <span data-ghost>You decide.</span> <span data-ghost>It never rewrites.</span></p>');
  assert.equal(reads(ghostProposal(blocks, proposal, new Set(['c2']))), 'Open the Lab. It never rewrites.');
});

test('the piece reads with no space before a stop or a comma that a cut leaves', () => {
  const blocks = B('<p>It reads the page slowly, then dims what could go, really.</p>');
  const proposal = propose(blocks, { 1: 'It reads the page, then dims what could go.' });
  assert.equal(reads(ghostProposal(blocks, proposal)), 'It reads the page, then dims what could go.');
});

// --- marks and fixes --------------------------------------------------------------------------------

const TYPOS =
  '<p># A title here</p><p><br></p>' +
  '<p>Teh first line has has a slip or two in it.</p><p><br></p>' +
  '<p>Keep <span data-ghost>this aside </span>it <span data-vid="aaaaaaa">realy plain</span> ,and stop.</p>';

/** Marks as the checked answer gives them: `[n, quoted text, reason, replacement?]`, found in the offered text. */
const marksFor = (blocks, list) => {
  const paragraphs = offered(blocks);
  const items = list.map(([n, quote, reason, replace]) => {
    const start = paragraphs.find((p) => p.n === n).text.indexOf(quote);
    return { n, start, end: start + quote.length, reason, ...(replace === undefined ? {} : { replace }) };
  });
  return makeMarks(paragraphs, items);
};

test('a mark knows the stretch of its block it points at, and marks come in the order of the document', () => {
  const blocks = B(TYPOS);
  const marks = marksFor(blocks, [
    [2, 'realy', 'misspelled'],
    [1, 'has has', 'said twice'],
    [1, 'Teh', 'misspelled'],
  ]);
  assert.deepEqual(
    marks.map((mark) => [mark.id, mark.block, cutText(blocks, mark).join('|'), mark.reason]),
    [
      ['m1', 2, 'Teh', 'misspelled'],
      ['m2', 2, 'has has', 'said twice'],
      ['m3', 4, 'realy', 'misspelled'],
    ],
  );
});

test('a mark that runs across ghosted text points at what is either side of it', () => {
  const blocks = B(TYPOS);
  const [mark] = marksFor(blocks, [[2, 'Keep it', 'a test']]);
  assert.deepEqual(cutText(blocks, mark), ['Keep ', 'it']);
});

test('fixes replace what they point at, several to a paragraph, and nothing else', () => {
  const blocks = B(TYPOS);
  const fixes = marksFor(blocks, [
    [1, 'Teh', 'misspelled', 'The'],
    [1, 'has has', 'said twice', 'has'],
    [2, ' ,and', 'space before the comma', ', and'],
  ]);
  const made = applyFixes(blocks, fixes);
  assert.equal(textOf(made[2]), 'The first line has a slip or two in it.');
  assert.equal(textOf(made[4]), 'Keep this aside it realy plain, and stop.');
  assert.equal(made[0], blocks[0], 'a block with no fix in it is the same block');
});

test('a fix inside a group changes what the group is showing and leaves it a group', () => {
  const blocks = B(TYPOS);
  const made = normalizeBlocks(applyFixes(blocks, marksFor(blocks, [[2, 'realy', 'misspelled', 'really']])), {
    aaaaaaa: { scope: 'word', variants: ['realy plain', 'simple'], active: 0 },
  });
  assert.ok(H(made.blocks).endsWith('it <span data-vid="aaaaaaa">really plain</span> ,and stop.</p>'), H(made.blocks).slice(-90));
  assert.deepEqual(made.groups.aaaaaaa.variants, ['really plain', 'simple']);
});

test('a fix across ghosted text leaves the ghosted text where it is', () => {
  const blocks = B(TYPOS);
  const made = applyFixes(blocks, marksFor(blocks, [[2, 'Keep it', 'a test', 'Hold it']]));
  assert.ok(H(made).endsWith('<p>Hold it<span data-ghost>this aside </span> <span data-vid="aaaaaaa">realy plain</span> ,and stop.</p>'), H(made).slice(-120));
});

test('marks without a replacement are not fixes and change nothing', () => {
  const blocks = B(TYPOS);
  assert.equal(applyFixes(blocks, marksFor(blocks, [[1, 'Teh', 'misspelled']])), blocks);
});

// --- marks through an edit --------------------------------------------------------------------------

const SLIPS = [
  [1, 'Teh', 'misspelled', 'The'],
  [1, 'has has', 'said twice', 'has'],
  [2, 'realy', 'misspelled', 'really'],
  [2, ' ,and', 'space before the comma', ', and'],
];
/** What each mark points at: [id, block, the words under it]. */
const pointing = (blocks, marks) => marks.map((mark) => [mark.id, mark.block, cutText(blocks, mark).join('|')]);
const at = (block, offset) => ({ block, offset });

test('an edit away from the marks leaves each on its words, moved along with them', () => {
  const blocks = B(TYPOS);
  const marks = marksFor(blocks, SLIPS);
  const after = insertText(blocks, at(2, 6), 'ii').blocks; // "first" becomes "fiiirst"
  const moved = followMarks(blocks, after, marks);
  assert.deepEqual(pointing(after, moved), [
    ['m1', 2, 'Teh'],
    ['m2', 2, 'has has'],
    ['m3', 4, 'realy'],
    ['m4', 4, ' ,and'],
  ]);
  assert.equal(moved[1].ranges[0].start, marks[1].ranges[0].start + 2);
  assert.deepEqual(moved[1].replace, 'has', 'a mark keeps its fix and its reason');
  assert.deepEqual(moved[1].reason, 'said twice');
});

test('an edit to a marked passage takes that mark away, and no other', () => {
  const blocks = B(TYPOS);
  const marks = marksFor(blocks, SLIPS);
  const y = textOf(blocks[4]).indexOf('realy') + 4;
  const after = deleteRange(blocks, at(4, y), at(4, y + 1)).blocks; // Backspace after "realy"
  assert.deepEqual(pointing(after, followMarks(blocks, after, marks)), [
    ['m1', 2, 'Teh'],
    ['m2', 2, 'has has'],
    ['m4', 4, ' ,and'],
  ]);
  const retyped = insertText(deleteRange(blocks, at(2, 0), at(2, 3)).blocks, at(2, 0), 'The').blocks;
  assert.deepEqual(
    followMarks(blocks, retyped, marks).map((mark) => mark.id),
    ['m2', 'm3', 'm4'],
    'a marked word typed over goes the same way',
  );
});

test('a fix made in the text takes its own mark away', () => {
  const blocks = B(TYPOS);
  const marks = marksFor(blocks, SLIPS);
  const after = applyFixes(blocks, [marks[1]]);
  assert.deepEqual(pointing(after, followMarks(blocks, after, marks)), [
    ['m1', 2, 'Teh'],
    ['m3', 4, 'realy'],
    ['m4', 4, ' ,and'],
  ]);
});

test('letters typed against a marked word take its mark away; a space or a comma beside it does not', () => {
  const blocks = B(TYPOS);
  const marks = marksFor(blocks, SLIPS);
  const typed = (pos, text) => followMarks(blocks, insertText(blocks, pos, text).blocks, marks).map((mark) => mark.id);
  assert.deepEqual(typed(at(2, 3), 's'), ['m2', 'm3', 'm4'], 'a letter after "Teh"');
  assert.deepEqual(typed(at(2, 0), 'A'), ['m2', 'm3', 'm4'], 'a letter before it');
  assert.deepEqual(typed(at(2, 3), ','), ['m1', 'm2', 'm3', 'm4'], 'a comma after it');
  assert.deepEqual(typed(at(2, 0), ' '), ['m1', 'm2', 'm3', 'm4'], 'a space before it');
  assert.deepEqual(typed(at(2, 14), ' '), ['m1', 'm2', 'm3', 'm4'], 'a second space before "has has"');
  assert.deepEqual(typed(at(2, 22), 'h'), ['m1', 'm3', 'm4'], 'a letter after "has has"');
});

test('a mark goes with its words into a new paragraph, and back again', () => {
  const blocks = B(TYPOS);
  const marks = marksFor(blocks, SLIPS);
  const split = splitBlock(blocks, at(2, 15)).blocks; // Return just before "has has"
  const moved = followMarks(blocks, split, marks);
  assert.deepEqual(pointing(split, moved), [
    ['m1', 2, 'Teh'],
    ['m2', 3, 'has has'],
    ['m3', 5, 'realy'],
    ['m4', 5, ' ,and'],
  ]);
  const joined = mergeBackward(split, 3).blocks; // and Backspace at the start of the new paragraph
  assert.deepEqual(pointing(joined, followMarks(split, joined, moved)), pointing(blocks, marks));
});

test('a paragraph deleted takes its marks with it; those below move up with their words', () => {
  const blocks = B(TYPOS);
  const marks = marksFor(blocks, SLIPS);
  const after = deleteRange(blocks, at(1, 0), at(3, 0)).blocks;
  assert.deepEqual(pointing(after, followMarks(blocks, after, marks)), [
    ['m3', 2, 'realy'],
    ['m4', 2, ' ,and'],
  ]);
});

test('an edit between the parts of a mark that runs across ghosted text takes the mark away', () => {
  const blocks = B(TYPOS);
  const [mark] = marksFor(blocks, [[2, 'Keep it', 'a test']]);
  const from = textOf(blocks[4]).indexOf('aside');
  const after = deleteRange(blocks, at(4, from), at(4, from + 6)).blocks;
  assert.deepEqual(followMarks(blocks, after, [mark]), []);
});

test('a change that leaves the words as they were leaves the marks as they were', () => {
  const blocks = B(TYPOS);
  const marks = marksFor(blocks, SLIPS);
  const ghosted = B(TYPOS.replace('stop.', '<span data-ghost>stop.</span>'));
  assert.deepEqual(followMarks(blocks, ghosted, marks), marks);
  assert.deepEqual(followMarks(blocks, blocks, marks), marks);
});

test('a position keeps to the words beside it when a fix is made', () => {
  const blocks = B(TYPOS);
  const [, doubled] = marksFor(blocks, SLIPS); // "has has", at 15, becomes "has"
  const moved = (block, offset) => positionAfterFix(doubled, at(block, offset));
  const end = textOf(blocks[2]).length;
  assert.deepEqual(moved(2, end), at(2, end - 4), 'after the fix: moved by what it took out');
  assert.deepEqual(moved(2, 15), at(2, 15), 'just before it: where it was');
  assert.deepEqual(moved(2, 20), at(2, 18), 'inside what is fixed: at the end of the new words');
  assert.deepEqual(moved(4, 3), at(4, 3), 'in another paragraph: where it was');
});
