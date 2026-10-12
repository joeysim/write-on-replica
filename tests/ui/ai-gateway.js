// launch: --ai real --ai-idle 1.2
// gateway: tests/ui/support/fake-gateway.mjs
// The shell's AI client and its settings (design spec 7, 7.1 and 8; plan: Review Focus 5),
// against a stand-in for the gateway that answers as each request asks: well, badly, slowly
// or not at all. No request leaves this Mac, and no real key is used: the run is given the
// stand-in's address and a key the stand-in knows.
const { ai, ui } = window.writeOn;
await document.fonts.ready;

const ask = (name, extra = {}) => {
  const pieces = [];
  const began = performance.now();
  const request = ai.start(
    { messages: [{ role: 'system', content: 'A test.' }, { role: 'user', content: `[[case: ${name}]]` }], maxTokens: 64, effort: 'low', ...extra },
    (text) => pieces.push(text),
  );
  const outcome = request.done.then(
    () => 'done',
    (error) => (error.cancelled ? 'called off' : error.message),
  );
  return { pieces, request, outcome, took: () => performance.now() - began };
};
// What the stand-in saw of a request.
const seen = async (extra) => {
  const { pieces, outcome } = ask('echo', extra);
  const how = await outcome;
  return how === 'done' ? JSON.parse(pieces.join('')) : { failed: how };
};
const settings = (change = {}) => t.call('test.settings', change);
const sorted = (value) =>
  JSON.stringify(value, (_, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));

// --- an answer ------------------------------------------------------------------------------------

{
  const { pieces, outcome } = ask('stream');
  t.equal(await outcome, 'done', 'an answer arrives');
  t.equal(pieces.join(''), 'first idea\nsecond idea\nthird idea\n', 'whole, however the network cut it up');
  t.equal(pieces, ['first idea\n', 'second ', 'idea\n', 'third idea\n'], 'in the pieces the model sent');
}
{
  const sent = await seen();
  t.equal(
    [sent.key, sent.path, sent.model, sent.stream, sent.max_tokens, sent.reasoning_effort, sent.response_format, sent.messages],
    ['environment', '/v1/chat/completions', 'glm-5.3-flash', true, 64, 'low', null, ['system', 'user']],
    'the request is a streamed chat completion, with the key from the environment and the default model',
  );
}
{
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
  const sent = await seen({ schema, effort: 'medium', maxTokens: 900 });
  t.equal([sent.reasoning_effort, sent.max_tokens], ['medium', 900], 'a request says how hard to think and how much may come back');
  t.equal(sorted(sent.response_format), sorted({ type: 'json_schema', json_schema: { name: 'answer', strict: true, schema } }), 'and, for a Lab pass, the shape the answer must have');
}
{
  const { pieces, outcome } = ask('thinking');
  t.equal([await outcome, pieces], ['done', ['said']], 'what the model thinks on the way is not the answer');
}
{
  const { pieces, outcome } = ask('empty');
  t.equal([await outcome, pieces], ['done', []], 'an answer with nothing in it is still an answer (the page decides what to make of it)');
}
{
  const { pieces, outcome } = ask('whole');
  t.equal([await outcome, pieces], ['done', ['all at once']], 'a gateway that answers all at once is read too');
}

// --- when it goes wrong: one line a person can read -----------------------------------------------

for (const [name, message] of [
  ['401', 'The key was not accepted (401). Check it in Settings (⌘,).'],
  ['403', 'The key was not accepted (403). Check it in Settings (⌘,).'],
  ['429', 'Too many requests, or out of quota (429). Try again in a moment.'],
  ['500', 'The AI service had a problem (500). Try again in a moment.'],
  ['503', 'The AI service had a problem (503). Try again in a moment.'],
  ['400', 'The request was refused (400): The model `nope` does not exist.'],
  ['midway', 'The AI service had a problem: upstream model overloaded'],
  ['cut', 'The connection was lost before the answer was complete.'],
  ['length', 'The AI ran out of room before it finished its answer. Try again.'],
  ['quoted', 'The request was refused (400): No route for key (the key) on this plan.'],
]) {
  const { outcome } = ask(name);
  t.equal(await outcome, message, `case ${name}`);
}
// (In "quoted" and in 401 the gateway's own words had the key in them. It is never passed on.)
{
  const { pieces, outcome, took } = ask('stall');
  t.equal(await outcome, 'The AI took too long to answer.', 'a stream that stops is given up on');
  t.assert(took() > 1000 && took() < 5000, `after the wait this run was given (1.2 s, 20 s in the app): ${Math.round(took())} ms`);
  t.equal(pieces, ['a start\n'], 'what had come by then came');
}

