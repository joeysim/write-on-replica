// Undo and redo over whole-document snapshots.
//
// Before making a change the editor records the state as it stands. Changes of the same
// kind made in quick succession (typing) share one step: only the state before the first
// of them is kept.

const BURST_MS = 700;

export class History {
  #limit;
  #undo = [];
  #redo = [];
  #lastKey = null;
  #lastTime = 0;

  constructor(limit = 500) {
    this.#limit = limit;
  }

  get canUndo() {
    return this.#undo.length > 0;
  }

  get canRedo() {
    return this.#redo.length > 0;
  }

  /**
   * Call with the current state just before changing it.
   * @param state      an immutable snapshot
   * @param coalesceKey changes with the same key within 700 ms of each other are one step
   * @param meta       describes the change; handed back when it is undone or redone
   */
  record(state, { coalesceKey = null, now = Date.now(), meta = null } = {}) {
    const continues = coalesceKey !== null && coalesceKey === this.#lastKey && now - this.#lastTime < BURST_MS;
    this.#lastKey = coalesceKey;
    this.#lastTime = now;
    this.#redo.length = 0;
    if (continues) return;
    this.#undo.push({ state, meta });
    if (this.#undo.length > this.#limit) this.#undo.shift();
  }

  /**
   * @param current the state now, kept so the change can be redone
   * @returns {{state, meta} | null} the state to go back to
   */
  undo(current) {
    const entry = this.#undo.pop();
    if (!entry) return null;
    this.#redo.push({ state: current, meta: entry.meta });
    this.#lastKey = null;
    return entry;
  }

  redo(current) {
    const entry = this.#redo.pop();
    if (!entry) return null;
    this.#undo.push({ state: current, meta: entry.meta });
    this.#lastKey = null;
    return entry;
  }

  /**
   * Forgets the latest step if `match(meta)` says it is the one meant. For a step that was
   * only ever the interface's and came to nothing, so that it never has to be undone.
   * @returns {boolean} whether a step was dropped
   */
  dropLast(match) {
    const last = this.#undo[this.#undo.length - 1];
    if (!last || !match(last.meta)) return false;
    this.#undo.pop();
    this.#lastKey = null;
    return true;
  }

  /**
   * Forgets every step `match(meta)` picks out, whether it is waiting to be undone or
   * redone. Only for steps that changed nothing in the document (see the editor's `mark`):
   * the steps around such a one do not depend on it.
   */
  dropAll(match) {
    this.#undo = this.#undo.filter((entry) => !match(entry.meta));
    this.#redo = this.#redo.filter((entry) => !match(entry.meta));
  }

  clear() {
    this.#undo.length = 0;
    this.#redo.length = 0;
    this.#lastKey = null;
  }
}
