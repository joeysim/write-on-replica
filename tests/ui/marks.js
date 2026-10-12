// How alternatives are drawn (design spec 6.2): word, sentence and paragraph marks.
const { editor, ui } = window.writeOn;
ui.set({ read: false });
await document.fonts.ready;
await t.settle();

const decor = document.getElementById('decor');
const mark = (vid) => decor.querySelector(`g[data-vid="${vid}"]`);

// Baseline of the first line box of an element, in page coordinates.
function baselineOf(el) {
  const probe = document.createElement('span');
  probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  el.insertBefore(probe, el.firstChild);
  const y = probe.getBoundingClientRect().top;
  probe.remove();
  return y;
}
function lastBaselineOf(el) {
  const probe = document.createElement('span');
  probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  el.append(probe);
  const y = probe.getBoundingClientRect().top;
  probe.remove();
  return y;
}
// Decorations, in window coordinates. Lines are measured along their centre.
const origin = () => decor.getBoundingClientRect();
const lineBox = (path) => {
  const b = path.getBBox();
  const o = origin();
  return { left: o.left + b.x, right: o.left + b.x + b.width, top: o.top + b.y, bottom: o.top + b.y + b.height, midX: o.left + b.x + b.width / 2, midY: o.top + b.y + b.height / 2 };
};
const dotAt = (circle) => {
  const o = origin();
  const style = getComputedStyle(circle);
  const edge = style.stroke === 'none' ? 0 : parseFloat(style.strokeWidth) / 2;
  return { x: o.left + circle.cx.baseVal.value, y: o.top + circle.cy.baseVal.value, r: circle.r.baseVal.value + edge };
};
const weight = (path) => parseFloat(getComputedStyle(path).strokeWidth);
// A dot is moved onto the display's pixels, so it can be up to half of one from where the
// clips have it.
const dpr = window.devicePixelRatio;
const SNAP = 0.5 / dpr;

t.equal(decor.querySelectorAll('g[data-vid]').length, Object.keys(editor.groups).length, 'one mark per group');

// --- a word ---------------------------------------------------------------------------------
{
  const el = editor.elementFor('wb3nch1');
  const g = mark('wb3nch1');
  t.equal(g.dataset.scope, 'word', 'word group is drawn as a word');
  const line = g.querySelector('path.line');
  const rect = el.getBoundingClientRect();
  const base = baselineOf(el);
  const at = lineBox(line);
  t.near(at.midY, base + 3.8, 0.45, 'word underline sits 3.8px under the baseline');
  t.near(at.left, rect.left, 1, 'word underline starts with the word');
  t.near(at.right, rect.right, 1.5, 'word underline ends with the word');
  t.near(weight(line), 1.3, 0.01, 'word underline weight');
  const dots = [...g.querySelectorAll('circle.dot')].map(dotAt);
  t.equal(dots.length, 3, 'one dot per variant');
  t.equal([...g.querySelectorAll('circle.dot')].map((d) => d.classList.contains('active')), [true, false, false], 'the showing variant is the filled dot');
  t.near(dots[0].y, base + 7.9, 0.2 + SNAP, 'word dots sit 7.9px under the baseline');
  // Each dot is a 3px disc in a 5px cell; the cells are centred under the word.
  t.near(dots[0].x, rect.left + rect.width / 2 - 7.5 + 1.5, 0.2 + SNAP, 'word dots are centred under the word');
  t.near(dots[1].x - dots[0].x, 5, 0.01, 'dot pitch');
  t.near(dots[2].x - dots[1].x, 5, 0.01, 'dot pitch');
  t.near(dots[0].r * 2, 3, 0.1, 'filled dot diameter');
  t.near(dots[1].r * 2, 3, 0.1, 'ring diameter');
}

// --- a sentence (the heading) ---------------------------------------------------------------
{
  const el = editor.elementFor('t1tle01');
  const g = mark('t1tle01');
  t.equal(g.dataset.scope, 'sentence', 'sentence group is drawn as a sentence');
  const line = g.querySelector('path.line');
  const rect = el.getBoundingClientRect();
  const base = baselineOf(el);
  const at = lineBox(line);
  t.near(at.midY, base + 9.8, 0.45, 'sentence underline sits 9.8px under the baseline');
  t.near(at.left, rect.left, 1, 'sentence underline starts with the text');
  t.near(weight(line), 1.2, 0.01, 'sentence underline weight');
  const dots = [...g.querySelectorAll('circle.dot')].map(dotAt);
  t.equal(dots.length, 3, 'one dot per variant');
  t.near(dots[2].x + 1.5, rect.right - 2, 0.2 + SNAP, 'sentence dots end 2px before the end of the text');
  t.near(dots[1].x - dots[0].x, 5, 0.01, 'dot pitch');
  t.near(dots[0].x - 1.5 - at.right, 2.2, 0.3 + SNAP, 'the line stops short of the dots');
  t.near(dots[0].y, base + 9.05, 0.2 + SNAP, 'sentence dots ride just above the line');
}

