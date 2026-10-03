// The one way a script launches headless Chrome (1-Oct-2026: scripts that each
// made their own profile in the system temp folder and never removed it filled
// the Mac's internal disk — 80–180 MB a run, about 27 GB at the peak — and left
// Chromes running when a script threw).
//
// - The profile lives under the repo, in .cache/chrome/<script>-<pid> (git
//   ignores .cache; the repo is on DevSSD), never in the system temp folder.
// - It always cleans up: close() at the end of a run, and on SIGINT, SIGTERM,
//   an uncaught error or any process.exit — Chrome is ended (kill -9 after a
//   short grace period), its helper processes with it, then the profile goes.
// - At start it sweeps its own leftovers: folders in .cache/chrome older than
//   an hour whose process is no longer running. Only that folder, never the
//   system temp folder.
// - No other file under scripts/ may launch Chrome or make a temp folder:
//   release-check fails on "user-data-dir" or "mkdtemp" anywhere else.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PROFILES = join(ROOT, '.cache', 'chrome');
const STALE_MS = 60 * 60 * 1000;

/** A path under the repo's .cache folder (on DevSSD), for a script's output or build: cachePath('shots', 'pages'). */
export function cachePath(...parts) {
  return join(ROOT, '.cache', ...parts);
}

/** SAMPLE=scale: the script runs on the sample at the owner's real volumes (src/lib/scaleSample.ts) instead of the
 * small one. Nothing else turns it on. */
export const AT_SCALE = process.env.SAMPLE === 'scale';

/** The preview's address for a script: FOCUS_URL, else the dev server; with `?sample=scale` when SAMPLE=scale. */
export function appUrl(fallback = 'http://localhost:1420/') {
  const url = new URL(process.env.FOCUS_URL || fallback);
  if (AT_SCALE) url.searchParams.set('sample', 'scale');
  return url.href;
}

/** Where a script's screenshots go: OUT, else .cache/shots/<script>, and <script>-scale for the sample at scale so
 * the everyday shots are never overwritten. */
export function shotsPath(script) {
  return process.env.OUT || cachePath('shots', AT_SCALE ? `${script}-scale` : script);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sleepSync = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const remove = (dir) => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch { /* swept on a later run */ } };

/** Profiles left by a run that was killed outright: older than an hour, their process gone. */
function sweep() {
  let names = [];
  try { names = readdirSync(PROFILES); } catch { return; }
  for (const name of names) {
    const pid = Number(/-(\d+)$/.exec(name)?.[1]);
    const dir = join(PROFILES, name);
    try {
      if (!pid || alive(pid) || Date.now() - statSync(dir).mtimeMs < STALE_MS) continue;
    } catch { continue; }
    remove(dir);
  }
}

/** What is running for this script: Chromes with their profiles, and anything else it asked to be stopped. */
const running = new Set();
const extras = new Set();

/** Something else to stop when the script ends, however it ends (focus-check's preview server). */
export function onCleanup(fn) {
  extras.add(fn);
}

/** Ends everything now, without waiting on anything asynchronous: for a signal, an error or process.exit. */
function cleanupSync() {
  for (const c of running) {
    running.delete(c);
    c.closing = true;
    if (c.child.exitCode == null && c.child.signalCode == null) {
      try { c.child.kill('SIGTERM'); } catch { /* already gone */ }
      for (let i = 0; i < 15 && alive(c.child.pid); i++) sleepSync(100);
      if (alive(c.child.pid)) { try { c.child.kill('SIGKILL'); } catch { /* gone */ } }
    }
    // Chrome's helper processes carry the profile path on their command line; it is unique to this run.
    spawnSync('pkill', ['-9', '-f', c.profile], { stdio: 'ignore' });
    for (let i = 0; i < 20 && alive(c.child.pid); i++) sleepSync(100);
    remove(c.profile);
  }
  for (const fn of extras) { extras.delete(fn); try { fn(); } catch { /* best effort */ } }
}

let hooked = false;
function hook() {
  if (hooked) return;
  hooked = true;
  process.on('exit', cleanupSync);
  process.on('SIGINT', () => { cleanupSync(); process.exit(130); });
  process.on('SIGTERM', () => { cleanupSync(); process.exit(143); });
  process.on('SIGHUP', () => { cleanupSync(); process.exit(129); });
  process.on('uncaughtException', (e) => { console.error(e); cleanupSync(); process.exit(1); });
  process.on('unhandledRejection', (e) => { console.error(e); cleanupSync(); process.exit(1); });
}

/**
 * Starts headless Chrome for a script and connects to its page.
 * `name` is the script's own name (it names the profile folder); `port` a base for the debugging port.
 * Returns `send` (a DevTools call), `evalJs` (an expression's value), and `close` (end Chrome, remove the profile).
 */
export async function launchChrome(name, { port = 9300 + Math.floor(Math.random() * 600), hideScrollbars = true } = {}) {
  hook();
  sweep();
  const profile = join(PROFILES, `${name}-${process.pid}`);
  mkdirSync(profile, { recursive: true });
  const args = ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', ...(hideScrollbars ? ['--hide-scrollbars'] : []), 'about:blank'];
  const child = spawn(CHROME, args, { stdio: 'ignore' });
  const entry = { child, profile, closing: false };
  running.add(entry);
  // Chrome gone while the script still needs it (killed from outside, a crash): stop here rather than wait for ever
  // on an answer that will not come.
  child.once('exit', () => {
    if (entry.closing) return;
    console.error(`Chrome ended unexpectedly (${name}); stopping.`);
    cleanupSync();
    process.exit(1);
  });

  let target;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
  }
  if (!target) { console.error('Chrome did not start'); process.exit(2); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

  /** Ends Chrome and removes its profile; waits for the process to be gone first. */
  const close = async () => {
    if (!running.has(entry)) return;
    entry.closing = true;
    try { ws.close(); } catch { /* closed */ }
    const gone = new Promise((r) => { if (child.exitCode != null || child.signalCode != null) r(); else child.once('exit', r); });
    try { child.kill('SIGTERM'); } catch { /* gone */ }
    await Promise.race([gone, sleep(3000)]);
    if (alive(child.pid)) { try { child.kill('SIGKILL'); } catch { /* gone */ } await Promise.race([gone, sleep(2000)]); }
    spawnSync('pkill', ['-9', '-f', profile], { stdio: 'ignore' });
    running.delete(entry);
    remove(profile);
  };
  return { send, evalJs, close, port, profile };
}

/** Closes everything this script started, then exits with `code`. */
export async function finish(code = 0) {
  for (const c of [...running]) {
    c.closing = true;
    const gone = new Promise((r) => { if (c.child.exitCode != null || c.child.signalCode != null) r(); else c.child.once('exit', r); });
    try { c.child.kill('SIGTERM'); } catch { /* gone */ }
    await Promise.race([gone, sleep(3000)]);
  }
  cleanupSync();
  process.exit(code);
}
