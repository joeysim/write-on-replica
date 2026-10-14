// Overflow (design spec 6.8): a side panel for writing kept nearby but not in the piece.
const { editor, ui, commands } = window.writeOn;
ui.set({ read: false });
await document.fonts.ready;

const $ = (s) => document.querySelector(s);
const el = $('#overflow');
const field = el?.querySelector('textarea');
const toggle = $('#toggle-overflow');
if (!t.assert(el && field, 'the page has an Overflow panel with a text field')) return;

const html = () => editor.getState().html;
const kept = () => editor.getState().overflow;
const textOf = (i) => editor.blocks[i].runs.map((r) => r.text).join('');
const kinds = () => editor.blocks.map((b) => b.kind).join(' ');
const selected = () => {
  const s = editor.selection();
  return s && [s.start.block, s.start.offset, s.end.block, s.end.offset];
};
const settled = () => t.until(() => el.getAnimations({ subtree: false }).length === 0, 1500, 'the panel to finish sliding');
const item = (label) => [...document.querySelectorAll('#menu .item')].find((n) => n.querySelector('.label').textContent === label);
const undoAll = async () => {
  for (let i = 0; i < 6 && editor.canUndo; i++) await t.key('z', { meta: true });
};

const SPARE = ['A line kept for later.', 'Another that did not fit, long enough to wrap in the narrow column of the panel.', 'A third.'];
const P = [
  'The first paragraph sets the scene and says what the piece is about.',
  'The second one wanders. It has a sentence that may not belong here at all. Then it comes back.',
  'The third paragraph ends things.',
];
const DOC = `<p># A page with too much in it</p><p><br></p><p>${P[0]}</p><p><br></p><p>${P[1]}</p><p><br></p><p>${P[2]}</p>`;
const ALL = SPARE.join('\n\n');
const load = () => editor.setState({ html: DOC, groups: {}, overflow: ALL });
load();
await t.settle();
const before = html();

// --- the panel --------------------------------------------------------------------------------

t.equal(ui.get('overflow'), false, 'Overflow starts closed');
t.equal(getComputedStyle(el).visibility, 'hidden', 'and out of sight');
t.equal(toggle.getAttribute('aria-pressed'), 'false', 'its button is not pressed');
t.equal(field.value, ALL, 'it holds the document’s overflow text');
const column = $('#page').getBoundingClientRect().left;
const ink = getComputedStyle(editor.blockElement(2)).color;

await t.click(...t.center(toggle));
t.assert(ui.get('overflow'), 'the XYZ button opens it');
// It slides as in the clip: 200ms on the browser's own curve. The clip's frames have the
// edge 176.5px short of its place 47.5ms in, and 39px short at 114.2ms.
{
  const slide = el.getAnimations({ subtree: false })[0];
  if (t.assert(slide, 'it slides in')) {
    slide.pause();
    slide.currentTime = 47.5;
    await t.frame();
    t.near(el.getBoundingClientRect().left - (innerWidth - 280), 176.5, 5, 'early in the slide it is where the clip has it');
    slide.currentTime = 114.2;
    await t.frame();
    t.near(el.getBoundingClientRect().left - (innerWidth - 280), 39, 4, 'and later too');
    slide.play();
  }
}
await settled();
{
  const box = el.getBoundingClientRect();
  t.equal([box.left, box.top, box.width, box.height], [innerWidth - 280, 0, 280, innerHeight], 'it covers the right 280px of the window');
  const style = getComputedStyle(el);
  t.equal([style.backgroundColor, style.borderLeftWidth, style.borderLeftColor], ['rgb(10, 15, 31)', '1px', 'rgb(31, 35, 52)'], 'in the panel color, with a hairline on its left');
  t.near($('#page').getBoundingClientRect().left, column, 0.01, 'the text column does not move');
  t.equal(getComputedStyle(editor.blockElement(2)).color, ink, 'and the page does not dim');
  t.equal(toggle.getAttribute('aria-pressed'), 'true', 'the button is pressed');
  await t.until(() => getComputedStyle(toggle).color === 'rgb(129, 124, 212)', 1000, 'the button to light up');
  for (const id of ['#toggle-overflow', '#open-shortcuts']) {
    t.equal(document.elementFromPoint(...t.center(id))?.closest('button')?.id, id.slice(1), `${id} stays in reach over the panel`);
  }
  t.equal(document.activeElement, editor.root, 'opening leaves the caret in the page');
}

