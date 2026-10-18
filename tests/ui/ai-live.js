// launch: --timeout 1200
// The real AI service (design spec 7.1; plan: Task 22). This asks for real, with the real key,
// so under scripts/check.sh, where every scenario is given the scripted provider, it steps
// aside. To run it:
//
//   scripts/ui-test.sh ai-live --ai live
//
// The service is the one your login shell names (WRITEON_BASE_URL, WRITEON_MODEL), or
// LunaRoute and glm-5.3 if it names none; the times it allows are that model's, and
// they are long, which is why the run is given twenty minutes (above) where others get one.
// It is spoken to OpenAI's way unless the shell or the address says Anthropic's, and both
// ways are worth a run (LunaRoute speaks both):
//
//   WRITEON_API_FORMAT=anthropic scripts/ui-test.sh ai-live --ai live
//
// It asks for five other words, three other sentences, the hedges in the welcome piece, a
// trim of that piece and of a longer draft at every level, and the slips put into that draft,
// then mends one by hand and fixes another on a walk through them. It never sees the key: the
// shell holds it and says only where it came from.
const { editor, ui, commands, lab } = window.writeOn;
const { plainText } = await import('./src/doc/format.js');
if (!(await t.call('test.options')).aiLive) {
  t.log('skipped: this run does not ask the real service (scripts/ui-test.sh ai-live --ai live does)');
  return;
}
ui.set({ read: false });
await document.fonts.ready;
await t.settle();

// Which way the service is being spoken to, and how long each thing may take. These are
// bounds for a run to end by, not what is expected: LunaRoute's model mostly answers a trim
// of the welcome piece in four to eleven seconds and of the 500-word draft below in eight to
// twenty-five, but now and then it thinks first, for half a minute or more. (The times
// measured are in the README and the spec.)
const anthropic = await (async () => {
  const s = await t.call('test.settings');
  return (s.format === 'auto' ? s.formatHint : s.format).toLowerCase().includes('anthropic');
})();
const MOST = anthropic ? { word: 15, sentence: 20, mark: 120, trim: 120, draft: 240 } : { word: 15, sentence: 20, mark: 60, trim: 60, draft: 120 }; // seconds
t.log(`asked ${anthropic ? 'Anthropic' : 'OpenAI'}’s way`);

