// Focus check (docs/ux-conventions.md, "Focus"): opens every main view of the
// app on its sample data (src/lib/devMock.ts — never the real database) in
// headless Chrome at 1440x900 and counts what is visible before scrolling,
// outside the sidebar, location bar and record rail: input boxes, buttons,
// blue (primary) buttons. Fails when a view shows more than one primary, a
// select sits in a list row, an empty text box comes first, or a page is over
// its targets, a view shifts layout after it opens (CLS > 0.01 in 1.5 s), or a
// list loses its scroll position when you leave and come back, or a row action
// (Follow-up, Pending, Proposals) moves the page or drops the keyboard focus.
//
// By default it builds the app once (with the sample data compiled in) and
// serves that build with `vite preview` on port 1430, so nothing re-bundles or
// reloads the page mid-run. `--dev` (or FOCUS_URL) checks a running dev server
// instead — quicker while iterating (`npm run dev`, default http://localhost:1420/).
// `--stable` opens My Day three times at 1080 × 940 (stacked) and 1680 × 1020
// (docked) and fails a size only if all three attempts fail.
// `node scripts/focus-check.mjs [--dev] [--stable] [--json]`
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { cachePath, finish, launchChrome, onCleanup, sleep } from './lib/chrome.mjs';

const DEV = process.argv.includes('--dev') || !!process.env.FOCUS_URL;
const STABLE = process.argv.includes('--stable');
const PREVIEW_PORT = 1430;
const APP_URL = DEV ? process.env.FOCUS_URL || 'http://localhost:1420/' : `http://localhost:${PREVIEW_PORT}/`;
// The window (default 1440 × 900); VW=1080 VH=940 or VW=1680 VH=1020 check My Day's stacked and docked layouts.
const VW = Number(process.env.VW || 1440), VH = Number(process.env.VH || 900);
// --stable: My Day's two layouts, three tries each.
const STABLE_SIZES = [[1080, 940], [1680, 1020]], TRIES = 3;
// [name, how to open it, targets]
// A tab only renders when its module is loaded: tab modules register their
// renderer as a side effect, so src/main.ts imports each one (import './tabs/x').
// Removing a tab's last named import without that line leaves the tab empty.
const VIEWS = [
  ['My Day', "switchTab('myday')", {}],
  ['Inbox', "switchTab('inbox')", {}],
  ['Tasks', "switchTab('todo')", {}],
  ['Tasks → Promises', "switchTab('todo'), setTodoFilter('promises')", {}],
  ['Tasks → a row selected', "switchTab('todo'), setTodoFilter('anytime'), openTaskDetail(1)", { inputs: 10 }],
  ['Projects', "switchTab('projects')", {}],
  ['Meetings', "switchTab('meetings')", {}],
  ['Notes', "switchTab('notes')", {}],
  ['Notes → a note open', "switchTab('notes'), openNote(3)", { inputs: 4 }],
  ['Calendar (week)', "switchTab('calendar'), setCalendarView('week')", {}],
  ['Calendar (day)', "switchTab('calendar'), setCalendarView('day')", {}],
  ['Companies', "switchTab('companies')", { filters: 3 }],
  ['Contacts', "switchTab('contacts')", { filters: 3 }],
  ['Opportunities', "switchTab('opportunities')", { filters: 3 }],
  ['Pending', "switchTab('pending')", { filters: 3, rowKeep: 'renderPending()' }],
  ['Follow-up', "switchTab('followup')", { rowKeep: "logTouch(ID, 'email_out')" }],
  ['Proposals', "switchTab('database')", { filters: 3, rowKeep: 'renderDB()' }],
  ['Agreements', "switchTab('agreements')", { filters: 3 }],
  ['Services', "navToModule('pricing')", {}],
  ['Files', "switchTab('files')", {}],
  ['Watch', "switchTab('intelligence')", {}],
  ['Clean-up', "navToModule('cleanup')", {}],
  ['Company', "openRecord('company', 1)", {}],
  ['Contact', "openRecord('contact', 1)", { inputs: 1 }],
  ['Opportunity', "openRecord('opportunity', 1)", { inputs: 1 }],
  ['Opportunity (no next step)', "openRecord('opportunity', 2)", { inputs: 2 }],
  ['Proposal (in review)', "openRecord('proposal', 2)", { inputs: 2, buttons: 8 }],
  ['Proposal (sent)', "openRecord('proposal', 3)", { inputs: 2, buttons: 8 }],
  ['Agreement', "openRecord('agreement', 1)", { inputs: 1 }],
  ['Project', "openRecord('project', 1)", { inputs: 1 }],
  ['Meeting', "openRecord('meeting', 2)", {}],
  ['New proposal', "openProposalBuilder({})", { fitsScreen: true }],
  ['Files → client folders', "switchTab('files'), msFilesLayout('icons'), msFilesNavigateToPath('/Users/demo/Library/CloudStorage/OneDrive-MENABIG/MENA BD 2026/Proposals')", {}],
  ['Settings → General', "navToModule('settings'), setSettingsPane('general')", { inputs: 9 }],
  ['Settings → Appearance', "navToModule('settings'), setSettingsPane('appearance')", {}],
  ['Settings → Team', "navToModule('settings'), setSettingsPane('team')", { inputs: 12 }],
  ['Settings → Business', "navToModule('settings'), setSettingsPane('business')", { inputs: 12 }],
  ['Settings → Templates', "navToModule('settings'), setSettingsPane('templates')", {}],
  ['Settings → Connections', "navToModule('settings'), setSettingsPane('connections')", { inputs: 4 }],
  ['Settings → Data', "navToModule('settings'), setSettingsPane('data')", {}],
  // Chrome (1.63): the pop-ups, each opened over a page. One primary per surface, nothing shifts, no error toasts.
  ['New menu', "switchTab('myday'), document.getElementById('sb-new-btn').click()", { inputs: 1 }],
  ['New task dialog', "switchTab('myday'), openTodoModal(null)", { inputs: 12 }],
  ['New meeting dialog', "switchTab('myday'), openMeetingModal(null)", { inputs: 10 }],
  ['Palette with a query', "switchTab('myday'), openCommandPalette(), onPaletteInput('acme'), new Promise(r => setTimeout(r, 500))", { inputs: 1 }],
  ['Context menu', "switchTab('todo'), setTodoFilter('anytime'), todoContextMenu(new MouseEvent('contextmenu', { clientX: 700, clientY: 400, bubbles: true }), 1)", {}],
  ['Undo toast', "switchTab('todo'), setTodoFilter('anytime'), moveOverdueToToday()", {}],
  // Identity: Agreements is hidden in the sidebar by default; while it's open its item shows, highlighted.
  ['Sidebar → hidden module active', "navToModule('agreements')", { activeShown: true }],
  // Studio: the Generate sheet over a proposal (counted inside the sheet), and the builder's
  // company suggestion list must not survive leaving the builder.
  ['Generate sheet', "openRecord('proposal', 3), openGenerateProposal(3)", {}],
  ['Builder → away', "openProposalBuilder({}), (() => { const c = document.getElementById('prb-client'); c.focus(); c.value = 'Acme'; c.dispatchEvent(new Event('input', { bubbles: true })); })(), openRecord('proposal', 3)", { noPopover: true }],
];
const COUNT = `(() => {
  const H = innerHeight, W = innerWidth;
  const chrome = '.sidebar, #sidebar, #loc-bar, #record-rail, .modal-ov:not(.open), .toast-stack, #toast-stack, .undo-stack';
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= H || r.right <= 0 || r.left >= W) return false;
    const s = getComputedStyle(el); if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity === 0) return false;
    // Hidden by an ancestor too (row actions that only show on hover sit in a wrapper at opacity 0).
    for (let p = el.parentElement; p; p = p.parentElement) if (+getComputedStyle(p).opacity === 0) return false;
    return !el.closest(chrome); };
  // With a dialog or sheet open, only what's in it counts (the page behind is dimmed).
  const dialog = [...document.querySelectorAll('.modal-ov.open')].pop();
  const inScope = (el) => !dialog || dialog.contains(el);
  const inputs = [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, [contenteditable=true]')].filter(vis).filter(inScope);
  const filters = inputs.filter((el) => el.closest('.fbar, .co-search-bar, .page-filters, .list-filters, .filter-bar')).length;
  const btns = [...document.querySelectorAll('button, a.btn-primary, a.btn-secondary')].filter((b) => vis(b) && !b.classList.contains('rlink')).filter(inScope);
  const buttons = btns.length;
  const names = btns.map((b) => (b.textContent || '').trim().slice(0, 20) || b.getAttribute('aria-label') || b.title);
  const primary = [...document.querySelectorAll('.btn-primary')].filter(vis).filter(inScope).length;
  const popover = !!document.querySelector('.company-selector-popover.open');
  // A list row is read, not edited: no select in a table row.
  const rowSelects = [...document.querySelectorAll('tbody tr select')].filter(vis).length;
  // The first thing on a page shouldn't be an empty box asking to be filled (a create page's first field is an input, not this).
  const first = inputs.slice().sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
  const emptyBoxFirst = !!first && first.tagName === 'TEXTAREA' && !first.value.trim() && !first.hasAttribute('data-typing'); // data-typing: a box whose job right now is to be typed in (rule 2)
  // Settle-in (.is-new) is for things the user just added, never for a render.
  const isNew = document.querySelectorAll('.is-new').length;
  // Nothing threw while the view drew (the error reporter shows a red toast).
  const errorToasts = [...document.querySelectorAll('.toast-error')].map((t) => t.textContent.trim().slice(0, 60));
  // Eyebrows (brand slice): small uppercase labels anywhere on the page, not only the first screen.
  const shown = (el) => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && !el.closest(chrome); };
  const eyebrows = [...document.querySelectorAll('body *')].filter((el) => {
    const s = getComputedStyle(el);
    if (s.textTransform !== 'uppercase' || parseFloat(s.fontSize) > 11.6) return false;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    return own && shown(el) && !el.parentElement.closest('[data-eyebrow-counted]') && (el.setAttribute('data-eyebrow-counted', ''), true);
  }).length;
  document.querySelectorAll('[data-eyebrow-counted]').forEach((el) => el.removeAttribute('data-eyebrow-counted'));
    const act = document.querySelector('#sidebar .sb-item.active');
  const activeShown = !!act && !act.hidden && act.offsetParent !== null;
  return JSON.stringify({ activeShown, errorToasts, popover, inputs: inputs.length, filters, buttons, primary, height: document.scrollingElement.scrollHeight, names, rowSelects, emptyBoxFirst, isNew, eyebrows });
})()`;

