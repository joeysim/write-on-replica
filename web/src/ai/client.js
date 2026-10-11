// The page's side of an AI request. The shell does the asking (it holds the key); the page
// starts a request over the bridge and receives the answer as events, a piece at a time:
//
//   page  -> shell   ai.start  { id, messages, maxTokens, effort, schema? }
//   shell -> page    ai.delta  { id, text }      as the answer streams
//                    ai.done   { id }
//                    ai.error  { id, message }   one line a person can read
//   page  -> shell   ai.cancel { id }

export function createAIClient(native) {
  const live = new Map(); // id -> { onText, resolve, reject }
  let serial = 0;

  const settle = (id, how) => {
    const request = live.get(id);
    if (!request) return;
    live.delete(id);
    how(request);
  };
  native.on('ai.delta', ({ id, text }) => live.get(id)?.onText(text));
  native.on('ai.done', ({ id }) => settle(id, (request) => request.resolve()));
  native.on('ai.error', ({ id, message }) => settle(id, (request) => request.reject(new Error(message))));

  return {
    /**
     * Starts a request. `onText` is called with each piece of the answer as it comes.
     * @returns {{ done: Promise<void>, cancel: () => void }} `done` rejects with a reason
     *   to show, or with an error whose `cancelled` is true if the request was called off
     */
    start(request, onText) {
      serial += 1;
      const id = `ai${serial}`;
      const done = new Promise((resolve, reject) => live.set(id, { onText, resolve, reject }));
      native.call('ai.start', { id, ...request }).catch((error) => settle(id, (r) => r.reject(error)));
      return {
        done,
        cancel() {
          settle(id, (r) => r.reject(Object.assign(new Error('cancelled'), { cancelled: true })));
          native.call('ai.cancel', { id }).catch(() => {});
        },
      };
    },
  };
}
