import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToneSession } from '../../web/src/doc/tone.js';

// Replays the tick sequences measured from the source clips. A variant is named by its
// position here; the session only needs keys it can compare.
function replay(session, start, steps) {
  let showing = start;
  let now = 0;
  return steps.map(([gap, to]) => {
    now += gap;
    const tone = session.change(showing, to, now);
    showing = to;
    return tone;
  });
}

test('hovering: the tick is low only on returning to the variant the burst began on', () => {
  // Follow-up clip: pointer on the third variant, arrows out to the first and back.
  const tones = replay(new ToneSession({ idleMs: 1750 }), 2, [[0, 1], [545, 0], [555, 1], [628, 2]]);
  assert.deepEqual(tones, ['high', 'high', 'high', 'low']);
});

test('hovering: landing on the first variant is not what makes the tick low', () => {
  const tones = replay(new ToneSession({ idleMs: 1750 }), 2, [[0, 1], [500, 0]]);
  assert.deepEqual(tones, ['high', 'high']);
});

test('hovering: a pause starts a new burst from wherever the text then stands', () => {
  // Main clip, the heading: out and back quickly (low), then three presses with pauses of
  // 2.7 s, 2.07 s and 3.3 s, each of which begins a new burst, so none is low.
  const tones = replay(new ToneSession({ idleMs: 1750 }), 0, [[0, 1], [1300, 2], [900, 0], [2700, 1], [2070, 2], [3300, 0]]);
  assert.deepEqual(tones, ['high', 'high', 'low', 'high', 'high', 'high']);
});

test('hovering: gaps of up to 1.45 s keep the burst alive', () => {
  // Main clip, the word with eight variants: out to the fifth and back to the first.
  const tones = replay(new ToneSession({ idleMs: 1750 }), 0, [[0, 1], [600, 2], [650, 3], [1250, 4], [1450, 3], [460, 2], [700, 1], [530, 0]]);
  assert.deepEqual(tones, ['high', 'high', 'high', 'high', 'high', 'high', 'high', 'low']);
});

test('ending a session makes the next change start a new one', () => {
  const session = new ToneSession({ idleMs: 1750 });
  assert.equal(session.change(0, 1, 0), 'high');
  session.end();
  assert.equal(session.change(1, 0, 100), 'high', 'home is now 1, so 0 is not a return');
  assert.equal(session.change(0, 1, 200), 'low');
});

test('the panel: home is the variant showing when the group was targeted, however long ago', () => {
  // Main clip: the panel opens on the first of eight variants; the writer clicks the
  // seventh, types an eighth, then arrows up through the list to the top.
  const session = new ToneSession({ idleMs: Infinity });
  session.begin(0, 0);
  const tones = replay(session, 0, [[2200, 6], [1800, 7], [4900, 6], [650, 5], [600, 4], [700, 3], [550, 2], [600, 1], [550, 0], [850, 1]]);
  assert.deepEqual(tones, ['high', 'high', 'high', 'high', 'high', 'high', 'high', 'high', 'low', 'high']);
});

test('the panel: removing a typed variant returns to home with a low tick', () => {
  // Follow-up clip: type a letter (a new variant shows), delete it (the original returns).
  const session = new ToneSession({ idleMs: Infinity });
  session.begin('dominates', 0);
  assert.equal(session.change('dominates', 'O', 3000), 'high');
  assert.equal(session.change('O', 'dominates', 4100), 'low');
});

test('renaming the home variant keeps it home', () => {
  const session = new ToneSession({ idleMs: Infinity });
  session.begin('tension', 0);
  session.rename('tension', 'tensions');
  assert.equal(session.change('tensions', 'pressure', 10), 'high');
  assert.equal(session.change('pressure', 'tensions', 20), 'low');
});
