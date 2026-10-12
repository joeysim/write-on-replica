// The context menu, the keyboard shortcuts and the card that lists them (design spec 6.9
// and 6.13).
const { editor, ui, panel, commands } = window.writeOn;
ui.set({ read: false });
await document.fonts.ready;
await t.settle();

const $ = (s) => document.querySelector(s);
const menu = $('#menu');
const isOpen = () => getComputedStyle(menu).visibility === 'visible';
const items = () => [...menu.querySelectorAll('.item')];
const labels = () => items().map((i) => i.querySelector('.label').textContent);
const keys = () => items().map((i) => i.querySelector('.keys').textContent);
const dimmed = () => items().map((i) => i.getAttribute('aria-disabled') === 'true');
const current = () => items().findIndex((i) => i.classList.contains('is-current'));
const docText = (i) => editor.blocks[i].runs.map((r) => r.text).join('');
const html = () => editor.getState().html;
const KEYS = ['Ctrl+Shift+A', 'Ctrl+Shift+G', 'Ctrl+/', 'Ctrl+Shift+X'];

// What each command was asked to do. With `only` set the asking is all that happens, so a
// check of which key asks for what does not depend on what the command then does.
const asked = [];
const run = commands.run;
let only = false;
commands.run = (name) => {
  asked.push(name);
  return only ? true : run(name);
};
const wanted = () => asked.splice(0).join(' ');

// --- on a word, with nothing selected -----------------------------------------------------------

const [wx, wy] = t.pointOfText('corner');
await t.rightClick(wx, wy);
t.assert(isOpen(), 'a right-click in the text opens the menu');
t.equal(labels(), ['Alternatives for “corner”', 'AI alternatives for “corner”', 'Ghost it', 'Stash this in Overflow'], 'the four items name the word under the pointer');
t.equal(keys(), KEYS, 'each with its shortcut');
t.equal(current(), 0, 'the first item is lit as the menu opens, before the pointer is on any');
{
  // The item last pointed at stays lit when the pointer leaves the menu, as in the clip.
  const third = items()[2].getBoundingClientRect();
  await t.hover(third.left + 40, third.top + third.height / 2);
  t.equal(current(), 2, 'the item under the pointer is lit');
  const box = menu.getBoundingClientRect();
  await t.hover(box.right + 60, box.bottom + 60);
  t.equal(current(), 2, 'and stays lit when the pointer leaves the menu');
  await t.hover(wx, wy);
}
{
  const caret = editor.selection();
  const word = docText(5).indexOf('corner');
  t.assert(caret.collapsed && caret.start.block === 5, 'the caret is where the click was, nothing selected');
  t.assert(caret.start.offset >= word && caret.start.offset <= word + 6, 'in that word');
  const box = menu.getBoundingClientRect();
  t.equal([box.width, box.height], [376, 136], 'menu size');
  t.near(box.left, wx, 1, 'its corner is at the pointer');
  t.near(box.top, wy, 1, 'both ways');
  const style = getComputedStyle(menu);
  t.equal([style.backgroundColor, style.borderTopLeftRadius, style.borderTopWidth], ['rgb(18, 21, 34)', '12px', '1px'], 'a dark rounded card with a hairline edge');
  const first = items()[0].getBoundingClientRect();
  t.equal([first.left - box.left, first.top - box.top, first.width, first.height], [6, 6, 364, 31], 'rows are 31px tall, set in 5px from the edge');
  t.equal(items()[3].getBoundingClientRect().bottom, box.bottom - 6, 'four of them fill it');
  const label = items()[0].querySelector('.label');
  t.equal(getComputedStyle(label).fontSize, '13px', 'in 13px type');
  const ink = document.createRange();
  ink.selectNodeContents(label);
  t.near(ink.getBoundingClientRect().left - box.left, 16, 0.5, 'labels start 15px inside the edge');
  ink.selectNodeContents(items()[0].querySelector('.keys'));
  t.near(box.right - ink.getBoundingClientRect().right, 16, 0.5, 'shortcuts end 15px inside it');
  t.equal(getComputedStyle(items()[0].querySelector('.keys')).color, 'rgb(133, 123, 130)', 'shortcuts are dim');
  t.equal(getComputedStyle(label).color, 'rgb(245, 209, 192)', 'labels are not');
}

