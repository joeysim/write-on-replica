// Which tick plays when the showing variant changes.
//
// A tick is low when the writer lands back on the variant they were on when they began
// playing, and high otherwise. "Began playing" is a session:
//
//   - hovering: a session begins at the first change and ends after a pause (idleMs) or
//     when the pointer leaves, so each burst of arrow presses has its own home;
//   - the panel: a session begins when the panel targets the group and lasts until it
//     closes or moves on (idleMs: Infinity).
//
// Variants are named by any key that can be compared with ===; callers use their text.

export class ToneSession {
  #idleMs;
  #home = null;
  #active = false;
  #lastChange = 0;

  constructor({ idleMs = 1750 } = {}) {
    this.#idleMs = idleMs;
  }

  /** The variant this session counts as home, or null when no session is running. */
  get home() {
    return this.#active ? this.#home : null;
  }

  /** Starts a session whose home is `home`. */
  begin(home, now = Date.now()) {
    this.#home = home;
    this.#active = true;
    this.#lastChange = now;
  }

  /**
   * Records that the showing variant went from `from` to `to`.
   * @returns {'high' | 'low'}
   */
  change(from, to, now = Date.now()) {
    if (!this.#active || now - this.#lastChange > this.#idleMs) this.begin(from, now);
    this.#lastChange = now;
    return to === this.#home ? 'low' : 'high';
  }

  /** The home variant's text was edited; it is still home. */
  rename(from, to) {
    if (this.#active && this.#home === from) this.#home = to;
  }

  end() {
    this.#active = false;
    this.#home = null;
  }
}
