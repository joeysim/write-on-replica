// Recovery, part one (design spec 6.11 and 8): unsaved work is copied aside every few seconds,
// and then the app is gone without a word, as in a crash. Part two is the next launch:
// recover-2-relaunch.js, which starts from what this run leaves behind.
const { editor, ui, commands } = window.writeOn;
ui.set({ read: false });
await document.fonts.ready;

const shell = () => t.call('test.shell');

// A document with a file of its own, and changes the file does not have.
editor.setState({
  html: '<p># Lost and found</p><p><br></p><p>Saved, this much of it.</p>',
  groups: {},
  overflow: '',
});
await t.settle();
await t.call('test.dialogs', { answers: [{ save: 'kept.md' }] });
commands.run('save');
await t.until(async () => (await shell()).file === 'kept.md', 2500, 'the document to be saved');

editor.setState({
  html:
    '<p># Lost and found</p><p><br></p>' +
    '<p>Saved, this much of it. Written but never saved: <span data-vid="rec0ver">safe</span> <span data-ghost>all the same</span>.</p>',
  groups: { rec0ver: { scope: 'word', variants: ['kept', 'safe'], active: 1 } },
  overflow: 'And its overflow.',
});
const state = await t.until(async () => (await shell()).drafts.length === 1 && shell(), 6000, 'the unsaved work to be copied aside');
t.equal([state?.dirty, state?.drafts[0].name, state?.drafts[0].file], [true, 'kept', 'kept.md'], 'the copy knows the document it belongs to');
t.assert((await t.call('test.readFile', { name: 'kept.md' })).text.endsWith('Saved, this much of it.\n'), 'the file itself has only what was saved');
// The run ends here as a crash would: the app is gone, and nobody was asked anything.