// The row under the pointer is lit; Esc puts the menu away.
{
  const r = items()[1].getBoundingClientRect();
  await t.hover(r.left + 40, r.top + 15);
  t.equal(current(), 1, 'the row under the pointer is lit');
  t.equal(getComputedStyle(items()[1]).borderTopLeftRadius, '8px', 'as a rounded band');
  const where = menu.getBoundingClientRect();
  t.log('menu at', where.left, where.top);
  await t.snap('menu');
  await t.key('Escape');
  t.assert(!isOpen(), 'Esc closes the menu');
  t.equal(document.activeElement, editor.root, 'and the text keeps the focus');
  t.equal(wanted(), '', 'nothing was asked for');
}

// --- with a selection ---------------------------------------------------------------------------

const from = docText(5).indexOf('top-left corner');
editor.select({ block: 5, offset: from }, { block: 5, offset: from + 'top-left corner'.length });
await t.rightClick(wx, wy);
t.equal(labels().slice(0, 2), ['Alternatives for selection', 'AI alternatives for selection'], 'with a selection the items say so');
t.equal(dimmed().slice(0, 2), [false, false], 'and are live');
{
  const kept = editor.selection();
  t.equal([kept.start.offset, kept.end.offset], [from, from + 15], 'a right-click inside the selection keeps it');
  // Choosing the first item opens the panel on the selection.
  const r = items()[0].getBoundingClientRect();
  await t.click(r.left + 60, r.top + 15);
  t.assert(!isOpen(), 'choosing an item closes the menu');
  t.equal(wanted(), 'alternatives', 'and asks for its command');
  t.assert(ui.get('panel'), 'here, the panel');
  t.equal([...document.querySelectorAll('#panel .row .text')].map((n) => n.textContent), ['top-left corner', ''], 'on the selected words');
  await t.key('Escape');
  t.assert(!ui.get('panel'), 'the panel closes again');
}

// A right-click outside the selection drops it and takes the word there.
editor.select({ block: 5, offset: from }, { block: 5, offset: from + 15 });
{
  const [x, y] = t.pointOfText('pointer');
  await t.rightClick(x, y);
  t.equal(labels()[0], 'Alternatives for “pointer”', 'a right-click elsewhere is about the word there');
  t.assert(editor.selection().collapsed, 'and the old selection is gone');
  // Clicking away closes the menu without doing anything.
  await t.click(300, 520);
  t.assert(!isOpen(), 'a click outside closes the menu');
  t.equal(wanted(), '', 'and asks for nothing');
}

// A selection that runs across paragraphs cannot have alternatives.
editor.select({ block: 5, offset: 10 }, { block: 7, offset: 12 });
{
  const [x, y] = t.pointOfText('Right-click');
  await t.rightClick(x + 30, y);
  t.equal(labels().slice(0, 2), ['Alternatives for selection', 'AI alternatives for selection'], 'a selection across paragraphs is still a selection');
  t.equal(dimmed().slice(0, 2), [true, true], 'but its alternatives items are dimmed');
  const r = items()[0].getBoundingClientRect();
  await t.click(r.left + 60, r.top + 15);
  t.equal(wanted(), '', 'and choosing one does nothing');
  t.assert(isOpen(), 'the menu stays');
  await t.key('Escape');
}

// On a blank line there is no word to name.
editor.select({ block: 5, offset: 0 });
{
  const blank = editor.blockElement(6).getBoundingClientRect();
  await t.rightClick(blank.left + 200, blank.top + 18);
  t.equal(labels().slice(0, 2), ['Alternatives', 'AI alternatives'], 'on a blank line the items name nothing');
  t.equal(dimmed().slice(0, 2), [true, true], 'and are dimmed');
  await t.key('Escape');
}

