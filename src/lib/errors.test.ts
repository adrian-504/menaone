// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { errorReport, redact } from './errors';

describe('error reports', () => {
  it('never carry an email address or a phone number', () => {
    expect(redact('Could not send to sara@contoso.test (+966 50 123 4567)')).toBe('Could not send to [email] ([number])');
  });

  it('name the version, the page, the error and five lines of stack', () => {
    const e = new TypeError('x is undefined');
    e.stack = ['TypeError: x is undefined', 'at a (a.ts:1)', 'at b (b.ts:2)', 'at c (c.ts:3)', 'at d (d.ts:4)', 'at e (e.ts:5)', 'at f (f.ts:6)'].join('\n');
    const r = errorReport(e, { version: '1.54', page: 'proposal' }).split('\n');
    expect(r[0]).toBe('MENA One 1.54 · proposal');
    expect(r[1]).toBe('TypeError: x is undefined');
    expect(r.slice(2)).toEqual(['at a (a.ts:1)', 'at b (b.ts:2)', 'at c (c.ts:3)', 'at d (d.ts:4)', 'at e (e.ts:5)']);
  });
});
