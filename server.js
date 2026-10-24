// A static file server for the page, with nothing else in it: 127.0.0.1 only, no dependencies, and a policy that lets the page talk to
// GitHub's API and load its owners' pictures and nothing more. `PORT=4177 node server.js`; behind Odysseus's gate it is reached at /ships/.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.LICENSE': 'text/plain; charset=utf-8' };
export const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob: https://avatars.githubusercontent.com; connect-src 'self' https://api.github.com; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

/** The file a request address means, inside the public folder; null for anything that leaves it. */
export function resolve(urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0].split('#')[0]); } catch { return null; }
  if (p.includes('\0') || p.includes('\\')) return null;
  const rel = p.replace(/^\/ships(?=\/|$)/, '').replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(root, rel);
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  return file;
}

export function serve(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
  let file = resolve(req.url || '/');
  if (file && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!file || !fs.existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('not found'); }
  const type = TYPES[path.extname(file)] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type, 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Cache-Control': file.endsWith('.html') ? 'no-cache' : 'public, max-age=300',
  });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 4177;
  http.createServer(serve).listen(port, '127.0.0.1', () => console.log(`ships on http://127.0.0.1:${port}/`));
}
