// Cycling through alternatives under the pointer (design spec 6.3 and 6.4).
const { editor, ui, alternatives, sound } = window.writeOn;
ui.set({ read: false });
await document.fonts.ready;
await t.settle();

// Listen for the ticks instead of hearing them.
const ticks = [];
sound.tick = (tone) => ticks.push(tone);
const heard = () => ticks.splice(0).join(' ');

const textOf = (i) => editor.blocks[i].runs.map((r) => r.text).join('');
const showing = (vid) => editor.groups[vid].variants[editor.groups[vid].active];
const tints = () => [...document.querySelectorAll('#underlay .tint')];
const baselineOf = (el) => {
  const probe = document.createElement('span');
  probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  el.insertBefore(probe, el.firstChild);
  const y = probe.getBoundingClientRect().top;
  probe.remove();
  return y;
};
const hoverGroup = async (vid) => {
  const r = editor.elementFor(vid).getClientRects()[0];
  await t.hover(r.left + Math.min(20, r.width / 2), r.top + r.height / 2);
};
const away = () => t.hover(300, 500);
const PARA = 3;

// --- a word -----------------------------------------------------------------------------------

t.equal(tints().length, 0, 'nothing is tinted until the pointer is on a group');
await hoverGroup('wb3nch1');
t.equal(alternatives.hovered(), 'wb3nch1', 'the group under the pointer is the hovered one');
{
  const el = editor.elementFor('wb3nch1');
  const rect = el.getBoundingClientRect();
  const base = baselineOf(el);
  const [tint] = tints();
  t.equal(tints().length, 1, 'the hovered word is tinted');
  const box = tint.getBoundingClientRect();
  t.near(box.left, rect.left - 1, 0.3, 'tint starts with the word');
  t.near(box.right, rect.right + 0.5, 0.3, 'tint ends with the word');
  t.near(box.top, base - 20.45, 0.4, 'tint starts at the top of the line of text');
  t.near(box.bottom, base + 9.3, 0.4, 'tint reaches just under the underline');
}

await t.key('ArrowRight');
t.equal(showing('wb3nch1'), 'easel', 'Right shows the next variant');
t.assert(textOf(PARA).endsWith('Think of it as an easel for sentences.'), `the article follows the word: ${textOf(PARA).slice(-40)}`);
t.equal(heard(), 'high', 'a change ticks high');
{
  const caret = editor.selection();
  t.assert(caret.collapsed && caret.start.block === PARA && caret.start.offset === textOf(PARA).indexOf('easel') + 5, 'the caret lands at the end of the swapped text');
  t.equal(document.activeElement, editor.root, 'and the text has the focus');
  const running = editor.elementFor('wb3nch1').getAnimations();
  t.equal(running.length, 1, 'the new text blurs in');
  t.near(running[0].effect.getComputedTiming().duration, 150, 1, 'over 150ms');
  await t.wait(220);
  t.equal(editor.elementFor('wb3nch1').getAnimations().length, 0, 'and then is simply there');
}
t.equal(tints().length, 1, 'the word stays tinted after the swap');
t.near(tints()[0].getBoundingClientRect().right, editor.elementFor('wb3nch1').getBoundingClientRect().right + 0.5, 0.3, 'and the tint fits the new word');

await t.key('ArrowRight');
t.equal(showing('wb3nch1'), 'sketchpad', 'Right again shows the third');
t.assert(textOf(PARA).includes('as a sketchpad for'), 'and the article changes back');
await t.key('ArrowRight');
t.equal(showing('wb3nch1'), 'workbench', 'Right from the last wraps to the first');
t.equal(heard(), 'high low', 'landing back where the playing began ticks low');

await t.key('ArrowLeft');
t.equal(showing('wb3nch1'), 'sketchpad', 'Left from the first wraps to the last');
await t.key('ArrowUp');
t.equal(showing('wb3nch1'), 'easel', 'Up goes back like Left');
await t.key('ArrowDown');
t.equal(showing('wb3nch1'), 'sketchpad', 'Down goes on like Right');
await t.key('ArrowRight');
t.equal(heard(), 'high high high low', 'only the return home is low');

// A pause ends the playing: where you are when you start again is the new home.
await t.key('ArrowRight');
t.equal(showing('wb3nch1'), 'easel', 'on to the second');
await t.wait(1900);
await t.key('ArrowRight');
await t.key('ArrowLeft');
t.equal(showing('wb3nch1'), 'easel', 'out and back after a pause');
t.equal(heard(), 'high high low', 'the variant showing after the pause is home now');

