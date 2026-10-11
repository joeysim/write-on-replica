import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleState } from '../../web/src/sample.js';

// The sample is hand-written HTML in the file format, so a small regex reader is enough here.
function groupElements(html) {
  const found = [];
  const re = /<(p|span) data-vid="([0-9a-z]{7})">([\s\S]*?)<\/\1>/g;
  let m;
  while ((m = re.exec(html))) found.push({ tag: m[1], id: m[2], text: m[3].replace(/<[^>]+>/g, '') });
  return found;
}

test('sample document has the three parts of a document state', () => {
  const s = sampleState();
  assert.equal(typeof s.html, 'string');
  assert.equal(typeof s.overflow, 'string');
  assert.equal(typeof s.groups, 'object');
});

test('sample carries one group of each scope', () => {
  const scopes = new Set(Object.values(sampleState().groups).map((g) => g.scope));
  assert.deepEqual([...scopes].sort(), ['paragraph', 'sentence', 'word']);
});

test('every sample group has at least two variants and a valid active index', () => {
  for (const [id, g] of Object.entries(sampleState().groups)) {
    assert.match(id, /^[0-9a-z]{7}$/);
    assert.ok(g.variants.length >= 2, `${id} needs alternatives`);
    assert.ok(Number.isInteger(g.active) && g.active >= 0 && g.active < g.variants.length);
    assert.equal(new Set(g.variants).size, g.variants.length, `${id} has duplicate variants`);
  }
});

test('each sample group appears once in the html, on the right element, showing its active variant', () => {
  const s = sampleState();
  const els = groupElements(s.html);
  assert.deepEqual(els.map((e) => e.id).sort(), Object.keys(s.groups).sort());
  for (const el of els) {
    const g = s.groups[el.id];
    assert.equal(el.tag, g.scope === 'paragraph' ? 'p' : 'span', `${el.id} is on <${el.tag}>`);
    assert.equal(el.text, g.variants[g.active]);
  }
});

test('sample shows an AI-written variant', () => {
  const withAI = Object.values(sampleState().groups).filter((g) => g.ai?.length);
  assert.ok(withAI.length >= 1);
  for (const g of withAI) for (const v of g.ai) assert.ok(g.variants.includes(v));
});

test('sample has a word group that exercises a/an agreement', () => {
  const s = sampleState();
  const hit = groupElements(s.html).some((el) => {
    const g = s.groups[el.id];
    if (g.scope !== 'word') return false;
    const before = s.html.slice(0, s.html.indexOf(`data-vid="${el.id}"`));
    const vowels = g.variants.map((v) => /^[aeiou]/i.test(v));
    return /\ban? <span $/.test(before) && vowels.includes(true) && vowels.includes(false);
  });
  assert.ok(hit);
});

test('sample has a ghost run, overflow text, and tells the reader how to start', () => {
  const s = sampleState();
  assert.match(s.html, /<span data-ghost>[^<]+<\/span>/);
  assert.ok(s.overflow.trim().length > 0);
  assert.match(s.html, /word count/);
});

test('sample html is one paragraph per block with blank lines as <p><br></p>', () => {
  const s = sampleState();
  const blocks = s.html.match(/<p[ >][\s\S]*?<\/p>/g);
  assert.equal(blocks.join(''), s.html);
  assert.ok(blocks.includes('<p><br></p>'));
  assert.equal(blocks.filter((b) => /^<p># /.test(b)).length, 1, 'one heading, stored with its marker');
});
