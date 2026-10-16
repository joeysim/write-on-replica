// A stand-in for the AI service, for the scenarios that test the shell's client (ai-gateway.js
// and ai-anthropic.js). It speaks both of the ways the app can speak: OpenAI's chat completions
// (to anything that ends /chat/completions) and Anthropic's messages (to anything that ends
// /messages), each over server-sent events as the real services send them. It does what the
// last message asks: [[case: stream]], [[case: 429]] and so on.
//
//   node tests/ui/support/fake-gateway.mjs      prints "listening <port>" and serves until killed
//
// It knows three keys, so a scenario can tell which one the app sent without ever seeing a key.
// It listens at a second address as well, and under any path with one of those two endings, so
// the same process can stand for another service. Under /strict it is a service that is
// particular about what a request carries (see `particular`).
import { createServer } from 'node:http';

export const KEYS = { environment: 'fake-key-from-the-environment', saved: 'fake-key-saved-in-settings', older: 'fake-key-under-the-older-name' };
const dropped = { count: 0 }; // requests the client hung up on before the answer was complete
const asked = { count: 0 }; // requests for an answer, the refused ones too
const followed = { count: 0 }; // requests that arrived by following a redirect
const turned = { count: 0 }; // how many times the model that changes its ways has been asked

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sse = (object) => `data: ${JSON.stringify(object)}\n\n`;
const event = (name, data = {}) => `event: ${name}\ndata: ${JSON.stringify({ type: name, ...data })}\n\n`;

