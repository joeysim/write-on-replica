// launch: --ai real --ai-idle 1.2
// gateway: tests/ui/support/fake-gateway.mjs
// The shell's AI client speaking Anthropic's way (design spec 7.1): the Messages API, where
// ai-gateway.js covers OpenAI's chat completions and all that the two share (which key, which
// address, what a scripted run may reach). The stand-in answers in whichever way it is asked,
// and as Anthropic's own service does it refuses a request with no version header, no
// max_tokens or a system message among the messages. No request leaves this Mac.
const { ai } = window.writeOn;
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
const sorted = (value) =>
  JSON.stringify(value, (_, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));
const OFF_LIMITS = 'A scripted run asks only a service on this Mac.';

// --- which way a service is spoken to ----------------------------------------------------------------

const { host, second } = await seen();
const home = `http://${host}`; // the stand-in, as the app reaches it
const usual = { WRITEON_BASE_URL: `${home}/v1`, WRITEON_API_KEY: 'fake-key-from-the-environment' }; // what this run was started with
{
  let s = await settings();
  t.equal([s.format, s.formatHint], ['auto', 'Automatic: OpenAI-style'], 'left to itself, the app takes an address that says nothing of it to speak OpenAI’s way');
  t.equal((await seen()).style, 'openai', 'and speaks it');

  s = await settings({ format: 'anthropic' });
  t.equal(s.format, 'anthropic', 'Anthropic’s way, chosen in Settings');
  let sent = await seen();
  t.equal([sent.style, sent.path], ['anthropic', '/v1/messages'], 'is spoken, to where requests made that way go');
  s = await settings({ format: 'openai' });
  t.equal([(await seen()).style, s.format], ['openai', 'openai'], 'and OpenAI’s can be chosen as plainly');

  // The address may say which: by ending as one kind of request or the other, or by being Anthropic's own.
  s = await settings({ format: 'auto', address: `${home}/v1/messages` });
  sent = await seen();
  t.equal([s.formatHint, sent.style, sent.path], ['Automatic: Anthropic-style', 'anthropic', '/v1/messages'], 'an address that ends as Anthropic’s requests do is spoken to Anthropic’s way');
  s = await settings({ address: `${home}/v1/chat/completions` });
  t.equal([s.formatHint, (await seen()).style], ['Automatic: OpenAI-style', 'openai'], 'and one that ends as OpenAI’s do, OpenAI’s way');
  for (const address of ['https://api.anthropic.com', 'https://api.anthropic.com/v1', 'https://API.Anthropic.com/v1/']) {
    s = await settings({ address });
    t.equal([s.formatHint, (await seen()).failed], ['Automatic: Anthropic-style', OFF_LIMITS], `Anthropic’s own address is taken to speak Anthropic’s way: ${address}`);
  }
  s = await settings({ address: 'https://api.openai.com/v1' });
  t.equal(s.formatHint, 'Automatic: OpenAI-style', 'and any other, OpenAI’s');
  s = await settings({ address: 'https://not-anthropic.com.example/v1' });
  t.equal(s.formatHint, 'Automatic: OpenAI-style', 'a name that only looks like Anthropic’s included');

  // The environment can say which, as it can name the rest. Settings comes before it.
  s = await settings({ address: '', environment: { ...usual, WRITEON_API_FORMAT: 'anthropic' } });
  t.equal([s.format, s.formatHint, (await seen()).style], ['auto', 'Automatic: Anthropic-style', 'anthropic'], 'the environment can say which way');
  await settings({ format: 'openai' });
  t.equal((await seen()).style, 'openai', 'and Settings comes before it');
  s = await settings({ format: 'auto', environment: { ...usual, WRITEON_API_FORMAT: 'something else' } });
  t.equal([s.formatHint, (await seen()).style], ['Automatic: OpenAI-style', 'openai'], 'a way the app has not heard of is no way at all');
  await settings({ format: 'anthropic', environment: usual });
}

// --- the request ---------------------------------------------------------------------------------------

