// launch: --ai real
// A scripted run cannot ask the real AI service by accident. It is given the real client here,
// and no stand-in gateway to point it at. The key in the environment of whoever runs the tests
// is then withheld from it (only `--ai live` may use it), so the request stops before it starts.
const { ai } = window.writeOn;

const outcome = await ai.start({ messages: [{ role: 'user', content: 'This must not be sent.' }], maxTokens: 8, effort: 'low' }, () => {}).done.then(
  () => 'sent',
  (error) => error.message,
);
t.equal(outcome, 'No LunaRoute key — add one in Settings (⌘,)', 'with no key to send, nothing is sent');
t.equal((await t.call('test.settings')).keyNote, 'No key yet. Paste one here, or set LUNAROUTE_API_KEY.', 'and Settings knows of none');
