import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alternativesRequest, labRequest, LAB_KINDS, TRIM_LEVELS } from '../../web/src/ai/prompts.js';
import { LineStream, cleanSuggestion, suggestionFilter, acceptSuggestions, parseLabResponse, arrivedSoFar } from '../../web/src/ai/parse.js';

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

test('every lab request sends the piece, numbered, and a strict schema', () => {
  for (const kind of LAB_KINDS) {
    const request = labRequest(kind, PARAGRAPHS);
    const user = request.messages.at(-1).content;
    assert.ok(user.includes('[1] Writing tools assume'), kind);
    assert.ok(user.includes('[2] The first draft'), kind);
    assert.equal(request.schema.type, 'object', kind);
    assert.equal(request.schema.additionalProperties, false, kind);
    assert.ok(request.maxTokens >= 300, kind);
    assert.ok(['low', 'medium', 'high'].includes(request.effort), kind);
  }
});

// A trim is asked for once, whatever the level: the model says of each sentence how much the
// piece needs it and what it could lose, and the app counts (doc/trim.js). Asked to cut to a
// number of words, the model the app was built against reasoned for a minute or more.
test('a trim request offers the piece a sentence at a time, a blank line between paragraphs', () => {
  const user = labRequest('trim', PARAGRAPHS).messages.at(-1).content;
  assert.ok(
    user.endsWith(
      '\n\n[1] Writing tools assume you know what to say, which is honestly almost never the case.\n\n[2] The first draft is basically a way of finding out what I think.\n[3] So I keep options open.',
    ),
    user.slice(-260),
  );
});

test('a trim request names no amount, and asks of every sentence what it could lose and how much it is needed', () => {
  const request = labRequest('trim', PARAGRAPHS);
  const user = request.messages.at(-1).content;
  assert.doesNotMatch(user, /%|\b33\b|\b26\b|\bwords to\b/, 'no percentage, and no count of words to reach');
  assert.match(user, /Do not count/i);
  const item = request.schema.properties.sentences.items;
  assert.deepEqual(Object.keys(item.properties), ['s', 'text', 'need']);
  assert.deepEqual(item.required, ['s', 'text', 'need']);
  assert.deepEqual(labRequest('trim', PARAGRAPHS, { percent: 50 }), request, 'the level asked for makes no difference to the question');
});

test('the four trim levels are the ones on the Lab buttons', () => {
  assert.deepEqual(
    TRIM_LEVELS.map((l) => [l.label, l.percent]),
    [['Slight trim', 10], ['Tighten more', 20], ['Even sharper', 30], ['Cut in half', 50]],
  );
});

// --- lab responses ------------------------------------------------------------------------

/** What a trim answer is read as, with each cut as the words it takes. */
const readTrim = (sentences, paragraphs = PARAGRAPHS) => {
  const { items, rejected } = parseLabResponse('trim', JSON.stringify({ sentences }), paragraphs);
  const text = (n) => paragraphs.find((p) => p.n === n).text;
  return { rejected, items: items.map((item) => ({ s: item.s, n: item.n, need: item.need, sentence: text(item.n).slice(item.start, item.end), cuts: item.runs.map((run) => text(item.n).slice(run.start, run.end)), fixes: item.caseFixes })) };
};

test('a trim answer says of each sentence how much the piece needs it and what it could lose', () => {
  const { items, rejected } = readTrim([
    { s: 1, text: 'Writing tools assume you know what to say.', need: 4 },
    { s: 2, text: 'The first draft is a way of finding out what I think.', need: 5 },
    { s: 3, text: 'So I keep options open.', need: 2 },
  ]);
  assert.equal(rejected, 0);
  assert.deepEqual(items, [
    { s: 1, n: 1, need: 4, sentence: PARAGRAPHS[0].text, cuts: [', which is honestly almost never the case'], fixes: [] },
    { s: 2, n: 2, need: 5, sentence: 'The first draft is basically a way of finding out what I think.', cuts: ['basically '], fixes: [] },
    { s: 3, n: 2, need: 2, sentence: 'So I keep options open.', cuts: [], fixes: [] },
  ]);
});