{
  const sent = await seen();
  t.equal(
    [sent.key, sent.otherKey, sent.version, sent.path, sent.model, sent.stream, sent.max_tokens, sent.effort, sent.format, sent.system, sent.messages],
    ['environment', false, '2023-06-01', '/v1/messages', 'muse-spark-open', true, 64, 'low', null, 'A test.', ['user']],
    'the request is a streamed message: the key in its own header and no other, the version, the system prompt apart from the messages',
  );
  t.equal([sent.reasoning_effort, sent.response_format, sent.max_completion_tokens], [null, null, null], 'with nothing of the other way’s wording in it');
}
{
  // A Lab pass: the shape of the answer goes as a schema for the service to hold the answer to,
  // and again in words, for a service that takes no notice of the schema.
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
  const sent = await seen({ schema, effort: 'medium', maxTokens: 900 });
  t.equal([sent.effort, sent.max_tokens], ['medium', 900], 'a request says how hard to think and how much may come back');
  t.equal(sorted(sent.format), sorted({ type: 'json_schema', schema }), 'and, for a Lab pass, the shape the answer must have');
  const inWords = sent.system.slice(sent.system.indexOf('{'));
  t.assert(sent.system.startsWith('A test.\n\n') && /JSON/.test(sent.system), `the shape is asked for in words as well: ${sent.system}`);
  t.equal(sorted(JSON.parse(inWords)), sorted(schema), 'with the schema itself to go by');
}
{
  // Several system messages are one system prompt, and what is said to and by the model stays in order.
  const sent = await seen({
    messages: [
      { role: 'system', content: 'First.' },
      { role: 'user', content: 'A question.' },
      { role: 'assistant', content: 'An answer.' },
      { role: 'system', content: 'Second.' },
      { role: 'user', content: '[[case: echo]]' },
    ],
  });
  t.equal([sent.system, sent.messages], ['First.\n\nSecond.', ['user', 'assistant', 'user']], 'system messages are gathered into the one system prompt');
  const bare = await seen({ messages: [{ role: 'user', content: '[[case: echo]]' }] });
  t.equal([bare.system, bare.messages], [null, ['user']], 'and where there is none, none is sent');
}
{
  // To LunaRoute the effort is also given under the name LunaRoute takes it by: its endpoint
  // for this way of speaking takes no notice of Anthropic's own (tried on 13 October 2026).
  await settings({ environment: { LUNAROUTE_BASE_URL: `${home}/v1`, LUNAROUTE_API_KEY: 'fake-key-under-the-older-name' } });
  const sent = await seen();
  t.equal([sent.style, sent.key, sent.effort, sent.reasoning_effort], ['anthropic', 'older', 'low', 'low'], 'to LunaRoute the effort goes under both names');
  await settings({ environment: usual });
}

// --- an answer ---------------------------------------------------------------------------------------

{
  const { pieces, outcome } = ask('stream');
  t.equal(await outcome, 'done', 'an answer arrives');
  t.equal(pieces, ['first idea\n', 'second ', 'idea\n', 'third idea\n'], 'whole, in the pieces the model sent, however the network cut it up');
}
{
  const { pieces, outcome } = ask('thinking');
  t.equal([await outcome, pieces], ['done', ['said']], 'what the model thinks is not the answer, nor is a ping, nor an event of a kind not heard of');
}
{
  const { pieces, outcome } = ask('separators');
  t.equal([await outcome, pieces.join('')], ['done', 'one two three\u0085four\n'], 'line and paragraph separators inside the text are text, and arrive');
}
{
  const { pieces, outcome } = ask('empty');
  t.equal([await outcome, pieces], ['done', []], 'an answer with nothing in it is still an answer');
}
{
  const { pieces, outcome } = ask('whole');
  t.equal([await outcome, pieces], ['done', ['all at once']], 'a service that answers all at once is read too, its thinking left out');
}

