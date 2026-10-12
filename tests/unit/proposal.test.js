import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offered, makeProposal, counts, applyProposal, makeMarks, applyFixes } from '../../web/src/doc/proposal.js';
import { alignDeletion } from '../../web/src/doc/trim.js';
import { htmlToBlocks, blocksToHtml } from '../../web/src/doc/format.js';
import { textOf, normaliseBlocks } from '../../web/src/doc/blocks.js';

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
  const made = normaliseBlocks(applyProposal(blocks, proposal), structuredClone(GROUPS));
  assert.ok(H(made.blocks).endsWith('<p>Keep <span data-ghost>this aside </span>short and <span data-vid="aaaaaaa">plain</span> today.</p>'), H(made.blocks).slice(-120));
  assert.deepEqual(made.groups.aaaaaaa.variants, ['plain', 'simple']);
});

test('a cut that takes all of a group takes the group with it', () => {
  const blocks = B(DOC);
  const proposal = propose(blocks, { 2: 'Keep short today.' });
  const made = normaliseBlocks(applyProposal(blocks, proposal), structuredClone(GROUPS));
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
    [2, 'realy', 'misspelt'],
    [1, 'has has', 'said twice'],
    [1, 'Teh', 'misspelt'],
  ]);
  assert.deepEqual(
    marks.map((mark) => [mark.id, mark.block, cutText(blocks, mark).join('|'), mark.reason]),
    [
      ['m1', 2, 'Teh', 'misspelt'],
      ['m2', 2, 'has has', 'said twice'],
      ['m3', 4, 'realy', 'misspelt'],
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
    [1, 'Teh', 'misspelt', 'The'],
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
  const made = normaliseBlocks(applyFixes(blocks, marksFor(blocks, [[2, 'realy', 'misspelt', 'really']])), {
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
  assert.equal(applyFixes(blocks, marksFor(blocks, [[1, 'Teh', 'misspelt']])), blocks);
});