// One undo step takes a burst of presses back; the article comes with it.
await t.key('ArrowRight');
t.assert(textOf(PARA).includes('as a sketchpad for'), 'showing the third again');
heard();
await t.key('z', { meta: true });
t.assert(textOf(PARA).includes('as an easel for') || textOf(PARA).includes('as a workbench for'), `undo steps back through the variants: ${textOf(PARA).slice(-40)}`);
t.equal(showing('wb3nch1'), textOf(PARA).includes('easel') ? 'easel' : 'workbench', 'group and text agree after undo');

// --- the guard against accidents ----------------------------------------------------------------

// Clicking into the word to edit it gives ordinary caret keys.
{
  const r = editor.elementFor('wb3nch1').getClientRects()[0];
  await t.click(r.left + 14, r.top + r.height / 2);
  const before = { shown: showing('wb3nch1'), caret: editor.selection().start.offset };
  await t.key('ArrowRight');
  t.equal(showing('wb3nch1'), before.shown, 'after a click, Right does not swap the word');
  t.equal(editor.selection().start.offset, before.caret + 1, 'it moves the caret');
  t.equal(tints().length, 1, 'the word is still tinted under the pointer');
  // Leaving and coming back arms it again.
  await away();
  t.equal(tints().length, 0, 'the tint goes when the pointer leaves');
  await hoverGroup('wb3nch1');
  await t.key('ArrowRight');
  t.assert(showing('wb3nch1') !== before.shown, 'after the pointer leaves and returns, Right swaps again');
}
// Typing does the same.
{
  await hoverGroup('wb3nch1');
  editor.select({ block: 5, offset: 0 });
  await t.type('x');
  const shown = showing('wb3nch1');
  await t.key('ArrowRight');
  t.equal(showing('wb3nch1'), shown, 'after typing, Right does not swap the word');
  await t.key('z', { meta: true });
  t.assert(textOf(5).startsWith('Click the word count'), `the typing is undone: ${textOf(5).slice(0, 24)}`);
  await away();
}
// With the pointer elsewhere the arrows are the caret's.
{
  editor.select({ block: PARA, offset: 3 });
  const shown = showing('wb3nch1');
  await t.key('ArrowRight');
  t.equal(showing('wb3nch1'), shown, 'no group is hovered, nothing swaps');
  t.equal(editor.selection().start.offset, 4, 'the caret moves');
}
// Shift+arrow is always a selection key.
{
  await hoverGroup('wb3nch1');
  const shown = showing('wb3nch1');
  await t.key('ArrowRight', { shift: true });
  t.equal(showing('wb3nch1'), shown, 'Shift+Right selects; it does not swap');
  // With text selected the arrows are the text's (tests/ui/explode.js has the whole of that);
  // the selection is closed up before the pointer goes to the next word.
  await away();
  await t.key('ArrowLeft');
  t.equal(editor.selection().collapsed, true, 'an arrow closes the selection up');
}
heard();

// --- a sentence -------------------------------------------------------------------------------

await hoverGroup('t1tle01');
{
  const el = editor.elementFor('t1tle01');
  const rect = el.getBoundingClientRect();
  const base = baselineOf(el);
  const box = tints()[0].getBoundingClientRect();
  t.near(box.left, rect.left, 0.3, 'sentence tint starts with the text');
  t.near(box.right, rect.right - 1, 0.3, 'and ends with it');
  t.near(box.bottom, base + 13, 0.4, 'and reaches under the lower underline');
}
await t.key('ArrowRight');
t.equal(textOf(1), 'Say it more than one way', 'the heading shows its next version');
t.equal(editor.blocks[1].kind, 'h', 'and is still a heading');
t.equal(editor.selection().start, { block: 1, offset: 24 }, 'with the caret at its end');
await t.key('ArrowLeft');
t.equal(heard(), 'high low', 'out and home');
await away();

// --- a paragraph ------------------------------------------------------------------------------

