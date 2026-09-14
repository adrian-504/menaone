// Filters and sort controls keep their values between visits and restarts.
// A per-device convenience, so it lives in localStorage. Values are restored
// once the control has the matching option (many selects fill their options
// on first render), and saved on change — and after the module's "Clear".

const KEY = 'menaone.filters';

function readAll(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}

function writeAll(values: Record<string, string>): void {
  try { localStorage.setItem(KEY, JSON.stringify(values)); } catch { /* not persisted this time */ }
}

function save(ids: string[]): void {
  const all = readAll();
  for (const id of ids) {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (!el) continue;
    if (el.value) all[id] = el.value; else delete all[id];
  }
  writeAll(all);
}

function hasOption(el: HTMLSelectElement, value: string): boolean {
  return [...el.options].some((o) => o.value === value || (!o.hasAttribute('value') && o.text === value));
}

export function rememberFilters(opts: { ids: string[]; clear?: string }): void {
  const saved = readAll();
  for (const id of opts.ids) {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    if (!el) continue;
    el.addEventListener('change', () => save(opts.ids));
    const value = saved[id];
    if (!value) continue;
    if (el instanceof HTMLSelectElement && !hasOption(el, value)) {
      // Options arrive on first render: apply as soon as the saved one exists.
      const observer = new MutationObserver(() => {
        if (!hasOption(el, value)) return;
        observer.disconnect();
        if (el.value !== value) { el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); }
      });
      observer.observe(el, { childList: true });
      continue;
    }
    el.value = value;
  }
  if (opts.clear) {
    const w = window as any;
    const original = w[opts.clear];
    if (typeof original === 'function') {
      w[opts.clear] = (...args: unknown[]) => { const r = original(...args); save(opts.ids); return r; };
    }
  }
}
