// launch: --ai real --ai-idle 1.2
// gateway: tests/ui/support/fake-gateway.mjs
// The shell's AI client and its settings (design spec 7, 7.1 and 8; plan: Review Focus 5),
// against a stand-in for the gateway that answers as each request asks: well, badly, slowly
// or not at all. No request leaves this Mac, and no real key is used: the run is given the
// stand-in's address and a key the stand-in knows, and the client refuses any other address.
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
    (error) => (error.canceled ? 'called off' : error.message),
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
const OFF_LIMITS = 'A scripted run asks only a service on this Mac.';
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
    ['environment', '/v1/chat/completions', 'glm-5.3', true, 64, 'low', null, ['system', 'user']],
    'the request is a streamed chat completion, with the key from the environment and the default model',
  );
  t.equal([sent.style, sent.otherKey, sent.version, sent.system], ['openai', false, null, null], 'with nothing of the other way of speaking in it: no second key, no version, the system prompt among the messages');
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
  // Found in review: an answer holding one of the characters some programs put between lines
  // lost the whole piece they were in, without a word.
  const { pieces, outcome } = ask('separators');
  t.equal([await outcome, pieces.join('')], ['done', 'one\u2028two\u2029three\u0085four\n'], 'line and paragraph separators inside the text are text, and arrive');
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
// The page is told which failure is an answer that ran out of room: the Lab uses what came.
{
  const room = await ask('length').request.done.catch((error) => error);
  const lost = await ask('cut').request.done.catch((error) => error);
  t.equal([room.cutShort, lost.cutShort], [true, false], 'the page is told when an answer ran out of room, and only then');
}
// (In "quoted" and in 401 the gateway's own words had the key in them. It is never passed on.)
{
  const { pieces, outcome, took } = ask('stall');
  t.equal(await outcome, 'The AI took too long to answer.', 'a stream that stops is given up on');
  t.assert(took() > 1000 && took() < 5000, `after the wait this run was given (1.2 s, a minute in the app): ${Math.round(took())} ms`);
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

// The stand-in listens at a second address, and answers under any path that ends as a chat
// completion does. To the app that is another service, with an address, a key and a model of
// its own.
const { host, second } = await seen();
const home = `http://${host}`; // the stand-in, as the app reaches it
const elsewhere = `http://127.0.0.1:${second}`;
const usual = { WRITEON_BASE_URL: `${home}/v1`, WRITEON_API_KEY: 'fake-key-from-the-environment' }; // what this run was started with
{
  const s = await settings();
  t.equal(s.keyNote, 'Using the key from the app’s environment.', 'Settings says where the key comes from');
  t.equal([s.addressHint, s.modelHint], [`${home}/v1`, 'glm-5.3'], 'and, in its empty fields, which address and model are in force');
}
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
  t.equal((await seen()).model, 'glm-5.3', 'and the usual one when the field is emptied');
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
  t.assert(/^Connected: glm-5\.3 answered in \d+(\.\d)? s, with the key from the app’s environment\.$/.test(s.testNote), `a connection that works: ${s.testNote}`);
  await settings({ address: 'http://127.0.0.1:9/v1' });
  t.equal((await settings({ test: true })).testNote, 'Could not reach the AI service. Check the network, and the address in Settings (⌘,).', 'and one that does not');
  await settings({ address: '' });
}

// --- another service ------------------------------------------------------------------------------