// Where things are, on the 1548x976 page of the clips.
{
  const title = el.querySelector('.title');
  t.equal(title.textContent, 'Overflow', 'the header');
  t.equal([getComputedStyle(title).color, getComputedStyle(title).fontFamily.includes('Caveat')], ['rgb(129, 124, 212)', true], 'in the hand, in the accent color');
  t.near(title.getBoundingClientRect().left + parseFloat(getComputedStyle(title).paddingLeft), 1291, 0.01, 'starting 22px inside the hairline');

  const style = getComputedStyle(field);
  // The clip sets its lines 23 and 22px apart by turns. This engine sets every line of a
  // field the same whole number of pixels apart, so it is the 22 the other panel's rows use.
  t.equal([style.fontSize, style.lineHeight, style.color, style.backgroundColor], ['15px', '22px', 'rgb(245, 209, 192)', 'rgba(0, 0, 0, 0)'], 'the text is 15px on 22px lines, in the text color');
  const box = field.getBoundingClientRect();
  const pad = (side) => parseFloat(style[`padding${side}`]) + parseFloat(style[`border${side}Width`]);
  t.near(box.left + pad('Left'), 1291, 0.01, 'it starts 22px inside the hairline too');
  t.near(box.width - pad('Left') - pad('Right'), 235, 0.01, 'and is 26 characters wide');
  t.near(box.top + pad('Top'), 215, 0.3, 'its first line is where the clip has it');
  t.equal([style.resize, style.outlineStyle], ['none', 'none'], 'a bare field: no grip, no focus ring');

  const hint = el.querySelector('.hint');
  t.equal(hint.textContent, 'ctrl+↵ or drag into the page to use', 'the hint');
  const hs = getComputedStyle(hint);
  t.equal([hs.fontSize, hs.letterSpacing, hs.color], ['10px', '0.5px', 'rgb(133, 123, 130)'], 'small and dim');
  const hb = hint.getBoundingClientRect();
  t.near(hb.left, 1291, 0.01, 'under the text');
  t.near(hb.bottom, innerHeight - 70.5, 0.01, 'at the foot of the panel');
  // The return arrow is drawn, since the text face has none; the character is still there to be read.
  t.near(hint.querySelector('.return').getBoundingClientRect().width, 6.5, 0.01, 'the arrow takes one character’s room');
  const arrow = await t.pixels(hb.left + 32, hb.top, 8, 12);
  t.assert(arrow.ink[0] - arrow.ground[0] > 60, `and is drawn there: ${arrow.ink.map(Math.round)} on ${arrow.ground}`);
  t.assert(box.bottom <= hb.top, 'the text stops above it');
  await t.snap('overflow');
}

// --- writing in it ------------------------------------------------------------------------------

field.focus();
field.setSelectionRange(ALL.length, ALL.length);
await t.type(' More');
t.equal(kept(), `${ALL} More`, 'typing in the panel changes the document’s overflow');
t.assert(editor.canUndo, 'as a step in the one history');
await t.key('Enter');
await t.type('x');
t.equal(kept(), `${ALL} More\nx`, 'Return starts a new line');
await undoAll();
t.equal(kept(), ALL, 'Cmd+Z in the panel undoes it');
t.assert(!editor.canUndo, 'through the document’s history, which is back where it began');
t.equal(field.value, ALL, 'and the panel shows that');
t.equal(document.activeElement, field, 'the caret stays in the panel');
await t.key('z', { meta: true, shift: true });
t.assert(kept().startsWith(`${ALL} More`), 'Shift+Cmd+Z redoes');
await undoAll();

// --- Ctrl+Shift+D, and read mode ----------------------------------------------------------------

await t.key('d', { ctrl: true, shift: true });
t.equal(ui.get('overflow'), false, 'Ctrl+Shift+D closes it');
t.equal(document.activeElement, editor.root, 'and the caret goes back to the page');
await settled();
t.equal(getComputedStyle(el).visibility, 'hidden', 'out of sight again');
t.equal(toggle.getAttribute('aria-pressed'), 'false', 'the button is released');
ui.set({ read: true });
await t.key('d', { ctrl: true, shift: true });
t.equal([ui.get('overflow'), ui.get('read')], [true, false], 'and opens it, turning the tools on');
await settled();
// Read mode is just the text: the panel steps out of sight, and is there again afterward.
ui.set({ read: true });
await settled();
t.equal(getComputedStyle(el).visibility, 'hidden', 'in read mode the panel is out of sight');
t.assert(ui.get('overflow'), 'though it has not been closed');
ui.set({ read: false });
await settled();
t.equal([getComputedStyle(el).visibility, el.getBoundingClientRect().left], ['visible', innerWidth - 280], 'and it is back when the tools are');
// Asked for while it is put away, it comes back; it is not closed.
ui.set({ read: true });
await settled();
await t.key('d', { ctrl: true, shift: true });
t.equal([ui.get('overflow'), ui.get('read')], [true, false], 'Ctrl+Shift+D while it is put away brings it back');
await settled();
t.equal(getComputedStyle(el).visibility, 'visible', 'into sight');
await t.click(...t.center(toggle));
await settled();
t.equal(ui.get('overflow'), false, 'the button closes it too');

