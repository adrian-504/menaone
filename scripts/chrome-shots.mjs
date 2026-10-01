#!/usr/bin/env node
// Chrome screenshots (1.63 "chrome"): Files (the proposals folder in Grid and
// List, a folder with a file selected), Settings, the New menu, a create
// dialog, ⌘K with a query, a context menu, a toast and a confirmation, on the
// dev preview's sample data with the clock fixed at 1 Oct 2026 14:05.
// SIZE=1680x1020 (default) or 1080x940, THEME=dark, ONLY=files,palette.
// `FOCUS_URL=http://localhost:1420/ OUT=/tmp/shots node scripts/chrome-shots.mjs`
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.FOCUS_URL || 'http://localhost:1420/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.env.OUT || join(tmpdir(), 'tools-shots');
const THEME = process.env.THEME || 'light';

// [name, clock (local), set-up]
const CLOCK = '2026-10-01T14:05:00';
const PR = '/Users/demo/Library/CloudStorage/OneDrive-MENABIG/MENA BD 2026/Proposals';
const SHOTS = [
  ['files', CLOCK, `switchTab('files'), msFilesLayout('icons'), msFilesNavigateToPath('${PR}')`],
  ['files-list', CLOCK, `switchTab('files'), msFilesLayout('list'), msFilesNavigateToPath('${PR}/Acme Holdings')`],
  ['files-folder', CLOCK, `switchTab('files'), msFilesLayout('icons'), msFilesNavigateToPath('${PR}/Acme Holdings').then(() => msFilesSelect('${PR}/Acme Holdings/Fee model.xlsx'))`],
  ['settings', CLOCK, "navToModule('settings'), setSettingsPane('general')"],
  ['settings-appearance', CLOCK, "navToModule('settings'), setSettingsPane('appearance')"],
  ['settings-team', CLOCK, "navToModule('settings'), setSettingsPane('team')"],
  ['settings-business', CLOCK, "navToModule('settings'), setSettingsPane('business')"],
  ['settings-templates', CLOCK, "navToModule('settings'), setSettingsPane('templates')"],
  ['settings-connections', CLOCK, "navToModule('settings'), setSettingsPane('connections')"],
  ['settings-data', CLOCK, "navToModule('settings'), setSettingsPane('data')"],
  ['newmenu', CLOCK, "switchTab('myday'), document.getElementById('sb-new-btn').click()"],
  ['newmenu-filter', CLOCK, "switchTab('myday'), document.getElementById('sb-new-btn').click(), (() => { const f = document.getElementById('new-menu-filter'); f.value = 'pro'; f.dispatchEvent(new Event('input', { bubbles: true })); })()"],
  ['newtask', CLOCK, "switchTab('myday'), openTodoModal(null), (() => { const f = document.querySelector('#todo-form [name=todoTitle]'); f.value = 'Send Acme Holdings the revised quote Friday 3pm !high #payroll'; f.dispatchEvent(new Event('input', { bubbles: true })); })()"],
  ['newmeeting', CLOCK, "switchTab('myday'), openMeetingModal(null)"],
  ['newpromise', CLOCK, "switchTab('myday'), openCommitmentModal()"],
  ['newcompany', CLOCK, "switchTab('myday'), openNewCompanyModal()"],
  ['newcontact', CLOCK, "switchTab('myday'), openContactModal()"],
  ['newopportunity', CLOCK, "switchTab('myday'), openOpportunityModal(null)"],
  ['newagreement', CLOCK, "switchTab('myday'), openAgrModal(null)"],
  ['newproject', CLOCK, "switchTab('myday'), openProjectModal(null)"],
].filter(([n]) => !process.env.ONLY || process.env.ONLY.split(',').includes(n));

const port = 9700 + Math.floor(Math.random() * 100);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'pages-'))}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
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
ws.close();
chrome.kill();
