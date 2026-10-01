#!/usr/bin/env node
// Identity screenshots (1.56): the sidebar corner in light and dark, Settings → Appearance → Sidebar, and an agreement open while Agreements is hidden.
// proposal, Tasks and Settings → Appearance, in the Blue and Grey tints, at
// 1,080 × 940 on the dev preview's sample data. The page's clock is fixed so
// the band's time-of-day scrim can be seen.
// `FOCUS_URL=http://localhost:1420/ OUT=/tmp/shots node scripts/brand-shots.mjs`
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cachePath, launchChrome, sleep } from './lib/chrome.mjs';

const URL = process.env.FOCUS_URL || 'http://localhost:1420/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.env.OUT || cachePath('shots', 'identity-shots');
const THEME = process.env.THEME || 'light';

// [name, clock (local), set-up]
const SHOTS = [
  ['myday', '2026-09-30T14:05:00', "switchTab('myday')"],
  ['settings-sidebar', '2026-09-30T14:05:00', "navToModule('settings'), setSettingsPane('appearance'), setTimeout(() => document.getElementById('sidebar-switches').scrollIntoView({ block: 'center' }), 300)"],
  ['agreement-hidden-module', '2026-09-30T14:05:00', "openRecord('agreement', 1)"],
];

const { send, evalJs, close } = await launchChrome('identity-shots', { port: 9700 + Math.floor(Math.random() * 90) });

mkdirSync(OUT, { recursive: true });
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1080, height: 940, deviceScaleFactor: 2, mobile: false });
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
    const file = join(OUT, `${THEME === 'dark' ? 'dark-' : ''}${tint}-${name}.png`);
    writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
    console.log(file);
  }
}
await close();