// The same things, said each way.
const VOICES = {
  openai: {
    begin: () => '',
    text: (content) => sse({ choices: [{ index: 0, delta: { content } }] }),
    end: () => 'data: [DONE]\n\n',
    nothing: () => 'data: [DONE]\n\n',
    tooLong: () => sse({ choices: [{ delta: {}, finish_reason: 'length' }] }) + 'data: [DONE]\n\n',
    failed: (message) => sse({ error: { message, code: 529 } }),
    half: () => 'data: {"choices":[{"delta":{"con',
    // All its room spent on thinking: cut off before it has said a word.
    thoughtOut: () => sse({ choices: [{ delta: { reasoning_content: 'So much to consider.' } }] }) + sse({ choices: [{ delta: {}, finish_reason: 'length' }] }) + 'data: [DONE]\n\n',
    // The model thinks first; only what it says is the answer.
    thinking: () =>
      sse({ choices: [{ delta: { reasoning_content: 'Let me think.' } }] }) +
      sse({ choices: [{ delta: { content: '', reasoning_content: ' Still thinking.' } }] }) +
      sse({ choices: [{ index: 0, delta: { content: 'said' } }] }) +
      sse({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 9 } }) +
      'data: [DONE]\n\n',
    whole: (content, cut = false) => ({ choices: [{ message: { role: 'assistant', content }, finish_reason: cut ? 'length' : 'stop' }] }),
    refusal: (message) => ({ error: { message, type: 'error' } }),
    // An error on a line of the stream that does not say what kind of line it is.
    bare: (message) => sse({ error: { message } }),
  },
  anthropic: {
    begin: () => VOICES.anthropic.opening() + event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
    opening: () =>
      event('message_start', {
        message: { id: 'msg_stand_in', type: 'message', role: 'assistant', content: [], model: 'stand-in', stop_reason: null, stop_sequence: null, usage: { input_tokens: 9, output_tokens: 1 } },
      }),
    text: (text) => event('content_block_delta', { index: 0, delta: { type: 'text_delta', text } }),
    end: () => event('content_block_stop', { index: 0 }) + VOICES.anthropic.closing('end_turn'),
    closing: (why) => event('message_delta', { delta: { stop_reason: why, stop_sequence: null }, usage: { output_tokens: 9 } }) + event('message_stop'),
    nothing: () => VOICES.anthropic.opening() + VOICES.anthropic.closing('end_turn'),
    tooLong: () => event('content_block_stop', { index: 0 }) + VOICES.anthropic.closing('max_tokens'),
    failed: (message) => event('error', { error: { type: 'overloaded_error', message } }),
    half: () => 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_del',
    thoughtOut: () =>
      VOICES.anthropic.opening() +
      event('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }) +
      event('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: 'So much to consider.' } }) +
      event('content_block_stop', { index: 0 }) +
      VOICES.anthropic.closing('max_tokens'),
    // The thinking comes as a block of its own, with a ping in the middle of it and a
    // signature at its end; only the text block after it is the answer.
    thinking: () =>
      VOICES.anthropic.opening() +
      event('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }) +
      event('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: 'Let me think.' } }) +
      event('ping') +
      event('content_block_delta', { index: 0, delta: { type: 'thinking_delta', thinking: ' Still thinking.' } }) +
      event('content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: 'c2lnbmVk' } }) +
      event('content_block_stop', { index: 0 }) +
      event('content_block_start', { index: 1, content_block: { type: 'text', text: '' } }) +
      event('content_block_delta', { index: 1, delta: { type: 'text_delta', text: 'said' } }) +
      event('something_new', { note: 'a kind of event this app has not heard of' }) +
      event('content_block_stop', { index: 1 }) +
      VOICES.anthropic.closing('end_turn'),
    whole: (text, cut = false) => ({
      id: 'msg_stand_in',
      type: 'message',
      role: 'assistant',
      model: 'stand-in',
      content: [{ type: 'thinking', thinking: 'Let me think.', signature: '' }, ...(text ? [{ type: 'text', text }] : [])],
      stop_reason: cut ? 'max_tokens' : 'end_turn',
    }),
    refusal: (message) => ({ type: 'error', error: { type: 'invalid_request_error', message } }),
    bare: (message) => `data: ${JSON.stringify({ error: { message } })}\n\n`,
    // The model would not answer, or the piece and its answer were more than it can hold.
    stopped: (why) => VOICES.anthropic.begin() + VOICES.anthropic.text('I would rather not') + event('content_block_stop', { index: 0 }) + VOICES.anthropic.closing(why),
  },
};

const refuse = (response, status, message, say = VOICES.openai) => {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(say.refusal(message)));
};

// The models the service has. As LunaRoute lists them, each says what it can do: to chat each
// way, to keep to a schema, and other things. Under /plain the stand-in is a service that says
// only their names. Each way of speaking sends its key its own way; Anthropic's needs a version.
// Under /luna it does as LunaRoute does: asked Anthropic's way, it gives the list in
// Anthropic's shape, where what a model can do is { messages: { supported: true }, … }.
const LISTED = [
  { id: 'muse-spark-open', capabilities: { openai_chat: true, anthropic_messages: true, json_schema: true, reasoning: true } },
  { id: 'whisper-large-v3', capabilities: { transcription: true } },
  { id: 'glm-5.3-flash', capabilities: { openai_chat: true, anthropic_messages: true, json_schema: true } },
  { id: 'chat-only', capabilities: { openai_chat: true } },
  { id: 'anthropic-only', capabilities: { anthropic_messages: true, json_schema: true } },
  { id: 'Zeta-1', capabilities: { openai_chat: true, anthropic_messages: true, json_schema: true } },
  { id: 'says-nothing', capabilities: {} },
  { id: 'no-word-of-it' }, // LunaRoute lists some models with no capabilities at all
];
const PLAIN = [{ id: 'beta' }, { id: 'Alpha' }];
const models = (request, response, pathname) => {
  const bearer = request.headers.authorization;
  const own = request.headers['x-api-key'];
  const known = Object.values(KEYS).some((key) => bearer === `Bearer ${key}` || own === key);
  if (!known) return refuse(response, 401, 'A key the service knows is needed.');
  if (own !== undefined && !request.headers['anthropic-version']) return refuse(response, 400, 'anthropic-version: header is required', VOICES.anthropic);
  const theirs = pathname.startsWith('/luna/') && request.headers['anthropic-version'] !== undefined;
  const shaped = (capabilities) =>
    Object.fromEntries(Object.entries(capabilities).filter(([name]) => name !== 'json_schema' && name !== 'openai_chat').map(([name, can]) => [name === 'anthropic_messages' ? 'messages' : name, { supported: can }]));
  const listed = pathname.startsWith('/plain/') ? PLAIN : theirs ? LISTED.map((model) => (model.capabilities ? { ...model, capabilities: shaped(model.capabilities) } : model)) : LISTED;
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ object: 'list', data: listed.map((model) => ({ object: 'model', owned_by: 'stand-in', ...model })) }));
};

