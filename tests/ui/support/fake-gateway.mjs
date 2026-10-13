// A stand-in for the AI gateway, for the scenarios that test the shell's client (ai-gateway.js).
// It speaks the same protocol as LunaRoute (OpenAI-style chat completions over server-sent
// events) and does what the last message asks: [[case: stream]], [[case: 429]] and so on.
//
//   node tests/ui/support/fake-gateway.mjs      prints "listening <port>" and serves until killed
//
// It knows three keys, so a scenario can tell which one the app sent without ever seeing a key.
// It listens at a second address as well, and under any path that ends as a chat completion
// does, so the same process can stand for another service. Under /strict it is a service that
// is particular about what a request carries (see `particular`).
import { createServer } from 'node:http';

export const KEYS = { environment: 'fake-key-from-the-environment', saved: 'fake-key-saved-in-settings', older: 'fake-key-under-the-older-name' };
const dropped = { count: 0 }; // requests the client hung up on before the answer was complete
const asked = { count: 0 }; // chat completions asked for, the refused ones too
const followed = { count: 0 }; // requests that arrived by following a redirect
const turned = { count: 0 }; // how many times the model that changes its ways has been asked

const sse = (object) => `data: ${JSON.stringify(object)}\n\n`;
const delta = (content) => sse({ choices: [{ index: 0, delta: { content } }] });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const refuse = (response, status, message) => {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ error: { message, type: 'error' } }));
};

const CASES = {
  // An answer in pieces, the pieces arriving split in awkward places.
  async stream(response) {
    const whole = ['first idea\n', 'second ', 'idea\n', 'third idea\n'].map(delta).join('') + 'data: [DONE]\n\n';
    for (let at = 0; at < whole.length; at += 23) {
      response.write(whole.slice(at, at + 23));
      await sleep(15);
    }
    response.end();
  },
  // What the request looked like, as the answer.
  async echo(response, body, request) {
    const sent = request.headers.authorization;
    const key = sent === undefined ? 'none' : (Object.entries(KEYS).find(([, value]) => sent === `Bearer ${value}`)?.[0] ?? 'unknown');
    const said = {
      key,
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
      messages: body.messages.map((message) => message.role),
      dropped: dropped.count,
      asked: asked.count,
      followed: followed.count,
    };
    response.write(delta(JSON.stringify(said)));
    response.end('data: [DONE]\n\n');
  },
  // The model thinks first; only what it says is the answer.
  async thinking(response) {
    response.write(sse({ choices: [{ delta: { reasoning_content: 'Let me think.' } }] }));
    response.write(sse({ choices: [{ delta: { content: '', reasoning_content: ' Still thinking.' } }] }));
    response.write(delta('said'));
    response.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 9 } }));
    response.end('data: [DONE]\n\n');
  },
  // Characters some programs put between lines (U+2028, U+2029, U+0085), sent as JSON may
  // send them: raw, inside a string. They are part of the text, not the end of a line of the stream.
  async separators(response) {
    response.write(delta('one\u2028two\u2029three\u0085four\n'));
    response.end('data: [DONE]\n\n');
  },
  async empty(response) {
    response.end('data: [DONE]\n\n');
  },
  // A gateway that takes no notice of "stream" and answers all at once.
  async whole(response) {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'all at once' } }] }));
  },
  // One piece every 150 ms, for long enough to be called off.
  async slow(response) {
    for (let n = 1; n <= 20 && !response.destroyed; n++) {
      response.write(delta(`piece ${n}\n`));
      await sleep(150);
    }
    if (!response.destroyed) response.end('data: [DONE]\n\n');
  },
  // A piece, and then silence.
  async stall(response) {
    response.write(delta('a start\n'));
    await sleep(60000);
    response.end();
  },
  // A piece and a half, and then the line goes dead.
  async cut(response) {
    response.write(delta('a start\n'));
    response.write('data: {"choices":[{"delta":{"con');
    await sleep(50);
    response.destroy();
  },
  // An error that arrives inside the stream, as some gateways send theirs.
  async midway(response) {
    response.write(delta('a start\n'));
    response.end(sse({ error: { message: 'upstream model overloaded', code: 529 } }));
  },
  // The model was given too little room, and stopped part-way through what it was saying.
  async length(response) {
    response.write(delta('{"paragraphs": [{"n": 1, "te'));
    response.write(sse({ choices: [{ delta: {}, finish_reason: 'length' }] }));
    response.end('data: [DONE]\n\n');
  },
  // "It has moved": the answer is at the stand-in's other address. A request sent on there
  // would carry the person's words, and their key, somewhere they did not name.
  moved(response) {
    response.writeHead(307, { Location: `http://127.0.0.1:${second.address().port}/v1/chat/completions?after=moved` });
    response.end();
  },
  // A refusal that quotes the key back.
  quoted: (response) => refuse(response, 400, `No route for key ${KEYS.environment} on this plan.`),
  401: (response) => refuse(response, 401, `Incorrect API key provided: ${KEYS.environment}`),
  403: (response) => refuse(response, 403, 'This key may not use that model.'),
  429: (response) => refuse(response, 429, 'Rate limit reached.'),
  400: (response) => refuse(response, 400, 'The model `nope` does not exist.\nSee the documentation.'),
  500: (response) => refuse(response, 500, 'Internal error.'),
  503: (response) => {
    response.writeHead(503, { 'Content-Type': 'text/html' });
    response.end('<html><body><h1>Service Unavailable</h1></body></html>');
  },
};

// A service that is particular about what a request carries, by the model asked for. The first
// two are OpenAI's own ways, in its own words: a model that reasons wants the room under a newer
// name, and one that does not will not be told how hard to think. "fussy" takes neither, and
// says so as a service that checks the shape of a request does. "small" has little room to
// give, whatever it is called. "turn" changes its ways: asked twice it is a model that reasons,
// and after that one that has never heard of the newer name. True if the request was refused.
function particular(response, body) {
  const model = body.model ?? '';
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
  if (request.method !== 'POST' || !pathname.endsWith('/chat/completions')) return refuse(response, 404, 'No such route.');
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return refuse(response, 400, 'The request was not JSON.');
  }
  asked.count += 1;
  if (request.url.startsWith('/strict/') && particular(response, body)) return;
  const last = body.messages?.at(-1)?.content ?? '';
  // Like the real model, this one thinks before it says even one word, and what it thinks is
  // counted against the limit: asked for a word with room for only a word, it runs out.
  const cramped = /single word/.test(last) && (body.max_tokens ?? body.max_completion_tokens ?? 0) < 256;
  let name = cramped ? 'length' : (/\[\[case: (\w+)\]\]/.exec(last)?.[1] ?? 'stream');
  // A model with nothing to say, whatever it is asked.
  if ((body.model ?? '').startsWith('mute')) name = 'empty';
  // What comes after a redirect that was followed: an ordinary answer, and a note that it happened.
  if (searchParams.get('after') === 'moved') {
    followed.count += 1;
    name = 'stream';
  }
  const run = CASES[name];
  if (!run) return refuse(response, 400, `No such case: ${name}`);
  let complete = false;
  response.on('close', () => {
    if (!complete) dropped.count += 1;
  });
  response.on('finish', () => {
    complete = true;
  });
  if (!/^\d+$/.test(name) && !['whole', 'quoted', 'moved'].includes(name)) response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  try {
    await run(response, body, request);
  } catch {
    response.destroy();
  }
};

const server = createServer(answer);
const second = createServer(answer);
second.listen(0, '127.0.0.1', () => server.listen(0, '127.0.0.1', () => console.log(`listening ${server.address().port}`)));
