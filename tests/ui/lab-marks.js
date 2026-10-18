// The Lab's marking passes, its typo pass and its guide (design spec 6.10 and section 9,
// items 2, 4 and 5). The clips name these but never run them, so this is the replica's own
// reading of them: the model points, and only the typo pass may change a letter, by asking.
const { editor, ui, lab } = window.writeOn;
ui.set({ read: false });
await document.fonts.ready;

const $ = (s) => document.querySelector(s);
const menu = $('#labmenu');
const card = $('#labcard');
const scan = $('#scan');
const tip = $('#labtip');
if (!t.assert(menu && card && tip, 'the page has the Lab’s popover, card and label')) return;

const shown = (node) => getComputedStyle(node).visibility === 'visible' && getComputedStyle(node).opacity !== '0';
const html = () => editor.getState().html;
const textOf = (i) => editor.blocks[i].runs.map((r) => r.text).join('');
const row = (label) => [...menu.querySelectorAll('.row')].find((node) => node.querySelector('.label').textContent === label);
const pending = () => [...menu.querySelectorAll('.level')].find((b) => b.classList.contains('is-pending'))?.querySelector('.name').textContent;
const actions = () => [...card.querySelectorAll('.actions button')].map((button) => button.textContent);
const act = async (label) => {
  const button = [...card.querySelectorAll('.actions button')].find((b) => b.textContent === label);
  if (!t.assert(button, `the card has a ${label} button`)) return;
  await t.click(...t.center(button));
};
const title = () => card.querySelector('.title').textContent.replace(/\s+/g, ' ').trim();
const hint = () => card.querySelector('.hint').textContent;
/** What is marked, one string per mark, in the order of the page. */
const marked = () => {
  const marks = new Map();
  for (const span of editor.root.querySelectorAll('[data-mark]')) marks.set(span.dataset.mark, (marks.get(span.dataset.mark) ?? '') + span.textContent);
  return [...marks.values()];
};
const markOf = (text) => [...editor.root.querySelectorAll('[data-mark]')].find((span) => span.textContent.includes(text));
const openMenu = async () => {
  if (!ui.get('lab')) await t.click(...t.center('#lab'));
  await t.until(() => menu.getAnimations({ subtree: false }).length === 0, 1500, 'the popover to finish opening');
};
const pick = async (label) => {
  await openMenu();
  await t.click(...t.center(row(label)));
};
/** What the model is made to answer, and how soon. */
const answer = (payload, { firstMs = 60, error = null, hold = false } = {}) =>
  t.call('test.ai', { set: error ? { error, firstMs, hold } : { chunks: [JSON.stringify(payload)], firstMs, everyMs: 20, hold } });
/** Lets a held answer come. */
const release = () => t.call('test.ai', { release: true });
const lastAsked = async () => {
  const { requests } = await t.call('test.ai');
  return requests[requests.length - 1].messages.map((m) => m.content).join('\n');
};
const count = async () => (await t.call('test.ai')).requests.length;

const P1 = 'Teh first paragraph has has a slip or two, and it is really quite long because it keeps going after it has made its point.';
const DOC =
  '<p><br></p><p># A page with slips</p><p><br></p>' +
  `<p>${P1}</p><p><br></p>` +
  '<p>Keep <span data-ghost>this aside </span>the second <span data-vid="r3aly01">realy</span> plain ,and stop there.</p><p><br></p>' +
  '<p>The third is fine.</p>';
const GROUPS = { r3aly01: { scope: 'word', variants: ['realy', 'truly'], active: 0 } };
const load = async () => {
  editor.setState({ html: DOC, groups: structuredClone(GROUPS), overflow: '' });
  editor.focus();
  editor.select({ block: 7, offset: 0 });
  await t.settle();
};
await load();
const before = html();

// --- a marking pass -------------------------------------------------------------------------------