const CASES = {
  // An answer in pieces, the pieces arriving split in awkward places.
  async stream(response, body, request, say) {
    const whole = say.begin() + ['first idea\n', 'second ', 'idea\n', 'third idea\n'].map(say.text).join('') + say.end();
    for (let at = 0; at < whole.length; at += 23) {
      response.write(whole.slice(at, at + 23));
      await sleep(15);
    }
    response.end();
  },
  // What the request looked like, as the answer.
  async echo(response, body, request, say) {
    const anthropic = say === VOICES.anthropic;
    const bearer = request.headers.authorization;
    const own = request.headers['x-api-key'];
    const sent = anthropic ? own : bearer;
    const key = sent === undefined ? 'none' : (Object.entries(KEYS).find(([, value]) => sent === (anthropic ? value : `Bearer ${value}`))?.[0] ?? 'unknown');
    const said = {
      style: anthropic ? 'anthropic' : 'openai',
      key,
      // A key sent the other way's way as well: there should be none.
      otherKey: (anthropic ? bearer : own) !== undefined,
      version: request.headers['anthropic-version'] ?? null,
      host: request.headers.host, // where the app thinks it is asking
      port: request.socket.localPort,
      second: second.address().port,
      path: request.url,
      accept: request.headers.accept ?? null,
      model: body.model,
      stream: body.stream,
      max_tokens: body.max_tokens ?? null,
      max_completion_tokens: body.max_completion_tokens ?? null,
      reasoning_effort: body.reasoning_effort ?? null,
      response_format: body.response_format ?? null,
      system: body.system ?? null,
      effort: body.output_config?.effort ?? null,
      format: body.output_config?.format ?? null,
      messages: body.messages.map((message) => message.role),
      dropped: dropped.count,
      asked: asked.count,
      followed: followed.count,
    };
    response.write(say.begin() + say.text(JSON.stringify(said)));
    response.end(say.end());
  },
  async thinking(response, body, request, say) {
    response.end(say.thinking());
  },
  // Characters some programs put between lines (U+2028, U+2029, U+0085), sent as JSON may
  // send them: raw, inside a string. They are part of the text, not the end of a line of the stream.
  async separators(response, body, request, say) {
    response.write(say.begin() + say.text('one two three\u0085four\n'));
    response.end(say.end());
  },
  async empty(response, body, request, say) {
    response.end(say.nothing());
  },
  // A service that takes no notice of "stream" and answers all at once.
  async whole(response, body, request, say) {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(say.whole('all at once')));
  },
  // One piece every 150 ms, for long enough to be called off.
  async slow(response, body, request, say) {
    response.write(say.begin());
    for (let n = 1; n <= 20 && !response.destroyed; n++) {
      response.write(say.text(`piece ${n}\n`));
      await sleep(150);
    }
    if (!response.destroyed) response.end(say.end());
  },
  // A piece, and then silence.
  async stall(response, body, request, say) {
    response.write(say.begin() + say.text('a start\n'));
    await sleep(60000);
    response.end();
  },
  // A piece and a half, and then the line goes dead.
  async cut(response, body, request, say) {
    response.write(say.begin() + say.text('a start\n'));
    response.write(say.half());
    await sleep(50);
    response.destroy();
  },
  // An error that arrives inside the stream, as both services may send theirs.
  async midway(response, body, request, say) {
    response.write(say.begin() + say.text('a start\n'));
    response.end(say.failed('upstream model overloaded'));
  },
  // The model was given too little room, and stopped part-way through what it was saying.
  async length(response, body, request, say) {
    response.write(say.begin() + say.text('{"sentences": [{"s": 1, "te'));
    response.end(say.tooLong());
  },
  // The same, from a service that answers all at once: cut off with nothing said.
  async wholeCut(response, body, request, say) {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(say.whole('', true)));
  },
  // An answer that is no answer: the status says all is well and the body says otherwise.
  async wholeError(response, body, request, say) {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(say.refusal('the upstream model is not available')));
  },
  // An error part-way through, on a line that does not say it is one.
  async bare(response, body, request, say) {
    response.write(say.begin() + say.text('a start\n'));
    response.end(say.bare('upstream model overloaded'));
  },
  // Anthropic's way a model may stop for reasons that are not an ending.
  async declined(response, body, request, say) {
    response.end(say.stopped('refusal'));
  },
  async overfull(response, body, request, say) {
    response.end(say.stopped('model_context_window_exceeded'));
  },
  // A refusal whose words only happen to hold the names of things the app sends.
  wordy: (response, body, request, say) => refuse(response, 400, 'This model is not available on a best-effort basis. For more information on formatting requests, see the documentation.', say),
  // A model that thought until its room ran out, and so said nothing.
  async thoughtOut(response, body, request, say) {
    response.end(say.thoughtOut());
  },
  // "It has moved": the answer is at the stand-in's other address. A request sent on there
  // would carry the person's words, and their key, somewhere they did not name.
  moved(response, body, request) {
    const { pathname } = new URL(request.url, 'http://stand-in');
    response.writeHead(307, { Location: `http://127.0.0.1:${second.address().port}${pathname}?after=moved` });
    response.end();
  },
  // A refusal that quotes the key back.
  quoted: (response, body, request, say) => refuse(response, 400, `No route for key ${KEYS.environment} on this plan.`, say),
  401: (response, body, request, say) => refuse(response, 401, `Incorrect API key provided: ${KEYS.environment}`, say),
  403: (response, body, request, say) => refuse(response, 403, 'This key may not use that model.', say),
  429: (response, body, request, say) => refuse(response, 429, 'Rate limit reached.', say),
  400: (response, body, request, say) => refuse(response, 400, 'The model `nope` does not exist.\nSee the documentation.', say),
  500: (response, body, request, say) => refuse(response, 500, 'Internal error.', say),
  503: (response) => {
    response.writeHead(503, { 'Content-Type': 'text/html' });
    response.end('<html><body><h1>Service Unavailable</h1></body></html>');
  },
};

