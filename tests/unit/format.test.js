import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToBlocks, blocksToHtml, blocksToMarkdown, markdownToBlocks, serialize, readable, parse, plainText } from '../../web/src/doc/format.js';
import { sampleState } from '../../web/src/sample.js';

// A small document with the same shape as the file in the author's clip: a blank first
// line, a heading that is a sentence group, a word group with an AI variant, a paragraph
// group on the <p>, and three paragraphs of overflow.
const fixture = () => ({
  html:
    '<p><br></p>' +
    '<p># <span data-vid="aaaaaa1">Title here</span></p>' +
    '<p><br></p>' +
    '<p>It is a <span data-vid="bbbbbb2">test</span> of things.</p>' +
    '<p><br></p>' +
    '<p data-vid="ccccccc">Whole paragraph. Two sentences.</p>',
  groups: {
    bbbbbb2: { scope: 'word', variants: ['test', 'trial'], active: 0, ai: ['trial'] },
    aaaaaa1: { scope: 'sentence', variants: ['Title here', 'Other title'], active: 0 },
    ccccccc: { scope: 'paragraph', variants: ['Whole paragraph. Two sentences.', 'One.'], active: 0 },
  },
  overflow: 'Spare one.\n\nSpare two.\n\nhttps://example.com/x',
});

const FIXTURE_FILE = [
  '# Title here',
  '',
  'It is a test of things.',
  '',
  'Whole paragraph. Two sentences.',
  '',
  '<!-- overflow -->',
  '',
  'Spare one.',
  '',
  'Spare two.',
  '',
  'https://example.com/x',
  '',
  '<!-- write_on {"version":1,"html":"<p><br></p><p># <span data-vid=\\"aaaaaa1\\">Title here</span></p><p><br></p><p>It is a <span data-vid=\\"bbbbbb2\\">test</span> of things.</p><p><br></p><p data-vid=\\"ccccccc\\">Whole paragraph. Two sentences.</p>","groups":{"aaaaaa1":{"scope":"sentence","variants":["Title here","Other title"],"active":0},"bbbbbb2":{"scope":"word","variants":["test","trial"],"active":0,"ai":["trial"]},"ccccccc":{"scope":"paragraph","variants":["Whole paragraph. Two sentences.","One."],"active":0}}} -->',
  '',
].join('\n');

// --- blocks -----------------------------------------------------------------------------

test('html becomes blocks: blank lines, headings without their marker, groups and ghost runs', () => {
  const blocks = htmlToBlocks(
    '<p><br></p><p>## <span data-vid="aaaaaa1">Title</span></p><p data-vid="ccccccc">A <span data-ghost>dim</span> end</p>',
  );
  assert.deepEqual(blocks, [
    { kind: 'blank', runs: [] },
    { kind: 'h', level: 2, runs: [{ text: 'Title', vid: 'aaaaaa1' }] },
    { kind: 'p', vid: 'ccccccc', runs: [{ text: 'A ' }, { text: 'dim', ghost: true }, { text: ' end' }] },
  ]);
});

test('blocks become the same html again', () => {
  const html = fixture().html;
  assert.equal(blocksToHtml(htmlToBlocks(html)), html);
  assert.equal(blocksToHtml(htmlToBlocks(sampleState().html)), sampleState().html);
});

test('ghost may sit inside a group or around one, and both survive a round trip', () => {
  const inside = '<p><span data-vid="aaaaaa1">Some <span data-ghost>dim</span> text</span> after</p>';
  const around = '<p>Before <span data-ghost>dim <span data-vid="aaaaaa1">word</span> dim</span> after</p>';
  assert.equal(blocksToHtml(htmlToBlocks(inside)), inside);
  assert.equal(blocksToHtml(htmlToBlocks(around)), around);
  assert.deepEqual(htmlToBlocks(around)[0].runs, [
    { text: 'Before ' },
    { text: 'dim ', ghost: true },
    { text: 'word', vid: 'aaaaaa1', ghost: true },
    { text: ' dim', ghost: true },
    { text: ' after' },
  ]);
});

