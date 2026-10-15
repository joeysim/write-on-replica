// Files (design spec 6.11): saving, opening, the mark of unsaved changes, the copy kept
// against a crash, and being asked before changes are lost. A scripted run shows no panel
// and no alert: it answers them itself (test.dialogs), in a folder of its own.
const { editor, ui, commands } = window.writeOn;
const { serialize } = await import('./src/doc/format.js');
ui.set({ read: false });
await document.fonts.ready;

const $ = (s) => document.querySelector(s);
const shell = () => t.call('test.shell');
// What the shell has asked or told the person so far, each as [kind, name or message].
const asked = async () => (await t.call('test.dialogs')).asked.map((d) => [d.kind, d.name ?? d.message ?? null, d.detail ?? null]);
const answer = (...answers) => t.call('test.dialogs', { answers });
const onDisk = async (name) => (await t.call('test.readFile', { name })).text;
const base64 = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
const unsaved = () => $('#save').classList.contains('is-on');
const told = (check, what, ms = 2500) => t.until(async () => check(await shell()), ms, what);
const KEPT_MS = 5000; // unsaved work is copied aside within a few seconds
const asIs = () => serialize(editor.getState());
const typeAt = async (block, offset, text) => {
  editor.focus();
  editor.select({ block, offset });
  await t.settle();
  await t.type(text);
};

// --- a window as it opens -------------------------------------------------------------------------

{
  const s = await shell();
  t.equal([s.file, s.dirty, s.edited, s.title], [null, false, false, 'Write it more than one way'], 'a new window has no file and nothing to save, and is called by its heading');
  t.equal([unsaved(), s.drafts.length, s.recents.length, s.windows.length], [false, 0, 0, 0], 'the Save icon is dim; nothing is kept anywhere');
}

// The shell hears of a change at once. The Save icon follows what the document says a
// moment after the last change (0.42 s in the clips), fading over 0.13 s.
{
  editor.focus();
  editor.select({ block: 5, offset: 0 });
  await t.settle();
  const from = performance.now();
  await t.call('test.key', { key: 'S', shift: true });
  await t.frame();
  t.equal([unsaved(), (await shell()).dirty], [false, true], 'a change does not light the Save icon at once, though the shell knows already');
  await t.until(() => unsaved(), 1500, 'the change to light the Save icon');
  t.near(performance.now() - from, 420, 90, 'about 0.42 s after the change');
  t.equal(getComputedStyle($('#save')).transitionDuration, '0.13s', 'with a fade of 0.13 s');
  await t.type('o. ');
}
await told((s) => s.dirty && s.edited, 'the shell to hear of the change');

// Saving a document that has no file asks where, offering the heading as its name.
await answer({ save: null });
await t.key('s', { ctrl: true });
await told(async () => (await asked()).length === 1, 'Ctrl+S to ask where to save');
t.equal(await asked(), [['save', 'Write it more than one way.md', null]], 'offering the name of the first heading');
t.equal([unsaved(), (await shell()).file], [true, null], 'calling the panel off saves nothing');
t.equal(ui.get('read'), false, 'and the tools stay as they were');

// Unsaved work is copied aside every few seconds, against a crash.
{
  const s = await told((state) => state.drafts.length === 1 && state, 'a copy of the unsaved work to be kept', KEPT_MS);
  t.same(s?.drafts[0].text ?? '', asIs(), 'the copy is the file as it would be saved');
  t.equal([s?.drafts[0].name, s?.drafts[0].file], ['Write it more than one way', null], 'under the name the document goes by');
}

// Taking the change back leaves nothing unsaved, and nothing to keep a copy of.
await t.key('z', { meta: true });
await t.until(() => !unsaved(), 2500, 'undoing the change to dim the Save icon again');
await told((s) => !s.dirty && !s.edited && s.drafts.length === 0, 'the shell to drop the copy');

// --- opening --------------------------------------------------------------------------------------

// A window nobody has written in is where a file opens.
const OTHER =
  '# A file from elsewhere\r\n\r\nIts second line has a group in it.\r\n\r\n' +
  '<!-- write_on {"version":1,"html":"<p># A file from elsewhere</p><p><br></p><p>Its second line has a <span data-vid=\\"gr0up01\\">group</span> in it.</p>","groups":{"gr0up01":{"scope":"word","variants":["group","set"],"active":0}}} -->\r\n';
