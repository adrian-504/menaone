// Rolling numbers (owner, 30-Sep-2026: "it's the small things"). When a count
// or an amount changes because of something you did, it counts to the new
// value over --dur-slow (ease-out) instead of snapping — a plain numeric tween
// in tabular figures, formatting kept ("SAR 15,000"). Never on load: a number
// only rolls when it was already on screen with another value.
//
// Covered without touching the renderers: sidebar badges, record tab counts
// and section counts (they update in place), and any number marked
// data-roll="<key>" — redrawn elements carry the key, so the last value shown
// for that key is where the roll starts.

const WATCH = '.sb-badge, [id$="-tab-count"], .rec-count, .rcnt, [data-roll]';
const NUM = /-?\d[\d,]*(?:\.\d+)?/;

export function parseNumber(text: string): number | null {
  const m = NUM.exec(text);
  return m ? Number(m[0].replace(/,/g, '')) : null;
}

/** The text for `n` shaped like `sample` (its prefix, suffix, decimals and thousands commas). */
export function formatLike(sample: string, n: number): string {
  const m = NUM.exec(sample);
  if (!m) return String(n);
  const decimals = (m[0].split('.')[1] || '').length;
  const commas = m[0].includes(',') || Math.abs(n) >= 1000 && /,/.test(sample);
  const body = n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: commas });
  return sample.slice(0, m.index) + body + sample.slice(m.index + m[0].length);
}

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const ease = (t: number) => 1 - (1 - t) ** 3;
const written = new WeakMap<Element, string>();
const lastByKey = new Map<string, number>();

function duration(): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--dur-slow').trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? (v.endsWith('ms') ? n : n * 1000) : 260;
}

/** Counts `el` from `from` to `to`, ending exactly on the text it was given. */
export function rollNumber(el: HTMLElement, from: number, to: number): void {
  const finalText = el.textContent || '';
  if (from === to || reduced()) return;
  const ms = duration();
  const start = performance.now();
  const decimals = ((NUM.exec(finalText)?.[0] || '').split('.')[1] || '').length;
  const step = () => {
    if (!el.isConnected || written.get(el) !== el.textContent) return; // someone else wrote since
    const t = Math.min(1, (performance.now() - start) / ms);
    const n = t >= 1 ? to : Number((from + (to - from) * ease(t)).toFixed(decimals));
    const text = t >= 1 ? finalText : formatLike(finalText, n);
    written.set(el, text);
    el.textContent = text;
    if (t < 1) requestAnimationFrame(step);
  };
  written.set(el, formatLike(finalText, from));
  el.textContent = written.get(el)!;
  requestAnimationFrame(step);
  // A hidden window runs no frames: land on the real value regardless.
  window.setTimeout(() => { if (el.isConnected && written.get(el) === el.textContent && el.textContent !== finalText) { written.set(el, finalText); el.textContent = finalText; } }, ms + 80);
}

export function startRollingNumbers(): void {
  new MutationObserver((records) => {
    for (const r of records) {
      const target = (r.type === 'characterData' ? r.target.parentElement : r.target) as HTMLElement | null;
      if (target?.matches?.(WATCH) && !target.hasAttribute('data-roll')) {
        const now = target.textContent || '';
        if (written.get(target) === now) continue; // our own frame
        const before = r.type === 'characterData' ? r.oldValue || '' : [...r.removedNodes].map((n) => n.textContent || '').join('');
        const from = parseNumber(before);
        const to = parseNumber(now);
        if (from != null && to != null && from !== to && before !== '') { written.set(target, now); rollNumber(target, from, to); }
        continue;
      }
      r.addedNodes.forEach((n) => {
        if (!(n instanceof HTMLElement)) return;
        const keyed = [...(n.matches('[data-roll]') ? [n] : []), ...n.querySelectorAll<HTMLElement>('[data-roll]')];
        for (const el of keyed) {
          const key = el.dataset.roll!;
          const to = parseNumber(el.textContent || '');
          if (to == null) continue;
          const from = lastByKey.get(key);
          lastByKey.set(key, to);
          if (from != null && from !== to) { written.set(el, el.textContent || ''); rollNumber(el, from, to); }
        }
      });
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, characterDataOldValue: true });
}