const MARKS = {
  marks: [
    { n: 1, text: 'really quite', reason: 'Two hedges in a row.' },
    { n: 2, text: 'plain', reason: 'Says little here.' },
    { n: 1, text: 'words that are not there', reason: 'Made up.' },
  ],
};
const WHY = 'Hover a mark to see why. Click one to dismiss it.';
// The answer waits until the test releases it, so the test sees the reading state on a slow
// Mac too. A delay of 0.9 s was used before, and on a slow Mac at GitHub the answer came first.
await answer(MARKS, { firstMs: 0, hold: true });
await pick('Mark hedges and filler');
t.assert(!ui.get('lab'), 'choosing an idea closes the popover');
t.equal(title(), 'Mark hedges and filler Reading…', 'a card names the pass and says it is reading');
t.equal([hint(), actions().join(' | ')], [WHY, 'Done'], 'with what the marks will mean, and Done');
t.equal(card.getBoundingClientRect().width, 500, 'the same 500px card as a trim’s');
t.assert(getComputedStyle(scan).visibility === 'visible' && scan.getAnimations().length === 1, 'the line reads down the page as for a trim');
{
  const said = await lastAsked();
  t.assert(said.includes(`[1] ${P1}`) && said.includes('[2] Keep the second realy plain ,and stop there.') && said.includes('[3] The third is fine.'), 'the paragraphs go to the model, numbered');
  t.assert(!said.includes('this aside') && !said.includes('A page with slips'), 'without ghosted text or the heading');
  t.assert(/hedges and filler/.test(said), 'with what to look for');
}
await release();
await t.until(() => marked().length > 0, 4000, 'the marks to arrive');
t.equal(marked(), ['really quite', 'plain'], 'what the model quoted is marked; a quote that is not in the text is dropped');
t.same(html(), before, 'the text itself is untouched');
t.assert(!editor.canUndo, 'and there is nothing to undo');
{
  const style = getComputedStyle(markOf('really quite'));
  t.equal([style.textDecorationLine, style.textDecorationColor, style.opacity], ['underline', 'rgb(200, 16, 66)', '1'], 'a mark is an underline in the Lab’s crimson, the words at full strength');
  t.equal(title(), 'Mark hedges and filler 2 marked', 'the card counts the marks');
  t.equal(getComputedStyle(scan).visibility, 'hidden', 'and the line is gone');
  await openMenu();
  t.equal(pending(), 'Original', 'marks are not a trim: Original stays the level marked');
  await t.key('Escape');
}

// The reason shows by the mark the pointer is on.
{
  t.assert(!shown(tip), 'no label to begin with');
  const mark = markOf('really quite').getBoundingClientRect();
  await t.hover(mark.left + mark.width / 2, mark.top + mark.height / 2);
  t.assert(shown(tip), 'resting the pointer on a mark shows a label');
  t.equal(tip.textContent, 'Two hedges in a row.', 'with the reason');
  const box = tip.getBoundingClientRect();
  t.assert(box.bottom <= mark.top + 2 && box.bottom > mark.top - 14, `just above the mark: ${Math.round(box.bottom)} over ${Math.round(mark.top)}`);
  t.near(box.left + box.width / 2, mark.left + mark.width / 2, 1, 'and centered on it');
  const style = getComputedStyle(tip);
  t.equal([style.backgroundColor, style.color, style.fontSize], ['rgb(18, 21, 34)', 'rgb(245, 209, 192)', '12px'], 'a small label in the popover’s colors');
  await t.snap('marks');
  await t.hover(300, 300);
  t.assert(!shown(tip), 'and moving away puts it away');
}

// A click dismisses a mark; the last one takes the card with it.
{
  const mark = markOf('really quite').getBoundingClientRect();
  await t.click(mark.left + mark.width / 2, mark.top + mark.height / 2);
  t.equal(marked(), ['plain'], 'a click on a mark dismisses it');
  t.equal(title(), 'Mark hedges and filler 1 marked', 'and the card counts one fewer');
  t.assert(!shown(tip), 'its label goes with it');
  t.same(html(), before, 'without touching the text');
  await t.click(...t.center(markOf('plain')));
  t.equal([marked().length, getComputedStyle(card).visibility], [0, 'hidden'], 'dismissing the last mark puts the card away');
}

