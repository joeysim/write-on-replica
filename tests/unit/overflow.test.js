import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stash, takeFromOverflow, placeInPage } from '../../web/src/doc/overflow.js';
import { htmlToBlocks, blocksToHtml } from '../../web/src/doc/format.js';
import { textOf } from '../../web/src/doc/blocks.js';

const B = (html) => htmlToBlocks(html);
const H = (blocks) => blocksToHtml(blocks);
const at = (block, offset) => ({ block, offset });
const caret = (block, offset) => ({ start: at(block, offset), end: at(block, offset), collapsed: true });
const range = (start, end) => ({ start, end, collapsed: false });
const over = (blocks, needle, block = 0) => {
  const from = textOf(blocks[block]).indexOf(needle);
  return range(at(block, from), at(block, from + needle.length));
};

const THREE = '<p>First one.</p><p><br></p><p>Second one. It has two sentences.</p><p><br></p><p>Third one.</p>';

// --- stashing ---------------------------------------------------------------------------------

test('a selection leaves the page and becomes the first thing in an empty overflow', () => {
  const blocks = B(THREE);
  const made = stash(blocks, '', over(blocks, ' It has two sentences.', 2));
  assert.equal(H(made.blocks), '<p>First one.</p><p><br></p><p>Second one.</p><p><br></p><p>Third one.</p>');
  assert.equal(made.overflow, 'It has two sentences.', 'without the space that was selected with it');
  assert.deepEqual(made.caret, at(2, 11), 'the caret is left where the words were');
});

test('what is stashed goes to the end of the overflow, as a paragraph of its own', () => {
  const blocks = B(THREE);
  assert.equal(stash(blocks, 'Kept from before.', over(blocks, 'First', 0)).overflow, 'Kept from before.\n\nFirst');
  assert.equal(stash(blocks, 'Kept from before.\n\n\n', over(blocks, 'First', 0)).overflow, 'Kept from before.\n\nFirst', 'blank lines at the end do not pile up');
});

test('with nothing selected the whole paragraph at the caret goes, and the page closes up', () => {
  const made = stash(B(THREE), '', caret(2, 4));
  assert.equal(H(made.blocks), '<p>First one.</p><p><br></p><p>Third one.</p>');
  assert.equal(made.overflow, 'Second one. It has two sentences.');
  assert.deepEqual(made.caret, at(2, 0), 'the caret is at the start of what followed');
});

test('stashing the last paragraph takes the blank line above it too', () => {
  const made = stash(B(THREE), '', caret(4, 0));
  assert.equal(H(made.blocks), '<p>First one.</p><p><br></p><p>Second one. It has two sentences.</p>');
  assert.deepEqual(made.caret, at(2, 33), 'the caret is at the end of what is left');
});

test('stashing the first paragraph takes the blank line below it', () => {
  const made = stash(B(THREE), '', caret(0, 2));
  assert.equal(H(made.blocks), '<p>Second one. It has two sentences.</p><p><br></p><p>Third one.</p>');
  assert.deepEqual(made.caret, at(0, 0));
});

test('stashing the only paragraph leaves one blank line', () => {
  const made = stash(B('<p>All there is.</p>'), '', caret(0, 3));
  assert.equal(H(made.blocks), '<p><br></p>');
  assert.equal(made.overflow, 'All there is.');
  assert.deepEqual(made.caret, at(0, 0));
});

test('when the only line goes, a heading or a paragraph with alternatives, a plain blank line is left', () => {
  assert.deepEqual(stash(B('<p># Title</p>'), '', caret(0, 2)).blocks, [{ kind: 'blank', runs: [] }]);
  assert.deepEqual(stash(B('<p data-vid="ppppppp">All of it.</p>'), '', caret(0, 2)).blocks, [{ kind: 'blank', runs: [] }]);
});

test('a paragraph selected whole leaves no gap either', () => {
  const blocks = B(THREE);
  // As a triple click selects it: to the start of the line below.
  assert.equal(H(stash(blocks, '', range(at(2, 0), at(3, 0))).blocks), '<p>First one.</p><p><br></p><p>Third one.</p>');
  // And as dragging over its words selects it.
  assert.equal(H(stash(blocks, '', range(at(2, 0), at(2, 33))).blocks), '<p>First one.</p><p><br></p><p>Third one.</p>');
});

test('a selection across paragraphs is stashed as paragraphs, and what is left is joined', () => {
  const blocks = B(THREE);
  const made = stash(blocks, '', range(at(0, 6), at(2, 12)));
  assert.equal(made.overflow, 'one.\n\nSecond one.');
  assert.equal(H(made.blocks), '<p>First It has two sentences.</p><p><br></p><p>Third one.</p>');
});

