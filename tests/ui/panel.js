// The alternatives panel (design spec 6.5), following the clip: target a word, add an
// alternative, walk the list, retarget, close.
const { editor, ui, alternatives, panel, sound } = window.writeOn;
ui.set({ read: false });
await document.fonts.ready;

const ticks = [];
sound.tick = (tone) => ticks.push(tone);
const heard = () => ticks.splice(0).join(' ');

const WORDS = ['tension', 'pressure', 'uncertainty', 'difficulty', 'struggle', 'friction', 'tough stuff'];
editor.setState({
  html:
    '<p><br></p><p># <span data-vid="title01">A headline with two versions</span></p><p><br></p>' +
    '<p>Most of the <span data-vid="tens10n">tension</span> in a first draft comes from wanting every sentence to be final. It never is.</p>' +
    '<p><br></p><p>A second paragraph, for the caret to visit. It has a plain word or two in it.</p>',
  groups: {
    title01: { scope: 'sentence', variants: ['A headline with two versions', 'A headline, twice'], active: 0 },
    tens10n: { scope: 'word', variants: WORDS, active: 0, ai: ['struggle', 'friction'] },
  },
  overflow: '',
});
await t.settle();

const $ = (s) => document.querySelector(s);
const el = $('#panel');
const rows = () => [...el.querySelectorAll('.row')];
const rowTexts = () => rows().map((r) => r.querySelector('.text').textContent);
const activeRow = () => rows().findIndex((r) => r.classList.contains('active'));
const focusedRow = () => rows().findIndex((r) => r.contains(document.activeElement));
/** How many characters of the focused row lie before the caret. */
const caretAt = () => {
  const selection = getSelection();
  const range = document.createRange();
  range.selectNodeContents(document.activeElement);
  range.setEnd(selection.focusNode, selection.focusOffset);
  return range.toString().length;
};
const docText = (i) => editor.blocks[i].runs.map((r) => r.text).join('');
const showing = (vid) => editor.groups[vid]?.variants[editor.groups[vid].active];
const alpha = (node) => {
  const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(node).color)[1].split(',').map(Number);
  return m.length > 3 ? m[3] : 1;
};
const settled = () => t.until(() => el.getAnimations({ subtree: false }).length === 0 && getComputedStyle(el).transform === 'none', 1500, 'the panel to finish sliding');
const P1 = 3; // the paragraph with "tension"
const P2 = 5;

// --- opening on an existing group -------------------------------------------------------------

t.equal(getComputedStyle(el).visibility, 'hidden', 'the panel starts closed');
const undoBefore = editor.canUndo;
editor.select({ block: P1, offset: 14 });
t.equal(panel.open(), true, 'the panel opens on the word at the caret');
t.assert(ui.get('panel'), 'the interface knows the panel is open');
// It slides as in the clip: 200ms on the browser's own curve. The clip's frames have its
// edge 177.5px short of its place 47.5ms in, and 39.5px short at 114.2ms.
{
  const slide = el.getAnimations({ subtree: false })[0];
  if (t.assert(slide, 'it slides in')) {
    slide.pause();
    slide.currentTime = 47.5;
    await t.frame();
    t.near(280 - el.getBoundingClientRect().right, 177.5, 5, 'early in the slide it is where the clip has it');
    slide.currentTime = 114.2;
    await t.frame();
    t.near(280 - el.getBoundingClientRect().right, 39.5, 4, 'and later too');
    slide.play();
  }
}
await settled();
{
  const box = el.getBoundingClientRect();
  t.equal([box.left, box.top, box.width, box.height], [0, 0, 280, innerHeight], 'it covers the left 280px of the window');
  t.equal(getComputedStyle(el).backgroundColor, 'rgb(10, 15, 31)', 'in the panel colour');
  t.equal(getComputedStyle(el).borderRightWidth, '1px', 'with a hairline on its right');
  t.near($('#page').getBoundingClientRect().left, 384, 0.5, 'the text column does not move');
}
t.equal(panel.target(), 'tens10n', 'the group at the caret is the target');
t.equal(rowTexts(), WORDS, 'one row per variant');
t.equal(activeRow(), 0, 'the showing variant is the active row');
t.equal(focusedRow(), 0, 'the caret is in the active row');
t.equal(caretAt(), 7, 'at the end of its text');
t.equal(rows().map((r) => r.classList.contains('ai')), [false, false, false, false, true, true, false], 'the AI’s variants are marked');
t.equal([...el.querySelectorAll('.tab')].map((tab) => [tab.textContent, tab.classList.contains('active')]), [['Word', true], ['Sentence', false], ['Paragraph', false]], 'the tabs show the scope');
t.equal(el.querySelector('.hint').textContent, 'return adds · esc closes', 'the hint');
t.equal(heard(), '', 'opening is silent');

