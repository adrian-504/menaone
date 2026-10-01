#!/usr/bin/env node
// Studio screenshots (studio slice): the builder empty and filled, the Generate
// sheet, the generating moment, the success state and a proposal's deck cards,
// at 1,080 × 940 on the dev preview's sample data. The generating moment is
// held by delaying the (mock) write in the page, nothing else is staged.
// `FOCUS_URL=http://localhost:1420/ OUT=/tmp/shots node scripts/studio-shots.mjs`
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cachePath, launchChrome, sleep } from './lib/chrome.mjs';

const URL = process.env.FOCUS_URL || 'http://localhost:1420/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.env.OUT || cachePath('shots', 'studio-shots');
const W = Number(process.env.WIDTH || 1080);

const fill = `(() => {
  const c = document.getElementById('prb-client'); c.focus(); c.value = 'Acme Holdings'; c.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('.company-selector-row')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  [...document.querySelectorAll('#prb-top .prb-chip')].find((b) => /Payroll/.test(b.textContent)).click();
  const m = document.getElementById('prb-months'); m.value = '12'; m.dispatchEvent(new Event('change', { bubbles: true }));
  document.activeElement?.blur(); window.scrollTo(0, 0);
})()`;
const slow = `(() => { const i = window.__TAURI_INTERNALS__; const orig = i.invoke.bind(i); i.invoke = (cmd, args, o) => cmd === 'proposal_generate' && !args.request.dryRun ? new Promise((r) => setTimeout(() => r(orig(cmd, args, o)), 6000)) : orig(cmd, args, o); })()`;
// [name, set-up, wait ms after]
const SHOTS = [
  ['builder-empty', "openProposalBuilder({})", 900],
  ['builder-filled', `openProposalBuilder({}), new Promise(r => setTimeout(r, 600)).then(() => ${fill})`, 1500],
  ['generate-sheet', "openRecord('proposal', 3), openGenerateProposal(3)", 1500],
  ['generating', `openRecord('proposal', 3), openGenerateProposal(3).then(() => { ${slow}; confirmGenerateProposal(); })`, 2500],
  ['generated', "openRecord('proposal', 3), openGenerateProposal(3).then(() => confirmGenerateProposal())", 2000],
  ['proposal-decks', "openRecord('proposal', 3), openGenerateProposal(3).then(() => confirmGenerateProposal()).then(() => { closeGenerateProposal(); setTimeout(() => document.getElementById('prd-decks')?.scrollIntoView({ block: 'center' }), 300); })", 2000],
];

const { send, evalJs, close } = await launchChrome('studio-shots', { port: 9600 + Math.floor(Math.random() * 90) });

mkdirSync(OUT, { recursive: true });
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: 940, deviceScaleFactor: 2, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', { source: "localStorage.setItem('menabig.yourName', 'Ahmad Abdallah'); document.documentElement.classList.add('mac-window-chrome');" });
for (const [name, setup, wait] of SHOTS) {
  await send('Page.navigate', { url: URL });
  await sleep(2500);
  await evalJs(`(async () => { ${setup.startsWith('openProposalBuilder') || setup.startsWith('openRecord') ? '' : ''}await (${setup}); })()`);
  await sleep(wait);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const file = join(OUT, `${W === 1080 ? '' : `${W}-`}${name}.png`);
  writeFileSync(file, Buffer.from(shot.result.data, 'base64'));
  console.log(file);
}
await close();