const root = fileURLToPath(new URL('..', import.meta.url));
const vite = join(root, 'node_modules/.bin/vite');
let preview;
if (!DEV) {
  // A build with the sample data in it: NODE_ENV=development keeps import.meta.env.DEV true (devMock, gallery).
  const out = cachePath('focus-build');
  const built = await new Promise((r) => spawn(vite, ['build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development' } }).on('exit', r));
  if (built !== 0) { console.error('vite build failed'); process.exit(2); }
  preview = spawn(vite, ['preview', '--outDir', out, '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: root, stdio: 'ignore' });
  // However the script ends, the preview server ends with it.
  onCleanup(() => preview.kill());
  let up = false;
  for (let i = 0; i < 50 && !up; i++) { await sleep(200); try { up = (await fetch(APP_URL)).ok; } catch {} }
  if (!up) { preview.kill(); console.error(`vite preview did not start on port ${PREVIEW_PORT} (in use?)`); process.exit(2); }
}
const { send, evalJs } = await launchChrome('focus-check', { port: 9400 + Math.floor(Math.random() * 400) });

// Ready = the app has started and painted My Day (not a fixed wait: the dev server can reload the page
// while it re-bundles, and a view switched before the app is up is measured half-drawn).
const ready = async () => {
  for (let i = 0; i < 50; i++) {
    if (await evalJs(`typeof window.switchTab === 'function' && performance.getEntriesByName('myday-painted').length > 0`)) return;
    await sleep(200);
  }
};
/** Opens each view at vw × vh and returns what it counted and what's wrong. */
async function check(views, vw, vh) {
const results = [];
await send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile: false });
for (const [name, js, t] of views) {
  await send('Page.navigate', { url: APP_URL });
  await sleep(1000);
  await ready();
  await sleep(500);
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
    // A row action redraws the list: the page stays where it is and the focus stays on the row (1.64).
    if (t.rowKeep) {
      const out = JSON.parse(await evalJs(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const rows = [...document.querySelectorAll('[data-row-id], tr[data-proposal-id]')].filter((r) => r.offsetParent);
        const row = rows[rows.length - 1];
        if (!row) return JSON.stringify({ none: true });
        const id = row.dataset.rowId || row.dataset.proposalId;
        const ctl = [...row.querySelectorAll('button:not([disabled])')].filter((b) => b.offsetParent).pop();
        window.scrollTo(0, 160); await wait(150);
        ctl.focus({ preventScroll: true });
        const y0 = window.scrollY;
        await (${JSON.stringify(t.rowKeep)}.includes('ID') ? eval(${JSON.stringify(t.rowKeep)}.replace('ID', id)) : eval(${JSON.stringify(t.rowKeep)}));
        await wait(500);
        const a = document.activeElement, r = a && a.closest('[data-row-id], tr[data-proposal-id]');
        return JSON.stringify({ y0, y1: window.scrollY, focus: !!r && a.isConnected && (r.dataset.rowId || r.dataset.proposalId) === id });
      })()`));
      c.rowKeep = out.none ? 'no rows' : `${out.y0}→${out.y1}${out.focus ? '' : ', focus lost'}`;
      if (!out.none && (out.y0 <= 0 || Math.abs(out.y1 - out.y0) > 2 || !out.focus)) c.rowKeepLost = true;
    }
    await send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile: false });
  }
  const problems = [];
  if (c.primary > 1) problems.push(`${c.primary} blue buttons`);
  if (t.inputs != null && c.inputs > t.inputs) problems.push(`${c.inputs} inputs (target ≤${t.inputs})`);
  if (t.buttons != null && c.buttons > t.buttons) problems.push(`${c.buttons} buttons (target ≤${t.buttons})`);
  if (t.filters != null && c.filters > t.filters) problems.push(`${c.filters} filter controls (target ≤${t.filters})`);
  if (t.fitsScreen && c.height > vh) problems.push(`${c.height}px tall (target one screen, ${vh})`);
  if (c.rowSelects) problems.push(`${c.rowSelects} selects in list rows`);
  if (c.emptyBoxFirst) problems.push('an empty text box comes first');
  if (c.cls > 0.01) problems.push(`layout shift ${c.cls}`);
  if (c.isNew) problems.push(`${c.isNew} .is-new on a cold render`);
  if (c.scrollLost) problems.push(`scroll not kept (${c.scroll})`);
  if (c.rowKeepLost) problems.push(`a row action lost the place (${c.rowKeep})`);
  if (t.activeShown && !c.activeShown) problems.push('the open module has no visible sidebar item');
  if (c.errorToasts.length) problems.push(`error toast: ${c.errorToasts.join(' | ')}`);
  if (t.noPopover && c.popover) problems.push('the company suggestion list is still open');
  results.push({ name, ...c, problems });
}
return results;
}
const line = (r) => `${r.problems.length ? '✗' : '✓'} ${r.name.padEnd(22)} inputs ${String(r.inputs).padStart(2)} · buttons ${String(r.buttons).padStart(2)} · blue ${r.primary}${r.filters ? ` · filters ${r.filters}` : ''}${r.eyebrows != null ? ` · eyebrows ${r.eyebrows}` : ''} · shift ${r.cls}${r.scroll ? ` · scroll ${r.scroll}` : ''}${r.rowKeep ? ` · row action ${r.rowKeep}` : ''}${r.problems.length ? `  — ${r.problems.join(', ')}` : ''}`;
const done = (code) => finish(code);

if (STABLE) {
  const myday = VIEWS.filter(([n]) => n === 'My Day');
  let failed = false;
  for (const [w, h] of STABLE_SIZES) {
    const tries = [];
    for (let i = 0; i < TRIES; i++) tries.push((await check(myday, w, h))[0]);
    const passed = tries.filter((r) => !r.problems.length).length;
    if (!passed) failed = true;
    console.log(`${passed ? '✓' : '✗'} My Day at ${w} × ${h}: ${passed}/${TRIES} passed`);
    for (const r of tries) console.log(`    ${line(r)}`);
  }
  await done(failed ? 1 : 0);
}

const results = await check(VIEWS.filter(([n]) => !process.env.ONLY || n.startsWith(process.env.ONLY)), VW, VH);
// The sidebar toggle is measured after its slide (delight 0a): once it has
// settled, nothing on the page moves.
if (!process.env.ONLY) {
  await send('Page.navigate', { url: APP_URL });
  await sleep(1000);
  await ready();
  await evalJs(`switchTab('myday'), toggleSidebar(), new Promise(r => setTimeout(r, 700))`);
  await evalJs(`window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: false })`);
  const cls = await evalJs('new Promise(r => setTimeout(() => r(Math.round(window.__cls * 1000) / 1000), 1500))');
  await evalJs('toggleSidebar()');
  results.push({ name: 'Sidebar collapsed', inputs: 0, buttons: 0, primary: 0, cls, names: [], problems: cls > 0.01 ? [`layout shift ${cls} after the slide`] : [] });
}
if (process.env.ONLY) for (const r of results) console.log(r.name, r.names.join(' | '));
if (process.argv.includes('--json')) console.log(JSON.stringify(results, null, 1));
else for (const r of results) console.log(line(r));
await done(results.some((r) => r.problems.length) ? 1 : 0);
