import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offered, makeProposal, counts, applyProposal, makeMarks, applyFixes, followMarks, positionAfterFix, wordsIn } from '../../web/src/doc/proposal.js';
import { alignDeletion, chooseCuts } from '../../web/src/doc/trim.js';
import { parseLabResponse } from '../../web/src/ai/parse.js';
import { htmlToBlocks, blocksToHtml } from '../../web/src/doc/format.js';
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

test('making the cuts removes what was proposed, closes the gaps and starts the sentence with a capital', () => {
  const blocks = B(DOC);
  const proposal = propose(blocks, { 1: 'The trouble comes from wanting it all.' });
  assert.equal(textOf(applyProposal(blocks, proposal)[2]), 'The trouble comes from wanting it all.');
});

test('a cut that is kept leaves its words, and its sentence, exactly as they were', () => {
  const blocks = B(DOC);
  const proposal = propose(blocks, { 1: 'The trouble comes from wanting it all.' });
  assert.equal(textOf(applyProposal(blocks, proposal, new Set(['c1']))[2]), 'Much of the trouble comes from wanting it all.');
  assert.equal(textOf(applyProposal(blocks, proposal, new Set(['c1', 'c2', 'c3']))[2]), P1);
});

test('other blocks are the same blocks as before', () => {
  const blocks = B(DOC);
  const proposal = propose(blocks, { 1: 'The trouble comes from wanting it all.' });
  const made = applyProposal(blocks, proposal);
  assert.equal(made[0], blocks[0]);
  assert.equal(made[4], blocks[4]);
});

test('a cut inside a group shortens what the group is showing, and ghosted text is left alone', () => {
  const blocks = B(DOC);
  const proposal = propose(blocks, { 2: 'Keep short and plain today.' });
  const made = normalizeBlocks(applyProposal(blocks, proposal), structuredClone(GROUPS));
  assert.ok(H(made.blocks).endsWith('<p>Keep <span data-ghost>this aside </span>short and <span data-vid="aaaaaaa">plain</span> today.</p>'), H(made.blocks).slice(-120));
  assert.deepEqual(made.groups.aaaaaaa.variants, ['plain', 'simple']);
});

test('a cut that takes all of a group takes the group with it', () => {
  const blocks = B(DOC);
  const proposal = propose(blocks, { 2: 'Keep short today.' });
  const made = normalizeBlocks(applyProposal(blocks, proposal), structuredClone(GROUPS));
  assert.equal(textOf(made.blocks[4]), 'Keep this aside short today.');
  assert.deepEqual(made.groups, {});
});

test('a cut across ghosted text joins what is left to it without a stray capital or space', () => {
  const blocks = B(DOC);
  const proposal = propose(blocks, { 2: 'And really plain today.' });
  const made = H(applyProposal(blocks, proposal));
  assert.ok(made.endsWith('<p><br></p><p><span data-ghost>this aside </span>And <span data-vid="aaaaaaa">really plain</span> today.</p>'), made.slice(-120));
});

test('characters beyond the basic plane survive a cut beside them', () => {
  const blocks = B('<p>Really 👍🏽 good, honestly, and done.</p>');
  const proposal = propose(blocks, { 1: '👍🏽 good and done.' });
  assert.equal(textOf(applyProposal(blocks, proposal)[0]), '👍🏽 good and done.');
});

// --- a paragraph that goes whole ----------------------------------------------------------------------
//
// A trim chooses among sentences, and where every sentence of a paragraph goes the paragraph
// goes: with a blank line, so that those around it stay one blank line apart.

const LINES = '<p><br></p><p># A title</p><p><br></p><p>The first stays.</p><p><br></p><p>The second goes. All of it.</p><p><br></p><p>The third stays.</p>';
/** A proposal that cuts the paragraphs numbered in `whole` down to nothing. */
const cutWhole = (blocks, ...whole) => {
  const paragraphs = offered(blocks);
  return makeProposal(paragraphs, whole.map((n) => ({ n, runs: [{ index: 0, start: 0, end: paragraphs.find((p) => p.n === n).text.length }], caseFixes: [] })));
};

