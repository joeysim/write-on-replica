// The real AI service (design spec 7.1; plan: Task 22). This asks LunaRoute for real, with the
// real key, so under scripts/check.sh, where every scenario is given the scripted provider,
// it steps aside. To run it:
//
//   scripts/ui-test.sh ai-live --ai live
//
// It never sees the key: the shell holds it and says only where it came from.
const { editor, ui, commands, lab } = window.writeOn;
if (!(await t.call('test.options')).aiLive) {
  t.log('skipped: this run does not ask the real service (scripts/ui-test.sh ai-live --ai live does)');
  return;
}
ui.set({ read: false });
await document.fonts.ready;
await t.settle();

const $ = (s) => document.querySelector(s);
const panelEl = $('#panel');
const rows = () => [...panelEl.querySelectorAll('.row')].map((row) => row.querySelector('.text').textContent);
const asking = () => panelEl.querySelector('.row.asking');
const textOf = (i) => editor.blocks[i].runs.map((run) => run.text).join('');
const seconds = (ms) => `${(ms / 1000).toFixed(2)} s`;
const groupAt = (block, offset) => {
  let at = 0;
  for (const run of editor.blocks[block].runs) {
    if (offset >= at && offset < at + run.text.length) return run.vid ? editor.groups[run.vid] : null;
    at += run.text.length;
  }
  return null;
};

// --- the connection, and where the key is found ---------------------------------------------------

{
  const s = await t.call('test.settings', { test: true });
  t.assert(/^Connected: glm-5\.3-flash answered in [\d.]+ s, with the key from /.test(s.testNote), `Test connection: ${s.testNote}`);
  t.log(`Test connection: ${s.testNote}`);
  // Started from Finder the app has no environment to speak of, and asks the login shell.
  const shell = await t.call('test.loginShell');
  t.equal(shell.hasKey, true, 'the login shell has a key too, for when the app is started from Finder');
  t.log(`the login shell answered in ${seconds(shell.ms)}`);
}

// --- five other words -------------------------------------------------------------------------------

const PARA = 5; // "Click the word count in the top-left corner to turn the tools on. Then rest the pointer…"
{
  const at = textOf(PARA).indexOf('tools');
  editor.focus();
  editor.select({ block: PARA, offset: at + 2 });
  await t.settle();
  const began = performance.now();
  commands.run('ai-alternatives');
  await t.until(() => asking(), 2000, 'the panel to ask');
  let first = null;
  await t.until(() => {
    if (first === null && rows().filter((text) => text && text !== 'tools' && !text.includes('?')).length > 0) first = performance.now() - began;
    return !asking() && (groupAt(PARA, at)?.variants.length ?? 0) > 1;
  }, 30000, 'the words to arrive');
  const total = performance.now() - began;
  const group = groupAt(PARA, at);
  const words = group?.variants.slice(1) ?? [];
  t.log(`a word: ${JSON.stringify(words)}; first shown after ${first === null ? '?' : seconds(first)}, all in ${seconds(total)}`);
  t.equal(words.length, 5, 'five other words for a word');
  t.equal(new Set(words.map((word) => word.toLowerCase())).size, 5, 'all different');
  t.assert(words.every((word) => word && word !== 'tools' && word.split(/\s+/).length <= 3 && !/^[-*\d"“'‘]/.test(word) && !/["”.]$/.test(word)), 'each a word or two, with nothing of a list about it');
  t.equal(group?.ai, words, 'and marked as the machine’s');
  t.assert(total < 15000, `in good time: ${seconds(total)}`);
  await t.key('Escape');
  await t.until(() => !ui.get('panel'), 1500, 'the panel to close');
}

// --- three other versions of a sentence -------------------------------------------------------------

