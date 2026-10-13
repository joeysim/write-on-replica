import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSound } from '../../web/src/fx/sound.js';

/** Stands in for an AudioContext: counts what is asked of it. */
function fakeContext() {
  const asked = { made: 0, resumed: 0, suspended: 0 };
  const make = () => {
    asked.made += 1;
    return {
      state: 'suspended',
      resume() {
        asked.resumed += 1;
        this.state = 'running';
        return Promise.resolve();
      },
      suspend() {
        asked.suspended += 1;
        this.state = 'suspended';
        return Promise.resolve();
      },
    };
  };
  return { asked, make };
}
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('preparing starts the sound once, before anything has to play', () => {
  const { asked, make } = fakeContext();
  // (Put to rest soon after: left at its usual half minute, the timer would keep the test run waiting that long.)
  const sound = createSound({ context: make, restAfterMs: 20 });
  assert.equal(asked.made, 0, 'nothing is started until it is likely to be wanted');
  sound.prepare();
  sound.prepare();
  assert.deepEqual(asked, { made: 1, resumed: 1, suspended: 0 });
});

test('with the sound turned off nothing is started', () => {
  const { asked, make } = fakeContext();
  const sound = createSound({ enabled: () => false, context: make });
  sound.prepare();
  sound.tick('high');
  assert.equal(asked.made, 0);
});

test('the sound is put to rest when none has played for a while, and woken by the next', async () => {
  const { asked, make } = fakeContext();
  const sound = createSound({ context: make, restAfterMs: 20 });
  sound.prepare();
  await wait(60);
  assert.equal(asked.suspended, 1, 'put to rest');
  sound.prepare();
  assert.equal(asked.resumed, 2, 'and woken');
  await wait(10);
  sound.prepare(); // still wanted: the rest is put off
  await wait(15);
  assert.equal(asked.suspended, 1, 'not put to rest while it is being used');
  await wait(40);
  assert.equal(asked.suspended, 2);
});
