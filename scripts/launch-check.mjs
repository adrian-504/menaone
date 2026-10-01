#!/usr/bin/env node
// Launch check (foundations P1): how long from page load until My Day is painted,
// on the dev preview's sample data (no real database). Opens the preview five
// times in headless Chrome and reports each run and the median, read from the
// `myday-painted` performance mark main.ts sets right after the first paint.
// `FOCUS_URL=http://localhost:1420/ node scripts/launch-check.mjs [--json]`
import { join } from 'node:path';
import { cachePath, launchChrome, sleep } from './lib/chrome.mjs';

const URL = process.env.FOCUS_URL || 'http://localhost:1420/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const RUNS = Number(process.env.RUNS || 5);

const { send, evalJs, close } = await launchChrome('launch-check', { port: 9900 + Math.floor(Math.random() * 90), hideScrollbars: false });

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
await close();
const sorted = [...runs].sort((a, b) => a - b);
const median = sorted[Math.floor(sorted.length / 2)];
if (process.argv.includes('--json')) console.log(JSON.stringify({ runs, median }));
else console.log(`My Day painted: ${runs.join(' / ')} ms · median ${median} ms`);
process.exit(runs.includes(-1) ? 1 : 0);
