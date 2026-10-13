// The app's sounds. There are no audio files: each sound is built from an oscillator and
// some noise, to recipes fitted to the clips (design spec 6.12).
//
//   tick   a triangle wave at 1900 Hz (high) or 1500 Hz (low), about 14 ms long
//   boom   a sine that drops to somewhere between 83 and 98 Hz, under a burst of noise
//   thump  noise rising for 140 ms and cut off, then a 98 Hz thud

const RATE = 48000;

function noise(audio, seconds) {
  const buffer = audio.createBuffer(1, Math.ceil(seconds * audio.sampleRate), audio.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  return new AudioBufferSourceNode(audio, { buffer });
}

/** `source` heard only between `from` and `to` Hz. */
function band(audio, source, from, to) {
  const above = new BiquadFilterNode(audio, { type: 'highpass', frequency: from, Q: 0.707 });
  const below = new BiquadFilterNode(audio, { type: 'lowpass', frequency: to, Q: 0.707 });
  return source.connect(above).connect(below);
}

function tick(hz) {
  return (audio, out, at) => {
    const tone = new OscillatorNode(audio, { type: 'triangle', frequency: hz });
    const level = new GainNode(audio, { gain: 0 });
    level.gain.setValueAtTime(0, at);
    level.gain.linearRampToValueAtTime(0.3, at + 0.003);
    level.gain.exponentialRampToValueAtTime(0.001, at + 0.03); // a time constant of 4.7 ms
    level.gain.linearRampToValueAtTime(0, at + 0.034);
    tone.connect(level).connect(out);
    tone.start(at);
    tone.stop(at + 0.036);
  };
}

function boom(audio, out, at) {
  const rest = 83 + Math.random() * 15; // no two booms alike
  const thud = new OscillatorNode(audio, { type: 'sine', frequency: 230 });
  thud.frequency.setValueAtTime(230, at);
  thud.frequency.exponentialRampToValueAtTime(rest, at + 0.01);
  const body = new GainNode(audio, { gain: 0 });
  body.gain.setValueAtTime(0, at);
  body.gain.linearRampToValueAtTime(0.88, at + 0.008);
  body.gain.setTargetAtTime(0, at + 0.008, 0.07);
  thud.connect(body).connect(out);
  thud.start(at);
  thud.stop(at + 0.65);

  const crackle = noise(audio, 0.5);
  const burst = new GainNode(audio, { gain: 0 });
  burst.gain.setValueAtTime(0, at);
  burst.gain.linearRampToValueAtTime(0.36, at + 0.04);
  burst.gain.setTargetAtTime(0, at + 0.04, 0.075);
  band(audio, crackle, 1000, 3500).connect(burst).connect(out);
  crackle.start(at);
  crackle.stop(at + 0.5);
}

function thump(audio, out, at) {
  const cut = at + 0.14;
  const rush = noise(audio, 0.16);
  const swell = new GainNode(audio, { gain: 0 });
  swell.gain.setValueAtTime(0.005, at);
  swell.gain.exponentialRampToValueAtTime(0.5, cut);
  swell.gain.setValueAtTime(0, cut);
  band(audio, rush, 1000, 3000).connect(swell).connect(out);
  rush.start(at);
  rush.stop(cut + 0.01);

  const thud = new OscillatorNode(audio, { type: 'sine', frequency: 98 });
  const body = new GainNode(audio, { gain: 0 });
  body.gain.setValueAtTime(0, cut);
  body.gain.linearRampToValueAtTime(0.93, cut + 0.003);
  body.gain.setTargetAtTime(0, cut + 0.003, 0.055);
  thud.connect(body).connect(out);
  thud.start(cut);
  thud.stop(cut + 0.5);
}

const SOUNDS = {
  'tick-high': { seconds: 0.05, build: tick(1900) },
  'tick-low': { seconds: 0.05, build: tick(1500) },
  boom: { seconds: 0.7, build: boom },
  thump: { seconds: 0.7, build: thump },
};

/**
 * @param enabled whether sounds should play just now (Settings ▸ Play sounds)
 * @param context makes the audio context to play into; called once, at the first sound
 */
export function createSound({ enabled = () => true, context = () => new AudioContext(), restAfterMs = 30000 } = {}) {
  let audio = null;
  let resting = 0;

  /**
   * Has the sound running, so that the next one plays at once. Starting the Mac's sound
   * from nothing takes long enough to hear, so this is called when a sound is likely (the
   * pointer comes onto a word with alternatives), and the sound is put to rest again when
   * none has played for a while.
   */
  function prepare() {
    if (!enabled()) return false;
    audio ??= context();
    // A context made before any click starts out suspended; one being rendered offline cannot be resumed.
    if (audio.state === 'suspended') audio.resume?.().catch(() => {});
    clearTimeout(resting);
    resting = setTimeout(() => audio?.suspend?.().catch(() => {}), restAfterMs);
    return true;
  }

  function play(name) {
    if (!prepare()) return;
    SOUNDS[name].build(audio, audio.destination, audio.currentTime);
  }

  return {
    prepare: () => void prepare(),
    /** The tick of a change of variant: 'low' on landing back home, otherwise 'high'. */
    tick: (tone) => play(tone === 'low' ? 'tick-low' : 'tick-high'),
    boom: () => play('boom'),
    thump: () => play('thump'),

    /** One sound as samples at 48 kHz, for measuring. */
    async render(name) {
      const sound = SOUNDS[name];
      if (!sound) throw new Error(`unknown sound: ${name}`);
      const offline = new OfflineAudioContext(1, Math.ceil(sound.seconds * RATE), RATE);
      sound.build(offline, offline.destination, 0);
      return (await offline.startRendering()).getChannelData(0);
    },
  };
}
