import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTarget } from '../../web/src/doc/target.js';
import { htmlToBlocks } from '../../web/src/doc/format.js';
import { textOf } from '../../web/src/doc/blocks.js';

const B = (html) => htmlToBlocks(html);
const caret = (block, offset) => ({ start: { block, offset }, end: { block, offset }, collapsed: true });
const range = (block, start, end) => ({ start: { block, offset: start }, end: { block, offset: end }, collapsed: start === end });
/** A selection covering `needle` in block 0. */
const over = (blocks, needle, block = 0) => {
  const at = textOf(blocks[block]).indexOf(needle);
  return range(block, at, at + needle.length);
};

const PLAIN = '<p>Editors can make tough calls about the ending. Then you ship. Then you wait.</p>';
const GROUPS = {
  w: { scope: 'word', variants: ['tough calls', 'hard choices'], active: 0 },
  s: { scope: 'sentence', variants: ['Then you ship.', 'Then it goes out.'], active: 0 },
  para: { scope: 'paragraph', variants: ['A whole paragraph. In two sentences.', 'Another.'], active: 0 },
};

// --- with nothing selected ------------------------------------------------------------------

test('with no selection the target is the word at the caret', () => {
  const blocks = B(PLAIN);
  const at = textOf(blocks[0]).indexOf('tough') + 2;
  assert.deepEqual(resolveTarget(blocks, {}, caret(0, at)), { vid: null, scope: 'word', block: 0, start: 17, end: 22, text: 'tough' });
});

test('a caret just after a word, or after its punctuation, still means that word', () => {
  const blocks = B(PLAIN);
  const text = textOf(blocks[0]);
  assert.equal(resolveTarget(blocks, {}, caret(0, text.indexOf('tough') + 5)).text, 'tough');
  assert.equal(resolveTarget(blocks, {}, caret(0, text.indexOf('ending.') + 7)).text, 'ending');
});

test('there is no target on a blank line, between paragraphs, or without a selection', () => {
  const blocks = B('<p><br></p><p>Some words</p>');
  assert.equal(resolveTarget(blocks, {}, caret(0, 0)), null);
  assert.equal(resolveTarget(blocks, {}, null), null);
  assert.equal(resolveTarget(blocks, {}, { start: { block: 0, offset: 0 }, end: { block: 1, offset: 4 }, collapsed: false }), null);
});

test('a caret inside a group, or at either edge of it, targets that group', () => {
  const blocks = B('<p>Editors can make <span data-vid="w">tough calls</span> about it.</p>');
  const expected = { vid: 'w', scope: 'word', block: 0, start: 17, end: 28, text: 'tough calls' };
  for (const offset of [17, 20, 23, 28]) assert.deepEqual(resolveTarget(blocks, GROUPS, caret(0, offset)), expected, `offset ${offset}`);
  assert.equal(resolveTarget(blocks, GROUPS, caret(0, 14)).text, 'make', 'a word beside the group is its own target');
});

test('anywhere in a paragraph group the target is that group', () => {
  const blocks = B('<p data-vid="para">A whole paragraph. In two sentences.</p>');
  const expected = { vid: 'para', scope: 'paragraph', block: 0, start: 0, end: 36, text: 'A whole paragraph. In two sentences.' };
  assert.deepEqual(resolveTarget(blocks, GROUPS, caret(0, 9)), expected);
  assert.deepEqual(resolveTarget(blocks, GROUPS, range(0, 2, 7)), expected);
});

// --- with a selection ------------------------------------------------------------------------

test('a selected phrase is a word-scope target, trimmed of the spaces around it', () => {
  const blocks = B(PLAIN);
  const at = textOf(blocks[0]).indexOf('tough calls');
  assert.deepEqual(resolveTarget(blocks, {}, range(0, at - 1, at + 12)), { vid: null, scope: 'word', block: 0, start: at, end: at + 11, text: 'tough calls' });
});

