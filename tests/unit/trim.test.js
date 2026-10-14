import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, alignDeletion, applyCuts, wordStats, percentChange, trimUnits, sentenceCuts, chooseCuts } from '../../web/src/doc/trim.js';
import { countWords } from '../../web/src/doc/text.js';

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

test('a clause removed from the end keeps the period', () => {
  const original = 'Tools assume you know what to say, which is almost never the case for most people.';
  const trimmed = 'Tools assume you know what to say.';
  const result = alignDeletion(original, trimmed);
  assert.deepEqual(cutTexts(original, result), [', which is almost never the case for most people']);
  assert.equal(applyCuts(original, result.runs, result.caseFixes), trimmed);
});

test('words cut from the start may capitalize what now begins the sentence', () => {
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

// Found in review: the model's whole word used to be taken for the capital, apostrophe and
// all, and "Make the cuts" then lost its place in the paragraph and dropped the rest of it.
test('a capital is the first letter’s and nothing else of the word is the model’s', () => {
  const straight = alignDeletion("Honestly, it's fine.", 'It’s fine.');
  assert.deepEqual(straight.caseFixes, [{ start: 10, end: 14, text: "It's", run: 0 }], 'the writer’s own apostrophe stays');
  assert.equal(applyCuts("Honestly, it's fine.", straight.runs, straight.caseFixes), "It's fine.");
  const curly = alignDeletion('Honestly, it’s fine.', "It's fine.");
  assert.equal(applyCuts('Honestly, it’s fine.', curly.runs, curly.caseFixes), 'It’s fine.');
  const lower = alignDeletion('It works. And it lasts.', 'It works and it lasts.');
  assert.equal(lower.caseFixes[0].text, 'and');
});

test('a word whose other letters changed their capitals is a word changed, and refused', () => {
  assert.equal(alignDeletion('So, iPhone sales rose.', 'IPHONE sales rose.'), null);
  assert.equal(alignDeletion('So, the nasa launch slipped.', 'The NASA launch slipped.'), null);
  const first = alignDeletion('So, iPhone sales rose.', 'IPhone sales rose.');
  assert.equal(applyCuts('So, iPhone sales rose.', first.runs, first.caseFixes), 'IPhone sales rose.');
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

// --- a sentence at a time -----------------------------------------------------------------
//
// A trim is not asked for by amount. The model is shown the piece a sentence at a time and
// says of each how much the piece needs it and what words it could lose; how much then goes
// is counted here. (Asked to count for itself, the model the app was built against spent a
// minute or more of thought on each level, and on a 500-word draft came back with a twelfth
// cut where half was asked.)

const SHORT = [
  { n: 1, text: 'So the first one opens.  It is, in my view, the longer of the two. A third ends it!' },
  { n: 2, text: 'A paragraph of one sentence.' },
];

test('a piece is offered a sentence at a time, numbered through from 1', () => {
  const units = trimUnits(SHORT);
  assert.deepEqual(
    units.map(({ s, n, text }) => [s, n, text]),
    [
      [1, 1, 'So the first one opens.'],
      [2, 1, 'It is, in my view, the longer of the two.'],
      [3, 1, 'A third ends it!'],
      [4, 2, 'A paragraph of one sentence.'],
    ],
  );
  for (const unit of units) assert.equal(SHORT[unit.n - 1].text.slice(unit.start, unit.end), unit.text, 'each knows where it stands in its paragraph');
});

test('what a sentence could lose is given as stretches of its paragraph', () => {
  const [, second] = trimUnits(SHORT);
  const made = sentenceCuts(second, 'It is the longer of the two.');
  assert.deepEqual(made.runs.map((run) => SHORT[0].text.slice(run.start, run.end)), [', in my view,']);
  assert.deepEqual(made.caseFixes, []);
});

test('a word that now starts the sentence is given its capital where it stands in the paragraph', () => {
  const [first] = trimUnits(SHORT);
  const made = sentenceCuts(first, 'The first one opens.');
  assert.deepEqual(made.runs.map((run) => SHORT[0].text.slice(run.start, run.end)), ['So ']);
  assert.deepEqual(made.caseFixes, [{ start: 3, end: 6, text: 'The', run: 0 }]);
});

test('a sentence given back as it was loses nothing, and one reworded is refused', () => {
  const [first, second] = trimUnits(SHORT);
  assert.deepEqual(sentenceCuts(first, 'So the first one opens.'), { runs: [], caseFixes: [] });
  assert.equal(sentenceCuts(second, 'In my view it is the longer one.'), null);
});

// Ten paragraphs of two sentences: the first of each has two words of padding it could lose,
// and how much the piece needs the second goes round from 2 to 5. 220 words in all.
const PIECE = Array.from({ length: 10 }, (_, i) => ({
  n: i + 1,
  text: `Paragraph ${i + 1} opens with really quite ten words in it by now. Paragraph ${i + 1} sentence two has ten words in it too.`,
}));
const NEEDS = [2, 3, 4, 5, 2, 3, 4, 5, 2, 3];
/** What the model is taken to have said of PIECE, as the parser hands it on. */
const said = (paragraphs = PIECE, needs = NEEDS) =>
  trimUnits(paragraphs).map((unit) => {
    const opens = unit.text.includes('really quite ');
    const cuts = opens ? sentenceCuts(unit, unit.text.replace('really quite ', '')) : { runs: [], caseFixes: [] };
    return { s: unit.s, n: unit.n, start: unit.start, end: unit.end, need: opens ? 5 : needs[unit.n - 1], ...cuts };
  });
const TOTAL = PIECE.reduce((sum, p) => sum + countWords(p.text), 0);
/** The piece with the chosen cuts made, a paragraph to a line. */
const after = (paragraphs, items) =>
  paragraphs.map((p) => {
    const item = items.find((made) => made.n === p.n);
    return item ? applyCuts(p.text, item.runs, item.caseFixes) : p.text;
  });
const wordsLeft = (paragraphs, items) => after(paragraphs, items).reduce((sum, text) => sum + countWords(text), 0);
/** The paragraphs whose second sentence has gone. */
const gone = (items) => after(PIECE, items).flatMap((text, i) => (text.includes('sentence two') ? [] : [i + 1]));
const tightened = (items) => after(PIECE, items).flatMap((text, i) => (text.includes('really quite') ? [] : [i + 1]));

test('the fixture is what the tests below take it to be', () => {
  assert.equal(TOTAL, 220);
  assert.equal(trimUnits(PIECE).length, 20);
});

test('a light trim takes only what sentences could lose, spread through the piece', () => {
  const items = chooseCuts(PIECE, said(), { percent: 5 });
  assert.deepEqual(gone(items), [], 'no sentence goes while there is padding to take');
  const cut = TOTAL - wordsLeft(PIECE, items);
  assert.ok(Math.abs(cut - 11) <= 2, `about a twentieth of 220 words: ${cut}`);
  const where = tightened(items);
  assert.ok(where.some((n) => n <= 5) && where.some((n) => n > 5), `from both halves of the piece: ${where}`);
});

test('when that is not enough, sentences go: the ones the piece needs least first', () => {
  // All the padding is 20 words. A fifth is 44: 24 more, from the three sentences needed least.
  const fifth = chooseCuts(PIECE, said(), { percent: 20 });
  assert.deepEqual(tightened(fifth), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'all the padding goes first');
  assert.ok(gone(fifth).length === 2 && gone(fifth).every((n) => NEEDS[n - 1] === 2), `then sentences the piece needs least: ${gone(fifth)}`);
  // 30% is 66: the three needed least, and some of those needed a little more.
  const third = chooseCuts(PIECE, said(), { percent: 30 });
  assert.deepEqual(gone(third).filter((n) => NEEDS[n - 1] === 2), [1, 5, 9], 'all of the least needed');
  assert.ok(gone(third).some((n) => NEEDS[n - 1] === 3) && gone(third).every((n) => NEEDS[n - 1] <= 3), `and then the next: ${gone(third)}`);
});

test('what is cut comes to what was asked for, to within a sentence', () => {
  for (const percent of [10, 20, 30]) {
    const cut = TOTAL - wordsLeft(PIECE, chooseCuts(PIECE, said(), { percent }));
    assert.ok(Math.abs(cut - (TOTAL * percent) / 100) <= 6, `${percent}%: ${cut} of ${TOTAL} words`);
  }
});

test('the amount can be reckoned on more words than were offered', () => {
  // Headings are not offered, but their words count on the card: a tenth of 300 is 30.
  const cut = TOTAL - wordsLeft(PIECE, chooseCuts(PIECE, said(), { percent: 10, of: 300 }));
  assert.ok(Math.abs(cut - 30) <= 6, `${cut}`);
});

// Found with the real model: of the welcome piece's fifteen sentences it once said the piece
// did not work without eight, and "Cut in half" came to 29%, the same as "Even sharper".
test('a sentence the piece does not work without goes last, and only to make up the amount', () => {
  const most = chooseCuts(PIECE, said(), { percent: 45 });
  assert.deepEqual(gone(most), [1, 2, 3, 5, 6, 7, 9, 10], 'at 45% everything else has gone, and that is enough');
  assert.equal(TOTAL - wordsLeft(PIECE, most), 100);
  const half = chooseCuts(PIECE, said(), { percent: 50 });
  assert.equal(TOTAL - wordsLeft(PIECE, half), 110, 'half is ten words more');
  const left = after(PIECE, half).join(' ').match(/Paragraph \d+ (opens|sentence two)/g);
  assert.equal(left.length, 11, 'one sentence of the twelve it does not work without, on top of the eight');
  assert.deepEqual(gone(half).filter((n) => NEEDS[n - 1] !== 5), [1, 2, 3, 5, 6, 7, 9, 10], 'and none of them before all the others had gone');
});

test('a sentence that goes is one cut, whatever it might have lost', () => {
  const two = [{ n: 1, text: 'This one really stays. That one can honestly go.' }];
  const [stays, goes] = trimUnits(two);
  const found = [
    { s: 1, n: 1, start: stays.start, end: stays.end, need: 5, ...sentenceCuts(stays, 'This one stays.') },
    { s: 2, n: 1, start: goes.start, end: goes.end, need: 1, ...sentenceCuts(goes, 'That one can go.') },
  ];
  const [item] = chooseCuts(two, found, { percent: 60 });
  assert.deepEqual(item.runs.map((run) => two[0].text.slice(run.start, run.end)), ['really ', 'That one can honestly go.']);
  assert.deepEqual(item.runs.map((run) => run.index), [0, 1], 'numbered in order, for the proposal to tell them apart');
  assert.equal(applyCuts(two[0].text, item.runs, item.caseFixes), 'This one stays.');
});

test('a capital goes with the cut that calls for it, and with no other', () => {
  const two = [{ n: 1, text: 'Really, it holds. So it honestly stays up.' }];
  const [first, second] = trimUnits(two);
  const found = [
    { s: 1, n: 1, start: first.start, end: first.end, need: 5, ...sentenceCuts(first, 'It holds.') },
    { s: 2, n: 1, start: second.start, end: second.end, need: 5, ...sentenceCuts(second, 'It stays up.') },
  ];
  const [item] = chooseCuts(two, found, { percent: 50 });
  assert.equal(applyCuts(two[0].text, item.runs, item.caseFixes), 'It holds. It stays up.');
  // Keep the first cut and the first sentence keeps its small letter.
  assert.equal(applyCuts(two[0].text, item.runs.slice(1), item.caseFixes), 'Really, it holds. It stays up.');
});

test('a whole paragraph can go, but never the whole piece', () => {
  const lines = [
    { n: 1, text: 'The first line is a paragraph.' },
    { n: 2, text: 'The second line is one too.' },
    { n: 3, text: 'And so is the third line.' },
  ];
  const found = trimUnits(lines).map((unit) => ({ s: unit.s, n: unit.n, start: unit.start, end: unit.end, need: 1, runs: [], caseFixes: [] }));
  const third = chooseCuts(lines, found, { percent: 33 });
  assert.equal(after(lines, third).filter((text) => text === '').length, 1, 'a third of it is one line');
  const all = chooseCuts(lines, found, { percent: 100 });
  assert.equal(after(lines, all).filter((text) => text !== '').length, 1, 'asked for all of it, one line is left');
});

// --- found in review ----------------------------------------------------------------------

/** A piece of one paragraph from sentences of the given lengths, and what is said of each: [words, need]. */
const sized = (...sentences) => {
  const text = sentences.map(([words], i) => `Words ${Array.from({ length: words - 2 }, () => 'word').join(' ')} s${i + 1}.`).join(' ');
  const paragraphs = [{ n: 1, text }];
  const units = trimUnits(paragraphs);
  assert.deepEqual(units.map((unit) => countWords(unit.text)), sentences.map(([words]) => words));
  const found = units.map((unit, i) => ({ s: unit.s, n: 1, start: unit.start, end: unit.end, need: sentences[i][1], runs: [], caseFixes: [] }));
  return { paragraphs, found, /** The sentences that go, by number. */ gone: (items) => (items[0]?.runs ?? []).map((run) => Number(/s(\d+)\.$/.exec(text.slice(run.start, run.end))[1])) };
};

test('no sentence goes while one the piece needs less still stands', () => {
  // A tenth of these 100 words is 10. The sentence the piece is better without is 25 words,
  // too many to come near; the 8-word one would, but the piece would be poorer without it.
  const { paragraphs, found, gone } = sized([30, 5], [25, 1], [37, 5], [8, 4]);
  assert.deepEqual(gone(chooseCuts(paragraphs, found, { percent: 10 })), [2], 'so the 25 words go, and the 8 stay');
  assert.deepEqual(gone(chooseCuts(paragraphs, found, { percent: 20, after: [10] })), [2]);
  assert.deepEqual(gone(chooseCuts(paragraphs, found, { percent: 30, after: [10, 20] })), [2, 4], 'the 8 go once nothing needed less is left, and 33 is nearer 30 than 25 is');
  // The same with the amount the other way about: the least needed is small, and is not passed over.
  const other = sized([30, 5], [8, 1], [37, 5], [25, 4]);
  assert.deepEqual(other.gone(chooseCuts(other.paragraphs, other.found, { percent: 20 })), [2], 'a fifth is 20: the 8 go, and the 25, though nearer, are needed more');
});

test('a level that would come to nothing takes the least there is to take', () => {
  const { paragraphs, found, gone } = sized([20, 5], [24, 3], [20, 3], [20, 5]);
  assert.deepEqual(gone(chooseCuts(paragraphs, found, { percent: 10 })), [3], 'a tenth of 84 words is 8, and no sentence is so short: the shortest of the least needed goes');
});

test('each level holds what the lighter ones took', () => {
  // Six sentences alike, every other one little needed: taken alone, a fifth would not pick
  // the sentence a tenth picks.
  const { paragraphs, found, gone } = sized([10, 2], [10, 5], [10, 2], [10, 5], [10, 2], [10, 5]);
  const tenth = gone(chooseCuts(paragraphs, found, { percent: 10 }));
  const third = gone(chooseCuts(paragraphs, found, { percent: 30, after: [10, 20] }));
  const half = gone(chooseCuts(paragraphs, found, { percent: 50, after: [10, 20, 30] }));
  assert.deepEqual([tenth.length, third.length, half.length], [1, 2, 3], 'one sentence of six, then two, then three');
  assert.ok(tenth.every((s) => third.includes(s)) && third.every((s) => half.includes(s)), `${tenth} | ${third} | ${half}`);
  assert.deepEqual(half, [1, 3, 5], 'and none the piece does not work without, while there are others to take');
  // And through the fixture above, with padding in play: each level's text is the level
  // before's with more gone.
  const chain = [10, 20, 30, 50].map((percent, i, all) => after(PIECE, chooseCuts(PIECE, said(), { percent, after: all.slice(0, i) })));
  for (let i = 1; i < chain.length; i++) {
    chain[i].forEach((text, k) => assert.ok(text === '' || alignDeletion(chain[i - 1][k], text), `paragraph ${k + 1} at level ${i + 1} is what it was at level ${i} with more deleted`));
  }
  assert.ok(chain[3].join(' ').length < chain[0].join(' ').length);
});

test('a sentence that may not go, because it is all there is, can still lose its padding', () => {
  const one = [{ n: 1, text: 'Honestly, this is the whole of it.' }];
  const [unit] = trimUnits(one);
  const found = [{ s: 1, n: 1, start: unit.start, end: unit.end, need: 1, ...sentenceCuts(unit, 'This is the whole of it.') }];
  const [item] = chooseCuts(one, found, { percent: 50 });
  assert.equal(applyCuts(one[0].text, item.runs, item.caseFixes), 'This is the whole of it.');
});

test('only a trim to half takes a sentence the piece does not work without, and then only one that is wanted whole', () => {
  // 60 words, all said to be needed. The lighter levels take nothing; half takes three.
  const all = sized([10, 5], [10, 5], [10, 5], [10, 5], [10, 5], [10, 5]);
  for (const percent of [10, 20, 30]) assert.deepEqual(all.gone(chooseCuts(all.paragraphs, all.found, { percent })), [], `${percent}%`);
  assert.deepEqual(all.gone(chooseCuts(all.paragraphs, all.found, { percent: 50, after: [10, 20, 30] })), [2, 4, 6]);
  // 100 words: 8 to be had from a sentence needed less, the rest said to be needed.
  const some = sized([40, 5], [8, 2], [40, 5], [12, 5]);
  assert.deepEqual(some.gone(chooseCuts(some.paragraphs, some.found, { percent: 30 })), [2], 'short of 30%, and the 12 words are not taken to make it up');
  assert.deepEqual(some.gone(chooseCuts(some.paragraphs, some.found, { percent: 50 })), [2, 4], 'for half they are; the sentences of 40 are more than is still wanted, and stay');
});

test('with nothing said, nothing is chosen', () => {
  assert.deepEqual(chooseCuts(PIECE, [], { percent: 50 }), []);
  // Sentences the model does not speak of are not the app's to cut.
  assert.deepEqual(chooseCuts(PIECE, said().slice(0, 1).map((item) => ({ ...item, runs: [], caseFixes: [], need: 5 })), { percent: 0 }), []);
});

// While the answer is still arriving nothing can be counted. What shows meanwhile is chosen
// sentence by sentence, so that a passage once faded is not unfaded by what arrives after it.
test('before the whole answer is in, each sentence is judged by itself', () => {
  const whole = chooseCuts(PIECE, said(), { depth: 2 });
  assert.deepEqual(tightened(whole), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(gone(whole), [1, 5, 9], 'to a depth of 2: the padding, and the sentences needed least');
  // Each cut as the paragraph and the stretch of it, and the sentence it lies in.
  const units = trimUnits(PIECE);
  const cuts = (items) => items.flatMap((item) => item.runs.map((run) => ({ at: `${item.n}:${run.start}-${run.end}`, s: units.find((unit) => unit.n === item.n && run.start >= unit.start && run.end <= unit.end).s })));
  for (const arrived of [1, 2, 7, 13]) {
    const part = chooseCuts(PIECE, said().slice(0, arrived), { depth: 2 });
    assert.deepEqual(
      cuts(part).map((cut) => cut.at),
      cuts(whole).filter((cut) => cut.s <= arrived).map((cut) => cut.at),
      `with ${arrived} sentences in, what is faded is what will be faded of them at the end`,
    );
  }
  assert.deepEqual(gone(chooseCuts(PIECE, said(), { depth: 1 })), [], 'to a depth of 1, only the padding');
  assert.deepEqual(gone(chooseCuts(PIECE, said(), { depth: 4 })), [1, 2, 3, 5, 6, 7, 9, 10]);
  assert.deepEqual(gone(chooseCuts(PIECE, said(), { depth: 9 })), [1, 2, 3, 5, 6, 7, 9, 10], 'what the piece does not work without is never shown going before the count');
});
