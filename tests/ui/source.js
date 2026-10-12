// The source view (design spec 6.11): Ctrl+U shows the file as it would be saved.
const { editor, ui, commands } = window.writeOn;
const { serialize, readable } = await import('./src/doc/format.js');
ui.set({ read: false });
await document.fonts.ready;

const $ = (s) => document.querySelector(s);
const card = $('#source');
if (!t.assert(card, 'the page has a source view')) return;
const body = card.querySelector('.body');
const tabs = () => [...card.querySelectorAll('.tab')];
const active = () => tabs().find((tab) => tab.classList.contains('active'))?.textContent;
const lines = () => [...body.querySelectorAll('.line')];
/** The text the view shows, a line of the file per line. */
const shown = () =>
  lines()
    .map((line) => line.textContent)
    .join('\n');
const dims = () => lines().filter((line) => line.classList.contains('dim'));
const open = () => getComputedStyle(card).visibility === 'visible';
const top = (node) => node.getBoundingClientRect().top;

const PARAGRAPHS = Array.from({ length: 14 }, (_, i) => `Paragraph ${i + 1} is here to make the file long enough to scroll, so it says a little more than it needs to and then stops.`);
const state = {
  html:
    '<p><br></p><p># <span data-vid="t1tle01">A file to look inside</span></p><p><br></p>' +
    '<p>It has a <span data-vid="w0rd001">word</span> with alternatives, an arrow --&gt; in its text, and <span data-ghost>a ghosted aside</span>.</p>' +
    PARAGRAPHS.map((text) => `<p><br></p><p>${text}</p>`).join(''),
  groups: {
    t1tle01: { scope: 'sentence', variants: ['A file to look inside', 'What gets saved'], active: 0 },
    w0rd001: { scope: 'word', variants: ['word', 'term', 'phrase'], active: 0, ai: ['phrase'] },
  },
  overflow: 'Kept for later.\n\nAnd this, with a café in it.',
};
editor.setState(state);
editor.focus();
editor.select({ block: 3, offset: 2 });
await t.settle();
const saved = serialize(editor.getState());
const ground = (await t.pixels(40, 300, 200, 200)).ground;

// --- opening ------------------------------------------------------------------------------------

t.assert(!open(), 'the source view starts closed');
ui.set({ read: true });
await t.key('u', { ctrl: true });
t.equal([ui.get('source'), ui.get('read')], [true, false], 'Ctrl+U opens it, turning the tools on');
await t.until(open, 1000, 'the source view to show');
{
  const box = card.getBoundingClientRect();
  t.equal([box.left, box.top, box.width, box.height], [(innerWidth - 900) / 2, 70, 900, innerHeight - 140], 'a 900px card in the middle of the window, 70px clear of its top and bottom');
  const style = getComputedStyle(card);
  t.equal([style.backgroundColor, style.borderTopWidth, style.borderTopColor, style.borderTopLeftRadius], ['rgb(18, 21, 34)', '1px', 'rgb(35, 39, 53)', '7px'], 'in the popover colour, with a hairline edge and rounded corners');
  t.equal(style.boxShadow, 'rgba(0, 0, 0, 0.4) 0px 10px 20px 0px', 'and a soft shadow under it');
  t.equal((await t.pixels(40, 300, 200, 200)).ground, ground, 'the page around it is not dimmed');
  for (const id of ['wordcount', 'toggle-alternates', 'open-source', 'save', 'lab', 'toggle-overflow']) {
    t.equal(getComputedStyle($(`#${id}`)).visibility, 'visible', `#${id} stays in view`);
  }
  t.assert(!editor.root.contains(document.activeElement), 'the page no longer has the keyboard');
}

// --- as saved -------------------------------------------------------------------------------------

t.equal(tabs().map((tab) => tab.textContent), ['As saved', 'Readable'], 'two tabs');
t.equal(active(), 'As saved', 'the first is showing');
t.same(shown(), saved.replace(/\n$/, ''), 'it shows exactly what Save would write');
{
  const bytes = new TextEncoder().encode(saved).length;
  t.assert(bytes > 1000 && saved.length < bytes, 'the file is over a thousand bytes, some of them in characters of more than one');
  t.equal(card.querySelector('.bytes').textContent, `${bytes.toLocaleString('en-US')} bytes`, 'its size in bytes, with a thousands separator');
  t.equal(card.querySelector('.copy').textContent, 'Copy', 'and a Copy button');
  t.equal(lines()[0].textContent, '', 'the file begins with the document’s blank first line');
  t.equal(lines()[1].textContent, '# A file to look inside', 'then its heading');
  t.equal(dims().map((line) => line.textContent.slice(0, 22)), ['<!-- overflow -->', '<!-- write_on {"versio'], 'comment lines are dimmed');
  const strength = (line) => getComputedStyle(line).color;
  t.equal([strength(lines()[1]), strength(dims()[0])], ['rgb(245, 209, 192)', 'rgb(133, 123, 130)'], 'text at full strength, comments dim');
  t.equal(strength(lines().find((line) => line.textContent === 'Kept for later.')), 'rgb(245, 209, 192)', 'the overflow text is text');
  const meta = dims()[1].getBoundingClientRect();
  t.assert(meta.height > 60, 'the long line of metadata wraps inside the card');
  t.assert(meta.right <= body.getBoundingClientRect().right, 'and stays inside it');
  t.equal(body.scrollTop, 0, 'the view starts at the top');
  await t.snap('as-saved');
}

