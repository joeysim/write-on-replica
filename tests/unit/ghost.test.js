import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ghostPlan, applyGhost } from '../../web/src/doc/ghost.js';
import { htmlToBlocks, blocksToHtml } from '../../web/src/doc/format.js';
import { textOf } from '../../web/src/doc/blocks.js';

const B = (html) => htmlToBlocks(html);
const H = (blocks) => blocksToHtml(blocks);
const at = (block, offset) => ({ block, offset });
const caret = (block, offset) => ({ start: at(block, offset), end: at(block, offset), collapsed: true });
const range = (start, end) => ({ start, end, collapsed: false });
/** Where `needle` begins in a block, plus `into`. */
const offsetOf = (blocks, needle, block = 0, into = 0) => textOf(blocks[block]).indexOf(needle) + into;
/** A selection covering `needle` in one block. */
const over = (blocks, needle, block = 0) => {
  const from = offsetOf(blocks, needle, block);
  return range(at(block, from), at(block, from + needle.length));
};
/** The document after the command has done what it plans to. */
const done = (blocks, selection) => H(applyGhost(blocks, ghostPlan(blocks, selection)));

// --- dimming ----------------------------------------------------------------------------------

test('a selection is dimmed exactly as selected', () => {
  const blocks = B('<p>One two three four</p>');
  const selection = over(blocks, 'two three');
  assert.deepEqual(ghostPlan(blocks, selection), { revive: false, ranges: [{ start: at(0, 4), end: at(0, 13) }] });
  assert.equal(done(blocks, selection), '<p>One <span data-ghost>two three</span> four</p>');
});

test('a selection across paragraphs dims its part of each', () => {
  const blocks = B('<p>One two three</p><p><br></p><p>four five</p>');
  assert.equal(
    done(blocks, range(at(0, 4), at(2, 4))),
    '<p>One <span data-ghost>two three</span></p><p><br></p><p><span data-ghost>four</span> five</p>',
  );
});

test('with nothing selected it is the word at the caret', () => {
  const blocks = B('<p>Keep the customer, always.</p>');
  const dimmed = '<p>Keep the <span data-ghost>customer</span>, always.</p>';
  assert.equal(done(blocks, caret(0, offsetOf(blocks, 'customer', 0, 3))), dimmed);
  assert.equal(done(blocks, caret(0, offsetOf(blocks, ',', 0, 1))), dimmed, 'a caret after its comma is still on the word');
});

test('a selection that cuts into a group dims what was selected and no more, as two runs', () => {
  const blocks = B('<p>See <span data-vid="aaaaaaa">the whole sentence</span> here</p>');
  assert.equal(
    done(blocks, range(at(0, 2), at(0, 7))),
    '<p>Se<span data-ghost>e </span><span data-vid="aaaaaaa"><span data-ghost>the</span> whole sentence</span> here</p>',
  );
});

test('there is nothing to dim with no selection, on a blank line, among spaces, or where no words are selected', () => {
  const blocks = B('<p>One  two</p><p><br></p><p>three</p>');
  assert.equal(ghostPlan(blocks, null), null);
  assert.equal(ghostPlan(blocks, caret(1, 0)), null, 'a blank line');
  assert.equal(ghostPlan(blocks, caret(0, 4)), null, 'between two spaces');
  assert.equal(ghostPlan(blocks, range(at(0, 3), at(0, 5))), null, 'only spaces selected');
  assert.equal(ghostPlan(blocks, range(at(0, 8), at(2, 0))), null, 'from the end of one paragraph to the start of another');
});

// --- reviving ---------------------------------------------------------------------------------

test('a caret in ghosted text brings the whole stretch back', () => {
  const blocks = B('<p>One <span data-ghost>two three</span> four <span data-ghost>five</span></p>');
  const selection = caret(0, offsetOf(blocks, 'three', 0, 2));
  assert.deepEqual(ghostPlan(blocks, selection), { revive: true, ranges: [{ start: at(0, 4), end: at(0, 13) }] });
  assert.equal(done(blocks, selection), '<p>One two three four <span data-ghost>five</span></p>');
});

test('a selection brings back every stretch it touches, each of them whole, and no other', () => {
  const blocks = B('<p><span data-ghost>One two</span> three <span data-ghost>four five</span> six <span data-ghost>seven</span></p>');
  // From inside "two" to inside "four".
  assert.equal(done(blocks, range(at(0, 5), at(0, 16))), '<p>One two three four five six <span data-ghost>seven</span></p>');
});

test('a stretch that was split at the edge of a group is one stretch', () => {
  const blocks = B('<p>Se<span data-ghost>e </span><span data-vid="aaaaaaa"><span data-ghost>the</span> whole sentence</span> here</p>');
  assert.equal(done(blocks, caret(0, 5)), '<p>See <span data-vid="aaaaaaa">the whole sentence</span> here</p>');
});

test('a stretch ends with its paragraph, and a selection reaches into both', () => {
  const blocks = B('<p>One <span data-ghost>two</span></p><p><span data-ghost>three</span> four</p>');
  assert.equal(done(blocks, caret(0, 5)), '<p>One two</p><p><span data-ghost>three</span> four</p>');
  assert.equal(done(blocks, range(at(0, 5), at(1, 2))), '<p>One two</p><p>three four</p>');
});

test('a caret on a ghosted word at the very edge of its stretch still revives', () => {
  const blocks = B('<p>Always. <span data-ghost>It all depends.</span> This is hard.</p>');
  const revived = '<p>Always. It all depends. This is hard.</p>';
  assert.equal(ghostPlan(blocks, caret(0, 8)).revive, true);
  assert.equal(done(blocks, caret(0, 8)), revived, 'before its first letter');
  assert.equal(done(blocks, caret(0, 23)), revived, 'after its period');
});

test('a caret in ghosted text that is no word still revives', () => {
  const blocks = B('<p>One <span data-ghost>— or</span> two</p>');
  assert.equal(done(blocks, caret(0, 5)), '<p>One — or two</p>');
});

test('a word next to ghosted text is dimmed in its own right', () => {
  const blocks = B('<p>Always. <span data-ghost>It all depends.</span> This is hard.</p>');
  assert.equal(
    done(blocks, caret(0, offsetOf(blocks, 'This', 0, 1))),
    '<p>Always. <span data-ghost>It all depends.</span> <span data-ghost>This</span> is hard.</p>',
  );
});
