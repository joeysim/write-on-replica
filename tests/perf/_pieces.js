// Documents of a given size for the measurements in this folder. Appended to the harness by
// scripts/bench.sh, so a scenario has `pieces` in scope beside `t`.
window.__pieces = (() => {
  const WORDS = ['draft', 'margin', 'sentence', 'because', 'quiet', 'between', 'the', 'a', 'of', 'writes', 'again', 'slowly', 'and', 'paper', 'over', 'window'];

  /**
   * A piece of about `words` words: a heading, then paragraphs of 80 words with a blank
   * line between, one paragraph in five with a word that has two alternatives.
   * @returns {{ state, paragraphs, groups }} `state` is what editor.setState takes
   */
  function make(words) {
    const count = Math.max(1, Math.round(words / 80));
    const groups = {};
    const lines = [];
    for (let p = 0; p < count; p++) {
      const picked = Array.from({ length: 80 }, (_, w) => WORDS[(p * 7 + w * 13 + ((p * w) % 5)) % WORDS.length]);
      let line = `${picked.join(' ')}.`;
      if (p % 5 === 0) {
        const vid = `g${p.toString(36).padStart(6, '0')}`;
        groups[vid] = { scope: 'word', variants: [picked[0], 'other', 'third'], active: 0 };
        line = `<span data-vid="${vid}">${picked[0]}</span>${line.slice(picked[0].length)}`;
      }
      lines.push(line);
    }
    const html = `<p># A piece of ${count * 80} words</p><p><br></p>${lines.map((line) => `<p>${line}</p><p><br></p>`).join('')}`;
    return { state: { html, groups, overflow: 'Kept aside.' }, paragraphs: count, groups: Object.keys(groups).length };
  }

  const sorted = (values) => [...values].sort((a, b) => a - b);
  /** Median, 95th centile, and the two ends of a list of numbers, to two decimals. */
  function spread(values) {
    const s = sorted(values);
    const at = (q) => s[Math.min(s.length - 1, Math.floor(q * s.length))];
    const round = (v) => Math.round(v * 100) / 100;
    return { n: s.length, min: round(s[0]), median: round(at(0.5)), p95: round(at(0.95)), max: round(s[s.length - 1]) };
  }

  /**
   * Times what follows each event of `type` (keydown, mousemove), asking nothing of WebKit:
   * `start` is from the event to the animation frame in which the page next draws, `done`
   * to the end of that frame's work here: layout and painting finished and handed on.
   * The clock ticks once a millisecond. Call the returned function for the two spreads.
   */
  function follow(type) {
    const start = [];
    const done = [];
    let from = 0;
    const channel = new MessageChannel();
    channel.port1.onmessage = () => done.push(performance.now() - from);
    const hear = () => {
      from = performance.now();
      requestAnimationFrame(() => {
        start.push(performance.now() - from);
        channel.port2.postMessage(0);
      });
    };
    window.addEventListener(type, hear, true);
    return () => {
      window.removeEventListener(type, hear, true);
      channel.port1.close();
      return { start: spread(start), done: spread(done) };
    };
  }

  return { make, spread, follow };
})();
