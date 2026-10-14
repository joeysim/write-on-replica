// Sharing (design spec 6.11): the piece goes to X's compose window, and the LinkedIn button
// will not be pressed. A scripted run opens no browser: the shell notes what it would open.
const { editor, ui, commands, native, sound, explosions, tooltips } = window.writeOn;
ui.set({ read: false });
await document.fonts.ready;

const $ = (s) => document.querySelector(s);
const opened = async () => (await t.call('test.opened')).urls;
const copied = async () => (await t.call('test.clipboard')).text;
const tip = $('#tooltip');
const noteShows = () => Number(getComputedStyle(tip).opacity) > 0.99;
const noteGone = () => Number(getComputedStyle(tip).opacity) < 0.01;

// --- Post to X ------------------------------------------------------------------------------------

editor.setState({
  html:
    '<p><br></p><p># A piece to share</p><p><br></p>' +
    '<p>It has a <span data-vid="w0rd001">word</span> with alternatives & an ampersand. <span data-ghost>This part is ghosted.</span> And a second sentence?</p>' +
    '<p><br></p><p>Its last paragraph.</p>',
  groups: { w0rd001: { scope: 'word', variants: ['word', 'term'], active: 0 } },
  overflow: 'Not for posting.',
});
await t.settle();
const PIECE = 'A piece to share\n\nIt has a word with alternatives & an ampersand. And a second sentence?\n\nIts last paragraph.';
t.equal(await opened(), [], 'nothing has been opened yet');

ui.set({ read: true });
await t.key('p', { ctrl: true, shift: true });
{
  const urls = await opened();
  t.equal(urls.length, 1, 'Ctrl+Shift+P opens one page');
  const url = new URL(urls[0] ?? 'https://none.invalid/');
  t.equal([url.origin, url.pathname], ['https://x.com', '/intent/post'], 'X’s compose window');
  t.equal(url.searchParams.get('text'), PIECE, 'filled in with the piece as it reads: no heading mark, no ghosted text, no overflow');
  t.assert((urls[0] ?? '').includes('%26'), 'safely encoded');
  t.equal(ui.get('read'), true, 'posting does not turn the tools on');
  t.assert(noteGone(), 'and there is nothing to say about it');
  ui.set({ read: false });
}
await t.click(...t.center('#post-x'));
t.equal((await opened()).length, 2, 'the X button does the same');
t.equal((await opened())[1], (await opened())[0], 'with the same page');

// The shell opens X's compose window and nothing else, whatever the page asks for.
for (const url of [
  'https://example.com/intent/post',
  'http://x.com/intent/post',
  'https://x.com.example.com/intent/post',
  'https://x.com@example.com/intent/post',
  'https://x.com/home',
  'file:///Applications',
  'x.com/intent/post',
]) {
  const refused = await t.call('browser.open', { url }).then(
    () => false,
    () => true,
  );
  t.assert(refused, `the shell will not open ${url}`);
}
t.equal((await opened()).length, 2, 'and has opened none of them');
// Nor does anything else the page might do get a page opened. It has no links, and the one
// way to the browser is the request the shell checks. (Found in review: a link followed in
// the page, or a window opened from it, was handed to the browser whatever its address.)
{
  window.open('https://example.com/?with=the-text');
  const link = Object.assign(document.createElement('a'), { href: 'https://example.com/elsewhere', target: '_blank', textContent: 'elsewhere' });
  document.body.append(link);
  link.click();
  link.target = '';
  link.click();
  link.remove();
  await t.wait(300);
  t.equal((await opened()).length, 2, 'a link followed in the page, or a window opened from it, goes nowhere');
  t.assert(location.href.startsWith('writeon://app/'), 'and the page stays where it is');
}

// A piece too long to hand over in a link goes to the clipboard instead, and a note says so:
// in read mode too, where the button it stands by is out of sight.
{
  const long = Array.from({ length: 42 }, (_, i) => `Paragraph ${i + 1} goes on for a while so that forty-two of them come to more than four thousand characters.`);
  editor.setState({ html: long.map((text) => `<p>${text}</p><p><br></p>`).join(''), groups: {}, overflow: '' });
  await t.settle();
  const piece = long.join('\n\n');
  t.assert(piece.length > 4000 && piece.length < 4600, `the piece is just over 4,000 characters: ${piece.length}`);
  t.assert(`https://x.com/intent/post?text=${encodeURIComponent(piece)}`.length < 8000, 'which is the only thing against putting it in a link');
  ui.set({ read: true });
  await t.key('p', { ctrl: true, shift: true });
  await t.until(async () => (await opened()).length === 3, 2000, 'the compose window to be asked for');
  t.equal((await opened())[2], 'https://x.com/intent/post', 'the compose window opens empty');
  t.same(await copied(), piece, 'and the piece is on the clipboard');
  await t.until(noteShows, 1500, 'a note to say so');
  t.equal(tip.textContent, 'Too long to fill in: it is on the clipboard, ready to paste.', 'the note');
  t.equal(getComputedStyle(tip).color, 'rgba(245, 209, 192, 0.56)', 'in the color of a lit control, to be noticed where a label is not');
  ui.set({ read: false });
  await t.settle();
  const note = tip.getBoundingClientRect();
  const button = $('#post-x').getBoundingClientRect();
  t.assert(note.bottom <= button.top && note.left >= 12 && note.right <= innerWidth, `it stands above the X button, inside the window (${note.left} to ${note.right}, down to ${note.bottom})`);
  await t.snap('too-long');
}