test('a capital that a cut calls for is placed in the paragraph, with the cut it belongs to', () => {
  const { items } = readTrim([{ s: 1, text: 'Really, it holds.', need: 3 }, { s: 2, text: 'It stays up.', need: 3 }], [{ n: 1, text: 'Really, it holds. So it stays up.' }]);
  assert.deepEqual(items[1].cuts, ['So ']);
  assert.deepEqual(items[1].fixes, [{ start: 21, end: 23, text: 'It', run: 0 }], 'where it stands in the paragraph; the cut is counted within the sentence');
  // A word that had its capital already needs none.
  assert.deepEqual(readTrim([{ s: 3, text: 'I keep options open.', need: 3 }]).items[0].fixes, []);
});

test('a sentence that comes back reworded loses nothing, though it can still go whole', () => {
  const { items, rejected } = readTrim([
    { s: 1, text: 'Writing tools presume you know what to say.', need: 2 },
    { s: 2, text: 'The first draft is a way of finding out what I think.', need: 4 },
  ]);
  assert.equal(rejected, 1);
  assert.deepEqual(items.map((item) => [item.s, item.need, item.cuts]), [[1, 2, []], [2, 4, ['basically ']]]);
});

test('a sentence that was not offered, or is spoken of twice, is passed over', () => {
  const { items, rejected } = readTrim([
    { s: 3, text: 'So I keep options open.', need: 2 },
    { s: 9, text: 'No such sentence.', need: 1 },
    { s: 3, text: 'I keep options open.', need: 1 },
    { s: '2', text: PARAGRAPHS[1].text, need: 1 },
    { s: 1, text: 12, need: 1 },
  ]);
  assert.equal(rejected, 4);
  assert.deepEqual(items.map((item) => [item.s, item.need, item.cuts]), [[3, 2, []]]);
});

// Found with the real model on a piece of eighty-five sentences: eighty-one came back, each
// under the number of the sentence four on. Taken by their numbers, every one would have
// been "reworded", and how much each was needed would have gone to the wrong sentence.
const FOUR = [{ n: 1, text: 'Alpha one is here now. Beta two is really here too.' }, { n: 2, text: 'Gamma three is here as well. Delta four is here at last.' }];

test('a sentence that comes back under another’s number is known by its words', () => {
  const { items, rejected } = readTrim(
    [
      { s: 2, text: 'Alpha one is here now.', need: 1 },
      { s: 3, text: 'Beta two is here too.', need: 2 },
      { s: 4, text: 'Gamma three is here as well.', need: 3 },
      { s: 5, text: 'Delta four is here at last.', need: 4 },
    ],
    FOUR,
  );
  assert.equal(rejected, 0);
  assert.deepEqual(items.map((item) => [item.s, item.n, item.need, item.cuts]), [[1, 1, 1, []], [2, 1, 2, ['really ']], [3, 2, 3, []], [4, 2, 4, []]]);
});

test('where the numbers have slipped, a reworded sentence is taken to have slipped with them', () => {
  const { items, rejected } = readTrim(
    [
      { s: 2, text: 'Alpha one is here now.', need: 1 },
      { s: 3, text: 'Beta two is truly here.', need: 2 },
      { s: 4, text: 'Gamma three is here as well.', need: 3 },
    ],
    FOUR,
  );
  assert.equal(rejected, 1);
  assert.deepEqual(items.map((item) => [item.s, item.need, item.cuts]), [[1, 1, []], [2, 2, []], [3, 3, []]]);
});

// Found in review: taken one sentence at a time, a reworded sentence that happened to be its
// neighbour with words deleted moved the numbers, and everything after it went to the wrong
// sentence. So the numbers are only read as having slipped where that explains most of the answer.
test('one sentence that could be its neighbour’s does not move the numbers', () => {
  const late = [{ n: 1, text: 'It was late. It was, I think, far too late to call. Nobody answered anyway. We left.' }];
  const { items, rejected } = readTrim(
    [
      { s: 1, text: 'It was too late.', need: 2 }, // reworded, and as it happens the second with words deleted
      { s: 2, text: 'It was far too late to call.', need: 5 },
      { s: 3, text: 'Nobody answered.', need: 3 },
      { s: 4, text: 'We left.', need: 5 },
    ],
    late,
  );
  assert.equal(rejected, 1);
  assert.deepEqual(items.map((item) => [item.s, item.need, item.cuts]), [[1, 2, []], [2, 5, [', I think,']], [3, 3, [' anyway']], [4, 5, []]]);
});

