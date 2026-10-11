// Ghost text (design spec 6.7): dimming a passage where it stands, and bringing it back.
const { editor, ui, commands, alternatives } = window.writeOn;
ui.set({ read: false });
await document.fonts.ready;

const $ = (s) => document.querySelector(s);
const html = () => editor.getState().html;
const textOf = (i) => editor.blocks[i].runs.map((r) => r.text).join('');
const ghosts = () => [...editor.root.querySelectorAll('[data-ghost]')].map((el) => el.textContent);
const selected = () => {
  const s = editor.selection();
  return s && [s.start.block, s.start.offset, s.end.block, s.end.offset];
};
const selectIn = (block, needle) => {
  const from = textOf(block).indexOf(needle);
  editor.select({ block, offset: from }, { block, offset: from + needle.length });
  return [from, from + needle.length];
};
const item = (label) => [...document.querySelectorAll('#menu .item')].find((n) => n.querySelector('.label').textContent === label);
const third = () => document.querySelectorAll('#menu .item .label')[2]?.textContent;
const choose = async (label) => {
  const r = item(label).getBoundingClientRect();
  await t.click(r.left + 60, r.top + 15);
};
const brief = (s) => (s.length > 160 ? `${s.slice(0, 160)}…` : s);
/** Whole strings must match; a failure shows only where they part. */
const same = (actual, expected, message) => {
  let i = 0;
  while (i < actual.length && actual[i] === expected[i]) i += 1;
  const near = (s) => `…${s.slice(Math.max(0, i - 30), i + 70)}…`;
  t.assert(actual === expected, `${message}: at ${i} expected ${near(expected)}, got ${near(actual)}`);
};

const PASSAGE = 'Others only seem to, and you cannot tell which is which until the page has rested for a day or two.';
const SAID = 'It can be said another way.';
const OTHERWISE = 'There is more than one way to say it.';
const HEADING = 0;
const A = 2;
const B = 4;
const BLANK = 5;
editor.setState({
  html: [
    '<p># Keeping what you are not sure of</p>',
    '<p><br></p>',
    `<p>Some lines earn their place at once. ${PASSAGE} Dim the doubtful ones and read on without them.</p>`,
    '<p><br></p>',
    `<p>A second paragraph has a <span data-vid="w0rdgrp">plain</span> word with alternatives, and one sentence that has them too. <span data-vid="s3ntgrp">${SAID}</span> Then it ends.</p>`,
    '<p><br></p>',
    '<p>The last one is short.</p>',
  ].join(''),
  groups: {
    w0rdgrp: { scope: 'word', variants: ['plain', 'simple'], active: 0 },
    s3ntgrp: { scope: 'sentence', variants: [SAID, OTHERWISE], active: 0 },
  },
  overflow: '',
});
editor.focus();
editor.select({ block: A, offset: 0 });
await t.settle();

const before = html();
const count = $('#wordcount').textContent;
// The paragraph's second line lies wholly inside the passage.
const para = editor.blockElement(A).getBoundingClientRect();
const LINE = [para.left, para.top + 36, para.width, 36];
const plain = await t.pixels(...LINE);
t.equal(plain.ground, [5, 10, 28], 'the measured ground is the page colour');
t.assert(plain.ink[0] > 225 && plain.ink[1] > 190 && plain.ink[2] > 170, `and the ink the text colour: ${plain.ink.map(Math.round)}`);

// --- a selection, from the menu -------------------------------------------------------------------

const [from, to] = selectIn(A, PASSAGE);
await t.settle();
const counted = `${PASSAGE.split(' ').length} words ${PASSAGE.length} chars selected`;
t.equal($('#wordcount').textContent, counted, 'the selection is counted');
const lit = await t.pixels(...LINE);
t.assert(lit.ground[2] > 70, `the selection is painted: ${lit.ground}`);