{
  const sentence = 'Then rest the pointer on anything underlined and press the arrow keys.';
  const at = textOf(PARA).indexOf(sentence);
  editor.focus();
  editor.select({ block: PARA, offset: at }, { block: PARA, offset: at + sentence.length });
  await t.settle();
  const began = performance.now();
  commands.run('ai-alternatives');
  await t.until(() => asking(), 2000, 'the panel to ask');
  await t.until(() => !asking() && (groupAt(PARA, at + 3)?.variants.length ?? 0) > 1, 30000, 'the versions to arrive');
  const total = performance.now() - began;
  const group = groupAt(PARA, at + 3);
  const versions = group?.variants.slice(1) ?? [];
  t.log(`a sentence, in ${seconds(total)}:`);
  for (const version of versions) t.log(`    ${version}`);
  t.equal([group?.scope, versions.length], ['sentence', 3], 'three other versions of a sentence');
  t.assert(versions.every((version) => version !== sentence && version.split(/\s+/).length >= 5 && /[.!?]$/.test(version) && !/^[-*\d"“]/.test(version)), 'each a sentence of its own');
  t.assert(total < 20000, `in good time: ${seconds(total)}`);
  await t.key('Escape');
  await t.until(() => !ui.get('panel'), 1500, 'the panel to close');
}

// --- a slight trim ------------------------------------------------------------------------------------

{
  const card = $('#labcard');
  const menu = $('#labmenu');
  const title = () => card.querySelector('.title').textContent.replace(/\s+/g, ' ').trim();
  const before = editor.getState().html;
  await t.click(...t.center('#lab'));
  await t.until(() => ui.get('lab') && menu.getAnimations({ subtree: false }).length === 0, 2000, 'the Lab to open');
  const levelNamed = (name) => [...menu.querySelectorAll('.level')].find((level) => level.querySelector('.name').textContent === name);
  // When the first cuts are faded: the answer is every paragraph again, and they are shown as they come.
  let firstCut = null;
  const began = performance.now();
  const watcher = new MutationObserver(() => {
    if (firstCut === null && editor.root.querySelector('[data-trim]')) firstCut = performance.now() - began;
  });
  watcher.observe(editor.root, { childList: true, subtree: true });
  await t.click(...t.center(levelNamed('Slight trim')));
  await t.until(() => /words ·/.test(title()) || card.classList.contains('is-failed') || /Done/.test(card.textContent) && !/Reading/.test(title()), 60000, 'the trim to come back');
  const total = performance.now() - began;
  t.log(`a trim, in ${seconds(total)}: ${title()}`);
  const found = /^Slight trim (\d+) → (\d+) words · −(\d+)%$/.exec(title());
  if (t.assert(found, `the card counts the words before and after: ${title()} / ${card.querySelector('.hint')?.textContent ?? ''}`)) {
    const [from, to, percent] = found.slice(1).map(Number);
    const cuts = [...new Set([...editor.root.querySelectorAll('[data-trim]')].map((span) => span.dataset.trim))].length;
    t.log(`    ${from} → ${to} words, ${percent}% for a target of 10%, in ${cuts} cuts`);
    for (const span of editor.root.querySelectorAll('[data-trim]')) t.log(`    cut: ${span.textContent}`);
    // The plan's bar: within half of what was asked for, either way.
    t.assert(percent >= 5 && percent <= 15, `a slight trim cuts about a tenth: ${percent}%`);
    t.equal(editor.getState().html, before, 'and until the writer says so, nothing is cut');
  }
  t.assert(total < 45000, `in good time: ${seconds(total)}`);
  watcher.disconnect();
  if (firstCut !== null) t.log(`    the first cuts were faded after ${seconds(firstCut)}, ${seconds(total - firstCut)} before the whole answer was in`);
  await t.snap('trim');

  // The next level is read quietly meanwhile, and is there at once when it is chosen.
  const quiet = performance.now();
  const ready = await t.until(() => lab.kept().includes('tighten'), 120000, 'the next level to be read quietly');
  if (ready) {
    t.log(`    "Tighten more" was read quietly in another ${seconds(performance.now() - quiet)}`);
    await t.click(...t.center('#lab'));
    await t.until(() => ui.get('lab') && menu.getAnimations({ subtree: false }).length === 0, 2000, 'the Lab to open again');
    await t.click(...t.center(levelNamed('Tighten more')));
    t.assert(/^Tighten more \d+ → \d+ words/.test(title()), `and is there at once when chosen: ${title()}`);
    t.log(`    ${title()}`);
  }
  lab.dismiss();
  lab.forget(); // nothing more is asked once this is over
}