// Done clears them all. An edit takes away only the marks on the words it changes.
await answer(MARKS);
await pick('Mark hedges and filler');
await t.until(() => marked().length === 2, 4000, 'the marks again');
await act('Done');
t.equal([marked().length, getComputedStyle(card).visibility], [0, 'hidden'], 'Done clears the marks');
t.same(html(), before, 'and leaves the text as it was');
await pick('Mark hedges and filler');
await t.until(() => marked().length === 2, 4000, 'the marks once more');
editor.focus();
editor.select({ block: 7, offset: 0 });
await t.type('x');
t.equal(textOf(7), 'xThe third is fine.', 'typing away from the marks goes where the caret is');
t.equal([marked(), title()], [['really quite', 'plain'], 'Mark hedges and filler 2 marked'], 'and leaves the marks where they are');
t.selectText('plain');
getSelection().collapseToEnd();
await t.key('Backspace');
t.equal([marked(), title()], [['really quite'], 'Mark hedges and filler 1 marked'], 'an edit to marked words takes their mark away, and no other');
await t.type('n');
t.equal(textOf(5), 'Keep this aside the second realy plain ,and stop there.', 'and the caret stays where the edit was');
await load();

// Each idea asks its own question.
for (const [label, asks] of [
  ['Mark the weakest sentences', /weakest sentences/],
  ['Mark sentences that run long', /run long/],
  ['Mark convoluted sentences', /convoluted sentences/],
  ['Mark words that don’t fit the tone', /do not fit the tone/],
  ['Mark hedges and filler', /hedges and filler/],
]) {
  await answer({ marks: [{ n: 3, text: 'fine', reason: 'For the test.' }] });
  await pick(label);
  await t.until(() => marked().length === 1, 4000, `the mark for “${label}”`);
  t.assert(asks.test(await lastAsked()), `“${label}” asks the model for that`);
  t.equal(title(), `${label} 1 marked`, `and reports under its own name (${label})`);
  await act('Done');
}

// Nothing to mark, and a request that fails.
{
  const asks = await count();
  await answer({ marks: [] });
  await pick('Mark convoluted sentences');
  await t.until(() => /nothing/.test(hint()), 3000, 'the card to say there is nothing');
  t.equal([title(), hint(), actions().join(' | ')], ['Mark convoluted sentences', 'The AI marked nothing.', 'Done'], 'an answer with no marks says so');
  t.equal(await count(), asks + 1, 'from one request: nothing to mark is an answer');
  await act('Done');
}
await answer(null, { error: 'No AI key is set. Add one in Settings.' });
await pick('Mark convoluted sentences');
await t.until(() => /key/.test(hint()), 3000, 'the reason to show');
t.equal([title(), hint(), actions().join(' | ')], ['Mark convoluted sentences', 'No AI key is set. Add one in Settings.', 'Done'], 'a failure gives the reason in one line');
t.same(html(), before, 'and the text is untouched');
await act('Done');

// A pass replaces whatever pass was out.
await answer({ sentences: [{ s: 3, text: 'The third is.', need: 5 }] });
await openMenu();
await t.click(...t.center([...menu.querySelectorAll('.level')][1]));
await t.until(() => editor.root.querySelectorAll('[data-trim]').length > 0, 4000, 'a trim proposal');
await answer(MARKS);
await pick('Mark hedges and filler');
t.equal(editor.root.querySelectorAll('[data-trim]').length, 0, 'starting a marking pass puts a trim proposal away');
await t.until(() => marked().length === 2, 4000, 'the marks');
await answer({ sentences: [{ s: 3, text: 'The third is.', need: 5 }] });
await openMenu();
await t.click(...t.center([...menu.querySelectorAll('.level')][1]));
t.equal(marked().length, 0, 'and a trim puts marks away');
await t.until(() => editor.root.querySelectorAll('[data-trim]').length > 0, 4000, 'the trim proposal');
await act('Cancel');

// --- the typo pass --------------------------------------------------------------------------------

