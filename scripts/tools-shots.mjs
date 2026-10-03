#!/usr/bin/env node
// Working-tool screenshots (1.62 "tools"): Tasks (Anytime, Today, a row
// selected, Promises), Notes (the list, a note open), Calendar (week, day,
// month) and Inbox, on the dev preview's sample data with the clock fixed at
// 1 Oct 2026 14:05. SIZE=1680x1020 (default) or 1080x940, THEME=dark,
// ONLY=tasks,inbox to take some; FULL=1 captures the whole page height.
// `FOCUS_URL=http://localhost:1420/ OUT=/tmp/shots node scripts/tools-shots.mjs`
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appUrl, launchChrome, shotsPath, sleep } from './lib/chrome.mjs';

const URL = appUrl();
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = shotsPath('tools-shots');
const THEME = process.env.THEME || 'light';

// [name, clock (local), set-up]
const CLOCK = '2026-10-01T14:05:00';
const SHOTS = [
  ['tasks', CLOCK, "switchTab('todo'), setTodoFilter('anytime')"],
  ['tasks-today', CLOCK, "switchTab('todo'), setTodoFilter('today')"],
  ['tasks-selected', CLOCK, "switchTab('todo'), setTodoFilter('anytime'), openTaskDetail(1)"],
  ['tasks-promises', CLOCK, "switchTab('todo'), setTodoFilter('promises')"],
  ['notes', CLOCK, "switchTab('notes')"],
  ['notes-open', CLOCK, "switchTab('notes'), openNote(3)"],
  ['calendar-week', CLOCK, "switchTab('calendar'), setCalendarView('week')"],
  ['calendar-day', CLOCK, "switchTab('calendar'), setCalendarView('day')"],
  ['calendar-month', CLOCK, "switchTab('calendar'), setCalendarView('month')"],
  ['inbox', CLOCK, "switchTab('inbox')"],
  ['inbox-zero', CLOCK, "switchTab('inbox'), (async () => { for (const el of [...document.querySelectorAll('.inbox-item')]) await dismissInboxItem(Number(el.dataset.inboxId)); document.querySelectorAll('.toast').forEach((t) => t.remove()); })()"],
].filter(([n]) => !process.env.ONLY || process.env.ONLY.split(',').includes(n));

const { send, evalJs, close } = await launchChrome('tools-shots', { port: 9700 + Math.floor(Math.random() * 90) });

mkdirSync(OUT, { recursive: true });
await send('Page.enable');
const [W, H] = (process.env.SIZE || '1680x1020').split('x').map(Number);
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false });
if (THEME === 'dark') await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
let script = null;
for (const tint of ['blue']) {
  for (const [name, clock, setup] of SHOTS) {
    if (script) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: script });
    // A fixed clock that still ticks, the Mac window chrome, a name, the tint and theme.
    script = (await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      const start = new Date('${clock}').getTime(), real = Date.now(), R = Date;
      class D extends R { constructor(...a) { super(...(a.length ? a : [start + (R.now() - real)])); } static now() { return start + (R.now() - real); } }
      window.Date = D;
      localStorage.setItem('menabig.tint', '${tint}'); localStorage.setItem('menabig.yourName', 'Ahmad Abdallah'); localStorage.setItem('menabig.theme', '${THEME === 'dark' ? 'dark' : 'light'}');
      document.documentElement.classList.add('mac-window-chrome');
    })()` })).result?.identifier;
    await send('Page.navigate', { url: URL });
    await sleep(2500);
    await evalJs(`(${setup}), new Promise(r => setTimeout(r, 1500))`);
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!process.env.FULL, ...(process.env.FULL ? { clip: { x: 0, y: 0, width: W, height: Math.min(4000, await evalJs('document.scrollingElement.scrollHeight')), scale: 1 } } : {}) });
    const file = join(OUT, `${W}-${THEME === 'dark' ? 'dark-' : ''}${tint}-${name}.png`);
    writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
    console.log(file);
  }
}
await close();