{
  await settings({ address: `${elsewhere}/openai/v1/`, model: 'their-model', key: 'fake-key-saved-in-settings' });
  const sent = await seen();
  t.equal(
    [sent.port, sent.path, sent.model, sent.key],
    [second, '/openai/v1/chat/completions', 'their-model', 'saved'],
    'Settings sends requests to another service: its address, its model, and the key saved for it',
  );
  const s = await settings({ test: true });
  t.assert(/^Connected: their-model answered in \d+(\.\d)? s, with the key saved here\.$/.test(s.testNote), `and Test connection tries them together: ${s.testNote}`);
  await settings({ address: `${elsewhere}/openai/v1/chat/completions` });
  t.equal((await seen()).path, '/openai/v1/chat/completions', 'an address that is the whole of it already is used as it stands');
  await settings({ address: `${elsewhere}/openai/v1/chat/completions/` });
  t.equal((await seen()).path, '/openai/v1/chat/completions', 'with or without a slash after it');
  // An address that is the whole of where the other way's requests go, with this way chosen.
  await settings({ address: `${elsewhere}/openai/v1/messages`, format: 'openai' });
  t.equal((await seen()).path, '/openai/v1/chat/completions', 'an address that ends as the other way’s requests do is asked this way’s way, where Settings says so');
  await settings({ format: 'auto' });
  await settings({ address: '', model: '', forget: true });
}
// The environment can name all three. The app's own names come first; LunaRoute's, which are
// older, are still read.
{
  const named = await settings({ environment: { ...usual, WRITEON_MODEL: 'model-from-the-environment' } });
  t.equal((await seen()).model, 'model-from-the-environment', 'the environment can name the model');
  t.equal(named.modelHint, 'model-from-the-environment', 'and Settings shows it where its own field is empty');
  await settings({ model: 'another-model' });
  t.equal((await seen()).model, 'another-model', 'and Settings comes before it');
  await settings({ model: '' });
  const older = { LUNAROUTE_BASE_URL: `${elsewhere}/v1`, LUNAROUTE_API_KEY: 'fake-key-under-the-older-name' };
  await settings({ environment: older });
  let sent = await seen();
  t.equal([sent.port, sent.key, sent.model], [second, 'older', 'glm-5.3'], 'the older names for the address and the key are still read');
  await settings({ environment: { ...older, ...usual } });
  sent = await seen();
  t.equal([sent.host, sent.key], [host, 'environment'], 'and the app’s own names come before them');

  // A key under LunaRoute's name is LunaRoute's. Where LunaRoute is said to be, it comes before
  // the app's own; and no other service is sent it.
  await settings({ environment: { ...older, WRITEON_API_KEY: 'fake-key-from-the-environment' } });
  t.equal((await seen()).key, 'older', 'where LunaRoute is said to be, its own key comes first');
  const kept = await settings({ environment: { LUNAROUTE_API_KEY: 'fake-key-under-the-older-name' }, address: `${elsewhere}/v1`, picture: 'kept' });
  t.equal((await seen()).key, 'none', 'a key under LunaRoute’s name is not sent to another service');
  t.equal(kept.keyNote, 'The key in LUNAROUTE_API_KEY is LunaRoute’s, and is not sent to this address. Paste one here, or set WRITEON_API_KEY.', 'and Settings says so');
  await settings({ address: '', environment: usual });
}
// The login shell is asked for the same names. A profile that makes an unset variable an error
// (nounset) must not cost the person the ones that are set. Here the shell reads no profile and
// is given a made-up environment, so nothing of the person's is in it.
for (const [shell, started] of [['/bin/zsh', ['-f', '-o', 'nounset']], ['/bin/bash', ['--noprofile', '--norc', '-u']]]) {
  const { has } = await t.call('test.askShell', { shell, started, environment: { LUNAROUTE_API_KEY: 'a-made-up-key', WRITEON_MODEL: 'a-made-up-model' } });
  t.equal(has, ['LUNAROUTE_API_KEY', 'WRITEON_MODEL'], `${shell} with nounset on still gives up what is set`);
}

// --- a service that wants no key --------------------------------------------------------------------

{
  const s = await settings({ environment: { WRITEON_BASE_URL: `${home}/v1` } }); // an address, and no key anywhere
  t.equal(s.keyNote, 'No key yet. Paste one here, or set WRITEON_API_KEY.', 'with an address and no key, Settings says there is none');
  t.equal((await seen()).key, 'none', 'and a service named in place of the usual one is asked without one');
  const note = (await settings({ test: true })).testNote;
  t.assert(/^Connected: glm-5\.3 answered in \d+(\.\d)? s, with no key\.$/.test(note), `which the test says: ${note}`);
  const { outcome } = ask('401');
  t.equal(await outcome, 'This service wants a key (401). Add one in Settings (⌘,).', 'if it wants one after all, the line says so');
  await settings({ environment: usual });
}

// --- a service that is particular -------------------------------------------------------------------

