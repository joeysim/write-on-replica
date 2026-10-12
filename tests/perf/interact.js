// How long the app's own gestures take to show: the tint under the pointer, flipping a
// word, moving the caret, Return, the panel, the page scrolling. On the welcome piece and
// on a long one. Each time is from the event reaching the page to the end of the frame
// that shows its effect, in milliseconds (see `follow` in _pieces.js).
const { editor, ui } = window.writeOn;
const pieces = window.__pieces;
ui.set({ read: false });
await document.fonts.ready;
await t.settle();
await t.wait(300);

const pause = (ms) => t.wait(ms + Math.floor(Math.random() * 40));
/** The gaps between animation frames while `during` runs, with the count of long ones. */
async function frames(during) {
  const stamps = [];
  let going = true;
  const tick = (stamp) => { stamps.push(stamp); if (going) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  await during();
  going = false;
  await t.frame();
  const gaps = stamps.slice(1).map((stamp, i) => stamp - stamps[i]);
  return { ...pieces.spread(gaps), over25ms: gaps.filter((gap) => gap > 25).length };
}
/** `press(i)` done `n` times, `gap` ms apart; how long each took to show. */
async function gesture(type, n, gap, press) {
  const stop = pieces.follow(type);
  for (let i = 0; i < n; i++) {
    await pause(gap);
    await press(i);
  }
  await t.wait(120);
  return stop().done;
}

for (const words of (window.__benchSizes ?? [0, 20000])) {
  if (words > 0) editor.setState(pieces.make(words).state);
  await t.settle();
  const row = { words: words || 'welcome', blocks: editor.blocks.length, groups: Object.keys(editor.groups).length };

  // A word with alternatives, on screen.
  const all = Object.keys(editor.groups).filter((id) => editor.groups[id].scope === 'word');
  const vid = all[Math.floor(all.length / 2)];
  editor.elementFor(vid).scrollIntoView({ block: 'center' });
  await t.settle();
  const box = () => editor.elementFor(vid).getClientRects()[0];

  // The tint: the pointer comes onto the word, and leaves it.
  row.tint = await gesture('mousemove', 60, 60, (i) => (i % 2
    ? t.call('test.mouse', { type: 'move', x: box().left - 60, y: box().top + 80 })
    : t.call('test.mouse', { type: 'move', x: box().left + 8 + (i % 5), y: box().top + 18 })));
  await t.call('test.mouse', { type: 'move', x: box().left + 10, y: box().top + 18 });

  // Flipping it with the arrows, at a person's pace and as fast as a held key repeats.
  row.flip = await gesture('keydown', 50, 280, (i) => t.call('test.key', { key: i % 2 ? 'ArrowUp' : 'ArrowDown' }));
  row.flipHeld = await gesture('keydown', 50, 30, (i) => t.call('test.key', { key: i % 2 ? 'ArrowUp' : 'ArrowDown' }));
  await t.wait(300);
  await t.call('test.mouse', { type: 'move', x: 200, y: 600 });

  // Moving the caret, and Return and Backspace, which the document does itself.
  const at = editor.blocks.findIndex((block, index) => index >= editor.blocks.length / 2 && block.kind === 'p' && block.runs.length === 1);
  editor.blockElement(at).scrollIntoView({ block: 'center' });
  editor.focus();
  editor.select({ block: at, offset: 30 });
  await t.settle();
  row.caret = await gesture('keydown', 60, 40, (i) => t.call('test.key', { key: i % 2 ? 'ArrowLeft' : 'ArrowRight' }));
  row.returnAndJoin = await gesture('keydown', 60, 60, (i) => t.call('test.key', { key: i % 2 ? 'Backspace' : 'Enter' }));

  // The panel sliding in and out: is every frame of it drawn?
  editor.select({ block: at, offset: 30 });
  await t.settle();
  row.panelOpen = await frames(async () => { await t.call('test.key', { key: 'a', ctrl: true, shift: true }); await t.wait(320); });
  row.panelShut = await frames(async () => { await t.call('test.key', { key: 'Escape' }); await t.wait(320); });

  // The page scrolling by itself, most of a screenful and back in half a second.
  const scroller = document.getElementById('scroll');
  const from = scroller.scrollTop;
  row.scroll = await frames(async () => {
    const start = performance.now();
    for (;;) {
      const k = Math.min(1, (performance.now() - start) / 500);
      scroller.scrollTop = from + (k < 0.5 ? k * 2 : (1 - k) * 2) * 700;
      if (k >= 1) break;
      await t.frame();
    }
  });
  scroller.scrollTop = from;

  t.log(JSON.stringify(row));
}