const [px, py] = t.pointOfText('which is which');
await t.rightClick(px, py);
t.equal(third(), 'Ghost it', 'with a selection the third item reads Ghost it');
await choose('Ghost it');
same(html(), before.replace(PASSAGE, `<span data-ghost>${PASSAGE}</span>`), 'the selected words are ghosted, and only those');
t.equal(ghosts(), [PASSAGE], 'as one run');
t.equal(textOf(A), `Some lines earn their place at once. ${PASSAGE} Dim the doubtful ones and read on without them.`, 'the words themselves are as they were');
t.equal(getComputedStyle(editor.root.querySelector('[data-ghost]')).opacity, '0.11', 'ghosted text is drawn at 11%');
// In the clip the words stay selected, and the selection is dimmed along with them: for
// as long as it lasts it is what shows where the ghosting was done.
t.equal(selected(), [A, from, A, to], 'they stay selected');
t.equal($('#wordcount').textContent, counted, 'and counted as the selection');
{
  const dimmed = await t.pixels(...LINE);
  for (const [c, name] of ['red', 'green', 'blue'].entries()) {
    t.near(dimmed.ground[c], plain.ground[c] + 0.11 * (lit.ground[c] - plain.ground[c]), 1.2, `the selection is dimmed with the words (${name})`);
  }
}
await t.snap('ghosted-selected');

// With the selection gone there is only the dimmed text.
{
  const [x, y] = t.pointOfText('The last one');
  await t.click(x, y);
  t.assert(editor.selection().collapsed, 'a click elsewhere drops the selection');
  const ghosted = await t.pixels(...LINE);
  t.equal(ghosted.ground, plain.ground, 'nothing is left behind the ghosted words');
  for (const [c, name] of ['red', 'green', 'blue'].entries()) {
    const strength = (ghosted.ink[c] - ghosted.ground[c]) / (plain.ink[c] - plain.ground[c]);
    t.near(strength, 0.11, 0.012, `ghosted text is 11% of the text colour over the page (${name})`);
  }
  t.equal($('#wordcount').textContent, count, 'ghosted words are still counted');
  await t.snap('ghosted');
}

// --- reviving, from the menu ------------------------------------------------------------------------

await t.rightClick(px, py);
t.equal(third(), 'Revive it', 'inside ghosted text the item reads Revive it');
await choose('Revive it');
same(html(), before, 'the whole passage comes back, though nothing was selected');
t.assert(editor.selection().collapsed, 'and nothing is selected now');
t.equal((await t.pixels(...LINE)).ink.map(Math.round), plain.ink.map(Math.round), 'at full strength');

// Each is one step to undo.
await t.key('z', { meta: true });
t.equal(ghosts(), [PASSAGE], 'undo ghosts it again');
await t.key('z', { meta: true });
same(html(), before, 'and undo once more puts it back as it began');
t.assert(!editor.canUndo, 'two steps in all');
await t.key('z', { meta: true, shift: true });
t.equal(ghosts(), [PASSAGE], 'redo ghosts');
await t.key('z', { meta: true, shift: true });
same(html(), before, 'and redo revives');

// --- Ctrl+/ on the word at the caret ----------------------------------------------------------------

{
  const at = textOf(A).indexOf('doubtful') + 3;
  editor.select({ block: A, offset: at });
  t.assert(commands.can('ghost'), 'with the caret in a word there is something to ghost');
  await t.key('/', { ctrl: true });
  t.equal(ghosts(), ['doubtful'], 'with nothing selected Ctrl+/ ghosts the word at the caret');
  t.equal(selected(), [A, at, A, at], 'and leaves the caret where it was');
  await t.key('/', { ctrl: true });
  same(html(), before, 'again, and it is revived');
}

// --- across paragraphs ------------------------------------------------------------------------------

