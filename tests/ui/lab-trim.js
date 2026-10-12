// The Lab's trims (design spec 6.10): the model says what could go, by fading it where it
// stands; nothing is cut until the writer says so.
const { editor, ui } = window.writeOn;
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
/** What the model is made to answer, and how soon. */
const answer = (paragraphs, { firstMs = 60, error = null } = {}) =>
  t.call('test.ai', { set: error ? { error, firstMs } : { chunks: [JSON.stringify({ paragraphs }).slice(0, 40), JSON.stringify({ paragraphs }).slice(40)], firstMs, everyMs: 20 } });
const asked = async () => (await t.call('test.ai')).requests;

const P1 = 'Much of the trouble, in my view, comes from wanting every line to stay. It rarely works out that way.';
const P3 = 'A last paragraph that the trim leaves alone.';
const DOC =
  '<p><br></p><p># The short version</p><p><br></p>' +
  `<p>${P1}</p><p><br></p>` +
  '<p>Keep <span data-ghost>this aside </span>what earns its place and <span data-vid="r3ally1">really</span> nothing else, then stop.</p><p><br></p>' +
  `<p>${P3}</p>`;
const GROUPS = { r3ally1: { scope: 'word', variants: ['really', 'truly'], active: 0 } };
const SLIGHT = [
  { n: 1, text: 'The trouble comes from wanting every line to stay.' },
  { n: 2, text: 'Keep what earns its place and nothing else.' },
];
const CUTS = ['Much of ', ', in my view,', ' It rarely works out that way.', 'really ', ', then stop'];
const load = async () => {
  editor.setState({ html: DOC, groups: structuredClone(GROUPS), overflow: '' });
  editor.focus();
  editor.select({ block: 7, offset: 0 });
  await t.settle();
};
await load();
const before = html();
// Words that are not ghosted: 3 in the heading, then 20, 11 and 8 in the paragraphs. The
// answer above cuts 14 of them; 11 if ", in my view," is kept.
const WORDS = 42;
const summary = (name, cut) => `${name} ${WORDS} → ${WORDS - cut} words · −${Math.round((cut / WORDS) * 100)}%`;

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
  t.equal([style.backgroundColor, style.borderTopWidth, style.borderTopColor, style.clipPath], ['rgb(18, 21, 34)', '1px', 'rgb(35, 39, 53)', 'none'], 'in the popover colour with a hairline edge, whole once it is open');
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
  t.equal(getComputedStyle(level('Original')).borderTopColor, 'rgb(129, 124, 212)', 'in the accent colour');
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

