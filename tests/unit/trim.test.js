import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, alignDeletion, applyCuts, wordStats, percentChange } from '../../web/src/doc/trim.js';

const cutTexts = (original, result) => result.runs.map((r) => original.slice(r.start, r.end));

// --- tokens -------------------------------------------------------------------------------

test('tokens are words, runs of whitespace, and single marks', () => {
  assert.deepEqual(tokenize('say, which'), ['say', ',', ' ', 'which']);
  assert.deepEqual(tokenize('a  b'), ['a', '  ', 'b']);
});

test('apostrophes and hyphens inside a word stay in it', () => {
  assert.deepEqual(tokenize('don’t stop trade-offs'), ['don’t', ' ', 'stop', ' ', 'trade-offs']);
});

test('quotes, dashes, ellipses and emoji are one token each', () => {
  assert.deepEqual(tokenize('“Wait…” — ok 👍🏽'), ['“', 'Wait', '…', '”', ' ', '—', ' ', 'ok', ' ', '👍', '🏽']);
});

test('tokens join back into the text', () => {
  const text = 'It’s (mostly) fine — really!  Trust me…';
  assert.equal(tokenize(text).join(''), text);
});

// --- alignment ----------------------------------------------------------------------------

test('a clause removed from the middle is one cut, comma included', () => {
  const original = 'It is, in my view, a good idea.';
  const trimmed = 'It is a good idea.';
  const result = alignDeletion(original, trimmed);
  assert.deepEqual(cutTexts(original, result), [', in my view,']);
  assert.equal(applyCuts(original, result.runs, result.caseFixes), trimmed);
});

test('a clause removed from the end keeps the full stop', () => {
  const original = 'Tools assume you know what to say, which is almost never the case for most people.';
  const trimmed = 'Tools assume you know what to say.';
  const result = alignDeletion(original, trimmed);
  assert.deepEqual(cutTexts(original, result), [', which is almost never the case for most people']);
  assert.equal(applyCuts(original, result.runs, result.caseFixes), trimmed);
});

test('words cut from the start may capitalise what now begins the sentence', () => {
  const original = 'Most of the struggle in a second draft is with the first.';
  const trimmed = 'Struggle in a second draft is with the first.';
  const result = alignDeletion(original, trimmed);
  assert.deepEqual(cutTexts(original, result), ['Most of the ']);
  assert.deepEqual(result.caseFixes, [{ start: 12, end: 20, text: 'Struggle', run: 0 }]);
  assert.equal(applyCuts(original, result.runs, result.caseFixes), trimmed);
});

test('joining two sentences may lower-case the word after the cut', () => {
  const original = 'It works. And it lasts.';
  const trimmed = 'It works and it lasts.';
  const result = alignDeletion(original, trimmed);
  assert.equal(applyCuts(original, result.runs, result.caseFixes), trimmed);
  assert.equal(result.caseFixes.length, 1);
});

test('a whole sentence removed is one cut', () => {
  const original = 'Keep this. Drop this one entirely. Keep that.';
  const trimmed = 'Keep this. Keep that.';
  const result = alignDeletion(original, trimmed);
  assert.equal(result.runs.length, 1);
  assert.equal(applyCuts(original, result.runs, result.caseFixes), trimmed);
});

test('several cuts in one paragraph are separate runs in order', () => {
  const original = 'This is really quite a very good and honestly useful idea.';
  const trimmed = 'This is a good and useful idea.';
  const result = alignDeletion(original, trimmed);
  assert.deepEqual(cutTexts(original, result).map((s) => s.trim()), ['really quite', 'very', 'honestly']);
  assert.equal(applyCuts(original, result.runs, result.caseFixes), trimmed);
});

test('each cut can be applied on its own and still reads correctly', () => {
  const original = 'This is really quite a very good and honestly useful idea.';
  const result = alignDeletion(original, 'This is a good and useful idea.');
  assert.equal(applyCuts(original, [result.runs[0]], []), 'This is a very good and honestly useful idea.');
  assert.equal(applyCuts(original, [result.runs[2]], []), 'This is really quite a very good and useful idea.');
  assert.equal(applyCuts(original, [result.runs[0], result.runs[2]], []), 'This is a very good and useful idea.');
});

test('a repeated word loses one copy', () => {
  const original = 'the big big dog';
  const result = alignDeletion(original, 'the big dog');
  assert.equal(result.runs.length, 1);
  assert.equal(cutTexts(original, result)[0].trim(), 'big');
  assert.equal(applyCuts(original, result.runs, result.caseFixes), 'the big dog');
});

test('identical text has nothing to cut', () => {
  assert.deepEqual(alignDeletion('Nothing to cut here.', 'Nothing to cut here.'), { runs: [], caseFixes: [] });
});

test('straight quotes or tidied spacing in the answer are not counted as changes', () => {
  const original = 'It’s  “fine”, really, it’s fine.';
  const result = alignDeletion(original, 'It\'s "fine", it\'s fine.');
  assert.equal(applyCuts(original, result.runs, result.caseFixes), 'It’s  “fine”, it’s fine.');
});

test('surrounding whitespace in the answer is ignored', () => {
  const result = alignDeletion('Keep this, not that.', '  Keep this.\n');
  assert.equal(applyCuts('Keep this, not that.', result.runs, result.caseFixes), 'Keep this.');
});

test('a reworded paragraph is refused', () => {
  assert.equal(alignDeletion('It is a good idea.', 'It is a great idea.'), null);
  assert.equal(alignDeletion('It is a good idea.', 'It is a good idea, truly.'), null);
  assert.equal(alignDeletion('It is a good idea.', 'A good idea it is.'), null);
});

test('a change of capital that no cut explains is refused', () => {
  assert.equal(alignDeletion('It is a good idea, really.', 'It is a Good idea.'), null);
});

test('cutting a paragraph to nothing is refused', () => {
  assert.equal(alignDeletion('Something here.', ''), null);
  assert.equal(alignDeletion('Something here.', '   '), null);
});

test('applying no cuts returns the text unchanged, intended double spaces included', () => {
  assert.equal(applyCuts('Two  spaces stay.', [], []), 'Two  spaces stay.');
});

test('a case fix is only applied with the cut it belongs to', () => {
  const original = 'Honestly, the plan works and really it lasts.';
  const result = alignDeletion(original, 'The plan works and it lasts.');
  assert.equal(result.runs.length, 2);
  assert.equal(applyCuts(original, [result.runs[1]], result.caseFixes), 'Honestly, the plan works and it lasts.');
  assert.equal(applyCuts(original, [result.runs[0]], result.caseFixes), 'The plan works and really it lasts.');
});

// --- counting -----------------------------------------------------------------------------

test('wordStats counts the text before and after the cuts', () => {
  const original = 'This is really quite a very good and honestly useful idea.';
  const result = alignDeletion(original, 'This is a good and useful idea.');
  assert.deepEqual(wordStats(original, result.runs, result.caseFixes), { before: 11, after: 7 });
});

test('percentChange is the rounded change shown on the card', () => {
  assert.equal(percentChange(535, 480), -10);
  assert.equal(percentChange(535, 422), -21);
  assert.equal(percentChange(100, 100), 0);
  assert.equal(percentChange(0, 0), 0);
});