await t.writeFile('other.md', base64(OTHER));
await answer({ open: ['other.md'] });
await t.click(...t.center('#open'));
await t.until(() => editor.getState().html.includes('A file from elsewhere'), 2500, 'the file to open in this window');
t.equal((await asked()).slice(1), [['open', null, null]], 'the Open icon asks which file');
t.equal(Object.entries(editor.groups).map(([vid, group]) => [vid, group.variants]), [['gr0up01', ['group', 'set']]], 'it comes with its alternatives');
t.equal([editor.canUndo, unsaved()], [false, false], 'a document just opened has nothing to undo and nothing to save');
{
  const s = await told((state) => state.file === 'other.md' && state, 'the shell to have the file');
  t.equal([s?.dirty, s?.title, s?.recents, s?.windows.length], [false, 'other', ['other.md'], 0], 'the window is called by its file, which heads the recent ones');
}
t.same(await onDisk('other.md'), OTHER, 'opening leaves the file as it was, line endings and all');

// Looking at a word is not a change.
editor.focus();
editor.select({ block: 2, offset: 6 });
await t.settle();
commands.run('alternatives');
await t.until(() => Object.values(editor.groups).some((group) => group.variants.length === 1) || unsaved(), 1500, 'the panel to look at a word');
t.equal(unsaved(), false, 'the panel looking at a word does not light the Save icon, even for a moment');
await t.wait(400);
t.equal(unsaved(), false, 'and leaves nothing to save');
await t.key('Escape');
await t.until(() => !ui.get('panel'), 1500, 'the panel to close');

// Saving a document that has a file writes it there, and asks nothing.
await typeAt(2, 0, 'Now, ');
await t.until(() => unsaved(), 1500, 'a change to it to light the icon');
await t.click(...t.center('#save'));
await t.until(() => !unsaved(), 2500, 'the Save icon to save it');
t.same(await onDisk('other.md'), asIs(), 'the file on disk is the document');
t.assert(!(await onDisk('other.md')).includes('\r') && (await onDisk('other.md')).startsWith('# A file from elsewhere\n\nNow, Its second line'), 'in plain Markdown, one line ending');
t.equal((await asked()).length, 2, 'no panel was shown');
await told((s) => !s.dirty && !s.edited && s.drafts.length === 0, 'the shell to know it is saved');

// Save As asks where, offering the name it has, and the document goes on under the new one.
await typeAt(2, 0, 'And ');
await answer({ save: 'copy.md' });
commands.run('save-as');
{
  const s = await told((state) => state.file === 'copy.md' && !state.dirty && state, 'Save As to take the new name');
  t.equal((await asked()).slice(2), [['save', 'other.md', null]], 'the panel offered the name it had');
  t.equal([s?.title, s?.recents], ['copy', ['copy.md', 'other.md']], 'the window and the recent files follow');
  t.same(await onDisk('copy.md'), asIs(), 'the new file is the document');
  t.assert((await onDisk('other.md')).startsWith('# A file from elsewhere\n\nNow, Its second'), 'and the old one is as it was last saved');
}

// A panel called off, or a file that cannot be written, leaves the work unsaved and says so.
await typeAt(2, 0, 'Then ');
await answer({ save: null });
commands.run('save-as');
await told(async () => (await asked()).length === 4, 'the panel to be asked');
await t.until(() => unsaved(), 1500, 'the Save icon to light for the change');
t.equal([unsaved(), (await shell()).file], [true, 'copy.md'], 'called off: still unsaved, still the same file');
await answer({ save: 'no-such-folder/lost.md' });
commands.run('save-as');
await told(async () => (await asked()).length === 6, 'the failure to be reported');
{
  const [panel, alert] = (await asked()).slice(4);
  t.equal([panel[0], alert[0], alert[1]], ['save', 'tell', 'The document “copy” could not be saved as “lost.md”.'], 'a file that cannot be written is reported');
  t.assert(alert[2].length > 10, `with the system's reason: ${alert[2]}`);
  t.equal([unsaved(), (await shell()).file], [true, 'copy.md'], 'and the document stays open, unsaved, under its own name');
}