await answer(SLIGHT, { firstMs: 1500 });
await choose('Slight trim');
t.assert(!ui.get('lab'), 'choosing a level closes the popover');
t.assert(shown(card), 'and puts a card at the foot of the page');
{
  t.equal(title(), 'Slight trim Reading…', 'the card names the trim and says it is reading');
  t.equal(card.querySelector('.hint').textContent, 'Faded words would go. Click one to keep it.', 'with what the fading will mean');
  t.equal(actions(), ['Make the cuts', 'Done'], 'and two buttons');
  const box = card.getBoundingClientRect();
  t.equal([box.width, box.height], [500, 88], 'a 500 by 88 card');
  t.near(box.left + box.width / 2, innerWidth / 2, 0.3, 'in the middle');
  t.near(innerHeight - box.bottom, 55, 0.01, '55px above the bottom of the window');
  const [first, second] = [...card.querySelectorAll('.actions button')].map((b) => b.getBoundingClientRect());
  t.equal([first.height, Math.round((second.left - first.right) * 10) / 10, Math.round((first.left - box.left) * 10) / 10], [22, 8, 16], 'its buttons are 22px tall and 8px apart, starting 16px in');
  t.equal(getComputedStyle(card.querySelector('.state')).color, 'rgb(129, 124, 212)', 'Reading… is in the accent colour');
  await t.until(() => !shown(menu), 1000, 'the popover to be out of the way');
  await t.snap('reading');
}
// The model is offered the paragraphs, not the heading, and not what is ghosted.
{
  const [request] = await asked();
  const said = request.messages.map((m) => m.content).join('\n');
  t.assert(said.includes(`[1] ${P1}`) && said.includes('[2] Keep what earns its place and really nothing else, then stop.') && said.includes(`[3] ${P3}`), 'the paragraphs go to the model, numbered');
  t.assert(!said.includes('this aside') && !said.includes('The short version'), 'without ghosted text or the heading');
  t.assert(/about 10%/.test(said), 'with how much to cut');
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

await t.until(() => faded().length > 0, 4000, 'the proposal to arrive');
t.equal(faded(), CUTS, 'what could go is faded where it stands');
t.same(html(), before, 'the text itself is untouched');
t.assert(!editor.canUndo, 'and nothing has been done that could be undone');
t.assert(!shown(scan), 'the line is gone');
{
  const span = spanOf('in my view');
  t.equal(getComputedStyle(span).opacity, '0.22', 'faded words are drawn at 22%, twice as strong as ghosted ones');
  t.equal(title(), summary('Slight trim', 14), 'the card counts the words before and after');
  t.equal(actions(), ['Make the cuts', 'Walk through', 'Done'], 'and offers to walk through the cuts');
  const box = card.getBoundingClientRect();
  t.near(box.width, 601.5, 0.01, 'the card is 601.5px wide now, as in the clip');
  t.near(box.left + box.width / 2, innerWidth / 2, 0.3, 'still in the middle');
  t.equal(getComputedStyle(card.querySelector('.state')).color, 'rgb(129, 124, 212)', 'the numbers are in the accent colour');
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

await t.click(...t.center(spanOf('really')));
t.equal(faded().length, 4, 'one cut is kept');
await act('Make the cuts');
t.equal(textOf(3), 'The trouble comes from wanting every line to stay.', 'the cuts are made, and the sentence starts with a capital');
t.equal(textOf(5), 'Keep this aside what earns its place and really nothing else.', 'the kept words stay, and so does what was ghosted');
t.equal(editor.root.querySelectorAll('[data-trim]').length, 0, 'nothing is faded any more');
t.assert(!shown(card), 'and the card is gone');
t.equal(Object.keys(editor.groups), ['r3ally1'], 'a group that was kept is still a group');
await t.key('z', { meta: true });
t.same(html(), before, 'one undo brings every word back');
t.assert(!editor.canUndo, 'it was a single step');
await t.key('z', { meta: true, shift: true });
t.equal(textOf(3), 'The trouble comes from wanting every line to stay.', 'and redo makes the cuts again');
await load();

// A cut that takes all of a group takes the group.
await answer(SLIGHT);
await choose('Slight trim');
await t.until(() => faded().length > 0, 4000, 'the proposal');
await act('Make the cuts');
t.equal(textOf(5), 'Keep this aside what earns its place and nothing else.', 'every cut made');
t.equal(Object.keys(editor.groups), [], 'the group whose only word went is gone');
await load();

// --- putting a proposal away ----------------------------------------------------------------------

await answer(SLIGHT);
await choose('Slight trim');
await t.until(() => faded().length > 0, 4000, 'the proposal');
await act('Done');
t.equal([faded().length, shown(card)], [0, false], 'Done puts the proposal away');
t.same(html(), before, 'and leaves the text as it was');
await openMenu();
t.equal(pending(), 'Original', 'Original is marked again');
await t.key('Escape');

// Another level replaces what is proposed.
await answer(SLIGHT);
await choose('Slight trim');
await t.until(() => faded().length > 0, 4000, 'the proposal');
await answer([{ n: 3, text: 'A last paragraph the trim leaves alone.' }], { firstMs: 400 });
await choose('Tighten more');
t.equal([faded().length, title()], [0, 'Tighten more Reading…'], 'choosing another level starts over');
await t.until(() => faded().length > 0, 4000, 'the second proposal');
t.equal(faded(), ['that '], 'with only what the new answer would cut');
t.equal(title(), summary('Tighten more', 1), 'under its own name');
t.near(card.getBoundingClientRect().width, 608.5, 0.01, 'on a card one letter wider');
t.assert(/about 20%/.test((await asked()).pop().messages.map((m) => m.content).join('\n')), 'having asked for 20%');
// Original puts it away.
await choose('Original');
t.equal([faded().length, shown(card), ui.get('lab')], [0, false, false], 'Original puts the proposal away and closes the popover');

// An edit, an undo or a redo makes a proposal stale, so it goes.
for (const [what, change] of [
  ['typing', () => t.type('x')],
  ['undo', () => t.key('z', { meta: true })],
  ['redo', () => t.key('z', { meta: true, shift: true })],
]) {
  await answer(SLIGHT);
  await choose('Slight trim');
  await t.until(() => faded().length > 0, 4000, `the proposal before ${what}`);
  editor.focus();
  editor.select({ block: 7, offset: 0 });
  await change();
  t.equal([faded().length, shown(card)], [0, false], `${what} puts the proposal away`);
}
t.assert(textOf(7).startsWith('xA last'), 'and the edit itself stands');
await load();

// While it is still reading, an edit calls the request off.
{
  await answer(SLIGHT, { firstMs: 3000 });
  await choose('Slight trim');
  t.assert(shown(scan), 'reading');
  editor.focus();
  await t.type('y');
  t.equal([shown(card), shown(scan)], [false, false], 'an edit while it reads puts the card and the line away');
  const { requests, cancelled } = await t.call('test.ai');
  t.assert(cancelled.includes(requests[requests.length - 1].id), 'and calls the request off');
  await load();
}

// Read mode is just the text: the popover and anything proposed are put away.
{
  await answer(SLIGHT);
  await choose('Slight trim');
  await t.until(() => faded().length > 0, 4000, 'the proposal before read mode');
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
  t.equal(card.querySelector('.hint').textContent, 'There is nothing here to trim.', 'a page with no paragraphs has nothing to trim');
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
await act('Done');
t.assert(!shown(card), 'Done puts it away');

// A paragraph the model rewrote is left alone; one it only cut is still proposed.
await answer([
  { n: 1, text: 'Most trouble comes from wanting to keep every line.' },
  { n: 3, text: 'A last paragraph the trim leaves alone.' },
]);
await choose('Cut in half');
await t.until(() => faded().length > 0, 4000, 'the proposal');
t.equal(faded(), ['that '], 'a paragraph that came back reworded is not touched');
await act('Done');
// Nothing usable at all.
await answer([{ n: 1, text: 'Something else entirely.' }]);
await choose('Cut in half');
await t.until(() => actions().length === 1, 3000, 'the card to give up');
t.equal(card.querySelector('.hint').textContent, 'The AI found nothing it could cut without rewording.', 'an answer with nothing usable says so');
t.same(html(), before, 'and changes nothing');
await act('Done');

// --- walking through ------------------------------------------------------------------------------

await answer(SLIGHT);
await choose('Slight trim');
await t.until(() => faded().length > 0, 4000, 'the proposal');
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
t.equal(actions(), ['Make the cuts', 'Walk through', 'Done'], 'and its buttons');
t.equal(editor.root.querySelectorAll('[data-trim].is-current').length, 0, 'nothing is pointed out any more');
t.same(html(), before, 'the walk itself cuts nothing');
// Walking to the end comes back to the summary as well.
await act('Walk through');
for (let i = 0; i < 5; i++) await act('Cut');
t.equal(actions(), ['Make the cuts', 'Walk through', 'Done'], 'after the last cut the summary is back');
t.equal(faded(), CUTS, 'Cut on a passage that was kept lets it go after all');
await act('Done');

// Each passage is brought into view as its turn comes.
{
  const many = Array.from({ length: 30 }, (_, i) => `<p>Paragraph ${i + 1} is honestly a line with a word to lose.</p><p><br></p>`).join('');
  editor.setState({ html: many, groups: {}, overflow: '' });
  await t.settle();
  $('#scroll').scrollTop = 0;
  await answer(Array.from({ length: 30 }, (_, i) => ({ n: i + 1, text: `Paragraph ${i + 1} is a line with a word to lose.` })).filter((p) => p.n === 1 || p.n === 30));
  await choose('Slight trim');
  await t.until(() => faded().length === 2, 4000, 'the proposal');
  await act('Walk through');
  await act('Cut');
  const box = editor.root.querySelector('[data-trim].is-current').getBoundingClientRect();
  t.assert(box.top >= 96 && box.bottom <= card.getBoundingClientRect().top - 20, `a cut further down is scrolled to, clear of the card: ${Math.round(box.top)}..${Math.round(box.bottom)}`);
  await act('Stop');
  await act('Done');
}
