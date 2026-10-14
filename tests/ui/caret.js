// The caret is always somewhere the writer can use it: in the text from the moment a window
// opens, never under the page's faded edges, and a press on the page beside or below the
// text lands in the text.
const { editor, ui } = window.writeOn;
await document.fonts.ready;
await t.settle();

const textOf = (i) => editor.blocks[i].runs.map((r) => r.text).join('');
const scroller = document.getElementById('scroll');
/** The line the caret is on, in the window: its top and bottom. */
function caretLine() {
  const caret = editor.selection().start;
  const boxes = editor.rangeFor(caret.block, caret.offset, caret.offset).getClientRects();
  const box = boxes[0] && boxes[0].height ? boxes[0] : editor.blockElement(caret.block).getBoundingClientRect();
  const middle = (box.top + box.bottom) / 2;
  return { top: middle - 18, bottom: middle + 18 };
}

// --- a window just opened -----------------------------------------------------------------------

t.equal(document.activeElement, editor.root, 'a window opens with the keyboard in the text');
t.equal(editor.selection()?.start, { block: 0, offset: 0 }, 'and the caret at its start');
await t.type('Hi');
t.equal(textOf(0), 'Hi', 'so typing lands in the piece without a click first');
await t.key('z', { meta: true });
t.equal(editor.blocks[0].kind, 'blank', 'and undo takes it back');

// --- the faded edges ----------------------------------------------------------------------------

// The page fades its text out toward the top and bottom of the window: nothing can be read
// within 53px of an edge, and text is at full strength only from 96px. The caret is kept on
// lines that can be read.
ui.set({ read: false });
const line = 'One line of a longer piece, long enough that the window cannot show all of it at once.';
editor.setState({ html: Array.from({ length: 60 }, (_, i) => `<p>${i} ${line}</p><p><br></p>`).join(''), groups: {}, overflow: '' });
editor.focus();
editor.select({ block: 0, offset: 3 });
await t.settle();
{
  let lowest = 0;
  for (let i = 0; i < 45; i++) {
    await t.key('ArrowDown');
    lowest = Math.max(lowest, caretLine().bottom);
  }
  t.assert(scroller.scrollTop > 300, `the page has scrolled to follow the caret: ${Math.round(scroller.scrollTop)}`);
  t.assert(lowest <= innerHeight - 96 - 24, `going down, the caret's line stays well clear of the fade: its bottom got to ${Math.round(lowest)} of ${innerHeight}`);
  let highest = Infinity;
  for (let i = 0; i < 45; i++) {
    await t.key('ArrowUp');
    highest = Math.min(highest, caretLine().top);
  }
  t.assert(highest >= 96 + 24, `going up, the same: its top got to ${Math.round(highest)}`);
}
// Typing does the same as the arrows.
{
  editor.select({ block: 40, offset: 0 });
  await t.settle();
  for (let i = 0; i < 14; i++) await t.key('Enter');
  await t.type('here');
  t.assert(caretLine().bottom <= innerHeight - 96 - 24, `new lines typed past the bottom stay readable: ${Math.round(caretLine().bottom)} of ${innerHeight}`);
  await t.key('z', { meta: true });
  await t.key('z', { meta: true });
}

// --- beside and below the text ------------------------------------------------------------------

scroller.scrollTop = 0;
editor.setState({ html: '<p>A short line.</p><p><br></p><p>The second paragraph, also short.</p>', groups: {}, overflow: '' });
await t.settle();
{
  const column = editor.root.getBoundingClientRect();
  const first = editor.blockElement(0).getBoundingClientRect();
  const last = editor.blockElement(2).getBoundingClientRect();
  t.assert(column.left > 150 && innerWidth - column.right > 150, 'there is page on both sides of the column');

  await t.click(column.right + 120, first.top + 18);
  t.equal(document.activeElement, editor.root, 'a press on the page to the right of a line goes to the text');
  t.equal(editor.selection()?.start, { block: 0, offset: 13 }, 'with the caret at the end of that line');

  await t.click(column.left - 120, last.top + 18);
  t.equal(editor.selection()?.start, { block: 2, offset: 0 }, 'a press to the left of a line puts it at the line’s start');

  await t.click(column.left + 300, last.bottom + 200);
  t.equal(editor.selection()?.start, { block: 2, offset: 33 }, 'a press below the piece puts it at the end');

  await t.click(column.left + 300, first.top - 60);
  t.equal(editor.selection()?.start, { block: 0, offset: 0 }, 'and one above it, at the start');

  // The controls are not the page: a press on one is its own.
  editor.select({ block: 2, offset: 5 });
  await t.settle();
  await t.click(...t.center('#toggle-alternates'));
  t.equal(editor.selection()?.start, { block: 2, offset: 5 }, 'a press on a control leaves the caret where it was');
  await t.click(...t.center('#toggle-alternates'));
}
