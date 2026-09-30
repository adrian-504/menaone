#!/usr/bin/env node
// Motion frames (docs/ux-conventions.md, "Motion"): six timed screenshots of
// four interactions — a sidebar switch, a menu opening, a dialog opening, a
// task being ticked — at 0 / 60 / 120 / 180 / 260 / 400 ms, so the curves can be
// checked by eye. Runs against the dev preview (sample data only) in headless
// Chrome and writes docs/motion/<name>-<ms>.png.
// `FOCUS_URL=http://localhost:1420/ node scripts/motion-frames.mjs`
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = process.env.FOCUS_URL || 'http://localhost:1420/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/motion');
const TIMES = [0, 60, 120, 180, 260, 400];

// [name, set-up, the action, the region to capture {x, y, width, height}]
const SHOTS = [
  ['sidebar-switch', "switchTab('myday')", "switchTab('projects')", { x: 0, y: 40, width: 240, height: 360 }],
  ['menu-open', "openRecord('proposal', 3)", "[...document.querySelectorAll('#prd-contact button')].find((b) => b.textContent.includes('Followed up')).click()", { x: 700, y: 300, width: 740, height: 460 }],
  ['dialog-open', "switchTab('contacts')", 'openContactModal()', { x: 240, y: 0, width: 1200, height: 900 }],
  ['task-tick', "switchTab('todo'), setTodoFilter('anytime')", "document.querySelector('#todo-list .task-row .task-check').click()", { x: 240, y: 60, width: 900, height: 360 }],
];

const port = 9800 + Math.floor(Math.random() * 100);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'motion-'))}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
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

mkdirSync(OUT, { recursive: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
for (const [name, setup, action, clip] of SHOTS) {
  await send('Page.navigate', { url: URL });
  await sleep(2500);
  await evalJs(`(${setup}), new Promise(r => setTimeout(r, 900))`);
  // Pause the page's clock so each frame is taken at an exact moment of the animation.
  await send('Animation.enable');
  await send('Animation.setPlaybackRate', { playbackRate: 0.0001 });
  await evalJs(`(${action}), 0`);
  let last = 0;
  for (const t of TIMES) {
    await send('Animation.setPlaybackRate', { playbackRate: 1 });
    await sleep(t - last);
    await send('Animation.setPlaybackRate', { playbackRate: 0.0001 });
    last = t;
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale: 1 } });
    writeFileSync(join(OUT, `${name}-${String(t).padStart(3, '0')}ms.png`), Buffer.from(shot.result.data, 'base64'));
  }
  await send('Animation.setPlaybackRate', { playbackRate: 1 });
  console.log(`✓ ${name}: ${TIMES.join(' / ')} ms`);
}
ws.close(); chrome.kill();
