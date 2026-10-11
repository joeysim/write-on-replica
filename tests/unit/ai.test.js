import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alternativesRequest, labRequest, LAB_KINDS, TRIM_LEVELS } from '../../web/src/ai/prompts.js';
import { LineStream, cleanSuggestion, suggestionFilter, acceptSuggestions, parseLabResponse } from '../../web/src/ai/parse.js';

const PARAGRAPH = 'Most of the tension in a first draft comes from wanting every sentence to be final. It never ends.';

// --- alternatives requests ----------------------------------------------------------------

test('a word request marks the target in its paragraph and asks for five', () => {
  const start = PARAGRAPH.indexOf('tension');
  const request = alternativesRequest({ scope: 'word', paragraph: PARAGRAPH, start, end: start + 7, existing: ['tension', 'pressure'] });
  const user = request.messages.at(-1).content;
  assert.equal(request.count, 5);
  assert.equal(request.effort, 'low');
  assert.equal(request.maxTokens, 120);
  assert.ok(user.includes('Most of the [[tension]] in a first draft'));
  assert.ok(user.includes('pressure'), 'lists what the writer already has');
  assert.match(user, /\b5\b/);
  assert.equal(request.messages[0].role, 'system');
});

test('a sentence request asks for three and marks the whole sentence', () => {
  const start = PARAGRAPH.indexOf('It never ends.');
  const request = alternativesRequest({ scope: 'sentence', paragraph: PARAGRAPH, start, end: PARAGRAPH.length, existing: ['It never ends.'] });
  assert.equal(request.count, 3);
  assert.equal(request.maxTokens, 400);
  assert.ok(request.messages.at(-1).content.includes('[[It never ends.]]'));
});

test('a paragraph request asks for three single-line versions and allows room for them', () => {
  const request = alternativesRequest({ scope: 'paragraph', paragraph: PARAGRAPH, start: 0, end: PARAGRAPH.length, existing: [PARAGRAPH] });
  assert.equal(request.count, 3);
  assert.equal(request.maxTokens, 1500);
  assert.match(request.messages.at(-1).content, /single line/i);
  const long = 'word '.repeat(1200).trim();
  assert.ok(alternativesRequest({ scope: 'paragraph', paragraph: long, start: 0, end: long.length, existing: [long] }).maxTokens > 1500);
});

test('brackets already in the text do not confuse the marking', () => {
  const text = 'See [[note]] about the tension here.';
  const start = text.indexOf('tension');
  const user = alternativesRequest({ scope: 'word', paragraph: text, start, end: start + 7, existing: ['tension'] }).messages.at(-1).content;
  assert.equal(user.split('[[').length - 1, 1, 'exactly one marked target');
});

// --- streamed lines ---------------------------------------------------------------------

test('lines split across chunks are reassembled', () => {
  const stream = new LineStream();
  assert.deepEqual(stream.push('fric'), []);
  assert.deepEqual(stream.push('tion\nstr'), ['friction']);
  assert.deepEqual(stream.push('ain\r\n\n'), ['strain']);
  assert.deepEqual(stream.push('conflict'), []);
  assert.deepEqual(stream.flush(), ['conflict']);
  assert.deepEqual(stream.flush(), []);
});

test('suggestions are cleaned of list markers, quotes, emphasis and brackets', () => {
  assert.equal(cleanSuggestion('1. friction', 'word'), 'friction');
  assert.equal(cleanSuggestion('- "strain"', 'word'), 'strain');
  assert.equal(cleanSuggestion('• **conflict**', 'word'), 'conflict');
  assert.equal(cleanSuggestion('3) [[struggle]].', 'word'), 'struggle');
  assert.equal(cleanSuggestion('  tough   stuff  ', 'word'), 'tough stuff');
  assert.equal(cleanSuggestion('“Why not make everything obvious?”', 'sentence'), 'Why not make everything obvious?');
});

test('a sentence keeps its own punctuation and inner quotes', () => {
  assert.equal(cleanSuggestion('2. She said "no" and left.', 'sentence'), 'She said "no" and left.');
});

