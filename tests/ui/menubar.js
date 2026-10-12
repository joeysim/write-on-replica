// The menu bar (design spec 6.13, and 9 item 30). A scripted run is never in front, so its
// menus are never on screen: the scenario reads them (test.menu) and picks from them
// (test.pick) as a click would, and presses the Command keys that belong to them.
const { editor, ui } = window.writeOn;
ui.set({ read: false });
await document.fonts.ready;

const menu = async (...path) => (await t.call('test.menu', { path })).items;
const pick = async (...path) => (await t.call('test.pick', { path })).picked;
// As they read in the menu. (Alternates are the items AppKit adds for when Option is held: Close All.)
const titles = (items) => items.filter((item) => !item.alternate).map((item) => (item.separator ? '-' : item.key ? `${item.title} ${item.key}` : item.title));
const ticked = async (title, ...path) => (await menu(...path)).find((item) => item.title === title)?.on;
const shell = () => t.call('test.shell');
const asked = async () => (await t.call('test.dialogs')).asked.map((d) => [d.kind, d.name ?? d.message ?? null]);
const answer = (...answers) => t.call('test.dialogs', { answers });
const text = (block) => editor.blocks[block].runs.map((run) => run.text).join('');

// --- what is in it ----------------------------------------------------------------------------------

t.equal(titles(await menu()), ['Write_On', 'File', 'Edit', 'View', 'Tools', 'Window', 'Help'], 'the menus');
t.equal(
  titles(await menu('Write_On')),
  ['About Write_On', '-', 'Services', '-', 'Hide Write_On ⌘H', 'Hide Others ⌥⌘H', 'Show All', '-', 'Quit Write_On ⌘Q'],
  'the app’s own',
);
t.equal(
  titles(await menu('File')),
  ['New ⌘N', 'Open… ⌘O', 'Open Recent', '-', 'Close ⌘W', 'Save… ⌘S', 'Save As… ⇧⌘S', '-', 'Post to X ⌃⇧P'],
  'File, with the usual Command keys',
);
t.equal(
  titles(await menu('Edit')).slice(0, 12),
  ['Undo ⌘Z', 'Redo ⇧⌘Z', '-', 'Cut ⌘X', 'Copy ⌘C', 'Paste ⌘V', 'Delete', 'Select All ⌘A', '-', 'Spelling and Grammar', 'Substitutions', 'Speech'],
  'Edit',
);
t.equal(
  titles(await menu('Edit', 'Spelling and Grammar')),
  ['Show Spelling and Grammar ⌘:', 'Check Document Now ⌘;', '-', 'Check Spelling While Typing', 'Check Grammar With Spelling', 'Correct Spelling Automatically'],
  'with the standard checking',
);
t.equal(
  titles(await menu('Edit', 'Substitutions')),
  ['Show Substitutions', '-', 'Smart Copy/Paste', 'Smart Quotes', 'Smart Dashes', 'Text Replacement'],
  'and the standard substitutions',
);
t.equal(
  titles(await menu('View')).slice(0, 7),
  ['Read Mode ⌃⇧R', 'Alternates', '-', 'Overflow ⌃⇧D', 'Source ⌃U', '-', 'Enter Full Screen fnF'],
  'View: the page’s switches, under the Control keys they have on the page',
);
t.equal(
  titles(await menu('Tools')),
  ['Alternatives ⌃⇧A', 'AI Alternatives ⌃⇧G', '-', 'Ghost or Revive ⌃/', 'Stash in Overflow ⌃⇧X', '-', 'The Lab'],
  'Tools: what the page does to the text',
);
t.equal(titles(await menu('Window')).slice(0, 4), ['Minimize ⌘M', 'Zoom', '-', 'Bring All to Front'], 'Window');
t.equal(titles(await menu('Help')).slice(-2), ['Keyboard Shortcuts', 'The Welcome Piece'], 'Help');
t.assert((await menu('File')).every((item) => item.separator || item.enabled), 'with a document in front, everything in File can be chosen');

// --- the page's switches, and their ticks ----------------------------------------------------------

t.equal([await ticked('Read Mode', 'View'), await ticked('Alternates', 'View'), await ticked('Overflow', 'View')], [false, true, false], 'the ticks say what is on');
t.equal(await pick('View', 'Read Mode'), true, 'an item can be chosen');
await t.until(() => ui.get('read') === true, 1500, 'View ▸ Read Mode to turn the tools off');
await t.until(() => ticked('Read Mode', 'View'), 1500, 'its tick to show');
await pick('View', 'Read Mode');
await t.until(() => ui.get('read') === false, 1500, 'and again to turn them on');
await pick('View', 'Alternates');
await t.until(async () => ui.get('alternates') === false && (await ticked('Alternates', 'View')) === false, 1500, 'View ▸ Alternates to hide the marks and lose its tick');
await pick('View', 'Alternates');
await t.until(() => ui.get('alternates') === true, 1500, 'and to show them again');

