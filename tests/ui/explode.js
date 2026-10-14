// Deleting the alternative under the pointer blows it up; undo puts it back (design spec
// 6.3 and 6.12). The burst is a function of time, so the scenario can stop the clock and
// look at any moment of it.
const { editor, ui, alternatives, explosions, sound } = window.writeOn;
ui.set({ read: false });
await document.fonts.ready;
await t.wait(250);

const heard = [];
for (const name of ['tick', 'boom', 'thump']) sound[name] = () => heard.push(name);
const sounds = () => heard.splice(0).join(' ');

const canvas = document.getElementById('fx');
const dpr = window.devicePixelRatio;
/** What is painted on the effects layer inside a box given in page pixels. */
function painted(left, top, width, height) {
  const data = canvas.getContext('2d').getImageData(Math.round(left * dpr), Math.round(top * dpr), Math.round(width * dpr), Math.round(height * dpr)).data;
  let count = 0;
  let hot = 0; // bright yellow-white: the heart of the fire
  let warm = 0; // orange and red
  let gray = 0; // smoke
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < 24) continue;
    count += 1;
    if (r > 230 && g > 200 && a > 200) hot += 1;
    else if (r > 180 && r - b > 90) warm += 1;
    else if (Math.abs(r - g) < 45 && Math.abs(g - b) < 45 && a < 120) gray += 1;
  }
  const total = data.length / 4;
  return { any: count / total, hot: hot / total, warm: warm / total, gray: gray / total };
}
const textOf = (i) => editor.blocks[i].runs.map((r) => r.text).join('');
const hoverGroup = async (vid) => {
  const r = editor.elementFor(vid).getClientRects()[0];
  await t.hover(r.left + Math.min(20, r.width / 2), r.top + r.height / 2);
};
const away = () => t.hover(300, 520);
const PARA = 3;

t.equal([canvas.width, canvas.height], [innerWidth * dpr, innerHeight * dpr], 'the effects layer covers the window');
t.equal(getComputedStyle(canvas).pointerEvents, 'none', 'and never takes the pointer');
t.equal(painted(0, 0, innerWidth, innerHeight).any, 0, 'with nothing on it to begin with');

// --- delete under the pointer -------------------------------------------------------------------

await hoverGroup('wb3nch1');
const word = editor.elementFor('wb3nch1').getBoundingClientRect();
const box = { left: word.left, top: word.top, width: word.width, height: word.height };
explosions.seek(0); // stop the clock before anything starts
await t.key('Delete');
t.equal(editor.groups.wb3nch1.variants, ['easel', 'sketchpad'], 'Delete removes the alternative that was showing');
t.assert(textOf(PARA).endsWith('Think of it as an easel for sentences.'), 'the next one shows, article and all');
t.equal(sounds(), 'boom', 'with a boom, and no tick');
t.equal(explosions.active(), 1, 'and a burst');
// The next variant rises under the fire. Its own animation is stepped with the burst's
// clock here, so that each snapshot shows one moment of both.
const rising = editor.elementFor('wb3nch1').getAnimations()[0];
t.near(rising.effect.getComputedTiming().duration, 420, 1, 'the next variant comes up over 420ms');
rising.pause();
const moment = (ms) => {
  explosions.seek(ms);
  rising.currentTime = Math.min(ms, 419);
};

