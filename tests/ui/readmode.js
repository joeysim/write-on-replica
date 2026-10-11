// Read mode, the word count, the chrome and its tooltips (design spec 4.3 and 6.1).
const { editor, ui } = window.writeOn;
const { countWords } = await import('./src/doc/text.js');
const $ = (selector) => document.querySelector(selector);
const shown = (el) => {
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden' && Number(style.opacity) > 0.99 && style.pointerEvents !== 'none';
};
const hidden = (el) => {
  const style = getComputedStyle(el);
  return style.visibility === 'hidden' || Number(style.opacity) < 0.01;
};
// The marks never take the pointer, so only how they look counts.
const marksShow = () => {
  const style = getComputedStyle($('#decor'));
  return style.visibility !== 'hidden' && Number(style.opacity) > 0.99;
};
const center = (el) => {
  const r = el.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
};
const CHROME = ['#toggle-alternates', '#open-source', '#open-shortcuts', '#save', '#open', '#post-x', '#linkedin', '#lab', '#toggle-overflow'];

// It opens as a bare editor: only the text and the word count.
t.assert(ui.get('read'), 'the app starts in read mode');
const wordcount = $('#wordcount');
t.assert(shown(wordcount), 'the word count is visible in read mode');
for (const id of CHROME) t.assert(hidden($(id)), `${id} is hidden in read mode`);
t.assert(!marksShow(), 'alternative marks are hidden in read mode');

// The count: whitespace-separated words, characters with spaces, line breaks not counted.
const texts = editor.blocks.map((b) => b.runs.map((r) => r.text).join(''));
const words = texts.reduce((n, s) => n + countWords(s), 0);
const chars = texts.reduce((n, s) => n + s.length, 0);
t.equal(wordcount.textContent, `${words} words ${chars} chars`, 'the word count reads as in the clips');
t.equal(wordcount.title, 'Read (Ctrl+Shift+R)', 'its tooltip names the mode and shortcut');
t.equal(getComputedStyle(wordcount).fontSize, '10.72px', 'word count size');
const wc = wordcount.getBoundingClientRect();
t.near(wc.left + parseFloat(getComputedStyle(wordcount).paddingLeft), 24, 0.6, 'word count left edge');
t.near(wc.top + wc.height / 2, 32, 0.6, 'word count sits on the top row');

// Clicking it turns the rest on.
await t.click(...center(wordcount));
await t.until(() => CHROME.every((id) => shown($(id))), 1500, 'the chrome to fade in');
t.assert(!ui.get('read'), 'clicking the word count leaves read mode');
await t.until(marksShow, 1500, 'alternative marks to show');

// Where the drawings are, on the 1548x976 page of the clips. Each is placed by the middle
// of what is drawn, given here in the drawing's own coordinates.
const drawn = (id, [vx, vy], [x, y]) => {
  const svg = $(`${id} svg`);
  const point = new DOMPoint(vx, vy).matrixTransform(svg.getScreenCTM());
  t.near(point.x, x, 0.15, `${id} x`);
  t.near(point.y, y, 0.15, `${id} y`);
  const box = $(id).getBoundingClientRect();
  t.assert(Number.isInteger(box.left) && Number.isInteger(box.top), `${id} sits on whole pixels`);
};
drawn('#toggle-alternates', [0, 0], [753, 32]);
drawn('#open-source', [0, 0], [795, 32]);
drawn('#open-shortcuts', [0, 0], [1513, 32]);
drawn('#save', [0, 0], [31, 944]);
drawn('#open', [0, 0], [65.5, 944]);
drawn('#post-x', [12.04, 12], [101, 944]);
drawn('#linkedin', [0, 0], [136, 944]);
drawn('#lab', [23.1, 13], [774.1, 950]);
drawn('#toggle-overflow', [0, 0], [1513, 944]);
// The drawings themselves: 17px of ink for the square icons, 24.5 x 17 for the boxed ones.
const ink = (id, selector) => {
  const shape = $(`${id} ${selector}`);
  const b = shape.getBBox();
  const w = parseFloat(getComputedStyle(shape).strokeWidth);
  return [b.width + w, b.height + w];
};
t.near(ink('#lab', 'rect')[0], 45.4, 0.05, 'LAB width');
t.near(ink('#lab', 'rect')[1], 26, 0.05, 'LAB height');
t.equal($('#lab').textContent.trim(), 'LAB', 'LAB label');
t.equal($('#toggle-overflow').textContent.trim(), 'XYZ', 'Overflow toggle label');
t.near(ink('#save', 'path')[0], 16.9, 0.25, 'save icon width');
t.near(ink('#save', 'path')[1], 16.9, 0.25, 'save icon height');
t.near(ink('#linkedin', 'rect')[0], 16.9, 0.25, 'LinkedIn icon width');
t.near(ink('#open-source', 'rect')[0], 24.45, 0.25, 'source icon width');
t.near(ink('#open-source', 'rect')[1], 16.95, 0.25, 'source icon height');
t.near(ink('#toggle-overflow', 'rect')[0], 24.45, 0.25, 'Overflow toggle width');
await t.snap('chrome');

