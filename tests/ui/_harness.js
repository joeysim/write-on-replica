// Injected by the app's UI test harness ahead of a scenario. Never loaded by the page itself.
// A scenario is the body of an async function with `t` in scope.
(() => {
  const call = (method, params = {}) => window.webkit.messageHandlers.writeon.postMessage({ method, params });
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const show = (value) => {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  };
  const mods = (o = {}) => ({ ctrl: !!o.ctrl, shift: !!o.shift, alt: !!o.alt, meta: !!o.meta });
  const failures = [];
  const logs = [];
  let hoverTarget = null;

  const t = {
    call,
    wait: sleep,
    frame,
    /** Two frames: enough for layout and the page's own requestAnimationFrame work. */
    async settle() {
      await frame();
      await frame();
    },
    log(...args) {
      logs.push(args.map(show).join(' '));
    },
    assert(condition, message) {
      if (!condition) failures.push(message || 'assertion failed');
      return !!condition;
    },
    equal(actual, expected, message) {
      const a = show(actual);
      const e = show(expected);
      if (a !== e) failures.push(`${message || 'values differ'}: expected ${e}, got ${a}`);
      return a === e;
    },
    /** For long strings: the whole of each must match, and a failure shows only where they part. */
    same(actual, expected, message) {
      if (actual === expected) return true;
      let i = 0;
      while (i < actual.length && actual[i] === expected[i]) i += 1;
      const around = (s) => `…${s.slice(Math.max(0, i - 30), i + 70)}…`;
      failures.push(`${message || 'strings differ'}: at ${i} expected ${around(expected)}, got ${around(actual)}`);
      return false;
    },
    near(actual, expected, tolerance, message) {
      const ok = typeof actual === 'number' && Math.abs(actual - expected) <= tolerance;
      if (!ok) failures.push(`${message || 'value'}: expected ${expected} ± ${tolerance}, got ${actual}`);
      return ok;
    },
    async until(check, ms = 3000, what = 'condition') {
      const end = performance.now() + ms;
      while (performance.now() < end) {
        try {
          const value = await check();
          if (value) return value;
        } catch {
          // keep waiting
        }
        await sleep(16);
      }
      failures.push(`timed out waiting for ${what}`);
      return null;
    },
    async snap(name) {
      await t.settle();
      return call('test.snap', { name });
    },
    /**
     * The colours painted in a part of the page: `ground` is what most of it shows (what
     * lies behind the text), `ink` the brightest fiftieth of it (the text). Each is [r, g, b].
     * With `colour` as { near: [r, g, b], within }, `matching` counts the pixels that close to it.
     */
    async pixels(x, y, w, h, colour = {}) {
      await t.settle();
      return call('test.pixels', { x, y, w, h, ...colour });
    },
    // Input. Coordinates are CSS pixels in the page.
    //
    // Presses, releases, drags and keys are native events sent through the app's window.
    // Hovering is the exception: on a locked Mac WebKit drops native pointer moves that have
    // no button held, so `hover` dispatches the DOM events a real move would produce. The
    // page's own handlers run exactly as they would; only CSS :hover does not apply.
    async hover(x, y) {
      const target = document.elementFromPoint(x, y) || document.documentElement;
      const previous = hoverTarget && hoverTarget.isConnected ? hoverTarget : null;
      const init = { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, screenX: x, screenY: y };
      if (previous !== target) {
        const chain = (el) => {
          const list = [];
          for (let node = el; node && node.nodeType === 1; node = node.parentElement) list.push(node);
          return list;
        };
        const leaving = chain(previous).filter((el) => !el.contains(target));
        const entering = chain(target).filter((el) => !previous || !el.contains(previous)).reverse();
        if (previous) previous.dispatchEvent(new MouseEvent('mouseout', { ...init, relatedTarget: target }));
        for (const el of leaving) el.dispatchEvent(new MouseEvent('mouseleave', { ...init, bubbles: false, relatedTarget: target }));
        target.dispatchEvent(new MouseEvent('mouseover', { ...init, relatedTarget: previous }));
        for (const el of entering) el.dispatchEvent(new MouseEvent('mouseenter', { ...init, bubbles: false, relatedTarget: previous }));
      }
      target.dispatchEvent(new PointerEvent('pointermove', { ...init, pointerType: 'mouse', isPrimary: true }));
      target.dispatchEvent(new MouseEvent('mousemove', init));
      hoverTarget = target;
      await t.settle();
    },
    async click(x, y, o = {}) {
      const base = { x, y, button: o.button || 'left', count: o.count || 1, ...mods(o) };
      await t.hover(x, y);
      await call('test.mouse', { ...base, type: 'down' });
      await call('test.mouse', { ...base, type: 'up' });
      await t.settle();
    },
    async rightClick(x, y, o = {}) {
      await t.click(x, y, { ...o, button: 'right' });
    },
    /** Press at one point, move with the button held, release at another. */
    async drag(from, to, steps = 6) {
      await t.hover(from[0], from[1]);
      await call('test.mouse', { type: 'down', x: from[0], y: from[1] });
      for (let i = 1; i <= steps; i++) {
        const k = i / steps;
        await call('test.mouse', { type: 'drag', x: from[0] + (to[0] - from[0]) * k, y: from[1] + (to[1] - from[1]) * k });
        await frame();
      }
      await call('test.mouse', { type: 'up', x: to[0], y: to[1] });
      await t.settle();
    },
    async key(key, o = {}) {
      await call('test.key', { key, ...mods(o) });
      await t.settle();
    },
    async type(text) {
      for (const ch of text) await call('test.key', { key: ch === '\n' ? 'Enter' : ch });
      await t.settle();
    },
    /** Text that the key map cannot type (curly quotes, emoji). Goes through the editing pipeline. */
    async insert(text) {
      document.execCommand('insertText', false, text);
      await t.settle();
    },
    async writeFile(name, base64) {
      await call('test.writeFile', { name, base64 });
    },
    // Geometry helpers.
    center(target) {
      const el = typeof target === 'string' ? document.querySelector(target) : target;
      const r = el.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    },
    /** Range covering the nth occurrence of `needle` in the text under `root`. */
    rangeOfText(needle, { root = document.getElementById('editor'), nth = 0 } = {}) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const nodes = [];
      let text = '';
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        nodes.push({ node, start: text.length });
        text += node.data;
      }
      let at = -1;
      for (let i = 0; i <= nth; i++) at = text.indexOf(needle, at + 1);
      if (at < 0) return null;
      const locate = (offset) => {
        for (let i = nodes.length - 1; i >= 0; i--) {
          if (offset >= nodes[i].start) return [nodes[i].node, offset - nodes[i].start];
        }
        return [nodes[0].node, 0];
      };
      const range = document.createRange();
      range.setStart(...locate(at));
      const [endNode, endOffset] = locate(at + needle.length - 1);
      range.setEnd(endNode, endOffset + 1);
      return range;
    },
    pointOfText(needle, options) {
      const range = t.rangeOfText(needle, options);
      if (!range) return null;
      const r = range.getClientRects()[0];
      return [r.left + r.width / 2, r.top + r.height / 2];
    },
    selectText(needle, options) {
      const range = t.rangeOfText(needle, options);
      if (!range) return false;
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    },
  };

  window.__t = t;
  window.__tFinish = (error) =>
    call('test.done', {
      ok: failures.length === 0 && !error,
      failures: error ? [...failures, String((error && error.stack) || error)] : failures,
      logs,
    });
})();