// --- a paragraph ----------------------------------------------------------------------------
{
  const el = editor.elementFor('gh0stpa');
  const g = mark('gh0stpa');
  t.equal(g.dataset.scope, 'paragraph', 'paragraph group is drawn as a paragraph');
  const bar = g.querySelector('path.line');
  const rect = el.getBoundingClientRect();
  const first = baselineOf(el);
  const last = lastBaselineOf(el);
  t.assert(last - first >= 36, 'the sample paragraph runs over several lines');
  const at = lineBox(bar);
  t.near(at.midX, rect.left - 19.1, 0.4, 'the bar is 19px left of the text');
  t.near(at.top, first - 18.2, 0.5, 'the bar starts above the first line');
  t.near(at.bottom, last + 3.85, 0.5, 'and ends just under the last');
  t.near(weight(bar), 2, 0.01, 'bar weight');
  const dots = [...g.querySelectorAll('circle.dot')].map(dotAt);
  t.equal(dots.length, 3, 'one dot per variant');
  t.near(dots[0].x, at.midX - 5.65, 0.4 + SNAP, 'dots sit 6px left of the bar');
  t.near((dots[0].y + dots[2].y) / 2, (at.top + at.bottom) / 2 + 0.6, 0.6 + SNAP, 'stacked around the bar’s middle');
  t.near(dots[1].y - dots[0].y, 5, 0.01, 'dot pitch');
  t.assert(g.querySelector('circle.dot').classList.contains('active'), 'top dot is the first variant');
}

// --- dots on the display's own pixels -----------------------------------------------------------
// A dot is three pixels across on an ordinary display. Drawn between pixels it is smeared
// into its neighbours and all but disappears, so each one is seated on whole pixels: its
// edges on pixel edges, and a ring's line at least one pixel thick.
{
  const onGrid = (value) => Math.abs(value * dpr - Math.round(value * dpr)) < 0.02;
  const ring = [108, 104, 121]; // --ring
  await t.until(() => getComputedStyle(decor).opacity === '1', 2000, 'the marks to finish fading in');
  for (const vid of Object.keys(editor.groups)) {
    const circles = [...mark(vid).querySelectorAll('circle.dot')];
    for (const [index, circle] of circles.entries()) {
      const dot = dotAt(circle);
      t.assert(onGrid(dot.x - dot.r) && onGrid(dot.y - dot.r), `${vid} dot ${index} sits on whole pixels: left ${(dot.x - dot.r).toFixed(2)}, top ${(dot.y - dot.r).toFixed(2)}`);
      t.assert(onGrid(dot.r * 2), `${vid} dot ${index} is a whole number of pixels across: ${(dot.r * 2).toFixed(2)}`);
      if (circle.classList.contains('active')) continue;
      t.assert(parseFloat(getComputedStyle(circle).strokeWidth) * dpr >= 0.99, `${vid} ring ${index} is drawn with a line at least a pixel thick`);
    }
    // What is painted: a ring shows its own colour, at full strength, on at least four pixels.
    const hollow = circles.find((circle) => !circle.classList.contains('active'));
    const dot = dotAt(hollow);
    const box = hollow.getBoundingClientRect();
    if (box.top < 110 || box.bottom > innerHeight - 110) continue; // the page fades its edges
    const seen = await t.pixels(dot.x - dot.r, dot.y - dot.r, dot.r * 2, dot.r * 2, { near: ring, within: 36 });
    t.assert(seen.matching >= 4, `${vid}: a ring can be seen, ${seen.matching} of its ${seen.width * seen.height} pixels in its colour`);
  }
}

