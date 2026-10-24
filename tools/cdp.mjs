// Dev tool: drives the Chrome that is already on this machine, headless, with a throwaway profile (never your real one), over its debugging
// port. `import { open } from './cdp.mjs'`; `const p = await open(url)`; p.eval(js), p.shot(file), p.key(code), p.close().
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function open(url, { width = 1400, height = 900, port = 9333 + Math.floor(Math.random() * 500), chrome = 'google-chrome' } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ships-chrome-'));
  const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 80; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === 'page')) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const waiting = new Map(), logs = [];
  ws.addEventListener('message', (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); }
    else if (d.method === 'Runtime.consoleAPICalled') logs.push(`${d.params.type}: ${d.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    else if (d.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text}`);
  });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  const api = {
    logs,
    send,
    async eval(js) { const r = await send('Runtime.evaluate', { expression: js, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) return `ERROR: ${r.result.exceptionDetails.exception?.description}`; return r.result?.result?.value; },
    async shot(file) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.result.data, 'base64')); },
    async key(code, key = code, ms = 80) {
      const base = { code, key, windowsVirtualKeyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : code === 'Space' ? 32 : code === 'Escape' ? 27 : 0 };
      await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: key.length === 1 ? key : '' });
      await new Promise((r) => setTimeout(r, ms));
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    },
    async hold(code, key, ms) {
      const base = { code, key, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) };
      await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, text: key });
      await new Promise((r) => setTimeout(r, ms));
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    },
    async click(x, y) { for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    async close() { try { ws.close(); } catch { /* closed */ } proc.kill(); await new Promise((r) => setTimeout(r, 400)); try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 }); } catch { /* the profile is in a temp folder */ } },
  };
  return api;
}
