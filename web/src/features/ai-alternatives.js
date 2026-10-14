// AI alternatives (design spec 6.6). A row of `??` in the panel asks the model for other
// ways to say the target, in the context of its paragraph. The marks dance while it
// thinks, for at least 750 ms; the suggestions then arrive one after another and go into
// the document together, as one step to undo. If it fails, nothing changes.

import { textOf, locateGroup } from '../doc/blocks.js';
import { alternativesRequest } from '../ai/prompts.js';
import { LineStream, suggestionFilter } from '../ai/parse.js';

const MIN_DANCE_MS = 750;
const BETWEEN_MS = 140; // from one suggestion's arrival to the next
const NOTHING_NEW = 'The AI had nothing new to offer.';

export function initAIAlternatives({ editor, panel, alternatives, ai, commands }) {
  let current = null; // the request under way

  function stop() {
    if (!current) return;
    current.stream.cancel();
    clearTimeout(current.timer);
    current = null;
  }

  function ask(vid) {
    stop();
    const group = editor.groups[vid];
    const where = locateGroup(editor.blocks, vid);
    if (!group || !where) return;
    const request = alternativesRequest({ scope: group.scope, paragraph: textOf(editor.blocks[where.block]), start: where.start, end: where.end, existing: group.variants });
    // Nothing the model sends is taken as given: lines are cleaned, repeats and extras dropped.
    const accept = suggestionFilter({ existing: group.variants, count: request.count, scope: group.scope });
    const lines = new LineStream();
    const waiting = [];
    const shown = [];
    const began = performance.now();
    let ended = null; // null while the answer is still coming, then {} or { error }
    const mine = { stream: null, timer: 0 };
    current = mine;

    const take = (found) => {
      for (const line of found) {
        const text = accept(line);
        if (text) waiting.push(text);
      }
    };
    // One suggestion at a time; when the answer is over and all are shown, the outcome.
    const step = () => {
      mine.timer = 0;
      if (current !== mine) return;
      if (waiting.length) {
        const text = waiting.shift();
        shown.push(text);
        panel.ai.arrive(text);
        mine.timer = setTimeout(step, BETWEEN_MS);
      } else if (ended) {
        current = null;
        if (ended.error) panel.ai.fail(ended.error);
        else if (shown.length === 0) panel.ai.fail(NOTHING_NEW);
        else panel.ai.finish(() => alternatives.addMany(vid, shown, { ai: true }));
      }
    };
    const wake = () => {
      if (current === mine && !mine.timer) mine.timer = setTimeout(step, Math.max(0, MIN_DANCE_MS - (performance.now() - began)));
    };

    mine.stream = ai.start({ messages: request.messages, maxTokens: request.maxTokens, effort: request.effort }, (text) => {
      take(lines.push(text));
      wake();
    });
    mine.stream.done.then(
      () => {
        take(lines.flush());
        ended = {};
        wake();
      },
      (error) => {
        if (error.canceled) return;
        ended = { error: error.message };
        wake();
      },
    );
  }

  panel.ai.on(ask, stop);

  // The command opens the panel on the selection or word, or stays on the target it has,
  // and asks at once.
  commands.register('ai-alternatives', () => {
    if (panel.open() || panel.isOpen()) panel.ai.begin();
  });
}