// A keystroke that moves no mark leaves every mark as it is: nothing in the layer is drawn again.
{
  const drawn = Object.keys(editor.groups).map(mark);
  const last = editor.blocks.length - 1;
  editor.focus();
  editor.select({ block: last, offset: editor.blocks[last].runs.reduce((n, r) => n + r.text.length, 0) });
  await t.type('x');
  await t.settle();
  t.assert(Object.keys(editor.groups).map(mark).every((node, i) => node === drawn[i]), 'typing where it moves no mark draws none of them again');
  await t.key('z', { meta: true });
  await t.settle();
  t.assert(Object.keys(editor.groups).map(mark).every((node, i) => node === drawn[i]), 'nor does taking it back');
  // The page followed the caret down; put it back for what comes next.
  editor.select({ block: 0, offset: 0 });
  document.getElementById('scroll').scrollTop = 0;
  await t.settle();
}

// The same line is drawn the same way every time.
const before = mark('wb3nch1').querySelector('path.line').getAttribute('d');
window.dispatchEvent(new Event('resize'));
await t.settle();
t.equal(mark('wb3nch1').querySelector('path.line').getAttribute('d'), before, 'a mark keeps its shape when redrawn');

// Marks follow the text.
const y0 = lineBox(mark('n3v3rrw').querySelector('path.line')).midY;
editor.select({ block: 0, offset: 0 });
await t.key('Enter');
await t.settle();
t.near(lineBox(mark('n3v3rrw').querySelector('path.line')).midY, y0 + 36, 0.5, 'marks move with their text');
await t.key('z', { meta: true });
await t.settle();
t.near(lineBox(mark('n3v3rrw').querySelector('path.line')).midY, y0, 0.5, 'and back again on undo');

// Showing another variant moves the filled dot.
editor.change('test', (draft) => {
  draft.groups.wb3nch1.active = 2;
});
await t.settle();
t.equal([...mark('wb3nch1').querySelectorAll('circle.dot')].map((d) => d.classList.contains('active')), [false, false, true], 'the filled dot follows the showing variant');
await t.key('z', { meta: true });

// A group that is gone loses its mark.
editor.select({ block: 3, offset: 0 }, { block: 3, offset: 80 });
await t.key('Backspace');
await t.settle();
t.equal(mark('k33ps01'), null, 'a forgotten group has no mark');
await t.key('z', { meta: true });
await t.settle();
t.assert(mark('k33ps01') !== null, 'and gets it back on undo');

// A sentence that runs over two lines is underlined on both, with its dots at the very end.
{
  const text = 'One sentence that is long enough to run over the end of the line and on to a second one.';
  editor.change('test', (draft) => {
    draft.blocks = [...draft.blocks, { kind: 'p', runs: [{ text, vid: 'wr4pped' }] }];
    draft.groups.wr4pped = { scope: 'sentence', variants: [text, 'A shorter one.'], active: 0 };
  });
  await t.settle();
  const el = editor.elementFor('wr4pped');
  el.scrollIntoView({ block: 'center' });
  await t.settle();
  const rects = [...el.getClientRects()];
  t.equal(rects.length, 2, 'the test sentence wraps');
  const g = mark('wr4pped');
  const lines = [...g.querySelectorAll('path.line')].map(lineBox);
  t.equal(lines.length, 2, 'one underline per line of text');
  t.near(lines[0].midY, rects[0].top + (baselineOf(el) - rects[0].top) + 9.8, 0.45, 'first underline under the first line');
  t.near(lines[1].midY - lines[0].midY, 36, 0.5, 'second underline one line lower');
  const dots = [...g.querySelectorAll('circle.dot')].map(dotAt);
  t.near(dots[1].x + 1.5, rects[1].right - 2, 0.2 + SNAP, 'dots at the end of the last line');
  t.near(dots[0].y, lines[1].midY - 0.75, 0.5 + SNAP, 'on the last underline');
  t.near(dots[0].x - 1.5 - lines[1].right, 2.2, 0.3 + SNAP, 'which stops short of them');
  await t.key('z', { meta: true });
  document.getElementById('scroll').scrollTop = 0;
  await t.settle();
}

// Read mode and the alternates toggle hide the marks without forgetting them.
const visible = () => getComputedStyle(decor).visibility !== 'hidden' && Number(getComputedStyle(decor).opacity) > 0.99;
t.assert(visible(), 'marks show with the tools on');
ui.set({ alternates: false });
await t.until(() => !visible(), 1000, 'marks to hide when alternates are off');
ui.set({ alternates: true, read: true });
await t.wait(50);
t.assert(!visible(), 'marks stay hidden in read mode');
ui.set({ read: false });
await t.until(visible, 1000, 'marks to return');

await t.snap('marks');
