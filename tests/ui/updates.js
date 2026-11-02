// launch: --timeout 180
// releases: tests/ui/support/fake-releases.mjs
// Check for Updates (design spec 6.14 and 9 item 63), against a stand-in for GitHub's
// releases that answers as each case asks: nothing later; a later version that is good; later
// versions signed by a stranger, signed ad hoc, changed after signing, or not the version they
// say; and answers that go wrong. The run is a copy of the app, which the stand-in signed for
// the run and made a release, so that it may update itself. Nothing of the run leaves this Mac.
const { editor } = window.writeOn;
await document.fonts.ready;

const updates = (change = {}) => t.call('test.updates', change);
const dialogs = async () => (await t.call('test.dialogs')).asked;
const answer = (...answers) => t.call('test.dialogs', { answers });
const shell = () => t.call('test.shell');
const ITEM = ['Write_On', 'Check for Updates…'];
// What was asked and told, as [kind, what]. Only the update's version is given for it.
const told = (said) => said.map((d) => [d.kind, d.kind === 'update' ? d.version : (d.message ?? null)]);
const ended = (said) => said.some((d) => ['tell', 'inform', 'update'].includes(d.kind));
let heard = 0;
let base = '';
// Chooses Check for Updates with the stand-in's case `name`, and `answers` for what it asks.
// Waits for the check to be done and for `ready` to hold of what it asked and told since the
// last check, and gives that.
const check = async (name, answers = [], ready = ended) => {
  await updates({ feed: `${base}/${name}/releases/latest` });
  await answer(...answers);
  t.equal((await t.call('test.pick', { path: ITEM })).picked, true, `Check for Updates can be chosen (${name})`);
  let said = [];
  await t.until(
    async () => {
      if ((await updates()).busy) return false;
      said = (await dialogs()).slice(heard);
      return ready(said);
    },
    40000,
    `the check to be done (${name})`,
  );
  heard += said.length;
  return said;
};

// --- the copy, and where it asks ---------------------------------------------------------------------

const start = await updates();
base = (start.feed ?? '').replace(/\/current\/releases\/latest$/, '');
t.assert(base.startsWith('http://127.0.0.1:'), `the run asks the stand-in, on this Mac: ${start.feed}`);
t.assert(start.bundle.endsWith('/Applications/Write_On.app'), `the run is a copy of its own: ${start.bundle}`);
t.equal([start.whyNot, start.signed, start.source], [null, true, `v${start.version}`], 'a copy that is a release, signed, may update itself');
{
  const items = (await t.call('test.menu', { path: ['Write_On'] })).items.slice(0, 2).map((item) => [item.title, item.enabled]);
  t.equal(items, [['About Write_On', true], ['Check for Updates…', true]], 'Check for Updates is in the app’s menu, under About');
}

// --- copies that cannot update themselves ------------------------------------------------------------

const cannot = async (why, what, change, undo) => {
  t.assert(why.test((await updates(change)).whyNot ?? ''), `${what}: the copy knows it cannot update itself`);
  await answer();
  await t.call('test.pick', { path: ITEM });
  const said = (await dialogs()).slice(heard);
  heard += said.length;
  t.equal(told(said), [['tell', 'This copy of Write_On cannot update itself.']], `${what}: it says so, and asks nothing`);
  t.assert(why.test(said[0]?.detail ?? ''), `${what}, and why: ${said[0]?.detail}`);
  await undo();
};
await cannot(/built from the source \(1\.1\.1-3-gabc1234\)/, 'a build from the source', { source: 'v1.1.1-3-gabc1234' }, () => updates({ source: start.source }));
await cannot(/ad hoc signature/, 'a copy signed ad hoc', { adHoc: true }, () => updates({ adHoc: false }));
// The run's copy is in a folder of its own, Applications: here it is one the run cannot change.
await t.call('test.file', { name: 'Applications', mode: '555' });
await cannot(/cannot change the folder it is in/, 'a copy in a folder it cannot change', {}, () => t.call('test.file', { name: 'Applications', mode: '755' }));
t.equal((await updates()).whyNot, null, 'and each copy could again');

// --- nothing later -------------------------------------------------------------------------------------

{
  const said = await check('current');
  t.equal(told(said), [['working', 'Checking for updates…'], ['inform', 'Write_On is up to date.']], 'the latest release is this version: there is nothing to install');
  t.equal(said[1]?.detail, `You have version ${start.version}, the latest.`, 'and it says which version that is');
}
t.equal(told(await check('older')), [['working', 'Checking for updates…'], ['inform', 'Write_On is up to date.']], 'a release older than this copy is not offered');

