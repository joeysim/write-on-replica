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

// With no caret anywhere, as in the clip's first flip.
getSelection().removeAllRanges();
document.activeElement?.blur?.();
await t.settle();
await t.key('ArrowRight');
t.equal(showing('wb3nch1'), 'easel', 'Right shows the next variant');
t.assert(textOf(PARA).endsWith('Think of it as an easel for sentences.'), `the article follows the word: ${textOf(PARA).slice(-40)}`);
t.equal(heard(), 'high', 'a change ticks high');
{
  const caret = editor.selection();
  t.assert(caret.collapsed && caret.start.block === PARA && caret.start.offset === textOf(PARA).indexOf('easel') + 5, 'with no caret in the text before, it lands at the end of the swapped text');
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

// Which variant shows is not something to undo. In the clip three versions are tried after
// a batch of suggestions, and one undo then takes the whole batch away: the trying was no
// step of its own.
await t.key('ArrowRight');
t.assert(textOf(PARA).includes('as a sketchpad for'), 'showing the third again');
heard();
t.equal(editor.canUndo, false, 'flipping through the versions leaves nothing to undo');
await t.key('z', { meta: true });
t.assert(textOf(PARA).includes('as a sketchpad for'), 'and undo leaves the version that is showing');

// Where the caret is afterward. In the group, it goes to the end of the new text; anywhere
// else it stays among the words it was in (in the clip, eight flips of one word leave the
// caret resting in another word of the same paragraph).
{
  const at = (word) => textOf(PARA).indexOf(word);
  const flip = async () => { await hoverGroup('wb3nch1'); await t.key('ArrowRight'); };
  t.equal(showing('wb3nch1'), 'sketchpad', 'the third version is showing');

  editor.select({ block: PARA, offset: at('sketchpad') + 3 });
  await t.settle();
  await flip();
  t.equal([showing('wb3nch1'), editor.selection().start], ['workbench', { block: PARA, offset: at('workbench') + 9 }], 'a caret inside the word goes to the end of the new one');

  editor.select({ block: PARA, offset: at('sentences') + 4 });
  await t.settle();
  await flip();
  t.equal([showing('wb3nch1'), editor.selection().start], ['easel', { block: PARA, offset: at('sentences') + 4 }], 'a caret later in the paragraph stays in its word, though the text before it changed length');

  editor.select({ block: PARA, offset: at('paragraph') + 2 });
  await t.settle();
  await flip();
  t.equal([showing('wb3nch1'), editor.selection().start], ['sketchpad', { block: PARA, offset: at('paragraph') + 2 }], 'a caret earlier in the paragraph stays where it was');

  editor.select({ block: 5, offset: 7 });
  await t.settle();
  await flip();
  t.equal([showing('wb3nch1'), editor.selection().start], ['workbench', { block: 5, offset: 7 }], 'and so does one in another paragraph');
  t.equal(document.activeElement, editor.root, 'with the keyboard still in the text');
  alternatives.activate('wb3nch1', 2);
  await away();
  heard();
}

// --- whose the arrow keys are ---------------------------------------------------------------------

// The text can change under a pointer at rest: a shorter variant leaves the pointer beside
// the word. The keys stay the word's until the pointer itself moves.
{
  await away();
  alternatives.activate('wb3nch1', 0);
  await t.settle();
  heard();
  const r = editor.elementFor('wb3nch1').getClientRects()[0];
  t.equal(showing('wb3nch1'), 'workbench', 'starting from the longest');
  await t.hover(r.right - 6, r.top + r.height / 2);
  await t.key('ArrowRight');
  t.equal(showing('wb3nch1'), 'easel', 'Right from the end of the long word shows the short one');
  t.assert(editor.elementFor('wb3nch1').getClientRects()[0].right < r.right - 6, 'which ends before the pointer');
  await t.wait(300);
  await t.key('ArrowRight');
  t.equal(showing('wb3nch1'), 'sketchpad', 'and Right goes on swapping');
  await t.key('ArrowRight');
  t.equal(showing('wb3nch1'), 'workbench', 'round to the first');
  await away();
}
// A click on the word leaves the arrows the word's: the pointer is still on it.
{
  const r = editor.elementFor('wb3nch1').getClientRects()[0];
  await t.click(r.left + 14, r.top + r.height / 2);
  const before = showing('wb3nch1');
  t.equal(tints().length, 1, 'the clicked word is tinted');
  await t.key('ArrowDown');
  t.assert(showing('wb3nch1') !== before, 'after a click on the word, Down still swaps it');
  await t.key('ArrowUp');
  t.equal(showing('wb3nch1'), before, 'and Up swaps it back');
  await away();
  t.equal(tints().length, 0, 'the tint goes when the pointer leaves');
}
// Typing gives the arrows back to the caret, and the tint goes, until the pointer moves.
{
  await hoverGroup('wb3nch1');
  editor.select({ block: 5, offset: 0 });
  await t.type('x');
  t.equal(tints().length, 0, 'typing takes the tint away');
  t.equal(alternatives.armed(), false, 'and the keys from the word');
  const shown = showing('wb3nch1');
  await t.key('ArrowRight');
  t.equal(showing('wb3nch1'), shown, 'after typing, Right does not swap the word');
  t.equal(editor.selection().start, { block: 5, offset: 2 }, 'it moves the caret');
  // The smallest move of the pointer, still on the word, gives them back.
  const r = editor.elementFor('wb3nch1').getClientRects()[0];
  await t.hover(r.left + Math.min(20, r.width / 2) + 2, r.top + r.height / 2 + 1);
  t.equal(tints().length, 1, 'a move of the pointer on the word tints it again');
  await t.key('ArrowRight');
  t.assert(showing('wb3nch1') !== shown, 'and Right swaps again');
  await t.key('z', { meta: true });
  await t.key('z', { meta: true });
  t.equal(showing('wb3nch1'), shown, 'undo takes the swap back');
  t.assert(textOf(5).startsWith('Click the word count'), `and the typing: ${textOf(5).slice(0, 24)}`);
  await away();
}
// The page can scroll under a pointer at rest. What was under it is no longer, and what
// comes under it has not been pointed at: the arrows are the caret's until the pointer moves.
{
  const scroller = document.getElementById('scroll');
  const group = () => editor.elementFor('k33ps01').getClientRects()[0];
  const at = [group().left + 10, group().top + 18];
  await t.hover(...at);
  t.equal([alternatives.hovered(), tints().length], ['k33ps01', 1], 'the pointer is on a word');
  // As when the caret is walked down the page and the page follows it.
  scroller.scrollTop += 108;
  await t.until(() => alternatives.hovered() === null, 1500, 'the word that scrolled away to stop being the hovered one');
  await t.settle();
  t.equal(tints().length, 0, 'its tint goes with it');
  const shown = showing('k33ps01');
  editor.select({ block: 5, offset: 3 });
  await t.key('ArrowRight');
  t.equal([showing('k33ps01'), editor.selection().start.offset], [shown, 4], 'and the arrows are the caret’s');
  scroller.scrollTop -= 108;
  await t.until(() => alternatives.hovered() === 'k33ps01', 1500, 'the word that scrolled back under the pointer to be the hovered one');
  await t.settle();
  t.equal([alternatives.armed(), tints().length], [false, 0], 'but it was not pointed at: no tint, and the keys are not its own');
  await t.key('ArrowRight');
  t.equal([showing('k33ps01'), editor.selection().start.offset], [shown, 5], 'the arrow still moves the caret');
  await t.hover(at[0] + 2, at[1]);
  t.equal([alternatives.armed(), tints().length], [true, 1], 'until the pointer moves on it');
  await away();

  // Scrolled with the pointer's own wheel, the word that arrives under it is pointed at.
  const below = editor.elementFor('wb3nch1').getClientRects()[0];
  const over = [below.left + 10, below.top + 18];
  await t.hover(over[0], over[1] - 108); // three lines above the word, on plain text
  t.equal(alternatives.hovered(), null, 'the pointer is on plain text, three lines above a word');
  await t.wheel(over[0], over[1] - 108, 108);
  await t.until(() => alternatives.hovered() === 'wb3nch1', 1500, 'the wheel to bring the word under the pointer');
  await t.settle();
  t.equal([alternatives.armed(), tints().length], [true, 1], 'and with the wheel that is pointing at it: it is tinted, and the arrows are its own');
  await t.wheel(over[0], over[1] - 108, -108);
  await t.until(() => scroller.scrollTop === 0, 1500, 'the wheel to bring the page back');
  await away();
  heard();
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
  t.equal(tints().length, 0, 'and the keyboard has the keys now: the tint goes');
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
editor.select({ block: 1, offset: 5 }); // a caret in the heading, as after a click on it
await t.settle();
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
  editor.select({ block: index, offset: 12 }); // a caret in the paragraph, as after a click in it
  await t.settle();
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

// With the marks hidden, behavior is unchanged.
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
