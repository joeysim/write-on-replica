// launch: --timeout 1200
// The real AI service (design spec 7.1; plan: Task 22). This asks for real, with the real key,
// so under scripts/check.sh, where every scenario is given the scripted provider, it steps
// aside. To run it:
//
//   scripts/ui-test.sh ai-live --ai live
//
// The service is the one your login shell names (WRITEON_BASE_URL, WRITEON_MODEL), or
// LunaRoute and glm-5.3-flash if it names none; the times it allows are that model's, and
// they are long, which is why the run is given twenty minutes (above) where others get one.
// It is spoken to OpenAI's way unless the shell or the address says Anthropic's, and both
// ways are worth a run (LunaRoute speaks both):
//
//   WRITEON_API_FORMAT=anthropic scripts/ui-test.sh ai-live --ai live
//
// It asks for five other words, three other sentences, the hedges in the welcome piece, a
// slight trim and the next level after it, and the slips in a page that has some.
// It never sees the key: the shell holds it and says only where it came from.
const { editor, ui, commands, lab } = window.writeOn;
if (!(await t.call('test.options')).aiLive) {
  t.log('skipped: this run does not ask the real service (scripts/ui-test.sh ai-live --ai live does)');
  return;
}
ui.set({ read: false });
await document.fonts.ready;
await t.settle();

// Which way the service is being spoken to, and how long each thing may take. These are
// bounds for a run to end by, not what is expected: LunaRoute's model takes anything from ten
// seconds to a minute and a half over a trim, by the hour and the level, and asked
// Anthropic's way, where LunaRoute does not hold the answer to its schema, it thinks about
// twice as long again. (The times measured are in the README and the spec.)
const anthropic = await (async () => {
  const s = await t.call('test.settings');
  return (s.format === 'auto' ? s.formatHint : s.format).toLowerCase().includes('anthropic');
})();
const MOST = anthropic ? { word: 15, sentence: 20, mark: 120, trim: 240, quietly: 480 } : { word: 15, sentence: 20, mark: 60, trim: 90, quietly: 240 }; // seconds
t.log(`asked ${anthropic ? 'Anthropic' : 'OpenAI'}’s way`);

