// Focus check (docs/ux-conventions.md, "Focus"): opens every main view of the
// dev preview (npm run dev — sample data only, never the real database) in
// headless Chrome at 1440x900 and counts what is visible before scrolling,
// outside the sidebar, location bar and record rail: input boxes, buttons,
// blue (primary) buttons. Fails when a view shows more than one primary, or a
// page is over its targets. `node scripts/focus-check.mjs [--json]`
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.FOCUS_URL || 'http://localhost:1420/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// [name, how to open it, targets]
const VIEWS = [
  ['My Day', "switchTab('myday')", {}],
  ['Inbox', "switchTab('inbox')", {}],
  ['Tasks', "switchTab('todo')", {}],
  ['Projects', "switchTab('projects')", {}],
  ['Meetings', "switchTab('meetings')", {}],
  ['Notes', "switchTab('notes')", {}],
  ['Companies', "switchTab('companies')", { filters: 3 }],
  ['Contacts', "switchTab('contacts')", { filters: 3 }],
  ['Opportunities', "switchTab('opportunities')", { filters: 3 }],
  ['Proposals', "switchTab('database')", { filters: 3 }],
  ['Agreements', "switchTab('agreements')", { filters: 3 }],
  ['Services', "navToModule('pricing')", {}],
  ['Files', "switchTab('files')", {}],
  ['Watch', "switchTab('intelligence')", {}],
  ['Clean-up', "navToModule('cleanup')", {}],
  ['Company', "openRecord('company', 1)", {}],
  ['Contact', "openRecord('contact', 1)", { inputs: 1 }],
  ['Opportunity', "openRecord('opportunity', 1)", { inputs: 1 }],
  ['Proposal (in review)', "openRecord('proposal', 2)", { inputs: 2, buttons: 8 }],
  ['Proposal (sent)', "openRecord('proposal', 3)", { inputs: 2, buttons: 8 }],
  ['Agreement', "openRecord('agreement', 1)", { inputs: 1 }],
  ['Project', "openRecord('project', 1)", { inputs: 1 }],
  ['Meeting', "openRecord('meeting', 2)", {}],
  ['New proposal', "openProposalBuilder({})", { fitsScreen: true }],
];
const COUNT = `(() => {
  const H = innerHeight, W = innerWidth;
  const chrome = '.sidebar, #sidebar, #loc-bar, #record-rail, .modal-ov:not(.open), .toast-stack, #toast-stack';
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= H || r.right <= 0 || r.left >= W) return false;
    const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity === 0) return false; return !el.closest(chrome); };
  const inputs = [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, [contenteditable=true]')].filter(vis);
  const filters = inputs.filter((el) => el.closest('.fbar, .co-search-bar, .page-filters, .list-filters, .filter-bar')).length;
  const buttons = [...document.querySelectorAll('button, a.btn-primary, a.btn-secondary')].filter((b) => vis(b) && !b.classList.contains('rlink')).length;
  const primary = [...document.querySelectorAll('.btn-primary')].filter(vis).length;
  return JSON.stringify({ inputs: inputs.length, filters, buttons, primary, height: document.scrollingElement.scrollHeight });
})()`;

const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'focus-'))}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
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

await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const results = [];
for (const [name, js, t] of VIEWS) {
  await send('Page.navigate', { url: URL });
  await sleep(2500);
  await evalJs(`(${js}), new Promise(r => setTimeout(r, 1200))`);
  await evalJs('window.scrollTo(0,0)');
  const c = JSON.parse(await evalJs(COUNT));
  const problems = [];
  if (c.primary > 1) problems.push(`${c.primary} blue buttons`);
  if (t.inputs != null && c.inputs > t.inputs) problems.push(`${c.inputs} inputs (target ≤${t.inputs})`);
  if (t.buttons != null && c.buttons > t.buttons) problems.push(`${c.buttons} buttons (target ≤${t.buttons})`);
  if (t.filters != null && c.filters > t.filters) problems.push(`${c.filters} filter controls (target ≤${t.filters})`);
  if (t.fitsScreen && c.height > 900) problems.push(`${c.height}px tall (target one screen)`);
  results.push({ name, ...c, problems });
}
ws.close(); chrome.kill();
if (process.argv.includes('--json')) console.log(JSON.stringify(results, null, 1));
else for (const r of results) console.log(`${r.problems.length ? '✗' : '✓'} ${r.name.padEnd(22)} inputs ${String(r.inputs).padStart(2)} · buttons ${String(r.buttons).padStart(2)} · blue ${r.primary}${r.filters ? ` · filters ${r.filters}` : ''}${r.problems.length ? `  — ${r.problems.join(', ')}` : ''}`);
process.exit(results.some((r) => r.problems.length) ? 1 : 0);
