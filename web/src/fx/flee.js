// Where a button that will not be caught goes (design spec 6.11). Measured from the
// author's clip: it bolts when the pointer comes within about 25px of its middle, straight
// away from the pointer give or take ten degrees, and lands 90 to 120px off.

export const NEAR = 25;
const JUMP = { least: 90, most: 120 };
const SWAY = (10 * Math.PI) / 180;
const TURN = Math.PI / 12;

export const isNear = (at, pointer) => Math.hypot(at.x - pointer.x, at.y - pointer.y) <= NEAR;

/**
 * @param at      the middle of the button now
 * @param pointer where the pointer is
 * @param bounds  { left, top, right, bottom }: where the middle of the button may be
 * @param random  a source of numbers from 0 up to 1
 * @returns {{x: number, y: number}} where it lands
 */
export function fleeTo(at, pointer, bounds, random = Math.random) {
  const length = JUMP.least + random() * (JUMP.most - JUMP.least);
  const dx = at.x - pointer.x;
  const dy = at.y - pointer.y;
  const away = dx === 0 && dy === 0 ? random() * 2 * Math.PI : Math.atan2(dy, dx);
  const heading = away + (random() * 2 - 1) * SWAY;
  const fits = (p) => p.x >= bounds.left && p.x <= bounds.right && p.y >= bounds.top && p.y <= bounds.bottom;

  // Straight away if there is room; otherwise the nearest heading to either side that has
  // room for a full jump, so the window's edge turns it aside and never stops it short.
  for (let turn = 0; turn <= 12; turn++) {
    for (const side of turn === 0 ? [1] : [1, -1]) {
      const angle = heading + side * turn * TURN;
      const to = { x: at.x + length * Math.cos(angle), y: at.y + length * Math.sin(angle) };
      if (fits(to)) return to;
    }
  }
  // A window too small to jump in: the corner furthest from the pointer.
  const corners = [bounds.left, bounds.right].flatMap((x) => [bounds.top, bounds.bottom].map((y) => ({ x, y })));
  return corners.reduce((best, corner) => (Math.hypot(corner.x - pointer.x, corner.y - pointer.y) > Math.hypot(best.x - pointer.x, best.y - pointer.y) ? corner : best));
}