// Where things are, on the 1548x976 page of the clips.
{
  const first = rows()[0];
  const text = first.querySelector('.text');
  const marker = first.querySelector('.marker').getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(text);
  const ink = range.getBoundingClientRect();
  t.near(ink.left, 40.4, 0.5, 'row text starts 40px in');
  t.equal(getComputedStyle(text).fontSize, '15px', 'row text size');
  t.near(marker.left + marker.width / 2, 26, 0.3, 'markers are centred 26px in');
  t.near(rows()[1].getBoundingClientRect().top - first.getBoundingClientRect().top, 31.8, 0.05, 'rows are 31.8px apart');
  t.near(rows()[7 - 1].getBoundingClientRect().top - first.getBoundingClientRect().top, 31.8 * 6, 0.2, 'all the way down');
  const probe = document.createElement('span');
  probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  text.append(probe);
  const baseline = probe.getBoundingClientRect().top;
  probe.remove();
  t.near(baseline, 238.6, 0.6, 'the first row sits on the line of the page’s first text');
  const tab = el.querySelector('.tab');
  t.equal(getComputedStyle(tab).fontFamily.split(',')[0].replace(/"/g, ''), 'Caveat', 'tabs are in the handwriting face');
  t.near(tab.getBoundingClientRect().left, 22, 0.5, 'tabs start 22px in');
  t.near(parseFloat(getComputedStyle(tab).fontSize), 20.2, 0.01, 'tab size');
  const tabs = [...el.querySelectorAll('.tab')].map((node) => node.getBoundingClientRect());
  t.near(tabs[1].left - tabs[0].right, 13.7, 0.5, 'tabs are just under 14px apart');
  const hint = el.querySelector('.hint').getBoundingClientRect();
  t.near(hint.left, 20, 0.5, 'the hint starts 20px in');
  t.near(innerHeight - hint.bottom, 73, 4, 'the hint sits near the bottom');
}

// The page: the target at full strength, the rest of its paragraph back a step, everything else further.
{
  const target = editor.elementFor('tens10n');
  t.equal(alpha(target), 1, 'the target is at full strength');
  t.near(alpha(editor.blockElement(P1)), 0.66, 0.01, 'the rest of its paragraph is at two thirds');
  t.near(alpha(editor.blockElement(P2)), 0.36, 0.01, 'other paragraphs are at about a third');
  t.near(alpha(editor.blockElement(1)), 0.36, 0.01, 'the heading too');
  t.assert(document.querySelector('#decor g[data-vid="title01"]') !== null, 'marks elsewhere stay');
  await t.until(() => Number(getComputedStyle($('#decor')).opacity) > 0.99, 1000, 'the marks to be at full strength');
}

// --- adding an alternative ----------------------------------------------------------------------

await t.key('Enter');
t.equal(rowTexts(), [...WORDS, ''], 'Return adds an empty row');
t.equal(focusedRow(), 7, 'with the caret in it');
t.equal(activeRow(), 0, 'the showing variant stays');
t.equal(editor.groups.tens10n.variants.length, 7, 'and nothing is a variant until it has text');
await t.key('Enter');
t.equal(rowTexts().length, 8, 'Return in the empty row adds no second one');

await t.type('c');
t.equal(editor.groups.tens10n.variants[7], 'c', 'the first character makes a variant');
t.equal(showing('tens10n'), 'c', 'and shows it');
t.assert(docText(P1).startsWith('Most of the c in'), 'in the page');
t.equal(activeRow(), 7, 'its row is the active one');
t.equal(heard(), 'high', 'with a tick');
await t.type('hallenge');
t.equal(editor.groups.tens10n.variants[7], 'challenge', 'typing on edits the variant');
t.assert(docText(P1).startsWith('Most of the challenge in'), 'and the page follows each letter');
t.equal(heard(), '', 'without more ticks');
t.equal(rowTexts(), [...WORDS, 'challenge'], 'eight rows now');
t.assert(!rows()[7].classList.contains('ai'), 'a typed variant is the writer’s own');

// --- walking the list ---------------------------------------------------------------------------

await t.key('ArrowUp');
t.equal([activeRow(), showing('tens10n'), focusedRow()], [6, 'tough stuff', 6], 'Up moves to the row above and shows it');
t.equal(caretAt(), 'tough stuff'.length, 'caret at the end of the row');
await t.key('ArrowUp');
t.equal([activeRow(), showing('tens10n')], [5, 'friction'], 'and again');
t.assert(docText(P1).startsWith('Most of the friction in'), 'the page shows it');
await t.settle();
await t.wait(200);
await t.snap('panel');
for (let i = 0; i < 5; i++) await t.key('ArrowUp');
t.equal([activeRow(), showing('tens10n')], [0, 'tension'], 'up to the top');
t.equal(heard(), 'high high high high high high low', 'every step ticks high; landing on the one the panel opened with ticks low');
await t.key('ArrowUp');
t.equal(activeRow(), 0, 'Up at the top stays there');
t.equal(heard(), '', 'in silence');
for (let i = 0; i < 7; i++) await t.key('ArrowDown');
t.equal([activeRow(), showing('tens10n')], [7, 'challenge'], 'Down to the bottom');
await t.key('ArrowDown');
t.equal(activeRow(), 7, 'Down at the bottom stays there');
t.equal(heard(), 'high high high high high high high', 'the home variant is still the one the panel opened with');

// Clicking a row shows it.
{
  const r = rows()[2].querySelector('.text').getBoundingClientRect();
  await t.click(r.left + 30, r.top + r.height / 2);
  t.equal([activeRow(), showing('tens10n'), focusedRow()], [2, 'uncertainty', 2], 'a click makes a row active');
  t.equal(heard(), 'high', 'with a tick');
  t.equal(editor.elementFor('tens10n').getAnimations().length, 1, 'and the swap blurs in on the page');
  const first = rows()[0].querySelector('.text').getBoundingClientRect();
  await t.click(first.left + 30, first.top + first.height / 2);
  t.equal(heard(), 'low', 'back to the first: low');
}

// --- editing and emptying rows ------------------------------------------------------------------

// Typing in a row edits that variant, and the page with it.
{
  const r = rows()[7].querySelector('.text').getBoundingClientRect();
  await t.click(r.right - 2, r.top + r.height / 2);
  heard();
  await t.type('s');
  t.equal(editor.groups.tens10n.variants[7], 'challenges', 'typing in a row edits its variant');
  t.assert(docText(P1).startsWith('Most of the challenges in'), 'and the page');
  await t.key('Backspace');
  t.equal(editor.groups.tens10n.variants[7], 'challenge', 'and back');
}
// Emptying a row removes the variant; what was showing before it returns.
{
  await t.key('ArrowUp'); // tough stuff
  await t.key('ArrowDown'); // challenge again, so "tough stuff" was showing before it
  heard();
  for (let i = 0; i < 'challenge'.length; i++) await t.key('Backspace');
  t.equal(editor.groups.tens10n.variants, WORDS, 'emptying a row removes its variant');
  t.equal(showing('tens10n'), 'tough stuff', 'and the one showing before it returns');
  t.equal(activeRow(), 6, 'its row is active again');
  t.equal(rowTexts(), [...WORDS, ''], 'the emptied row stays, empty');
  t.equal(focusedRow(), 7, 'with the caret still in it');
  t.equal(heard(), 'high', 'the change of what shows ticks');
  await t.type('snag');
  t.equal(editor.groups.tens10n.variants[7], 'snag', 'typing there again makes a new variant');
  t.equal(heard(), 'high', 'and ticks');
}
// Text that would be a duplicate does not become a second variant.
{
  await t.key('Enter');
  await t.type('snag');
  t.equal(editor.groups.tens10n.variants.filter((v) => v === 'snag').length, 1, 'a row repeating another variant adds nothing');
  for (let i = 0; i < 4; i++) await t.key('Backspace');
  t.equal(editor.groups.tens10n.variants.length, 8, 'and removing its text removes nothing');
}
// Undo works from inside the panel and the rows follow.
{
  const before = [...editor.groups.tens10n.variants];
  await t.key('z', { meta: true });
  t.assert(JSON.stringify(editor.groups.tens10n.variants) !== JSON.stringify(before) || showing('tens10n') !== 'snag', 'Cmd+Z in the panel undoes the last change to the document');
  t.equal(rowTexts().filter(Boolean), editor.groups.tens10n.variants, 'and the rows show the group as it now is');
  await t.key('z', { meta: true, shift: true });
  t.equal(editor.groups.tens10n.variants, before, 'redo brings it back');
}
// A pasted line goes in as plain text on one line.
{
  await t.key('Enter');
  const data = new DataTransfer();
  data.setData('text/plain', 'two\nlines');
  data.setData('text/html', '<b>two</b><br>lines');
  document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  await t.settle();
  t.equal(rowTexts().at(-1), 'two lines', 'a paste into a row is plain text on one line');
  t.equal(el.querySelectorAll('.row .text *').length, 0, 'with no markup');
  t.equal(editor.groups.tens10n.variants.at(-1), 'two lines', 'and becomes the variant');
  for (let i = 0; i < 'two lines'.length; i++) await t.key('Backspace');
}
heard();

// --- retargeting from the page ------------------------------------------------------------------

// Clicking a word with no alternatives targets it: one row and an empty one, and an underline in the page.
await t.click(...t.pointOfText('second'));
{
  const vid = panel.target();
  t.assert(vid && vid !== 'tens10n', 'a click on a word in the page retargets the panel');
  t.equal(heard(), '', 'silently');
  t.equal(rowTexts(), ['second', ''], 'its text and an empty row');
  {
    // In the clip the rows of a new target come up from dark over about 0.13 s.
    const fading = el.querySelector('.rows').getAnimations();
    t.equal(fading.length, 1, 'the list of the new target fades in');
    t.near(fading[0]?.effect.getComputedTiming().duration ?? 0, 130, 1, 'over 130ms');
    // The pointer is a text cursor over a row's words and an arrow beside them.
    const row = rows()[0];
    t.equal([getComputedStyle(row).cursor, getComputedStyle(row.querySelector('.text')).cursor, getComputedStyle(row.querySelector('.marker')).cursor], ['default', 'text', 'default'], 'the pointer is an I-beam over a row’s text only');
  }
  t.equal([activeRow(), focusedRow()], [0, 1], 'the caret waits in the empty row');
  t.equal(editor.groups[vid], { scope: 'word', variants: ['second'], active: 0 }, 'the word is a group while it is the target');
  await t.settle();
  t.assert(document.querySelector(`#decor g[data-vid="${vid}"] path.line`) !== null, 'and is underlined like one');
  {
    // In the clips the word in the page has a dot for every row of the panel's list, the
    // empty row among them: two under a new target, a third when Return opens another row.
    const dots = () => [...document.querySelectorAll(`#decor g[data-vid="${vid}"] circle.dot`)].map((dot) => dot.classList.contains('active'));
    t.equal(dots(), [true, false], 'a dot for the word and one for the empty row');
    await t.type('next');
    await t.settle();
    t.equal([rowTexts(), dots()], [['second', 'next'], [false, true]], 'typed in, the row is an alternative, and its dot the filled one');
    await t.key('Enter');
    await t.settle();
    t.equal([rowTexts(), dots()], [['second', 'next', ''], [false, true, false]], 'Return opens a row, and a dot with it');
    await t.key('Backspace');
    for (let i = 0; i < 4; i++) await t.key('Backspace');
    await t.settle();
    t.equal([rowTexts(), dots()], [['second', ''], [true, false]], 'emptied again, it is as it was');
  }
  t.equal(alpha(editor.blockElement(P2)), 0.66, 'its paragraph comes forward');
  t.near(alpha(editor.blockElement(P1)), 0.36, 0.01, 'the one before steps back');
  t.assert(editor.groups.tens10n.variants.length >= 8, 'the group left behind keeps its alternatives');

  // Moving on without adding anything leaves no trace.
  await t.click(...t.pointOfText('caret'));
  t.equal(editor.groups[vid], undefined, 'a target left with only its original text is plain text again');
  t.equal(editor.elementFor(vid), null, 'with no mark');
  t.equal(rowTexts(), ['caret', ''], 'and the panel has moved on');

  // A click inside the current target, or on no word at all, changes nothing.
  const now = panel.target();
  await t.click(...t.pointOfText('caret'));
  t.equal(panel.target(), now, 'clicking the target itself keeps it');
  const blank = editor.blockElement(4).getBoundingClientRect();
  await t.click(blank.left + 300, blank.top + 18);
  t.equal(panel.target(), now, 'so does clicking a blank line');
}

// --- tabs ---------------------------------------------------------------------------------------

{
  const tab = (name) => [...el.querySelectorAll('.tab')].find((b) => b.textContent === name);
  const press = async (name) => {
    const r = tab(name).getBoundingClientRect();
    await t.click(r.left + r.width / 2, r.top + r.height / 2);
  };
  await press('Sentence');
  t.equal(editor.groups[panel.target()].scope, 'sentence', 'the Sentence tab targets the sentence around the same spot');
  t.equal(rowTexts(), ['A second paragraph, for the caret to visit.', ''], 'all of it');
  t.assert(tab('Sentence').classList.contains('active') && !tab('Word').classList.contains('active'), 'and the tab shows it');
  await press('Paragraph');
  t.equal(editor.groups[panel.target()].scope, 'paragraph', 'the Paragraph tab targets the paragraph');
  t.equal(rowTexts()[0], docText(P2), 'whole');
  t.equal(editor.blocks[P2].vid, panel.target(), 'as a paragraph group');
  t.equal(Object.values(editor.groups).filter((g) => g.variants.length === 1).length, 1, 'only the current target is a group of one');
  await press('Word');
  t.equal(editor.groups[panel.target()].scope, 'word', 'and Word goes back to a word');
  // A long row wraps inside the panel instead of running out of it.
  await press('Paragraph');
  const long = rows()[0].getBoundingClientRect();
  t.assert(long.right <= 280 && long.height > 60, `a long variant wraps (${Math.round(long.height)}px tall)`);
  t.near(rows()[1].getBoundingClientRect().top, long.bottom, 0.5, 'and the next row starts below it');
}

// --- undo, as in the clip -------------------------------------------------------------------------
// He asks for suggestions for a word, tries three of them, and undoes. One undo takes the
// whole batch away and leaves the word and the empty row, with the caret in it. A second
// takes the empty row and nothing else: the word stays underlined, the panel stays on it, and
// what was typed in the page before is untouched.
{
  await t.key('Escape');
  await t.until(() => !ui.get('panel'), 1500, 'the panel to close');
  editor.focus();
  editor.select({ block: P2, offset: 0 });
  await t.settle();
  await t.type('Well. ');
  await t.wait(800); // the typing is a step of its own
  const typed = docText(P2);
  const steps = () => {
    let n = 0;
    while (editor.canUndo && n < 50) {
      editor.undo();
      n += 1;
    }
    for (let i = 0; i < n; i++) editor.redo();
    return n;
  };
  const before = steps();

  editor.select({ block: P2, offset: docText(P2).indexOf('caret') + 2 });
  await t.settle();
  await t.key('a', { ctrl: true, shift: true });
  await t.until(() => ui.get('panel') && rowTexts().length === 2, 1500, 'the panel to open on the word');
  const vid = panel.target();
  t.equal([rowTexts(), focusedRow()], [['caret', ''], 1], 'the word, and an empty row with the caret in it');

  await t.call('test.ai', { set: { chunks: ['cursor\n', 'pointer\n', 'mark\n', 'point\n', 'bar\n'], firstMs: 30, everyMs: 20 } });
  await t.type('??');
  await t.until(() => editor.groups[vid]?.variants.length === 6, 5000, 'five suggestions to arrive');
  await t.settle();
  t.equal(rowTexts(), ['caret', 'cursor', 'pointer', 'mark', 'point', 'bar'], 'the batch is in');
  // Trying them: three rows, one after another.
  for (const index of [2, 4, 3]) {
    await t.click(...t.center(rows()[index].querySelector('.text')));
    await t.wait(120);
  }
  t.equal([showing(vid), docText(P2).includes('visit. It') && docText(P2).includes('the mark to')], ['mark', true], 'the last one tried is showing in the page');

  await t.key('z', { meta: true });
  await t.settle();
  t.equal([rowTexts(), focusedRow()], [['caret', ''], 1], 'one undo takes the whole batch: the word and the empty row are left, with the caret in the row');
  t.equal(docText(P2), typed, 'and the page reads as it did');

  await t.key('z', { meta: true });
  await t.settle();
  t.equal([rowTexts(), ui.get('panel'), panel.target()], [['caret'], true, vid], 'a second takes the empty row and nothing else: the panel stays on the word');
  t.assert(document.querySelector(`#decor g[data-vid="${vid}"] path.line`) !== null, 'which is still underlined');
  t.equal(docText(P2), typed, 'and what was typed in the page before is untouched');

  await t.key('z', { meta: true, shift: true });
  await t.settle();
  t.equal(rowTexts(), ['caret', ''], 'redo brings the empty row back');
  await t.key('z', { meta: true });
  await t.settle();

  // Leaving a word nothing was added to leaves nothing to undo for it.
  await t.key('Escape');
  await t.until(() => !ui.get('panel'), 1500, 'the panel to close');
  t.equal(editor.groups[vid], undefined, 'the word is plain text again');
  t.equal(steps(), before, 'and no step of the panel’s is left behind');
  await t.key('z', { meta: true });
  t.assert(!docText(P2).startsWith('Well. '), 'the next undo is of the typing');
  heard();

  // Back on a group, for what follows.
  editor.select({ block: P2, offset: docText(P2).indexOf('second') + 2 });
  await t.settle();
  await t.key('a', { ctrl: true, shift: true });
  await t.until(() => ui.get('panel'), 1500, 'the panel to open again');
}

// --- closing ------------------------------------------------------------------------------------

{
  const vid = panel.target();
  await t.key('Escape');
  t.assert(!ui.get('panel'), 'Esc closes the panel');
  await t.until(() => getComputedStyle(el).visibility === 'hidden', 1500, 'the panel to slide away');
  t.equal(panel.target(), null, 'nothing is targeted');
  t.equal(editor.groups[vid], undefined, 'the untouched target dissolves');
  t.equal(Object.keys(editor.groups).sort(), ['tens10n', 'title01'], 'only real groups remain');
  t.equal(alpha(editor.blockElement(P1)), 1, 'the page is back at full strength');
  t.equal(document.activeElement, editor.root, 'and has the focus');
}

// Looking at a word and leaving is not something to undo.
{
  const steps = () => {
    let n = 0;
    while (editor.canUndo && n < 500) {
      editor.undo();
      n += 1;
    }
    for (let i = 0; i < n; i++) editor.redo();
    return n;
  };
  const before = steps();
  editor.select({ block: P2, offset: 3 });
  panel.open();
  await t.key('Escape');
  t.equal(steps(), before, 'opening on a word and closing again adds no undo steps');
  t.equal(Object.keys(editor.groups).sort(), ['tens10n', 'title01'], 'and leaves the groups as they were');
}

// A group whose only alternative is undone away, while the panel is closed, is plain text again.
{
  editor.select({ block: P2, offset: 3 });
  panel.open();
  await t.type('another');
  const vid = panel.target();
  t.equal(editor.groups[vid].variants, ['second', 'another'], 'a real group is made by adding to a target');
  await t.key('Escape');
  t.equal(editor.groups[vid].variants.length, 2, 'and it outlives the panel');
  await t.key('z', { meta: true });
  t.equal(editor.groups[vid], undefined, 'undoing the addition leaves no group of one behind');
  t.assert(docText(P2).startsWith('A second paragraph'), 'and the original text');
}

// Read mode is just the text: going into it closes the panel.
editor.select({ block: P1, offset: 14 });
panel.open();
await settled();
ui.set({ read: true });
t.equal(ui.get('panel'), false, 'entering read mode closes the panel');
await t.until(() => el.getAnimations({ subtree: false }).length === 0, 1500, 'the panel to slide away');
t.equal(getComputedStyle(el).visibility, 'hidden', 'and it is out of sight');
t.equal(alpha(editor.blockElement(P2)), 1, 'with the page back at full strength');
ui.set({ read: false });
t.equal(ui.get('panel'), false, 'it stays closed when the tools come back');

// Where there is nothing to target, nothing opens. Opening leaves read mode.
editor.select({ block: 4, offset: 0 });
t.equal(panel.open(), false, 'no word, no panel');
t.assert(!ui.get('panel'), 'it stays closed');
ui.set({ read: true });
editor.select({ block: P1, offset: 14 });
t.equal(panel.open(), true, 'opening from read mode');
t.assert(!ui.get('read'), 'turns the tools on');
await t.key('Escape');
t.equal(undoBefore, false, 'the scenario began with nothing to undo');