// A service that is particular about what a request carries, by the model asked for.
//
// Asked OpenAI's way. The first two are OpenAI's own ways, in its own words: a model that
// reasons wants the room under a newer name, and one that does not will not be told how hard
// to think. "fussy" takes neither, and says so as a service that checks the shape of a request
// does. "small" has little room to give, whatever it is called. "turn" changes its ways: asked
// twice it is a model that reasons, and after that one that has never heard of the newer name.
//
// Asked Anthropic's way. "noeffort" is a model that cannot be told how hard to work, "noformat"
// one that cannot hold an answer to a schema, "noconfig" a service that knows nothing of either,
// and "picky" one that takes nothing it has not heard of, as Anthropic's own does.
//
// True if the request was refused.
function particular(response, body, say) {
  const model = body.model ?? '';
  if (say === VOICES.anthropic) {
    const why =
      (model.startsWith('noeffort') && body.output_config?.effort !== undefined && 'output_config.effort: this model does not support the effort parameter') ||
      (model.startsWith('noformat') && body.output_config?.format !== undefined && 'output_config.format: structured outputs are not available for this model') ||
      (model.startsWith('noconfig') && 'output_config' in body && 'output_config: Extra inputs are not permitted') ||
      (model.startsWith('picky') && 'reasoning_effort' in body && 'reasoning_effort: Extra inputs are not permitted');
    if (why) refuse(response, 400, why, say);
    // The same refusal as "noconfig" gives, in the shape a service that checks requests against a schema gives it in.
    if (!why && model.startsWith('nofields') && 'output_config' in body) {
      response.writeHead(422, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ detail: [{ type: 'extra_forbidden', loc: ['body', 'output_config'], msg: 'Extra inputs are not permitted' }] }));
      return true;
    }
    return Boolean(why);
  }
  const unsupported = (name, hint = '') => {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { message: `Unsupported parameter: '${name}' is not supported with this model.${hint}`, type: 'invalid_request_error', param: name, code: 'unsupported_parameter' } }));
    return true;
  };
  if (model.startsWith('turn')) {
    turned.count += 1;
    if (turned.count > 2 && 'max_completion_tokens' in body) {
      refuse(response, 400, 'Unrecognized request argument supplied: max_completion_tokens');
      return true;
    }
    if (turned.count <= 2 && 'max_tokens' in body) return unsupported('max_tokens', " Use 'max_completion_tokens' instead.");
  }
  if (model.startsWith('reasoner') && 'max_tokens' in body) return unsupported('max_tokens', " Use 'max_completion_tokens' instead.");
  if (model.startsWith('plain') && 'reasoning_effort' in body) return unsupported('reasoning_effort');
  if (model.startsWith('fussy')) {
    const name = ['reasoning_effort', 'max_tokens'].find((each) => each in body);
    if (name) {
      response.writeHead(422, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ detail: [{ type: 'extra_forbidden', loc: ['body', name], msg: 'Extra inputs are not permitted', input: body[name] }] }));
      return true;
    }
  }
  if (model.startsWith('small')) {
    const name = 'max_tokens' in body ? 'max_tokens' : 'max_completion_tokens';
    if ((body[name] ?? 0) > 16) {
      refuse(response, 400, `${name} is too large: ${body[name]}. This model supports at most 16 completion tokens.`);
      return true;
    }
  }
  return false;
}