// --- calling it off -------------------------------------------------------------------------------

{
  const before = (await seen()).dropped;
  const { pieces, request, outcome } = ask('slow');
  await t.until(() => pieces.length >= 2, 3000, 'two pieces of a slow answer');
  request.cancel();
  t.equal(await outcome, 'called off', 'a request can be called off');
  const had = pieces.length;
  await t.wait(600);
  t.equal(pieces.length, had, 'and nothing more of it arrives');
  t.equal((await seen()).dropped - before, 1, 'the gateway is hung up on, not left talking');
}

// --- which key, which model, which address --------------------------------------------------------

t.equal((await settings()).keyNote, 'Using the key from the app’s environment.', 'Settings says where the key comes from');
{
  const s = await settings({ key: 'fake-key-saved-in-settings' });
  t.equal([s.keyNote, s.keyField], ['Using the key saved here.', ''], 'a key typed into Settings is saved, and not left showing');
  t.equal((await seen()).key, 'saved', 'and comes before the one in the environment');
  t.equal((await settings({ forget: true })).keyNote, 'Using the key from the app’s environment.', 'until it is removed');
  t.equal((await seen()).key, 'environment', 'when the environment’s is used again');
}
{
  const s = await settings({ model: '  another-model ' });
  t.equal(s.model, 'another-model', 'a model named in Settings');
  t.equal((await seen()).model, 'another-model', 'is the one asked for');
  await settings({ model: '' });
  t.equal((await seen()).model, 'glm-5.3-flash', 'and the usual one when the field is emptied');
}
{
  await settings({ address: 'http://127.0.0.1:9/v1' });
  t.equal((await seen()).failed, 'Could not reach the AI service. Check the network, and the address in Settings (⌘,).', 'an address nothing answers at');
  await settings({ address: 'not an address' });
  t.equal((await seen()).failed, 'The address in Settings (⌘,) is not a web address.', 'an address that is not one');
  const s = await settings({ address: '' });
  t.equal(s.address, '', 'the field emptied');
  t.equal((await seen()).key, 'environment', 'goes back to the address the environment gives');
}

// Test connection asks a real, very short question, and says how it went.
{
  const s = await settings({ test: true });
  t.assert(/^Connected: glm-5\.3-flash answered in \d+(\.\d)? s, with the key from the app’s environment\.$/.test(s.testNote), `a connection that works: ${s.testNote}`);
  await settings({ address: 'http://127.0.0.1:9/v1' });
  t.equal((await settings({ test: true })).testNote, 'Could not reach the AI service. Check the network, and the address in Settings (⌘,).', 'and one that does not');
  await settings({ address: '' });
}

// With no key anywhere, the one line says where to put one.
{
  const s = await settings({ environment: {} });
  t.equal(s.keyNote, 'No key yet. Paste one here, or set LUNAROUTE_API_KEY.', 'Settings says there is no key');
  const { outcome } = ask('stream');
  t.equal(await outcome, 'No LunaRoute key — add one in Settings (⌘,)', 'and so does the request');
  t.equal((await settings({ test: true })).testNote, 'No LunaRoute key — add one in Settings (⌘,)', 'and the test');
}

// --- sound ----------------------------------------------------------------------------------------

t.equal([(await settings()).sound, ui.get('sound')], [false, false], 'a scripted run starts silent, and Settings shows it');
t.equal((await settings({ sound: true })).sound, true, 'the box in Settings');
await t.until(() => ui.get('sound') === true, 1500, 'turns the sound on in an open window');
await settings({ sound: false });
await t.until(() => ui.get('sound') === false, 1500, 'and off again');
// A picture of the window, as it stands with a key saved and a test just made.
await settings({ environment: { LUNAROUTE_API_KEY: 'fake-key-from-the-environment' }, key: 'fake-key-saved-in-settings', model: 'another-model' });
await settings({ model: '', test: true, picture: 'settings' });
t.equal((await settings()).shown, false, 'and all of it without a window on the screen');