// Where things are, on the 1548x976 page of the clip.
{
  const box = body.getBoundingClientRect();
  t.equal([box.top, box.bottom], [123, innerHeight - 87], 'the text scrolls between a 52px header and 16px of card below it');
  t.near(tabs()[0].getBoundingClientRect().left, 347, 0.01, 'the tabs start 22px inside the edge');
  t.near(parseFloat(getComputedStyle(tabs()[0]).fontSize), 20.2, 0.01, 'in the hand');
  const size = card.querySelector('.bytes');
  t.equal([getComputedStyle(size).fontSize, getComputedStyle(size).color], ['13px', 'rgb(133, 123, 130)'], 'the size is small and dim');
  t.near(card.querySelector('.copy').getBoundingClientRect().right, box.right - 22, 0.6, 'Copy ends 22px inside the other edge');
  const text = getComputedStyle(body);
  t.equal([text.fontSize, text.paddingLeft, text.paddingRight, text.paddingTop], ['13px', '22px', '22px', '0px'], 'the file is set in 13px type, 22px in from either side, with nothing above its first line');
  // The clip's lines are 20.8px apart. Each line of the file is as tall as its lines there.
  const tops = lines().map((line) => line.getBoundingClientRect().top);
  t.near(tops[0], box.top - 0.5, 0.01, 'the first line starts half a pixel above the view, where the clip’s rounding puts it');
  t.near(tops[1] - tops[0], 20.8, 0.3, 'a line is 20.8px below the one before');
  const long = lines().find((line) => line.textContent.startsWith('Paragraph 1 is here'));
  const rows = Math.round(long.getBoundingClientRect().height / 20.8);
  t.assert(rows > 1, 'a paragraph too long for the card wraps');
  t.near(long.getBoundingClientRect().height, rows * 20.8, 0.3, 'and is as many times 20.8px tall as it has lines');
  t.near(tops[tops.length - 1] - tops[0], (tops.length - 1 + lines().slice(0, -1).reduce((n, line) => n + Math.round(line.getBoundingClientRect().height / 20.8) - 1, 0)) * 20.8, 1, 'so nothing drifts down the card');
}

// --- readable ---------------------------------------------------------------------------------------

await t.click(...t.center(tabs()[1]));
t.equal(active(), 'Readable', 'a click on Readable shows it');
t.same(shown(), readable(editor.getState()).replace(/\n$/, ''), 'the same file with the metadata laid out for reading');
{
  const first = lines().findIndex((line) => line.textContent === '<!-- write_on {');
  t.assert(first > 0, 'the metadata opens on a line of its own');
  t.assert(lines().slice(first).every((line) => line.classList.contains('dim')), 'and all of it is dimmed');
  // The clip's view jumps to the metadata, which lands just under 8px below the top.
  t.near(top(lines()[first]) - top(body), 7.7, 0.15, 'the view jumps to the metadata, to the place the clip’s does');
  const html = lines().find((line) => line.textContent.startsWith('    <p>It has a'));
  t.equal(html.textContent, '    <p>It has a <span data-vid="w0rd001">word</span> with alternatives, an arrow --&gt; in its text, and <span data-ghost>a ghosted aside</span>.</p>', 'each block of the html is on a line of its own, four spaces in');
  const start = t.rangeOfText('<p>It has a', { root: html }).getClientRects()[0];
  const whole = document.createRange();
  whole.selectNodeContents(html);
  const rows = [...whole.getClientRects()];
  t.assert(rows.length > 1, 'a long one wraps');
  t.near(rows[rows.length - 1].left, start.left, 0.5, 'and its later lines hang under the first');
  t.near(start.left - body.getBoundingClientRect().left - parseFloat(getComputedStyle(body).paddingLeft), 4 * 7.8, 0.5, 'four characters in');
  t.equal(card.querySelector('.bytes').textContent, `${new TextEncoder().encode(saved).length.toLocaleString('en-US')} bytes`, 'the size is still the saved file’s');
  await t.snap('readable');
}
await t.click(...t.center(tabs()[0]));
t.equal([active(), body.scrollTop], ['As saved', 0], 'As saved again, from the top');

// --- copy -------------------------------------------------------------------------------------------

