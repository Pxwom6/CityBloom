// The e2e suite's web server (M15): serves a production-mode build from a subpath, as GitHub Pages
// does (/CityBloom/), with two switches the tests use to act out a deploy and a lost connection:
//   GET /__e2e/deploy?dir=<build dir>   serve another build from now on (a new version)
//   GET /__e2e/offline?on=1|0           drop every other request, as if the network were gone
// Usage: node e2e/serve.mjs <build dir> <port> <base path>
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const [dirArg = 'dist-e2e', portArg = '4174', base = '/CityBloom/'] = process.argv.slice(2);
let root = resolve(dirArg);
let offline = false;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
  '.citybloom': 'application/octet-stream',
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/__e2e/deploy') {
    root = resolve(url.searchParams.get('dir') ?? dirArg);
    return send(res, 200, `serving ${root}`);
  }
  if (url.pathname === '/__e2e/offline') {
    offline = url.searchParams.get('on') === '1';
    return send(res, 200, `offline ${offline}`);
  }
  if (offline) return req.socket.destroy();
  if (url.pathname === '/' || url.pathname === base.slice(0, -1)) {
    res.writeHead(302, { location: base });
    return res.end();
  }
  if (!url.pathname.startsWith(base)) return send(res, 404, 'Not found');
  let rel = decodeURIComponent(url.pathname.slice(base.length)) || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(root, rel));
  if (!file.startsWith(root)) return send(res, 403, 'Forbidden');
  let size;
  try {
    const st = statSync(file);
    if (!st.isFile()) throw new Error('not a file');
    size = st.size;
  } catch {
    return send(res, 404, 'Not found');
  }
  // Like GitHub Pages: pages and the service worker are revalidated, hashed assets may be kept.
  const hashed = rel.startsWith('assets/');
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'content-length': size,
    'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}).listen(Number(portArg), () => console.log(`serving ${root} at http://localhost:${portArg}${base}`));
