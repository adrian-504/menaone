#!/usr/bin/env node
// Launch check (foundations P1): how long from page load until My Day is painted,
// on the dev preview's sample data (no real database). Opens the preview five
// times in headless Chrome and reports each run and the median, read from the
// `myday-painted` performance mark main.ts sets right after the first paint.
// `FOCUS_URL=http://localhost:1420/ node scripts/launch-check.mjs [--json]`
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.FOCUS_URL || 'http://localhost:1420/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const RUNS = Number(process.env.RUNS || 5);

const port = 9900 + Math.floor(Math.random() * 90);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'launch-'))}`, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 60 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch {} }
if (!target) { console.error('Chrome did not start'); process.exit(2); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: false });
const runs = [];
for (let i = 0; i < RUNS + 1; i++) {
  await send('Page.navigate', { url: `${URL}?launch=${Date.now()}` });
  const ms = await evalJs(`new Promise((resolve) => {
    const t0 = Date.now();
    const poll = () => {
      const m = performance.getEntriesByName('myday-painted')[0];
      if (m) resolve(Math.round(m.startTime));
      else if (Date.now() - t0 > 15000) resolve(-1);
      else setTimeout(poll, 20);
    };
    poll();
  })`);
  if (i > 0) runs.push(ms); // the first load warms the dev server's module cache
  await sleep(300);
}
ws.close(); chrome.kill();
const sorted = [...runs].sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];
if (process.argv.includes('--json')) console.log(JSON.stringify({ runs, median }));
else console.log(`My Day painted: ${runs.join(' / ')} ms · median ${median} ms`);
process.exit(runs.includes(-1) ? 1 : 0);
