#!/usr/bin/env node
// My Day screenshots (1.57), from the brand screenshot script (brand slice): My Day at 14:05 and 09:00, a company, a
// proposal, Tasks and Settings → Appearance, in the Blue and Grey tints, at
// 1,080 × 940 on the dev preview's sample data. The page's clock is fixed so
// the band's time-of-day scrim can be seen. SIZE=1680x1020, FULL=1 (the whole page height) and SAMPLE=scale (the
// sample at the owner's real volumes; shots in myday-shots-scale, each with its page height) as in pages-shots.
// `FOCUS_URL=http://localhost:1420/ OUT=/tmp/shots node scripts/brand-shots.mjs`
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AT_SCALE, appUrl, launchChrome, shotsPath, sleep } from './lib/chrome.mjs';

const URL = appUrl();
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = shotsPath('myday-shots');
const THEME = process.env.THEME || 'light';

// [name, clock (local), set-up]
const SHOTS = [
  ['myday-1405', '2026-09-30T14:05:00', "switchTab('myday')"],
  ['myday-1405-attention', '2026-09-30T14:05:00', "switchTab('myday'), setTimeout(() => document.getElementById('myday-attention-sec').scrollIntoView({ block: 'start' }), 400)"],
];

const { send, evalJs, close } = await launchChrome('myday-shots', { port: 9700 + Math.floor(Math.random() * 90) });

mkdirSync(OUT, { recursive: true });
await send('Page.enable');
const [W, H] = (process.env.SIZE || '1080x940').split('x').map(Number);
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
    // At scale, what the brief asks of a page: how tall it is, and whether anything is wider than the window.
    console.log(AT_SCALE ? `${file}  ${await evalJs(`'page ' + document.scrollingElement.scrollHeight + 'px' + (document.scrollingElement.scrollWidth > innerWidth ? ', wider than the window by ' + (document.scrollingElement.scrollWidth - innerWidth) + 'px' : '')`)}` : file);
  }
}
await close();
