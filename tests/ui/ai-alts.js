// AI alternatives (design spec 6.6), against the scripted provider of a scripted run.
const { editor, ui, panel, sound, commands } = window.writeOn;
ui.set({ read: false });
await document.fonts.ready;
await t.settle();

const ticks = [];
sound.tick = (tone) => ticks.push(tone);
const heard = () => ticks.splice(0).join(' ');

/** Tells the provider what to answer next: { chunks, firstMs, everyMs } or { error, firstMs }. */
const answer = (script) => t.call('test.ai', { set: script });
const provider = () => t.call('test.ai', {});
const lines = (...items) => ({ chunks: items.map((item) => `${item}\n`), firstMs: 40, everyMs: 20 });

const el = document.getElementById('panel');
const rows = () => [...el.querySelectorAll('.row')];
const rowTexts = () => rows().map((r) => r.querySelector('.text').textContent);
const asking = () => el.querySelector('.row.asking');
const hint = () => el.querySelector('.hint').textContent;
const focusedRow = () => rows().findIndex((r) => r.contains(document.activeElement));
const docText = (i) => editor.blocks[i].runs.map((r) => r.text).join('');
const until = (check, what, ms = 4000) => t.until(check, ms, what);
const PARA = 3;
const KEEPS = ['keeps', 'remembers', 'holds on to'];

// --- ?? in a row ----------------------------------------------------------------------------------

editor.select({ block: PARA, offset: docText(PARA).indexOf('keeps') + 2 });
panel.open();
t.equal(rowTexts(), KEEPS, 'the panel is on a word with three variants');
// The model answers in pieces, with a repeat, bullets, quotes, numbering and one too many.
await answer({ chunks: ['ret', 'ains\nkeeps\n', '- stores\n"guards"\n', '1. saves\nhoards\nextra one\n'], firstMs: 60, everyMs: 40 });

await t.key('Enter');
await t.type('?');
t.equal(editor.groups.k33ps01.variants.at(-1), '?', 'one question mark is just text, and a variant');
const asked = performance.now();
await t.type('?');
t.equal(editor.groups.k33ps01.variants, KEEPS, 'the second makes the row a request, not a variant');
t.equal(heard(), 'high low', 'what shows went to "?" and back');
{
  const row = asking();
  t.assert(row !== null, 'the row is asking');
  const marks = [...row.querySelectorAll('.q')];
  t.equal(marks.map((q) => q.textContent), ['?', '?'], 'it holds the two question marks');
  t.equal(getComputedStyle(marks[0]).color, 'rgb(129, 124, 212)', 'in the accent colour');
  t.equal(getComputedStyle(marks[0]).fontWeight, '700', 'bold');
  t.assert(marks.every((q) => q.getAnimations().length === 1), 'each dancing');
  t.assert(marks[0].getAnimations()[0].effect.getComputedTiming().duration !== marks[1].getAnimations()[0].effect.getComputedTiming().duration, 'to its own beat');
  t.equal(row.querySelector('.text').isContentEditable, false, 'and is not for typing in while it asks');
}

// What was asked: the paragraph with the target marked, what the writer already has, and how many.
await until(async () => (await provider()).requests.length === 1, 'the request to reach the provider');
{
  const [request] = (await provider()).requests;
  const said = request.messages.map((m) => m.content).join('\n');
  t.assert(said.includes('This one [[keeps]] the others too'), 'the request shows the word in its paragraph');
  t.assert(KEEPS.every((v) => said.includes(`- ${v}`)), 'and lists the variants already there');
  t.assert(/Give 5 alternatives/.test(said), 'five for a word');
  t.equal([request.effort, request.maxTokens >= 120], ['low', true], 'quickly, with room to answer');
}

