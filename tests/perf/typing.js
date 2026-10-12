// How long a typed character takes to reach the screen, in documents of several sizes.
//
// `frame` is from the key being sent to WebKit having presented the frame that shows the
// letter, by the app's clock: the keystroke crossing to the page, the page's own work,
// layout and painting, and the result crossing back. That is the last step before the
// window server, and the point tests/perf/native-baseline.swift measures to as well.
// `handlers` is the page's own work inside that: everything between `beforeinput` and the
// end of `input`. `drawing` is what the page does at the next animation frame (the marks).
const { editor, ui } = window.writeOn;
const pieces = window.__pieces;
ui.set({ read: false });
await document.fonts.ready;
await t.settle();

// The clock here ticks once a millisecond, so one reading says little; the total over many
// keystrokes is good to a few hundredths.
let handlers = 0;
let drawing = 0;
let began = 0;
window.addEventListener('beforeinput', () => { began = performance.now(); }, true);
window.addEventListener('input', () => { handlers += performance.now() - began; });
const frame = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (callback) => frame((stamp) => {
  const from = performance.now();
  callback(stamp);
  drawing += performance.now() - from;
});

const KEYS = 'etaoinshrdlucmfwypvbgkq';
const SIZES = (window.__benchSizes ?? [0, 1000, 5000, 20000, 50000]);
const results = [];
for (const words of SIZES) {
  let made = null;
  if (words > 0) {
    made = pieces.make(words);
    editor.setState(made.state);
  }
  const blocks = editor.blocks.length;
  // Type in the middle of the piece, in the middle of a line, with that line on screen.
  const middle = Math.max(1, Math.floor(blocks / 2));
  const at = editor.blocks.findIndex((block, index) => index >= middle && block.kind === 'p' && block.runs.length === 1);
  editor.blockElement(at).scrollIntoView({ block: 'center' });
  editor.focus();
  editor.select({ block: at, offset: 40 });
  await t.settle();
  await t.wait(300);

  // A few to warm up, then the ones that count.
  for (let i = 0; i < 10; i++) await t.call('test.timed', { key: KEYS[i % KEYS.length] });
  handlers = 0;
  drawing = 0;
  const frames = [];
  const N = 120;
  for (let i = 0; i < N; i++) {
    await t.wait(20 + Math.floor(Math.random() * 30)); // at no fixed point in WebKit's frame
    const { ms } = await t.call('test.timed', { key: i % 7 === 6 ? ' ' : KEYS[i % KEYS.length] });
    frames.push(ms);
  }
  await t.settle();
  const row = {
    words: words || 'welcome',
    blocks,
    groups: Object.keys(editor.groups).length,
    frame: pieces.spread(frames),
    handlers: Math.round((handlers / N) * 100) / 100,
    drawing: Math.round((drawing / N) * 100) / 100,
  };
  results.push(row);
  t.log(JSON.stringify(row));
}
await t.writeFile('typing.json', btoa(JSON.stringify(results)));
