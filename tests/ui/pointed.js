// What the Alternatives shortcuts act on (design spec 6.5). They go by the caret or the
// selection, as in the clip, where the pointer rests on one word, the caret is in another, and
// the panel opens on the caret's. When the caret is on no word (a window just opened has it
// on the blank first line), or the text has no caret at all (the keyboard is somewhere else),
// they go by the pointer: the group, or the word, it is resting on. (Reported from the first
// real use: with the pointer on an underlined word and no caret in a word, the shortcut did
// nothing.)
const { editor, ui } = window.writeOn;
ui.set({ read: false });
await document.fonts.ready;
await t.wait(200);

const rows = () => [...document.querySelectorAll('#panel .row .text')].map((row) => row.textContent);
const group = () => editor.elementFor('k33ps01').getClientRects()[0];
const onGroup = () => t.hover(group().left + 10, group().top + 18);
const shut = async () => {
  await t.key('Escape');
  await t.until(() => !ui.get('panel'), 1500, 'the panel to close');
};
/** As when the keyboard is not in the text: no caret, no selection. */
const noCaret = async () => {
  getSelection().removeAllRanges();
  document.activeElement?.blur?.();
  await t.settle();
};

t.equal(editor.selection()?.start, { block: 0, offset: 0 }, 'in a window just opened the caret is on the blank first line, on no word');

// The pointer on a word that has alternatives.
await onGroup();
await t.key('a', { ctrl: true, shift: true });
await t.until(() => ui.get('panel'), 1500, 'Ctrl+Shift+A to open the panel on the word under the pointer');
t.equal(rows(), ['keeps', 'remembers', 'holds on to'], 'with its alternatives');
await shut();

// The same with no caret in the text at all.
await noCaret();
await onGroup();
await t.key('a', { ctrl: true, shift: true });
await t.until(() => ui.get('panel'), 1500, 'Ctrl+Shift+A to open the panel on the word under the pointer, with no caret');
t.equal(rows(), ['keeps', 'remembers', 'holds on to'], 'with its alternatives');
await shut();

// The pointer on a plain word.
await noCaret();
await t.hover(...t.pointOfText('writing'));
await t.key('a', { ctrl: true, shift: true });
await t.until(() => ui.get('panel'), 1500, 'Ctrl+Shift+A to open the panel on a plain word under the pointer');
t.equal(rows(), ['writing', ''], 'ready for its first alternative');
await shut();

// The pointer beside the text, on no word: there is nothing to act on.
await noCaret();
{
  const line = t.rangeOfText('for sentences.').getClientRects()[0];
  const paragraph = editor.blockElement(3).getBoundingClientRect();
  t.assert(paragraph.right - line.right > 200, 'the last line of the paragraph stops well short of the column');
  await t.hover(paragraph.right - 30, line.top + line.height / 2);
  await t.key('a', { ctrl: true, shift: true });
  await t.wait(200);
  t.equal(ui.get('panel'), false, 'beside a line, on no word, the shortcut has nothing to act on');
}

// With a caret in the text the caret says, whatever the pointer is on: as in the clip.
await t.click(...t.pointOfText('writing'));
await onGroup();
await t.key('a', { ctrl: true, shift: true });
await t.until(() => ui.get('panel'), 1500, 'Ctrl+Shift+A to open the panel');
t.equal(rows(), ['writing', ''], 'with a caret in the text, the panel opens on the caret’s word, not the pointer’s');
await shut();

// A selection that cannot be a target (it runs across paragraphs) is still what was meant.
editor.select({ block: 3, offset: 5 }, { block: 5, offset: 5 });
await t.settle();
await onGroup();
await t.key('a', { ctrl: true, shift: true });
await t.wait(200);
t.equal(ui.get('panel'), false, 'a selection the command cannot use is not passed over for the pointer');

// AI alternatives go by the same rule.
await noCaret();
await t.call('test.ai', { set: { chunks: ['retains\n', 'holds\n', 'saves\n', 'stores\n', 'guards\n'], firstMs: 40, everyMs: 20 } });
await onGroup();
await t.key('g', { ctrl: true, shift: true });
await t.until(() => ui.get('panel') && editor.groups.k33ps01.variants.length === 8, 4000, 'Ctrl+Shift+G to ask about the word under the pointer');
t.equal(editor.groups.k33ps01.variants.slice(3), ['retains', 'holds', 'saves', 'stores', 'guards'], 'and its suggestions to arrive');
