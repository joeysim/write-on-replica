import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countWords,
  countChars,
  wordAt,
  sentences,
  sentenceAt,
  scopeOfSelection,
  articleFor,
  fixArticle,
} from '../../web/src/doc/text.js';

const slice = (text, range) => (range ? text.slice(range.start, range.end) : null);

// --- counting ---------------------------------------------------------------------------

test('counts match the two selection readouts in the source clips', () => {
  const a = 'Keep every version of a sentence you tried, because the one you threw away is usually the one you wanted back.';
  const b =
    'Nobody writes a sentence the best way first; you try it short, then long, then plain, and somewhere among the drafts is the one that says what you meant in the fewest words possible.';
  assert.deepEqual([countWords(a), countChars(a)], [21, 110]);
  assert.deepEqual([countWords(b), countChars(b)], [34, 182]);
});

test('an empty or blank text has no words', () => {
  assert.deepEqual([countWords(''), countChars('')], [0, 0]);
  assert.equal(countWords('   \n\t '), 0);
});

test('runs of spaces and newlines separate words once', () => {
  assert.equal(countWords('one   two\n\nthree\tfour '), 4);
});

// --- wordAt -----------------------------------------------------------------------------

test('wordAt finds the word at the start, middle and end of a word', () => {
  const text = 'make tough calls';
  for (const offset of [5, 7, 10]) assert.equal(slice(text, wordAt(text, offset)), 'tough');
});

test('wordAt on the space after a word picks the word to the left', () => {
  const text = 'make tough calls';
  assert.equal(slice(text, wordAt(text, 4)), 'make');
});

test('wordAt keeps apostrophes and hyphens that sit inside a word', () => {
  const text = 'They don’t make trade-offs, and it isn\'t easy.';
  assert.equal(slice(text, wordAt(text, text.indexOf('don') + 1)), 'don’t');
  assert.equal(slice(text, wordAt(text, text.indexOf('trade') + 7)), 'trade-offs');
  assert.equal(slice(text, wordAt(text, text.indexOf("isn't") + 2)), "isn't");
});

test('wordAt leaves punctuation and quotes outside the word', () => {
  const text = '“Which draft reads better?” she asked.';
  assert.equal(slice(text, wordAt(text, text.indexOf('better') + 3)), 'better');
  assert.equal(slice(text, wordAt(text, text.indexOf('Which'))), 'Which');
  assert.equal(slice(text, wordAt(text, text.length)), 'asked');
});

test('wordAt returns null where no word touches the offset', () => {
  assert.equal(wordAt('', 0), null);
  assert.equal(wordAt('a  —  b', 3), null);
});

test('wordAt never splits a surrogate pair and does not throw on emoji or CJK', () => {
  const text = 'good 👍🏽 idea 日本語 naïve';
  for (let offset = 0; offset <= text.length; offset++) {
    const range = wordAt(text, offset);
    if (!range) continue;
    const word = text.slice(range.start, range.end);
    assert.ok(!/^[\uDC00-\uDFFF]/.test(word) && !/[\uD800-\uDBFF]$/.test(word), `split a pair at ${offset}`);
  }
  assert.equal(slice(text, wordAt(text, text.indexOf('naïve') + 2)), 'naïve');
  assert.equal(slice(text, wordAt(text, text.indexOf('日本語') + 1)), '日本語');
});

// --- sentences --------------------------------------------------------------------------

const split = (text) => sentences(text).map((r) => text.slice(r.start, r.end));

test('sentences split on a full stop, question mark or exclamation mark before a capital', () => {
  assert.deepEqual(split('It dims. It stays put! Does it wait? Yes.'), ['It dims.', 'It stays put!', 'Does it wait?', 'Yes.']);
});

test('closing quotes and brackets stay with their sentence', () => {
  const text = 'She said “wait.” Then she left (quietly.) Nobody saw.';
  assert.deepEqual(split(text), ['She said “wait.”', 'Then she left (quietly.)', 'Nobody saw.']);
});

test('a quoted question in the middle of a sentence does not end it', () => {
  const text = '“Which draft reads better?” is an easier question to answer than “What’s wrong with this one?” Still, both are worth asking.';
  assert.deepEqual(split(text), [
    '“Which draft reads better?” is an easier question to answer than “What’s wrong with this one?”',
    'Still, both are worth asking.',
  ]);
});

test('a sentence may open with a quote', () => {
  assert.deepEqual(split('It works. “Really?” she said.'), ['It works.', '“Really?” she said.']);
});