await t.click(...t.center(card.querySelector('.copy')));
t.same((await t.call('test.clipboard')).text, saved, 'Copy copies the file as saved');
t.equal(card.querySelector('.copy').textContent, 'Copied', 'and says so');
await t.click(...t.center(tabs()[1]));
await t.click(...t.center(card.querySelector('.copy')));
t.same((await t.call('test.clipboard')).text, readable(editor.getState()), 'with Readable showing, it copies that');
await t.until(() => card.querySelector('.copy').textContent === 'Copy', 3000, 'the button to read Copy again');

// --- closing ----------------------------------------------------------------------------------------

await t.key('Escape');
t.equal([ui.get('source'), open()], [false, false], 'Esc closes it');
t.equal(document.activeElement, editor.root, 'and the page has the keyboard again');
t.equal(editor.selection()?.start.block, 3, 'with its caret where it was');

// It comes back as it was left: the same tab, at the same place. (In the clip it is put away
// on Readable, part of the way down, and is there again when it is brought back.)
await t.key('u', { ctrl: true });
await t.click(...t.center(tabs()[1]));
body.scrollTop += 150;
await t.settle();
const left = body.scrollTop;
t.assert(left > 150, `it is some way down the file: ${left}`);
await t.key('Escape');
await t.click(...t.center('#open-source'));
t.assert(ui.get('source'), 'the M↓ button opens it');
t.equal([active(), body.scrollTop], ['Readable', left], 'on the tab it was left on, at the place it was left at');
await t.click(...t.center('#open-source'));
t.assert(!ui.get('source'), 'and closes it');

// The controls around the card still answer to the pointer while it is up, and a press on one
// does what that control does as well as putting the card away. (In the clip the Overflow
// button shows its shortcut with the card up, and one click on it swaps the card for Overflow.)
await t.key('u', { ctrl: true });
{
  const tip = $('#tooltip');
  const [x, y] = t.center('#toggle-overflow');
  await t.hover(x, y);
  await t.until(() => tip.classList.contains('is-showing') && tip.textContent === 'Ctrl+Shift+D', 1500, 'the Overflow button to show its shortcut with the card up');
  await t.click(x, y);
  await t.wait(300);
  t.equal([ui.get('source'), ui.get('overflow')], [false, true], 'one press on it puts the card away and opens Overflow');
  await t.click(x, y);
  await t.wait(300);
  t.equal(ui.get('overflow'), false, 'Overflow shut again');
}
// A press on the page beside the card puts the card away and is a press on the page.
await t.key('u', { ctrl: true });
await t.click(60, 500);
t.assert(!ui.get('source'), 'a click outside the card closes it');
t.equal([document.activeElement, editor.selection()?.collapsed], [editor.root, true], 'and the caret is in the text, on the line it was level with');
// Back on As saved, for what follows.
await t.key('u', { ctrl: true });
await t.click(...t.center(tabs()[0]));
await t.key('Escape');
await t.key('u', { ctrl: true });
await t.key('u', { ctrl: true });
t.assert(!ui.get('source'), 'and so does Ctrl+U again');

// --- it is the document as it is now ------------------------------------------------------------------

editor.select({ block: 3, offset: 0 });
await t.type('Now ');
await t.key('u', { ctrl: true });
t.assert(shown().includes('\nNow It has a word with alternatives'), 'what was just typed is in the file');
t.same(shown(), serialize(editor.getState()).replace(/\n$/, ''), 'which is the document as it would be saved now');
{
  // It is for reading: keys do not reach the page behind it, and nothing in it can be typed over.
  const before = editor.getState().html;
  await t.type('xyz');
  // (After a click on one of the controls WebKit would send the typing to the page all the
  // same, where the selection still is. The page refuses it.)
  t.same(editor.getState().html, before, 'typing with it open changes nothing');
  t.equal(document.activeElement, body, 'and the keyboard stays with the card');
  t.equal(card.querySelector('[contenteditable]'), null, 'and it has nothing to type in');
  t.equal(getComputedStyle(body).webkitUserSelect, 'text', 'though its text can be selected');
}
await t.key('Escape');

// --- a file with nothing to record ---------------------------------------------------------------------

editor.setState({ html: '<p># Plain</p><p><br></p><p>Just text.</p>', groups: {}, overflow: '' });
await t.settle();
await t.key('u', { ctrl: true });
t.equal(shown(), '# Plain\n\nJust text.', 'a plain document is shown as the plain Markdown it is saved as');
t.equal(dims().length, 0, 'with nothing dimmed');
t.equal(card.querySelector('.bytes').textContent, '20 bytes', 'a small number has no separator');
await t.click(...t.center(tabs()[1]));
t.equal([shown(), body.scrollTop], ['# Plain\n\nJust text.', 0], 'and Readable has nothing to add');
await t.key('Escape');