// Inside ghosted text the third item revives.
{
  const [x, y] = t.pointOfText('actually');
  await t.rightClick(x, y);
  t.equal(labels()[2], 'Revive it', 'in ghosted text the item reads Revive it');
  await t.key('Escape');
}

// Inside an existing group the items name the whole group.
{
  const el = editor.elementFor('k33ps01').getBoundingClientRect();
  await t.rightClick(el.left + 8, el.top + 12);
  t.equal(labels()[0], 'Alternatives for “keeps”', 'a group is named by what it shows');
  // Arrow keys walk the live items, from the first, which is lit already, and Return chooses.
  t.equal(current(), 0, 'the first item is lit');
  await t.key('ArrowDown');
  t.equal(current(), 1, 'Down lights the next');
  await t.key('ArrowUp');
  t.equal(current(), 0, 'Up comes back');
  const before = html();
  await t.key('Enter');
  t.assert(!isOpen(), 'Return chooses the lit item');
  t.equal(wanted(), 'alternatives', 'and runs it');
  t.equal(panel.target(), 'k33ps01', 'on the group');
  await t.key('Escape');
  t.equal(html(), before, 'and none of those keys reached the text');
}

// Near the edges the menu stays inside the window.
{
  const last = editor.blockElement(5).getBoundingClientRect();
  document.getElementById('scroll').scrollTop = 0;
  await t.rightClick(last.right - 20, last.top + 18);
  const box = menu.getBoundingClientRect();
  t.assert(box.right <= innerWidth - 8 && box.bottom <= innerHeight - 8 && box.left >= 8 && box.top >= 8, 'the menu fits in the window');
  // Scrolling the page puts it away.
  document.getElementById('scroll').dispatchEvent(new Event('scroll'));
  await t.settle();
  t.assert(!isOpen(), 'scrolling closes the menu');
}

// In read mode the page leaves the right-click to the system. (Asked of the page directly:
// a scripted run cannot put a system menu away once WebKit has opened one. And once the page
// has had its say the scenario takes the event for itself, so that WebKit does not go on to
// make its own menu, which reaches into the system: the spelling panels, for one.)
ui.set({ read: true });
{
  let taken = null;
  const afterThePage = (event) => {
    taken = event.defaultPrevented;
    event.preventDefault();
  };
  window.addEventListener('contextmenu', afterThePage);
  document.elementFromPoint(wx, wy).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: wx, clientY: wy, button: 2 }));
  window.removeEventListener('contextmenu', afterThePage);
  t.equal(taken, false, 'in read mode the right-click is the system’s');
  t.assert(!isOpen(), 'and the menu stays shut');
}
ui.set({ read: false });
wanted();

// --- shortcuts ----------------------------------------------------------------------------------

// Every shortcut asks for its command and keeps the key from the text. WebKit would
// otherwise act on some of them: Ctrl+O opens a line, Ctrl+D deletes forward.
editor.select({ block: 5, offset: 8 });
{
  const TABLE = [
    ['g', { ctrl: true, shift: true }, 'ai-alternatives'],
    ['/', { ctrl: true }, 'ghost'],
    ['x', { ctrl: true, shift: true }, 'stash'],
    ['d', { ctrl: true, shift: true }, 'overflow'],
    ['u', { ctrl: true }, 'source'],
    ['s', { ctrl: true }, 'save'],
    ['o', { ctrl: true }, 'open'],
    ['p', { ctrl: true, shift: true }, 'post'],
  ];
  only = true;
  for (const [key, mods, command] of TABLE) {
    const before = html();
    const caret = editor.selection().start.offset;
    await t.key(key, mods);
    t.equal(wanted(), command, `${mods.shift ? 'Ctrl+Shift+' : 'Ctrl+'}${key.toUpperCase()} asks for ${command}`);
    t.equal(html(), before, `and leaves the text alone (${command})`);
    t.equal(editor.selection().start.offset, caret, `and the caret (${command})`);
  }
  t.equal(editor.blocks.length, 14, 'Ctrl+O did not open a line');
  only = false;
}
await t.key('r', { ctrl: true, shift: true });
t.equal([wanted(), ui.get('read')], ['read', true], 'Ctrl+Shift+R is read mode');
// A feature shortcut leaves read mode.
editor.select({ block: 5, offset: 8 });
await t.key('a', { ctrl: true, shift: true });
t.equal([wanted(), ui.get('read'), ui.get('panel')], ['alternatives', false, true], 'Ctrl+Shift+A opens the panel, leaving read mode');
t.equal([...document.querySelectorAll('#panel .row .text')][0].textContent, 'the', 'on the word at the caret');
await t.key('Escape');
only = true;
ui.set({ read: true });
await t.key('/', { ctrl: true });
t.equal(ui.get('read'), false, 'so does Ctrl+/');
await t.key('s', { ctrl: true });
ui.set({ read: true });
await t.key('s', { ctrl: true });
t.equal(ui.get('read'), true, 'saving does not');
ui.set({ read: false });
only = false;
wanted();

