import { describe, expect, it } from 'vitest';
// @ts-ignore -- Node's fs, in a test only (the app itself has no Node types).
import { readFileSync, writeFileSync } from 'node:fs';
import {
  buildPhoneSnapshot, captureShapeErrors, isoWithOffset, shortLocation, snapshotContent, snapshotShapeErrors, stableJson,
  type PhoneSnapshot,
} from './phoneSnapshot';
import { phoneFixture, FIXTURE_TODAY } from './__fixtures__/phoneFixture';

const docs = (name: string) => new URL(`../../docs/phone/${name}`, import.meta.url);
const read = (name: string) => JSON.parse(readFileSync(docs(name), 'utf8'));

/** Every key path in a value (array items merged), to compare shapes. */
function keyPaths(v: unknown, path = ''): Set<string> {
  const out = new Set<string>();
  if (Array.isArray(v)) { for (const x of v) for (const p of keyPaths(x, `${path}[]`)) out.add(p); return out; }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) { out.add(`${path}.${k}`); for (const p of keyPaths(x, `${path}.${k}`)) out.add(p); }
  }
  return out;
}

// `WRITE_PHONE_EXAMPLES=1 npx vitest run src/lib/phoneSnapshot.test.ts` rewrites the example from the fixture.
// @ts-ignore -- process exists under Vitest
if (typeof process !== 'undefined' && process.env?.WRITE_PHONE_EXAMPLES) {
  writeFileSync(docs('snapshot.example.json'), `${JSON.stringify(buildPhoneSnapshot(phoneFixture()), null, 2)}\n`);
}

describe('the examples in docs/phone', () => {
  it('snapshot.example.json matches the contract and the builder output, key for key', () => {
    const example = read('snapshot.example.json');
    expect(snapshotShapeErrors(example)).toEqual([]);
    const built = buildPhoneSnapshot(phoneFixture());
    expect([...keyPaths(example)].sort()).toEqual([...keyPaths(built)].sort());
    // Meeting times are written in this Mac's zone; compare their wall-clock part.
    const wall = (x: unknown) => JSON.parse(JSON.stringify(x).replace(/("(?:startAt|endAt)":"[^"]{19})[^"]*"/g, '$1"'));
    expect(wall(example)).toEqual(wall(built));
  });

  it('capture.example.json is a valid capture', () => {
    expect(captureShapeErrors(read('capture.example.json'))).toEqual([]);
  });

  it('the capture check refuses what the Mac could not apply', () => {
    const base = read('capture.example.json');
    expect(captureShapeErrors({ ...base, format: 'mena-one-capture/2' })).toEqual(['format: mena-one-capture/2']);
    expect(captureShapeErrors({ ...base, direction: 'mine' })).toEqual(['direction: ours or theirs']);
    expect(captureShapeErrors({ ...base, kind: 'keep', commitmentId: null })).toEqual(['commitmentId: missing']);
    expect(captureShapeErrors({ ...base, kind: 'note', text: ' ' })).toEqual(['text: missing']);
  });
});

