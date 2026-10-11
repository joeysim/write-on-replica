import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wobblePath, seededRandom } from '../../web/src/editor/wobble.js';

const points = (d) => [...d.matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

test('the same seed always draws the same line', () => {
  const a = wobblePath({ x0: 10, x1: 300, y: 50, seed: 'h00a0dg:0' });
  assert.equal(a, wobblePath({ x0: 10, x1: 300, y: 50, seed: 'h00a0dg:0' }));
});

test('different seeds draw different lines', () => {
  const a = wobblePath({ x0: 10, x1: 300, y: 50, seed: 'h00a0dg:0' });
  const b = wobblePath({ x0: 10, x1: 300, y: 50, seed: 'kswdaew:0' });
  assert.notEqual(a, b);
});

test('the line runs from x0 to x1 in order', () => {
  const pts = points(wobblePath({ x0: 10, x1: 301.5, y: 50, seed: 's' }));
  assert.equal(pts[0][0], 10);
  assert.equal(pts[pts.length - 1][0], 301.5);
  for (let i = 1; i < pts.length; i++) assert.ok(pts[i][0] > pts[i - 1][0]);
  assert.ok(pts.length >= 40, 'a point about every 6px');
});

test('the line stays within its wobble and tilt of the baseline', () => {
  for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
    const amp = 0.3;
    const tilt = 0.4;
    for (const [, y] of points(wobblePath({ x0: 0, x1: 800, y: 100, seed, amp, tilt }))) {
      assert.ok(Math.abs(y - 100) <= amp + tilt / 2 + 0.05, `${seed}: ${y}`);
    }
  }
});

test('the line is not flat', () => {
  const ys = points(wobblePath({ x0: 0, x1: 400, y: 100, seed: 'wavy' })).map(([, y]) => y);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 0.15);
});

test('a very short line still has two ends, and an empty span draws nothing', () => {
  assert.equal(points(wobblePath({ x0: 5, x1: 8, y: 20, seed: 's' })).length, 2);
  assert.equal(wobblePath({ x0: 5, x1: 5, y: 20, seed: 's' }), '');
  assert.equal(wobblePath({ x0: 9, x1: 5, y: 20, seed: 's' }), '');
});

test('seededRandom is repeatable and spread over [0, 1)', () => {
  const a = seededRandom('seed');
  const b = seededRandom('seed');
  const values = Array.from({ length: 200 }, () => a());
  assert.deepEqual(values.slice(0, 5), Array.from({ length: 5 }, () => b()));
  assert.ok(values.every((v) => v >= 0 && v < 1));
  assert.ok(Math.min(...values) < 0.1 && Math.max(...values) > 0.9);
});

test('a vertical line is the same stroke turned on its side', () => {
  const across = points(wobblePath({ x0: 100, x1: 300, y: 40, seed: 'bar' }));
  const down = points(wobblePath({ x0: 100, x1: 300, y: 40, seed: 'bar', vertical: true }));
  assert.equal(down.length, across.length);
  assert.deepEqual(down, across.map(([x, y]) => [y, x]));
  assert.equal(down[0][1], 100);
  assert.equal(down[down.length - 1][1], 300);
});
