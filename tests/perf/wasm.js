// Would WebAssembly make the document's work faster? One honest trial: counting the words
// of a piece, the costliest thing the page used to do on every keystroke, three ways:
// as the app does it, as a plain JavaScript loop, and as a WebAssembly loop over the same
// bytes, with what it costs to hand the text across. Run in the app's own WebKit.
const pieces = window.__pieces;
const { countWords } = await import('./src/doc/text.js');
const { htmlToBlocks } = await import('./src/doc/format.js');
const { textOf } = await import('./src/doc/blocks.js');

// (func (param ptr len) (result i32)): the number of runs of bytes above 32 in memory.
const leb = (n) => { const out = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n); return out; };
const section = (id, bytes) => [id, ...leb(bytes.length), ...bytes];
const name = (text) => [text.length, ...[...text].map((ch) => ch.charCodeAt(0))];
const body = [
  0x01, 0x04, 0x7f, // four more i32 locals: end, n, inside, c
  0x20, 0x00, 0x20, 0x01, 0x6a, 0x21, 0x02, // end = ptr + len
  0x02, 0x40, 0x03, 0x40, // block, loop
  0x20, 0x00, 0x20, 0x02, 0x4f, 0x0d, 0x01, // if (ptr >= end) leave
  0x20, 0x00, 0x2d, 0x00, 0x00, 0x21, 0x05, // c = byte at ptr
  0x20, 0x05, 0x41, 0x20, 0x4d, 0x04, 0x40, // if (c <= 32)
  0x41, 0x00, 0x21, 0x04, //   inside = 0
  0x05, // else
  0x20, 0x04, 0x45, 0x04, 0x40, 0x20, 0x03, 0x41, 0x01, 0x6a, 0x21, 0x03, 0x0b, //   if (!inside) n += 1
  0x41, 0x01, 0x21, 0x04, //   inside = 1
  0x0b,
  0x20, 0x00, 0x41, 0x01, 0x6a, 0x21, 0x00, // ptr += 1
  0x0c, 0x00, 0x0b, 0x0b, // again; end loop; end block
  0x20, 0x03, 0x0b, // return n
];
const module = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  ...section(1, [0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f]),
  ...section(3, [0x01, 0x00]),
  ...section(5, [0x01, 0x00, 0x40]), // 64 pages of memory
  ...section(7, [0x02, ...name('memory'), 0x02, 0x00, ...name('count'), 0x00, 0x00]),
  ...section(10, [0x01, ...leb(body.length), ...body]),
]);
const { instance } = await WebAssembly.instantiate(module);
const { memory, count } = instance.exports;
const encoder = new TextEncoder();

function loop(text) {
  let n = 0;
  let inside = false;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) <= 32) inside = false;
    else if (!inside) { inside = true; n += 1; }
  }
  return n;
}
function viaWasm(text) {
  const { written } = encoder.encodeInto(text, new Uint8Array(memory.buffer));
  return count(0, written);
}
/** µs per call, from a loop long enough for a clock that ticks once a millisecond. */
function time(fn) {
  let calls = 4;
  for (;;) {
    const from = performance.now();
    for (let i = 0; i < calls; i++) fn();
    const took = performance.now() - from;
    if (took >= 80 || calls >= 1 << 22) return Math.round((took / calls) * 1000 * 100) / 100;
    calls *= 4;
  }
}

const blocks = htmlToBlocks(pieces.make(50000).state.html);
const whole = blocks.map(textOf).join('\n');
const paragraph = textOf(blocks.find((block) => block.kind === 'p'));
for (const [label, text] of [['one paragraph (80 words)', paragraph], ['the whole piece (50,000 words)', whole]]) {
  const answers = [countWords(text), loop(text), viaWasm(text)];
  t.assert(answers.every((n) => n === answers[0]), `the three counts agree: ${answers}`);
  const { written } = encoder.encodeInto(text, new Uint8Array(memory.buffer));
  t.log(JSON.stringify({
    text: label,
    chars: text.length,
    words: answers[0],
    'the app (trim and split) µs': time(() => countWords(text)),
    'JavaScript loop µs': time(() => loop(text)),
    'WebAssembly, counting only µs': time(() => count(0, written)),
    'WebAssembly, with the text handed over µs': time(() => viaWasm(text)),
  }));
}
