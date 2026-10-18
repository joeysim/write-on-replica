// The Lab's trims (design spec 6.10): the model says what could go, by fading it where it
// stands; nothing is cut until the writer says so.
const { editor, ui, lab, commands, alternatives } = window.writeOn;
const { plainText } = await import('./src/doc/format.js');
ui.set({ read: false });
await document.fonts.ready;

const $ = (s) => document.querySelector(s);
const menu = $('#labmenu');
const card = $('#labcard');
const scan = $('#scan');
if (!t.assert(menu && card && scan, 'the page has the Lab’s popover, card and scan line')) return;

const shown = (node) => getComputedStyle(node).visibility === 'visible';
const html = () => editor.getState().html;
const textOf = (i) => editor.blocks[i].runs.map((r) => r.text).join('');
const rows = () => [...menu.querySelectorAll('.row')];
const current = () => rows().find((row) => row.classList.contains('is-current'))?.textContent;
const levels = () => [...menu.querySelectorAll('.level')];
const level = (name) => levels().find((button) => button.querySelector('.name').textContent === name);
const pending = () => levels().find((button) => button.classList.contains('is-pending'))?.querySelector('.name').textContent;
const actions = () => [...card.querySelectorAll('.actions button')].filter(shown).map((button) => button.textContent);
const act = async (label) => {
  const button = [...card.querySelectorAll('.actions button')].find((b) => b.textContent === label && shown(b));
  if (!t.assert(button, `the card has a ${label} button`)) return;
  await t.click(...t.center(button));
};
const title = () => card.querySelector('.title').textContent.replace(/\s+/g, ' ').trim();
/** The ghosted stretches of block `i`, one string each. */
const ghosted = (i) => {
  const out = [];
  let open = false;
  for (const run of editor.blocks[i].runs) {
    if (run.ghost && open) out[out.length - 1] += run.text;
    else if (run.ghost) out.push(run.text);
    open = Boolean(run.ghost);
  }
  return out;
};
/** The piece as it reads, a paragraph each: no ghosted words, as the Markdown tab has it. */
const reading = () => plainText(editor.getState(), { withoutGhost: true }).split('\n\n');
/** The faded passages, one string per cut, with the cuts the writer keeps left out. */
const faded = () => {
  const cuts = new Map();
  for (const span of editor.root.querySelectorAll('[data-trim]')) {
    if (span.classList.contains('is-kept')) continue;
    cuts.set(span.dataset.trim, (cuts.get(span.dataset.trim) ?? '') + span.textContent);
  }
  return [...cuts.values()];
};
const spanOf = (text) => [...editor.root.querySelectorAll('[data-trim]')].find((span) => span.textContent.includes(text));
const openMenu = async () => {
  if (!ui.get('lab')) await t.click(...t.center('#lab'));
  await t.until(() => menu.getAnimations({ subtree: false }).length === 0, 1500, 'the popover to finish opening');
};
const choose = async (name) => {
  await openMenu();
  await t.click(...t.center(level(name)));
};
/**
 * What the model is made to say of the piece, and how soon: of each sentence, what it could
 * lose and how much the piece needs it. The Lab keeps what it has been told about a piece,
 * so a new answer is only heard once what was kept is forgotten.
 */
const answer = (sentences, { firstMs = 60, error = null } = {}) => {
  lab.forget();
  return t.call('test.ai', { set: error ? { error, firstMs } : { chunks: [JSON.stringify({ sentences }).slice(0, 40), JSON.stringify({ sentences }).slice(40)], firstMs, everyMs: 20 } });
};
/** The same, leaving what the Lab has kept for the edit under test to deal with. */
const answerQuietly = (sentences, { firstMs = 60 } = {}) =>
  t.call('test.ai', { set: { chunks: [JSON.stringify({ sentences }).slice(0, 40), JSON.stringify({ sentences }).slice(40)], firstMs, everyMs: 20 } });
const asked = async () => (await t.call('test.ai')).requests;

const S1 = 'Much of the trouble, in my view, comes from wanting every line to stay.';
const S2 = 'It rarely works out that way.';
const P1 = `${S1} ${S2}`;
// The second paragraph as the model is offered it: without what is ghosted.
const P2 = 'Keep what earns its place and really nothing else, then stop.';
const P3 = [
  'A last paragraph that the trim leaves alone, at least to begin with.',
  'It is here so that the piece is long enough for a tenth of it to be worth the taking.',
  'What goes first is padding, and this has none.',
  'What goes next is whatever the piece could do without, like this sentence about nothing much.',
  'Then come the sentences that add a little, of which this is one, though only just.',
  'And last the ones a reader would miss, if not by much.',
  'The rest stays whatever is asked, because without it there would be no piece left to speak of.',
];
const DOC =
  '<p><br></p><p># The short version</p><p><br></p>' +
  `<p>${P1}</p><p><br></p>` +
  '<p>Keep <span data-ghost>this aside </span>what earns its place and <span data-vid="r3ally1">really</span> nothing else, then stop.</p><p><br></p>' +
  `<p>${P3.join(' ')}</p>`;
const GROUPS = { r3ally1: { scope: 'word', variants: ['really', 'truly'], active: 0 } };
// The piece has ten sentences. Of each the model says what it could lose and, from 1 to 5,
// how much the piece needs it; the first three have padding, and the second could go.
const SAID = [
  { s: 1, text: 'The trouble comes from wanting every line to stay.', need: 5 },
  { s: 2, text: 'It rarely works out that way.', need: 1 },
  { s: 3, text: 'Keep what earns its place and nothing else.', need: 5 },
  ...[5, 4, 5, 2, 3, 4, 5].map((need, i) => ({ s: 4 + i, text: P3[i], need })),
];
// A slight trim takes the padding and the sentence the piece is better without.
const CUTS = ['Much of ', ', in my view,', 'It rarely works out that way.', 'really ', ', then stop'];
// Words that are not ghosted: 3 in the heading, then 20, 11 and 104 in the paragraphs. What
// each level takes of them, and which sentences of the last paragraph go with the cuts above:
// the app does the counting, and gets as near as whole sentences allow.
const WORDS = 138;
const LEVELS = {
  'Slight trim': { cut: 14, also: [] },
  'Tighten more': { cut: 30, also: [P3[3]] },
  'Even sharper': { cut: 46, also: [P3[3], P3[4]] },
  'Cut in half': { cut: 66, also: [P3[1], P3[3], P3[4]] },
};
const summary = (name, cut = LEVELS[name].cut) => `${name} ${WORDS} → ${WORDS - cut} words · −${Math.round((cut / WORDS) * 100)}%`;
const load = async () => {
  editor.setState({ html: DOC, groups: structuredClone(GROUPS), overflow: '' });
  editor.focus();
  editor.select({ block: 7, offset: 0 });
  await t.settle();
};
await load();
const before = html();