// OpenAI's own service refuses parts of a request that others take: a model that reasons wants
// the room for its answer under a newer name, and one that does not will not be told how hard
// to think. The stand-in does the same under /strict. The app asks again in the service's way,
// and from then on asks that way first.
{
  await settings({ address: `${home}/strict/v1`, model: 'easy-1' });
  let count = (await seen()).asked;
  // What the stand-in saw in the end, and how many times it was asked on the way there.
  const again = async (extra) => {
    const sent = await seen(extra);
    const took = sent.asked - count;
    count = sent.asked;
    return { took, ...sent };
  };
  let sent = await again();
  t.equal([sent.took, sent.max_tokens, sent.max_completion_tokens, sent.reasoning_effort], [1, 64, null, 'low'], 'a model that takes the request as it is gets it as it is');

  await settings({ model: 'reasoner-1' });
  sent = await again();
  t.equal([sent.took, sent.max_tokens, sent.max_completion_tokens, sent.reasoning_effort], [2, null, 64, 'low'], 'a model that wants the room under the newer name is asked again with it');
  sent = await again();
  t.equal([sent.took, sent.max_completion_tokens], [1, 64], 'and is asked that way first from then on');

  await settings({ model: 'plain-1' });
  sent = await again();
  t.equal([sent.took, sent.max_tokens, sent.max_completion_tokens, sent.reasoning_effort], [2, 64, null, null], 'a model that does not reason is asked again without being told how hard to');
  sent = await again();
  t.equal([sent.took, sent.reasoning_effort], [1, null], 'and that is remembered too');
  await settings({ model: 'reasoner-1' });
  sent = await again();
  t.equal([sent.took, sent.max_completion_tokens, sent.reasoning_effort], [1, 64, 'low'], 'each model’s ways being its own');

  await settings({ model: 'fussy-1' });
  sent = await again();
  t.equal([sent.took, sent.max_tokens, sent.max_completion_tokens, sent.reasoning_effort], [3, null, 64, null], 'one that takes neither, and says so in another shape, is given neither');

  // A refusal that names the room for some other reason is passed on as it came. Nothing is
  // asked twice and nothing is learned from it.
  await settings({ model: 'small-1' });
  count = (await seen({ maxTokens: 8 })).asked;
  const { outcome } = ask('echo');
  t.equal(await outcome, 'The request was refused (400): max_tokens is too large: 64. This model supports at most 16 completion tokens.', 'a refusal for some other reason is passed on as it came');
  sent = await again({ maxTokens: 8 });
  t.equal([sent.took, sent.max_tokens, sent.max_completion_tokens], [2, 8, null], 'having been asked once, and the room is asked for as before');

  // What was learned can stop being true: the same name may come to mean another model.
  await settings({ model: 'turn-1' });
  sent = await again();
  t.equal([sent.took, sent.max_completion_tokens], [2, 64], 'a model’s way is learned');
  sent = await again();
  t.equal([sent.took, sent.max_tokens, sent.max_completion_tokens], [2, 64, null], 'and forgotten when it stops working: the request is asked again as the app words it');
  sent = await again();
  t.equal([sent.took, sent.max_tokens], [1, 64], 'and that way first from then on');

  await settings({ model: 'reasoner-1' });
  const note = (await settings({ test: true })).testNote;
  t.assert(/^Connected: reasoner-1 answered in \d+(\.\d)? s, with the key from the app’s environment\.$/.test(note), `Test connection asks in the same way: ${note}`);
  await settings({ model: 'mute-1' });
  t.equal((await settings({ test: true })).testNote, 'The service answered, but said nothing. Check the model in Settings (⌘,).', 'a test that is answered with nothing has not connected');
  await settings({ address: '', model: '' });
}

// --- room --------------------------------------------------------------------------------------------