test('a paragraph cut to nothing goes, and a blank line with it', () => {
  const blocks = B(LINES);
  assert.equal(H(applyProposal(blocks, cutWhole(blocks, 2))), '<p><br></p><p># A title</p><p><br></p><p>The first stays.</p><p><br></p><p>The third stays.</p>');
  assert.deepEqual(counts(blocks, cutWhole(blocks, 2)), { before: 14, after: 8 });
});

test('the last paragraph takes the blank line before it, and the first the one after', () => {
  const blocks = B(LINES);
  assert.equal(H(applyProposal(blocks, cutWhole(blocks, 3))), '<p><br></p><p># A title</p><p><br></p><p>The first stays.</p><p><br></p><p>The second goes. All of it.</p>');
  assert.equal(H(applyProposal(blocks, cutWhole(blocks, 1))), '<p><br></p><p># A title</p><p><br></p><p>The second goes. All of it.</p><p><br></p><p>The third stays.</p>');
});

test('two paragraphs together go together, and leave one blank line', () => {
  const blocks = B(LINES);
  assert.equal(H(applyProposal(blocks, cutWhole(blocks, 1, 2))), '<p><br></p><p># A title</p><p><br></p><p>The third stays.</p>');
  assert.equal(H(applyProposal(blocks, cutWhole(blocks, 2, 3))), '<p><br></p><p># A title</p><p><br></p><p>The first stays.</p>');
});

test('paragraphs with no blank lines between them close up without taking one', () => {
  const blocks = B('<p>One.</p><p>Two.</p><p>Three.</p><p><br></p><p>Four.</p>');
  assert.equal(H(applyProposal(blocks, cutWhole(blocks, 2))), '<p>One.</p><p>Three.</p><p><br></p><p>Four.</p>');
});

test('a paragraph that keeps a sentence, or has ghosted words in it, stays', () => {
  const blocks = B('<p>Goes. <span data-ghost>Set aside.</span></p><p><br></p><p>One goes. One stays.</p>');
  const paragraphs = offered(blocks);
  const proposal = makeProposal(paragraphs, [
    { n: 1, runs: [{ index: 0, start: 0, end: 5 }], caseFixes: [] },
    { n: 2, runs: [{ index: 0, start: 0, end: 9 }, { index: 1, start: 10, end: 20 }], caseFixes: [] },
  ]);
  assert.equal(H(applyProposal(blocks, proposal, new Set(['c3']))), '<p><span data-ghost>Set aside.</span></p><p><br></p><p>One stays.</p>');
});

// Found with the real model, on the welcome piece: cut in half, it read "open the Lab.You decide".
test('a sentence cut from beside ghosted text leaves the words around it a space apart, and none at the end', () => {
  const blocks = B('<p>Open the Lab. It reads the page. <span data-ghost>You decide.</span> It never rewrites.</p>');
  const paragraphs = offered(blocks);
  const { text } = paragraphs[0];
  assert.equal(text, 'Open the Lab. It reads the page. It never rewrites.');
  const at = (sentence) => ({ start: text.indexOf(sentence), end: text.indexOf(sentence) + sentence.length });
  const proposal = makeProposal(paragraphs, [{ n: 1, runs: [{ index: 0, ...at('It reads the page.') }, { index: 1, ...at('It never rewrites.') }], caseFixes: [] }]);
  assert.equal(H(applyProposal(blocks, proposal)), '<p>Open the Lab. <span data-ghost>You decide.</span></p>', 'both cut');
  assert.equal(H(applyProposal(blocks, proposal, new Set(['c1']))), '<p>Open the Lab. It reads the page. <span data-ghost>You decide.</span></p>', 'the last only');
  assert.equal(H(applyProposal(blocks, proposal, new Set(['c2']))), '<p>Open the Lab. <span data-ghost>You decide.</span> It never rewrites.</p>', 'the middle only');
});

test('a sentence cut from before ghosted text at the start leaves no space ahead of what follows', () => {
  const blocks = B('<p>Goes first. <span data-ghost>Set aside.</span> Then this stays.</p>');
  const paragraphs = offered(blocks);
  const proposal = makeProposal(paragraphs, [{ n: 1, runs: [{ index: 0, start: 0, end: 11 }], caseFixes: [] }]);
  assert.equal(H(applyProposal(blocks, proposal)), '<p><span data-ghost>Set aside.</span> Then this stays.</p>');
});

