// launch: --setting welcomed=true
// A new document (design spec 6.11). The welcome piece is shown once, the first time the app
// is opened; this run starts as every launch after that does, on a blank page.
const { editor, ui } = window.writeOn;
await document.fonts.ready;

const shell = () => t.call('test.shell');
const asked = async () => (await t.call('test.dialogs')).asked.map((d) => [d.kind, d.name]);

t.equal(editor.getState(), { html: '<p><br></p>', groups: {}, overflow: '' }, 'a blank page');
t.equal(document.getElementById('wordcount').textContent, '0 words 0 chars', 'with nothing to count');
{
  const s = await shell();
  t.equal([s.file, s.dirty, s.title, s.drafts.length], [null, false, 'Untitled', 0], 'called Untitled, with nothing to save');
}

// Typing can start at once, and the first thing typed makes it a document with something to save.
ui.set({ read: false });
editor.focus();
await t.type('# Notes');
await t.key('Enter');
await t.type('First line.');
t.equal(editor.getState().html, '<p># Notes</p><p>First line.</p>', 'what is typed is the document');
{
  const s = await t.until(async () => (await shell()).title === 'Notes' && shell(), 2500, 'the window to take the heading for its name');
  t.equal([s?.dirty, s?.edited], [true, true], 'and it is unsaved');
}
await t.call('test.dialogs', { answers: [{ save: 'notes.md' }] });
await t.key('s', { ctrl: true });
await t.until(async () => (await shell()).file === 'notes.md', 2500, 'it to be saved');
t.equal(await asked(), [['save', 'Notes.md']], 'under the name of its heading, unless another is given');
t.equal((await t.call('test.readFile', { name: 'notes.md' })).text, '# Notes\nFirst line.\n', 'as plain Markdown, nothing added');