// Undo and redo, with Command or Control, wherever the focus is.
editor.select({ block: 5, offset: 0 });
await t.type('Zed ');
t.assert(docText(5).startsWith('Zed Click'), 'something typed');
await t.key('z', { meta: true });
t.assert(docText(5).startsWith('Click'), 'Cmd+Z undoes');
await t.key('z', { meta: true, shift: true });
t.assert(docText(5).startsWith('Zed Click'), 'Shift+Cmd+Z redoes');
await t.key('z', { ctrl: true });
t.assert(docText(5).startsWith('Click'), 'Ctrl+Z undoes');
await t.key('z', { ctrl: true, shift: true });
t.assert(docText(5).startsWith('Zed Click'), 'Ctrl+Shift+Z redoes');
editor.root.blur();
await t.key('z', { meta: true });
t.assert(docText(5).startsWith('Click'), 'and undo works with the focus out of the text');
t.equal(wanted(), 'undo redo undo redo undo', 'all through the same two commands');
editor.focus();

// --- the card behind the keyboard icon ------------------------------------------------------------

{
  const card = $('#card');
  const shown = () => getComputedStyle(card).visibility === 'visible';
  t.assert(!shown(), 'no card to begin with');
  await t.click(...t.center('#open-shortcuts'));
  t.assert(shown(), 'the keyboard icon opens a card');
  const rows = [...card.querySelectorAll('.shortcut')].map((row) => [row.querySelector('.keys').textContent, row.querySelector('.label').textContent]);
  t.equal(
    rows.map(([k]) => k),
    ['Ctrl+Shift+R', 'Ctrl+Shift+A', 'Ctrl+Shift+G', 'Ctrl+/', 'Ctrl+Shift+X', 'Ctrl+Shift+D', 'Ctrl+U', 'Ctrl+S', 'Ctrl+O', 'Ctrl+Shift+P', 'Ctrl+Return'],
    'it lists every shortcut',
  );
  t.assert(rows.every(([, label]) => label.length > 3), 'each with what it does');
  t.assert(/arrow/i.test(card.textContent) && /delete/i.test(card.textContent), 'and the keys that work under the pointer');
  const box = card.getBoundingClientRect();
  t.near(box.left + box.width / 2, innerWidth / 2, 1, 'the card is centred');
  t.assert(box.top > 40 && box.bottom < innerHeight - 40, 'and fits the window');
  const inner = box.right - parseFloat(getComputedStyle(card).paddingRight);
  t.assert([...card.querySelectorAll('.shortcut .keys')].every((k) => k.getBoundingClientRect().right <= inner + 0.5), 'every row fits inside it');
  await t.snap('shortcuts');
  await t.key('Escape');
  t.assert(!shown(), 'Esc closes it');
  await t.click(...t.center('#open-shortcuts'));
  t.assert(shown(), 'open again');
  await t.click(40, 500);
  t.assert(!shown(), 'a click outside closes it');
  await t.click(...t.center('#open-shortcuts'));
  await t.click(...t.center('#open-shortcuts'));
  t.assert(!shown(), 'and so does the icon itself');
  t.equal(document.activeElement, editor.root, 'the text has the focus back');
}
