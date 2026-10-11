import { test } from 'node:test';
import assert from 'node:assert/strict';
import { History } from '../../web/src/doc/history.js';

test('a new history has nothing to undo or redo', () => {
  const h = new History();
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, false);
  assert.equal(h.undo('now'), null);
  assert.equal(h.redo('now'), null);
});

test('undo returns the state recorded before the change, redo the state it replaced', () => {
  const h = new History();
  h.record('a');
  h.record('b');
  assert.deepEqual(h.undo('c'), { state: 'b', meta: null });
  assert.deepEqual(h.undo('b'), { state: 'a', meta: null });
  assert.equal(h.undo('a'), null);
  assert.deepEqual(h.redo('a'), { state: 'b', meta: null });
  assert.deepEqual(h.redo('b'), { state: 'c', meta: null });
  assert.equal(h.redo('c'), null);
});

test('typing in one burst is a single step', () => {
  const h = new History();
  h.record('', { coalesceKey: 'typing', now: 0 });
  h.record('h', { coalesceKey: 'typing', now: 200 });
  h.record('he', { coalesceKey: 'typing', now: 500 });
  assert.deepEqual(h.undo('hel'), { state: '', meta: null });
  assert.equal(h.canUndo, false);
});

test('a pause of 700 ms or a different kind of change starts a new step', () => {
  const h = new History();
  h.record('', { coalesceKey: 'typing', now: 0 });
  h.record('he', { coalesceKey: 'typing', now: 400 });
  h.record('hel', { coalesceKey: 'typing', now: 1100 });
  h.record('hell', { coalesceKey: 'deleting', now: 1200 });
  h.record('hel', { now: 1250 });
  assert.equal(h.undo('x').state, 'hel');
  assert.equal(h.undo('x').state, 'hell');
  assert.equal(h.undo('x').state, 'hel');
  assert.equal(h.undo('x').state, '');
});

test('a burst does not continue across an undo', () => {
  const h = new History();
  h.record('a', { coalesceKey: 'typing', now: 0 });
  h.undo('ab');
  h.record('a', { coalesceKey: 'typing', now: 100 });
  assert.equal(h.canUndo, true);
});

test('recording after an undo discards what could have been redone', () => {
  const h = new History();
  h.record('a');
  h.undo('b');
  assert.equal(h.canRedo, true);
  h.record('a');
  assert.equal(h.canRedo, false);
});

test('meta describes the change and comes back on both undo and redo', () => {
  const h = new History();
  const meta = { kind: 'explode', vid: 'abc1234' };
  h.record('before', { meta });
  assert.deepEqual(h.undo('after'), { state: 'before', meta });
  assert.deepEqual(h.redo('before'), { state: 'after', meta });
});

test('the oldest steps are dropped beyond the limit', () => {
  const h = new History(3);
  for (const s of ['a', 'b', 'c', 'd', 'e']) h.record(s);
  assert.deepEqual([h.undo('f').state, h.undo('e').state, h.undo('d').state], ['e', 'd', 'c']);
  assert.equal(h.undo('c'), null);
});

test('clear forgets everything', () => {
  const h = new History();
  h.record('a');
  h.undo('b');
  h.clear();
  assert.equal(h.canUndo || h.canRedo, false);
});
