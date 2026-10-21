import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToBlocks, blocksToHtml, blocksToMarkdown, markdownToBlocks, serialize, readable, sourceLines, parse, plainText, suggestedName } from '../../web/src/doc/format.js';
import { sampleState } from '../../web/src/sample.js';
import { isId, newId } from '../../web/src/doc/ids.js';

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
  '',
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

test('blank lines at the top of the document are written as they stand; those at the end are not', () => {
  // The clip's "As saved" view begins with the document's blank first line.
  const state = {
    html: '<p><br></p><p><br></p><p>A <span data-vid="aaaaaa1">word</span>.</p><p><br></p><p><br></p>',
    groups: { aaaaaa1: { scope: 'word', variants: ['word', 'term'], active: 0 } },
    overflow: '',
  };
  const file = serialize(state);
  assert.ok(file.startsWith('\n\nA word.\n\n<!-- write_on '), JSON.stringify(file.slice(0, 40)));
  assert.deepEqual(parse(file), { state, note: null });
});

test('a file whose text has lost the blank lines at its top still opens with everything it recorded', () => {
  const state = fixture();
  const file = serialize(state).replace(/^\n+/, '');
  assert.ok(file.startsWith('# Title here'));
  assert.deepEqual(parse(file), { state, note: null });
});

