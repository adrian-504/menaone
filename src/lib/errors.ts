// Errors nobody caught (foundations O1): written to the app's log, and one
// quiet toast — "Something went wrong — details copied" — with a short report
// on the clipboard to send on: version, page, the error and the top five lines
// of its stack. Redacted: no email addresses, no phone numbers.

import { toast } from './ui';

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const PHONE = /\+?\d[\d\s-]{7,}\d/g;

export function redact(text: string): string {
  return text.replace(EMAIL, '[email]').replace(PHONE, '[number]');
}

/** The report for one error, as copied to the clipboard. Pure. */
export function errorReport(err: unknown, where: { version: string; page: string }): string {
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err));
  const stack = (e.stack || '').split('\n').slice(1, 6).map((l) => l.trim()).join('\n');
  return redact(`MENA One ${where.version} · ${where.page}\n${e.name}: ${e.message}${stack ? `\n${stack}` : ''}`);
}

// Harmless browser noise, not our errors.
const IGNORE = /ResizeObserver loop|Script error\.?$/;
let lastToast = 0;

export function startErrorReporting(version: string, page: () => string, log: (level: string, message: string) => void): void {
  const report = (err: unknown) => {
    const text = errorReport(err, { version, page: page() });
    if (IGNORE.test(text)) return;
    log('error', text);
    if (Date.now() - lastToast < 10_000) return;
    lastToast = Date.now();
    void navigator.clipboard?.writeText(text).catch(() => undefined);
    toast('Something went wrong — details copied', { tone: 'error' });
  };
  window.addEventListener('error', (e) => report(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => report(e.reason));
}
