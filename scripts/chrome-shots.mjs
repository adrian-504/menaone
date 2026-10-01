#!/usr/bin/env node
// Chrome screenshots (1.63 "chrome"): Files (the proposals folder in Grid and
// List, a folder with a file selected), Settings, the New menu, a create
// dialog, ⌘K with a query, a context menu, a toast and a confirmation, on the
// dev preview's sample data with the clock fixed at 1 Oct 2026 14:05.
// SIZE=1680x1020 (default) or 1080x940, THEME=dark, ONLY=files,palette.
// `FOCUS_URL=http://localhost:1420/ OUT=/tmp/shots node scripts/chrome-shots.mjs`
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cachePath, launchChrome, sleep } from './lib/chrome.mjs';

const URL = process.env.FOCUS_URL || 'http://localhost:1420/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.env.OUT || cachePath('shots', 'chrome-shots');
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
  ['palette', CLOCK, "switchTab('myday'), openCommandPalette(), (() => { const f = document.getElementById('cmdk-input'); f.value = 'acme'; onPaletteInput('acme'); })(), new Promise(r => setTimeout(r, 600))"],
  ['palette-empty', CLOCK, "switchTab('myday'), openCommandPalette()"],
  ['menu', CLOCK, "switchTab('todo'), setTodoFilter('anytime'), (() => { const r = document.querySelector('.task-row[data-task-id=\"1\"]').getBoundingClientRect(); todoContextMenu(new MouseEvent('contextmenu', { clientX: r.left + 320, clientY: r.top + 20, bubbles: true }), 1); })()"],
  ['toasts', CLOCK, "switchTab('todo'), setTodoFilter('anytime'), moveOverdueToToday(), toggleCommitmentKept(1), new Promise(r => setTimeout(r, 900))"],
  ['confirm', CLOCK, "openRecord('proposal', 2), new Promise(r => setTimeout(r, 500)).then(() => { document.querySelector('[onclick^=\"proposalMoreMenu\"]')?.click(); return new Promise(r => setTimeout(r, 250)); }).then(() => { [...document.querySelectorAll('#ctx-menu .ctx-menu-item')].find((x) => x.textContent.includes('Delete'))?.click(); return new Promise(r => setTimeout(r, 300)); })"],
].filter(([n]) => !process.env.ONLY || process.env.ONLY.split(',').includes(n));

const { send, evalJs, close } = await launchChrome('chrome-shots', { port: 9700 + Math.floor(Math.random() * 90) });

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