// With something in the window already, a file opens in a window of its own.
await t.writeFile('third.md', base64('# Third\n\nPlain.\n'));
await answer({ open: ['third.md'] });
await t.key('o', { ctrl: true });
{
  const s = await told((state) => state.windows.length === 1 && state, 'another window to be asked for');
  t.equal(s?.windows.map((w) => [w.kind, w.file]), [['file', 'third.md']], 'for the file');
  t.equal([s?.file, s?.recents[0]], ['copy.md', 'third.md'], 'this window keeps its document');
  t.assert(editor.getState().html.includes('Then And Now, Its second line'), 'untouched');
}
// The file already in the window is not opened twice.
await answer({ open: ['copy.md'] });
await t.key('o', { ctrl: true });
await told(async () => (await asked()).length === 8, 'the panel to be asked');
t.equal((await shell()).windows.length, 1, 'a file that is already open is only brought forward');
// A file that is not there.
await answer({ open: ['nowhere.md'] });
await t.key('o', { ctrl: true });
await told(async () => (await asked()).length === 10, 'the failure to be reported');
{
  const alert = (await asked())[9];
  t.equal(alert.slice(0, 2), ['tell', 'The document “nowhere.md” could not be opened.'], 'a file that cannot be read is reported');
  t.assert(alert[2].length > 10, `with the system's reason: ${alert[2]}`);
  t.equal((await shell()).windows.length, 1, 'and nothing opens');
}
// Files handed over by Finder go the same way.
await t.call('test.openFiles', { names: ['third.md'] });
await told((s) => s.windows.length === 2, 'a file from Finder to ask for its window');

// --- before changes are lost ----------------------------------------------------------------------

// Closing asks first, and Cancel keeps the window.
await answer({ unsaved: 'cancel' });
t.equal((await t.call('test.close')).closes, false, 'Cancel keeps the window open');
t.equal((await asked())[10], ['unsaved', 'copy', null], 'the question names the document');
// Save saves, and then the window may go.
await answer({ unsaved: 'save' });
t.equal((await t.call('test.close')).closes, true, 'Save lets it close');
t.same(await onDisk('copy.md'), asIs(), 'with the changes on disk');
await t.until(() => !unsaved(), 2500, 'the document to be saved');
// With nothing unsaved there is nothing to ask.
t.equal((await t.call('test.close')).closes, true, 'a saved document closes without a question');
t.equal((await asked()).length, 12, 'none was asked');

// Quitting asks about each unsaved document in the same way.
await typeAt(2, 0, 'Last, ');
await told((s) => s.dirty, 'the shell to hear of the change');
await answer({ unsaved: 'cancel' });
t.equal((await t.call('test.quit')).quits, false, 'Cancel calls the quit off');
await told((s) => s.drafts.length === 1, 'the unsaved work to be copied aside meanwhile', KEPT_MS);
await answer({ unsaved: 'discard' });
t.equal((await t.call('test.quit')).quits, true, "Don't Save lets it go");
t.assert((await onDisk('copy.md')).startsWith('# A file from elsewhere\n\nThen And Now,'), 'the file keeps what was last saved');
t.equal((await shell()).drafts.length, 0, 'and the copy is thrown away with the changes');

// If the page has to start over, it gets back what was being written, not what was first opened.
await typeAt(2, 0, 'Again, ');
await told((s) => s.drafts.length === 1, 'the unsaved work to be copied aside', KEPT_MS);
{
  const again = await t.call('test.restart');
  t.equal([again.kind, again.name], ['recovered', 'copy.md'], 'unsaved work comes back as unsaved work, still belonging to its file');
  t.same(again.text, asIs(), 'as it was last copied aside');
}
await t.key('s', { ctrl: true });
await told((s) => !s.dirty && s.drafts.length === 0, 'the document to be saved');
{
  const again = await t.call('test.restart');
  t.equal([again.kind, again.name], ['file', 'copy.md'], 'saved work comes back from its file');
  t.same(again.text, asIs(), 'as it is on disk');
}

// --- a file that something else has changed -------------------------------------------------------