// What a model thinks is counted against the room it is given, and it may think more than was
// allowed for. An answer cut off before it has begun is asked for again with twice the room,
// twice at most, and that service is given as much from then on.
{
  let count = (await seen()).asked;
  const again = async (extra) => {
    const sent = await seen(extra);
    const took = sent.asked - count;
    count = sent.asked;
    return { took, ...sent };
  };
  const RAN_OUT = 'The AI ran out of room before it finished its answer. Try again.';
  await settings({ model: 'thinker-1' });
  let sent = await again();
  t.equal([sent.took, sent.max_tokens], [3, 256], 'a model that ran out of room before it said a word is asked again with twice as much, and again');
  sent = await again({ maxTokens: 900 });
  t.equal([sent.took, sent.max_tokens], [1, 900], 'a request with room enough is given what it asked for: nothing is carried over from the last');

  await settings({ model: 'stuck-1' });
  t.equal(await ask('echo').outcome, RAN_OUT, 'a model that never has room enough is given up on');
  await settings({ model: '' });
  sent = await again();
  t.equal(sent.took, 3 + 1, 'after it has been asked three times');
  await settings({ model: 'stuck-1' });
  t.equal(await ask('echo', { maxTokens: 20000 }).outcome, RAN_OUT, 'and is never given more than the most a request may have');
  await settings({ model: '' });
  sent = await again();
  t.equal(sent.took, 2 + 1, 'so it is asked twice where the second asking already has that much');

  // A model may refuse more room than it can give. That is still a model that ran out of
  // room, and is said to be: not a refusal of something the person never asked for.
  await settings({ model: 'capped-1' });
  t.equal(await ask('echo').outcome, RAN_OUT, 'a model that cannot be given more is said to have run out of room');
  await settings({ model: '' });
  sent = await again();
  t.equal(sent.took, 2 + 1, 'having been asked once more and no further');

  await ask('length').outcome;
  sent = await again();
  t.equal(sent.took, 1 + 1, 'an answer cut off after it has begun is not asked for again: what came of it is with the page already');
  t.equal(await ask('wholeCut').outcome, RAN_OUT, 'an answer that came all at once, cut off, is one cut off');
  sent = await again();
  t.equal(sent.took, 3 + 1, 'and with nothing said in it, is asked for again like the other');
}

// --- answers that are not what they seem ---------------------------------------------------------------

{
  t.equal(await ask('wholeError').outcome, 'The AI service had a problem: the upstream model is not available', 'an answer that is an error, though it came as an answer, is an error');
  t.equal(await ask('bare').outcome, 'The AI service had a problem: upstream model overloaded', 'so is an error part-way through that does not say what kind of line it is');
}

// --- where the words go ------------------------------------------------------------------------------

// A request goes to the address the person named. It is not sent on to wherever an answer points.
{
  const before = await seen();
  const { outcome } = ask('moved');
  t.equal(await outcome, 'The address in Settings (⌘,) sends requests on elsewhere (307), and they are not followed.', 'a request is not sent on to where an answer points');
  const after = await seen();
  t.equal([after.asked - before.asked, after.followed], [2, 0], 'so it arrived once, where it was sent, and nowhere else');
}
// Plain http goes no further than this Mac and its own network: beyond that a key would cross
// in the clear. (The addresses here are reserved ones that nobody answers at. The ones that are
// near at hand get as far as this run's own rule, which lets nothing leave this Mac.)
{
  const IN_THE_CLEAR = 'Only an address on this Mac or its own network may be plain http. Use https.';
  for (const address of ['http://writeon.invalid/v1', 'http://192.0.2.1/v1', 'http://172.32.0.1/v1', 'http://[2001:db8::1]/v1', 'http://[::ffff:192.0.2.1]/v1']) {
    await settings({ address });
    t.equal((await seen()).failed, IN_THE_CLEAR, `plain http is refused for ${address}`);
  }
  // A number written some other way than the usual four parts may not be the address it looks like.
  for (const address of ['http://010.1.1.1/v1', 'http://3221225985/v1', 'http://0xc0000201/v1', 'http://10.1/v1']) {
    await settings({ address });
    t.equal((await seen()).failed, IN_THE_CLEAR, `and for ${address}, whatever it may stand for`);
  }
  for (const address of ['http://nowhere.local/v1', 'http://nowhere/v1', 'http://10.255.255.1/v1', 'http://172.31.255.254/v1', 'http://192.168.255.254/v1', 'http://169.254.255.254/v1', 'http://[fd00::1]/v1', 'http://[fe80::1]/v1']) {
    await settings({ address });
    t.equal((await seen()).failed, OFF_LIMITS, `and allowed for ${address}`);
  }
  await settings({ address: '' });
}

// --- nothing beyond this Mac ------------------------------------------------------------------------