test('commentary lines are dropped', () => {
  assert.equal(cleanSuggestion('Here are 5 alternatives:', 'word'), '');
  assert.equal(cleanSuggestion('Sure!', 'word'), 'Sure!'); // cannot be told from a suggestion; the count cap bounds it
  assert.equal(cleanSuggestion('```', 'word'), '');
  assert.equal(cleanSuggestion('', 'word'), '');
});

test('accepted suggestions skip duplicates, respect the count and, for words, a length limit', () => {
  const lines = ['Pressure', 'friction', 'Friction', 'strain', 'a very long line that is clearly a sentence and not a word at all really', 'conflict', 'stress', 'discord'];
  assert.deepEqual(acceptSuggestions(lines, ['tension', 'pressure'], 4, 'word'), ['friction', 'strain', 'conflict', 'stress']);
});

test('the filter works one line at a time for streaming', () => {
  const accept = suggestionFilter({ existing: ['tension'], count: 2, scope: 'word' });
  assert.equal(accept('1. tension'), null);
  assert.equal(accept('2. friction'), 'friction');
  assert.equal(accept('friction'), null);
  assert.equal(accept('strain'), 'strain');
  assert.equal(accept('conflict'), null, 'the count is full');
});

test('empty output yields nothing', () => {
  assert.deepEqual(acceptSuggestions([], ['tension'], 5, 'word'), []);
  assert.deepEqual(acceptSuggestions(['', '   ', '```'], ['tension'], 5, 'word'), []);
});

// --- lab requests -------------------------------------------------------------------------

const PARAGRAPHS = [
  { n: 1, text: 'Writing tools assume you know what to say, which is honestly almost never the case.' },
  { n: 2, text: 'The first draft is basically a way of finding out what I think. So I keep options open.' },
];

test('every lab request sends numbered paragraphs and a strict schema', () => {
  for (const kind of LAB_KINDS) {
    const request = labRequest(kind, PARAGRAPHS, { percent: 20 });
    const user = request.messages.at(-1).content;
    assert.ok(user.includes('[1] Writing tools assume'), kind);
    assert.ok(user.includes('[2] The first draft'), kind);
    assert.equal(request.schema.type, 'object', kind);
    assert.equal(request.schema.additionalProperties, false, kind);
    assert.ok(request.maxTokens >= 300, kind);
    assert.ok(['low', 'medium', 'high'].includes(request.effort), kind);
  }
});

test('a trim request states the target in words', () => {
  const user = labRequest('trim', PARAGRAPHS, { percent: 20 }).messages.at(-1).content;
  assert.match(user, /20%/);
  assert.match(user, /\b33\b/, 'word count now');
  assert.match(user, /\b26\b/, 'word count to aim for');
});

test('the four trim levels are the ones on the Lab buttons', () => {
  assert.deepEqual(
    TRIM_LEVELS.map((l) => [l.label, l.percent]),
    [['Slight trim', 10], ['Tighten more', 20], ['Even sharper', 30], ['Cut in half', 50]],
  );
});

// --- lab responses ------------------------------------------------------------------------

test('a trim answer becomes cuts, paragraph by paragraph', () => {
  const raw = JSON.stringify({ paragraphs: [{ n: 1, text: 'Writing tools assume you know what to say.' }, { n: 2, text: PARAGRAPHS[1].text }] });
  const { items, rejected } = parseLabResponse('trim', raw, PARAGRAPHS);
  assert.equal(rejected, 0);
  assert.equal(items.length, 1, 'the unchanged paragraph has nothing to cut');
  assert.equal(items[0].n, 1);
  assert.equal(PARAGRAPHS[0].text.slice(items[0].runs[0].start, items[0].runs[0].end), ', which is honestly almost never the case');
});

test('a trim that rewrites a paragraph is rejected, the rest kept', () => {
  const raw = JSON.stringify({
    paragraphs: [
      { n: 1, text: 'Writing tools presume you know what to say.' },
      { n: 2, text: 'The first draft is a way of finding out what I think. I keep options open.' },
      { n: 9, text: 'No such paragraph.' },
    ],
  });
  const { items, rejected } = parseLabResponse('trim', raw, PARAGRAPHS);
  assert.equal(rejected, 2);
  assert.deepEqual(items.map((i) => i.n), [2]);
});