// The answer is back within a quarter of a second, but the marks dance for at least 750ms,
// and then the suggestions come one after another.
const arrivals = [];
const seen = []; // the list as it stood at each arrival
const dotsAt = []; // and, a frame later, the dots under the word in the page
const dotsUnderWord = () => document.querySelectorAll(`#decor g[data-vid="${panel.target()}"] circle.dot`).length;
const watcher = new MutationObserver(() => {
  const count = el.querySelectorAll('.row.arriving').length;
  while (arrivals.length < count) {
    arrivals.push(performance.now() - asked);
    seen.push({ texts: rowTexts(), asking: rows().findIndex((r) => r.classList.contains('asking')) });
    const rowsNow = rows().length;
    requestAnimationFrame(() => requestAnimationFrame(() => dotsAt.push([rowsNow, dotsUnderWord()])));
  }
});
watcher.observe(el, { childList: true, subtree: true });
await t.wait(450);
t.equal(el.querySelectorAll('.row.arriving').length, 0, 'nothing arrives before the marks have danced');
t.assert(asking() !== null, 'they are still dancing');
await until(() => !asking() && el.querySelectorAll('.row.arriving').length === 0 && rows().length === 8, 'the suggestions to arrive and settle');
watcher.disconnect();
t.assert(arrivals[0] >= 740, `the first comes after 750ms (${Math.round(arrivals[0])})`);
t.equal(arrivals.length, 5, 'five of them');
t.assert(arrivals.slice(1).every((at, i) => at - arrivals[i] >= 90), `one after another (${arrivals.map(Math.round).join(', ')})`);
t.equal(seen[0], { texts: [...KEEPS, 'retains', '??'], asking: 4 }, 'each arrives as a row of its own, above the marks');
t.equal(seen[2], { texts: [...KEEPS, 'retains', 'stores', 'guards', '??'], asking: 6 }, 'in the order they came');
// The word in the page gains a dot with each row, the asking row's among them, as in the clip.
t.assert(dotsAt.length >= 3 && dotsAt.every(([rowsThen, dots]) => dots >= rowsThen), `the dots under the word keep up with the list: ${JSON.stringify(dotsAt)}`);

const WITH_AI = [...KEEPS, 'retains', 'stores', 'guards', 'saves', 'hoards'];
t.equal(rowTexts(), WITH_AI, 'the suggestions are rows, cleaned of bullets, quotes and numbers; the repeat and the sixth are dropped');
t.equal(rows().map((r) => r.classList.contains('ai')), [false, false, false, true, true, true, true, true], 'marked as the AI’s');
t.equal(editor.groups.k33ps01, { scope: 'word', variants: WITH_AI, active: 0, ai: WITH_AI.slice(3) }, 'and are variants of the group');
t.assert(docText(PARA).includes('This one keeps the others'), 'what shows has not changed');
t.equal(heard(), '', 'and their arrival is silent');
t.equal(focusedRow(), 0, 'the caret is back in the active row');

// The batch is one step.
await t.key('z', { meta: true });
t.equal(editor.groups.k33ps01.variants, KEEPS, 'one undo takes the whole batch away');
t.equal(rowTexts().filter(Boolean), KEEPS, 'rows and all');
await t.key('z', { meta: true, shift: true });
t.equal(editor.groups.k33ps01.variants, WITH_AI, 'and redo brings it back');
// An AI row is an ordinary row: it can be shown, and edited into the writer's own.
await t.key('ArrowDown');
await t.key('ArrowDown');
await t.key('ArrowDown');
t.assert(docText(PARA).includes('This one retains the others'), 'a suggestion can be shown');
await t.type('!');
t.equal(editor.groups.k33ps01.ai.includes('retains!'), false, 'and once edited it is no longer the AI’s');
t.assert(!rows()[3].classList.contains('ai'), 'nor marked so');
await t.key('z', { meta: true });
t.equal(editor.groups.k33ps01.ai.includes('retains'), true, 'undoing the edit gives it back to the AI');
for (let i = 0; i < 3; i++) await t.key('ArrowUp');
t.assert(docText(PARA).includes('This one keeps the others'), 'back to the first');
await t.key('Escape');
heard();

// --- from the shortcut, on a plain word -----------------------------------------------------------

await answer(lines('nook', 'edge', 'angle', 'bend', 'spot'));
editor.select({ block: 5, offset: docText(5).indexOf('corner') + 2 });
await t.key('g', { ctrl: true, shift: true });
t.assert(ui.get('panel'), 'Ctrl+Shift+G opens the panel');
t.equal(rowTexts()[0], 'corner', 'on the word at the caret');
t.assert(asking() !== null, 'and asks at once');
await until(() => !asking() && rows().length === 6, 'the suggestions for it');
{
  const vid = panel.target();
  t.equal(editor.groups[vid].variants, ['corner', 'nook', 'edge', 'angle', 'bend', 'spot'], 'the word has become a group with the suggestions');
  t.equal(editor.groups[vid].ai, ['nook', 'edge', 'angle', 'bend', 'spot'], 'all but the original are the AI’s');
  const said = (await provider()).requests.at(-1).messages.map((m) => m.content).join('\n');
  t.assert(said.includes('top-left [[corner]] to turn'), 'the request marked the word');
  await t.key('Escape');
  t.equal(editor.groups[vid].variants.length, 6, 'and the group outlives the panel');
  await t.key('z', { meta: true });
  t.equal(editor.groups[vid], undefined, 'one undo and the word is plain again');
}