// --- answers that go wrong ---------------------------------------------------------------------------

const failure = async (name, message, detail) => {
  const said = await check(name);
  t.equal(told(said), [['working', 'Checking for updates…'], ['tell', message]], `${name}: ${message}`);
  if (detail) t.assert(detail.test(said[1]?.detail ?? ''), `${name}, and why: ${said[1]?.detail}`);
};
await failure('missing', 'GitHub did not say which release is the latest.', /It answered 404/);
await failure('broken', 'Write_On could not read GitHub’s answer.', /does not say what the latest release is/);
await failure('untagged', 'Write_On could not read GitHub’s answer.', /“nightly”, which is not a version/);
await failure('bare', 'The latest release, 99.0.0, has no app to download.', /It has no Write_On-99\.0\.0\.zip/);
await failure('away', 'A scripted run asks only a service on this Mac.');

// --- later versions that are not installed ---------------------------------------------------------------

const refused = async (name, detail) => {
  const said = await check(name);
  t.equal(
    told(said),
    [['working', 'Checking for updates…'], ['working', 'Downloading Write_On 99.0.0…'], ['tell', 'The update was not installed.']],
    `${name}: downloaded and checked, and not installed`,
  );
  t.assert(detail.test(said[2]?.detail ?? ''), `${name}, and why: ${said[2]?.detail}`);
  const now = await updates();
  t.equal([now.version, now.signed, now.reopened], [start.version, true, null], `${name}: the copy is as it was`);
};
const UNSIGNED = /not signed with the certificate that this copy has, or it was changed after it was signed/;
await refused('stranger', UNSIGNED);
await refused('adhoc', UNSIGNED);
await refused('tampered', UNSIGNED);
await refused('mismatch', /The release is 99\.0\.0, but the app in its zip is 98\.0\.0/);

// --- calling the check off -----------------------------------------------------------------------------

{
  const said = await check('slow', [{ working: 'cancel', after: 300 }], (now) => now.length > 0);
  t.equal(told(said), [['working', 'Checking for updates…']], 'Cancel calls the check off, and nothing more is said');
  t.equal((await updates()).version, start.version, 'nothing changed');
}

// --- a later version, and not now --------------------------------------------------------------------------

{
  const said = await check('good', [{ update: 'later' }]);
  t.equal(told(said), [['working', 'Checking for updates…'], ['working', 'Downloading Write_On 99.0.0…'], ['update', '99.0.0']], 'a good later version is downloaded, checked and offered');
  t.equal([said[2]?.current, said[2]?.notes], [start.version, ['One change.', 'Another change, on a line of its own.']], 'with the version this copy is, and what the release notes say changed');
  const now = await updates();
  t.equal([now.version, now.reopened], [start.version, null], 'Not Now leaves the copy as it was');
}

// --- installing it asks about unsaved work first, as Quit does --------------------------------------------

editor.focus();
editor.select({ block: 0, offset: 0 });
await t.settle();
await t.type('Unsaved. ');
await t.until(async () => (await shell()).dirty, 1500, 'the shell to hear of the change');
{
  const asks = (now) => now.some((d) => d.kind === 'unsaved');
  const said = await check('good', [{ update: 'install' }, { unsaved: 'cancel' }], asks);
  t.equal(said.map((d) => d.kind), ['working', 'working', 'update', 'unsaved'], 'Install and Relaunch asks about the unsaved document');
  await t.wait(100);
  const now = await updates();
  t.equal([now.version, now.reopened, (await shell()).dirty], [start.version, null, true], 'Cancel there leaves the copy as it was, and the document open and unsaved');
}
{
  const reopened = async () => (await updates()).reopened !== null;
  const said = await check('good', [{ update: 'install' }, { unsaved: 'save' }, { save: 'kept.md' }], reopened);
  t.equal(said.map((d) => d.kind), ['working', 'working', 'update', 'unsaved', 'save'], 'saving the document first');
  const now = await updates();
  t.equal([now.version, now.source, now.signed], ['99.0.0', 'v99.0.0', true], 'the new version is in the copy’s place, signed as the copy was');
  t.equal([now.reopened?.app, now.reopened?.files], [start.bundle, ['kept.md']], 'and the app would open again with the document, now saved');
  t.equal([(await shell()).file, (await shell()).dirty], ['kept.md', false], 'which was saved before the update went in');
}