// --- the popover ----------------------------------------------------------------------------------

t.assert(!shown(menu) && !shown(card) && !shown(scan), 'nothing of the Lab shows to begin with');
await t.click(...t.center('#lab'));
t.assert(ui.get('lab'), 'the LAB button opens the popover');
// It opens outwards from the button: at first only the part nearest the button shows.
{
  const reveal = menu.getAnimations({ subtree: false })[0];
  if (t.assert(reveal, 'it opens with a reveal')) {
    // How much is still hidden, in pixels: at the top, and at either side.
    const inset = () => {
      const [, top, side] = /inset\(([\d.]+)% ([\d.]+)%/.exec(getComputedStyle(menu).clipPath) ?? [];
      return [(top / 100) * menu.offsetHeight, (side / 100) * menu.offsetWidth];
    };
    reveal.pause();
    reveal.currentTime = 57;
    await t.frame();
    // The clip's frames: 64px still hidden at either side 57ms in, 12px at 124ms.
    t.near(inset()[1], 64, 16, 'part-way through, as much is hidden at each side as in the clip');
    t.near(inset()[0], 68, 17, 'and at the top');
    reveal.currentTime = 124;
    await t.frame();
    t.near(inset()[1], 12, 7, 'and later, almost none');
    reveal.play();
  }
}
await t.until(() => menu.getAnimations({ subtree: false }).length === 0, 1500, 'the popover to finish opening');
{
  const box = menu.getBoundingClientRect();
  const button = $('#lab').getBoundingClientRect();
  t.equal([box.left, box.width, box.height], [(innerWidth - 620) / 2, 620, 327], 'a 620 by 327 popover in the middle of the window');
  t.near(box.bottom, button.bottom, 0.01, 'standing on the bottom edge of the button, which it covers');
  const style = getComputedStyle(menu);
  t.equal([style.backgroundColor, style.borderTopWidth, style.borderTopColor, style.clipPath], ['rgb(18, 21, 34)', '1px', 'rgb(35, 39, 53)', 'none'], 'in the popover color with a hairline edge, whole once it is open');
  t.equal(
    rows().map((row) => row.querySelector('.label').textContent),
    ['The Lab guide…', 'Fix punctuation and typos', 'Mark the weakest sentences', 'Mark sentences that run long', 'Mark convoluted sentences', 'Mark words that don’t fit the tone', 'Mark hedges and filler'],
    'its seven lines, word for word',
  );
  t.equal(rows()[0].querySelector('.note').textContent, 'what each idea does', 'the first says what it is for');
  t.equal(
    levels().map((button) => [button.querySelector('.name').textContent, button.querySelector('.amount')?.textContent ?? '']),
    [['Original', ''], ['Slight trim', '~10%'], ['Tighten more', '~20%'], ['Even sharper', '~30%'], ['Cut in half', '~50%']],
    'and five levels of trim, each with how much it takes',
  );
  t.equal(pending(), 'Original', 'with nothing proposed, Original is the one marked');
  t.equal(getComputedStyle(level('Original')).borderTopColor, 'rgb(129, 124, 212)', 'in the accent color');
  t.equal(current(), rows()[0].textContent, 'the first line is lit to begin with');
}

// Where things are, on the 1548x976 page of the clip.
{
  const box = menu.getBoundingClientRect();
  const top = (node) => node.getBoundingClientRect().top - box.top;
  t.near(top(rows()[0]), 11, 0.01, 'the guide line is 10px inside the top edge');
  t.near(top(rows()[1]), 57, 0.01, 'the ideas start under a rule');
  t.near(top(rows()[6]) - top(rows()[1]), 5 * 32.5, 0.01, 'and are 32.5px apart');
  const band = rows()[3].getBoundingClientRect();
  t.equal([band.left - box.left, box.right - band.right, band.height], [7, 7, 32.5], 'a line’s band stops 6px short of either edge');
  const label = document.createRange();
  label.selectNodeContents(rows()[3].querySelector('.label'));
  t.near(label.getBoundingClientRect().left - box.left, 17, 0.01, 'and its words start 16px in');
  t.equal([getComputedStyle(rows()[3]).fontSize, getComputedStyle(rows()[0].querySelector('.note')).fontSize], ['14px', '12px'], 'in 14px type, the note in 12px');
  const first = level('Original').getBoundingClientRect();
  const second = level('Slight trim').getBoundingClientRect();
  t.near(first.left - box.left, 13, 0.01, 'the levels start 12px in');
  t.near(first.width, 115.6, 0.05, 'five of them share the width');
  t.near(second.left - first.right, 4, 0.01, '4px apart');
  t.near(first.height, 45.5, 0.01, 'each 45.5px tall');
  t.near(box.bottom - first.bottom, 15, 0.01, '14px above the bottom edge');
  t.equal([getComputedStyle(level('Slight trim').querySelector('.name')).fontSize, getComputedStyle(level('Slight trim').querySelector('.amount')).fontSize], ['13px', '11px'], 'names in 13px, amounts in 11px');
  await t.snap('popover');
}

// The line under the pointer is lit, and stays lit when the pointer goes on to the levels.
await t.hover(...t.center(rows()[4]));
t.equal(current(), 'Mark convoluted sentences', 'the line under the pointer is lit');
t.equal(getComputedStyle(rows()[4]).backgroundColor, 'rgba(245, 209, 192, 0.09)', 'as a band');
await t.hover(...t.center(level('Tighten more')));
t.equal(current(), 'Mark convoluted sentences', 'it stays lit while the pointer is on the levels');
t.assert(level('Tighten more').classList.contains('is-hovered'), 'where the level under it lights up');

await t.key('Escape');
t.assert(!ui.get('lab'), 'Esc closes the popover');
await t.click(...t.center('#lab'));
await t.click(300, 300);
t.assert(!ui.get('lab'), 'and so does a click away from it');
t.same(html(), before, 'none of which touches the text');

// --- reading --------------------------------------------------------------------------------------

await answer(SAID, { firstMs: 1500 });
await choose('Slight trim');
t.assert(!ui.get('lab'), 'choosing a level closes the popover');
t.assert(shown(card), 'and puts a card at the foot of the page');
{
  t.equal(title(), 'Slight trim Reading…', 'the card names the trim and says it is reading');
  t.equal(card.querySelector('.hint').textContent, 'Faded words would go. Click one to keep it.', 'with what the fading will mean');
  t.equal(actions(), ['Make the cuts', 'Cancel'], 'and two buttons');
  const box = card.getBoundingClientRect();
  t.equal([box.width, box.height], [500, 88], 'a 500 by 88 card');
  t.near(box.left + box.width / 2, innerWidth / 2, 0.3, 'in the middle');
  t.near(innerHeight - box.bottom, 55, 0.01, '55px above the bottom of the window');
  const [first, second] = [...card.querySelectorAll('.actions button')].map((b) => b.getBoundingClientRect());
  t.equal([first.height, Math.round((second.left - first.right) * 10) / 10, Math.round((first.left - box.left) * 10) / 10], [22, 8, 16], 'its buttons are 22px tall and 8px apart, starting 16px in');
  t.equal(getComputedStyle(card.querySelector('.state')).color, 'rgb(129, 124, 212)', 'Reading… is in the accent color');
  await t.until(() => !shown(menu), 1000, 'the popover to be out of the way');
  await t.snap('reading');
}
// The model is offered the paragraphs a sentence at a time: not the heading, and not what is
// ghosted. It is not told how much to cut. That is counted here, from what it says.
{
  const [request] = await asked();
  const said = request.messages.map((m) => m.content).join('\n');
  t.assert(said.includes(`[1] ${S1}\n[2] ${S2}\n\n[3] ${P2}\n\n[4] A last paragraph`), 'the sentences go to the model, numbered through, a blank line between paragraphs');
  t.assert(said.endsWith(`[10] ${P3[6]}`), 'to the last of them');
  t.assert(!said.includes('this aside') && !said.includes('The short version'), 'without ghosted text or the heading');
  t.assert(!/\d\s*%|\d+ words/.test(said), 'and with no amount to cut to');
  t.equal(Object.keys(request.schema.properties), ['sentences'], 'the answer is to be a list of sentences');
}
// A crimson line reads down each block in turn, 300ms to a block.
{
  t.assert(shown(scan), 'a line sweeps the text while it reads');
  const style = getComputedStyle(scan);
  const column = editor.root.getBoundingClientRect();
  t.equal([style.backgroundColor, style.height], ['rgb(200, 16, 66)', '1.5px'], 'crimson, a pixel and a half thick');
  t.equal([scan.getBoundingClientRect().left, scan.getBoundingClientRect().width], [column.left, column.width], 'as wide as the column');
  const sweep = scan.getAnimations()[0];
  if (t.assert(sweep, 'it is moving')) {
    const blocks = [1, 3, 5, 7].map((i) => editor.blockElement(i).getBoundingClientRect());
    t.equal(sweep.effect.getComputedTiming().duration, 1200, 'four blocks of text take 1.2 seconds');
    sweep.pause();
    const y = () => scan.getBoundingClientRect().top;
    for (const [at, k, part] of [[0, 0, 0], [150, 0, 0.5], [450, 1, 0.5], [600, 2, 0], [825, 2, 0.75], [1050, 3, 0.5]]) {
      sweep.currentTime = at;
      await t.frame();
      t.near(y(), blocks[k].top + blocks[k].height * part, 1, `${at}ms in, it is ${part * 100}% of the way down block ${k + 1}`);
    }
    sweep.play();
  }
}
t.same(html(), before, 'while it reads, the text is as it was');
t.equal(faded(), [], 'and nothing is faded yet');

// --- the proposal ---------------------------------------------------------------------------------

await t.until(() => lab.pass() === 'proposal' && faded().length > 0, 4000, 'the proposal to arrive');
t.equal(faded(), CUTS, 'what could go is faded where it stands');
t.same(html(), before, 'the text itself is untouched');
t.assert(!editor.canUndo, 'and nothing has been done that could be undone');
t.assert(!shown(scan), 'the line is gone');
{
  const span = spanOf('in my view');
  t.equal(getComputedStyle(span).opacity, '0.22', 'faded words are drawn at 22%, twice as strong as ghosted ones');
  t.equal(title(), summary('Slight trim'), 'the card counts the words before and after: a tenth, as near as can be');
  t.equal(actions(), ['Make the cuts', 'Walk through', 'Cancel'], 'and offers to walk through the cuts');
  const box = card.getBoundingClientRect();
  t.near(box.width, 601.5, 0.01, 'the card is 601.5px wide now, as in the clip');
  t.near(box.left + box.width / 2, innerWidth / 2, 0.3, 'still in the middle');
  t.equal(getComputedStyle(card.querySelector('.state')).color, 'rgb(129, 124, 212)', 'the numbers are in the accent color');
  await t.snap('proposal');
}
await openMenu();
t.equal(pending(), 'Slight trim', 'in the popover, the level that is proposed is the one marked');
await t.key('Escape');

// A click on a faded passage keeps it; another gives it back.
{
  const [x, y] = t.center(spanOf('in my view'));
  await t.click(x, y);
  t.equal(faded(), CUTS.filter((cut) => cut !== ', in my view,'), 'a click on a faded passage keeps it');
  t.equal(getComputedStyle(spanOf('in my view')).opacity, '1', 'at full strength again');
  t.equal(title(), summary('Slight trim', 11), 'and the card counts it back in');
  t.same(html(), before, 'still without touching the text');
  await t.click(x, y);
  t.equal(faded(), CUTS, 'a second click lets it go again');
}

// --- making the cuts ------------------------------------------------------------------------------
// "Make the cuts" ghosts the cuts. It deletes nothing and changes no letter, so Ghost brings any
// of them back. (Asked for by the owner on 18 October 2026: before, the cuts were deleted.)

await t.click(...t.center(spanOf('really')));
t.equal(faded().length, 4, 'one cut is kept');
await act('Make the cuts');
t.equal([textOf(3), textOf(5)], [P1, 'Keep this aside what earns its place and really nothing else, then stop.'], 'every word is still there');
t.equal(ghosted(3), ['Much of ', ', in my view,', 'It rarely works out that way.'], 'the cuts are ghosted');
t.equal(ghosted(5), ['this aside ', ', then stop'], 'with what was ghosted before, and not the cut that was kept');
t.equal(reading().slice(1, 3), ['the trouble comes from wanting every line to stay.', 'Keep what earns its place and really nothing else.'], 'the piece reads trimmed, and no letter is changed');
t.equal(textOf(7), P3.join(' '), 'a paragraph with nothing proposed is as it was');
t.equal(editor.root.querySelectorAll('[data-trim]').length, 0, 'nothing is faded any more');
t.assert(!shown(card), 'and the card is gone');
t.equal(Object.keys(editor.groups), ['r3ally1'], 'a group that was kept is still a group');
await t.key('z', { meta: true });
t.same(html(), before, 'one undo takes the ghosting back');
t.assert(!editor.canUndo, 'it was a single step');
await t.key('z', { meta: true, shift: true });
t.equal(ghosted(3), ['Much of ', ', in my view,', 'It rarely works out that way.'], 'and redo ghosts the cuts again');
await load();

// A cut that takes all of a group ghosts its words, and the group stays.
await answer(SAID);
await choose('Slight trim');
await t.until(() => lab.pass() === 'proposal' && faded().length > 0, 4000, 'the proposal');
await act('Make the cuts');
t.equal(ghosted(5), ['this aside ', 'really ', ', then stop'], 'every cut ghosted');
t.equal(reading()[2], 'Keep what earns its place and nothing else.', 'and the piece reads without them');
t.equal(Object.keys(editor.groups), ['r3ally1'], 'the group whose only word was cut is still there');
await load();

// --- putting a proposal away ----------------------------------------------------------------------

await answer(SAID);
await choose('Slight trim');
await t.until(() => lab.pass() === 'proposal' && faded().length > 0, 4000, 'the proposal');
await act('Cancel');
t.equal([faded().length, shown(card)], [0, false], 'Cancel puts the proposal away');
t.same(html(), before, 'and leaves the text as it was');
await openMenu();
t.equal(pending(), 'Original', 'Original is marked again');
await t.key('Escape');

// --- one answer, every level ----------------------------------------------------------------------
// In the clip "Tighten more" is chosen some seconds after "Slight trim" was read, and its
// card is there at once, numbers and all: no reading, no line through the text. The model
// is asked once, what each sentence could lose and how much the piece needs it, and each
// level is counted out from that for as long as the piece does not change.
{
  await answer(SAID, { firstMs: 120 });
  const asks = (await asked()).length;
  await choose('Slight trim');
  t.equal(title(), 'Slight trim Reading…', 'the first level asked for is read');
  await t.until(() => lab.pass() === 'proposal' && faded().length > 0, 4000, 'its proposal');
  t.equal([faded(), title()], [CUTS, summary('Slight trim')], 'a tenth of the piece');
  t.equal(lab.read(), true, 'what the model said is kept');

  await choose('Tighten more');
  t.equal([title(), shown(scan)], [summary('Tighten more'), false], 'another level is there at once: no reading, no line');
  t.equal(faded(), [...CUTS, ...LEVELS['Tighten more'].also], 'with more faded: the sentence the piece needs least');
  t.near(card.getBoundingClientRect().width, 608.5, 0.01, 'on a card one letter wider');
  await openMenu();
  t.equal(pending(), 'Tighten more', 'and it is the level marked now');
  await t.key('Escape');
  await choose('Even sharper');
  t.equal([title(), faded()], [summary('Even sharper'), [...CUTS, ...LEVELS['Even sharper'].also]], 'the next takes the sentence needed next least as well');
  await choose('Cut in half');
  t.equal(title(), summary('Cut in half'), 'and the deepest comes as near to half as whole sentences allow');
  t.equal(faded(), [CUTS[0], CUTS[1], CUTS[2], CUTS[3], CUTS[4], ...LEVELS['Cut in half'].also], 'leaving the sentences the piece does not work without');
  await act('Cancel');
  await choose('Slight trim');
  t.equal([title(), faded()], [summary('Slight trim'), CUTS], 'the first is there again after Cancel, as it was');
  t.equal((await asked()).length, asks + 1, 'and for all of it the model was asked once');
  // Original puts it away.
  await choose('Original');
  t.equal([faded().length, shown(card), ui.get('lab')], [0, false, false], 'Original puts the proposal away and closes the popover');

  // What is kept is about the piece as it was: a change to it and the model is asked afresh.
  editor.focus();
  editor.select({ block: 7, offset: 0 });
  await t.type('z');
  t.equal(lab.read(), false, 'an edit, and nothing is kept');
  await answerQuietly(SAID, { firstMs: 300 });
  await choose('Tighten more');
  t.equal(title(), 'Tighten more Reading…', 'so the next trim is read again');
  await t.until(() => lab.pass() === 'proposal' && faded().length > 0, 4000, 'the new proposal');
  t.equal((await asked()).length, asks + 2, 'from a second asking');
  await act('Cancel');
  await t.key('z', { meta: true });
  await load();
}

// --- cuts arrive as the answer does ----------------------------------------------------------------
// The answer is every sentence over again, and it takes a while to arrive. In the clip the
// first cuts fade, and "Walk through" appears, while the card still reads "Reading…". What
// fades meanwhile is judged a sentence at a time, since nothing can be counted yet.
{
  lab.forget();
  const whole = JSON.stringify({ sentences: SAID });
  const cut = whole.indexOf('{"s":3'); // the first paragraph's two sentences whole, and no more
  t.assert(cut > 2, 'the answer has more than two sentences');
  await t.call('test.ai', { set: { chunks: [whole.slice(0, cut), whole.slice(cut)], firstMs: 100, everyMs: 3000 } });
  await choose('Slight trim');
  await t.until(() => faded().length > 0, 2500, 'the first paragraph’s cuts to fade while the rest is still coming');
  t.equal(faded(), CUTS.slice(0, 3), 'what the sentences that are in could lose, and the one that could go');
  t.equal(title(), 'Slight trim Reading…', 'the card still says it is reading');
  t.assert(shown(scan), 'and the line is still going through the text');
  t.equal(actions(), ['Make the cuts', 'Walk through', 'Cancel'], 'Walk through is there already');
  {
    const row = [...card.querySelectorAll('.actions button')].filter(shown).map((button) => button.getBoundingClientRect());
    const edge = card.getBoundingClientRect();
    t.assert(row.every((box) => Math.abs(box.top - row[0].top) < 1 && box.left >= edge.left && box.right <= edge.right), 'the three buttons fit on one line on the 500px card');
  }
  const text = html();
  await act('Make the cuts');
  t.same(html(), text, 'though nothing can be cut until the whole answer is in');
  await t.until(() => title() === summary('Slight trim'), 10000, 'the whole answer');
  t.equal(faded(), CUTS, 'which brings the rest of the cuts');
  await act('Cancel');

  // A deeper level shows sentences going as they come, and settles on its amount at the end.
  lab.forget();
  const later = whole.indexOf('{"s":9');
  await t.call('test.ai', { set: { chunks: [whole.slice(0, later), whole.slice(later)], firstMs: 100, everyMs: 3000 } });
  await choose('Cut in half');
  await t.until(() => faded().length > 0, 2500, 'cuts to fade while the rest is still coming');
  t.equal(faded(), [...CUTS, P3[3], P3[4]], 'for a deep trim, the sentences needed least among those that are in');
  await t.until(() => title() === summary('Cut in half'), 10000, 'the whole answer');
  t.equal(faded(), [...CUTS, ...LEVELS['Cut in half'].also], 'and then what comes to half');
  await act('Cancel');
}

// --- putting a trim away stops the reading ---------------------------------------------------------
// Cancel while the model is still being asked calls the request off, and nothing is kept of an
// answer that never came: the next trim asks again.
{
  await answer(SAID, { firstMs: 600 });
  const asks = (await asked()).length;
  await choose('Slight trim');
  t.equal(title(), 'Slight trim Reading…', 'a trim is being read');
  await act('Cancel');
  await t.wait(900);
  const after = await t.call('test.ai');
  t.equal(after.requests.length, asks + 1, 'Cancel while it reads: the model is asked nothing more');
  t.assert(after.canceled.includes(after.requests.at(-1).id), 'and the request is called off');
  t.equal(lab.read(), false, 'with nothing kept of an answer that never came');
  await choose('Tighten more');
  t.equal(title(), 'Tighten more Reading…', 'so the next trim asks again');
  await t.until(() => title() === summary('Tighten more'), 4000, 'and is answered');
  t.equal((await asked()).length, asks + 2, 'by a request of its own');
  // Another level chosen while the first is still being read waits for the same answer.
  await answer(SAID, { firstMs: 2000 });
  const again = (await asked()).length;
  await choose('Slight trim');
  await choose('Even sharper');
  t.equal(title(), 'Even sharper Reading…', 'a second level chosen while the first is read is read too');
  await t.until(() => title() === summary('Even sharper'), 4000, 'the answer');
  t.equal(faded(), [...CUTS, ...LEVELS['Even sharper'].also], 'and it is the second that shows');
  t.equal((await asked()).length, again + 1, 'from the one asking');
  await act('Cancel');
}

// An edit, an undo or a redo makes a proposal stale, so it goes.
for (const [what, change] of [
  ['typing', () => t.type('x')],
  ['undo', () => t.key('z', { meta: true })],
  ['redo', () => t.key('z', { meta: true, shift: true })],
]) {
  await answer(SAID);
  await choose('Slight trim');
  await t.until(() => lab.pass() === 'proposal' && faded().length > 0, 4000, `the proposal before ${what}`);
  editor.focus();
  editor.select({ block: 7, offset: 0 });
  await change();
  t.equal([faded().length, shown(card)], [0, false], `${what} puts the proposal away`);
}
t.assert(textOf(7).startsWith('xA last'), 'and the edit itself stands');
await load();

// While it is still reading, an edit calls the request off.
{
  await answer(SAID, { firstMs: 3000 });
  await choose('Slight trim');
  t.assert(shown(scan), 'reading');
  editor.focus();
  await t.type('y');
  t.equal([shown(card), shown(scan)], [false, false], 'an edit while it reads puts the card and the line away');
  const { requests, canceled } = await t.call('test.ai');
  t.assert(canceled.includes(requests[requests.length - 1].id), 'and calls the request off');
  await load();
}

// Read mode is just the text: the popover and anything proposed are put away.
{
  await answer(SAID);
  await choose('Slight trim');
  await t.until(() => lab.pass() === 'proposal' && faded().length > 0, 4000, 'the proposal before read mode');
  await openMenu();
  ui.set({ read: true });
  await t.settle();
  t.equal([ui.get('lab'), faded().length, shown(card)], [false, 0, false], 'going into read mode closes the popover and puts the proposal away');
  ui.set({ read: false });
}

// With no paragraphs there is nothing to ask about.
{
  editor.setState({ html: '<p># Only a title</p><p><br></p>', groups: {}, overflow: '' });
  await t.settle();
  const asks = (await asked()).length;
  await choose('Slight trim');
  t.equal(card.querySelector('.hint').textContent, 'There is nothing here to read.', 'a page with no paragraphs has nothing for a pass to read');
  t.equal((await asked()).length, asks, 'and the model is not asked');
  await act('Done');
  await load();
}

// --- when the model misbehaves --------------------------------------------------------------------

await answer(null, { error: 'The AI service is busy. Try again in a moment.' });
await choose('Even sharper');
await t.until(() => /busy/.test(card.textContent), 3000, 'the reason to show');
t.equal(title(), 'Even sharper', 'a failure leaves the card with the name of the trim');
t.equal(card.querySelector('.hint').textContent, 'The AI service is busy. Try again in a moment.', 'and one clear line saying why');
t.equal(actions(), ['Done'], 'with nothing to do but put it away');
t.assert(!shown(scan), 'the line stops');
t.same(html(), before, 'and the text is untouched');
t.equal(lab.read(), false, 'nothing is kept of a request that failed');
await act('Done');
t.assert(!shown(card), 'Done puts it away');

// A sentence the model rewrote is left as it is; one it only cut is still proposed.
await answer([
  { s: 1, text: 'Most trouble comes from wanting to keep every line.', need: 5 },
  { s: 3, text: 'Keep what earns its place and nothing else.', need: 5 },
]);
await choose('Even sharper');
await t.until(() => lab.pass() === 'proposal' && faded().length > 0, 4000, 'the proposal');
t.equal(faded(), ['really ', ', then stop'], 'a sentence that came back reworded is not touched');
// Both are sentences the piece is said not to work without: only a trim to half takes such.
// (The Lab does not keep an answer about two sentences in ten, so it asks the model again.)
await choose('Cut in half');
await t.until(() => lab.pass() === 'proposal' && !/Reading/.test(title()), 4000, 'the deeper level');
t.equal(faded(), [S1, P2], 'to halve a piece, something it needs may have to go');
await act('Cancel');
// Nothing usable at all.
await answer([{ s: 1, text: 'Something else entirely.', need: 5 }]);
await choose('Cut in half');
await t.until(() => actions().length === 1, 3000, 'the card to give up');
t.equal(card.querySelector('.hint').textContent, 'The AI found nothing it could cut without rewording.', 'an answer with nothing usable says so');
t.same(html(), before, 'and changes nothing');
await act('Done');
// A piece the model would not shorten.
await answer(SAID.map((said, i) => ({ s: said.s, text: [S1, S2, P2][i] ?? said.text, need: 5 })));
await choose('Slight trim');
await t.until(() => actions().length === 1, 3000, 'the card to give up');
t.equal(card.querySelector('.hint').textContent, 'The AI found nothing to cut.', 'an answer that would cut nothing says that');
await act('Done');
// An answer that leaves out most of the piece is asked for once more. (The real model did
// it once in a dozen askings: one sentence of twenty-seven, and then it stopped.)
{
  await answer([SAID[0]], { firstMs: 1500 });
  const asks = (await asked()).length;
  await choose('Slight trim');
  await answerQuietly(SAID, { firstMs: 200 }); // for the second asking: the first has its answer already
  await t.until(() => lab.pass() === 'proposal', 6000, 'a proposal');
  t.equal([title(), faded()], [summary('Slight trim'), CUTS], 'the fuller answer is the one that counts');
  t.equal((await asked()).length, asks + 2, 'the model having been asked a second time');
  await act('Cancel');
  // If the second answer is thin too, the Lab joins the two answers, and the card tells how
  // much the AI read. The Lab does not keep the answer, so the next level asks again.
  lab.forget();
  await t.call('test.ai', { set: { chunks: [JSON.stringify({ sentences: [SAID[0]] })], firstMs: 0, everyMs: 20, hold: true } });
  const again = (await asked()).length;
  await choose('Slight trim');
  await t.until(async () => (await asked()).length === again + 1, 2000, 'the first asking');
  await answerQuietly([SAID[2]], { firstMs: 0 }); // for the second asking
  await t.call('test.ai', { release: true });
  await t.until(() => lab.pass() === 'proposal', 4000, 'a proposal');
  t.equal([title(), faded()], [summary('Slight trim', 8), ['Much of ', ', in my view,', 'really ', ', then stop']], 'what the two answers say between them is used');
  t.equal((await asked()).length, again + 2, 'after two askings, and no third');
  const THIN = 'The AI read only 2 of the 10 sentences. Choose a level to ask again.';
  t.equal(card.querySelector('.hint').textContent, THIN, 'the card says how much of the piece the AI read');
  t.equal(lab.read(), false, 'and so thin an answer is not kept');
  await choose('Tighten more');
  t.equal(title(), 'Tighten more Reading…', 'another level asks again');
  await t.until(() => lab.pass() === 'proposal', 4000, 'a proposal');
  t.equal((await asked()).length, again + 4, 'twice, as the answers are as thin as before');
  await act('Cancel');
  // If the second request fails, the Lab uses the first answer.
  lab.forget();
  await t.call('test.ai', { set: { chunks: [JSON.stringify({ sentences: [SAID[0]] })], firstMs: 0, everyMs: 20, hold: true } });
  const third = (await asked()).length;
  await choose('Slight trim');
  await t.until(async () => (await asked()).length === third + 1, 2000, 'the first asking');
  await t.call('test.ai', { set: { error: 'The AI service is busy. Try again in a moment.', firstMs: 0 } });
  await t.call('test.ai', { release: true });
  await t.until(() => lab.pass() === 'proposal' || lab.pass() === 'failed', 4000, 'the trim');
  t.equal([lab.pass(), faded()], ['proposal', ['Much of ', ', in my view,']], 'a second asking that fails leaves what the first said');
  t.equal(card.querySelector('.hint').textContent, 'The AI read only 1 of the 10 sentences. Choose a level to ask again.', 'and the card says how little that is');
  await act('Cancel');
}
// An answer that runs out of room is an answer as far as it went. (Found with muse-spark-open
// on a 500-word draft.) The Lab uses the sentences that came whole. If they are fewer than
// half, it asks again and joins the two answers.
{
  const RAN_OUT = 'The AI ran out of room before it finished its answer. Try again.';
  const whole = JSON.stringify({ sentences: SAID });
  lab.forget();
  await t.call('test.ai', { set: { chunks: [whole.slice(0, whole.indexOf('{"s":3') + 10)], firstMs: 0, everyMs: 20, error: RAN_OUT, cutShort: true, hold: true } });
  const asks = (await asked()).length;
  await choose('Slight trim');
  await t.until(async () => (await asked()).length === asks + 1, 2000, 'the first request');
  await answerQuietly(SAID, { firstMs: 0 });
  await t.call('test.ai', { release: true });
  await t.until(() => lab.pass() === 'proposal' || lab.pass() === 'failed', 4000, 'the trim');
  t.equal([lab.pass(), title(), faded()], ['proposal', summary('Slight trim'), CUTS], 'an answer that ran out of room early is asked for again, and the two are joined');
  t.equal((await asked()).length, asks + 2, 'after two requests');
  await act('Cancel');
  lab.forget();
  await t.call('test.ai', { set: { chunks: [whole.slice(0, whole.indexOf('{"s":9'))], firstMs: 0, everyMs: 20, error: RAN_OUT, cutShort: true } });
  const again = (await asked()).length;
  await choose('Slight trim');
  await t.until(() => lab.pass() === 'proposal' || lab.pass() === 'failed', 4000, 'the trim');
  t.equal([lab.pass(), faded(), (await asked()).length], ['proposal', CUTS, again + 1], 'one that ran out of room after most of the piece is used as it is');
  t.equal(lab.read(), true, 'and kept');
  await act('Cancel');
}
// Cancel while the second asking is out calls that off too, and keeps nothing.
{
  await answer([SAID[0]], { firstMs: 200 });
  const asks = (await asked()).length;
  await choose('Slight trim');
  await answerQuietly(SAID, { firstMs: 3000 });
  await t.until(async () => (await asked()).length === asks + 2, 4000, 'the second asking');
  t.equal(title(), 'Slight trim Reading…', 'the card is still reading');
  await act('Cancel');
  const { requests, canceled } = await t.call('test.ai');
  t.assert(canceled.includes(requests.at(-1).id), 'Cancel calls the second asking off');
  t.equal([lab.read(), shown(card)], [false, false], 'and nothing is kept of the thin answer that came first');
  await t.wait(300);
  t.equal((await asked()).length, asks + 2, 'nor is anything more asked');
}
// A level's share is of the words the card counts, the heading's among them.
{
  const names = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta'];
  editor.setState({ html: `<p># One two three four five six seven eight nine ten</p><p><br></p><p>${names.map((name) => `${name} really works here now.`).join(' ')}</p>`, groups: {}, overflow: '' });
  await t.settle();
  await answer(names.map((name, i) => ({ s: i + 1, text: `${name} works here now.`, need: 5 })));
  await choose('Slight trim');
  await t.until(() => lab.pass() === 'proposal', 4000, 'a proposal');
  t.equal(title(), 'Slight trim 40 → 36 words · −10%', 'a tenth of forty words is four of the six that could go: of the thirty offered it would be three');
  t.equal(faded(), ['really ', 'really ', 'really ', 'really '], 'taken evenly from first to last');
  const word = (span) => span.previousSibling.textContent.trim().split(' ').pop(); // the word a cut follows
  t.equal([...editor.root.querySelectorAll('[data-trim]')].map(word), ['Alpha', 'Gamma', 'Delta', 'Zeta'], 'through the piece, not from its start alone');
  await act('Cancel');
  await load();
}
// An answer that cannot be read is not kept: asking again asks again.
{
  lab.forget();
  await t.call('test.ai', { set: { chunks: ['I would cut the second sentence, ', 'and tighten the first.'], firstMs: 60, everyMs: 20 } });
  const asks = (await asked()).length;
  await choose('Slight trim');
  await t.until(() => actions().length === 1, 3000, 'the card to give up');
  t.equal(card.querySelector('.hint').textContent, 'The AI did not answer in the expected form.', 'an answer in the wrong shape says so');
  t.equal(lab.read(), false, 'and is not kept');
  await act('Done');
  await answerQuietly(SAID);
  await choose('Slight trim');
  await t.until(() => title() === summary('Slight trim'), 4000, 'a second asking to be answered');
  t.equal((await asked()).length, asks + 2, 'the model having been asked again');
  await act('Cancel');
}

// --- walking through ------------------------------------------------------------------------------

await answer(SAID);
await choose('Slight trim');
await t.until(() => lab.pass() === 'proposal' && faded().length > 0, 4000, 'the proposal');
await act('Walk through');
t.equal(title(), 'Slight trim 1 of 5', 'the walk starts at the first cut');
t.equal(actions(), ['Cut', 'Keep', 'Stop'], 'with three choices');
t.equal(editor.root.querySelector('[data-trim].is-current')?.textContent, 'Much of ', 'the cut in question is pointed out');
t.equal(getComputedStyle(editor.root.querySelector('[data-trim].is-current')).textDecorationColor, 'rgb(200, 16, 66)', 'underlined in the Lab’s crimson');
await act('Cut');
t.equal([title(), editor.root.querySelector('[data-trim].is-current')?.textContent], ['Slight trim 2 of 5', ', in my view,'], 'Cut lets it go and moves on');
await act('Keep');
t.equal(title(), 'Slight trim 3 of 5', 'Keep moves on too');
t.equal(faded(), CUTS.filter((cut) => cut !== ', in my view,'), 'having kept that one');
await act('Stop');
t.equal(title(), summary('Slight trim', 11), 'Stop goes back to the summary, which counts what was kept');
t.equal(actions(), ['Make the cuts', 'Walk through', 'Cancel'], 'and its buttons');
t.equal(editor.root.querySelectorAll('[data-trim].is-current').length, 0, 'nothing is pointed out any more');
t.same(html(), before, 'the walk itself cuts nothing');
// Walking to the end comes back to the summary as well.
await act('Walk through');
for (let i = 0; i < 5; i++) await act('Cut');
t.equal(actions(), ['Make the cuts', 'Walk through', 'Cancel'], 'after the last cut the summary is back');
t.equal(faded(), CUTS, 'Cut on a passage that was kept lets it go after all');
await act('Cancel');

// Each passage is brought into view as its turn comes.
{
  const line = (i, padded = true) => `Paragraph ${i + 1} is ${padded ? 'honestly ' : ''}a line with a word to lose.`;
  const many = Array.from({ length: 30 }, (_, i) => `<p>${line(i)}</p><p><br></p>`).join('');
  editor.setState({ html: many, groups: {}, overflow: '' });
  await t.settle();
  $('#scroll').scrollTop = 0;
  // Each paragraph is a sentence. The first and the last could lose a word.
  const said = Array.from({ length: 30 }, (_, i) => ({ s: i + 1, text: line(i, i !== 0 && i !== 29), need: 5 }));
  await answer(said);
  await choose('Slight trim');
  await t.until(() => lab.pass() === 'proposal' && faded().length === 2, 4000, 'the proposal');
  await act('Walk through');
  await act('Cut');
  const box = editor.root.querySelector('[data-trim].is-current').getBoundingClientRect();
  t.assert(box.top >= 96 && box.bottom <= card.getBoundingClientRect().top - 20, `a cut further down is scrolled to, clear of the card: ${Math.round(box.top)}..${Math.round(box.bottom)}`);
  await act('Stop');
  await act('Cancel');

  // --- a paragraph that goes whole -----------------------------------------------------------------
  // Where every sentence of a paragraph goes, the whole paragraph is ghosted. The blank lines stay,
  // and the piece reads without the paragraph.
  await answer(said.map((one) => (one.s === 2 ? { ...one, need: 1 } : one)));
  $('#scroll').scrollTop = 0;
  await choose('Slight trim');
  await t.until(() => lab.pass() === 'proposal' && faded().length === 3, 4000, 'the proposal');
  t.equal(faded()[1], line(1), 'a paragraph of one sentence the piece is better without is faded whole');
  t.equal(title(), 'Slight trim 330 → 317 words · −4%', 'and counted: there is no more than that to take');
  const blocks = editor.blocks.length;
  await act('Make the cuts');
  t.equal([editor.blocks.length, ghosted(2)], [blocks, [line(1)]], 'the paragraph is ghosted whole, and every line stays');
  t.equal(reading().slice(0, 2), [line(0, false), line(2)], 'the piece reads without it, one blank line between the two around it');
  await t.key('z', { meta: true });
  t.equal([editor.blocks.length, ghosted(2), textOf(2)], [blocks, [], line(1)], 'undo brings it back');
}

// --- a trim and the rest of the app ---------------------------------------------------------------
// Faded words go when the cuts are made, as ghosted words have gone. So the Markdown tab and
// Post to X use the piece with the cuts made, and the tab says so. "As saved" and Save use the
// file, which has no cuts until the writer makes them.
await load();
{
  const source = $('#source');
  const shownSource = () => [...source.querySelectorAll('.body .line')].map((line) => line.textContent).join('\n');
  const size = () => source.querySelector('.bytes').textContent;
  const tab = async (view) => t.click(...t.center(source.querySelector(`.tab[data-view="${view}"]`)));
  const sizeOf = (text) => `${new TextEncoder().encode(text).length.toLocaleString('en-US')} bytes`;
  const TRIMMED = ['the trouble comes from wanting every line to stay.', 'Keep what earns its place and really nothing else.', P3.join(' ')]; // no letter is changed
  await answer(SAID);
  await choose('Slight trim');
  await t.until(() => lab.pass() === 'proposal' && faded().length > 0, 4000, 'the proposal');
  await t.click(...t.center(spanOf('really')));
  commands.run('source');
  await t.until(() => ui.get('source'), 1500, 'the source view');
  const markdown = ['# The short version', ...TRIMMED].join('\n\n');
  t.equal(shownSource(), markdown, 'the Markdown tab is the piece with the cuts made, but for the one kept');
  t.equal(size(), `${sizeOf(markdown)} · with the trim’s cuts made`, 'and says so beside its size');
  await tab('saved');
  t.assert(shownSource().includes(S1) && !/cuts/.test(size()), 'As saved is the file, untrimmed');
  await tab('markdown');
  commands.run('source');
  await t.until(() => !ui.get('source'), 1500, 'the source view to close');
  t.equal([lab.pass(), faded().length], ['proposal', 4], 'looking at the source leaves the trim out');
  const opened = (await t.call('test.opened')).urls.length;
  commands.run('post');
  await t.until(async () => (await t.call('test.opened')).urls.length > opened, 2000, 'Post to X');
  const url = new URL((await t.call('test.opened')).urls.at(-1));
  t.equal(url.searchParams.get('text'), ['The short version', ...TRIMMED].join('\n\n'), 'Post to X takes the piece with the cuts made');
  t.equal(lab.pass(), 'proposal', 'and leaves the trim out');
  await act('Cancel');
  commands.run('source');
  await t.until(() => ui.get('source'), 1500, 'the source view');
  t.equal([shownSource().includes(S1), size()], [true, sizeOf(shownSource())], 'with the trim put away, the Markdown tab is the piece as it is again');
  commands.run('source');
  await t.until(() => !ui.get('source'), 1500, 'the source view to close');
}

// The alternatives panel makes a group of one from the word that it looks at. This is not an
// edit: each word stays in its place, so the trim stays out. Another alternative shown in the
// text changes the words, so the trim goes.
{
  await answer(SAID);
  await choose('Slight trim');
  await t.until(() => lab.pass() === 'proposal' && faded().length > 0, 4000, 'the proposal');
  await t.click(...t.center(spanOf('in my view')));
  const left = CUTS.filter((cut) => cut !== ', in my view,');
  editor.focus();
  editor.select({ block: 7, offset: 3 }); // in "last"
  commands.run('alternatives');
  await t.until(() => ui.get('panel'), 1500, 'the panel');
  t.equal([lab.pass(), faded(), title()], ['proposal', left, summary('Slight trim', 11)], 'the panel opened on a word leaves the trim as it was');
  t.equal(getComputedStyle(spanOf('in my view')).opacity, '1', 'the passage kept is still kept');
  await t.key('Escape');
  await t.until(() => !ui.get('panel'), 1500, 'the panel to close');
  t.equal([lab.pass(), faded()], ['proposal', left], 'and so does closing it');
  t.equal(lab.read(), true, 'what the model said is still kept');
  alternatives.activate('r3ally1', 1, { focus: false });
  await t.settle();
  t.equal([lab.pass(), faded().length, shown(card)], [null, 0, false], 'showing another alternative changes the words: the trim goes');
  await load();
}