test('a cut that takes its own spaces is left as the model made it', () => {
  // Nothing is put back between a bracket and the word that now follows it.
  const blocks = B('<p>The tool (really very simple) works.</p>');
  const proposal = propose(blocks, { 1: 'The tool (simple) works.' });
  assert.equal(textOf(applyProposal(blocks, proposal)[0]), 'The tool (simple) works.');
});

// --- found in review: the joins a cut leaves ----------------------------------------------------------
//
// What a level of trim would do to a page, from the model's answer to the page as it would be
// left: `sentences` is what the model says, `percent` the level.
const trimmed = (html, sentences, percent = 10) => {
  const blocks = B(html);
  const paragraphs = offered(blocks);
  const said = parseLabResponse('trim', JSON.stringify({ sentences }), paragraphs);
  const proposal = makeProposal(paragraphs, chooseCuts(paragraphs, said.items, { percent, of: wordsIn(blocks) }));
  return { blocks, proposal, page: H(applyProposal(blocks, proposal)) };
};
const REST = 'The rest of this paragraph is here to make up the number of words that are needed.';

test('a word cut from after ghosted words leaves them a space from what is before, and none before the stop', () => {
  const stop = trimmed(`<p>It works <span data-ghost>in most cases</span> well. ${REST}</p>`, [{ s: 1, text: 'It works.', need: 5 }, { s: 2, text: REST, need: 5 }]);
  assert.equal(stop.page, `<p>It works <span data-ghost>in most cases</span>. ${REST}</p>`);
  const comma = trimmed(`<p>It reads the page <span data-ghost>slowly and carefully</span> twice, then dims what could go. ${REST}</p>`, [{ s: 1, text: 'It reads the page, then dims what could go.', need: 5 }, { s: 2, text: REST, need: 5 }]);
  assert.equal(comma.page, `<p>It reads the page <span data-ghost>slowly and carefully</span>, then dims what could go. ${REST}</p>`);
  const before = trimmed(`<p>It is simple really<span data-ghost>, in my view,</span> and it works. ${REST}</p>`, [{ s: 1, text: 'It is simple and it works.', need: 5 }, { s: 2, text: REST, need: 5 }]);
  assert.equal(before.page, `<p>It is simple<span data-ghost>, in my view,</span> and it works. ${REST}</p>`);
});

test('a sentence that goes from among ghosted words leaves one space between what stays', () => {
  const stays = 'And this one stays as well, to the end of it, every word.';
  const inside = trimmed(`<p>Up to here it stays. Then this one<span data-ghost> with an aside</span> goes away. ${stays}</p>`, [{ s: 1, text: 'Up to here it stays.', need: 5 }, { s: 2, text: 'Then this one goes away.', need: 1 }, { s: 3, text: stays, need: 5 }]);
  assert.equal(inside.page, `<p>Up to here it stays.<span data-ghost> with an aside</span> ${stays}</p>`);
  const between = trimmed(`<p>This stays here for good. <span data-ghost>Set aside one.</span> This one goes. <span data-ghost>Set aside two.</span> ${stays}</p>`, [{ s: 1, text: 'This stays here for good.', need: 5 }, { s: 2, text: 'This one goes.', need: 1 }, { s: 3, text: stays, need: 5 }]);
  assert.equal(between.page, `<p>This stays here for good. <span data-ghost>Set aside one.</span> <span data-ghost>Set aside two.</span> ${stays}</p>`);
  const last = trimmed(`<p>${stays} <span data-ghost>Set aside one.</span> This one goes. <span data-ghost>Set aside two.</span></p>`, [{ s: 1, text: stays, need: 5 }, { s: 2, text: 'This one goes.', need: 1 }], 30);
  assert.equal(last.page, `<p>${stays} <span data-ghost>Set aside one.</span> <span data-ghost>Set aside two.</span></p>`);
  const first = trimmed(`<p><span data-ghost>Old opening.</span> Goes away now. ${stays}</p>`, [{ s: 1, text: 'Goes away now.', need: 1 }, { s: 2, text: stays, need: 5 }], 30);
  assert.equal(first.page, `<p><span data-ghost>Old opening.</span> ${stays}</p>`);
});

