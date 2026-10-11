// Explosions (design spec 6.12), drawn on a canvas over the whole window.
//
// A burst is built once, from a seed, as a list of things with fixed numbers: pieces of
// the text, balls of fire, sparks, debris, embers, smoke. Where each of them is at any
// moment follows from those numbers and the time alone. So a burst looks the same every
// time, can be drawn at any moment for a scenario to look at, and can be run backwards,
// which is how undo puts a blown-up alternative back.

import { seededRandom } from '../editor/wobble.js';

const DURATION = 1300; // ms, all of it; the fire itself is out by 330
const REVERSE = { from: 330, over: 280 }; // undo: the first 330 ms played backwards in 280

const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const easeOut = (x) => 1 - (1 - clamp(x)) ** 2;
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * clamp(k));
const rgba = ([r, g, b], a) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${clamp(a).toFixed(3)})`;

const CREAM = [245, 222, 205];
const YELLOW = [255, 228, 135];
const ORANGE = [255, 150, 50];
const RUST = [190, 70, 25];
/** Hot things cool: cream, yellow by 120 ms, orange by 280, rust by 700. */
function heat(t) {
  if (t < 120) return mix(CREAM, YELLOW, t / 120);
  if (t < 280) return mix(YELLOW, ORANGE, (t - 120) / 160);
  return mix(ORANGE, RUST, (t - 280) / 420);
}

/** Where something thrown at speed (vx, vy) px/s is after `s` seconds of drag and gravity. */
function thrown(x, y, vx, vy, s, drag, gravity) {
  const reach = drag * (1 - Math.exp(-s / drag));
  return [x + vx * reach, y + vy * reach + 0.5 * gravity * s * s];
}

/** The pixels of a line of text as 2px cells, relative to the line's box. */
function cellsOfText(text, font, width, height) {
  const scratch = document.createElement('canvas');
  scratch.width = Math.ceil(width);
  scratch.height = Math.ceil(height);
  const ink = scratch.getContext('2d', { willReadFrequently: true });
  ink.font = font;
  ink.textBaseline = 'alphabetic';
  ink.fillStyle = '#fff';
  ink.fillText(text, 0, Math.round(parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? '20')));
  const data = ink.getImageData(0, 0, scratch.width, scratch.height).data;
  const cells = [];
  for (let y = 0; y + 1 < scratch.height; y += 2) {
    for (let x = 0; x + 1 < scratch.width; x += 2) {
      const at = (y * scratch.width + x) * 4 + 3;
      const cover = data[at] + data[at + 4] + data[at + scratch.width * 4] + data[at + scratch.width * 4 + 4];
      if (cover > 380) cells.push([x, y]);
    }
  }
  return cells;
}

/** Everything in one burst over `lines` ({ left, top, right, bottom, text?, font? } in window pixels). */
function build(lines, font) {
  const random = seededRandom(lines.map((l) => `${Math.round(l.left)},${Math.round(l.top)},${Math.round(l.right - l.left)},${l.text ?? ''}`).join('|'));
  const between = (a, b) => a + (b - a) * random();
  const burst = { pieces: [], balls: [], glows: [], sparks: [], debris: [], embers: [], smoke: [], flashes: [] };
  const share = Math.max(1, lines.length);

  for (const line of lines) {
    const width = Math.max(1, line.right - line.left);
    const height = line.bottom - line.top;
    const cx = line.left + width / 2;
    const cy = line.top + height * 0.56;
    const star = [line.left + width * 0.6, cy];

    // The text itself, in pieces. A line without its text gets pieces scattered like text.
    let cells = line.text && width <= 520 ? cellsOfText(line.text, line.font ?? font, width, height) : [];
    if (cells.length === 0) {
      const count = Math.min(420, Math.round(width * 1.4));
      cells = Array.from({ length: count }, () => [between(0, width), height * between(0.34, 0.8)]);
    }
    const keep = Math.min(1, 700 / share / cells.length);
    for (const [x, y] of cells) {
      if (random() > keep) continue;
      const px = line.left + x + between(-0.6, 0.6);
      const outward = (px - cx) / (width / 2);
      burst.pieces.push({
        x: px,
        y: line.top + y + between(-0.6, 0.6),
        vx: outward * between(60, 300) + between(-70, 70),
        vy: between(-170, 70),
        delay: between(20, 90),
        life: between(260, 720),
        size: random() < 0.75 ? 2 : 1.5,
      });
    }

    const count = Math.max(4, Math.min(12, Math.round(width / 16)));
    for (let i = 0; i < count; i++) {
      // Uneven on purpose: fire in lumps, not a tidy row.
      const ball = { x: line.left + ((i + between(0, 1)) / count) * width, y: cy + between(-9, 9), radius: between(13, 33), delay: between(0, 30), drift: between(-5, 5) };
      burst.balls.push(ball);
      for (let k = 0; k < 2; k++) {
        burst.embers.push({ x: ball.x + between(-9, 9), y: ball.y + between(-8, 6), vx: between(-12, 12), vy: between(-36, -18), start: between(170, 260), life: between(220, 360), radius: between(3, 5.5) });
      }
      for (let k = 0; k < 2; k++) {
        burst.smoke.push({ x: ball.x + between(-14, 14), y: cy - between(8, 26), start: between(170, 330), life: between(700, 930), vy: between(-22, -10), vx: between(-6, 6), from: between(8, 12), to: between(20, 28) });
      }
    }
    burst.glows.push({ x: cx, y: cy, rx: width / 2 + 26, ry: 30 });
    burst.flashes.push({ x: star[0], y: star[1] });

    const sparks = Math.min(26, Math.round(14 + width / 40));
    for (let k = 0; k < sparks; k++) {
      const angle = ((k + between(-0.4, 0.4)) / sparks) * Math.PI * 2;
      burst.sparks.push({ x: star[0], y: star[1], cos: Math.cos(angle), sin: Math.sin(angle), speed: between(260, 640), life: between(200, 380), length: between(5, 12) });
    }

    const bits = Math.min(90, Math.round(24 + width / 5));
    for (let k = 0; k < bits; k++) {
      // More of it from the two ends of the word.
      const along = random() < 0.6 ? (random() < 0.5 ? between(0, 0.25) : between(0.75, 1)) : random();
      const x = line.left + along * width;
      const side = x < cx ? -1 : 1;
      const angle = Math.atan2(between(-0.8, 0.5), side * between(0.3, 1));
      const speed = between(60, 330);
      burst.debris.push({ x, y: cy + between(-6, 6), vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, delay: between(30, 130), life: between(350, 950), size: between(1.5, 2.5) });
    }
  }
  return burst;
}

function blob(ctx, x, y, radius, stops) {
  if (radius <= 0) return;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  for (const [at, colour] of stops) gradient.addColorStop(at, colour);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

/** Draws the burst as it is `t` ms after it went off. */
function paint(ctx, burst, t) {
  if (t < 0 || t >= DURATION) return;

  ctx.globalCompositeOperation = 'source-over';
  for (const puff of burst.smoke) {
    const age = t - puff.start;
    if (age < 0 || age > puff.life) continue;
    const strength = 0.3 * Math.min(age / 160, 1 - (age - 160) / (puff.life - 160));
    const s = age / 1000;
    blob(ctx, puff.x + puff.vx * s, puff.y + puff.vy * s, puff.from + (puff.to - puff.from) * easeOut(age / puff.life), [
      [0, rgba([140, 112, 100], strength)],
      [0.55, rgba([120, 98, 90], strength * 0.6)],
      [1, rgba([100, 84, 80], 0)],
    ]);
  }

  ctx.globalCompositeOperation = 'lighter';
  if (t < 330) {
    const strength = Math.min(t / 25, 1) * (t < 160 ? 1 : 1 - (t - 160) / 170);
    for (const glow of burst.glows) {
      ctx.save();
      ctx.translate(glow.x, glow.y);
      ctx.scale(glow.rx / glow.ry, 1);
      blob(ctx, 0, 0, glow.ry, [
        [0, rgba([255, 80, 15], 0.42 * strength)],
        [0.6, rgba([200, 40, 5], 0.2 * strength)],
        [1, rgba([120, 10, 0], 0)],
      ]);
      ctx.restore();
    }
  }
  for (const ball of burst.balls) {
    const age = t - ball.delay;
    if (age <= 0 || age >= 330) continue;
    const strength = Math.min(age / 12, 1) * (age < 200 ? 1 : 1 - (age - 200) / 130);
    const radius = ball.radius * (0.2 + 0.8 * easeOut(age / 70)) * (age < 170 ? 1 : 1 - 0.6 * ((age - 170) / 160));
    const rise = 16 * (age / 330) ** 2;
    blob(ctx, ball.x + ball.drift * (age / 330), ball.y - rise, radius, [
      [0, rgba([255, 255, 245], strength)],
      [0.3, rgba([255, 235, 140], strength)],
      [0.55, rgba([255, 150, 35], 0.9 * strength)],
      [0.8, rgba([215, 50, 10], 0.5 * strength)],
      [1, rgba([120, 10, 0], 0)],
    ]);
  }
  for (const ember of burst.embers) {
    const age = t - ember.start;
    if (age < 0 || age > ember.life) continue;
    const strength = 0.6 * Math.min(age / 40, 1, (ember.life - age) / (ember.life * 0.6));
    const s = age / 1000;
    blob(ctx, ember.x + ember.vx * s, ember.y + ember.vy * s, ember.radius, [
      [0, rgba([255, 170, 70], strength)],
      [0.5, rgba([255, 120, 35], strength * 0.6)],
      [1, rgba([200, 60, 10], 0)],
    ]);
  }
  if (t >= 8 && t < 70) {
    for (const flash of burst.flashes) {
      blob(ctx, flash.x, flash.y, 5 + 14 * ((t - 8) / 62), [
        [0, rgba([255, 255, 245], 1 - (t - 8) / 62)],
        [0.5, rgba([255, 235, 160], 0.6 * (1 - (t - 8) / 62))],
        [1, rgba([255, 160, 40], 0)],
      ]);
    }
  }

  ctx.globalCompositeOperation = 'source-over';
  for (const piece of burst.pieces) {
    if (t > piece.life) continue;
    const s = Math.max(0, t - piece.delay) / 1000;
    const [x, y] = thrown(piece.x, piece.y, piece.vx, piece.vy, s, 0.4, 300);
    ctx.fillStyle = rgba(heat(t), t < piece.life * 0.6 ? 1 : 1 - (t - piece.life * 0.6) / (piece.life * 0.4));
    ctx.fillRect(x, y, piece.size, piece.size);
  }
  for (const bit of burst.debris) {
    const age = t - bit.delay;
    if (age < 0 || age > bit.life) continue;
    const [x, y] = thrown(bit.x, bit.y, bit.vx, bit.vy, age / 1000, 0.5, 260);
    ctx.fillStyle = rgba(heat(t + 60), age < bit.life * 0.5 ? 1 : 1 - (age - bit.life * 0.5) / (bit.life * 0.5));
    ctx.fillRect(x, y, bit.size, bit.size);
  }

  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = 1.3;
  ctx.lineCap = 'round';
  for (const spark of burst.sparks) {
    const age = t - 25;
    if (age < 0 || t > spark.life) continue;
    const reach = spark.speed * 0.24 * (1 - Math.exp(-age / 240));
    const tail = Math.max(0, reach - spark.length * (1 - 0.6 * (t / spark.life)));
    ctx.strokeStyle = rgba(mix([255, 255, 255], [255, 238, 195], t / spark.life), Math.min(age / 20, 1) * (1 - (t / spark.life) ** 2));
    ctx.beginPath();
    ctx.moveTo(spark.x + spark.cos * tail, spark.y + spark.sin * tail);
    ctx.lineTo(spark.x + spark.cos * reach, spark.y + spark.sin * reach);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

export function createExplosions({ canvas, font = '400 20px "IBM Plex Mono", monospace' }) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const running = []; // { burst, began, reverse }
  let frozen = null; // a scenario's stopped clock: ms since each burst began
  let frame = 0;

  function fit() {
    const scale = window.devicePixelRatio || 1;
    const width = Math.round(innerWidth * scale);
    const height = Math.round(innerHeight * scale);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
  }

  const length = (entry) => (entry.reverse ? REVERSE.over : DURATION);

  function draw(now) {
    fit();
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (let i = running.length - 1; i >= 0; i--) {
      const entry = running[i];
      const elapsed = frozen ?? now - entry.began;
      if (elapsed >= length(entry)) {
        if (frozen === null) running.splice(i, 1);
        continue;
      }
      paint(ctx, entry.burst, entry.reverse ? REVERSE.from * (1 - elapsed / REVERSE.over) : elapsed);
    }
  }

  function tick(now) {
    frame = 0;
    if (frozen !== null) return;
    draw(now);
    if (running.length) frame = requestAnimationFrame(tick);
  }

  function run() {
    if (frozen !== null) draw(performance.now());
    else if (!frame) frame = requestAnimationFrame(tick);
  }

  window.addEventListener('resize', () => {
    if (running.length) draw(performance.now());
  });
  fit();

  return {
    /**
     * Sets off a burst over `lines`, each { left, top, right, bottom } in window pixels and,
     * to have the text itself fly apart, its `text` (and `font`, if not the page's).
     * @param reverse run it backwards, from what an explosion leaves to the text in pieces
     */
    burst(lines, { reverse = false } = {}) {
      if (!lines?.length) return;
      running.push({ burst: build(lines, font), began: performance.now(), reverse });
      run();
    },

    /** How many bursts are running. */
    active: () => running.length,

    /** For scenarios: stops the clock and shows every burst as it is `ms` after it began. */
    seek(ms) {
      frozen = ms;
      draw(performance.now());
    },

    /** Starts the clock again from where seek left it. */
    resume() {
      if (frozen === null) return;
      const now = performance.now();
      for (const entry of running) entry.began = now - frozen;
      frozen = null;
      run();
    },

    /** Stops every burst and wipes the layer. */
    clear() {
      running.length = 0;
      draw(performance.now());
    },
  };
}