test('special characters are escaped in html and come back unchanged', () => {
  const text = 'a < b && c > d “quoted” "straight" it’s 👍🏽 --> done';
  const blocks = [{ kind: 'p', runs: [{ text }] }];
  const html = blocksToHtml(blocks);
  assert.ok(!/<(?!\/?p>)/.test(html), 'no stray tags');
  assert.deepEqual(htmlToBlocks(html), blocks);
});

test('html written by a browser parses too', () => {
  // innerHTML writes boolean attributes with ="" and may add other attributes.
  const blocks = htmlToBlocks('<p class="x">Hi <span data-ghost="">there</span>&nbsp;you <b>bold</b></p><p></p>');
  assert.deepEqual(blocks, [
    { kind: 'p', runs: [{ text: 'Hi ' }, { text: 'there', ghost: true }, { text: ' you bold' }] },
    { kind: 'blank', runs: [] },
  ]);
});

test('markdown is one line per block, headings with their marker', () => {
  const blocks = htmlToBlocks(fixture().html);
  assert.equal(blocksToMarkdown(blocks), '\n# Title here\n\nIt is a test of things.\n\nWhole paragraph. Two sentences.');
  assert.deepEqual(markdownToBlocks('# T\n\nBody text\n### Deep'), [
    { kind: 'h', level: 1, runs: [{ text: 'T' }] },
    { kind: 'blank', runs: [] },
    { kind: 'p', runs: [{ text: 'Body text' }] },
    { kind: 'h', level: 3, runs: [{ text: 'Deep' }] },
  ]);
});

// --- the file ---------------------------------------------------------------------------

test('serialize writes the file in the shape shown in the clip', () => {
  assert.equal(serialize(fixture()), FIXTURE_FILE);
});

test('groups are written in document order with scope, variants, active, then ai', () => {
  const file = serialize(fixture());
  const meta = JSON.parse(/<!-- write_on (.*) -->/.exec(file)[1]);
  assert.deepEqual(Object.keys(meta), ['version', 'html', 'groups']);
  assert.deepEqual(Object.keys(meta.groups), ['aaaaaa1', 'bbbbbb2', 'ccccccc']);
  assert.deepEqual(Object.keys(meta.groups.bbbbbb2), ['scope', 'variants', 'active', 'ai']);
  assert.deepEqual(Object.keys(meta.groups.aaaaaa1), ['scope', 'variants', 'active']);
});

test('parse restores exactly what serialize wrote', () => {
  const cases = [
    fixture(),
    sampleState(),
    { html: '<p><br></p>', groups: {}, overflow: '' },
    { html: '<p>Plain text only.</p><p><br></p><p>Second.</p>', groups: {}, overflow: '' },
    { html: '<p>With <span data-ghost>ghost</span> only.</p>', groups: {}, overflow: 'Kept nearby.' },
    {
      html: '<p><span data-vid="aaaaaa1">Some <span data-ghost>dim</span> text</span> and <span data-ghost>a <span data-vid="bbbbbb2">word</span></span></p>',
      groups: {
        aaaaaa1: { scope: 'sentence', variants: ['Some dim text', 'Other'], active: 0 },
        bbbbbb2: { scope: 'word', variants: ['word', 'term'], active: 0 },
      },
      overflow: '',
    },
    {
      html: '<p>Arrows --&gt; and &lt;tags&gt; &amp; "quotes" 👍🏽 --!&gt;</p><p><span data-vid="aaaaaa1">a --&gt; b</span></p>',
      groups: { aaaaaa1: { scope: 'sentence', variants: ['a --> b', 'b <-- a --!> c'], active: 0 } },
      overflow: 'x --> y',
    },
  ];
  for (const state of cases) {
    const { state: back, note } = parse(serialize(state));
    assert.deepEqual(back, state);
    assert.equal(note, null);
  }
});