test('ghosted words either side of a cut are not run together', () => {
  const made = trimmed(`<p>Keep<span data-ghost> really</span> <span data-ghost>truly </span>this. ${REST}</p>`, [{ s: 1, text: 'This.', need: 5 }, { s: 2, text: REST, need: 5 }]);
  assert.equal(made.page, `<p><span data-ghost> really</span> <span data-ghost>truly </span>This. ${REST}</p>`);
});

test('a paragraph with spaces at its ends, cut whole, goes like any other', () => {
  const made = trimmed('<p>First stays, with enough words to be most of the piece, and a few more.</p><p><br></p><p> Goes whole. </p><p><br></p><p>Last stays, with enough words to be the rest of the piece.</p>', [
    { s: 1, text: 'First stays, with enough words to be most of the piece, and a few more.', need: 5 },
    { s: 2, text: 'Goes whole.', need: 1 },
    { s: 3, text: 'Last stays, with enough words to be the rest of the piece.', need: 5 },
  ]);
  assert.equal(made.page, '<p>First stays, with enough words to be most of the piece, and a few more.</p><p><br></p><p>Last stays, with enough words to be the rest of the piece.</p>');
});

test('a paragraph of two sentences that both go, goes', () => {
  const made = trimmed('<p>Stays, this one, and it is long enough to be most of the words here.</p><p><br></p><p>Goes first. Goes second.</p>', [
    { s: 1, text: 'Stays, this one, and it is long enough to be most of the words here.', need: 5 },
    { s: 2, text: 'Goes first.', need: 1 },
    { s: 3, text: 'Goes second.', need: 1 },
  ], 30);
  assert.equal(made.proposal.cuts.length, 2, 'a cut for each sentence');
  assert.equal(made.page, '<p>Stays, this one, and it is long enough to be most of the words here.</p>');
  assert.equal(H(applyProposal(made.blocks, made.proposal, new Set(['c1']))), '<p>Stays, this one, and it is long enough to be most of the words here.</p><p><br></p><p>Goes first.</p>', 'keep one and the paragraph stays, with it');
});

// Whatever a proposal holds, making the cuts takes nothing but what was faded and the
// spaces beside it. (A fix with other letters in it once cost a paragraph everything after.)
test('nothing outside a cut is ever lost but a space', () => {
  const blocks = B("<p>Honestly, it's fine. The second sentence stays as it is. And so does the third.</p>");
  const paragraphs = offered(blocks);
  const hostile = makeProposal(paragraphs, [{ n: 1, runs: [{ index: 0, start: 0, end: 10 }], caseFixes: [{ start: 10, end: 14, text: 'It’s!', run: 0 }] }]);
  assert.equal(textOf(applyProposal(blocks, hostile)[0]), "It's fine. The second sentence stays as it is. And so does the third.");
  const honest = trimmed("<p>Honestly, it's fine. The second sentence stays as it is. And so does the third.</p>", [{ s: 1, text: 'It’s fine.', need: 5 }]);
  assert.equal(honest.page, "<p>It's fine. The second sentence stays as it is. And so does the third.</p>");
});

test('a paragraph group that goes whole goes with its paragraph', () => {
  const blocks = B('<p>Stays.</p><p><br></p><p data-vid="bbbbbbb">Goes, every word.</p>');
  const made = normalizeBlocks(applyProposal(blocks, cutWhole(blocks, 2)), { bbbbbbb: { scope: 'paragraph', variants: ['Goes, every word.', 'Another.'], active: 0 } });
  assert.equal(H(made.blocks), '<p>Stays.</p>');
  assert.deepEqual(made.groups, {});
});

test('the words a trim is reckoned on are those the card counts: all that is not ghosted, headings included', () => {
  // DOC: three words in the heading, fifteen and six in the paragraphs, and two more that are ghosted.
  assert.equal(wordsIn(B(DOC)), 24);
  assert.equal(wordsIn(B('<p># Only a heading here</p>')), 4);
  assert.equal(wordsIn(B('<p><span data-ghost>All of it set aside.</span></p>')), 0);
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