test('json inside a markdown fence or with words around it is still read', () => {
  const body = JSON.stringify({ paragraphs: [{ n: 1, text: 'Writing tools assume you know what to say.' }] });
  assert.equal(parseLabResponse('trim', '```json\n' + body + '\n```', PARAGRAPHS).items.length, 1);
  assert.equal(parseLabResponse('trim', 'Here you go:\n' + body + '\nHope that helps.', PARAGRAPHS).items.length, 1);
});

test('prose, broken json and the wrong shape are errors', () => {
  for (const raw of ['I cut a few words for you.', '{"paragraphs": [', '{"cuts": []}', '[]', '', '{"paragraphs": "none"}']) {
    assert.throws(() => parseLabResponse('trim', raw, PARAGRAPHS), /expected form/i, raw);
  }
});

test('marks must quote the text exactly; others are counted as rejected', () => {
  const raw = JSON.stringify({
    marks: [
      { n: 1, text: 'honestly almost never', reason: 'hedge' },
      { n: 2, text: 'basically', reason: 'filler' },
      { n: 2, text: 'kind of', reason: 'not in the text' },
      { n: 7, text: 'basically', reason: 'no such paragraph' },
      { n: 1, text: '', reason: 'empty' },
    ],
  });
  const { items, rejected } = parseLabResponse('filler', raw, PARAGRAPHS);
  assert.equal(rejected, 3);
  const hedge = PARAGRAPHS[0].text.indexOf('honestly almost never');
  const filler = PARAGRAPHS[1].text.indexOf('basically');
  assert.deepEqual(items, [
    { n: 1, start: hedge, end: hedge + 21, reason: 'hedge' },
    { n: 2, start: filler, end: filler + 9, reason: 'filler' },
  ]);
});

test('marks may quote with straight quotes where the text has curly ones', () => {
  const paragraphs = [{ n: 1, text: 'It’s “fine”, she said.' }];
  const { items } = parseLabResponse('weak', JSON.stringify({ marks: [{ n: 1, text: 'It\'s "fine"', reason: 'vague' }] }), paragraphs);
  assert.deepEqual(items, [{ n: 1, start: 0, end: 11, reason: 'vague' }]);
});

test('overlapping marks keep the first', () => {
  const raw = JSON.stringify({ marks: [{ n: 2, text: 'basically a way', reason: 'a' }, { n: 2, text: 'a way of finding', reason: 'b' }] });
  const { items } = parseLabResponse('filler', raw, PARAGRAPHS);
  assert.equal(items.length, 1);
  assert.equal(items[0].reason, 'a');
});

test('a repeated quote marks the next occurrence each time', () => {
  const paragraphs = [{ n: 1, text: 'really good, really fast, really cheap' }];
  const raw = JSON.stringify({ marks: [{ n: 1, text: 'really', reason: 'x' }, { n: 1, text: 'really', reason: 'y' }] });
  assert.deepEqual(parseLabResponse('filler', raw, paragraphs).items.map((i) => i.start), [0, 13]);
});

test('typo fixes need the passage verbatim and a different replacement', () => {
  const paragraphs = [{ n: 1, text: 'Teh quick brown fox , it jumps.' }];
  const raw = JSON.stringify({
    fixes: [
      { n: 1, find: 'Teh', replace: 'The', reason: 'spelling' },
      { n: 1, find: 'fox ,', replace: 'fox,', reason: 'space before comma' },
      { n: 1, find: 'quick', replace: 'quick', reason: 'no change' },
      { n: 1, find: 'lazy', replace: 'idle', reason: 'not there' },
    ],
  });
  const { items, rejected } = parseLabResponse('typos', raw, paragraphs);
  assert.equal(rejected, 2);
  assert.deepEqual(items, [
    { n: 1, start: 0, end: 3, replace: 'The', reason: 'spelling' },
    { n: 1, start: 16, end: 21, replace: 'fox,', reason: 'space before comma' },
  ]);
});