// A sentence gets three, however many are offered.
await answer(lines('Say it several ways', 'More than one way to say it', 'Write it twice', 'Try it again', 'One more'));
editor.select({ block: 1, offset: 4 });
commands.run('ai-alternatives');
await until(() => !asking() && rows().length === 6, 'the versions of the heading');
t.equal(editor.groups.t1tle01.variants.slice(3), ['Say it several ways', 'More than one way to say it', 'Write it twice'], 'three for a sentence');
{
  const request = (await provider()).requests.at(-1);
  t.assert(/Give 3 other versions/.test(request.messages.at(-1).content) && request.maxTokens >= 400, 'asked for as a sentence');
}
await t.key('z', { meta: true });
await t.key('Escape');

// --- when it fails --------------------------------------------------------------------------------

const before = JSON.stringify(editor.getState());
await answer({ error: 'The gateway is not answering (503).', firstMs: 60 });
editor.select({ block: PARA, offset: docText(PARA).indexOf('keeps') + 2 });
panel.open();
await t.key('Enter');
await t.type('??');
t.assert(asking() !== null, 'asking');
await until(() => !asking(), 'the failure to come back');
{
  const row = rows().at(-1);
  t.assert(row.classList.contains('shake'), 'the row shakes');
  t.equal(row.querySelector('.text').textContent, '??', 'and keeps its question marks, still');
  t.equal(hint(), 'The gateway is not answering (503).', 'the reason shows where the hint was');
  t.equal(JSON.stringify(editor.getState()) === before, true, 'and the document is untouched');
  t.equal(rowTexts(), [...WITH_AI, '??'], 'no rows came or went');
  t.equal(el.querySelectorAll('.row.arriving').length, 0, 'nothing half-arrived is left');
  t.equal(focusedRow(), rows().length - 1, 'the caret is in the row, to try again or type over it');
}
// Trying again: deleting a mark and typing it back asks again; a good answer replaces the reason.
await answer(lines('clings to'));
await t.key('Backspace');
t.equal(asking(), null, 'one question mark is not a request');
await t.type('?');
t.assert(asking() !== null, 'two are, again');
await until(() => !asking() && editor.groups.k33ps01.variants.includes('clings to'), 'the second attempt to work');
t.equal(hint(), 'return adds · esc closes', 'the hint is back');
await t.key('z', { meta: true });

// An answer with nothing usable in it is a failure too.
await answer(lines('keeps', '  ', 'Remembers', '"holds on to"'));
await t.key('Enter');
await t.type('??');
await until(() => !asking(), 'the empty answer to come back');
t.assert(rows().at(-1).classList.contains('shake'), 'nothing new: the row shakes');
t.assert(/nothing new/i.test(hint()), `and says so (${hint()})`);
t.equal(JSON.stringify(editor.getState()) === before, true, 'with the document as it was');
// The reason gives way to the hint after a few seconds.
await t.wait(4300);
t.equal(hint(), 'return adds · esc closes', 'the reason goes away by itself');

// --- stopping -------------------------------------------------------------------------------------

// Closing the panel while it asks calls the request off.
await answer({ chunks: ['late\n'], firstMs: 900, everyMs: 10 });
for (let i = 0; i < 2; i++) await t.key('Backspace');
await t.type('??');
await until(async () => (await provider()).requests.length >= 6, 'the slow request to start');
const slow = (await provider()).requests.at(-1).id;
await t.key('Escape');
t.assert(!ui.get('panel'), 'Esc closes the panel while it is asking');
await until(async () => (await provider()).cancelled.includes(slow), 'the request to be called off');
await t.wait(1100);
t.equal(editor.groups.k33ps01.variants.includes('late'), false, 'and its answer goes nowhere');
t.equal(JSON.stringify(editor.getState()) === before, true, 'the document is as it was');

// So does moving the panel to another word.
await answer({ chunks: ['later\n'], firstMs: 900, everyMs: 10 });
editor.select({ block: PARA, offset: docText(PARA).indexOf('keeps') + 2 });
commands.run('ai-alternatives');
t.assert(asking() !== null, 'asking about one word');
await t.click(...t.pointOfText('pointer'));
t.equal(rowTexts(), ['pointer', ''], 'the panel moves to another');
t.equal(asking(), null, 'and is not asking any more');
await t.wait(1100);
t.equal(editor.groups.k33ps01.variants.includes('later'), false, 'no late arrival');
await t.key('Escape');
t.equal(JSON.stringify(editor.getState()) === before, true, 'and the document is still as it was');