{
  const p = editor.elementFor('gh0stpa');
  const index = [...editor.root.children].indexOf(p);
  const r = p.getBoundingClientRect();
  await t.hover(r.left + 200, r.top + r.height / 2);
  t.equal(alternatives.hovered(), 'gh0stpa', 'a paragraph group is hovered anywhere in its block');
  const box = tints()[0].getBoundingClientRect();
  t.equal(tints().length, 1, 'one tint for the whole block');
  t.near(box.left, r.left, 0.3, 'covering the block from its left');
  t.near(box.right, r.right, 0.3, 'to its right');
  t.near(box.top, r.top, 0.3, 'from its top');
  t.near(box.bottom, r.bottom, 0.3, 'to its bottom');
  await t.key('ArrowDown');
  t.assert(textOf(index).startsWith('Unsure about a line?'), 'Down shows the next version of the paragraph');
  t.equal(editor.selection().start, { block: index, offset: textOf(index).length }, 'with the caret at the end of the paragraph');
  const after = editor.elementFor('gh0stpa').getBoundingClientRect();
  t.near(tints()[0].getBoundingClientRect().bottom, after.bottom, 0.3, 'the tint follows the new height');
  await t.key('ArrowUp');
  t.assert(textOf(index).startsWith('Not sure a line belongs?'), 'Up goes back');
  t.equal(heard(), 'high low', 'out and home');
  await t.snap('paragraph-hover');
  await away();
}

// --- modes --------------------------------------------------------------------------------------

// With the marks hidden, behaviour is unchanged.
ui.set({ alternates: false });
await hoverGroup('k33ps01');
await t.key('ArrowRight');
t.equal(showing('k33ps01'), 'remembers', 'cycling still works with the marks hidden');
await t.key('ArrowLeft');
ui.set({ alternates: true });
await away();
heard();

// In read mode there is no hover-cycling.
ui.set({ read: true });
await hoverGroup('k33ps01');
t.equal(tints().length, 0, 'read mode tints nothing');
t.equal(alternatives.hovered(), null, 'and hovers nothing');
await t.key('ArrowRight');
t.equal(showing('k33ps01'), 'keeps', 'and Right does not swap');
t.equal(heard(), '', 'in silence');
ui.set({ read: false });
await away();

// --- through the API ----------------------------------------------------------------------------

t.equal(alternatives.cycle('k33ps01', 1), 1, 'cycle returns the index now showing');
t.equal(showing('k33ps01'), 'remembers', 'and shows it');
t.equal(alternatives.cycle('k33ps01', -1), 0, 'and goes back');
t.equal(alternatives.activate('k33ps01', 2), true, 'activate shows a variant by index');
t.assert(textOf(PARA).includes('This one holds on to the others'), 'a phrase can stand where a word was');
t.equal(alternatives.activate('k33ps01', 2), false, 'activating the one already showing does nothing');
t.equal(alternatives.activate('k33ps01', 7), false, 'nor does an index that is not there');
t.equal(alternatives.activate('nosuchg', 0), false, 'nor a group that is not there');
heard();

// Removing the showing variant shows the next; the last one cannot be removed.
t.equal(alternatives.remove('k33ps01', 2), 'holds on to', 'remove returns what it took out');
t.equal(editor.groups.k33ps01.variants, ['keeps', 'remembers'], 'the variant is gone');
t.equal(showing('k33ps01'), 'remembers', 'the last was showing, so the one before it shows');
t.assert(textOf(PARA).includes('This one remembers the others'), 'in the text too');
t.equal(alternatives.dissolveIfSingle('k33ps01'), false, 'a group with two variants stays a group');
t.equal(alternatives.remove('k33ps01', 0), 'keeps', 'a variant that is not showing can go too');
t.equal(showing('k33ps01'), 'remembers', 'and what shows stays');
t.equal(alternatives.remove('k33ps01', 0), null, 'the only variant left cannot be removed');
t.equal(alternatives.dissolveIfSingle('k33ps01'), true, 'a group left with one variant dissolves');
t.equal(editor.groups.k33ps01, undefined, 'it is no longer a group');
t.assert(textOf(PARA).includes('This one remembers the others'), 'its text stays, as plain text');
t.equal(editor.elementFor('k33ps01'), null, 'with no mark on it');
await t.key('z', { meta: true });
t.equal(editor.groups.k33ps01?.variants, ['keeps', 'remembers'], 'undo takes back the removal that left it alone, and it is a group again');
t.assert(editor.elementFor('k33ps01') !== null, 'marked in the text');

// What a command would act on.
editor.select({ block: 5, offset: 8 });
t.equal(alternatives.target(), { vid: null, scope: 'word', block: 5, start: 6, end: 9, text: 'the' }, 'with no selection, the word at the caret');
t.equal(alternatives.target('sentence').text, 'Click the word count in the top-left corner to turn the tools on.', 'or the sentence around it, when asked');
editor.select({ block: PARA, offset: textOf(PARA).indexOf(showing('wb3nch1')) + 2 });
t.equal(alternatives.target().vid, 'wb3nch1', 'inside a group, that group');
