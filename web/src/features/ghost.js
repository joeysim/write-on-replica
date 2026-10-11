// Ghost text (design spec 6.7): dim a passage where it stands, so the piece can be read
// without it, and bring it back later. What the command acts on is worked out in
// doc/ghost.js; the dimming itself is a rule in styles/editor.css.

import { ghostPlan, applyGhost } from '../doc/ghost.js';

export function initGhost({ editor, commands }) {
  commands.register(
    'ghost',
    () => {
      const selection = editor.selection();
      const plan = ghostPlan(editor.blocks, selection);
      editor.change(plan.revive ? 'revive' : 'ghost', (draft) => {
        draft.blocks = applyGhost(draft.blocks, plan);
        // The selection stays as it was. Over ghosted words it shows as dim as they are.
        draft.selection = { start: selection.start, end: selection.end };
      });
    },
    { enabled: () => Boolean(ghostPlan(editor.blocks, editor.selection())) },
  );
}