// How each request this scenario makes of the service ends. The Lab reads the other trim
// levels quietly and says nothing when one of them fails, so it is noted here.
const failures = [];
{
  const client = window.writeOn.ai;
  const start = client.start;
  client.start = (request, onText) => {
    const made = start.call(client, request, onText);
    made.done.catch((error) => {
      if (!error.cancelled) failures.push(error.message);
    });
    return made;
  };
}

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
  t.assert(/^Connected: \S+ answered in [\d.]+ s, with the key from /.test(s.testNote), `Test connection: ${s.testNote}`);
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
  }, MOST.word * 2000, 'the words to arrive');
  const total = performance.now() - began;
  const group = groupAt(PARA, at);
  const words = group?.variants.slice(1) ?? [];
  t.log(`a word: ${JSON.stringify(words)}; first shown after ${first === null ? '?' : seconds(first)}, all in ${seconds(total)}`);
  t.equal(words.length, 5, 'five other words for a word');
  t.equal(new Set(words.map((word) => word.toLowerCase())).size, 5, 'all different');
  t.assert(words.every((word) => word && word !== 'tools' && word.split(/\s+/).length <= 3 && !/^[-*\d"“'‘]/.test(word) && !/["”.]$/.test(word)), 'each a word or two, with nothing of a list about it');
  t.equal(group?.ai, words, 'and marked as the machine’s');
  t.assert(total < MOST.word * 1000, `in good time: ${seconds(total)}`);
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
  await t.until(() => !asking() && (groupAt(PARA, at + 3)?.variants.length ?? 0) > 1, MOST.sentence * 1500, 'the versions to arrive');
  const total = performance.now() - began;
  const group = groupAt(PARA, at + 3);
  const versions = group?.variants.slice(1) ?? [];
  t.log(`a sentence, in ${seconds(total)}:`);
  for (const version of versions) t.log(`    ${version}`);
  t.equal([group?.scope, versions.length], ['sentence', 3], 'three other versions of a sentence');
  t.assert(versions.every((version) => version !== sentence && version.split(/\s+/).length >= 5 && /[.!?]$/.test(version) && !/^[-*\d"“]/.test(version)), 'each a sentence of its own');
  t.assert(total < MOST.sentence * 1000, `in good time: ${seconds(total)}`);
  await t.key('Escape');
  await t.until(() => !ui.get('panel'), 1500, 'the panel to close');
}

// --- a pass that marks, and cuts nothing ----------------------------------------------------------------

/** Runs one of the Lab's marking passes and waits for its card to say what it found. */
const mark = async (label, counted) => {
  const card = $('#labcard');
  const menu = $('#labmenu');
  const title = () => card.querySelector('.title').textContent.replace(/\s+/g, ' ').trim();
  const hint = () => card.querySelector('.hint')?.textContent ?? '';
  await t.click(...t.center('#lab'));
  await t.until(() => ui.get('lab') && menu.getAnimations({ subtree: false }).length === 0, 2000, 'the Lab to open');
  const began = performance.now();
  await t.click(...t.center([...menu.querySelectorAll('.row')].find((row) => row.querySelector('.label').textContent === label)));
  await t.until(() => counted.test(title()) || (title() === label && hint() !== ''), MOST.mark * 1000 + 5000, `the pass to come back: ${label}`);
  const total = performance.now() - began;
  const marked = new Map();
  for (const span of editor.root.querySelectorAll('[data-mark]')) marked.set(span.dataset.mark, (marked.get(span.dataset.mark) ?? '') + span.textContent);
  t.log(`${label}, in ${seconds(total)}: ${counted.test(title()) ? `${title()}: ${JSON.stringify([...marked.values()])}` : hint()}`);
  t.assert(total < MOST.mark * 1000, `in good time: ${seconds(total)}`);
  return { found: counted.test(title()), said: hint(), marked: [...marked.values()] };
};
{
  // Hedges and filler in the welcome piece. What the model finds there is its own affair; that
  // its answer could be read, in the shape the Lab asked for, is what is looked for.
  const before = editor.getState().html;
  const pass = await mark('Mark hedges and filler', /^Mark hedges and filler \d+ marked$/);
  t.assert(pass.found ? pass.marked.length > 0 : pass.said === 'The AI marked nothing.', `the answer could be read: ${pass.said}`);
  t.equal(editor.getState().html, before, 'and nothing in the piece is changed');
  lab.dismiss();
  await t.settle();
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
  await t.until(() => /words ·/.test(title()) || card.classList.contains('is-failed') || /Done/.test(card.textContent) && !/Reading/.test(title()), MOST.trim * 1000 + 15000, 'the trim to come back');
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
  t.assert(total < MOST.trim * 1000, `in good time: ${seconds(total)}`);
  watcher.disconnect();
  if (firstCut !== null) t.log(`    the first cuts were faded after ${seconds(firstCut)}, ${seconds(total - firstCut)} before the whole answer was in`);
  await t.snap('trim');

  // The next level is read quietly meanwhile, and is there at once when it is chosen.
  const quiet = performance.now();
  const ready = await t.until(() => lab.kept().includes('tighten') || failures.length > 0, MOST.quietly * 1000, 'the next level to be read quietly');
  if (failures.length > 0) {
    t.assert(false, `the next level could not be read quietly: ${failures[0]}`);
  } else if (ready) {
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

// --- slips of the pen ---------------------------------------------------------------------------------

// The last thing, since it puts another page in the window: one with slips in it that any
// reader would catch, so that there is something for the answer to hold.
{
  editor.setState({
    html: '<p><br></p><p># A page with slips</p><p><br></p><p>Teh first paragraph has has a slip or two, and it goes on a little after it has made its point.</p><p><br></p><p>The second is fine.</p>',
    groups: {},
    overflow: '',
  });
  await t.settle();
  const before = editor.getState().html;
  const pass = await mark('Fix punctuation and typos', /^Fix punctuation and typos \d+ found$/);
  t.assert(pass.found && pass.marked.some((text) => text.includes('Teh')), `the slips are found, "Teh" among them: ${JSON.stringify(pass.marked)} ${pass.said}`);
  t.equal(editor.getState().html, before, 'and nothing is changed until the writer says so');
  lab.dismiss();
}