// The typo pass reads the heading too, so the heading is [1] and the paragraphs follow it.
const FIXES = {
  fixes: [
    { n: 2, find: 'Teh', replace: 'The', reason: 'Misspelled.' },
    { n: 2, find: 'has has', replace: 'has', reason: 'Said twice.' },
    { n: 3, find: 'realy', replace: 'really', reason: 'Misspelled.' },
    { n: 3, find: ' ,and', replace: ', and', reason: 'Space before the comma.' },
    { n: 4, find: 'fine', replace: 'fine', reason: 'Nothing to change.' },
  ],
};
const FIX_HINT = 'Hover a mark to see the fix. Click one to keep the original.';
await answer(FIXES, { firstMs: 0, hold: true });
await pick('Fix punctuation and typos');
t.equal([title(), hint(), actions().join(' | ')], ['Fix punctuation and typos Reading…', FIX_HINT, 'Done'], 'the typo pass reads like the others');
t.assert(/spelling and punctuation/.test(await lastAsked()), 'and asks about spelling and punctuation');
t.assert((await lastAsked()).includes('[1] A page with slips\n[2] Teh first'), 'of the heading as well as the paragraphs');
await release();
await t.until(() => marked().length > 0, 4000, 'the fixes to arrive');
t.equal(marked(), ['Teh', 'has has', 'realy', ' ,and'], 'each slip is marked; a “fix” that changes nothing is dropped');
t.equal([title(), actions().join(' | ')], ['Fix punctuation and typos 4 found', 'Fix all | Walk through | Done'], 'the card counts them and offers to fix them');
t.same(html(), before, 'nothing is changed yet');
{
  const mark = markOf('Teh').getBoundingClientRect();
  await t.hover(mark.left + mark.width / 2, mark.top + mark.height / 2);
  t.equal(tip.textContent, 'Teh → The · Misspelled.', 'the label shows the fix and why');
  await t.hover(300, 300);
}
{
  const [x, y] = t.center(markOf('has has'));
  const aimed = editor.positionFromPoint(x, y);
  await t.click(x, y);
  t.equal(marked(), ['Teh', 'realy', ' ,and'], 'a click on a mark keeps the original');
  t.equal(editor.selection()?.start, aimed, 'and leaves the caret where the click put it');
}
t.equal(title(), 'Fix punctuation and typos 3 found', 'and the card counts one fewer');
await act('Fix all');
t.equal(textOf(3), P1.replace('Teh', 'The'), 'Fix all makes the fixes that are left, and not the one that was kept');
t.equal(textOf(5), 'Keep this aside the second really plain, and stop there.', 'in every paragraph, around what is ghosted');
t.equal(editor.groups.r3aly01?.variants, ['really', 'truly'], 'a fix inside a group changes what the group is showing');
t.equal([marked().length, getComputedStyle(card).visibility], [0, 'hidden'], 'the marks and the card are gone');
await t.key('z', { meta: true });
t.same(html(), before, 'one undo takes every fix back');
t.assert(!editor.canUndo, 'it was a single step');
await load();

// Mending a slip by hand takes its mark away and leaves the others, even beside it.
await answer(FIXES);
await pick('Fix punctuation and typos');
await t.until(() => marked().length === 4, 4000, 'the fixes');
t.selectText('realy');
getSelection().collapseToEnd();
await t.key('Backspace');
t.equal([marked(), title()], [['Teh', 'has has', ' ,and'], 'Fix punctuation and typos 3 found'], 'mending a slip by hand takes its mark away, and only its mark');
await t.type('ly');
t.equal(textOf(5), 'Keep this aside the second really plain ,and stop there.', 'and what is typed next goes where the caret is');
await t.key('z', { meta: true });
t.equal([textOf(5), marked()], ['Keep this aside the second real plain ,and stop there.', ['Teh', 'has has', ' ,and']], 'an undo is an edit like any other: the other marks stay, on their words');
await t.key('z', { meta: true, shift: true });
t.equal([textOf(5), marked()], ['Keep this aside the second really plain ,and stop there.', ['Teh', 'has has', ' ,and']], 'and so is a redo');
t.selectText('Teh');
await t.type('The');
t.equal([textOf(3), marked()], [P1.replace('Teh', 'The'), ['has has', ' ,and']], 'a slip typed over loses its mark; the one beside it in the paragraph keeps its own');
await act('Fix all');
t.equal(
  [textOf(3), textOf(5)],
  [P1.replace('Teh', 'The').replace('has has', 'has'), 'Keep this aside the second really plain, and stop there.'],
  'Fix all makes the fixes that are left, where their words now are',
);
await load();

