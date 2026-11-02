// A stand-in for GitHub's releases, for updates.js: what Check for Updates asks for.
//
//   node tests/ui/support/fake-releases.mjs <run folder> <app>
//
// It first makes the updates it hands out (make-updates.sh), then prints "listening <port>"
// and serves until killed. Each case has a path of its own. /<case>/releases/latest says what
// the latest release is, in the shape of GitHub's API, and /<case>/download/<zip> gives the
// zip. GitHub's own answer says much more; this one has the parts that the app reads.
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [folder, app] = process.argv.slice(2);
const zips = join(folder, 'updates');
execFileSync(join(dirname(fileURLToPath(import.meta.url)), 'make-updates.sh'), [app, zips], { stdio: ['ignore', 'inherit', 'inherit'] });
const current = execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', join(app, 'Contents/Info.plist')]).toString().trim();

// As scripts/release-notes.sh writes them: the changes, then the rest, which is not a change.
const NOTES = '## What changed\n\n- One change.\n- Another change, on a line of its own.\n\n## The download\n\n- Not a change.\n';
// Each case: the release's tag, and which zip its asset is (or an address of its own).
const CASES = {
  current: { tag: `v${current}` },
  older: { tag: 'v0.9.0' },
  good: { tag: 'v99.0.0', zip: 'good' },
  stranger: { tag: 'v99.0.0', zip: 'stranger' },
  adhoc: { tag: 'v99.0.0', zip: 'adhoc' },
  tampered: { tag: 'v99.0.0', zip: 'tampered' },
  mismatch: { tag: 'v99.0.0', zip: 'mismatch' },
  // The release has no zip for the app.
  bare: { tag: 'v99.0.0', assets: [] },
  // Its tag is not a version.
  untagged: { tag: 'nightly' },
  // The zip is said to be somewhere that is not this Mac.
  away: { tag: 'v99.0.0', url: 'https://example.com/Write_On-99.0.0.zip' },
  // The answer takes 4 s, long enough to call the check off.
  slow: { tag: 'v99.0.0', zip: 'good', delay: 4000 },
};

const release = (port, name, { tag, zip, url, assets }) => {
  const file = `Write_On-${tag.replace(/^v/, '')}.zip`;
  return {
    tag_name: tag,
    name: `Write_On ${tag}`,
    html_url: `http://127.0.0.1:${port}/${name}/page`,
    body: NOTES,
    assets: assets ?? [{ name: file, browser_download_url: url ?? `http://127.0.0.1:${port}/${name}/download/${file}`, content_type: 'application/zip' }],
  };
};

const server = createServer((request, response) => {
  const { port } = server.address();
  const [, name, ...rest] = new URL(request.url, 'http://127.0.0.1').pathname.split('/');
  const path = rest.join('/');
  const send = (status, body, type = 'application/json') => {
    response.writeHead(status, { 'content-type': type });
    response.end(body);
  };
  if (name === 'missing') return send(404, JSON.stringify({ message: 'Not Found' }));
  if (name === 'broken') return send(200, 'This is not what GitHub says.', 'text/plain');
  const found = CASES[name];
  if (!found) return send(404, JSON.stringify({ message: 'Not Found' }));
  if (path === 'releases/latest') {
    return setTimeout(() => send(200, JSON.stringify(release(port, name, found))), found.delay ?? 0);
  }
  const zip = join(zips, `${found.zip}.zip`);
  if (path.startsWith('download/') && found.zip && existsSync(zip)) {
    response.writeHead(200, { 'content-type': 'application/zip' });
    return createReadStream(zip).pipe(response);
  }
  send(404, JSON.stringify({ message: 'Not Found' }));
});
server.listen(0, '127.0.0.1', () => console.log(`listening ${server.address().port}`));