{
  const tail = textOf(A).indexOf('Dim the doubtful');
  const head = 'A second paragraph'.length;
  editor.select({ block: A, offset: tail }, { block: B, offset: head });
  await t.key('/', { ctrl: true });
  t.equal(ghosts(), ['Dim the doubtful ones and read on without them.', 'A second paragraph'], 'a selection across paragraphs ghosts its part of each');
  t.equal(editor.blocks.map((b) => b.kind).join(' '), 'h blank p blank p blank p', 'the lines themselves are as they were');
  t.equal(selected(), [A, tail, B, head], 'and it stays selected');
  // At the caret, only the stretch the caret is in comes back.
  editor.select({ block: B, offset: 4 });
  await t.key('/', { ctrl: true });
  t.equal(ghosts(), ['Dim the doubtful ones and read on without them.'], 'reviving at the caret brings back the stretch it is in');
  // A selection brings back whatever it touches, all of it.
  selectIn(A, 'without');
  t.equal(commands.can('ghost'), true, 'a selection inside ghosted text can be acted on');
  await t.key('/', { ctrl: true });
  same(html(), before, 'a selection that touches a ghosted stretch brings all of it back');
}

// --- where there are groups -------------------------------------------------------------------------

{
  const cut = textOf(B).indexOf('too. It can be');
  editor.select({ block: B, offset: cut }, { block: B, offset: cut + 'too. It can be'.length });
  await t.key('/', { ctrl: true });
  t.assert(
    html().includes('<span data-ghost>too. </span><span data-vid="s3ntgrp"><span data-ghost>It can be</span> said another way.</span>'),
    `a selection that cuts into a group is ghosted as two runs, split at its edge: ${brief(html().slice(html().indexOf('too')))}`,
  );
  t.equal(editor.groups.s3ntgrp.variants, [SAID, OTHERWISE], 'the group keeps its variants');
  t.equal(document.querySelectorAll('#decor .mark[data-vid="s3ntgrp"]').length, 1, 'and its underline');

  selectIn(B, 'a plain word');
  await t.key('/', { ctrl: true });
  t.assert(
    html().includes('<span data-ghost>a <span data-vid="w0rdgrp">plain</span> word</span>'),
    `a group wholly inside the selection is ghosted with what is around it: ${brief(html())}`,
  );

  // Ghosting inside a group belongs to the words that were showing.
  alternatives.activate('s3ntgrp', 1);
  await t.settle();
  t.assert(html().includes(`<span data-ghost>too. </span><span data-vid="s3ntgrp">${OTHERWISE}</span>`), 'another variant of the sentence comes in undimmed');
  editor.undo();
  t.equal(ghosts(), ['a plain word', 'too. ', 'It can be'], 'undo, and the sentence is half ghosted again');

  // One stretch, though it is two runs: the caret in either part revives both.
  editor.select({ block: B, offset: cut + 'too. It'.length });
  await t.key('/', { ctrl: true });
  t.assert(html().includes(`them too. <span data-vid="s3ntgrp">${SAID}</span>`), `reviving inside the group brings back the part before it as well: ${brief(html().slice(html().indexOf('too')))}`);
  t.equal(ghosts(), ['a plain word'], 'and leaves the other stretch alone');
  selectIn(B, 'a plain word');
  await t.key('/', { ctrl: true });
  same(html(), before, 'which a selection over it revives');
}

// --- where there is nothing to act on ---------------------------------------------------------------

{
  editor.select({ block: BLANK, offset: 0 });
  t.equal(commands.can('ghost'), false, 'on a blank line there is nothing to ghost');
  await t.key('/', { ctrl: true });
  same(html(), before, 'and Ctrl+/ does nothing');
  const blank = editor.blockElement(BLANK).getBoundingClientRect();
  await t.rightClick(blank.left + 200, blank.top + 18);
  t.equal(item('Ghost it')?.getAttribute('aria-disabled'), 'true', 'the menu item is dimmed there');
  await t.key('Escape');
}

// --- it is content, not chrome ----------------------------------------------------------------------

{
  selectIn(HEADING, 'not sure of');
  await t.key('/', { ctrl: true });
  t.equal(ghosts(), ['not sure of'], 'a heading can be ghosted like any other line');
  const strength = () => getComputedStyle(editor.root.querySelector('[data-ghost]')).opacity;
  ui.set({ read: true });
  await t.settle();
  t.equal(strength(), '0.11', 'ghosted text stays dim in read mode');
  ui.set({ read: false, alternates: false });
  await t.settle();
  t.equal(strength(), '0.11', 'and with the marks turned off');
  ui.set({ alternates: true });
}