// Walking through the fixes: Fix makes the fix there and then, Keep leaves the words as they are.
await answer(FIXES);
await pick('Fix punctuation and typos');
await t.until(() => marked().length === 4, 4000, 'the fixes');
editor.select({ block: 3, offset: P1.length }); // the caret at the end of the first paragraph
await act('Walk through');
t.equal([title(), hint(), actions().join(' | ')], ['Fix punctuation and typos 1 of 4', 'Teh → The · Misspelled.', 'Fix | Keep | Stop'], 'the walk asks about each fix in turn, showing it');
t.equal(editor.root.querySelector('[data-mark].is-current')?.textContent, 'Teh', 'and points it out');
await act('Fix');
t.equal(textOf(3), P1.replace('Teh', 'The'), 'Fix makes that fix in the text');
t.equal(marked(), ['has has', 'realy', ' ,and'], 'its mark goes, and the others stay');
t.equal([title(), hint()], ['Fix punctuation and typos 2 of 4', 'has has → has · Said twice.'], 'and the walk goes on to the next');
t.equal(editor.root.querySelector('[data-mark].is-current')?.textContent, 'has has', 'pointing it out');
await act('Fix');
t.equal(textOf(3), P1.replace('Teh', 'The').replace('has has', 'has'), 'each Fix makes its fix');
t.equal(editor.selection()?.start, { block: 3, offset: P1.length - 4 }, 'and the caret stays with the words it was beside');
await act('Keep');
t.equal([textOf(5), marked()], ['Keep this aside the second realy plain ,and stop there.', [' ,and']], 'Keep leaves the words as they are and drops the fix');
t.equal([title(), hint()], ['Fix punctuation and typos 4 of 4', ' ,and → , and · Space before the comma.'], 'and goes on');
await act('Stop');
t.equal([title(), actions().join(' | '), hint()], ['Fix punctuation and typos 1 found', 'Fix all | Walk through | Done', FIX_HINT], 'Stop goes back to the summary of what is left');
await act('Walk through');
t.equal(title(), 'Fix punctuation and typos 1 of 1', 'a walk again goes through what is left');
await act('Fix');
t.equal(textOf(5), 'Keep this aside the second realy plain, and stop there.', 'the last Fix makes its fix');
t.equal([marked().length, getComputedStyle(card).visibility], [0, 'hidden'], 'and with nothing left the card is put away');
await t.key('z', { meta: true });
t.equal(textOf(5), 'Keep this aside the second realy plain ,and stop there.', 'each fix is a step of its own to undo');
await t.key('z', { meta: true });
await t.key('z', { meta: true });
t.same(html(), before, 'and three undos take the three fixes back');
await load();

// The typo pass finds and fixes a slip in a heading. The heading stays a heading.
editor.setState({ html: '<p># A haeding with a slip</p><p><br></p><p>The body has teh slip too.</p>', groups: {}, overflow: '' });
editor.focus();
await t.settle();
await answer({ fixes: [{ n: 1, find: 'haeding', replace: 'heading', reason: 'Misspelled.' }, { n: 2, find: 'teh', replace: 'the', reason: 'Misspelled.' }] });
await pick('Fix punctuation and typos');
await t.until(() => marked().length === 2, 4000, 'the fixes');
t.equal(marked(), ['haeding', 'teh'], 'a slip in a heading is marked');
await act('Fix all');
t.equal([editor.blocks[0].kind, textOf(0), textOf(2)], ['h', 'A heading with a slip', 'The body has the slip too.'], 'and fixed, and the heading is still a heading');
await load();

