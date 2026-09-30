// Focus check (docs/ux-conventions.md, "Focus"): opens every main view of the
// dev preview (npm run dev — sample data only, never the real database) in
// headless Chrome at 1440x900 and counts what is visible before scrolling,
// outside the sidebar, location bar and record rail: input boxes, buttons,
// blue (primary) buttons. Fails when a view shows more than one primary, a
// select sits in a list row, an empty text box comes first, or a page is over
// its targets, a view shifts layout after it opens (CLS > 0.01 in 1.5 s), or a
// list loses its scroll position when you leave and come back.
// `node scripts/focus-check.mjs [--json]`
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.FOCUS_URL || 'http://localhost:1420/';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// [name, how to open it, targets]
// A tab only renders when its module is loaded: tab modules register their
// renderer as a side effect, so src/main.ts imports each one (import './tabs/x').
// Removing a tab's last named import without that line leaves the tab empty.
const VIEWS = [
  ['My Day', "switchTab('myday')", {}],
  ['Inbox', "switchTab('inbox')", {}],
  ['Tasks', "switchTab('todo')", {}],
  ['Tasks → Promises', "switchTab('todo'), setTodoFilter('promises')", {}],
  ['Projects', "switchTab('projects')", {}],
  ['Meetings', "switchTab('meetings')", {}],
  ['Notes', "switchTab('notes')", {}],
  ['Companies', "switchTab('companies')", { filters: 3 }],
  ['Contacts', "switchTab('contacts')", { filters: 3 }],
  ['Opportunities', "switchTab('opportunities')", { filters: 3 }],
  ['Pending', "switchTab('pending')", { filters: 3 }],
  ['Follow-up', "switchTab('followup')", {}],
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
  const btns = [...document.querySelectorAll('button, a.btn-primary, a.btn-secondary')].filter((b) => vis(b) && !b.classList.contains('rlink'));
  const buttons = btns.length;
  const names = btns.map((b) => (b.textContent || '').trim().slice(0, 20) || b.getAttribute('aria-label') || b.title);
  const primary = [...document.querySelectorAll('.btn-primary')].filter(vis).length;
  // A list row is read, not edited: no select in a table row.
  const rowSelects = [...document.querySelectorAll('tbody tr select')].filter(vis).length;
  // The first thing on a page shouldn't be an empty box asking to be filled (a create page's first field is an input, not this).
  const first = inputs.slice().sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
  const emptyBoxFirst = !!first && first.tagName === 'TEXTAREA' && !first.value.trim() && !first.hasAttribute('data-typing'); // data-typing: a box whose job right now is to be typed in (rule 2)
  // Settle-in (.is-new) is for things the user just added, never for a render.
  const isNew = document.querySelectorAll('.is-new').length;
  return JSON.stringify({ inputs: inputs.length, filters, buttons, primary, height: document.scrollingElement.scrollHeight, names, rowSelects, emptyBoxFirst, isNew });
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
for (const [name, js, t] of VIEWS.filter(([n]) => !process.env.ONLY || n.startsWith(process.env.ONLY))) {
  await send('Page.navigate', { url: URL });
  await sleep(2500);
  // Layout shift (motion system): from the switch to 1.5 s later, nothing should jump.
  await evalJs(`window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: false })`);
  await evalJs(`(${js}), new Promise(r => setTimeout(r, 1500))`);
  const cls = await evalJs('Math.round(window.__cls * 1000) / 1000');
  await evalJs('window.scrollTo(0,0)');
  const c = JSON.parse(await evalJs(COUNT));
  c.cls = cls;
  // A list keeps its scroll position when you leave it and come back.
  if (js.startsWith('switchTab(') && !js.includes('myday')) {
    // A short window, so even sample-data lists scroll.
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 420, deviceScaleFactor: 1, mobile: false });
    const y0 = await evalJs('new Promise(r => setTimeout(r, 200)).then(() => { window.scrollTo(0, 160); return new Promise(r => setTimeout(() => r(window.scrollY), 200)); })');
    await evalJs(`switchTab('myday'), new Promise(r => setTimeout(r, 400))`);
    const y1 = await evalJs(`(${js}), new Promise(r => setTimeout(() => r(window.scrollY), 600))`);
    c.scroll = y0 > 0 ? `${y0}→${y1}` : 'short';
    if (y0 > 0 && Math.abs(y1 - y0) > 2) c.scrollLost = true;
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  }
  const problems = [];
  if (c.primary > 1) problems.push(`${c.primary} blue buttons`);
  if (t.inputs != null && c.inputs > t.inputs) problems.push(`${c.inputs} inputs (target ≤${t.inputs})`);
  if (t.buttons != null && c.buttons > t.buttons) problems.push(`${c.buttons} buttons (target ≤${t.buttons})`);
  if (t.filters != null && c.filters > t.filters) problems.push(`${c.filters} filter controls (target ≤${t.filters})`);
  if (t.fitsScreen && c.height > 900) problems.push(`${c.height}px tall (target one screen)`);
  if (c.rowSelects) problems.push(`${c.rowSelects} selects in list rows`);
  if (c.emptyBoxFirst) problems.push('an empty text box comes first');
  if (c.cls > 0.01) problems.push(`layout shift ${c.cls}`);
  if (c.isNew) problems.push(`${c.isNew} .is-new on a cold render`);
  if (c.scrollLost) problems.push(`scroll not kept (${c.scroll})`);
  results.push({ name, ...c, problems });
}
// The sidebar toggle is measured after its slide (delight 0a): once it has
// settled, nothing on the page moves.
if (!process.env.ONLY) {
  await send('Page.navigate', { url: URL });
  await sleep(2500);
  await evalJs(`switchTab('myday'), toggleSidebar(), new Promise(r => setTimeout(r, 700))`);
  await evalJs(`window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: false })`);
  const cls = await evalJs('new Promise(r => setTimeout(() => r(Math.round(window.__cls * 1000) / 1000), 1500))');
  await evalJs('toggleSidebar()');
  results.push({ name: 'Sidebar collapsed', inputs: 0, buttons: 0, primary: 0, cls, names: [], problems: cls > 0.01 ? [`layout shift ${cls} after the slide`] : [] });
}
ws.close(); chrome.kill();
if (process.env.ONLY) for (const r of results) console.log(r.name, r.names.join(' | '));
if (process.argv.includes('--json')) console.log(JSON.stringify(results, null, 1));
else for (const r of results) console.log(`${r.problems.length ? '✗' : '✓'} ${r.name.padEnd(22)} inputs ${String(r.inputs).padStart(2)} · buttons ${String(r.buttons).padStart(2)} · blue ${r.primary}${r.filters ? ` · filters ${r.filters}` : ''} · shift ${r.cls}${r.scroll ? ` · scroll ${r.scroll}` : ''}${r.problems.length ? `  — ${r.problems.join(', ')}` : ''}`);
process.exit(results.some((r) => r.problems.length) ? 1 : 0);
