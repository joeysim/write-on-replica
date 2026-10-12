// The page's only door to the shell. Inside the app every call goes over the bridge;
// in an ordinary browser a small shim answers instead, so the page can be developed
// without the app.

const handler = globalThis.webkit?.messageHandlers?.writeon;
const listeners = new Map();
const answers = new Map();

const SETTINGS = 'write_on.settings';
const stored = () => {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS)) ?? {};
  } catch {
    return {};
  }
};

const shim = {
  'app.info': () => ({ inApp: false, version: 'browser' }),
  'app.ready': () => null,
  'settings.get': stored,
  'settings.set': (changes) => {
    localStorage.setItem(SETTINGS, JSON.stringify({ ...stored(), ...changes }));
    return null;
  },
  // A stand-in for the AI: a few fixed suggestions, a piece at a time.
  'ai.start': ({ id }) => {
    const pieces = ['first idea\n', 'second ', 'idea\n', 'third idea\n', 'fourth idea\n', 'fifth idea\n'];
    pieces.forEach((text, i) => setTimeout(() => globalThis.__writeon.emit('ai.delta', { id, text }), 150 + i * 90));
    setTimeout(() => globalThis.__writeon.emit('ai.done', { id }), 150 + pieces.length * 90);
    return null;
  },
  'ai.cancel': () => null,
  'clipboard.write': ({ text }) => navigator.clipboard.writeText(text).then(() => null),
  'browser.open': ({ url }) => {
    window.open(url, '_blank', 'noopener');
    return null;
  },
  // A browser has no files of the app's: the page opens on the welcome piece and stays there.
  'doc.start': () => ({ kind: 'welcome' }),
  'doc.state': () => null,
  'draft.write': () => null,
  'file.open': () => null,
  'file.save': () => ({ saved: false }),
  log: ({ level, message }) => {
    (level === 'error' ? console.error : console.log)(message);
    return null;
  },
};

export const native = {
  inApp: Boolean(handler),

  /** Ask the shell to do something. Rejects with an Error carrying the shell's message. */
  async call(method, params = {}) {
    if (handler) {
      try {
        return await handler.postMessage({ method, params });
      } catch (reason) {
        throw reason instanceof Error ? reason : new Error(String(reason));
      }
    }
    const answer = shim[method];
    if (!answer) throw new Error(`unknown bridge method: ${method}`);
    return answer(params);
  },

  /** Listen for an event pushed by the shell. Returns a function that stops listening. */
  on(event, listener) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(listener);
    return () => listeners.get(event)?.delete(listener);
  },

  /** Says how to answer a question the shell may ask (`Bridge.ask` there). */
  answer(question, reply) {
    answers.set(question, reply);
  },

  /** Lets the browser shim answer more methods (used by features as they arrive). */
  provide(method, answer) {
    shim[method] = answer;
  },
};

globalThis.__writeon = {
  emit(event, payload) {
    for (const listener of listeners.get(event) ?? []) listener(payload);
  },
  async answer(question, params) {
    const reply = answers.get(question);
    if (!reply) throw new Error(`the page has no answer for: ${question}`);
    return (await reply(params ?? {})) ?? null;
  },
};