// No slips at all. The model misses slips now and then and answers with none, so an empty
// answer is asked for once more.
{
  const asks = await count();
  await answer({ fixes: [] });
  await pick('Fix punctuation and typos');
  await t.until(() => /no slips/.test(hint()), 3000, 'the card to say there is nothing');
  t.equal([title(), hint(), actions().join(' | ')], ['Fix punctuation and typos', 'The AI found no slips.', 'Done'], 'a clean page says so');
  t.equal(await count(), asks + 2, 'after asking twice');
  await act('Done');
}

// --- when the model misbehaves --------------------------------------------------------------------
// Found with the real models: now and then an answer quotes nothing that is in the text. It
// gives a number, a word that is not there, or its own notes. The Lab then asks once more.
for (const [what, first, also = {}] of [
  ['an answer that quotes nothing in the text', JSON.stringify({ fixes: [{ n: 2, find: 'foo', replace: 'bar', reason: 'Not there.' }, { n: 3, find: '3', replace: 'really', reason: 'A number.' }] })],
  ['an answer that is not in the expected form', 'I would fix Teh and realy.'],
  ['an empty answer', JSON.stringify({ fixes: [] })],
  ['an answer that ran out of room', '{"fixes":[{"n":2,"find":"Teh"', { error: 'The AI ran out of room before it finished its answer. Try again.', cutShort: true }],
]) {
  await load();
  const asks = await count();
  await t.call('test.ai', { set: { chunks: [first], firstMs: 0, everyMs: 20, hold: true, ...also } });
  await pick('Fix punctuation and typos');
  await t.until(async () => (await count()) === asks + 1, 2000, 'the first request');
  await answer(FIXES);
  await release();
  await t.until(() => marked().length === 4 || lab.pass() === 'failed', 4000, `the fixes after ${what}`);
  t.equal([marked().length, await count()], [4, asks + 2], `${what} is asked for once more`);
  await act('Done');
}
{
  await load();
  const asks = await count();
  await answer({ marks: [{ n: 1, text: 'words that are not there', reason: 'Made up.' }] });
  await pick('Mark the weakest sentences');
  await t.until(() => lab.pass() === 'failed', 4000, 'the card to give up');
  t.equal([title(), hint(), actions().join(' | ')], ['Mark the weakest sentences', 'The AI quoted words that are not in the text. Try again.', 'Done'], 'two answers that quote nothing in the text: the card says so');
  t.equal(await count(), asks + 2, 'after asking twice');
  await act('Done');
}

// --- the guide ------------------------------------------------------------------------------------

{
  const sheet = $('#card');
  await pick('The Lab guide…');
  t.assert(!ui.get('lab'), 'the guide closes the popover');
  t.equal(getComputedStyle(sheet).visibility, 'visible', 'and opens a card');
  t.equal(sheet.querySelector('.title').textContent, 'The Lab', 'headed The Lab');
  const entries = [...sheet.querySelectorAll('.entry')].map((entry) => [entry.querySelector('.label').textContent, entry.querySelector('.about').textContent]);
  t.equal(
    entries.map(([label]) => label),
    ['Fix punctuation and typos', 'Mark the weakest sentences', 'Mark sentences that run long', 'Mark convoluted sentences', 'Mark words that don’t fit the tone', 'Mark hedges and filler', 'Slight trim to Cut in half'],
    'it lists every idea',
  );
  for (const [label, about] of entries) t.equal(about.split(/(?<=[.!?])\s+/).length, 2, `two sentences on “${label}”`);
  t.assert(/never rewrites/.test(sheet.textContent), 'and says the AI never rewrites');
  const box = sheet.getBoundingClientRect();
  t.assert(box.top > 20 && box.bottom < innerHeight - 20, 'the card fits the window');
  await t.until(() => getComputedStyle(menu).visibility === 'hidden', 1000, 'the popover to be out of the way');
  await t.snap('guide');
  await t.key('Escape');
  t.equal(getComputedStyle(sheet).visibility, 'hidden', 'Esc puts it away');
}
