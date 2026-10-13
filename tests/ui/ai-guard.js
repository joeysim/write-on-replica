// launch: --ai real
// A scripted run cannot ask the real AI service by accident. It is given the real client here,
// and no stand-in gateway to point it at. The key in the environment of whoever runs the tests
// is then withheld from it (only `--ai live` may use it), so the request stops before it starts.
// And given a key after all, it is still not let out: unless it is live, a run asks nothing
// that is not on this Mac.
const { ai } = window.writeOn;

const ask = () =>
  ai.start({ messages: [{ role: 'user', content: 'This must not be sent.' }], maxTokens: 8, effort: 'low' }, () => {}).done.then(
    () => 'sent',
    (error) => error.message,
  );
t.equal(await ask(), 'No API key — add one in Settings (⌘,)', 'with no key to send, nothing is sent');
t.equal((await t.call('test.settings')).keyNote, 'No key yet. Paste one here, or set WRITEON_API_KEY.', 'and Settings knows of none');

const OFF_LIMITS = 'A scripted run asks only a service on this Mac.';
t.equal((await t.call('test.settings', { key: 'fake-key-saved-in-settings' })).keyNote, 'Using the key saved here.', 'given a key');
t.equal(await ask(), OFF_LIMITS, 'it is still not let out to the usual service');
t.equal((await t.call('test.settings', { test: true })).testNote, OFF_LIMITS, 'by a request or by the test');
await t.call('test.settings', { address: 'https://writeon.invalid/v1' });
t.equal(await ask(), OFF_LIMITS, 'nor to any other address that is not on this Mac');
