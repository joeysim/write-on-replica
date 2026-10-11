// launch: --setting read=false --setting alternates=false
// The mode the app was left in comes back at the next launch (design spec 6.1).
const { ui } = window.writeOn;
const $ = (selector) => document.querySelector(selector);
const style = (selector) => getComputedStyle($(selector));

t.assert(!ui.get('read'), 'it opens with the tools on, as it was left');
t.assert(!ui.get('alternates'), 'and with the marks off, as they were left');
t.equal(style('#save').visibility, 'visible', 'the chrome is there from the first frame');
t.equal(Number(style('#save').opacity), 1, 'without fading in');
t.equal(style('#decor').visibility, 'hidden', 'the marks are hidden');
t.equal($('#toggle-alternates').getAttribute('aria-pressed'), 'false', 'the toggle shows its state');
t.assert(!$('#toggle-alternates').classList.contains('is-on'), 'and is not lit');

// Nothing is written back just for having started.
const saved = await t.call('settings.get', {});
t.equal([saved.read, saved.alternates], [false, false], 'the stored settings are as they were');
t.equal(Object.keys(saved).sort(), ['alternates', 'read', 'sound'], 'with nothing added (a scripted run is given sound: false)');