// --- when it goes wrong: the same lines as the other way gives ------------------------------------------

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
  ['moved', 'The address in Settings (⌘,) sends requests on elsewhere (307), and they are not followed.'],
]) {
  const { outcome } = ask(name);
  t.equal(await outcome, message, `case ${name}`);
}
t.equal((await seen()).followed, 0, 'and the request that was told to go elsewhere did not');
{
  const { pieces, outcome, took } = ask('stall');
  t.equal(await outcome, 'The AI took too long to answer.', 'a stream that stops is given up on');
  t.assert(took() > 1000 && took() < 5000, `after the wait this run was given: ${Math.round(took())} ms`);
  t.equal(pieces, ['a start\n'], 'what had come by then came');
}
{
  const before = (await seen()).dropped;
  const { pieces, request, outcome } = ask('slow');
  await t.until(() => pieces.length >= 2, 3000, 'two pieces of a slow answer');
  request.cancel();
  t.equal(await outcome, 'called off', 'a request can be called off');
  const had = pieces.length;
  await t.wait(600);
  t.equal(pieces.length, had, 'and nothing more of it arrives');
  t.equal((await seen()).dropped - before, 1, 'the service is hung up on, not left talking');
}

// --- where the requests go ------------------------------------------------------------------------------

// An address given Anthropic's way stops short of /v1, as its own does; given OpenAI's way it
// has /v1 in it; and it may be the whole of where the requests go. All three are taken.
for (const [address, path] of [
  [`${home}`, '/v1/messages'],
  [`${home}/`, '/v1/messages'],
  [`${home}/v1`, '/v1/messages'],
  [`${home}/v1/`, '/v1/messages'],
  [`${home}/anthropic`, '/anthropic/v1/messages'],
  [`${home}/api/v1`, '/api/v1/messages'],
  [`${home}/v1/messages`, '/v1/messages'],
  [`${home}/v1/messages/`, '/v1/messages'],
  [`${home}/v1/messages//`, '/v1/messages'],
  [`${home}/V1`, '/V1/messages'],
  // The whole of where the other way's requests go, with this way chosen in Settings.
  [`${home}/v1/chat/completions`, '/v1/messages'],
  [`${home}/api/v1/chat/completions/`, '/api/v1/messages'],
]) {
  await settings({ address });
  t.equal((await seen()).path, path, `${address.replace(home, '<address>') || '<address>'} is asked at ${path}`);
}
{
  // Another service, with a key saved for it, and none of the environment's.
  await settings({ address: `http://127.0.0.1:${second}/anthropic`, model: 'claude-of-some-kind', key: 'fake-key-saved-in-settings' });
  const sent = await seen();
  t.equal([sent.port, sent.path, sent.model, sent.key, sent.otherKey], [second, '/anthropic/v1/messages', 'claude-of-some-kind', 'saved', false], 'another service is asked at its own address, for its own model, with the key saved for it');
  const note = (await settings({ test: true })).testNote;
  t.assert(/^Connected: claude-of-some-kind answered in \d+(\.\d)? s, with the key saved here\.$/.test(note), `and Test connection tries them together: ${note}`);
  await settings({ forget: true, environment: { WRITEON_BASE_URL: `${home}/v1` } });
  t.equal((await seen()).key, 'none', 'a service that wants no key is sent none, here as there');
  const { outcome } = ask('401');
  t.equal(await outcome, 'This service wants a key (401). Add one in Settings (⌘,).', 'and the line says so if it wants one after all');
  await settings({ address: '', model: '', environment: usual });
}

// --- a service that is particular ------------------------------------------------------------------------