// Something from the menu turns the tools on, as its shortcut would.
ui.set({ read: true });
await pick('View', 'Overflow');
await t.until(() => ui.get('overflow') && !ui.get('read'), 1500, 'View ▸ Overflow to open it and bring the tools with it');
await t.until(() => ticked('Overflow', 'View'), 1500, 'its tick to show');
await pick('View', 'Overflow');
await t.until(() => !ui.get('overflow'), 1500, 'and again to close it');
await pick('View', 'Source');
await t.until(() => ui.get('source'), 1500, 'View ▸ Source to show the file');
await t.key('Escape');
await t.until(() => !ui.get('source'), 1500, 'the source view to close');
ui.set({ read: true });
await pick('Tools', 'The Lab');
await t.until(() => ui.get('lab') && !ui.get('read'), 1500, 'Tools ▸ The Lab to open it, tools and all');
await t.key('Escape');
await t.until(() => !ui.get('lab'), 1500, 'the Lab to close');
await pick('Help', 'Keyboard Shortcuts');
await t.until(() => document.body.classList.contains('is-card'), 1500, 'Help ▸ Keyboard Shortcuts to show the card');
await t.key('Escape');
await t.until(() => !document.body.classList.contains('is-card'), 1500, 'the card to close');

// --- what the page does to the text ---------------------------------------------------------------

editor.setState({ html: '<p>One plain sentence to work on. And a second one after it.</p>', groups: {}, overflow: '' });
await t.settle();
editor.focus();
editor.select({ block: 0, offset: 4 }, { block: 0, offset: 9 });
await t.settle();
await pick('Tools', 'Alternatives');
await t.until(() => ui.get('panel'), 1500, 'Tools ▸ Alternatives to open the panel on the selection');
await t.key('Escape');
await t.until(() => !ui.get('panel'), 1500, 'the panel to close');
editor.select({ block: 0, offset: 4 }, { block: 0, offset: 9 });
await t.settle();
ui.set({ read: true });
await pick('Tools', 'Ghost or Revive');
await t.until(() => editor.getState().html.includes('<span data-ghost>plain</span>'), 1500, 'Tools ▸ Ghost or Revive to ghost the selection');
t.equal(ui.get('read'), false, 'and, like its shortcut, to turn the tools on');

// Edit ▸ Undo and Redo are the document's own.
await pick('Edit', 'Undo');
await t.until(() => !editor.getState().html.includes('data-ghost'), 1500, 'Edit ▸ Undo to take the ghosting back');
await pick('Edit', 'Redo');
await t.until(() => editor.getState().html.includes('data-ghost'), 1500, 'Edit ▸ Redo to ghost it again');
editor.select({ block: 0, offset: 31 }, { block: 0, offset: 57 });
await t.settle();
await pick('Tools', 'Stash in Overflow');
await t.until(() => editor.overflow === 'And a second one after it.', 1500, 'Tools ▸ Stash in Overflow to move the selection there');

// From the keyboard, Command+Z takes one step back and no more: the page has the key first,
// and the menu item with the same key must not have it as well.
await t.key('z', { meta: true });
await t.settle();
t.equal([editor.overflow, editor.getState().html.includes('data-ghost')], ['', true], 'Command+Z undoes the stash and leaves the ghosting');
await t.key('z', { meta: true, shift: true });
await t.settle();
t.equal(editor.overflow, 'And a second one after it.', 'Shift+Command+Z does it again');

// --- files ----------------------------------------------------------------------------------------

// A document with no heading is offered as "Untitled".
await answer({ save: null });
await pick('File', 'Save…');
await t.until(async () => (await asked()).length === 1, 1500, 'File ▸ Save… to ask where');
t.equal(await asked(), [['save', 'Untitled.md']], 'offering “Untitled” when there is no heading to go by');
// Command+S reaches Save through the menu, once.
await answer({ save: 'menu.md' });
await t.key('s', { meta: true });
await t.until(async () => (await shell()).file === 'menu.md', 2500, 'Command+S to save');
t.equal((await asked()).length, 2, 'having asked once');
await answer({ save: 'menu-2.md' });
await t.key('s', { meta: true, shift: true });
await t.until(async () => (await shell()).file === 'menu-2.md', 2500, 'Shift+Command+S to save under another name');
t.equal((await asked())[2], ['save', 'menu.md'], 'offering the one it has');