const answer = async (request, response) => {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  const { pathname, searchParams } = new URL(request.url, 'http://stand-in');
  const say = pathname.endsWith('/messages') ? VOICES.anthropic : VOICES.openai;
  if (request.method === 'GET' && pathname.endsWith('/models')) return models(request, response, pathname);
  if (request.method !== 'POST' || !(pathname.endsWith('/chat/completions') || pathname.endsWith('/messages'))) return refuse(response, 404, 'No such route.');
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return refuse(response, 400, 'The request was not JSON.', say);
  }
  asked.count += 1;
  // What Anthropic's own service insists on, and the app must therefore always send.
  if (say === VOICES.anthropic) {
    const wrong =
      (!Number.isInteger(body.max_tokens) && 'max_tokens: Field required') ||
      (body.messages?.some((message) => !['user', 'assistant'].includes(message.role)) && 'messages: Unexpected role "system". The Messages API accepts a top-level `system` parameter, not "system" as an input message role.') ||
      (!request.headers['anthropic-version'] && 'anthropic-version: header is required');
    if (wrong) return refuse(response, 400, wrong, say);
  }
  if (request.url.startsWith('/strict/') && particular(response, body, say)) return;
  const last = body.messages?.at(-1)?.content ?? '';
  // Like the real model, this one thinks before it says even one word, and what it thinks is
  // counted against the limit: asked for a word with room for only a word, it runs out.
  const cramped = /single word/.test(last) && (body.max_tokens ?? body.max_completion_tokens ?? 0) < 256;
  let name = cramped ? 'length' : (/\[\[case: (\w+)\]\]/.exec(last)?.[1] ?? 'stream');
  // A model with nothing to say, whatever it is asked.
  if ((body.model ?? '').startsWith('mute')) name = 'empty';
  // A model that thinks a great deal: it runs out before it has said a word unless it has
  // room for 200. And one that never has room enough.
  const room = body.max_tokens ?? body.max_completion_tokens ?? 0;
  if ((body.model ?? '').startsWith('stuck') || ((body.model ?? '').startsWith('thinker') && room < 200)) name = 'thoughtOut';
  // And one that thinks as much but may write no more than 100: given more it refuses, as
  // the real services do, and given less it runs out.
  if ((body.model ?? '').startsWith('capped')) {
    if (room > 100) return refuse(response, 400, `max_tokens: ${room} > 100, which is the maximum allowed number of output tokens for this model`, say);
    name = 'thoughtOut';
  }
  // What comes after a redirect that was followed: an ordinary answer, and a note that it happened.
  if (searchParams.get('after') === 'moved') {
    followed.count += 1;
    name = 'stream';
  }
  const run = CASES[name];
  if (!run) return refuse(response, 400, `No such case: ${name}`, say);
  let complete = false;
  response.on('close', () => {
    if (!complete) dropped.count += 1;
  });
  response.on('finish', () => {
    complete = true;
  });
  if (!/^\d+$/.test(name) && !['whole', 'wholeCut', 'wholeError', 'wordy', 'quoted', 'moved'].includes(name)) response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  try {
    await run(response, body, request, say);
  } catch {
    response.destroy();
  }
};

const server = createServer(answer);
const second = createServer(answer);
second.listen(0, '127.0.0.1', () => server.listen(0, '127.0.0.1', () => console.log(`listening ${server.address().port}`)));