describe('buildPhoneSnapshot', () => {
  const s = buildPhoneSnapshot(phoneFixture());

  it('is the contract shape, with the header filled', () => {
    expect(snapshotShapeErrors(s)).toEqual([]);
    expect(s).toMatchObject({ format: 'mena-one-phone/1', today: FIXTURE_TODAY, mac: "Ahmad's MacBook Pro", importedCaptureIds: ['5b0c7a2e-3f41-4d7e-9a61-0c2d8e4f1a90'] });
  });

  it('attention is My Day\'s list, in its order', () => {
    expect(s.attention.map((a) => a.key)).toEqual(['commitment:83:overdue', 'proposal:41:approved', 'meeting:63:prepare', 'group:owed']);
    expect(s.attention[0]).toMatchObject({ kind: 'commitment', tone: 'red', companyId: 13, companyName: 'Fabrikam Engineering', commitmentId: 83, children: [] });
    // A group row carries its folded items.
    expect(s.attention[3].children.map((c) => c.key)).toEqual(['commitment:84:owed']);
    expect(s.attention[3].children[0].children).toEqual([]);
  });

  it('meetings: 30 days back to 30 ahead, cancelled ones out, locations shortened', () => {
    expect(s.meetings.map((m) => m.id)).toEqual([64, 61, 66, 62, 63, 65]);
    const byId = new Map(s.meetings.map((m) => [m.id, m]));
    expect(byId.get(61)!.location).toBe('Contoso office');
    expect(byId.get(62)!.location).toBe('Online');
    expect(byId.get(64)).toMatchObject({ location: 'Online', isOnline: true });
    expect(byId.get(65)).toMatchObject({ startAt: null, location: 'Tailspin Corniche Hotel', companyName: 'Tailspin Hotels' });
    expect(Date.parse(byId.get(62)!.startAt!)).toBe(Date.parse(new Date(`${'2026-09-25'}T10:00:00`).toISOString()));
    expect(byId.get(62)!.startAt).toMatch(/[+-]\d\d:\d\d$/);
  });

  it('tasks: open ones, each with the promise it keeps', () => {
    expect(s.tasks.map((t) => t.id)).toEqual([72, 71, 75, 76, 73, 74]);
    expect(s.tasks.find((t) => t.id === 71)).toMatchObject({ commitmentId: 81, companyName: 'Contoso Logistics', priority: 'High' });
    expect(s.tasks.find((t) => t.id === 73)).toMatchObject({ commitmentId: null, companyId: null, companyName: null });
  });

  it('promises: open, plus kept or dropped in the last 30 days', () => {
    expect(s.promises.map((p) => p.id)).toEqual([81, 82, 83, 84, 85, 86, 87]);
    expect(s.promises.find((p) => p.id === 82)).toMatchObject({ direction: 'theirs', contactName: 'Omar Nasser', contactEmail: 'omar@contoso.test', companyName: 'Contoso Logistics' });
    expect(s.promises.find((p) => p.id === 87)).toMatchObject({ status: 'dropped', closedAt: '2026-09-15T12:00:00Z' });
  });

  it('companies: not archived, each with its brief, threads, people and pins', () => {
    expect(s.companies.map((c) => c.name)).toEqual(['Contoso Logistics', 'Northwind Trading', 'Fabrikam Engineering', 'Tailspin Hotels']);
    const contoso = s.companies[0];
    expect(contoso.relationship).toEqual({ label: 'Active client', tone: 'green' });
    expect(contoso.brief[0]).toMatch(/^Active client since Mar 2026 — Administration at SAR 18,500 a month\./);
    expect(contoso.threads).toEqual([{ kind: 'proposal', label: 'Payroll', stand: 'proposal in internal review' }]);
    expect(contoso.lastContact).toEqual({ date: '2026-09-18', label: 'Meeting · Monthly check-in', kind: 'meeting' });
    expect(contoso.contacts.map((c) => c.name)).toEqual(['Sara Haddad', 'Omar Nasser']);
    expect(contoso.pinnedNotes).toEqual([{ id: 91, body: 'Prefers WhatsApp; no calls before 10.', createdAt: '2026-08-02' }]);
    expect(contoso).toMatchObject({ recentMeetingIds: [62, 61], openTaskIds: [71], openPromiseIds: [81, 82] });
    // The pinned clause is carried by pinnedNotes, not repeated in the brief.
    expect(contoso.brief.every((b) => b.trim())).toBe(true);
  });

  it('coming up: the next seven days, as My Day shows them', () => {
    expect(s.comingUp.map((d) => [d.date, d.entries.map((e) => e.label)])).toEqual([
      ['2026-09-25', ['Payroll kick-off · Contoso Logistics', 'Recruitment brief · Northwind Trading']],
      ['2026-09-26', ['Send the payroll proposal · Contoso Logistics']],
      ['2026-09-29', ['Chase the Northwind shortlist · Northwind Trading']],
      ['2026-09-30', ['Prepare the Q4 pipeline review']],
    ]);
    expect(s.comingUp[0].entries[0]).toMatchObject({ kind: 'meeting', id: 62, time: '10:00' });
  });

  it('records with no company link keep their typed name, unlinked', () => {
    const f = phoneFixture();
    f.todos.push({ ...f.todos[3], id: 79, title: 'Call Globex', client: 'Globex', companyId: null, type: 'client' });
    f.meetings.push({ ...f.meetings[5], id: 69, title: 'Globex intro', companyName: 'Globex', companyId: null });
    const out = buildPhoneSnapshot(f);
    expect(out.tasks.find((t) => t.id === 79)).toMatchObject({ companyId: null, companyName: 'Globex' });
    expect(out.meetings.find((m) => m.id === 69)).toMatchObject({ companyId: null, companyName: 'Globex' });
    expect(out.companies.some((c) => c.name === 'Globex')).toBe(false);
  });

  it('an empty database gives the header and empty lists', () => {
    const empty = buildPhoneSnapshot(phoneFixture({
      proposals: [], opportunities: [], agreements: [], meetings: [], todos: [], projects: [], commitments: [], companies: [], contacts: [],
      pinnedNotes: [], importedCaptureIds: [], failedCaptures: [],
    }));
    expect(snapshotShapeErrors(empty)).toEqual([]);
    expect(empty).toMatchObject({ attention: [], meetings: [], tasks: [], promises: [], companies: [], comingUp: [], importedCaptureIds: [] });
  });

  it('the same data in a different order gives the same bytes', () => {
    const f = phoneFixture();
    const shuffled = phoneFixture({
      meetings: [...f.meetings].reverse(), todos: [...f.todos].reverse(), commitments: [...f.commitments].reverse(),
      companies: [...f.companies].reverse(), contacts: [...f.contacts].reverse(),
    });
    expect(stableJson(buildPhoneSnapshot(shuffled))).toBe(stableJson(buildPhoneSnapshot(f)));
  });

  it('content ignores the timestamp; anything else changes it', () => {
    const a = buildPhoneSnapshot(phoneFixture());
    const b = buildPhoneSnapshot(phoneFixture({ generatedAt: '2026-09-24T10:00:00+03:00' }));
    expect(snapshotContent(a)).toBe(snapshotContent(b));
    const f = phoneFixture();
    f.todos[0] = { ...f.todos[0], title: 'Send the payroll proposal today' };
    expect(snapshotContent(buildPhoneSnapshot(f))).not.toBe(snapshotContent(a));
  });

  it('keeps the last 200 capture ids', () => {
    const ids = Array.from({ length: 250 }, (_, n) => `id-${n}`);
    const out: PhoneSnapshot = buildPhoneSnapshot(phoneFixture({ importedCaptureIds: ids }));
    expect(out.importedCaptureIds).toHaveLength(200);
    expect(out.importedCaptureIds[199]).toBe('id-249');
  });
});

describe('helpers', () => {
  it('isoWithOffset writes local time with its offset', () => {
    const d = new Date('2026-09-24T06:12:03Z');
    const s = isoWithOffset(d);
    expect(s).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
    expect(Date.parse(s)).toBe(d.getTime());
  });

  it('shortLocation: the first part, or Online', () => {
    expect(shortLocation('Riyadh, KAFD Tower 2')).toBe('Riyadh');
    expect(shortLocation('Microsoft Teams Meeting; https://teams.microsoft.com/l/x')).toBe('Online');
    expect(shortLocation('')).toBeNull();
  });
});