// The moment it goes off: the word, in pieces, where it stood.
{
  const now = painted(box.left, box.top, box.width, box.height);
  t.assert(now.any > 0.08 && now.any < 0.6, `at first the word is there in pieces (${now.any.toFixed(3)})`);
  t.equal(painted(box.left - 200, box.top - 60, 150, 40).any, 0, 'and nothing has flown yet');
  await t.snap('boom-000');
}
// 50 ms: fire along the word.
moment(50);
{
  const fire = painted(box.left - 10, box.top - 6, box.width + 20, box.height + 12);
  t.assert(fire.hot > 0.02, `at 50ms the fire has a white-hot heart (${fire.hot.toFixed(3)})`);
  t.assert(fire.warm > 0.25, `in orange (${fire.warm.toFixed(3)})`);
  const left = painted(box.left, box.top, box.width / 3, box.height);
  const right = painted(box.left + (box.width * 2) / 3, box.top, box.width / 3, box.height);
  t.assert(left.warm > 0.1 && right.warm > 0.1, 'stretched along the whole word');
  await t.snap('boom-050');
}
// 150 ms: at its largest, sparks and pieces well clear of the word.
moment(150);
{
  const fire = painted(box.left - 16, box.top - 14, box.width + 32, box.height + 28);
  t.assert(fire.hot > 0.05, `at 150ms the fire is at its brightest (${fire.hot.toFixed(3)})`);
  const far = painted(box.left - 150, box.top - 110, box.width + 300, 60);
  const beside = painted(box.left - 70, box.top - 20, 50, box.height + 40);
  t.assert(far.any > 0 || beside.any > 0, 'sparks and pieces have left the word');
  t.assert(painted(box.left - 400, box.top, 100, 30).any === 0, 'but not flown across the page');
  await t.snap('boom-150');
}
// 400 ms: the fire is out; smoke and falling embers remain.
moment(400);
{
  const around = painted(box.left - 40, box.top - 60, box.width + 80, box.height + 90);
  t.equal(around.hot, 0, 'by 400ms the fire is out');
  t.assert(around.gray > 0.02, `smoke hangs over the place (${around.gray.toFixed(3)})`);
  t.assert(around.any > 0.03, 'with embers still falling');
  await t.snap('boom-400');
}
// By 1.3 s nothing is left.
explosions.seek(1300);
t.equal(painted(0, 0, innerWidth, innerHeight).any, 0, 'at 1.3s the air is clear');
rising.finish();
explosions.resume();
await t.until(() => explosions.active() === 0, 1000, 'the burst to end');

// The same burst every time: it is seeded by what blew up, not by chance.
{
  explosions.seek(120);
  explosions.burst([{ left: 500, top: 300, right: 620, bottom: 326, text: 'workbench' }]);
  const first = canvas.toDataURL();
  explosions.clear();
  explosions.burst([{ left: 500, top: 300, right: 620, bottom: 326, text: 'workbench' }]);
  t.assert(first === canvas.toDataURL(), 'a burst looks the same each time it is drawn');
  explosions.clear();
  explosions.resume();
}

// --- undo ---------------------------------------------------------------------------------------

explosions.seek(0);
await t.key('z', { meta: true });
t.equal(editor.groups.wb3nch1.variants, ['workbench', 'easel', 'sketchpad'], 'undo brings the alternative back');
t.assert(textOf(PARA).endsWith('Think of it as a workbench for sentences.'), 'showing, with its article');
t.equal(explosions.active(), 1, 'with a burst that runs backward');
{
  // It starts where an explosion ends up, and closes in on the word.
  const el = editor.elementFor('wb3nch1');
  const r = el.getBoundingClientRect();
  t.equal(painted(r.left, r.top, r.width, r.height).hot, 0, 'no fire at the start of it');
  t.assert(painted(r.left - 60, r.top - 70, r.width + 120, r.height + 110).any > 0.02, 'only what an explosion leaves');
  t.assert(Number(getComputedStyle(el).opacity) < 0.05, 'the word is not there yet');
  explosions.seek(150);
  t.assert(painted(r.left - 10, r.top - 6, r.width + 20, r.height + 12).warm > 0.2, 'the fire gathers');
  await t.snap('unboom-150');
  explosions.seek(279);
  const last = painted(r.left, r.top, r.width, r.height);
  t.assert(last.any > 0.08 && last.warm < 0.02, `and at the end the word is there in pieces, the fire gone (${last.any.toFixed(3)}, ${last.warm.toFixed(3)})`);
  explosions.resume();
  await t.until(() => explosions.active() === 0, 1000, 'the reverse burst to end');
  await t.until(() => Number(getComputedStyle(editor.elementFor('wb3nch1')).opacity) === 1 && editor.elementFor('wb3nch1').getAnimations().length === 0, 1500, 'the word to settle');
  t.equal(sounds(), 'thump', 'a thump lands with it');
}

