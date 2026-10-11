// The synthesised sounds, rendered offline and measured (design spec 6.12).
// Each is also written to the output folder as a WAV, for the analysis tools used on the clips.
const { sound } = window.writeOn;
const { createSound } = await import('./src/fx/sound.js');
const RATE = 48000;
const ms = (n) => Math.round((n / 1000) * RATE);

/** The strongest frequency between lo and hi (Hz) in x, by a Goertzel scan. */
function strongest(x, lo, hi, step = 1) {
  let best = { f: 0, power: -1 };
  for (let f = lo; f <= hi; f += step) {
    const w = (2 * Math.PI * f) / RATE;
    const k = 2 * Math.cos(w);
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < x.length; i++) {
      const s0 = x[i] + k * s1 - s2;
      s2 = s1;
      s1 = s0;
    }
    const power = s1 * s1 + s2 * s2 - k * s1 * s2;
    if (power > best.power) best = { f, power };
  }
  return best.f;
}
const peak = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rms = (x) => Math.sqrt(x.reduce((sum, v) => sum + v * v, 0) / Math.max(1, x.length));
/** Milliseconds from the first to the last sample louder than `fraction` of the peak. */
function loudFor(x, fraction) {
  const level = peak(x) * fraction;
  let first = -1;
  let last = -1;
  for (let i = 0; i < x.length; i++) {
    if (Math.abs(x[i]) >= level) {
      if (first < 0) first = i;
      last = i;
    }
  }
  return ((last - first) / RATE) * 1000;
}
/** What is left of x above about 1 kHz, steeply enough that the bass thud does not leak in. */
function hiss(x) {
  let out = x;
  for (let pass = 0; pass < 3; pass++) {
    const next = new Float32Array(out.length);
    let low = 0;
    for (let i = 0; i < out.length; i++) {
      low += 0.12 * (out[i] - low); // one-pole low-pass near 1 kHz
      next[i] = out[i] - low;
    }
    out = next;
  }
  return out;
}
async function save(name, x) {
  const bytes = new Uint8Array(44 + x.length * 2);
  const view = new DataView(bytes.buffer);
  const tag = (at, s) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  tag(0, 'RIFF');
  view.setUint32(4, 36 + x.length * 2, true);
  tag(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, RATE, true);
  view.setUint32(28, RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, x.length * 2, true);
  for (let i = 0; i < x.length; i++) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i])) * 32767, true);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  await t.writeFile(`${name}.wav`, btoa(binary));
}

// --- the two ticks ---------------------------------------------------------------------------

for (const [name, hz] of [['tick-high', 1900], ['tick-low', 1500]]) {
  const x = await sound.render(name);
  await save(name, x);
  t.near(strongest(x, hz - 200, hz + 200), hz, 5, `${name} is at ${hz} Hz`);
  t.near(peak(x), 0.3, 0.03, `${name} peaks at 0.3`);
  const audible = loudFor(x, 0.1);
  t.assert(audible >= 11 && audible <= 17, `${name} is audible for about 14 ms (${audible.toFixed(1)})`);
  t.assert(Math.abs(x[0]) < 0.01, `${name} starts from silence, without a click`);
  t.assert(peak(x.subarray(ms(40))) < 0.001, `${name} is over within 40 ms`);
  // A triangle wave: odd harmonics only, the third about a ninth of the fundamental.
  const body = x.subarray(0, ms(20));
  const power = (f) => {
    let re = 0;
    let im = 0;
    for (let i = 0; i < body.length; i++) {
      re += body[i] * Math.cos((2 * Math.PI * f * i) / RATE);
      im += body[i] * Math.sin((2 * Math.PI * f * i) / RATE);
    }
    return Math.hypot(re, im);
  };
  const third = power(hz * 3) / power(hz);
  t.assert(third > 0.06 && third < 0.16, `${name} has a triangle's third harmonic (${third.toFixed(3)})`);
  t.assert(power(hz * 2) / power(hz) < 0.03, `${name} has no second harmonic`);
}

// --- the boom ---------------------------------------------------------------------------------

{
  const seen = new Set();
  for (let i = 0; i < 6; i++) {
    const x = await sound.render('boom');
    if (i === 0) await save('boom', x);
    const f = strongest(x.subarray(ms(40), ms(300)), 60, 140, 0.5);
    seen.add(f);
    t.assert(f >= 82 && f <= 99, `the boom's thump is between 83 and 98 Hz (${f})`);
    t.assert(peak(x) > 0.7 && peak(x) <= 1, `it is loud but does not clip (${peak(x).toFixed(2)})`);
    // It starts high and drops: the first cycle is much shorter than those that follow.
    let crossing = -1;
    for (let j = 1; j < ms(12); j++) {
      if (x[j - 1] < 0 !== x[j] < 0 && j > 8) {
        crossing = j;
        break;
      }
    }
    t.assert(crossing > 0 && crossing < ms(4.5), `it begins well above its resting pitch (first half-cycle ${((crossing / RATE) * 1000).toFixed(1)} ms)`);
    // The burst of noise swells to about 35 ms and is gone by 300.
    const h = hiss(x);
    const early = rms(h.subarray(ms(0), ms(10)));
    const swell = rms(h.subarray(ms(25), ms(50)));
    const late = rms(h.subarray(ms(300), ms(400)));
    t.assert(swell > early * 1.5, `the noise swells after the start (${early.toFixed(3)} → ${swell.toFixed(3)})`);
    t.assert(swell > 0.05 && swell < 0.3, `and is a burst, not a wash (${swell.toFixed(3)})`);
    t.assert(late < swell * 0.05, `and is gone by 300 ms (${late.toFixed(4)})`);
    t.assert(peak(x.subarray(ms(600))) < 0.002, 'the whole boom is over within 600 ms');
  }
  t.assert(seen.size > 1, 'no two booms are quite alike');
}

// --- the thump of an undo ---------------------------------------------------------------------

{
  const x = await sound.render('thump');
  await save('thump', x);
  const h = hiss(x);
  t.assert(rms(h.subarray(ms(100), ms(138))) > rms(h.subarray(ms(10), ms(50))) * 2, 'noise rises towards 140 ms');
  t.assert(rms(h.subarray(ms(150), ms(250))) < rms(h.subarray(ms(100), ms(138))) * 0.1, 'and is cut off there');
  t.near(strongest(x.subarray(ms(150), ms(400)), 60, 140, 0.5), 98, 3, 'then a thump at 98 Hz');
  t.assert(peak(x.subarray(ms(140), ms(200))) > 0.6, 'which is the loud part');
  t.assert(peak(x.subarray(ms(550))) < 0.002, 'all over within 550 ms');
}

// --- the switch -------------------------------------------------------------------------------

t.assert(await sound.render('nonsense').then(() => false, () => true), 'an unknown sound is refused');
{
  // A sound object playing into a recording instead of the speakers.
  let on = true;
  const tape = new OfflineAudioContext(1, ms(100), RATE);
  const recorded = createSound({ enabled: () => on, context: () => tape });
  on = false;
  recorded.tick('high');
  recorded.boom();
  recorded.thump();
  on = true;
  const silent = (await tape.startRendering()).getChannelData(0);
  t.equal(peak(silent), 0, 'with sound effects off nothing plays');

  const tape2 = new OfflineAudioContext(1, ms(100), RATE);
  const playing = createSound({ enabled: () => true, context: () => tape2 });
  playing.tick('low');
  const made = (await tape2.startRendering()).getChannelData(0);
  t.near(strongest(made, 1300, 1700), 1500, 5, 'with them on, a tick plays');
}