test('whole sentences make a sentence target and the whole of a longer paragraph a paragraph target', () => {
  const blocks = B(PLAIN);
  assert.equal(resolveTarget(blocks, {}, over(blocks, 'Then you ship.')).scope, 'sentence');
  assert.equal(resolveTarget(blocks, {}, over(blocks, 'Then you ship. Then you wait.')).scope, 'sentence');
  const all = resolveTarget(blocks, {}, range(0, 0, textOf(blocks[0]).length));
  assert.deepEqual([all.scope, all.start, all.end], ['paragraph', 0, textOf(blocks[0]).length]);
});

test('a heading selected whole is a sentence', () => {
  const blocks = B('<p># Write it more than one way</p>');
  const target = resolveTarget(blocks, {}, range(0, 0, 26));
  assert.deepEqual([target.scope, target.text], ['sentence', 'Write it more than one way']);
});

test('a selection of nothing but spaces has no target', () => {
  assert.equal(resolveTarget(B('<p>one   two</p>'), {}, range(0, 3, 6)), null);
});

test('a selection inside a group, or exactly over it, targets the group', () => {
  const blocks = B('<p>Editors can make <span data-vid="w">tough calls</span> about it.</p>');
  assert.equal(resolveTarget(blocks, GROUPS, range(0, 19, 22)).vid, 'w');
  assert.deepEqual(resolveTarget(blocks, GROUPS, range(0, 17, 28)), { vid: 'w', scope: 'word', block: 0, start: 17, end: 28, text: 'tough calls' });
});

test('a selection that cuts into a group grows to take all of it, as a new target', () => {
  const blocks = B('<p>Editors can make <span data-vid="w">tough calls</span> about it.</p>');
  const target = resolveTarget(blocks, GROUPS, range(0, 12, 22)); // "make tough"
  assert.deepEqual(target, { vid: null, scope: 'word', block: 0, start: 12, end: 28, text: 'make tough calls' });
});

// --- asking for a scope ----------------------------------------------------------------------

test('asking for a scope gives the word, sentence or paragraph around the same spot', () => {
  const blocks = B(PLAIN);
  const text = textOf(blocks[0]);
  const spot = caret(0, text.indexOf('ship') + 1);
  assert.equal(resolveTarget(blocks, {}, spot, 'word').text, 'ship');
  assert.deepEqual(
    resolveTarget(blocks, {}, spot, 'sentence'),
    { vid: null, scope: 'sentence', block: 0, start: text.indexOf('Then you ship.'), end: text.indexOf('Then you ship.') + 14, text: 'Then you ship.' },
  );
  const paragraph = resolveTarget(blocks, {}, spot, 'paragraph');
  assert.deepEqual([paragraph.scope, paragraph.start, paragraph.end], ['paragraph', 0, text.length]);
});

test('a scope asked for where a group of that scope already stands gives that group', () => {
  const blocks = B('<p>First. <span data-vid="s">Then you ship.</span> Last.</p>');
  const inside = caret(0, 12);
  assert.equal(resolveTarget(blocks, GROUPS, inside, 'sentence').vid, 's');
  const paragraph = resolveTarget(blocks, GROUPS, inside, 'paragraph');
  assert.deepEqual([paragraph.vid, paragraph.scope, paragraph.text], [null, 'paragraph', 'First. Then you ship. Last.']);
});

test('a one-sentence paragraph asked for as a paragraph is still a paragraph target', () => {
  const blocks = B('<p>Just the one sentence.</p>');
  assert.equal(resolveTarget(blocks, {}, caret(0, 3), 'paragraph').scope, 'paragraph');
});

test('positions hold for text outside the basic plane', () => {
  const blocks = B('<p>naïve 👍🏽 café</p>');
  const text = textOf(blocks[0]);
  const target = resolveTarget(blocks, {}, caret(0, text.indexOf('café') + 2));
  assert.deepEqual([target.text, target.start], ['café', text.indexOf('café')]);
});