test('blank lines at the top are kept when the file has overflow but nothing else to record', () => {
  const state = { html: '<p><br></p><p>Just text.</p>', groups: {}, overflow: 'Spare.' };
  const file = serialize(state);
  assert.equal(file, '\nJust text.\n\n<!-- overflow -->\n\nSpare.\n');
  assert.deepEqual(parse(file), { state, note: null });
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

test('a group of one, which is only the panel looking at a word, is not written', () => {
  // design spec 5.1: a group needs at least two variants
  const looking = { html: '<p># Title</p><p><br></p><p>Just <span data-vid="l00king">text</span>.</p>', groups: { l00king: { scope: 'word', variants: ['text'], active: 0 } }, overflow: '' };
  assert.equal(serialize(looking), '# Title\n\nJust text.\n');

  const paragraph = { html: '<p data-vid="l00king">A whole paragraph.</p>', groups: { l00king: { scope: 'paragraph', variants: ['A whole paragraph.'], active: 0 } }, overflow: '' };
  assert.equal(serialize(paragraph), 'A whole paragraph.\n');

  const beside = fixture();
  beside.html += '<p><br></p><p>And one <span data-vid="l00king">more</span>.</p>';
  beside.groups.l00king = { scope: 'word', variants: ['more'], active: 0 };
  const file = serialize(beside);
  assert.ok(!file.includes('l00king'), 'neither its span nor its entry');
  assert.ok(file.includes('<p>And one more.</p>'));
  assert.deepEqual(Object.keys(parse(file).state.groups).sort(), Object.keys(fixture().groups).sort(), 'the real groups are all there');
  assert.equal(readable(looking), serialize(looking), 'in either layout');
});

test('readable shows the same text with the metadata laid out for reading', () => {
  const text = readable(fixture());
  assert.ok(text.startsWith('\n# Title here\n\nIt is a test of things.\n'));
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

test('the file can be had line by line, each marked as text or as something a Markdown reader would hide', () => {
  for (const state of [fixture(), sampleState(), { html: '<p># Plain</p><p><br></p><p>Text.</p>', groups: {}, overflow: '' }, { html: '<p>A</p><p><br></p>', groups: {}, overflow: '' }]) {
    assert.equal(`${sourceLines(state).map((line) => line.text).join('\n')}\n`, serialize(state));
    assert.equal(`${sourceLines(state, { readable: true }).map((line) => line.text).join('\n')}\n`, readable(state));
  }
  const kinds = (lines) => lines.map((line) => line.kind).join(' ');
  assert.equal(kinds(sourceLines(fixture())), 'text text text text text text text mark text text text text text text text meta');
  const pretty = sourceLines(fixture(), { readable: true });
  const first = pretty.findIndex((line) => line.kind === 'meta');
  assert.equal(pretty[first].text, '<!-- write_on {');
  assert.ok(pretty.slice(first).every((line) => line.kind === 'meta'), 'the recorded state runs to the end of the file');
  assert.equal(pretty[pretty.length - 1].text, '} -->');
  assert.equal(kinds(sourceLines({ html: '<p># Plain</p><p><br></p><p>Text.</p>', groups: {}, overflow: '' })), 'text text text');
});

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
  assert.equal(blocksToMarkdown(htmlToBlocks(state.html)), '\n# Title here\n\nIt is a test of things.\n\nWhole paragraph. Two sentences.');
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
  assert.equal(plainText(state, { withoutGhost: true }), '# Title\n\nKeep this. And this stays.');
});

// Found in review: with the spaces either side ghosted along with the words, what was left ran together.
test('plainText keeps the words either side of ghosted text a space apart, where the space went with it', () => {
  const state = {
    html: '<p>Keep this.<span data-ghost> Aside. </span>And this.</p><p><br></p><p>Half<span data-ghost>-baked</span> ideas, un<span data-ghost>believ</span>able ones<span data-ghost> at that </span>.</p>',
    groups: {},
    overflow: '',
  };
  assert.equal(plainText(state, { withoutGhost: true }), 'Keep this. And this.\n\nHalf ideas, unable ones.');
  assert.equal(plainText(state, { withoutGhost: true, headingMarker: false }), 'Keep this. And this.\n\nHalf ideas, unable ones.');
});

// A sentence that ghosted words opened reads with a capital, in the piece as it reads. The page
// keeps its letters, so the words come back as they were if they are revived.
test('plainText starts a sentence with a capital where ghosted words opened it', () => {
  const read = (html) => plainText({ html, groups: {}, overflow: '' }, { withoutGhost: true });
  assert.equal(read('<p><span data-ghost>Much of </span>the trouble comes. <span data-ghost>So, </span>it stays.</p>'), 'The trouble comes. It stays.');
  assert.equal(read('<p>It is <span data-ghost>really </span>good.</p>'), 'It is good.', 'not in the middle of a sentence');
  assert.equal(read('<p><span data-ghost>Honestly, </span>iPhone sales rose.</p>'), 'iPhone sales rose.', 'nor a word with a capital in it');
  assert.equal(read('<p><span data-ghost>So </span>“the end” came.</p>'), '“The end” came.', 'past an opening quote');
  assert.equal(plainText({ html: '<p><span data-ghost>Much of </span>the trouble.</p>', groups: {}, overflow: '' }), 'Much of the trouble.', 'and with the ghosted words in, nothing changes');
});

test('plainText leaves out a heading with nothing left in it, mark and all', () => {
  const state = {
    html: '<p># <span data-ghost>A title set aside</span></p><p><br></p><p>The piece.</p><p><br></p><p>## <span data-ghost>Dropped.</span> Kept</p><p><br></p><p># </p>',
    groups: {},
    overflow: '',
  };
  assert.equal(plainText(state, { withoutGhost: true }), 'The piece.\n\n## Kept');
  assert.equal(plainText(state), '# A title set aside\n\nThe piece.\n\n## Dropped. Kept');
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

// --- the name a file is offered --------------------------------------------------------------------

const named = (html) => suggestedName(htmlToBlocks(html));

test('a file is offered the name of the first heading', () => {
  assert.equal(named('<p><br></p><p>An opening line.</p><p># On writing well</p><p># A second heading</p>'), 'On writing well');
  assert.equal(named(sampleState().html), 'Write it more than one way');
  assert.equal(named('<p># <span data-vid="t1tle01">Shown</span> <span data-ghost>and ghosted</span></p>'), 'Shown and ghosted', 'as it reads on the page, marks and all');
});

test('a document with no heading is offered no name', () => {
  assert.equal(named('<p>Just a paragraph.</p>'), '');
  assert.equal(named('<p><br></p>'), '');
  assert.equal(named('<p># </p><p>Text under an empty heading.</p>'), '');
});

test('what a file name cannot hold is left out of it', () => {
  assert.equal(named('<p># What/why: a "test"? &lt;yes&gt; | no\\maybe*</p>'), 'What why a test yes no maybe');
  assert.equal(named('<p># ...and then.</p>'), 'and then', 'no leading dot to hide the file, no trailing one');
  assert.equal(named('<p>#   Spaced \t out  </p>'), 'Spaced out');
  assert.equal(named('<p># Café 👍🏽 naïve</p>'), 'Café 👍🏽 naïve', 'letters and emoji from anywhere are fine');
  assert.equal(named('<p># ???</p><p># The next one</p>'), 'The next one', 'a heading that leaves nothing is passed over');
});

test('a long heading is cut to a name of reasonable length, at a word', () => {
  const name = named(`<p># ${'Twelve words that go on and on until the name would be too long '.repeat(4)}</p>`);
  assert.ok(name.length <= 80 && name.length > 60, String(name.length));
  assert.ok(!name.endsWith(' ') && 'Twelve words that go on and on until the name would be too long '.repeat(4).startsWith(`${name} `), name);
  const emoji = named(`<p># ${'👍🏽'.repeat(60)}</p>`);
  assert.ok(emoji.length <= 80 && /^(👍🏽)+$/u.test(emoji), 'never through the middle of a character');
});

// --- ids ------------------------------------------------------------------------------------------

// Found in review: an id read from a file was trusted as it stood, and written into the page's
// markup unescaped. Only a second parse on the way into the editor kept a crafted one harmless.
test('an id is a few lower-case letters and digits, and never a name every object already has', () => {
  for (const id of ['h00a0dg', '7an7qy7', 'a', 'x1', newId()]) assert.equal(isId(id), true, id);
  for (const id of ['', 'A', 'has space', 'x" onmouseover="alert(1)', '__proto__', 'constructor', 'a'.repeat(17), 'é', 7, null, undefined]) {
    assert.equal(isId(id), false, String(id));
  }
});

test('a mark whose id is not an id is read as plain text, and the file says so', () => {
  const crafted = 'x" onmouseover="alert(1)';
  const html = `<p>say <span data-vid="${crafted.replace(/"/g, '&quot;')}">hello</span> now</p>`;
  assert.equal(blocksToHtml(htmlToBlocks(html)), '<p>say hello now</p>', 'html is read without it');

  const file = `say hello now\n\n<!-- write_on ${JSON.stringify({ version: 1, html, groups: { [crafted]: { scope: 'word', variants: ['hello', 'hi'], active: 0 } } })} -->\n`;
  const { state, note } = parse(file);
  assert.deepEqual(state, { html: '<p>say hello now</p>', groups: {}, overflow: '' });
  assert.equal(note, '1 of 1 alternatives in this file could not be read.');
});

test('ids that name what every object has cannot stand in for a group', () => {
  for (const id of ['__proto__', 'constructor']) {
    const html = `<p data-vid="${id}">A <span data-vid="${id}">word</span> and <span data-vid="g00dvid">another</span>.</p>`;
    const groups = JSON.parse(`{"${id}":{"scope":"word","variants":["word","term"],"active":0},"g00dvid":{"scope":"word","variants":["another","one more"],"active":0}}`);
    const file = `A word and another.\n\n<!-- write_on ${JSON.stringify({ version: 1, html, groups })} -->\n`;
    const { state, note } = parse(file);
    assert.equal(state.html, '<p>A word and <span data-vid="g00dvid">another</span>.</p>', id);
    assert.deepEqual(Object.keys(state.groups), ['g00dvid'], id);
    assert.equal(Object.getPrototypeOf(state.groups), Object.prototype, 'and the groups are an ordinary object still');
    assert.equal(note, '1 of 2 alternatives in this file could not be read.', id);
  }
});

test('whatever an id holds, it cannot break out of its attribute when written', () => {
  const blocks = [{ kind: 'p', vid: 'p" onclick="x', runs: [{ text: 'a ' }, { text: 'word', vid: 'w"><img src=x onerror=y>' }] }];
  assert.equal(blocksToHtml(blocks), '<p data-vid="p&quot; onclick=&quot;x">a <span data-vid="w&quot;&gt;&lt;img src=x onerror=y&gt;">word</span></p>');
});
