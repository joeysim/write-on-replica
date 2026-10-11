// Lines drawn like an editor's pen: nearly straight, a slow wobble, a slight tilt.
// The shape comes from a seed, so a given underline looks the same every time it is drawn.

/** A repeatable random source in [0, 1) for a string seed. */
export function seededRandom(seed) {
  // FNV-1a to spread the seed, then mulberry32.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (n) => Math.round(n * 100) / 100;

/**
 * SVG path data for a hand-drawn horizontal line from x0 to x1 around height y.
 * The line never strays more than `amp + tilt / 2` from y.
 * @param amp    wobble amplitude in px
 * @param period wobble wavelength in px (varied a little per line)
 * @param tilt   total rise or fall from end to end, at most, in px
 * @param step   distance between points in px
 */
export function wobblePath({ x0, x1, y, seed, amp = 0.3, period = 100, tilt = 0.4, step = 6 }) {
  const length = x1 - x0;
  if (!(length > 0)) return '';
  const random = seededRandom(String(seed));

  const mainAmp = amp * (0.55 + random() * 0.25);
  const mainLen = period * (0.8 + random() * 0.5);
  const mainPhase = random() * Math.PI * 2;
  const fineAmp = amp * (0.1 + random() * 0.1);
  const fineLen = mainLen * (0.31 + random() * 0.12);
  const finePhase = random() * Math.PI * 2;
  const slope = (random() - 0.5) * tilt;

  const at = (x) => {
    const along = x - x0;
    const wave = mainAmp * Math.sin((along / mainLen) * Math.PI * 2 + mainPhase) + fineAmp * Math.sin((along / fineLen) * Math.PI * 2 + finePhase);
    return y + wave + slope * (along / length - 0.5);
  };

  const count = Math.max(1, Math.round(length / step));
  let d = `M${round(x0)} ${round(at(x0))}`;
  for (let i = 1; i <= count; i++) {
    const x = i === count ? x1 : x0 + (length * i) / count;
    d += ` L${round(x)} ${round(at(x))}`;
  }
  return d;
}