// How many requests this scenario has made of the service, and the last of them.
let asked = 0;
let lastAsked = null;
{
  const client = window.writeOn.ai;
  const start = client.start;
  client.start = (request, onText) => {
    asked += 1;
    lastAsked = request;
    return start.call(client, request, onText);
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

// What Settings lists to pick from: what the service says it has that can answer the app.
{
  const { models, modelHint } = await t.call('test.settings');
  t.log(`Settings lists ${models.length} models: ${models.join(', ')}`);
  t.assert(models.includes(modelHint), `among them the model in force (${modelHint})`);
  t.assert(!models.some((name) => /whisper|transcribe|image/.test(name)), 'and none that only transcribes or draws');
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

// --- trims ---------------------------------------------------------------------------------------

// A trim is asked for once: of each sentence, what it could lose and how much the piece needs
// it. The four levels are then counted out from that one answer, so the first is the wait and
// the rest are there at once. (Asked level by level to cut to a number of words, this model
// took 24 seconds to four minutes a level, and gave a twelfth where half was asked.)
/**
 * Reads the piece on the page at "Slight trim", then goes to each of the other levels.
 * `bounds` is the percentage each may come to, lightest first; `most` the seconds the reading may take.
 */
const trims = async (what, bounds, most) => {
  const card = $('#labcard');
  const menu = $('#labmenu');
  const title = () => card.querySelector('.title').textContent.replace(/\s+/g, ' ').trim();
  const levelNamed = (name) => [...menu.querySelectorAll('.level')].find((level) => level.querySelector('.name').textContent === name);
  const choose = async (name) => {
    await t.click(...t.center('#lab'));
    await t.until(() => ui.get('lab') && menu.getAnimations({ subtree: false }).length === 0, 2000, 'the Lab to open');
    await t.click(...t.center(levelNamed(name)));
  };
  const cuts = () => [...new Set([...editor.root.querySelectorAll('[data-trim]')].map((span) => span.dataset.trim))].length;
  const before = editor.getState().html;
  const asks = asked;
  // When the first cuts are faded: the answer is every sentence again, and they are shown as they come.
  let firstCut = null;
  const began = performance.now();
  const watcher = new MutationObserver(() => {
    if (firstCut === null && editor.root.querySelector('[data-trim]')) firstCut = performance.now() - began;
  });
  watcher.observe(editor.root, { childList: true, subtree: true });
  await choose('Slight trim');
  await t.until(() => /words ·/.test(title()) || lab.pass() === 'failed', most * 1000 + 15000, `the trim of ${what} to come back`);
  watcher.disconnect();
  const total = performance.now() - began;
  t.log(`a trim of ${what}, read in ${seconds(total)}${firstCut === null ? '' : `, the first cuts faded after ${seconds(firstCut)}`}`);
  t.assert(total < most * 1000, `in good time: ${seconds(total)}`);
  if (!t.assert(lab.pass() === 'proposal', `the reading gave a proposal: ${title()} / ${card.querySelector('.hint')?.textContent ?? ''}`)) {
    lab.dismiss();
    lab.forget();
    return;
  }
  let last = 0;
  for (const [i, name] of ['Slight trim', 'Tighten more', 'Even sharper', 'Cut in half'].entries()) {
    const [low, high] = bounds[i];
    const at = performance.now();
    if (i > 0) await choose(name);
    const found = new RegExp(`^${name} (\\d+) → (\\d+) words · −(\\d+)%$`).exec(title());
    if (!t.assert(found, `${name} counts the words before and after${i > 0 ? ', at once' : ''}: ${title()}`)) continue;
    const [from, to, percent] = found.slice(1).map(Number);
    t.log(`    ${name}: ${from} → ${to} words, −${percent}%, in ${cuts()} cuts${i > 0 ? `, there in ${seconds(performance.now() - at)}` : ''}`);
    t.assert(percent >= low && percent <= high, `${name} takes about what it says: −${percent}% (${low} to ${high})`);
    t.assert(percent > last, `and more than the level before: −${percent}% after −${last}%`);
    last = percent;
    if (i === 0) for (const span of editor.root.querySelectorAll('[data-trim]')) t.log(`        cut: ${span.textContent}`);
    if (i === 0) await t.snap(`trim-${what.replace(/\W+/g, '-')}`);
  }
  t.assert(asked - asks <= 2, `for all four the model was asked once, or twice if its first answer left most of the piece out: ${asked - asks}`);
  t.equal(editor.getState().html, before, 'and until the writer says so, nothing is cut');
  // What the deepest would leave is still writing: every sentence whole, a space between them.
  // (The cuts are ghosted: the piece as it reads leaves them out.)
  await t.click(...t.center([...card.querySelectorAll('.actions button')].find((button) => button.textContent === 'Make the cuts')));
  await t.settle();
  const left = plainText(editor.getState(), { withoutGhost: true, headingMarker: false }).split('\n').filter((line) => line !== '');
  // No space at either end, no two together, none before a comma or a stop, and one after every sentence.
  const untidy = (text) => text !== text.trim() || /\s{2,}|[.!?][A-Za-z]|\s[,.;:]/.test(text);
  t.assert(left.length > 0 && !left.some(untidy), `cut in half it still reads as text: ${JSON.stringify(left.find(untidy) ?? '')}`);
  for (const text of left) t.log(`        | ${text}`);
  await t.key('z', { meta: true });
  t.equal(editor.getState().html, before, 'and one undo has it all back');
  lab.dismiss();
  lab.forget(); // nothing more is asked once this is over
};

// The welcome piece: fifteen short sentences in six paragraphs, most of them its point.
await trims('the welcome piece', [[5, 15], [14, 26], [23, 37], [35, 60]], MOST.trim);

// A draft of about five hundred words with padding in it, written for this test.
const DRAFT = [
  '# Why we stopped doing weekly status meetings',
  'For about three years, we basically had a standing status meeting every single Monday morning at ten, and honestly I think most of us kind of assumed that it was just one of those things that a team has to do in order to stay coordinated.',
  'The format was pretty simple, really. Everyone would go around the room, one person at a time, and say what they had worked on last week and what they were planning to work on this week. In theory this was supposed to keep everybody informed. In practice, though, what it actually did was make eleven people sit and listen to updates that mostly had nothing at all to do with their own work.',
  'I want to be fair about this, because the meeting was not completely useless. Every now and then somebody would mention something in passing, and somebody else would say wait, I am working on that too, and the two of them would go and sort it out afterward. Those moments were genuinely valuable. But they happened maybe once a month, and we were paying for them with roughly forty-four hours of meeting time, which is a lot.',
  'So last spring we decided to try a little experiment. Instead of meeting, each person would write a short note on Monday, just three or four lines, about what they were doing and where they were stuck. The notes would all go in one shared place where anybody could read them whenever they wanted to. If something in a note concerned you, you would reply to it directly.',
  'To be perfectly honest, I expected this to fail. I thought people would simply stop writing the notes after a couple of weeks, the way that people tend to stop doing most things that are not enforced. That is not what happened. It turned out that writing three lines is a great deal easier than preparing to speak in front of ten colleagues, and the notes kept coming.',
  'What surprised me most of all was the quality. When people talk in a meeting they tend to ramble a bit, and they pad things out, because silence feels awkward. When they write, they get to the point. The notes were shorter than the spoken updates had been, and yet somehow they said more.',
  'We did lose something, and I do not want to pretend otherwise. There is a kind of ambient closeness that comes from being in a room together every week, and a shared document does not really give you that. We ended up adding a much looser get-together on Fridays, with no agenda whatsoever, to make up for it.',
  'If your team has a meeting that everyone quietly dreads, it might be worth asking what the meeting is actually for, and whether there is a cheaper way of getting the same thing. In our case there was. It took us three years to think of looking.',
];
{
  editor.setState({ html: `<p><br></p>${DRAFT.map((line) => `<p>${line}</p><p><br></p>`).join('')}`, groups: {}, overflow: '' });
  await t.settle();
  await trims('a longer draft', [[6, 14], [15, 25], [24, 36], [42, 58]], MOST.draft);
}

// --- slips of the pen ---------------------------------------------------------------------------------

// The last thing, since it puts another page in the window: the draft again, with slips put in
// it that any reader would catch, so that there is something for the answer to hold. Then what
// a writer does with them: one mended by hand, and a walk through the rest, fixing as it goes.
{
  // [as it was, as it is put in, the slip]
  const PUT_IN = [
    ['Why we stopped', 'Why we stoped', 'stoped'],
    ['we basically had', 'we basicly had', 'basicly'],
    ['The format was', 'Teh format was', 'Teh'],
    ['because the meeting', 'because the the meeting', 'the the'],
    ['What surprised me', 'What suprised me', 'suprised'],
  ];
  const slipped = DRAFT.map((line) => PUT_IN.reduce((made, [right, wrong]) => made.replace(right, wrong), line));
  editor.setState({ html: `<p><br></p>${slipped.map((line) => `<p>${line}</p><p><br></p>`).join('')}`, groups: {}, overflow: '' });
  await t.settle();
  const before = editor.getState().html;
  const pass = await mark('Fix punctuation and typos', /^Fix punctuation and typos \d+ found$/);
  const caught = PUT_IN.map(([, , slip]) => slip).filter((slip) => pass.marked.some((text) => text.includes(slip)));
  t.log(`of the ${PUT_IN.length} slips put in, ${caught.length} found: ${JSON.stringify(caught)}`);
  t.assert(lastAsked.messages.at(-1).content.includes('[1] Why we stoped doing'), 'the heading goes to the model too, first');
  t.assert(pass.found && pass.marked.some((text) => text.includes('Teh')) && pass.marked.length >= 2, `the slips are found, "Teh" among them: ${JSON.stringify(pass.marked)} ${pass.said}`);
  t.equal(editor.getState().html, before, 'and nothing is changed until the writer says so');

  const card = $('#labcard');
  const title = () => card.querySelector('.title').textContent.replace(/\s+/g, ' ').trim();
  const hint = () => card.querySelector('.hint').textContent;
  const marks = () => {
    const found = new Map();
    for (const span of editor.root.querySelectorAll('[data-mark]')) found.set(span.dataset.mark, (found.get(span.dataset.mark) ?? '') + span.textContent);
    return [...found.values()];
  };
  const act = async (label) => {
    const button = [...card.querySelectorAll('.actions button')].find((b) => b.textContent === label);
    if (t.assert(button, `the card has a ${label} button`)) await t.click(...t.center(button));
  };

  // "Teh" mended by hand: its mark goes, and only its mark.
  const others = pass.marked.filter((text) => !text.includes('Teh'));
  t.selectText('Teh');
  await t.type('The');
  t.equal(marks(), others, 'mending a slip by hand takes away its mark and leaves the rest');
  t.equal(title(), `Fix punctuation and typos ${others.length} found`, 'and the card counts what is left');

  // A walk: Fix makes the first fix in the text, there and then.
  await act('Walk through');
  const asked = hint();
  const current = editor.root.querySelector('[data-mark].is-current');
  const paragraph = current.closest('p');
  const block = [...editor.root.children].indexOf(paragraph);
  const range = document.createRange();
  range.setStart(paragraph, 0);
  range.setEnd(current.firstChild ?? current, 0);
  const offset = range.toString().length;
  const replace = asked.slice(asked.indexOf(' → ') + 3, asked.includes(' · ') ? asked.lastIndexOf(' · ') : undefined);
  const was = textOf(block);
  await act('Fix');
  t.log(`walked: ${asked}`);
  t.equal(textOf(block).slice(offset, offset + replace.length), replace, 'Fix makes the fix where the mark was');
  t.assert(textOf(block) !== was, 'so the paragraph is changed');
  t.equal(
    [marks().length, others.length > 1 ? title() : getComputedStyle(card).visibility],
    [others.length - 1, others.length > 1 ? `Fix punctuation and typos 2 of ${others.length}` : 'hidden'],
    'its mark goes, and the walk goes on to the next',
  );
  await t.key('z', { meta: true });
  t.equal(textOf(block), was, 'one undo takes that fix back');
  lab.dismiss();
}
