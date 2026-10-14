import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fleeTo, isNear, NEAR } from '../../web/src/fx/flee.js';

const BOUNDS = { left: 18, top: 18, right: 1530, bottom: 958 };
/** How far apart, to the thousandth of a pixel (the arithmetic is not exact). */
const far = (a, b) => Math.round(Math.hypot(a.x - b.x, a.y - b.y) * 1000) / 1000;
const degrees = (from, to) => (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
/** The smallest angle between two directions, in degrees. */
const between = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const inside = (p) => p.x >= BOUNDS.left && p.x <= BOUNDS.right && p.y >= BOUNDS.top && p.y <= BOUNDS.bottom;
/** A stand-in for Math.random that goes through the given values, round and round. */
const dealt = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

test('the pointer is near within 25px of the middle of the button, and not beyond', () => {
  assert.equal(NEAR, 25);
  assert.equal(isNear({ x: 100, y: 100 }, { x: 120, y: 110 }), true);
  assert.equal(isNear({ x: 100, y: 100 }, { x: 100, y: 125.5 }), false);
});

test('it goes straight away from the pointer, give or take ten degrees, 90 to 120px', () => {
  const at = { x: 600, y: 500 };
  for (const pointer of [{ x: 580, y: 500 }, { x: 610, y: 520 }, { x: 600, y: 478 }, { x: 617, y: 488 }]) {
    for (const random of [dealt(0, 0), dealt(0.999, 0.999), dealt(0.5, 0.5), dealt(0.2, 0.9), dealt(0.9, 0.1)]) {
      const to = fleeTo(at, pointer, BOUNDS, random);
      assert.ok(far(at, to) >= 90 && far(at, to) <= 120, `${far(at, to)}px`);
      assert.ok(between(degrees(pointer, at), degrees(at, to)) <= 10.001, `${between(degrees(pointer, at), degrees(at, to))} degrees off`);
    }
  }
});

test('with the pointer dead on it, it still goes somewhere a full jump away', () => {
  const at = { x: 600, y: 500 };
  const to = fleeTo(at, { x: 600, y: 500 }, BOUNDS, dealt(0.3, 0.6, 0.1));
  assert.ok(far(at, to) >= 90 && far(at, to) <= 120);
});

test('pushed toward an edge it turns aside rather than leave the window, and still makes a full jump', () => {
  // The button at rest is near the bottom-left corner. A pointer coming from the right
  // would push it out through the left edge; from above, out through the bottom.
  const rest = { x: 136, y: 944 };
  for (const pointer of [{ x: 156, y: 944 }, { x: 136, y: 924 }, { x: 150, y: 930 }]) {
    for (const random of [dealt(0, 0.5), dealt(0.999, 0.5), dealt(0.5, 0), dealt(0.5, 0.999)]) {
      const to = fleeTo(rest, pointer, BOUNDS, random);
      assert.ok(inside(to), `${JSON.stringify(to)} is outside`);
      assert.ok(far(rest, to) >= 90 && far(rest, to) <= 120, `${far(rest, to)}px`);
    }
  }
});

test('it never lands where it started, even boxed into a corner of a small window', () => {
  const small = { left: 18, top: 18, right: 150, bottom: 150 };
  const to = fleeTo({ x: 20, y: 20 }, { x: 40, y: 40 }, small, dealt(0.5, 0.5));
  assert.ok(to.x >= 18 && to.x <= 150 && to.y >= 18 && to.y <= 150);
  assert.ok(far({ x: 20, y: 20 }, to) > 50);
});