test('marks do not travel: a group or ghosted words are stashed as the words that were showing', () => {
  const blocks = B('<p>Keep <span data-vid="aaaaaaa">this</span> and <span data-ghost>that</span>.</p><p><br></p><p>More.</p>');
  const made = stash(blocks, '', caret(0, 1));
  assert.equal(made.overflow, 'Keep this and that.');
  assert.equal(H(made.blocks), '<p>More.</p>');
});

test('there is nothing to stash with no selection, on a blank line, or where no words are selected', () => {
  const blocks = B('<p>One  two</p><p><br></p><p>three</p>');
  assert.equal(stash(blocks, '', null), null);
  assert.equal(stash(blocks, '', caret(1, 0)), null);
  assert.equal(stash(blocks, '', range(at(0, 3), at(0, 5))), null);
  assert.equal(stash(blocks, '', range(at(0, 8), at(2, 0))), null);
});

// --- taking text back out of the overflow --------------------------------------------------------

const KEPT = 'First spare line.\n\nSecond spare line, a longer one.\n\nThird.';

test('with nothing selected Ctrl+Return takes the paragraph the caret is in, and the rest closes up', () => {
  assert.deepEqual(takeFromOverflow(KEPT, 25, 25), { text: 'Second spare line, a longer one.', overflow: 'First spare line.\n\nThird.' });
  assert.deepEqual(takeFromOverflow(KEPT, 0, 0), { text: 'First spare line.', overflow: 'Second spare line, a longer one.\n\nThird.' });
  assert.deepEqual(takeFromOverflow(KEPT, KEPT.length, KEPT.length), { text: 'Third.', overflow: 'First spare line.\n\nSecond spare line, a longer one.' });
});

test('taking the only paragraph leaves the overflow empty', () => {
  assert.deepEqual(takeFromOverflow('Just this.', 4, 4), { text: 'Just this.', overflow: '' });
});

test('a selection is taken as selected, and what is left of its line stays', () => {
  const from = KEPT.indexOf(', a longer one');
  assert.deepEqual(takeFromOverflow(KEPT, from, from + ', a longer one'.length), {
    text: ', a longer one',
    overflow: 'First spare line.\n\nSecond spare line.\n\nThird.',
  });
});

test('a selection over whole paragraphs takes them and closes the gap', () => {
  const to = KEPT.indexOf('Third.');
  assert.deepEqual(takeFromOverflow(KEPT, 0, to), { text: 'First spare line.\n\nSecond spare line, a longer one.', overflow: 'Third.' });
});

test('there is nothing to take on a blank line or from a selection with no words', () => {
  assert.equal(takeFromOverflow(KEPT, 18, 18), null, 'the blank line between two paragraphs');
  assert.equal(takeFromOverflow(KEPT, 17, 19), null, 'only line breaks selected');
  assert.equal(takeFromOverflow('', 0, 0), null);
});

// --- putting it into the page ---------------------------------------------------------------------

test('text goes into the page at the caret, like a paste', () => {
  const blocks = B(THREE);
  const made = placeInPage(blocks, at(0, 6), 'spare ');
  assert.equal(H(made.blocks).slice(0, 26), '<p>First spare one.</p><p>');
  assert.deepEqual(made.caret, at(0, 12), 'the caret ends after it');
});

test('paragraphs go in as paragraphs', () => {
  const made = placeInPage(B('<p>Start. End.</p>'), at(0, 7), 'One.\n\nTwo. ');
  assert.equal(H(made.blocks), '<p>Start. One.</p><p><br></p><p>Two. End.</p>');
  assert.deepEqual(made.caret, at(2, 5));
});

test('where the page has had no caret the text is added at the end, as a paragraph of its own', () => {
  const made = placeInPage(B('<p>Only this.</p>'), null, 'And this.');
  assert.equal(H(made.blocks), '<p>Only this.</p><p><br></p><p>And this.</p>');
  assert.deepEqual(made.caret, at(2, 9));
  assert.equal(H(placeInPage(B('<p>Only this.</p><p><br></p>'), null, 'And this.').blocks), '<p>Only this.</p><p><br></p><p>And this.</p>', 'a blank line already at the end is used');
  assert.equal(H(placeInPage(B('<p><br></p>'), null, 'And this.').blocks), '<p>And this.</p>', 'an empty page takes it as its first line');
});

test('a caret that is no longer in the document is brought inside it', () => {
  const made = placeInPage(B('<p>Short.</p>'), at(5, 40), ' More.');
  assert.equal(H(made.blocks), '<p>Short. More.</p>');
});
