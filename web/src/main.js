import { native } from './native.js';
import { sampleState } from './sample.js';

// Until the editing surface exists (plan task 8) the page only displays the sample:
// headings are stored as "# Text" and shown as bold lines without the marker.
function showStatic(root, html) {
  root.innerHTML = html;
  for (const p of root.querySelectorAll('p')) {
    const first = p.firstChild;
    const marker = first?.nodeType === Node.TEXT_NODE ? /^(#{1,6}) /.exec(first.data) : null;
    if (!marker) continue;
    first.data = first.data.slice(marker[0].length);
    p.dataset.h = String(marker[1].length);
  }
}

showStatic(document.getElementById('editor'), sampleState().html);

document.fonts.ready.then(() => native.call('app.ready'));
