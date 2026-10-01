#!/usr/bin/env node
// Page screenshots (1.59 "pages"): the seven list pages redrawn in the My Day
// language — Pending, Follow-up, Proposals, Opportunities, Companies,
// Meetings, Projects — on the dev preview's sample data, with the clock fixed
// at 1 Oct 2026 14:05. SIZE=1680x1020 (default) or 1080x940, THEME=dark,
// ONLY=pending to take one.
// `FOCUS_URL=http://localhost:1420/ OUT=/tmp/shots node scripts/pages-shots.mjs`
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cachePath, launchChrome, sleep } from './lib/chrome.mjs';

const URL = process.env.FOCUS_URL || 'http://localhost:1420/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.env.OUT || cachePath('shots', 'pages-shots');
const THEME = process.env.THEME || 'light';

// [name, clock (local), set-up]
const CLOCK = '2026-10-01T14:05:00';
const SHOTS = [
  ['pending', CLOCK, "navToModule('pending')"],
  ['followup', CLOCK, "navToModule('followup')"],
  ['proposals', CLOCK, "navToModule('database')"],
  ['opportunities', CLOCK, "navToModule('opportunities')"],
  ['companies', CLOCK, "navToModule('companies'), setCoListView('list')"],
  ['companies-grid', CLOCK, "navToModule('companies'), setCoListView('grid')"],
  ['meetings', CLOCK, "navToModule('meetings')"],
  ['projects', CLOCK, "navToModule('projects')"],
  // 1.60 "pages-2"
  ['contacts', CLOCK, "navToModule('contacts')"],
  ['agreements', CLOCK, "navToModule('agreements')"],
  ['agreements-noterm', CLOCK, "navToModule('agreements'), setTimeout(() => { document.getElementById('agr-noterm')?.scrollIntoView({ block: 'start' }); scrollBy(0, -80); }, 700)"],
  ['cleanup', CLOCK, "navToModule('cleanup')"],
  ['services', CLOCK, "navToModule('pricing'), setServicesView('catalog')"],
  ['services-rates', CLOCK, "navToModule('pricing'), setServicesView('rates')"],
  ['services-templates', CLOCK, "navToModule('pricing'), setServicesView('templates')"],
].filter(([n]) => !process.env.ONLY || process.env.ONLY.split(',').includes(n));

const { send, evalJs, close } = await launchChrome('pages-shots', { port: 9700 + Math.floor(Math.random() * 90) });

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
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const file = join(OUT, `${W}-${THEME === 'dark' ? 'dark-' : ''}${tint}-${name}.png`);
    writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
    console.log(file);
  }
}
await close();
