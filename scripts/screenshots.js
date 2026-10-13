// The README's pictures, taken by scripts/screenshots.sh the way a scenario is run.
const { editor, ui } = window.writeOn;
ui.set({ read: false });
await document.fonts.ready;
await t.wait(400);

// The welcome piece with the tools on, and the pointer resting on a word that has
// alternatives, so that its tint shows.
const group = () => editor.elementFor('k33ps01').getClientRects()[0];
await t.hover(group().left + 10, group().top + 18);
await t.wait(200);
await t.snap('tools');

// The same with the panel open on that word. The caret is on the blank first line, on no
// word, so the shortcut goes by the pointer.
await t.key('a', { ctrl: true, shift: true });
await t.until(() => ui.get('panel'), 2000, 'the panel to open');
await t.wait(900); // the slide, and the page dimming around the paragraph
await t.snap('panel');