test('the metadata comment can never be closed by the text inside it', () => {
  const state = {
    html: '<p><span data-vid="aaaaaa1">a --&gt; b</span></p>',
    groups: { aaaaaa1: { scope: 'sentence', variants: ['a --> b', 'c --!> d'], active: 0 } },
    overflow: '',
  };
  const file = serialize(state);
  const body = file.slice(file.indexOf('<!-- write_on ') + 14, file.lastIndexOf(' -->'));
  assert.ok(!body.includes('-->') && !body.includes('--!>'));
  assert.equal(file.match(/-->/g).length, 2, 'only the markdown text and the real end of the comment');
});

test('a document with nothing to remember is written as plain markdown', () => {
  const file = serialize({ html: '<p># Title</p><p><br></p><p>Just text.</p>', groups: {}, overflow: '' });
  assert.equal(file, '# Title\n\nJust text.\n');
});

test('overflow is omitted when empty and its own blank lines are trimmed', () => {
  assert.ok(!serialize({ ...fixture(), overflow: '  \n ' }).includes('<!-- overflow -->'));
  assert.ok(serialize({ ...fixture(), overflow: '\n\nKept.\n\n' }).includes('<!-- overflow -->\n\nKept.\n\n<!-- write_on'));
});

test('groups that are not in the html are not written', () => {
  const state = fixture();
  state.groups.zzzzzzz = { scope: 'word', variants: ['lost', 'gone'], active: 0 };
  assert.ok(!serialize(state).includes('zzzzzzz'));
});

test('readable shows the same text with the metadata laid out for reading', () => {
  const text = readable(fixture());
  assert.ok(text.startsWith('# Title here\n\nIt is a test of things.\n'));
  assert.ok(text.includes('\n<!-- overflow -->\n\nSpare one.\n'));
  const meta = text.slice(text.indexOf('<!-- write_on {'));
  assert.equal(
    meta,
    [
      '<!-- write_on {',
      '  "version": 1,',
      '  "html": "',
      '    <p><br></p>',
      '    <p># <span data-vid="aaaaaa1">Title here</span></p>',
      '    <p><br></p>',
      '    <p>It is a <span data-vid="bbbbbb2">test</span> of things.</p>',
      '    <p><br></p>',
      '    <p data-vid="ccccccc">Whole paragraph. Two sentences.</p>',
      '  ",',
      '  "groups": {',
      '    "aaaaaa1": {',
      '      "scope": "sentence",',
      '      "variants": [',
      '        "Title here",',
      '        "Other title"',
      '      ],',
      '      "active": 0',
      '    },',
      '    "bbbbbb2": {',
      '      "scope": "word",',
      '      "variants": [',
      '        "test",',
      '        "trial"',
      '      ],',
      '      "active": 0,',
      '      "ai": [',
      '        "trial"',
      '      ]',
      '    },',
      '    "ccccccc": {',
      '      "scope": "paragraph",',
      '      "variants": [',
      '        "Whole paragraph. Two sentences.",',
      '        "One."',
      '      ],',
      '      "active": 0',
      '    }',
      '  }',
      '} -->',
      '',
    ].join('\n'),
  );
});

// --- files the app did not write ---------------------------------------------------------

test('a plain markdown file opens with no groups', () => {
  const { state, note } = parse('# Notes\n\nFirst line.\nSecond line.\n');
  assert.deepEqual(state, { html: '<p># Notes</p><p><br></p><p>First line.</p><p>Second line.</p>', groups: {}, overflow: '' });
  assert.equal(note, null);
});

test('windows line endings and a byte-order mark are read like any other file', () => {
  const unix = parse(FIXTURE_FILE).state;
  assert.deepEqual(parse('﻿' + FIXTURE_FILE.replace(/\n/g, '\r\n')).state, unix);
});

test('tabs and trailing spaces in text survive', () => {
  const text = '\tIndented with a tab.  \n\nTwo  spaces   inside.';
  const { state } = parse(text);
  assert.equal(serialize(state), text + '\n');
});

