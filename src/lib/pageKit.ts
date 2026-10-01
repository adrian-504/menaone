// The list pages in My Day's language (1.59 "pages", owner, 1-Oct-2026: "the
// entire app should follow this style"). One kit for the seven list pages —
// Pending, Follow-up, Proposals, Opportunities, Companies, Meetings,
// Projects: a page head, a summary strip whose panels filter the list below,
// group headers, client tiles, money and ages in display type. The pages
// compute their own figures (pure, in lib/pages*.ts); this draws them.

import { escHtml, strColor } from './utils';
import { initialsOf } from './appearance';
import { addMoney, fmtMoneyByCurrency, REPORTING_CURRENCY, type MoneyByCurrency } from './commercial';

/** Colour by role (docs/ux-conventions.md, "Brand"). */
export type Tone = 'coral' | 'coral-text' | 'blue' | 'amber' | 'red' | 'green' | 'grey' | 'navy';

export interface StripPanel {
  /** The bucket a click filters the list to. */
  key: string;
  /** The display figure: a count, or money on the total panel. */
  n: string;
  /** How many items the panel stands for; a 0 panel is hidden. */
  count: number;
  label: string;
  /** The quiet word before the detail: "oldest", "next", "soonest". */
  lead?: string;
  detail?: string;
  tone: Tone;
  /** The navy panel: the page's total. It isn't a filter. */
  total?: boolean;
  /** A panel that opens something instead of filtering (a JS call, e.g. "openPeopleFromMeetings()"). */
  action?: string;
  /** Shown even at 0 (in a neutral tone), where the 0 is worth saying. */
  keepZero?: boolean;
}

/** The panels worth showing: the total always, the others when they hold something. Pure. */
export function visiblePanels(panels: StripPanel[]): StripPanel[] {
  return panels.filter((p) => p.total || p.count > 0 || p.keepZero);
}

/** A panel click: pick that bucket, or clear it on the second click. Pure. */
export function toggleBucket(current: string | null, key: string): string | null {
  return current === key ? null : key;
}

/** The bucket a page is filtered to; null for everything. Forgotten when the page's bucket empties. */
const buckets = new Map<string, string | null>();
const rerender = new Map<string, () => void>();

export function bucketOf(page: string): string | null {
  return buckets.get(page) ?? null;
}

/** A page's renderer, so a panel click can redraw it. */
export function registerStrip(page: string, render: () => void): void {
  rerender.set(page, render);
}

export function stripPick(page: string, key: string): void {
  buckets.set(page, toggleBucket(bucketOf(page), key));
  rerender.get(page)?.();
}

export function clearBucket(page: string): void {
  buckets.delete(page);
}

/** The strip: a navy total, then one panel per bucket with a 3px edge in its colour. */
export function stripHtml(page: string, panels: StripPanel[], opts: { flex?: (p: StripPanel) => number; pipe?: boolean } = {}): string {
  const shown = visiblePanels(panels);
  if (!shown.length) return '';
  const active = bucketOf(page);
  const cells = shown.map((p) => {
    // The edge keeps the tone's colour; an amber detail line is text on a tinted panel, so it takes the deeper amber.
    const style = `--c:var(--${toneVar(p.tone)})${p.tone === 'amber' ? ';--ct:var(--amber-deep)' : ''}${opts.flex ? `;flex:${opts.flex(p)}` : ''}`;
    const detail = p.detail ? `<div class="pk-st-d">${p.lead ? `<span>${escHtml(p.lead)}</span>` : ''}${escHtml(p.detail)}</div>` : '';
    if (p.total) {
      return `<div class="pk-st is-total" style="${style}"><div class="pk-st-n" data-roll="strip-${page}-${p.key}">${escHtml(p.n)}</div><div class="pk-st-l">${escHtml(p.label)}</div>${detail}</div>`;
    }
    const on = active === p.key;
    const body = opts.pipe
      ? `<span class="pk-st-n" data-roll="strip-${page}-${p.key}">${escHtml(p.n)}</span><div class="pk-st-l">${escHtml(p.label)}</div>${detail}`
      : `<div class="pk-st-top"><span class="pk-st-n" data-roll="strip-${page}-${p.key}">${escHtml(p.n)}</span><span class="pk-st-l">${escHtml(p.label)}</span></div>${detail}`;
    return p.action
      ? `<button type="button" class="pk-st" style="${style}" onclick="${escHtml(p.action)}">${body}</button>`
      : `<button type="button" class="pk-st${on ? ' is-on' : ''}" data-key="${p.key}" style="${style}" aria-pressed="${on}" onclick="stripPick('${page}','${p.key}')">${body}</button>`;
  }).join(opts.pipe ? '<span class="pk-arrow" aria-hidden="true">›</span>' : '');
  return `<div class="pk-strip${opts.pipe ? ' is-pipe' : ''}${opts.flex ? ' is-flex' : ''}" style="--cols:${shown.length}">${cells}</div>`;
}