// Another editor, a sync or a script may change the file while it is open here. Saving then
// asks first, and does not write over their work unasked. (Found in review.)
{
  const ELSEWHERE = '# A file from elsewhere\n\nRewritten by another editor while it was open here.\n';
  await t.writeFile('copy.md', base64(ELSEWHERE));
  await typeAt(2, 0, 'Meanwhile, ');
  const before = (await asked()).length;

  await answer({ changed: 'cancel' });
  await t.key('s', { ctrl: true });
  await told(async () => (await asked()).length === before + 1, 'saving to ask about the changed file');
  t.equal((await asked()).at(-1), ['changed', 'copy.md', null], 'the question names the file');
  t.same(await onDisk('copy.md'), ELSEWHERE, 'Cancel leaves what the other editor wrote');
  await t.until(() => unsaved(), 1500, 'the Save icon to light for the change');
  t.equal([unsaved(), (await shell()).dirty, (await shell()).file], [true, true, 'copy.md'], 'and leaves this window as it was: unsaved, on the same file');

  // The same on the way out of the window: Save there does not get past the question either.
  await answer({ unsaved: 'save' }, { changed: 'cancel' });
  t.equal((await t.call('test.close')).closes, false, 'closing with Save, and then Cancel, keeps the window');
  t.same(await onDisk('copy.md'), ELSEWHERE, 'and the file');

  await answer({ changed: 'save' });
  await t.key('s', { ctrl: true });
  await t.until(() => !unsaved(), 2500, 'Save Anyway to save');
  t.same(await onDisk('copy.md'), asIs(), 'Save Anyway writes this window’s text');

  // Once written, the file is as this window knows it, and there is nothing more to ask.
  const sofar = (await asked()).length;
  await typeAt(2, 0, 'And then ');
  await t.key('s', { ctrl: true });
  await t.until(() => !unsaved(), 2500, 'the next save to go through');
  t.equal((await asked()).length, sofar, 'the save after that asks nothing');
  t.same(await onDisk('copy.md'), asIs(), 'and writes');
}

// --- what a file has besides its text -------------------------------------------------------------

// Saving replaces the text and nothing else: who may read the file, what Finder has attached
// to it (its tags, for one), and, where the file is a link, the link. (Found in review: each
// save put a new file in its place, with none of these.)
{
  await t.writeFile('real.md', base64('# Linked\n\nFirst.\n'));
  await t.call('test.file', { name: 'real.md', mode: '600', attribute: 'com.apple.metadata:_kMDItemUserTags' });
  await t.call('test.file', { name: 'real.md', attribute: 'org.example.note' });
  await t.call('test.file', { name: 'link.md', linkTo: 'real.md' });
  await answer({ save: 'link.md' });
  commands.run('save-as');
  await told((s) => s.file === 'link.md' && !s.dirty, 'the document to be saved through the link');
  await typeAt(2, 0, 'Twice, ');
  await t.key('s', { ctrl: true });
  await t.until(() => !unsaved(), 2500, 'and saved again');
  const link = await t.call('test.file', { name: 'link.md' });
  const real = await t.call('test.file', { name: 'real.md' });
  t.equal([link.link, real.link], [true, false], 'a link is still a link after saving through it');
  t.same(real.text ?? '', asIs(), 'and the file it points at has the text');
  t.equal(real.mode, '600', 'which is still private to its owner');
  t.equal(['com.apple.metadata:_kMDItemUserTags', 'org.example.note'].filter((name) => !real.attributes.includes(name)), [], 'and still has what was attached to it');
}

// --- what the Open panel lets be chosen -----------------------------------------------------------

// Markdown and plain text, whatever this Mac calls a Markdown file. That differs between
// Macs: where something says Markdown is plain text (Notes does, from macOS 26) a .md file
// is plain text; where nothing says what it is, a .md file has a type of no name, which is
// not plain text, and the panel showed every one of them grayed out. (Found on a laptop: the
// same app opened .md files on the Mac it was built on.) An ending nothing on this Mac
// claims stands in for .md on such a Mac.
{
  for (const name of ['open.md', 'open.markdown', 'open.txt', 'open.png', 'open.xmdz']) await t.writeFile(name, base64('# Open me\n'));
  const takes = (names, markdown) => t.call('test.openable', markdown ? { names, markdown } : { names });
  t.equal(await takes(['open.md', 'open.markdown', 'open.txt', 'open.png']), [true, true, true, false], 'the Open panel takes .md, .markdown and .txt files, and not a picture');
  t.equal(await takes(['open.xmdz', 'open.png'], ['xmdz']), [true, false], 'and a Markdown file on a Mac where nothing says what Markdown is');
}
