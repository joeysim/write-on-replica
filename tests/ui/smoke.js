// The bare page inside the app: bridge, fonts, and the type and column measurements from
// the design spec (section 4), which were taken from the source clips at 1548x976.
const info = await t.call('app.info');
t.assert(info && info.inApp === true, 'the bridge answers app.info');

const editor = document.getElementById('editor');
t.assert(!!editor, 'the editor element exists');
await document.fonts.ready;
t.equal([innerWidth, innerHeight], [1548, 976], 'page size');

const plex = [...document.fonts].filter((f) => /IBM Plex Mono/.test(f.family) && f.status === 'loaded');
t.assert(plex.length >= 2, 'IBM Plex Mono regular and bold are loaded');

const paragraphs = [...editor.querySelectorAll('p')];
const heading = paragraphs.find((p) => p.dataset.h);
const body = paragraphs.find((p) => !p.dataset.h && p.textContent.length > 120);
t.assert(heading && body, 'the sample shows a heading and a long paragraph');
t.equal(getComputedStyle(heading).fontWeight, '700', 'heading weight');
t.assert(!heading.textContent.startsWith('#'), 'the heading marker is hidden');

// Character advance: forty characters of running text.
const run = document.createRange();
run.setStart(body.firstChild, 0);
run.setEnd(body.firstChild, 40);
t.near(run.getBoundingClientRect().width / 40, 12.0, 0.01, 'character advance');

// Line pitch. The clips average 36.4px; WebKit keeps line boxes on whole pixels, so 36.
const all = document.createRange();
all.selectNodeContents(body);
const tops = [...new Set([...all.getClientRects()].map((r) => Math.round(r.top * 100) / 100))];
t.assert(tops.length >= 3, 'the long paragraph wraps');
for (let i = 1; i < tops.length; i++) t.near(tops[i] - tops[i - 1], 36, 0.01, `line pitch at line ${i}`);
const blank = paragraphs.find((p) => p.textContent === '');
t.near(blank.getBoundingClientRect().height, 36, 0.01, 'a blank line is one line tall');

// Column: 780px wide, centred, so its left edge is at 384.
const page = document.getElementById('page').getBoundingClientRect();
t.near(page.width, 780, 0.01, 'column width');
t.near(page.left, 384, 0.5, 'column left edge');

// First text baseline (the heading sits one blank line below the 18vh top padding).
const probe = document.createElement('span');
probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
heading.insertBefore(probe, heading.firstChild);
const baseline = probe.getBoundingClientRect().top;
probe.remove();
t.near(baseline, 237.55, 0.3, 'first text baseline');

t.equal(getComputedStyle(document.body).backgroundColor, 'rgb(5, 10, 28)', 'page colour');
t.equal(getComputedStyle(editor).color, 'rgb(245, 209, 192)', 'text colour');

await t.snap('smoke');