// --- stashing -----------------------------------------------------------------------------------

{
  const DOUBT = ' It has a sentence that may not belong here at all.';
  const from = textOf(4).indexOf(DOUBT);
  editor.select({ block: 4, offset: from }, { block: 4, offset: from + DOUBT.length });
  await t.rightClick(...t.pointOfText('may not belong'));
  const row = item('Stash this in Overflow');
  if (t.assert(row && row.getAttribute('aria-disabled') !== 'true', 'the menu offers to stash the selection')) {
    const r = row.getBoundingClientRect();
    await t.click(r.left + 60, r.top + 15);
  }
  t.equal(textOf(4), 'The second one wanders. Then it comes back.', 'the selection leaves the page');
  t.equal(kept(), [...SPARE, DOUBT.trim()].join('\n\n'), 'and joins the end of Overflow as a paragraph of its own');
  t.assert(ui.get('overflow'), 'which opens');
  t.equal(field.value, kept(), 'showing it');
  t.equal(selected(), [4, from, 4, from], 'the caret is left where the words were');
  t.equal(document.activeElement, editor.root, 'in the page');
  await settled();
  await t.key('z', { meta: true });
  t.same(html(), before, 'one undo puts the words back in the page');
  t.equal(kept(), ALL, 'and takes them out of Overflow');
  t.equal(field.value, ALL, 'as the panel shows');
  t.assert(ui.get('overflow'), 'the panel stays open');
  await t.key('z', { meta: true, shift: true });
  t.equal([textOf(4), kept().endsWith(DOUBT.trim())], ['The second one wanders. Then it comes back.', true], 'redo stashes again');
  await undoAll();
}

// With nothing selected, the paragraph at the caret.
{
  ui.set({ overflow: false, read: true });
  editor.select({ block: 4, offset: 5 });
  await t.key('x', { ctrl: true, shift: true });
  t.equal(kinds(), 'h blank p blank p', 'with nothing selected Ctrl+Shift+X stashes the whole paragraph, and the page closes up');
  t.equal(kept(), [...SPARE, P[1]].join('\n\n'), 'it joins the end of Overflow');
  t.equal([ui.get('overflow'), ui.get('read')], [true, false], 'which opens, with the tools');
  t.equal(selected(), [4, 0, 4, 0], 'the caret is at the start of what followed');
  await undoAll();
  t.same(html(), before, 'undo brings the paragraph back');
}

// What was stashed last is in view, however much is there already.
{
  const lots = Array.from({ length: 60 }, (_, i) => `Spare line ${i + 1}.`).join('\n\n');
  editor.setState({ html: DOC, groups: {}, overflow: lots });
  await t.settle();
  ui.set({ overflow: false });
  editor.select({ block: 6, offset: 3 });
  await t.key('x', { ctrl: true, shift: true });
  t.assert(field.scrollHeight > field.clientHeight + 100, 'a long overflow scrolls inside the panel');
  t.near(field.scrollTop + field.clientHeight, field.scrollHeight, 1, 'and after a stash it is scrolled to the end, where the new paragraph is');
  t.assert(field.value.endsWith(P[2]), 'which is the one just stashed');
  load();
  await t.settle();
}

// Nothing to stash.
{
  editor.select({ block: 3, offset: 0 });
  t.equal(commands.can('stash'), false, 'a blank line has nothing to stash');
  const blank = editor.blockElement(3).getBoundingClientRect();
  await t.rightClick(blank.left + 200, blank.top + 18);
  t.equal(item('Stash this in Overflow')?.getAttribute('aria-disabled'), 'true', 'and the menu item is dimmed there');
  await t.key('Escape');
}

// --- using what is there: Ctrl+Return ---------------------------------------------------------------

{
  editor.select({ block: 2, offset: P[0].length });
  await t.settle();
  field.focus();
  const at = field.value.indexOf('Another') + 3;
  field.setSelectionRange(at, at);
  await t.key('Enter', { ctrl: true });
  t.equal(textOf(2), P[0] + SPARE[1], 'Ctrl+Return moves the paragraph at the caret into the page, where the page’s caret last was');
  t.equal(kept(), [SPARE[0], SPARE[2]].join('\n\n'), 'out of Overflow, which closes up');
  t.equal(field.value, kept(), 'as the panel shows');
  t.equal(document.activeElement, editor.root, 'the caret goes to the page with it');
  t.equal(selected(), [2, P[0].length + SPARE[1].length, 2, P[0].length + SPARE[1].length], 'and stands after it');
  await t.key('z', { meta: true });
  t.same(html(), before, 'one undo takes it out of the page');
  t.equal(kept(), ALL, 'and puts it back in Overflow');
}