// So does a shorter piece whose link would be too long for X's servers: in a link, a character
// from outside the Latin alphabet takes many times the room.
{
  const piece = '長い文章を書きました。'.repeat(100); // 1,100 characters, nine in a link to each
  editor.setState({ html: `<p>${piece}</p>`, groups: {}, overflow: '' });
  await t.settle();
  await t.key('p', { ctrl: true, shift: true });
  await t.until(async () => (await opened()).length === 4, 2000, 'the compose window to be asked for again');
  t.equal((await opened())[3], 'https://x.com/intent/post', 'a piece whose link would run past 8,000 characters is not put in one');
  t.same(await copied(), piece, 'it goes to the clipboard as well');
  await t.until(noteShows, 1500, 'the note again');
  await t.click(700, 500);
  await t.until(noteGone, 1500, 'a press to put the note away');
  await t.hover(...t.center('#save'));
  t.equal(tip.textContent, 'Ctrl+S', 'for good: the next control under the pointer shows its own label');
  await t.hover(700, 500);
}

// A note waits to be read. The browser has just come to the front, so its time starts over
// when the window is back, and the pointer passing over other controls does not wipe it.
{
  tooltips.say($('#post-x'), 'A note to come back to.', 400);
  await t.settle();
  window.dispatchEvent(new Event('blur'));
  await t.wait(700);
  t.assert(noteShows() && tip.textContent === 'A note to come back to.', 'a note outlasts its time while the window is behind another');
  window.dispatchEvent(new Event('focus'));
  await t.hover(...t.center('#save'));
  await t.wait(200);
  t.equal([noteShows(), tip.textContent], [true, 'A note to come back to.'], 'it is still there when the window is back, whatever the pointer is over');
  await t.until(() => tip.textContent === 'Ctrl+S', 1500, 'the note to give way, in its time, to the label of the control under the pointer');
  await t.hover(700, 500);
  await t.until(noteGone, 1500, 'the label to go with the pointer');
}

// When X cannot be opened the piece is not posted, and a note says why.
{
  const call = native.call;
  native.call = (method, params) => (method === 'browser.open' ? Promise.reject(new Error('the browser could not be opened')) : call.call(native, method, params));
  editor.setState({ html: '<p>A short piece.</p>', groups: {}, overflow: '' });
  await t.settle();
  await t.key('p', { ctrl: true, shift: true });
  await t.until(noteShows, 1500, 'a note about the failure');
  t.equal(tip.textContent, 'Not posted: the browser could not be opened.', 'which says what went wrong');
  native.call = call;
  await t.click(700, 500);
  await t.settle();
}

// Nothing to post.
editor.setState({ html: '<p><br></p><p><span data-ghost>Only ghosted text.</span></p>', groups: {}, overflow: 'Only overflow.' });
await t.settle();
t.equal(commands.can('post'), false, 'a page with nothing to read on it has nothing to post');
await t.key('p', { ctrl: true, shift: true });
t.equal((await opened()).length, 4, 'and nothing is opened');

// --- the LinkedIn button ----------------------------------------------------------------------------

editor.setState({ html: '<p>The page behind the chase.</p>', groups: {}, overflow: '' });
await t.settle();
const button = $('#linkedin');
const middle = () => {
  const r = button.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};
