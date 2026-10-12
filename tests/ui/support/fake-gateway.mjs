// A stand-in for the AI gateway, for the scenarios that test the shell's client (ai-gateway.js).
// It speaks the same protocol as LunaRoute (OpenAI-style chat completions over server-sent
// events) and does what the last message asks: [[case: stream]], [[case: 429]] and so on.
//
//   node tests/ui/support/fake-gateway.mjs      prints "listening <port>" and serves until killed
//
// It knows two keys, so a scenario can tell which one the app sent without ever seeing a key.
import { createServer } from 'node:http';

export const KEYS = { environment: 'fake-key-from-the-environment', saved: 'fake-key-saved-in-settings' };
const dropped = { count: 0 }; // requests the client hung up on before the answer was complete

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
    const sent = request.headers.authorization ?? '';
    const key = Object.entries(KEYS).find(([, value]) => sent === `Bearer ${value}`)?.[0] ?? 'unknown';
    const said = {
      key,
      path: request.url,
      accept: request.headers.accept ?? null,
      model: body.model,
      stream: body.stream,
      max_tokens: body.max_tokens,
      reasoning_effort: body.reasoning_effort ?? null,
      response_format: body.response_format ?? null,
      messages: body.messages.map((message) => message.role),
      dropped: dropped.count,
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

const server = createServer(async (request, response) => {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  if (request.method !== 'POST' || !request.url.endsWith('/chat/completions')) return refuse(response, 404, 'No such route.');
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return refuse(response, 400, 'The request was not JSON.');
  }
  const last = body.messages?.at(-1)?.content ?? '';
  const name = /\[\[case: (\w+)\]\]/.exec(last)?.[1] ?? 'stream';
  const run = CASES[name];
  if (!run) return refuse(response, 400, `No such case: ${name}`);
  let complete = false;
  response.on('close', () => {
    if (!complete) dropped.count += 1;
  });
  response.on('finish', () => {
    complete = true;
  });
  if (!/^\d+$/.test(name) && !['whole', 'quoted'].includes(name)) response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  try {
    await run(response, body, request);
  } catch {
    response.destroy();
  }
});

server.listen(0, '127.0.0.1', () => console.log(`listening ${server.address().port}`));