// A selection is used as selected.
{
  editor.select({ block: 6, offset: 0 });
  await t.settle();
  field.focus();
  const a = field.value.indexOf('kept for later');
  field.setSelectionRange(a, a + 'kept for later'.length);
  await t.key('Enter', { ctrl: true });
  t.equal(textOf(6), `kept for later${P[2]}`, 'with a selection, just the selection moves');
  t.equal(kept(), ['A line .', SPARE[1], SPARE[2]].join('\n\n'), 'and the rest of its line stays');
  await undoAll();
}

// On a blank line there is nothing to use.
{
  field.focus();
  const gap = field.value.indexOf('\n\n') + 1;
  field.setSelectionRange(gap, gap);
  await t.key('Enter', { ctrl: true });
  t.same(html(), before, 'Ctrl+Return on a blank line moves nothing');
  t.equal(field.value, ALL, 'and adds no line');
}

// Where the page has not had a caret yet, the text is added at its end.
{
  getSelection().removeAllRanges();
  load();
  await t.settle();
  field.focus();
  field.setSelectionRange(2, 2);
  await t.key('Enter', { ctrl: true });
  t.equal(kinds(), 'h blank p blank p blank p blank p', 'with no caret in the page yet, the paragraph is added at the end');
  t.equal(textOf(8), SPARE[0], 'as a paragraph of its own');
  await undoAll();
}

// The page scrolls to show where the text went.
{
  const many = Array.from({ length: 40 }, (_, i) => `<p>Paragraph ${i + 1} of a long page.</p><p><br></p>`).join('');
  editor.setState({ html: `${many}<p>The last one.</p>`, groups: {}, overflow: 'A spare line.' });
  await t.settle();
  const last = editor.blocks.length - 1;
  editor.select({ block: last, offset: 13 });
  await t.settle();
  $('#scroll').scrollTop = 0;
  await t.settle();
  t.assert(editor.blockElement(last).getBoundingClientRect().top > innerHeight, 'the end of a long page is out of sight');
  field.focus();
  await t.key('Enter', { ctrl: true });
  const box = editor.blockElement(last).getBoundingClientRect();
  t.equal(textOf(last), 'The last one.A spare line.', 'text used while its place is out of sight still goes there');
  t.assert(box.top >= 96 && box.bottom <= innerHeight - 96, `and the page scrolls to show it, clear of the fading edges: ${Math.round(box.top)}..${Math.round(box.bottom)}`);
  load();
  await t.settle();
}

// --- dragging into the page ------------------------------------------------------------------------

{
  const drag = (type, target, data, x = 0, y = 0) =>
    target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, dataTransfer: data }));
  field.focus();
  const a = field.value.indexOf(SPARE[2]);
  field.setSelectionRange(a, a + SPARE[2].length);
  const data = new DataTransfer();
  drag('dragstart', field, data);
  data.setData('text/plain', SPARE[2]);
  const spot = t.rangeOfText('ends things').getClientRects()[0];
  const [x, y] = [spot.left + 1, spot.top + spot.height / 2];
  drag('dragover', document.elementFromPoint(x, y), data, x, y);
  drag('drop', document.elementFromPoint(x, y), data, x, y);
  drag('dragend', field, data);
  await t.settle();
  t.equal(textOf(6), `The third paragraph ${SPARE[2]}ends things.`, 'text dragged from Overflow goes in where it is dropped');
  t.equal(kept(), SPARE.slice(0, 2).join('\n\n'), 'and leaves Overflow');
  t.equal(field.value, kept(), 'as the panel shows');
  await t.key('z', { meta: true });
  t.same(html(), before, 'in one step: undo takes it out of the page');
  t.equal(kept(), ALL, 'and puts it back');

  // A drag that is given up moves nothing, and what is dropped later is not taken for it.
  field.focus();
  field.setSelectionRange(a, a + SPARE[2].length);
  drag('dragstart', field, new DataTransfer());
  drag('dragend', field, new DataTransfer());
  const other = new DataTransfer();
  other.setData('text/plain', 'From elsewhere. ');
  drag('drop', document.elementFromPoint(x, y), other, x, y);
  await t.settle();
  t.equal(textOf(6), 'The third paragraph From elsewhere. ends things.', 'text dropped from elsewhere goes in as before');
  t.equal(kept(), ALL, 'and Overflow keeps what it had');
  await undoAll();
}

// --- an empty overflow ------------------------------------------------------------------------------

editor.setState({ html: DOC, groups: {}, overflow: '' });
await t.settle();
t.equal(field.value, '', 'a document with nothing in Overflow shows an empty panel');
field.focus();
await t.key('Enter', { ctrl: true });
t.same(html(), before, 'where Ctrl+Return has nothing to move');