// Redo blows it up again.
await t.key('z', { meta: true, shift: true });
t.equal(editor.groups.wb3nch1.variants, ['easel', 'sketchpad'], 'redo removes it again');
t.equal(sounds(), 'boom', 'with another boom');
await t.key('z', { meta: true });
await t.until(() => explosions.active() === 0, 2500, 'the bursts to end');
await t.wait(300);
sounds();

// --- the guard, and other keys ------------------------------------------------------------------

// Backspace does the same as Delete.
await away();
await hoverGroup('wb3nch1');
await t.key('Backspace');
t.equal(editor.groups.wb3nch1.variants, ['easel', 'sketchpad'], 'Backspace removes the showing alternative too');
t.equal(sounds(), 'boom', 'with a boom');
await t.key('z', { meta: true });
await t.wait(500);
sounds();

// After a click into the word, Delete is an ordinary key.
{
  const r = editor.elementFor('wb3nch1').getClientRects()[0];
  await t.click(r.left + 14, r.top + r.height / 2);
  const before = textOf(PARA);
  await t.key('Backspace');
  t.equal(editor.groups.wb3nch1.variants.length, 3, 'after a click, Backspace does not remove an alternative');
  t.equal(textOf(PARA).length, before.length - 1, 'it deletes a character');
  t.equal(sounds(), '', 'quietly');
  await t.key('z', { meta: true });
  t.equal(textOf(PARA), before, 'which undo restores');
  t.equal(sounds(), '', 'without a thump: that undo was not of a blown-up alternative');
}
// Flipping the word with an arrow is looking through its alternatives again, and Backspace
// then removes the one that shows.
{
  const r = editor.elementFor('wb3nch1').getClientRects()[0];
  await t.click(r.left + 14, r.top + r.height / 2);
  await t.key('ArrowDown');
  const flipped = editor.groups.wb3nch1.variants[editor.groups.wb3nch1.active];
  sounds();
  await t.key('Backspace');
  t.equal(editor.groups.wb3nch1.variants.includes(flipped), false, 'after an arrow has flipped the word, Backspace removes the alternative showing');
  t.equal(sounds(), 'boom', 'with a boom');
  await t.key('z', { meta: true });
  await t.wait(500);
  t.equal(editor.groups.wb3nch1.variants.length, 3, 'undo puts it back');
  sounds();
}
// With a modifier held it is not this command.
await away();
editor.select({ block: 5, offset: 9 }); // in plain words, well away from the word under the pointer
await t.settle();
await hoverGroup('wb3nch1');
await t.key('Backspace', { alt: true });
t.equal(editor.groups.wb3nch1.variants.length, 3, 'Option+Backspace is left alone');
t.equal(textOf(5).startsWith('Click the word'), false, `it deletes a word of the text: ${textOf(5).slice(0, 24)}`);
await t.key('z', { meta: true });
await away();