// This run has the real client, and the real client asks whatever address it is given. So a
// run that is not a live one is refused every address that is not on this Mac. (Found before
// the repository was published: the Test connection that ends this scenario had lost the
// stand-in's address by then, and went to the usual service's real one with a made-up key.)
{
  await settings({ address: 'https://writeon.invalid/v1', key: 'fake-key-saved-in-settings' });
  t.equal((await seen()).failed, OFF_LIMITS, 'a scripted run is not let out to an address elsewhere');
  await settings({ address: '', environment: { WRITEON_API_KEY: 'fake-key-from-the-environment' } }); // no address: the usual service, and two keys to send it
  t.equal((await seen()).failed, OFF_LIMITS, 'nor to the usual service');
  t.equal((await settings({ test: true })).testNote, OFF_LIMITS, 'by a request or by the test');
  await settings({ forget: true, environment: usual });
}

// With no key anywhere, the one line says where to put one.
{
  const s = await settings({ environment: {} });
  t.equal(s.keyNote, 'No key yet. Paste one here, or set WRITEON_API_KEY.', 'Settings says there is no key');
  t.equal([s.addressHint, s.modelHint], ['https://gw.lunaroute.com/v1', 'glm-5.3'], 'and shows the usual service and model');
  const { outcome } = ask('stream');
  t.equal(await outcome, 'No API key — add one in Settings (⌘,)', 'and so does the request');
  t.equal((await settings({ test: true })).testNote, 'No API key — add one in Settings (⌘,)', 'and the test');
}

// --- the list of models ---------------------------------------------------------------------------

// The model field is a list as well: what the service in force says it has, asked for with the
// same key and way of speaking as a request. Only a model that can answer this app is listed:
// one that chats the way in use and keeps to a schema. Where a service says what its models
// can do, a model it says nothing of is left out: it may not chat at all. Where it says that
// of none, all of them are listed. With no key, or no answer, there is no list.
{
  const s = await settings({ environment: usual });
  t.equal(s.models, ['glm-5.3-flash', 'muse-spark-open', 'Zeta-1'], 'Settings lists the models that can answer the app, by name');
  t.equal((await settings({ format: 'anthropic' })).models, ['anthropic-only', 'glm-5.3-flash', 'muse-spark-open', 'Zeta-1'], 'and, spoken to Anthropic’s way, those that speak it');
  await settings({ format: 'auto' });
  const picked = await settings({ pick: 'Zeta-1' });
  t.equal(picked.model, 'Zeta-1', 'a model picked from the list goes in the field');
  t.equal((await seen()).model, 'Zeta-1', 'and is the one asked for');
  await settings({ model: '' });
  t.equal((await settings({ address: `${home}/plain/v1` })).models, ['Alpha', 'beta'], 'a service that says only the names of its models has all of them listed');
  // LunaRoute, asked Anthropic's way, lists its models in Anthropic's shape. That shape says
  // which models speak Anthropic's way, and nothing of a schema.
  t.equal((await settings({ format: 'anthropic', address: `${home}/luna/v1` })).models, ['anthropic-only', 'glm-5.3-flash', 'muse-spark-open', 'Zeta-1'], 'a list in Anthropic’s shape: the models that speak Anthropic’s way');
  await settings({ format: 'auto', address: '' });
  t.equal((await settings({ address: 'http://127.0.0.1:9/v1' })).models, [], 'nothing answering at the address: no list');
  await settings({ address: '' });
  t.equal((await settings({ environment: { WRITEON_BASE_URL: `${home}/v1` } })).models, [], 'and none without a key');
  await settings({ environment: usual });
}

// --- sound ----------------------------------------------------------------------------------------

t.equal([(await settings()).sound, ui.get('sound')], [false, false], 'a scripted run starts silent, and Settings shows it');
t.equal((await settings({ sound: true })).sound, true, 'the box in Settings');
await t.until(() => ui.get('sound') === true, 1500, 'turns the sound on in an open window');
await settings({ sound: false });
await t.until(() => ui.get('sound') === false, 1500, 'and off again');
// A picture of the window, as it stands with a key saved and a test just made.
await settings({ environment: usual, key: 'fake-key-saved-in-settings', model: 'another-model' });
await settings({ model: '', test: true, picture: 'settings' });
t.equal((await settings()).shown, false, 'and all of it without a window on the screen');
