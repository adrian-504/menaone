// @vitest-environment jsdom
// The sample at scale (lib/scaleSample.ts): the same data every run, the volumes and the gaps it was designed to
// have, read with the app's own rules (where a proposal waits, which requests are due), and opt-in only.
import { describe, expect, it } from 'vitest';
import { SCALE, buildScaleSample } from './scaleSample';
import { stageOf } from './mydayFocus';
import { buildRequests } from './followRequests';
import { lastTouch } from './followup';

const TODAY = '2026-10-01';
const sample = buildScaleSample(TODAY);
const { proposals, contacts, agreements, todos } = sample.data;
const tally = <T>(list: T[], key: (x: T) => string) => list.reduce<Record<string, number>>((out, x) => ({ ...out, [key(x)]: (out[key(x)] || 0) + 1 }), {});
const ctx = { emails: [], meetings: sample.meetings, today: TODAY, touches: sample.touches };

describe('the sample at scale', () => {
  it('is the same data on every run, and keeps its ages on another day', () => {
    expect(JSON.stringify(buildScaleSample(TODAY))).toBe(JSON.stringify(sample));
    const later = buildScaleSample('2027-03-15');
    expect(later.companies.map((c) => c.name)).toEqual(sample.companies.map((c) => c.name));
    expect(tally(later.data.proposals, (p) => `${p.status}${p.archived ? ' (archived)' : ''}`)).toEqual(tally(proposals, (p) => `${p.status}${p.archived ? ' (archived)' : ''}`));
    const silent = (s: typeof sample, today: string) => s.data.proposals.filter((p) => stageOf(p) === 'client' && (lastTouch(p, { emails: [], meetings: [], today })?.days ?? 0) >= 60).length;
    expect(silent(later, '2027-03-15')).toBe(silent(sample, TODAY));
  });

  it('has the volumes it was designed for', () => {
    expect(sample.companies).toHaveLength(SCALE.companies);
    expect(contacts).toHaveLength(352);
    expect(proposals).toHaveLength(270);
    expect(agreements).toHaveLength(107);
    expect(sample.opportunities).toHaveLength(SCALE.opportunities);
    expect(sample.projects).toHaveLength(SCALE.projects);
    expect(sample.meetings).toHaveLength(SCALE.meetings);
    expect(todos).toHaveLength(SCALE.todos);
    expect(sample.touches).toHaveLength(SCALE.touches);
    expect(sample.data.commitments).toHaveLength(SCALE.commitments);
    expect(Object.keys(sample.data.companyNotes)).toHaveLength(SCALE.companyNotes);
    expect(new Set(proposals.map((p) => p.id)).size).toBe(270);
    expect(new Set(sample.companies.map((c) => c.name)).size).toBe(SCALE.companies);
  });

  it('puts the proposals where the real ones wait', () => {
    expect(tally(proposals, (p) => `${p.status}${p.archived ? ' (archived)' : ''}`)).toEqual({
      'Sent to Client': 46, 'In Internal Review': 5, Drafting: 1, 'Proposal Request Received': 1, 'Signed by Both Parties': 63, Lost: 36,
      'Sent to Client (archived)': 110, 'Proposal Request Received (archived)': 8,
    });
    // My Day's three groups, by its own rule.
    expect(tally(proposals.filter((p) => stageOf(p)), (p) => stageOf(p)!)).toEqual({ draft: 2, hassan: 5, client: 46 });
    // Follow-up's rows: 31 requests at 26 companies; 18 of the 46 proposals were sent 60 days ago or more.
    const requests = buildRequests(proposals, ctx);
    expect(requests).toHaveLength(31);
    expect(new Set(requests.map((r) => r.companyId)).size).toBe(SCALE.requestCompanies);
    expect(Math.max(...Object.values(tally(requests, (r) => String(r.companyId))))).toBe(2);
    const sentDaysAgo = (p: typeof proposals[number]) => Math.round((Date.parse(TODAY) - Date.parse((p.lastSentAt || p.sentDate)!)) / 86_400_000);
    expect(proposals.filter((p) => stageOf(p) === 'client' && sentDaysAgo(p) >= 60)).toHaveLength(18);
    // Every place a request can sit has rows.
    const buckets = tally(requests, (r) => r.bucket);
    expect(buckets.decide).toBeGreaterThan(5);
    expect(buckets.due).toBeGreaterThan(0);
    expect(buckets.waiting).toBeGreaterThan(5);
  });

  it('keeps the gaps of the real data', () => {
    // Companies: no owner, country or city anywhere; a third have nothing but a name.
    expect(sample.companies.filter((c) => c.owner || c.country || c.city)).toHaveLength(0);
    expect(new Set(contacts.map((c) => c.companyId)).size).toBe(105);
    expect(contacts.filter((c) => c.role)).toHaveLength(14);
    // Proposals: most have no owner, no fee and no date added.
    expect(proposals.filter((p) => p.owner)).toHaveLength(43);
    expect(proposals.filter((p) => p.monthlyFee != null).length).toBeLessThan(30);
    expect(proposals.filter((p) => !p.dateAdded).length).toBeGreaterThan(170);
    expect(proposals.filter((p) => p.validUntil || p.promisedBy)).toHaveLength(0);
    // Agreements: the real mix of statuses; five end dates, all ahead; never a notice period; one stored fee.
    expect(tally(agreements, (a) => a.status || '')).toEqual(SCALE.agreements);
    expect(agreements.filter((a) => a.endDate)).toHaveLength(SCALE.agreementsWithEnd);
    expect(agreements.every((a) => !a.endDate || a.endDate > TODAY)).toBe(true);
    expect(agreements.filter((a) => a.noticeDays != null)).toHaveLength(0);
    expect(agreements.filter((a) => a.startDate)).toHaveLength(SCALE.agreementsWithStart);
    expect(agreements.filter((a) => a.serviceStatus === 'Active')).toHaveLength(SCALE.agreementsActive);
    expect(agreements.filter((a) => a.monthlyFee != null)).toHaveLength(1);
    expect(agreements.filter((a) => a.proposalId != null)).toHaveLength(SCALE.signedLinkedToAgreement);
    // Tasks: three in four done; the open ones overdue or undated.
    expect(tally(todos, (t) => t.status || '')).toEqual({ Done: 46, Pending: 16 });
    expect(todos.filter((t) => t.status === 'Pending' && t.dueDate && t.dueDate < TODAY)).toHaveLength(5);
  });

  it('links only to records that exist', () => {
    const companyIds = new Set(sample.companies.map((c) => c.id));
    const proposalIds = new Set(proposals.map((p) => p.id));
    const contactIds = new Set(contacts.map((c) => c.id));
    for (const p of proposals) {
      expect(companyIds.has(p.companyId!)).toBe(true);
      expect(p.client).toBe(sample.companies[p.companyId! - 1].name);
      if (p.primaryContactId != null) expect(contacts[p.primaryContactId - 1].companyId).toBe(p.companyId);
    }
    for (const a of agreements) {
      expect(companyIds.has(a.companyId!)).toBe(true);
      if (a.proposalId != null) expect(proposals[a.proposalId - 1]).toMatchObject({ companyId: a.companyId, status: 'Signed by Both Parties' });
    }
    expect(new Set(agreements.filter((a) => a.proposalId != null).map((a) => a.proposalId)).size).toBe(SCALE.signedLinkedToAgreement);
    for (const t of sample.touches) expect(proposalIds.has(t.proposalId!)).toBe(true);
    for (const c of sample.data.commitments || []) if (c.contactId != null) expect(contactIds.has(c.contactId)).toBe(true);
    for (const t of todos) if (t.parentId != null) expect(todos.some((x) => x.id === t.parentId)).toBe(true);
  });

  it('is made of invented names only', () => {
    // Every address is on the reserved .test domain; every company starts with a coined word.
    expect(contacts.filter((c) => c.email && !/^[a-z.]+@[a-z]+\.test$/.test(c.email))).toEqual([]);
    expect(sample.companies.filter((c) => !/^[A-Z][a-z]+(dra|van|mor|lis|ra|nex|tor|via|rin|dor|lo|na|tis|mund|zo)( |$)/.test(c.name))).toEqual([]);
  });
});

describe('the sample at scale is opt-in', () => {
  const sources = import.meta.glob(['../**/*.ts', '!../**/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

  it('is loaded by the preview only, on demand, behind ?sample=scale', () => {
    const importers = Object.entries(sources).filter(([file, text]) => !file.endsWith('/scaleSample.ts') && /scaleSample/.test(text)).map(([file]) => file);
    expect(importers).toEqual(['./devMock.ts']);
    const devMock = sources['./devMock.ts'];
    expect(devMock).not.toMatch(/^import[^\n]*scaleSample/m);
    expect(devMock).toMatch(/get\('sample'\) !== 'scale'\) return;\s+const \{ buildScaleSample \} = await import\('\.\/scaleSample'\)/);
  });
});