test('numbers that are right but for one are taken as they stand', () => {
  const { items, rejected } = readTrim(
    [
      { s: 1, text: 'Alpha one is here now.', need: 5 },
      { s: 1, text: 'Beta two is here too.', need: 4 }, // the same number again
      { s: 3, text: 'Gamma three is here as well.', need: 3 },
      { s: 4, text: 'Delta four is here.', need: 2 },
    ],
    FOUR,
  );
  assert.equal(rejected, 1);
  assert.deepEqual(items.map((item) => [item.s, item.need, item.cuts]), [[1, 5, []], [3, 3, []], [4, 2, [' at last']]]);
});

// A number can also be wrong by itself, or all of them by more than is looked for. What comes
// back under a number is then some other sentence, and what it says of how much the piece
// needs it is not about this one.
test('words that are nothing like the sentence of their number say nothing about it', () => {
  const { items, rejected } = readTrim(
    [
      { s: 1, text: 'Gamma three is here as well.', need: 1 }, // the third sentence, under the first's number
      { s: 2, text: 'Beta two is truly here too.', need: 2 }, // the second, with a word changed
      { s: 4, text: 'Something else entirely.', need: 1 },
    ],
    FOUR,
  );
  assert.equal(rejected, 3);
  assert.deepEqual(items.map((item) => [item.s, item.need, item.cuts]), [[2, 2, []]], 'a sentence reworded is still spoken of; another sentence is not');
});

test('what is said comes back a sentence at a time, in the order of the piece, whatever order it came in', () => {
  const { items } = readTrim([
    { s: 3, text: 'So I keep options open.', need: 2 },
    { s: 1, text: PARAGRAPHS[0].text, need: 4 },
  ]);
  assert.deepEqual(items.map((item) => item.s), [1, 3]);
});

test('a sentence is looked for near its number only, and one that is nowhere near is left where it says', () => {
  const far = [{ n: 1, text: Array.from({ length: 12 }, (_, i) => `Sentence ${i + 1} stands in its place.`).join(' ') }];
  const { items, rejected } = readTrim([{ s: 1, text: 'Sentence 12 stands in its place.', need: 1 }], far);
  assert.equal(rejected, 1, 'it is not the first sentence with words deleted');
  assert.deepEqual(items.map((item) => [item.s, item.need, item.cuts]), [[1, 1, []]], 'and the twelfth is too far off to be what was meant');
});

test('how much a sentence is needed is held to 1 to 5; where it is not said, the sentence is needed', () => {
  const needs = (need) => readTrim([{ s: 1, text: PARAGRAPHS[0].text, ...(need === undefined ? {} : { need }) }]).items[0].need;
  assert.deepEqual([0, 1, 3, 5, 9, -2].map(needs), [1, 1, 3, 5, 5, 1]);
  assert.deepEqual([undefined, null, 'low', 2.5, NaN].map(needs), [5, 5, 5, 5, 5]);
});

test('a trim answer comes with how many sentences were asked about, so that one that leaves most out can be told', () => {
  const read = parseLabResponse('trim', JSON.stringify({ sentences: [{ s: 2, text: 'The first draft is a way of finding out what I think.', need: 3 }] }), PARAGRAPHS);
  assert.equal(read.sentences, 3);
  assert.equal(read.items.length, 1);
});

test('an empty text is a sentence with nothing to lose', () => {
  const { items, rejected } = readTrim([{ s: 1, text: '', need: 2 }, { s: 2, text: '  ', need: 3 }]);
  assert.equal(rejected, 0);
  assert.deepEqual(items.map((item) => [item.s, item.need, item.cuts]), [[1, 2, []], [2, 3, []]]);
});

test('a number the model puts before a sentence, as the draft has it, is not taken for a change', () => {
  const { items, rejected } = readTrim([{ s: 2, text: '[2] The first draft is a way of finding out what I think.', need: 4 }]);
  assert.equal(rejected, 0);
  assert.deepEqual(items[0].cuts, ['basically ']);
});

test('json inside a markdown fence or with words around it is still read', () => {
  const body = JSON.stringify({ sentences: [{ s: 1, text: 'Writing tools assume you know what to say.', need: 3 }] });
  assert.equal(parseLabResponse('trim', '```json\n' + body + '\n```', PARAGRAPHS).items.length, 1);
  assert.equal(parseLabResponse('trim', 'Here you go:\n' + body + '\nHope that helps.', PARAGRAPHS).items.length, 1);
});

