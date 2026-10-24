import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { serve, resolve, CSP } from '../server.js';

test('addresses stay inside the public folder', () => {
  assert.ok(resolve('/').endsWith('/public/index.html'));
  assert.ok(resolve('/js/main.js').endsWith('/public/js/main.js'));
  assert.ok(resolve('/ships/js/main.js').endsWith('/public/js/main.js'), 'the gate prefix is dropped');
  for (const bad of ['/../server.js', '/..%2fserver.js', '/js/../../server.js', '/%2e%2e/%2e%2e/etc/passwd', '/js/\0x', '/js\\..\\..\\server.js', '/%E0%A4%A']) assert.equal(resolve(bad), null, bad);
});

test('the page is served with a strict policy, and nothing but GET works', async () => {
  const s = http.createServer(serve);
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const port = s.address().port;
  const get = (p, method = 'GET') => new Promise((r) => http.request({ port, path: p, method }, (res) => { let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => r({ res, b })); }).end());
  const idx = await get('/');
  assert.equal(idx.res.statusCode, 200);
  assert.equal(idx.res.headers['content-security-policy'], CSP);
  assert.ok(/connect-src 'self' https:\/\/api\.github\.com/.test(CSP) && !CSP.includes('unsafe') && CSP.includes("script-src 'self'"));
  assert.match(idx.res.headers['content-type'], /text\/html/);
  assert.match((await get('/js/util.js')).res.headers['content-type'], /javascript/);
  assert.equal((await get('/nope')).res.statusCode, 404);
  assert.equal((await get('/../server.js')).res.statusCode, 404);
  assert.equal((await get('/', 'POST')).res.statusCode, 405);
  assert.ok(!idx.b.includes('<script>') && !/\sstyle=/.test(idx.b) && !/\sonclick=/.test(idx.b), 'no inline script or style');
  s.close();
});