// With text selected the keys are the text's, whatever the pointer is resting on. (Found in
// review: Backspace blew up the alternative under the pointer and left the selection.)
{
  const LINE = 5; // "Click the word count in the top-left corner…"
  const line = textOf(LINE);
  const showing = editor.groups.wb3nch1.active;

  // A selection made from the keyboard, with the pointer at rest on a word.
  editor.focus();
  editor.select({ block: LINE, offset: 0 });
  await t.settle();
  await hoverGroup('wb3nch1');
  for (let i = 0; i < 5; i++) await t.key('ArrowRight', { shift: true });
  t.equal([editor.selection().collapsed, editor.groups.wb3nch1.active], [false, showing], 'Shift+arrows select in the text and leave the word under the pointer alone');
  await t.key('Backspace');
  t.equal([editor.groups.wb3nch1.variants.length, textOf(LINE)], [3, line.slice(5)], 'Backspace deletes what is selected, not the alternative under the pointer');
  t.equal(sounds(), '', 'quietly');
  // The keyboard is at work in the text now: the next arrow moves the caret.
  await t.key('ArrowRight');
  t.equal([editor.groups.wb3nch1.active, editor.selection().start.offset], [showing, 1], 'and the arrow after that moves the caret');
  await t.key('z', { meta: true });
  t.equal(textOf(LINE), line, 'undo restores the line');

  // A selection made first, and the pointer brought to rest on a word afterward.
  editor.select({ block: LINE, offset: 6 }, { block: LINE, offset: 9 });
  await t.settle();
  await away();
  await hoverGroup('wb3nch1');
  await t.key('ArrowRight');
  t.equal([editor.groups.wb3nch1.active, editor.selection().collapsed], [showing, true], 'an arrow closes the selection up and does not flip the word');
  editor.select({ block: LINE, offset: 6 }, { block: LINE, offset: 9 });
  await t.settle();
  await away();
  await hoverGroup('wb3nch1');
  await t.key('Delete');
  t.equal([editor.groups.wb3nch1.variants.length, textOf(LINE)], [3, line.slice(0, 6) + line.slice(9)], 'and Delete deletes what is selected');
  t.equal(sounds(), '', 'quietly');
  await t.key('z', { meta: true });
  t.equal(textOf(LINE), line, 'which undo restores');

  // It takes the pointer coming back onto the word for the keys to be the word's again.
  await t.key('ArrowLeft');
  await away();
  await hoverGroup('wb3nch1');
  await t.key('ArrowRight');
  t.assert(editor.groups.wb3nch1.active !== showing, 'the pointer coming back onto the word gives it the keys again');
  await t.key('ArrowLeft');
  t.equal(editor.groups.wb3nch1.active, showing, 'both ways');
  sounds();
  await away();
}

// --- the last pair ------------------------------------------------------------------------------

// A group of two: blowing up one leaves plain text, and undo makes it a group again.
editor.change('test', (draft) => {
  draft.groups.k33ps01.variants = ['keeps', 'remembers'];
});
await t.settle();
await hoverGroup('k33ps01');
await t.key('Delete');
t.equal(editor.groups.k33ps01, undefined, 'removing one of two leaves no group');
t.assert(textOf(PARA).includes('This one remembers the others'), 'just the other one, as plain text');
t.equal(alternatives.hovered(), null, 'and nothing is hovered any more');
t.equal(sounds(), 'boom', 'it still goes with a boom');
await t.key('Delete');
t.equal(sounds(), '', 'Delete with nothing hovered is an ordinary key');
await t.key('z', { meta: true }); // that deletion
await t.key('z', { meta: true }); // the blown-up alternative
t.equal(editor.groups.k33ps01?.variants, ['keeps', 'remembers'], 'undo makes it a group of two again');
await t.wait(200);
t.equal(sounds(), 'thump', 'with the thump');
await t.until(() => explosions.active() === 0, 2500, 'the bursts to end');

// --- a paragraph --------------------------------------------------------------------------------

{
  const p = editor.elementFor('gh0stpa');
  const index = [...editor.root.children].indexOf(p);
  const r = p.getBoundingClientRect();
  await t.hover(r.left + 200, r.top + r.height / 2);
  explosions.seek(60);
  await t.key('Delete');
  t.equal(editor.groups.gh0stpa.variants.length, 2, 'a paragraph alternative can be blown up too');
  t.assert(textOf(index).startsWith('Unsure about a line?'), 'and the next one shows');
  const top = painted(r.left, r.top, r.width, 36);
  const bottom = painted(r.left, r.bottom - 36, r.width, 36);
  t.assert(top.warm > 0.05 && bottom.warm > 0.05, 'the fire runs over every line of it');
  await t.snap('boom-paragraph');
  explosions.resume();
  await t.key('z', { meta: true });
  await t.wait(200);
  sounds();
}

// --- read mode ----------------------------------------------------------------------------------

await t.until(() => explosions.active() === 0, 2500, 'the bursts to end');
ui.set({ read: true });
await hoverGroup('wb3nch1');
await t.key('Delete');
t.equal(editor.groups.wb3nch1.variants.length, 3, 'in read mode Delete blows nothing up');
t.equal(sounds(), '', 'in silence');
t.equal(explosions.active(), 0, 'no burst');
