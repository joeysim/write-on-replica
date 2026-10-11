import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newId } from '../../web/src/doc/ids.js';
import { makeGroup, addVariant, removeVariant, setVariantText, setActive, isAI, cloneGroups, tidyGroup } from '../../web/src/doc/model.js';

test('ids are seven base-36 characters', () => {
  for (let i = 0; i < 200; i++) assert.match(newId(), /^[0-9a-z]{7}$/);
});

test('ids come from the supplied random source', () => {
  let n = 0;
  const steps = [0, 1 / 36, 10 / 36, 35 / 36, 0.5, 0.999, 0.25];
  assert.equal(newId(() => steps[n++]), '01aziz9');
});

test('a new group holds its text as the only, active variant', () => {
  assert.deepEqual(makeGroup('word', 'tension'), { scope: 'word', variants: ['tension'], active: 0 });
});

test('adding a variant returns its index and leaves the active one alone', () => {
  const g = makeGroup('word', 'tension');
  assert.equal(addVariant(g, 'pressure'), 1);
  assert.equal(addVariant(g, 'friction', { ai: true }), 2);
  assert.deepEqual(g, { scope: 'word', variants: ['tension', 'pressure', 'friction'], active: 0, ai: ['friction'] });
});

test('empty and duplicate variants are refused', () => {
  const g = makeGroup('word', 'tension');
  assert.equal(addVariant(g, '   '), -1);
  assert.equal(addVariant(g, 'tension'), -1);
  assert.equal(addVariant(g, ' tension '), -1);
  assert.equal(g.variants.length, 1);
});

test('added text is trimmed', () => {
  const g = makeGroup('word', 'tension');
  addVariant(g, '  tough stuff ');
  assert.equal(g.variants[1], 'tough stuff');
});

test('removing a variant before the active one keeps the same text active', () => {
  const g = { scope: 'word', variants: ['a', 'b', 'c'], active: 2 };
  assert.deepEqual(removeVariant(g, 0), { removed: 'a', active: 1 });
  assert.equal(g.variants[g.active], 'c');
});

test('removing the active variant shows the next one, or the last when it was last', () => {
  const g = { scope: 'word', variants: ['a', 'b', 'c'], active: 1 };
  assert.deepEqual(removeVariant(g, 1), { removed: 'b', active: 1 });
  assert.equal(g.variants[g.active], 'c');
  assert.deepEqual(removeVariant(g, 1), { removed: 'c', active: 0 });
  assert.deepEqual(g.variants, ['a']);
});

test('removing an AI variant forgets that it was AI, and drops an empty ai list', () => {
  const g = { scope: 'word', variants: ['a', 'b'], active: 0, ai: ['b'] };
  removeVariant(g, 1);
  assert.deepEqual(g, { scope: 'word', variants: ['a'], active: 0 });
});

test('editing an AI variant makes it the writer’s', () => {
  const g = { scope: 'word', variants: ['a', 'b', 'c'], active: 0, ai: ['b', 'c'] };
  assert.equal(isAI(g, 1), true);
  setVariantText(g, 1, 'bee');
  assert.equal(isAI(g, 1), false);
  assert.deepEqual(g.ai, ['c']);
  assert.deepEqual(g.variants, ['a', 'bee', 'c']);
});

test('setActive reports whether anything changed', () => {
  const g = { scope: 'word', variants: ['a', 'b'], active: 0 };
  assert.equal(setActive(g, 1), true);
  assert.equal(setActive(g, 1), false);
  assert.equal(setActive(g, 5), false);
  assert.equal(setActive(g, -1), false);
  assert.equal(g.active, 1);
});

test('cloneGroups copies deeply', () => {
  const groups = { x: { scope: 'word', variants: ['a', 'b'], active: 0, ai: ['b'] } };
  const copy = cloneGroups(groups);
  copy.x.variants.push('c');
  copy.x.ai.push('c');
  assert.deepEqual(groups.x, { scope: 'word', variants: ['a', 'b'], active: 0, ai: ['b'] });
});

test('tidyGroup fixes the key order used in the file and omits an empty ai list', () => {
  assert.equal(JSON.stringify(tidyGroup({ ai: [], active: 1, variants: ['a', 'b'], scope: 'word' })), '{"scope":"word","variants":["a","b"],"active":1}');
  assert.equal(JSON.stringify(tidyGroup({ ai: ['b'], active: 1, variants: ['a', 'b'], scope: 'word' })), '{"scope":"word","variants":["a","b"],"active":1,"ai":["b"]}');
});