// While a question waits for its answer nothing more is asked: a second Save has no panel to
// put up behind the first, by menu or by key.
await answer({ save: 'slow.md', after: 500 });
await pick('File', 'Save As…');
await t.until(async () => (await asked()).length === 4, 1500, 'Save As… to ask');
t.equal((await menu('File')).filter((item) => item.title.startsWith('Save')).map((item) => item.enabled), [false, false], 'Save and Save As… wait their turn');
t.equal(await pick('File', 'Save As…'), false, 'and cannot be chosen');
await t.key('s', { ctrl: true });
await t.key('s', { meta: true, shift: true });
await t.until(async () => (await shell()).file === 'slow.md', 2500, 'the answer to come, and the file to be saved');
t.equal((await asked()).length, 4, 'one question was asked, and one only');
t.equal((await menu('File')).filter((item) => item.title.startsWith('Save')).map((item) => item.enabled), [true, true], 'after which saving is there again');
await answer({ save: 'menu-2.md' });
await pick('File', 'Save As…');
await t.until(async () => (await shell()).file === 'menu-2.md', 2500, 'the document to go back under its name');

// Open Recent lists what has been saved or opened, newest first.
t.equal(titles(await menu('File', 'Open Recent')), ['menu-2.md', 'slow.md', 'menu.md', '-', 'Clear Menu'], 'Open Recent');
await pick('File', 'Open Recent', 'menu.md');
await t.until(async () => (await shell()).windows.length === 1, 2500, 'a recent file to open');
t.equal((await shell()).windows.map((w) => [w.kind, w.file]), [['file', 'menu.md']], 'in a window of its own, this one being taken');
await pick('File', 'Open Recent', 'Clear Menu');
{
  const items = await menu('File', 'Open Recent');
  t.equal([titles(items), items[0].enabled], [['Clear Menu'], false], 'Clear Menu empties the list, and has nothing more to clear');
}

// New, Open and the welcome piece each ask for a window.
await t.key('n', { meta: true });
await t.until(async () => (await shell()).windows.length === 2, 1500, 'Command+N to ask for a window');
await pick('Help', 'The Welcome Piece');
await t.until(async () => (await shell()).windows.length === 3, 1500, 'Help ▸ The Welcome Piece to ask for one');
t.equal((await shell()).windows.slice(1).map((w) => w.kind), ['blank', 'welcome'], 'a blank page, and the welcome piece');
await answer({ open: [] });
await t.key('o', { meta: true });
await t.until(async () => (await asked()).length === 6, 1500, 'Command+O to ask which file');
t.equal((await asked())[5], ['open', null], 'with the Open panel');
// One Open panel at a time, too.
await answer({ open: [], after: 400 });
await t.key('o', { meta: true });
await t.until(async () => (await asked()).length === 7, 1500, 'the Open panel to be up');
t.equal((await menu('File')).find((item) => item.title === 'Open…').enabled, false, 'Open… waits while its panel is up');
await t.key('o', { meta: true });
await t.key('o', { ctrl: true });
await t.wait(600);
t.equal((await asked()).length, 7, 'and is not asked for twice');

// Post to X.
await pick('File', 'Post to X');
await t.until(async () => (await t.call('test.opened')).urls.length === 1, 1500, 'File ▸ Post to X to open the compose window');

// Close asks before unsaved changes are lost.
editor.focus();
editor.select({ block: 0, offset: 0 });
await t.settle();
await t.type('Unsaved. ');
await t.until(async () => (await shell()).dirty, 1500, 'the shell to hear of the change');
await answer({ unsaved: 'cancel' });
await pick('File', 'Close');
await t.until(async () => (await asked()).length === 8, 1500, 'File ▸ Close to ask about the changes');
t.equal((await asked())[7], ['unsaved', 'menu-2'], 'by the document’s name');
t.equal((await shell()).dirty, true, 'Cancel leaves the window open and the changes unsaved');

// --- typing is left as typed -----------------------------------------------------------------------

// Checking and correcting are in the Edit menu to be turned on. Until they are, a slip gets
// no mark, and quotes and dashes stay as they were typed.
editor.setState({ html: '<p><br></p><p><br></p>', groups: {}, overflow: '' });
await t.settle();
editor.focus();
editor.select({ block: 1, offset: 0 });
await t.settle();
await t.type('Teh "qoute" -- it\'s speld wrnog. ');
t.equal(text(1), 'Teh "qoute" -- it\'s speld wrnog. ', 'straight quotes, two hyphens and every slip stay as typed');
await t.wait(900); // a checker would have marked the line by now
{
  const line = editor.blockElement(1).getBoundingClientRect();
  const marks = await t.pixels(line.left, line.top, line.width, line.height + 4, { near: [255, 59, 48], within: 110 });
  t.equal(marks.matching, 0, 'and nothing is marked as misspelt');
  await t.snap('as-typed');
}