// The shortcut toggles it back and forth.
await t.key('r', { ctrl: true, shift: true });
t.assert(ui.get('read'), 'Ctrl+Shift+R enters read mode');
await t.until(() => CHROME.every((id) => hidden($(id))), 1500, 'the chrome to fade out');
await t.key('r', { ctrl: true, shift: true });
t.assert(!ui.get('read'), 'and leaves it again');
await t.until(() => shown($('#save')), 1500, 'the chrome to return');

// With a selection the count is of the selection.
editor.select({ block: 1, offset: 0 }, { block: 1, offset: 8 });
await t.settle();
t.equal(wordcount.textContent, '2 words 8 chars selected', 'a selection is counted on its own');
editor.select({ block: 1, offset: 0 });
await t.settle();
t.equal(wordcount.textContent, `${words} words ${chars} chars`, 'and the document count returns');

// The count follows typing.
editor.select({ block: 1, offset: 5 });
await t.type(' now');
t.equal(wordcount.textContent, `${words + 1} words ${chars + 4} chars`, 'typing updates the count');
await t.key('z', { meta: true });

// The alternates toggle hides only the marks.
t.assert(ui.get('alternates'), 'alternates start on');
await t.click(...center($('#toggle-alternates')));
t.assert(!ui.get('alternates'), 'the toggle turns the marks off');
await t.until(() => !marksShow(), 1000, 'the marks to hide');
t.assert(shown($('#save')), 'the rest of the chrome stays');
await t.click(...center($('#toggle-alternates')));
await t.until(marksShow, 1000, 'the marks to show again');

// The mode is remembered.
const saved = await t.call('settings.get', {});
t.equal([saved.read, saved.alternates], [false, true], 'mode and toggle are stored through the shell');

// Tooltips: a plain shortcut label centred over the icon.
const tip = $('#tooltip');
for (const [id, label] of [['#save', 'Ctrl+S'], ['#open', 'Ctrl+O'], ['#post-x', 'Ctrl+Shift+P'], ['#toggle-overflow', 'Ctrl+Shift+D']]) {
  const [x, y] = center($(id));
  await t.hover(x, y);
  await t.until(() => shown(tip) || Number(getComputedStyle(tip).opacity) > 0.99, 1500, `the tooltip for ${id}`);
  t.equal(tip.textContent, label, `${id} tooltip text`);
  const r = tip.getBoundingClientRect();
  t.near(r.top + r.height / 2, y - 25.5, 0.3, `${id} tooltip sits 25px above the icon`);
  if (id === '#toggle-overflow') t.near(r.right, innerWidth - 21.8, 0.3, 'a tooltip near the edge lines up with the icon instead of leaving the page');
  else t.near(r.left + r.width / 2, x, 0.6, `${id} tooltip is centred on it`);
  t.equal(getComputedStyle(tip).fontSize, '9.92px', 'tooltip size');
  t.assert($(id).classList.contains('is-hovered'), `${id} lights up under the pointer`);
}
await t.snap('tooltip');
await t.hover(600, 500);
await t.until(() => Number(getComputedStyle(tip).opacity) < 0.01, 1500, 'the tooltip to go');
t.assert(!document.querySelector('.is-hovered'), 'nothing stays lit once the pointer has left');

// Icons at the top have no room above them, so their tooltip goes below.
{
  const [x, y] = center($('#open-source'));
  await t.hover(x, y);
  await t.until(() => Number(getComputedStyle(tip).opacity) > 0.99, 1500, 'the tooltip for the source icon');
  t.equal(tip.textContent, 'Ctrl+U', 'source icon tooltip');
  const r = tip.getBoundingClientRect();
  t.near(r.top + r.height / 2, y + 25.5, 0.3, 'it sits below the icon');
  await t.hover(600, 500);
}

// Using the chrome leaves the writing alone: the selection survives a click on a control.
editor.select({ block: 3, offset: 0 }, { block: 3, offset: 4 });
await t.settle();
await t.click(...center($('#toggle-alternates')));
await t.click(...center($('#toggle-alternates')));
const kept = editor.selection();
t.equal(kept && [kept.start.offset, kept.end.offset], [0, 4], 'clicking a control keeps the selection');
