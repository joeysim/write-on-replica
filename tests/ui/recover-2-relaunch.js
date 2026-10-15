// launch: --state build/results/ui/recover-1-crash/state
// Recovery, part two (design spec 6.11 and 8): the launch after a crash. It starts from what
// recover-1-crash.js left behind, so that scenario runs first (scripts/check.sh runs them in
// order). The unsaved work comes back as an unsaved document.
const { editor, ui } = window.writeOn;
const { serialize } = await import('./src/doc/format.js');
await document.fonts.ready;

const $ = (s) => document.querySelector(s);
const shell = () => t.call('test.shell');
const asked = async () => (await t.call('test.dialogs')).asked.map((d) => [d.kind, d.name, d.folder ?? null]);
const answer = (...answers) => t.call('test.dialogs', { answers });
const tip = $('#tooltip');

if (!editor.getState().html.includes('Written but never saved')) {
  t.assert(false, 'there is nothing to recover: run recover-1-crash first (scripts/ui-test.sh recover-1-crash)');
  return;
}

// It is all there: the text, the alternatives and which was showing, the ghosting, the overflow.
t.equal(
  editor.getState().html,
  '<p># Lost and found</p><p><br></p><p>Saved, this much of it. Written but never saved: <span data-vid="rec0ver">safe</span> <span data-ghost>all the same</span>.</p>',
  'the work is back as it was',
);
t.equal([editor.groups.rec0ver?.variants, editor.groups.rec0ver?.active, editor.overflow], [['kept', 'safe'], 1, 'And its overflow.'], 'marks, alternatives and overflow included');

// As an unsaved document, and it says so.
{
  const s = await shell();
  t.equal([s.file, s.dirty, s.edited, s.title], [null, true, true, 'Lost and found'], 'it is an unsaved document, called by its heading');
  t.equal($('#save').classList.contains('is-on'), true, 'the Save icon is lit');
  t.equal(s.drafts.length, 1, 'the copy stays until the work is saved or let go');
  t.equal(ui.get('read'), true, 'the app starts in read mode, as it was left');
  await t.until(() => Number(getComputedStyle(tip).opacity) > 0.99, 1500, 'a note to show, read mode or not');
  t.equal([tip.textContent, tip.classList.contains('is-note')], ['Recovered after Write_On quit unexpectedly. Save it to keep it.', true], 'which says where the work came from');
  await t.snap('recovered');
}
ui.set({ read: false });

// Saving it asks where, starting from the file it used to be. Calling that off keeps everything.
await answer({ unsaved: 'save' }, { save: null });
t.equal((await t.call('test.close')).closes, false, 'a save that is called off keeps the window');
t.equal(await asked(), [['unsaved', 'Lost and found', null], ['save', 'kept.md', 'recover-1-crash']], 'the panel offers the name and the folder it had');
t.equal((await shell()).drafts.length, 1, 'and the copy');

// Saved, it is a document like any other, and the copy is gone.
await answer({ unsaved: 'save' }, { save: 'found.md' });
t.equal((await t.call('test.close')).closes, true, 'saved, the window may go');
{
  const s = await t.until(async () => !(await shell()).dirty && shell(), 2500, 'the shell to know it is saved');
  t.equal([s?.file, s?.title, s?.drafts.length], ['found.md', 'found', 0], 'it has a file, and nothing is kept aside any more');
  t.same((await t.call('test.readFile', { name: 'found.md' })).text ?? '', serialize(editor.getState()), 'the file is the recovered work');
  t.equal($('#save').classList.contains('is-on'), false, 'the Save icon is dim');
}