// Not every model that speaks this way can be told how hard to work, or held to a schema, and
// not every service has heard of either. One that refuses is asked again without, and asked
// that way first from then on. The shape asked for in words stays in the request throughout.
{
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
  await settings({ address: `${home}/strict/v1`, model: 'easy-1' });
  let count = (await seen()).asked;
  const again = async (extra) => {
    const sent = await seen(extra);
    const took = sent.asked - count;
    count = sent.asked;
    return { took, ...sent };
  };
  let sent = await again({ schema });
  t.equal([sent.took, sent.effort, sent.format?.type], [1, 'low', 'json_schema'], 'a model that takes the request as it is gets it as it is');

  await settings({ model: 'noeffort-1' });
  sent = await again({ schema });
  t.equal([sent.took, sent.effort, sent.format?.type], [2, null, 'json_schema'], 'a model that cannot be told how hard to work is asked again without being told');
  sent = await again({ schema });
  t.equal([sent.took, sent.effort], [1, null], 'and that way first from then on');

  await settings({ model: 'noformat-1' });
  sent = await again({ schema });
  t.equal([sent.took, sent.effort, sent.format], [2, 'low', null], 'a model that cannot be held to a schema is asked again without one');
  t.equal(sorted(JSON.parse(sent.system.slice(sent.system.indexOf('{')))), sorted(schema), 'the shape still asked for in words');
  sent = await again({ schema });
  t.equal([sent.took, sent.format], [1, null], 'and that is remembered too');
  sent = await again();
  t.equal([sent.took, sent.effort], [1, 'low'], 'a request with no schema being asked as ever');

  await settings({ model: 'noconfig-1' });
  sent = await again({ schema });
  t.equal([sent.took, sent.effort, sent.format], [2, null, null], 'a service that has heard of neither is asked without either');
  await settings({ model: 'nofields-1' });
  sent = await again({ schema });
  t.equal([sent.took, sent.effort, sent.format], [2, null, null], 'however it words its refusal');

  // A refusal is of a part of the request only if it names the part. One that is about
  // something else, and merely has such a word in it, is passed on as it came.
  await settings({ model: 'easy-1' });
  t.equal(
    await ask('wordy', { schema }).outcome,
    'The request was refused (400): This model is not available on a best-effort basis. For more information on formatting requests, see the documentation.',
    'a refusal about something else is passed on',
  );
  sent = await again({ schema });
  t.equal([sent.took, sent.effort, sent.format?.type], [1 + 1, 'low', 'json_schema'], 'having been asked once, and nothing given up because of it');

  // The name LunaRoute takes the effort by is not one a strict service knows. Where LunaRoute
  // is said to be is given the effort under both names; if what is there refuses LunaRoute's,
  // it is asked again with Anthropic's alone.
  await settings({ model: 'picky-1', address: '', environment: { LUNAROUTE_BASE_URL: `${home}/strict/v1`, LUNAROUTE_API_KEY: 'fake-key-under-the-older-name' } });
  sent = await again();
  t.equal([sent.took, sent.key, sent.effort, sent.reasoning_effort], [2, 'older', 'low', null], 'a service that refuses the effort under LunaRoute’s name is asked again with Anthropic’s alone');
  sent = await again();
  t.equal([sent.took, sent.effort, sent.reasoning_effort], [1, 'low', null], 'and that way first from then on');
  await settings({ address: '', model: '', environment: usual });
}

// --- room -----------------------------------------------------------------------------------------------

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
{
  // Anthropic's way a model may stop for a reason that is not an ending.
  t.equal(await ask('declined').outcome, 'The AI service had a problem: the model declined to answer', 'a model that declines has not answered');
  t.equal(await ask('overfull').outcome, 'The AI service had a problem: the piece and the answer together are more than the model can hold', 'nor has one that had no room left for the piece and its answer together');
}

// --- nothing beyond this Mac ----------------------------------------------------------------------------

{
  await settings({ address: 'https://api.anthropic.com', key: 'fake-key-saved-in-settings' });
  t.equal((await seen()).failed, OFF_LIMITS, 'a scripted run is not let out to Anthropic’s own service');
  t.equal((await settings({ test: true })).testNote, OFF_LIMITS, 'by a request or by the test');
  await settings({ address: 'http://anthropic.example.com/v1', forget: true });
  t.equal((await seen()).failed, 'Only an address on this Mac or its own network may be plain http. Use https.', 'and plain http is refused this way as that');
  await settings({ address: '' });
}

// A picture of the window with Anthropic's way chosen, and a test just made of it.
await settings({ test: true, picture: 'settings-anthropic' });
t.equal((await settings()).shown, false, 'and all of it without a window on the screen');
