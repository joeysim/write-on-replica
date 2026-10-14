// Sharing (design spec 6.11). Post to X hands the piece to X's compose window. The LinkedIn
// button is there to be chased: it cannot be pressed.

import { plainText } from '../doc/format.js';
import { isNear, fleeTo } from '../fx/flee.js';

const COMPOSE = 'https://x.com/intent/post';
// What a link to the compose window is trusted with. X's servers refuse a request much past
// 14,000 bytes, and the browser's own headers and cookies count toward that.
const MOST = { characters: 4000, link: 8000 };
const TOO_LONG = 'Too long to fill in: it is on the clipboard, ready to paste.';

const ESCAPES = 6; // the approach after these is its last
const MARGIN = 18; // how near the edge of the window its middle may land
const HOP = { duration: 280, easing: 'cubic-bezier(0.35, 1.2, 0.2, 1.02)' }; // fitted to the clip

export function initSharing({ editor, ui, commands, native, tooltips, sound, explosions }) {
  // --- Post to X ----------------------------------------------------------------------------

  const x = document.getElementById('post-x');
  // The piece as it reads: no heading mark, nothing ghosted, nothing from the overflow.
  const piece = () => plainText(editor.getState(), { withoutGhost: true, headingMarker: false });

  async function post() {
    const text = piece();
    const filled = `${COMPOSE}?text=${encodeURIComponent(text)}`;
    if (Array.from(text).length <= MOST.characters && filled.length <= MOST.link) {
      await native.call('browser.open', { url: filled });
      return;
    }
    await native.call('clipboard.write', { text });
    await native.call('browser.open', { url: COMPOSE });
    tooltips.say(x, TOO_LONG);
  }

  commands.register('post', () => post().catch((reason) => tooltips.say(x, `Not posted: ${reason.message}.`)), {
    enabled: () => piece() !== '',
  });
  x.addEventListener('click', () => commands.run('post'));

  // --- the LinkedIn button ------------------------------------------------------------------

  const button = document.getElementById('linkedin');
  let escapes = 0;
  let hop = null; // the jump it is making, or made last

  function flee(from, pointer) {
    const to = fleeTo(from, pointer, { left: MARGIN, top: MARGIN, right: innerWidth - MARGIN, bottom: innerHeight - MARGIN });
    hop?.cancel();
    button.style.setProperty('--x', `${to.x}px`);
    button.style.setProperty('--up', `${innerHeight - to.y}px`);
    // It is already where it is going: this draws it getting there from where it was.
    hop = button.animate([{ transform: `translate(${from.x - to.x}px, ${from.y - to.y}px)` }, { transform: 'translate(0px, 0px)' }], HOP);
  }

  function blowUp(at) {
    button.hidden = true; // until the next launch
    explosions.burst([{ left: at.left, top: at.top, right: at.right, bottom: at.bottom }]);
    sound.boom();
  }

  document.addEventListener('mousemove', (event) => {
    if (button.hidden || ui.get('read')) return;
    // As it is drawn, so one caught in the air is off again from where it is.
    const at = button.getBoundingClientRect();
    const middle = { x: at.left + at.width / 2, y: at.top + at.height / 2 };
    const pointer = { x: event.clientX, y: event.clientY };
    if (!isNear(middle, pointer)) return;
    if (escapes === ESCAPES) {
      blowUp(at);
      return;
    }
    escapes += 1;
    flee(middle, pointer);
  });
}
