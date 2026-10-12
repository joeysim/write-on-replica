// Dragging selected text to another place in the page (design spec 5.2). The editor does the
// move itself, on the document: it takes the text out, works out where the drop now is, and
// puts it in, as one step. A scripted run has no pointer to drag with, so the scenario sends
// the page the events a drag is made of; the editor's own handlers do the rest.
const { editor, ui } = window.writeOn;
const { extractText } = await import('./src/doc/blocks.js');
ui.set({ read: false });
await document.fonts.ready;

const DOC = {
  html:
    '<p>One two three four five six.</p>' +
    '<p>Seven eight nine ten.</p>' +
    '<p><br></p>' +
    '<p>Last <span data-vid="gr0up01">line</span> here.</p>',
  groups: { gr0up01: { scope: 'word', variants: ['line', 'row'], active: 0 } },
  overflow: '',
};
const texts = () => editor.blocks.map((block) => block.runs.map((run) => run.text).join(''));
const send = (type, target, data, x = 0, y = 0) =>
  target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, dataTransfer: data }));

/**
 * Selects from `start` to `end` and drags it to just before `needle` (or, with `inside`, to
 * that many characters into it).
 */
async function move(start, end, needle, { inside = 0, nth = 0 } = {}) {
  editor.focus();
  editor.select(start, end);
  await t.settle();
  const data = new DataTransfer();
  send('dragstart', editor.root, data);
  data.setData('text/plain', extractText(editor.blocks, start, end));
  const range = t.rangeOfText(needle, { nth });
  const first = range.getClientRects()[0];
  const [x, y] = [first.left + inside * 12 + 1, first.top + first.height / 2];
  const under = document.elementFromPoint(x, y);
  send('dragover', under, data, x, y);
  send('drop', under, data, x, y);
  send('dragend', editor.root, data);
  await t.settle();
}
const fresh = async () => {
  editor.setState(DOC);
  await t.settle();
};
const START = ['One two three four five six.', 'Seven eight nine ten.', '', 'Last line here.'];

// --- within a line ---------------------------------------------------------------------------------

await fresh();
await move({ block: 0, offset: 4 }, { block: 0, offset: 8 }, 'five');
t.equal(texts()[0], 'One three four two five six.', 'text dragged along its line lands where it was dropped, counted after it has left');
t.equal(editor.selection().start, { block: 0, offset: 19 }, 'with the caret after it');
await t.key('z', { meta: true });
t.equal(texts(), START, 'and one undo puts it back');

await fresh();
await move({ block: 0, offset: 19 }, { block: 0, offset: 24 }, 'two');
t.equal(texts()[0], 'One five two three four six.', 'and back along the line, to before where it was');

// --- from one paragraph to another ---------------------------------------------------------------

await fresh();
await move({ block: 0, offset: 8 }, { block: 0, offset: 19 }, 'nine');
t.equal(texts().slice(0, 2), ['One two five six.', 'Seven eight three four nine ten.'], 'down into the next paragraph');

await fresh();
await move({ block: 1, offset: 6 }, { block: 1, offset: 12 }, 'six');
t.equal(texts().slice(0, 2), ['One two three four five eight six.', 'Seven nine ten.'], 'and up into the one before');

// A selection that runs from one paragraph into the next takes the break with it, and what is
// below has moved up by the time it lands.
await fresh();
await move({ block: 0, offset: 19 }, { block: 1, offset: 6 }, 'Last');
t.equal(texts(), ['One two three four eight nine ten.', '', 'five six.', 'Seven Last line here.'], 'two paragraphs’ worth lands as two paragraphs, further down');
t.equal(Object.keys(editor.groups), ['gr0up01'], 'and a group it did not touch is as it was');
await t.key('z', { meta: true });
t.equal(texts(), START, 'one undo for all of it');

// --- where a drop does nothing -------------------------------------------------------------------

await fresh();
await move({ block: 0, offset: 4 }, { block: 0, offset: 13 }, 'three', { inside: 2 });
t.equal([texts(), editor.canUndo], [START, false], 'dropped on itself, the text stays where it is');
await move({ block: 0, offset: 4 }, { block: 0, offset: 8 }, 'three');
t.equal([texts(), editor.canUndo], [START, false], 'and dropped at its own end');
await move({ block: 0, offset: 4 }, { block: 0, offset: 8 }, 'two');
t.equal([texts(), editor.canUndo], [START, false], 'or at its own start');

// --- what the text carries -----------------------------------------------------------------------

// Text goes as text: a group that is dragged away whole goes as the words that were showing.
await fresh();
await move({ block: 3, offset: 5 }, { block: 3, offset: 10 }, 'Seven');
t.equal(texts(), ['One two three four five six.', 'line Seven eight nine ten.', '', 'Last here.'], 'a group dragged away goes as its words');
t.equal(editor.groups, {}, 'and is no longer a group');
await t.key('z', { meta: true });
t.equal([texts(), Object.keys(editor.groups)], [START, ['gr0up01']], 'until undo, which brings back the alternatives too');

// Dropped into a group, it becomes part of what the group is showing.
await fresh();
await move({ block: 0, offset: 0 }, { block: 0, offset: 4 }, 'line', { inside: 2 });
t.equal(texts()[3], 'Last liOne ne here.', 'text dropped inside a group goes in where it lands');
t.equal(editor.groups.gr0up01.variants, ['liOne ne', 'row'], 'as part of the variant that is showing');