const landed = () => t.until(() => button.getAnimations().length === 0, 1500, 'the button to land');
// The hop it is making. Its color fading as the pointer leaves it is an animation too, and not this one.
const hopping = () => button.getAnimations().find((animation) => !(animation instanceof CSSTransition));
const inWindow = (p) => p.x >= 18 && p.x <= innerWidth - 18 && p.y >= 18 && p.y <= innerHeight - 18;
const degrees = (from, to) => (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
const between = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const booms = [];
sound.boom = () => booms.push('boom');

t.equal([Math.round(middle().x), Math.round(middle().y)], [136, 944], 'it sits fourth in the row of icons');
t.equal([button.tabIndex, button.getAttribute('aria-hidden'), button.dataset.tip ?? null], [-1, 'true', null], 'out of reach of the keyboard, and with no shortcut to show');

// A pointer that keeps its distance leaves it be.
await t.hover(middle().x + 26, middle().y - 12);
t.equal([Math.round(middle().x), Math.round(middle().y), button.getAnimations().length], [136, 944, 0], 'a pointer 29px off does not move it');

// Each approach sends it off: straight away from the pointer, 90 to 120px, inside the window.
const approach = async (dx, dy) => {
  const from = middle();
  const pointer = { x: from.x + dx, y: from.y + dy };
  await t.hover(pointer.x, pointer.y);
  return { from, pointer };
};
{
  const { from, pointer } = await approach(-22, 8);
  const hop = hopping();
  t.assert(hop, 'a pointer within 25px sends it off');
  const timing = hop?.effect.getTiming() ?? {};
  t.equal([timing.duration, timing.easing], [280, 'cubic-bezier(0.35, 1.2, 0.2, 1.02)'], 'in a quick hop that overshoots a little, as in the clip');
  await landed();
  const to = middle();
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  t.assert(length >= 89.5 && length <= 120.5, `it lands 90 to 120px off: ${length.toFixed(1)}`);
  t.assert(between(degrees(pointer, from), degrees(from, to)) <= 10.5, `straight away from the pointer: ${between(degrees(pointer, from), degrees(from, to)).toFixed(1)} degrees off`);
  t.assert(inWindow(to), 'inside the window');
  await t.snap('fled');
}
// Chased into the corner it turns aside; it never leaves the window or stops short.
for (let escape = 2; escape <= 4; escape++) {
  const { from } = await approach(14, -14); // from above and to the right: toward the bottom-left corner
  await landed();
  const to = middle();
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  t.assert(length >= 89.5 && length <= 120.5 && inWindow(to), `escape ${escape}: a full hop that stays in the window (${length.toFixed(1)}px to ${Math.round(to.x)}, ${Math.round(to.y)})`);
}
// Caught in the air it is off again from where it is: the fifth escape, and the sixth.
{
  const { from } = await approach(0, -20);
  const hop = hopping();
  hop.pause();
  hop.currentTime = 30; // held a tenth of the way through its time
  await t.frame();
  const caught = middle();
  const bound = { x: button.offsetLeft + button.offsetWidth / 2, y: button.offsetTop + button.offsetHeight / 2 };
  const [gone, left] = [Math.hypot(caught.x - from.x, caught.y - from.y), Math.hypot(bound.x - caught.x, bound.y - caught.y)];
  t.assert(gone > 20 && left > 40, `held in the air, ${gone.toFixed(0)}px gone and ${left.toFixed(0)}px to go`);
  await t.hover(caught.x + 6, caught.y - 6);
  await landed();
  const to = middle();
  const length = Math.hypot(to.x - caught.x, to.y - caught.y);
  t.assert(length >= 89.5 && length <= 120.5 && inWindow(to), `a pointer that catches it there sends it a full hop on from where it is (${length.toFixed(1)}px)`);
}
t.equal([booms.length, explosions.active()], [0, 0], 'six escapes, and it is still in one piece');
t.equal(getComputedStyle(button).display !== 'none' && getComputedStyle(button).visibility, 'visible', 'and in sight');

// In read mode it is out of sight with the rest, and the pointer passing where it is does not count.
{
  const at = middle();
  ui.set({ read: true });
  await t.hover(at.x + 5, at.y + 5);
  await t.settle();
  t.equal([Math.round(middle().x), Math.round(middle().y), booms.length], [Math.round(at.x), Math.round(at.y), 0], 'in read mode the pointer does not chase it');
  ui.set({ read: false });
  await t.hover(at.x + 300, at.y - 300);
}

// The seventh approach is the end of it.
{
  const { from } = await approach(10, -10);
  t.equal(booms, ['boom'], 'the seventh approach blows it up, with a boom');
  t.equal(explosions.active(), 1, 'in a burst');
  t.equal(getComputedStyle(button).display, 'none', 'and it is gone');
  explosions.seek(120);
  await t.snap('blown-up');
  explosions.resume();
  await t.hover(from.x, from.y);
  await t.hover(from.x + 3, from.y + 3);
  t.equal(booms.length, 1, 'for good: nothing more happens where it was');
  ui.set({ read: true });
  ui.set({ read: false });
  await t.settle();
  t.equal(getComputedStyle(button).display, 'none', 'and it does not come back with the tools');
}