test('prose, broken json and the wrong shape are errors', () => {
  for (const raw of ['I cut a few words for you.', '{"sentences": [', '{"cuts": []}', '{"paragraphs": []}', '[]', '', '{"sentences": "none"}']) {
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

// --- room to think ---------------------------------------------------------------------------------

// Measured against glm-5.3-flash at low effort (October 2026): what the model thinks before it
// answers is counted against the same limit as the answer. Asked what each sentence could
// lose, it mostly answers at once (1 to 11 tokens of thought), and now and then thinks first:
// 1,281 tokens over 491 words. Given no room for that it answers nothing. Marking passes
// thought for up to 400 on 164 words.
test('a Lab pass leaves the model room to think, as well as to answer', () => {
  const paragraphs = Array.from({ length: 7 }, (_, i) => ({ n: i + 1, text: Array.from({ length: 81 }, () => 'word').join(' ') })); // 567 words
  const words = 567;
  const answer = (kind) => Math.ceil(paragraphs.reduce((sum, p) => sum + p.text.length, 0) / (kind === 'trim' ? 3 : 4));
  {
    // A trim's answer is every sentence over again, with two numbers beside each.
    const room = labRequest('trim', paragraphs).maxTokens;
    assert.ok(room >= answer('trim') + 12 * paragraphs.length + 2000 + 6 * words, `a trim of ${words} words: ${room}`);
  }
  for (const kind of ['typos', 'weak', 'filler']) {
    const room = labRequest(kind, paragraphs).maxTokens;
    assert.ok(room >= 1000 + 4 * words && room < labRequest('trim', paragraphs).maxTokens, `${kind}: ${room}`);
  }
  // A short piece still gets a floor to think in.
  assert.ok(labRequest('trim', [{ n: 1, text: 'Six words to cut down here.' }]).maxTokens >= 2000);
});

test('however long the piece, a Lab pass asks for no more than a model will give', () => {
  const long = Array.from({ length: 600 }, (_, i) => ({ n: i + 1, text: Array.from({ length: 84 }, () => 'word').join(' ') })); // 50,400 words
  for (const kind of LAB_KINDS) assert.ok(labRequest(kind, long).maxTokens <= 32000, kind);
});

// --- an answer still on its way ---------------------------------------------------------------
// A trim's answer is a list of paragraphs, and it can be long. The ones that have arrived
// whole can be shown while the rest is still coming.

test('the items of a list that have arrived whole are read from an answer cut short', () => {
  const whole = JSON.stringify({ paragraphs: [{ n: 1, text: 'One.' }, { n: 3, text: 'Three.' }, { n: 5, text: 'Five.' }] });
  assert.deepEqual(arrivedSoFar(''), []);
  assert.deepEqual(arrivedSoFar(whole.slice(0, 16)), [], 'nothing whole yet');
  assert.deepEqual(arrivedSoFar(whole.slice(0, whole.indexOf('{"n":3'))), [{ n: 1, text: 'One.' }]);
  assert.deepEqual(arrivedSoFar(whole.slice(0, whole.indexOf('Three') + 3)), [{ n: 1, text: 'One.' }], 'the second is not whole yet');
  assert.deepEqual(arrivedSoFar(whole.slice(0, -2)), [{ n: 1, text: 'One.' }, { n: 3, text: 'Three.' }, { n: 5, text: 'Five.' }]);
  assert.deepEqual(arrivedSoFar(whole), [{ n: 1, text: 'One.' }, { n: 3, text: 'Three.' }, { n: 5, text: 'Five.' }]);
});

test('braces, brackets and quotes inside the text do not end an item early', () => {
  const tricky = { n: 2, text: 'A "quote", a brace } and a bracket ] and a backslash \\ in it.' };
  const whole = JSON.stringify({ paragraphs: [tricky, { n: 4, text: 'Next.' }] });
  assert.deepEqual(arrivedSoFar(whole.slice(0, whole.indexOf('brace') + 7)), [], 'cut inside the text, after its brace');
  assert.deepEqual(arrivedSoFar(whole.slice(0, whole.indexOf('{"n":4') + 3)), [tricky]);
});

test('an answer laid out over several lines, or fenced, reads the same', () => {
  const pretty = '```json\n{\n  "paragraphs": [\n    { "n": 1, "text": "One." },\n    { "n": 2, "text": "Two';
  assert.deepEqual(arrivedSoFar(pretty), [{ n: 1, text: 'One.' }]);
});

test('an answer that is not a list of items has none', () => {
  assert.deepEqual(arrivedSoFar('The model says hello.'), []);
  assert.deepEqual(arrivedSoFar('{"paragraphs": "none"}'), []);
  assert.deepEqual(arrivedSoFar('{"paragraphs": [1, 2, "three"]}'), []);
});
