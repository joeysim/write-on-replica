// Files the app did not write, or that something else has been at (design spec 6.11 and 8).
// They open with what can be read, and a line by the Open icon says what could not.
const { editor, ui, files } = window.writeOn;
ui.set({ read: false });
await document.fonts.ready;

const $ = (s) => document.querySelector(s);
const shell = () => t.call('test.shell');
const bytes64 = (bytes) => btoa(String.fromCharCode(...bytes));
const base64 = (text) => bytes64(new TextEncoder().encode(text));
const tip = $('#tooltip');
const note = async () => {
  await t.until(() => Number(getComputedStyle(tip).opacity) > 0.99, 1500, 'a note to show');
  return [tip.textContent, tip.classList.contains('is-note')];
};

// The app tells the system it edits Markdown files, without putting itself forward as the
// one to open them all with.
t.equal((await shell()).opens.map((kind) => [kind.types, kind.role, kind.rank]), [[['net.daringfireball.markdown'], 'Editor', 'Alternate']], 'the kind of file the app opens');

// A file whose record of alternatives is cut short: the text opens, and a note says the rest could not.
const DAMAGED = '# Half a record\n\nThe text is all here.\n\n<!-- write_on {"version":1,"html":"<p># Half a record</p><p><br></p><p>The text is all <span data-vid=\\"cutsh0rt\\">he';
await t.writeFile('damaged.md', base64(DAMAGED));
await t.call('test.dialogs', { answers: [{ open: ['damaged.md'] }] });
await t.key('o', { ctrl: true });
await t.until(() => editor.getState().html.includes('Half a record'), 2500, 'the damaged file to open');
t.equal(editor.getState(), { html: '<p># Half a record</p><p><br></p><p>The text is all here.</p>', groups: {}, overflow: '' }, 'it opens as the plain text it still is');
t.equal(await note(), ['The alternatives saved in this file could not be read. The text is intact.', true], 'and says what was lost');
{
  const at = tip.getBoundingClientRect();
  const icon = $('#open').getBoundingClientRect();
  t.assert(at.bottom <= icon.top && at.left >= 12, 'by the Open icon');
  await t.snap('damaged');
}
{
  const s = await shell();
  t.equal([s.file, s.dirty, $('#save').classList.contains('is-on')], ['damaged.md', false, false], 'nothing is unsaved');
  t.same((await t.call('test.readFile', { name: 'damaged.md' })).text ?? '', DAMAGED, 'and the file is not touched until it is saved');
}
await t.click(700, 500);

// A file whose text was changed in another editor: the text wins, and what still fits is kept.
files.show({
  kind: 'file',
  name: 'edited.md',
  text:
    '# Edited elsewhere\n\nA new first line. The second keeps its word.\n\n' +
    '<!-- write_on {"version":1,"html":"<p># Edited elsewhere</p><p><br></p><p>An <span data-vid=\\"g0ne001\\">old</span> first line. The second keeps its <span data-vid=\\"st4ys01\\">word</span>.</p>",' +
    '"groups":{"g0ne001":{"scope":"word","variants":["old","aged"],"active":0},"st4ys01":{"scope":"word","variants":["word","term"],"active":0}}} -->\n',
});
await t.settle();
t.equal(Object.keys(editor.groups), ['st4ys01'], 'a group whose word is still there is kept, and one whose word is gone is not');
t.equal(await note(), ['The text was changed outside Write_On, so it was read as it is now. 1 of 2 alternatives were kept.', true], 'a note says so');
await t.click(700, 500);
await t.until(() => Number(getComputedStyle(tip).opacity) < 0.01, 1500, 'a press to put the note away');

// A file read whole has nothing to say.
files.show({ kind: 'file', name: 'whole.md', text: '# Whole\n\nNothing wrong here.\n' });
await t.settle();
await t.wait(300);
t.assert(Number(getComputedStyle(tip).opacity) < 0.01, 'a file read whole opens without a note');

// Text that is not UTF-8 is still read, never refused: one that says what it is, and one that does not.
await t.writeFile('utf16.md', bytes64([0xff, 0xfe, ...[...'Café ñ'].flatMap((ch) => [ch.charCodeAt(0) & 0xff, ch.charCodeAt(0) >> 8])]));
await t.writeFile('latin1.md', bytes64([0x43, 0x61, 0x66, 0xe9, 0x20, 0xf1]));
t.equal((await t.call('test.readFile', { name: 'utf16.md', asTheAppDoes: true })).text, 'Café ñ', 'UTF-16 with its mark is read as it is');
t.equal((await t.call('test.readFile', { name: 'latin1.md', asTheAppDoes: true })).text, 'Café ñ', 'bytes that are not UTF-8 are read as Latin-1');