test('text that looks like the end of a comment is still just text', () => {
  const text = 'Use --> for arrows.\n\n<!-- a comment of the writer’s own -->\n\nDone.';
  const { state, note } = parse(text);
  assert.equal(note, null);
  assert.equal(serialize(state), text + '\n');
});

test('markdown edited elsewhere wins, keeping groups whose text is still there', () => {
  const edited = FIXTURE_FILE.replace('It is a test of things.', 'It was a test of many things.').replace('Whole paragraph. Two sentences.', 'A rewritten paragraph.');
  const { state, note } = parse(edited);
  assert.equal(blocksToMarkdown(htmlToBlocks(state.html)).trim(), '# Title here\n\nIt was a test of many things.\n\nA rewritten paragraph.');
  assert.deepEqual(Object.keys(state.groups).sort(), ['aaaaaa1', 'bbbbbb2']);
  assert.ok(state.html.includes('<span data-vid="bbbbbb2">test</span> of many'));
  assert.ok(state.html.includes('<p># <span data-vid="aaaaaa1">Title here</span></p>'));
  assert.equal(state.overflow, 'Spare one.\n\nSpare two.\n\nhttps://example.com/x');
  assert.match(note, /changed outside/i);
  assert.match(note, /2 of 3/);
});

test('a damaged metadata block is dropped and reported, and the text is kept', () => {
  const truncated = FIXTURE_FILE.slice(0, FIXTURE_FILE.indexOf('"groups"'));
  const { state, note } = parse(truncated);
  assert.deepEqual(state.groups, {});
  assert.equal(blocksToMarkdown(htmlToBlocks(state.html)), '# Title here\n\nIt is a test of things.\n\nWhole paragraph. Two sentences.');
  assert.equal(state.overflow, 'Spare one.\n\nSpare two.\n\nhttps://example.com/x');
  assert.match(note, /could not be read/i);

  const broken = FIXTURE_FILE.replace('"version":1', '"version":');
  assert.match(parse(broken).note, /could not be read/i);
  assert.deepEqual(parse(broken).state.groups, {});
});

test('metadata naming groups that are missing or malformed loses only those groups', () => {
  const file = FIXTURE_FILE.replace('"active":0,"ai":["trial"]', '"active":9,"ai":["trial"]').replace('{"scope":"sentence","variants":["Title here","Other title"],"active":0}', '"nonsense"');
  const { state } = parse(file);
  assert.deepEqual(Object.keys(state.groups), ['ccccccc']);
  assert.ok(!state.html.includes('aaaaaa1') && !state.html.includes('bbbbbb2'));
  assert.ok(state.html.includes('<p># Title here</p>'));
});

test('an empty file is an empty document', () => {
  assert.deepEqual(parse('').state, { html: '<p><br></p>', groups: {}, overflow: '' });
});

// --- plain text ---------------------------------------------------------------------------

test('plainText gives the document as text, optionally without ghosted runs or heading markers', () => {
  const state = {
    html: '<p><br></p><p># Title</p><p><br></p><p>Keep this. <span data-ghost>Drop this.</span> And this stays.</p>',
    groups: {},
    overflow: 'not included',
  };
  assert.equal(plainText(state), '# Title\n\nKeep this. Drop this. And this stays.');
  assert.equal(plainText(state, { withoutGhost: true, headingMarker: false }), 'Title\n\nKeep this. And this stays.');
});

// --- size -----------------------------------------------------------------------------------

test('fifty thousand words round-trip quickly', () => {
  const sentence = 'The quick brown fox jumps over the lazy dog and keeps going for a while longer. ';
  const paragraph = sentence.repeat(6).trim();
  const lines = [];
  for (let words = 0; words < 50000; words += 96) lines.push(paragraph, '');
  const text = lines.join('\n');
  const started = performance.now();
  const { state } = parse(text);
  const again = serialize(state);
  const elapsed = performance.now() - started;
  assert.equal(again, text.trimEnd() + '\n');
  assert.ok(elapsed < 500, `took ${elapsed.toFixed(0)} ms`);
});
