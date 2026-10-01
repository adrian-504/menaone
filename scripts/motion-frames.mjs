#!/usr/bin/env node
// Motion frames (docs/ux-conventions.md, "Motion"): six timed screenshots of
// interactions — a sidebar switch, a menu, a dialog, a ticked task, the sidebar
// collapsing, an undo toast, a tooltip — at 0 / 60 / 100 / 120 / 180 / 260 / 400 ms, so the curves can be
// checked by eye. Runs against the dev preview (sample data only) in headless
// Chrome and writes docs/motion/<name>-<ms>.png.
// `FOCUS_URL=http://localhost:1420/ node scripts/motion-frames.mjs`
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachePath, launchChrome, sleep } from './lib/chrome.mjs';

const URL = process.env.FOCUS_URL || 'http://localhost:1420/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/motion');
const TIMES = [0, 60, 100, 120, 180, 260, 400];

// [name, set-up, the action, the region to capture {x, y, width, height}]
const SHOTS = [
  ['sidebar-switch', "switchTab('myday')", "switchTab('projects')", { x: 0, y: 40, width: 240, height: 360 }],
  ['menu-open', "openRecord('proposal', 3)", "[...document.querySelectorAll('#prd-contact button')].find((b) => b.textContent.includes('Followed up')).click()", { x: 700, y: 300, width: 740, height: 460 }],
  ['dialog-open', "switchTab('contacts')", 'openContactModal()', { x: 240, y: 0, width: 1200, height: 900 }],
  ['task-tick', "switchTab('todo'), setTodoFilter('anytime')", "document.querySelector('#todo-list .task-row .task-check').click()", { x: 240, y: 60, width: 900, height: 360 }],
  // 1.53 (delight): the sidebar sliding shut, an undo toast arriving, a tooltip.
  ['undo-toast', "switchTab('todo'), setTodoFilter('anytime')", "document.querySelector('#todo-list .task-row .task-check').click()", { x: 0, y: 700, width: 720, height: 200 }],
  // A tooltip waits 600 ms on hover: the frames start when it begins to show.
  ['tooltip', "switchTab('myday')", "(() => { const b = document.getElementById('sb-collapse-btn'); const m = b.matches.bind(b); b.matches = (q) => q === ':hover' || m(q); b.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); })()", { x: 0, y: 0, width: 420, height: 120 }, 640],
  // Last: it leaves the sidebar collapsed.
  ['sidebar-collapse', "switchTab('myday')", 'toggleSidebar()', { x: 0, y: 0, width: 720, height: 420 }],
];

const { send, evalJs, close } = await launchChrome('motion-frames', { port: 9800 + Math.floor(Math.random() * 90) });

mkdirSync(OUT, { recursive: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
for (const [name, setup, action, clip, wait = 0] of SHOTS) {
  await send('Page.navigate', { url: URL });
  await sleep(2500);
  await evalJs(`(${setup}), new Promise(r => setTimeout(r, 900))`);
  // Pause the page's clock so each frame is taken at an exact moment of the animation.
  await send('Animation.enable');
  await send('Animation.setPlaybackRate', { playbackRate: 0.0001 });
  await evalJs(`(${action}), 0`);
  if (wait) { await send('Animation.setPlaybackRate', { playbackRate: 1 }); await sleep(wait); await send('Animation.setPlaybackRate', { playbackRate: 0.0001 }); }
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
await close();