export function toneVar(t: Tone): string {
  return t === 'grey' ? 'muted' : t;
}

/** A group's header: a coloured dot, the name, its count and a quiet note on the right. */
export function groupHeadHtml(g: { tone: Tone; name: string; count: number; note?: string }): string {
  return `<div class="pk-gh" style="--c:var(--${toneVar(g.tone)})"><i></i><h2>${escHtml(g.name)}</h2><span class="pk-gh-cnt">${g.count}</span>${g.note ? `<span class="pk-gh-note">${escHtml(g.note)}</span>` : ''}</div>`;
}

/** A client's initials tile in one of the six brand colours. */
export function tileHtml(name: string, cls = 'pk-tile'): string {
  return `<span class="${cls}" style="background:${strColor(name || '?')}" aria-hidden="true">${escHtml(initialsOf(name) || '·')}</span>`;
}

/** An age by threshold: red at or past `red` days, amber at or past `amber`, else quiet. Pure. */
export function ageTone(days: number | null | undefined, t: { amber: number; red: number }): 'red' | 'amber' | 'ok' {
  if (days == null) return 'ok';
  return days >= t.red ? 'red' : days >= t.amber ? 'amber' : 'ok';
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** An age in display type with its caption: "23 days / in review". */
export function ageHtml(days: number | null, caption: string, tone: 'red' | 'amber' | 'ok'): string {
  return `<div class="pk-age t-${tone}"><b>${days == null ? '—' : escHtml(plural(days, 'day'))}</b><span>${escHtml(caption)}</span></div>`;
}

/** Money in display type, green; a muted "—" when there's no figure. */
export function valueHtml(amount: string | null, caption: string, shape = false): string {
  // No amount, but how it is priced is known ("per person per month"): say that, not a dash.
  if (!amount && shape) return `<div class="pk-val is-shape"><span>${escHtml(caption)}</span></div>`;
  return `<div class="pk-val${amount ? '' : ' is-none'}"><b>${amount ? escHtml(amount) : '—'}</b><span>${escHtml(caption)}</span></div>`;
}

/** A total across currencies, the reporting currency first: "SAR 13,500" or "SAR 13,500 · EUR 2,000". Pure. */
export function moneyTotal(items: { amount: number | null | undefined; currency?: string | null }[]): string {
  const m: MoneyByCurrency = {};
  for (const it of items) addMoney(m, it.currency || REPORTING_CURRENCY, it.amount);
  return fmtMoneyByCurrency(m);
}

/** A small chip: ⚑ promised, ◷ offer expires. */
export function chipHtml(text: string, tone: 'red' | 'amber' | 'green' | 'blue' | 'grey' | 'coral'): string {
  return `<span class="pk-chip t-${tone}">${escHtml(text)}</span>`;
}

/** The page head: Saira title naming the page, three coral bars, a one-line subtitle. */
export function headTitleHtml(title: string, sub: string): string {
  return `<div class="pk-head-t"><div class="page-title">${escHtml(title)}</div><span class="bars lg" aria-hidden="true"><i></i><i></i><i></i></span><div class="page-subtitle">${escHtml(sub)}</div></div>`;
}