test('abbreviations, decimals and initials do not end a sentence', () => {
  assert.deepEqual(split('Use plain words, e.g. short ones, etc. and move on.'), ['Use plain words, e.g. short ones, etc. and move on.']);
  assert.deepEqual(split('It grew 3.5 percent. Dr. Lee and J. K. Rowling agreed.'), ['It grew 3.5 percent.', 'Dr. Lee and J. K. Rowling agreed.']);
});

test('text with no terminator is one sentence, and blank text has none', () => {
  assert.deepEqual(split('Write it more than one way'), ['Write it more than one way']);
  assert.deepEqual(sentences('   '), []);
});

test('sentence ranges exclude the whitespace around them', () => {
  const text = '  One.   Two.  ';
  assert.deepEqual(sentences(text), [
    { start: 2, end: 6 },
    { start: 9, end: 13 },
  ]);
});

test('sentenceAt finds the sentence under an offset, or to its left in a gap', () => {
  const text = 'One here. Two there.';
  assert.equal(slice(text, sentenceAt(text, 3)), 'One here.');
  assert.equal(slice(text, sentenceAt(text, 9)), 'One here.');
  assert.equal(slice(text, sentenceAt(text, 10)), 'Two there.');
  assert.equal(slice(text, sentenceAt(text, text.length)), 'Two there.');
  assert.equal(sentenceAt('', 0), null);
});

// --- scope of a selection ---------------------------------------------------------------

test('a whole multi-sentence paragraph is paragraph scope', () => {
  const text = 'It dims. It stays put.';
  assert.equal(scopeOfSelection(text, 0, text.length), 'paragraph');
});

test('whole sentences are sentence scope, including a whole one-sentence paragraph', () => {
  const text = 'It dims. It stays put. It waits.';
  assert.equal(scopeOfSelection(text, 9, 22), 'sentence');
  assert.equal(scopeOfSelection(text, 0, 22), 'sentence');
  assert.equal(scopeOfSelection('Write it more than one way', 0, 26), 'sentence');
});

test('surrounding whitespace in the selection does not change its scope', () => {
  const text = 'It dims. It stays put. It waits.';
  assert.equal(scopeOfSelection(text, 8, 23), 'sentence');
});

test('anything else, including a short phrase, is word scope', () => {
  const text = 'It dims. It stays put. It waits.';
  assert.equal(scopeOfSelection(text, 12, 17), 'word');
  assert.equal(scopeOfSelection(text, 12, 21), 'word');
  assert.equal(scopeOfSelection(text, 3, 12), 'word');
  assert.equal(scopeOfSelection(text, 5, 5), 'word');
});

// --- a / an -----------------------------------------------------------------------------

test('articleFor follows the sound a word starts with', () => {
  const an = ['eraser', 'umbrella', 'hour', 'honest', 'heirloom', 'FBI', 'MRI', '8-ball', '11', 'apple', 'Easel', 'onerous', 'uninvited', 'urgent'];
  const a = ['paperclip', 'thumbtack', 'user', 'unicorn', 'one-off', 'once-over', 'European', 'university', 'UFO', 'house', '7-day', '110', 'workbench', 'utility'];
  for (const word of an) assert.equal(articleFor(word), 'an', word);
  for (const word of a) assert.equal(articleFor(word), 'a', word);
});

test('articleFor looks at the first word of a phrase and past an opening quote', () => {
  assert.equal(articleFor('easy call'), 'an');
  assert.equal(articleFor('“honest” answer'), 'an');
  assert.equal(articleFor('tough stuff'), 'a');
});

test('fixArticle corrects the article right before the group and keeps its capital', () => {
  assert.equal(fixArticle('like a ', 'eraser'), 'like an ');
  assert.equal(fixArticle('like an ', 'thumbtack'), 'like a ');
  assert.equal(fixArticle('An ', 'thumbtack'), 'A ');
  assert.equal(fixArticle('A ', 'easel'), 'An ');
  assert.equal(fixArticle('(a ', 'easel'), '(an ');
});

test('fixArticle leaves everything else alone', () => {
  assert.equal(fixArticle('like a ', 'thumbtack'), 'like a ');
  assert.equal(fixArticle('banana ', 'apple'), 'banana ');
  assert.equal(fixArticle('a  ', 'apple'), 'a  ');
  assert.equal(fixArticle('the ', 'apple'), 'the ');
  assert.equal(fixArticle('', 'apple'), '');
});
