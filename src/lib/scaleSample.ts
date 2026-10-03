// A second sample for the dev preview, at the owner's real volumes ("scale-sample", 3 Oct 2026). The small sample in
// devMock.ts shows one of each case; designs kept reaching the owner with problems that only show at his scale (a
// group that never appears because sixty rows sit above it, a list full of companies nobody has contacted, long
// scrolling). This one mirrors the size and the gaps of the real data, not an ideal dataset.
//
// - Opt-in: the preview uses it only with `?sample=scale` (devMock.ts loads this file on demand); the screenshot
//   scripts take `SAMPLE=scale`. The default sample, the tests and the focus check never load it.
// - Fictional: every name is built here from the word lists below. Nothing is taken from the real database: only
//   counts were measured on a read-only copy (how many proposals in each status, how many fields are empty), never
//   a name, an amount or a date.
// - The same data every run: one fixed seed. Dates are counted back from `today`, so the ages stay as designed
//   (a proposal silent for 90 days is silent for 90 days whenever the preview is opened).
//
// Pure: no DOM, no clock. `buildScaleSample(today)` returns the records; devMock.ts puts them in its stores.

import catalogSeed from '../../src-tauri/src/catalog_seed.json';
import { INDUSTRY_TAXONOMY } from './types';
import type { ActivityNote, Agreement, AppData, CommercialLine, Commitment, Company, Contact, Meeting, Milestone, Note, Opportunity, Project, Proposal, ProposalDocument, TeamMember, Todo, Touch } from './types';

/** The volumes, as measured on 3 Oct 2026. One table, so a change of scale is a change here. */
export const SCALE = {
  companies: 181,
  /** Companies by what they have: proposals (some with agreements too), agreements only, contacts only, nothing. */
  withProposals: 126, withBoth: 36, agreementsOnly: 5, contactsOnly: 32,
  /** Of the companies with proposals, the ones with no contact person at all. */
  proposalsNoContact: 57,
  /** [proposals at a company, how many companies]. 270 in all. */
  proposalsPerCompany: [[9, 2], [7, 3], [6, 1], [5, 5], [4, 10], [3, 14], [2, 27], [1, 64]],
  /** [agreements at a company, how many companies]. 107 in all. */
  agreementsPerCompany: [[11, 1], [7, 2], [6, 1], [5, 2], [4, 3], [3, 4], [2, 14], [1, 14]],
  /** [contacts at a company, how many companies]. 352 in all, at 105 companies. */
  contactsPerCompany: [[14, 1], [13, 1], [12, 1], [11, 1], [10, 1], [9, 3], [8, 3], [7, 5], [6, 3], [5, 6], [4, 11], [3, 13], [2, 19], [1, 37]],
  proposals: { withClients: 46, withHassan: 5, toDraft: 2, signed: 63, lost: 36, archivedSent: 110, archivedRequests: 8 },
  /** The proposals with clients, by request: [proposals sent together, how many requests]. 31 requests, 26 companies. */
  requests: [[4, 2], [3, 2], [2, 5], [1, 22]], requestCompanies: 26,
  /** Days since each request was sent: [from, to, how many proposals]. 18 of the 46 are silent for 60 days or more. */
  sentAges: [[1, 9, 19], [10, 29, 5], [30, 59, 4], [60, 179, 18]],
  signedLinkedToAgreement: 55,
  agreements: { 'In Preparation': 60, Signed: 25, 'Client Review': 10, Canceled: 5, 'On Hold': 4, '': 3 },
  agreementTypes: { Administration: 45, Workforce: 31, 'Company Maintenance': 10, Consultancy: 6, 'Company Constitution': 5, Accountancy: 4, Other: 3, '': 3 },
  /** Only these carry an end date; none carries a notice period. */
  agreementsWithEnd: 5, agreementsWithStart: 22, agreementsActive: 12,
  opportunities: 15, projects: 11, meetings: 30, todos: 62, notes: 12, touches: 7, commitments: 14, companyNotes: 108,
} as const;

export interface ScaleSample {
  data: AppData;
  companies: Company[];
  opportunities: Opportunity[];
  projects: Project[];
  milestones: Milestone[];
  meetings: Meeting[];
  touches: Touch[];
  /** The team: the reviewer, the owner and six colleagues. */
  teamMembers: TeamMember[];
  /** Dated company notes, as `all_company_note_entries` returns them. */
  companyNoteEntries: { id: number; companyId: number; companyName: string; body: string; isLegacy: boolean; createdAt: string; updatedAt: null; pinned?: boolean }[];
}

export const SCALE_SEED = 20261003;
const PROPOSALS_ROOT = '/Users/demo/Library/CloudStorage/OneDrive-MENABIG/MENA BD 2026/Proposals';

// ── Word lists: every name comes from here ──────────────────────────────────

const COIN_A = ['Al', 'Bel', 'Cor', 'Dan', 'El', 'Fen', 'Gal', 'Hal', 'Ist', 'Jor', 'Kel', 'Lum', 'Mar', 'Ner', 'Orl', 'Pel', 'Quen', 'Riv', 'Sol', 'Tav', 'Ulv', 'Ver', 'Wex', 'Yel', 'Zen'];
const COIN_B = ['a', 'e', 'i', 'o', 'u', 'ar', 'en', 'or', 'il', 'an'];
const COIN_C = ['dra', 'van', 'mor', 'lis', 'ra', 'nex', 'tor', 'via', 'rin', 'dor', 'lo', 'na', 'tis', 'mund', 'zo'];
const SECTORS = ['Logistics', 'Trading', 'Engineering', 'Systems', 'Contracting', 'Foods', 'Energy', 'Consulting', 'Industries', 'Technologies', 'Marine', 'Healthcare', 'Hospitality', 'Construction', 'Advisory', 'Mobility'];
const TAILS = ['Group', 'Arabia', 'International', 'Company', 'Holding', 'Gulf', 'Middle East', 'Partners'];
const SECOND = ['Contracting', 'Services', 'Trading', 'Industrial Supplies', 'Facilities Management', 'Project Management'];
const FIRST_NAMES = ['Adel', 'Amira', 'Bashir', 'Carla', 'Dalia', 'Diego', 'Elena', 'Emil', 'Farah', 'Faris', 'Greta', 'Hadi', 'Ines', 'Jonas', 'Karim', 'Laila', 'Leon', 'Maha', 'Marco', 'Nadia', 'Nabil', 'Olga', 'Pablo', 'Rania', 'Rami', 'Salma', 'Samir', 'Tara', 'Tomas', 'Yara', 'Yusuf', 'Zara', 'Hugo', 'Ivana', 'Malik', 'Noor', 'Petra', 'Rafael', 'Sofia', 'Walid'];
const LAST_NAMES = ['Abbasi', 'Barakat', 'Castell', 'Darwish', 'Estrada', 'Fakhoury', 'Galvez', 'Hamdan', 'Ibarra', 'Jaber', 'Kanaan', 'Lindqvist', 'Mansour', 'Navarro', 'Odeh', 'Pascual', 'Qasim', 'Roldan', 'Sabbagh', 'Tahan', 'Urrutia', 'Vidal', 'Wehbe', 'Yamin', 'Zubiri', 'Marchetti', 'Novak', 'Okafor', 'Petrov', 'Rahme', 'Serrano', 'Toledo', 'Ferrer', 'Haik', 'Issa', 'Khoury', 'Lozano', 'Moreno', 'Nassar', 'Ortega'];
const ROLES = ['HR director', 'Finance manager', 'General manager', 'People operations', 'Country manager', 'Legal counsel', 'Operations lead'];
// Services as older proposals named them, before the catalogue: they match no catalogue service.
const LEGACY_SERVICES = ['Payroll + PRO', 'HR Consultancy', 'Admin Services', 'Manpower Supply', 'Company Formation', 'Government Relations', 'Visa Processing', 'Recruitment (Engineers)', 'Outsourcing', 'EOR'];
// Catalogue services by how often they are proposed: [index in catalog_seed.json, weight].
const SERVICE_WEIGHTS: [number, number][] = [[17, 39], [6, 29], [0, 13], [4, 12], [1, 11], [9, 9], [13, 8], [3, 8], [14, 7], [15, 6], [11, 5], [12, 4], [19, 3], [2, 3], [7, 2], [18, 1], [16, 1], [10, 1], [8, 1]];
const LEGACY_SHARE = 111 / 274;
const REMARKS = ['Waiting for headcount', 'Asked for a call next month', 'Budget in Q1', 'Sent with the company profile', 'Second option requested', 'To revisit after their licence', 'Introduced by a partner', 'Price per person'];
const NOTE_TEXTS = ['Called, no answer', 'Emailed a reminder', 'They are reviewing internally', 'Asked to come back after the holidays', 'Shared the updated fee table', 'Waiting on their finance team'];
const LOSS_REASONS = ['Price too high', 'Competitor selected', 'No budget approved', 'Service not needed', 'Client unresponsive', 'Timeline mismatch'];
const WIN_REASONS = ['Client converted', 'Price was competitive', 'Referral / existing relationship', 'Better service fit'];
const TASK_VERBS = ['Send', 'Prepare', 'Review', 'Confirm', 'Update', 'Collect', 'Draft', 'Check', 'Chase', 'File'];
const TASK_OBJECTS = ['the fee table', 'the onboarding checklist', 'the signed copy', 'the GOSI registration', 'the visa quota request', 'the engagement letter', 'the headcount list', 'the payroll calendar', 'the commercial registration renewal', 'the proposal deck'];
const TASK_TAILS = ['', '', '', ' before the call', ' for the new joiners', ' and share it with finance', ' with the latest numbers and the notes from the last meeting', ' after the client confirms the start date and the number of employees in Riyadh and Jeddah'];
const MEETING_TITLES = ['Intro call', 'Proposal walk-through', 'Payroll review', 'Onboarding kickoff', 'Monthly check-in', 'Scope discussion', 'Renewal terms', 'Recruitment brief'];
const INTERNAL_MEETINGS = ['Weekly BD sync', 'Proposals review', 'Pipeline review', 'Templates clean-up', 'Month-end numbers', 'Team stand-up'];
const INTERNAL_PROJECTS = ['Proposal templates 2026', 'Service catalogue clean-up', 'Website case studies', 'Client onboarding pack', 'Partner referral programme', 'Recruitment division launch', 'Rate card review', 'Company profile refresh', 'Events calendar'];
const NOTE_TITLES = ['Pricing notes', 'Onboarding steps', 'Questions for finance', 'Recruitment fee structure', 'Template wording', 'Visa quota rules', 'Call notes', 'Ideas for the profile', 'GOSI changes', 'Follow-up wording', 'Agreement checklist', 'Partner list'];
const COMPANY_NOTE_TEXTS = ['Prefers email.', 'Decision sits with the regional office.', 'Introduced through a partner.', 'Asked about recruitment as well.', 'Licence in progress.', 'Small team, growing next year.', 'Wants one invoice a month.', 'Met at an event.'];
const PROMISES = ['Send the revised fee table', 'Share the onboarding checklist', 'Confirm the start date', 'Send the engagement letter', 'Share the headcount', 'Send the licence copy'];

// ── The generator's tools ───────────────────────────────────────────────────

/** A seeded random source (mulberry32): the same seed gives the same sequence on every machine. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `[value, count]` pairs written out: [[2, 3], [1, 2]] is [2, 2, 2, 1, 1]. */
const spread = <T>(pairs: readonly (readonly [T, number])[]): T[] => pairs.flatMap(([v, n]) => Array.from({ length: n }, () => v));

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

/** The sample at scale. `today` is YYYY-MM-DD; every date is counted from it. */
export function buildScaleSample(today: string, seed: number = SCALE_SEED): ScaleSample {
  const rnd = seeded(seed);
  const int = (from: number, to: number) => from + Math.floor(rnd() * (to - from + 1));
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rnd() * list.length)];
  const chance = (p: number) => rnd() < p;
  const shuffle = <T>(list: T[]): T[] => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  };
  /** Exactly `n` of `total` true, in a shuffled order. */
  const some = (n: number, total: number) => shuffle(Array.from({ length: total }, (_, i) => i < n));
  const ago = (days: number) => addDays(today, -days);

  // ── Companies ──
  const coined = new Set<string>();
  const coin = (): string => {
    for (;;) { const w = pick(COIN_A) + pick(COIN_B) + pick(COIN_C); if (!coined.has(w)) { coined.add(w); return w; } }
  };
  // One word for nearly half, as the real names are; a few long ones, and one that is very long.
  const words = shuffle(spread([[1, 86], [2, 48], [3, 21], [4, 16], [5, 9], [9, 1]] as const));
  const companyName = (n: number): string => {
    const w = coin();
    if (n === 1) return w;
    if (n === 2) return `${w} ${pick(SECTORS)}`;
    if (n === 3) return `${w} ${pick(SECTORS)} ${pick(TAILS)}`;
    if (n === 4) return `${w} ${pick(SECTORS)} & ${pick(SECOND)}`;
    if (n === 5) return `${w} ${pick(TAILS)} for ${pick(SECTORS)} & ${pick(SECOND)}`;
    return `${w} International Company for ${pick(SECTORS)}, ${pick(SECOND)} and ${pick(SECTORS)} Projects`;
  };

  type Role = 'both' | 'proposals' | 'agreements' | 'contacts' | 'none';
  const N = SCALE;
  const roles: Role[] = shuffle([
    ...Array.from({ length: N.withBoth }, (): Role => 'both'), ...Array.from({ length: N.withProposals - N.withBoth }, (): Role => 'proposals'),
    ...Array.from({ length: N.agreementsOnly }, (): Role => 'agreements'), ...Array.from({ length: N.contactsOnly }, (): Role => 'contacts'),
    ...Array.from({ length: N.companies - N.withProposals - N.agreementsOnly - N.contactsOnly }, (): Role => 'none'),
  ]);
  const industriesOf = shuffle(spread([[1, 121], [2, 47], [0, 13]] as const));
  const hasWebsite = some(100, N.companies);
  const created = ago(int(20, 30));
  const companies: Company[] = roles.map((_, i) => {
    const name = companyName(words[i]);
    return {
      id: i + 1, name, legalName: null, industries: shuffle([...INDUSTRY_TAXONOMY]).slice(0, industriesOf[i]), website: hasWebsite[i] ? `${name.split(' ')[0].toLowerCase()}.test` : null,
      // Owner, country and city are empty on every real company.
      country: null, city: null, companyType: null, status: null, owner: null, description: null, archived: false, createdAt: `${created}T08:00:00Z`, updatedAt: null,
    };
  });
  const idsOf = (...want: Role[]) => companies.filter((_, i) => want.includes(roles[i])).map((c) => c.id);
  companies[idsOf('none')[0] - 1].archived = true;
  const nameOf = (companyId: number) => companies[companyId - 1].name;

  // How many proposals and agreements each company has: the companies with both are the larger clients.
  const perCompany = new Map<number, { proposals: number; agreements: number; contacts: number }>(companies.map((c) => [c.id, { proposals: 0, agreements: 0, contacts: 0 }]));
  const proposalCounts = spread(N.proposalsPerCompany);
  [...idsOf('both'), ...idsOf('proposals')].forEach((id, i) => { perCompany.get(id)!.proposals = proposalCounts[i]; });
  const agreementCounts = spread(N.agreementsPerCompany);
  const agreementOnly = idsOf('agreements');
  idsOf('both').forEach((id, i) => { perCompany.get(id)!.agreements = agreementCounts[i]; });
  agreementOnly.forEach((id, i) => { perCompany.get(id)!.agreements = agreementCounts[N.withBoth + i]; });

  // ── Proposals: which company holds which ──
  type Kind = 'signed' | 'client' | 'hassan' | 'draft' | 'request' | 'lost' | 'archivedSent' | 'archivedRequest';
  interface Slot { companyId: number; kind: Kind | null; request?: number; age?: number }
  const slots: Slot[] = [...idsOf('both'), ...idsOf('proposals')].flatMap((companyId) => Array.from({ length: perCompany.get(companyId)!.proposals }, (): Slot => ({ companyId, kind: null })));
  const free = (companyId: number) => slots.filter((s) => s.companyId === companyId && !s.kind);
  const count = (companyId: number, kind: Kind) => slots.filter((s) => s.companyId === companyId && s.kind === kind).length;

  // Signed by both: at the companies with agreements, one at a time, at most one more than the company has agreements.
  let signedLeft: number = N.proposals.signed;
  while (signedLeft > 0) {
    let placed = false;
    for (const id of idsOf('both')) {
      if (!signedLeft) break;
      const open = free(id);
      if (!open.length || count(id, 'signed') > perCompany.get(id)!.agreements) continue;
      open[0].kind = 'signed';
      signedLeft--;
      placed = true;
    }
    if (!placed) break;
  }

  // With clients: requests of one to four proposals. The first 26 each go to another company; the last five are a
  // second request from a company that already has one, sent on another day.
  const requestSizes = spread(N.requests);
  const agesLeft = N.sentAges.map(([from, to, n]) => ({ from, to, n }));
  const candidates = shuffle([...idsOf('both'), ...idsOf('proposals')]);
  const requestCompanies: number[] = [];
  const agesAt = new Map<number, number[]>();
  requestSizes.forEach((size, r) => {
    const pool = r < N.requestCompanies ? candidates.filter((id) => !requestCompanies.includes(id)) : requestCompanies.filter((id) => (agesAt.get(id) || []).length < 2);
    const id = pool.find((c) => free(c).length >= size) ?? candidates.find((c) => free(c).length >= size)!;
    if (!requestCompanies.includes(id)) requestCompanies.push(id);
    // A request was sent on one day: its proposals share one age, from an age band that still has room for them.
    const band = shuffle(agesLeft.filter((b) => b.n >= size))[0];
    band.n -= size;
    let age = int(band.from, band.to);
    while (agesAt.get(id)?.includes(age)) age = age > band.from ? age - 1 : age + 1;
    agesAt.set(id, [...(agesAt.get(id) || []), age]);
    free(id).slice(0, size).forEach((s) => { s.kind = 'client'; s.request = r; s.age = age; });
  });

  const place = (kind: Kind, n: number) => {
    const open = shuffle(slots.filter((s) => !s.kind));
    open.slice(0, n).forEach((s) => { s.kind = kind; });
  };
  place('hassan', N.proposals.withHassan);
  place('draft', 1);
  place('request', N.proposals.toDraft - 1);
  place('lost', N.proposals.lost);
  place('archivedRequest', N.proposals.archivedRequests);
  place('archivedSent', N.proposals.archivedSent);

  // ── Contacts ──
  // Nearly every company with a proposal out has someone to write to (three do not); the rest of the contacts are at
  // the larger clients, at four of the agreement-only companies and at companies with nothing else yet.
  const liveNoContact = requestCompanies.slice(-3);
  const otherClients = [...idsOf('both'), ...idsOf('proposals')].filter((id) => !requestCompanies.includes(id)).sort((a, b) => perCompany.get(b)!.proposals - perCompany.get(a)!.proposals);
  const withContacts = shuffle([
    ...[...requestCompanies.filter((id) => !liveNoContact.includes(id)), ...otherClients].slice(0, N.withProposals - N.proposalsNoContact),
    ...agreementOnly.slice(0, 4), ...idsOf('contacts'),
  ]);
  const contactCounts = spread(N.contactsPerCompany);
  withContacts.forEach((id, i) => { perCompany.get(id)!.contacts = contactCounts[i]; });
  const people = new Set<string>();
  const person = (): string => {
    for (;;) {
      const r = rnd();
      // A few with one name only, a few with a long double surname.
      const name = r < 0.12 ? `${pick(FIRST_NAMES)} ${pick(LAST_NAMES).slice(0, 1)}.` : r < 0.19 ? `${pick(FIRST_NAMES)} ${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}-${pick(LAST_NAMES)}` : `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
      if (!people.has(name)) { people.add(name); return name; }
    }
  };
  const contacts: Contact[] = [];
  for (const id of withContacts) {
    const slug = nameOf(id).split(' ')[0].toLowerCase();
    for (let k = 0; k < perCompany.get(id)!.contacts; k++) {
      const name = person();
      contacts.push({
        id: contacts.length + 1, clientName: nameOf(id), companyId: id, name, role: null, phone: null, whatsapp: null, service: null, lists: [],
        email: `${name.toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}@${slug}.test`,
      });
    }
  }
  // Roles, phones and the decision-maker mark are rare; two contacts have no email.
  shuffle(contacts).slice(0, 14).forEach((c) => { c.role = pick(ROLES); });
  shuffle(contacts).slice(0, 10).forEach((c) => { c.phone = `+966 55 000 ${String(int(1000, 9999))}`; });
  shuffle(contacts).slice(0, 2).forEach((c) => { c.email = null; });
  contacts[0].isDecisionMaker = true;
  const contactsAt = (companyId: number) => contacts.filter((c) => c.companyId === companyId);

  // ── Proposals: the records ──
  const services = catalogSeed.services;
  const weighted = spread(SERVICE_WEIGHTS);
  let lineId = 0;
  const line = (priced: boolean): CommercialLine => {
    const legacy = chance(LEGACY_SHARE);
    const index = pick(weighted);
    return {
      id: ++lineId, serviceId: legacy ? null : index + 1, serviceName: legacy ? pick(LEGACY_SERVICES) : services[index].name, description: null,
      billing: 'monthly', quantity: 1, unitPrice: priced ? int(3, 40) * 500 : null, commission: false, sortOrder: 0,
    };
  };
  const blank = (id: number, companyId: number, status: string): Proposal => ({
    id, client: nameOf(companyId), companyId, type: null, status, sentDate: null, dblSignedDate: null, kickoffDate: null, finance: null, hubspot: null, owner: null, remarks: null,
    dateAdded: null, monthlyFee: null, contractMonths: null, winLossReason: null, docLink: null, archived: false, archivedAt: null, snoozedUntil: null, dateSentToHassan: null,
    dateSentToClient: null, dateSigned: null, notes: [], businessEntityId: 1, currency: 'SAR', lines: [], documents: [],
  });
  /** One line nearly always; its name is the proposal's type, its price the monthly fee. */
  const withLines = (p: Proposal, n: number, priced: boolean): Proposal => {
    p.lines = Array.from({ length: n }, (_, k) => ({ ...line(priced), sortOrder: k }));
    p.type = p.lines.map((l) => l.serviceName).join(' + ') || null;
    if (priced) { p.monthlyFee = p.lines.reduce((sum, l) => sum + (l.unitPrice || 0), 0); p.contractMonths = 12; }
    return p;
  };

  const order = shuffle(slots.map((_, i) => i));
  const idOf = new Map<Slot, number>(order.map((slotIndex, i) => [slots[slotIndex], i + 1]));
  const of = (kind: Kind) => slots.filter((s) => s.kind === kind).sort((a, b) => idOf.get(a)! - idOf.get(b)!);
  const proposals: Proposal[] = [];

  // Signed by both: the service started on every one; the signing date is missing on a few.
  const signed = of('signed');
  const signedYears = shuffle(spread([[0, 7], [2, 15], [1, 27], [-1, 14]] as const));
  const signedSent = some(55, signed.length);
  const signedReason = some(8, signed.length);
  const signedPriced = some(2, signed.length);
  signed.forEach((s, i) => {
    const p = withLines(blank(idOf.get(s)!, s.companyId, 'Signed by Both Parties'), 1, signedPriced[i]);
    // Years back from today: this year, last year, the year before; 0 = no date recorded.
    const days = signedYears[i] === 0 ? null : signedYears[i] === -1 ? int(20, 250) : signedYears[i] * 365 + int(-150, 150);
    p.dblSignedDate = p.dateSigned = days == null ? null : ago(days);
    p.serviceStartedAt = ago((days ?? int(300, 700)) - 10);
    if (signedSent[i] && days != null) p.sentDate = p.dateSentToClient = ago(days + int(10, 40));
    if (signedReason[i]) p.winLossReason = pick(WIN_REASONS);
    proposals.push(p);
  });

  // With clients.
  const live = of('client');
  const livePriced = some(17, live.length);
  const liveRemark = some(12, live.length);
  const liveOwner = some(36, live.length);
  const groupOf = requestSizes.indexOf(3);
  live.forEach((s, i) => {
    const p = withLines(blank(idOf.get(s)!, s.companyId, 'Sent to Client'), 1, livePriced[i]);
    const sent = ago(s.age!);
    p.sentDate = p.dateSentToClient = sent;
    p.dateSentToHassan = addDays(sent, -int(1, 4));
    p.dateAdded = addDays(sent, -int(4, 9));
    p.reviewStatus = 'approved';
    p.reviewedAt = addDays(sent, -1);
    if (liveOwner[i]) { p.owner = 'Ahmad'; p.ownerId = 2; p.reviewerId = 1; }
    if (liveRemark[i]) p.remarks = pick(REMARKS);
    // One request of three was created together and carries a request group; the others stand by client and day.
    if (s.request === groupOf) p.requestGroup = `scale-${groupOf}`;
    proposals.push(p);
  });
  // A contact person is named on few of them.
  shuffle(live.filter((s) => contactsAt(s.companyId).length)).slice(0, 10).forEach((s) => { proposals.find((p) => p.id === idOf.get(s))!.primaryContactId = contactsAt(s.companyId)[0].id; });

  // With Hassan: all waiting for his answer, sent to him within the last week.
  of('hassan').forEach((s, i) => {
    const p = withLines(blank(idOf.get(s)!, s.companyId, 'In Internal Review'), 1, true);
    const asked = ago([6, 6, 4, 3, 1][i % 5]);
    Object.assign(p, { dateAdded: addDays(asked, -3), dateSentToHassan: asked, reviewRequestedAt: asked, reviewStatus: 'pending', reviewerId: 1, owner: 'Ahmad', ownerId: 2, remarks: i < 2 ? pick(REMARKS) : null });
    proposals.push(p);
  });
  // To draft: one being drafted, one request just in. Neither carries a promised day.
  of('draft').forEach((s) => proposals.push(Object.assign(withLines(blank(idOf.get(s)!, s.companyId, 'Drafting'), 1, false), { dateAdded: ago(3), owner: 'Ahmad', ownerId: 2 })));
  of('request').forEach((s) => proposals.push(Object.assign(withLines(blank(idOf.get(s)!, s.companyId, 'Proposal Request Received'), 1, false), { dateAdded: ago(1), owner: 'Ahmad', ownerId: 2 })));

  // Lost: a reason on two in three, a send date on about half, never the day it was lost.
  const lost = of('lost');
  const lostReason = some(23, lost.length);
  const lostSent = some(20, lost.length);
  const lostAdded = some(24, lost.length);
  const lostLines = shuffle(spread([[0, 3], [2, 4], [4, 1], [1, lost.length - 8]] as const));
  lost.forEach((s, i) => {
    const p = withLines(blank(idOf.get(s)!, s.companyId, 'Lost'), lostLines[i], i === 0);
    const days = int(30, 260);
    if (lostSent[i]) p.sentDate = p.dateSentToClient = ago(days);
    if (lostAdded[i]) p.dateAdded = ago(days + int(3, 12));
    if (lostReason[i]) p.winLossReason = pick(LOSS_REASONS);
    proposals.push(p);
  });

  // Archived: old proposals still marked "Sent to Client", and a few requests that never became one.
  const archivedSent = of('archivedSent');
  const archivedYears = shuffle(spread([[0, 6], [2, 28], [1, 70], [-1, 6]] as const));
  archivedSent.forEach((s, i) => {
    const p = withLines(blank(idOf.get(s)!, s.companyId, 'Sent to Client'), 1, false);
    const days = archivedYears[i] === 0 ? null : archivedYears[i] === -1 ? int(100, 270) : archivedYears[i] * 365 + int(-150, 150);
    if (days != null) p.sentDate = p.dateSentToClient = ago(days);
    if (archivedYears[i] === -1) p.dateAdded = ago(days! + 5);
    Object.assign(p, { archived: true, archivedAt: ago(int(15, 25)) });
    proposals.push(p);
  });
  of('archivedRequest').forEach((s) => proposals.push(Object.assign(blank(idOf.get(s)!, s.companyId, 'Proposal Request Received'), { archived: true, archivedAt: ago(int(15, 25)) })));
  proposals.sort((a, b) => a.id - b.id);
  const proposalAt = (s: Slot) => proposals[idOf.get(s)! - 1];

  // Notes on proposals: on one in six, most of them written around the day it was sent.
  const noted = [...shuffle(live).slice(0, 20), ...shuffle([...lost, ...archivedSent]).slice(0, 24)];
  let noteId = 0;
  noted.forEach((s, i) => {
    const p = proposalAt(s);
    const base = p.sentDate || ago(int(40, 400));
    const texts: ActivityNote[] = Array.from({ length: i < 11 ? 2 : 1 }, (_, k) => ({ id: ++noteId, date: addDays(base, Math.min(int(0, 6) + k * 5, Math.max(0, (s.age ?? 999) - 1))), text: pick(NOTE_TEXTS) }));
    p.notes = texts;
  });

  // Decks on record: seventeen, on twelve of the proposals now with clients and one with Hassan. Older versions are
  // not always on record (a deck can start at V2 or V4).
  const versions = [[1], [1], [1], [1], [1], [1], [1, 2], [1, 2], [2], [2], [3, 4], [3, 4], [4]];
  let documentId = 1000;
  [...of('hassan').slice(0, 1), ...shuffle(live).slice(0, 12)].forEach((s, i) => {
    const p = proposalAt(s);
    const day = p.sentDate || p.dateSentToHassan || today;
    p.documents = versions[i].map((version, k): ProposalDocument => {
      const fileName = `${p.client}_${p.type} Proposal_${ddmmyyyy(day)}${version > 1 ? `_V${version}` : ''}.pptx`;
      const path = `${PROPOSALS_ROOT}/${p.client}/${fileName}`;
      const latest = k === versions[i].length - 1;
      return { id: ++documentId, kind: 'proposal', version, fileName, path, url: null, notes: null, createdAt: day, round: version > 1 ? 'client' : 'internal', sentToClientAt: latest && p.sentDate ? p.sentDate : null, generatedSha256: `mock:${path}` };
    });
  });

  // Four were revised at the client's request and sent again: their age counts from the latest send.
  let revisionId = 0;
  shuffle(live.filter((s) => requestSizes[s.request!] === 1 && s.age! >= 15)).slice(0, 4).forEach((s) => {
    const p = proposalAt(s);
    const again = p.sentDate!;
    p.sentDate = p.dateSentToClient = addDays(again, -9);
    Object.assign(p, { revision: 2, lastSentAt: again, revisions: [{ id: ++revisionId, number: 2, requestedAt: addDays(again, -5), requestedByContactId: null, reason: pick(REMARKS), linesBeforeJson: '[]', sentAt: again }] });
  });

  // ── Follow-ups logged: seven, all emails of ours in the last ten days ──
  const chased = shuffle(live.filter((s) => s.age! >= 12)).slice(0, 6);
  const touches: Touch[] = [...chased, chased[0]].map((s, i) => {
    const at = ago(i === 6 ? 2 : int(3, 9));
    return { id: i + 1, companyId: s.companyId, proposalId: idOf.get(s)!, kind: 'email_out', direction: 'out', at, subject: null, contactId: proposalAt(s).primaryContactId ?? null, source: 'manual', sourceId: null, createdAt: `${at}T09:00:00Z` };
  });

  // ── Agreements ──
  const agreements: Agreement[] = [];
  const agreementCompanies = [...idsOf('both'), ...agreementOnly].flatMap((id) => Array.from({ length: perCompany.get(id)!.agreements }, () => id));
  // The ones drafted from a signed proposal are linked to it and still "In Preparation".
  const signedByCompany = new Map<number, Proposal[]>();
  signed.forEach((s) => signedByCompany.set(s.companyId, [...(signedByCompany.get(s.companyId) || []), proposalAt(s)]));
  let linkedLeft: number = N.signedLinkedToAgreement;
  const statuses = spread(Object.entries(N.agreements).map(([k, n]) => [k, n] as const));
  const types = shuffle(spread(Object.entries(N.agreementTypes).map(([k, n]) => [k, n] as const)));
  const linkedIndex: number[] = [];
  agreementCompanies.forEach((companyId, i) => {
    const from = linkedLeft > 0 ? signedByCompany.get(companyId)?.shift() : undefined;
    if (from) { linkedLeft--; linkedIndex.push(i); }
    const type = types[i] || null;
    agreements.push({
      id: i + 1, agrRef: null, client: nameOf(companyId), companyId, type, status: null, preparedBy: null, datePrepared: null, dateSentToClient: null, dateClientSigned: null, dateMenaSigned: null, dateFiled: null,
      monthlyFee: null, contractMonths: null, proposalId: from?.id ?? null, hubspot: null, docLink: null, actionDate: from?.dblSignedDate ?? null,
      remarks: from ? `Auto-created from proposal SL# ${from.id} (${from.type || ''})` : null, createdAt: `${created}T08:00:00Z`, businessEntityId: 1, currency: 'SAR',
      startDate: null, endDate: null, serviceStatus: null, autoRenew: false, noticeDays: null,
      lines: type ? [{ id: 5000 + i, serviceId: null, serviceName: type, description: null, billing: 'monthly', quantity: 1, unitPrice: null, commission: false, sortOrder: 0 }] : [],
    });
  });
  // Statuses: the linked ones take "In Preparation" first; the rest are dealt out.
  const unlinked = shuffle(agreements.filter((_, i) => !linkedIndex.includes(i)));
  const rest = [...statuses];
  linkedIndex.forEach((i) => { agreements[i].status = rest.splice(rest.indexOf('In Preparation'), 1)[0]; });
  const dealt = shuffle(rest);
  unlinked.forEach((a, i) => { a.status = dealt[i] || null; });
  const withStatus = (status: string) => agreements.filter((a) => a.status === status);
  // A reference on nearly all; who prepared it on the ones in preparation.
  const code: Record<string, string> = { Administration: 'ADM', Workforce: 'WF', 'Company Maintenance': 'CM', Consultancy: 'CON', 'Company Constitution': 'CC', Accountancy: 'ACC', Other: 'OTH' };
  const seq = new Map<number, number>();
  agreements.forEach((a, i) => {
    const n = (seq.get(a.companyId!) || 0) + 1;
    seq.set(a.companyId!, n);
    if (i % 27 !== 26) a.agrRef = `${(a.client || '').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()}_${code[a.type || ''] || 'AGR'}_${String(n).padStart(3, '0')}_${String(int(1, 12)).padStart(2, '0')}${chance(0.5) ? '25' : '26'}`;
    if (a.status === 'In Preparation') { a.preparedBy = 'Hassan Balaghi'; a.preparedById = 1; }
  });
  // Delivery: twelve marked Active (none of them "Signed"), one Ended; a start date on those and on a few signed ones.
  const active = [...shuffle(withStatus('In Preparation')).slice(0, 11), ...shuffle(withStatus('Client Review')).slice(0, 2)];
  active.forEach((a, i) => { a.serviceStatus = i === 10 ? 'Ended' : 'Active'; a.startDate = ago(int(60, 500)); });
  shuffle(withStatus('Signed')).slice(0, N.agreementsWithStart - active.length).forEach((a) => { a.startDate = ago(int(60, 500)); });
  // Five carry an end date, all still ahead; none carries a notice period ("not recorded" is not "none").
  [100, 150, 210, 280, 340].forEach((ahead, i) => { const a = active[i]; a.endDate = addDays(today, ahead); a.startDate = addDays(a.endDate, -365); a.contractMonths = 12; });
  active[5].contractMonths = 12;
  // One stored monthly fee and two priced lines in the whole set.
  const priced = active.filter((a) => a.lines!.length);
  priced[0].monthlyFee = 12000;
  priced[0].lines![0].unitPrice = 12000;
  priced[1].lines![0].unitPrice = 4500;
  withStatus('In Preparation')[0].datePrepared = ago(12);

  // ── Opportunities: few, most of them parked ──
  const oppStages = spread([['Qualified', 2], ['Solution Design', 2], ['Lead', 5], ['On Hold', 6]] as const);
  const oppCompanies = shuffle(idsOf('both', 'proposals', 'contacts')).slice(0, N.opportunities);
  const opportunities: Opportunity[] = oppStages.map((stage, i) => {
    const companyId = i === 14 ? null : oppCompanies[i];
    const at = `${ago(int(8, 28))}T08:00:00Z`;
    return {
      id: i + 1, name: `${companyId ? nameOf(companyId) : 'New lead'} — ${services[pick(weighted)].name}`, companyId, companyName: companyId ? nameOf(companyId) : null, owner: 'Ahmad',
      stage, status: stage === 'On Hold' ? 'On Hold' : 'Open', estimatedValue: null, currency: 'SAR', probability: null, expectedCloseDate: null, description: null,
      nextAction: i < 2 ? 'Send the company profile' : null, proposalId: null, projectId: null, sortOrder: null, archived: i >= 4, createdAt: at, updatedAt: at, tags: [],
    };
  });

  // ── Projects: mostly internal, none with milestones ──
  const clientProjects = idsOf('both').slice(0, 2);
  const projects: Project[] = Array.from({ length: N.projects }, (_, i) => {
    const client = i < 2;
    return {
      id: i + 1, name: client ? `${nameOf(clientProjects[i])} — Onboarding` : INTERNAL_PROJECTS[i - 2], type: client ? 'client' : 'internal', status: client || i >= 7 ? 'Not Started' : 'In Progress', priority: 'Medium',
      owner: 'Ahmad', description: null, companyName: client ? nameOf(clientProjects[i]) : null, companyId: client ? clientProjects[i] : null, areaId: null, startDate: null, targetDate: null, completionDate: null,
      progressOverride: null, tags: [], archived: false, createdAt: ago(25), updatedAt: ago(int(1, 20)), taskCount: 0, taskDoneCount: 0, computedProgress: 0,
    };
  });
  opportunities[0].projectId = 1;

  // ── Meetings: a month back, a few ahead, most with a client ──
  const meetingCompanies = [...shuffle(requestCompanies).slice(0, 9), ...shuffle(idsOf('both', 'proposals', 'contacts').filter((id) => !requestCompanies.includes(id))).slice(0, 7)];
  const meetingDays = [...Array.from({ length: 23 }, () => -int(1, 33)), 0, 0, ...Array.from({ length: 5 }, () => int(1, 10))].sort((a, b) => a - b);
  const meetingNotes = some(12, 23);
  const meetings: Meeting[] = meetingDays.map((offset, i) => {
    const companyId = i % 5 === 4 ? null : meetingCompanies[i % meetingCompanies.length];
    const date = addDays(today, offset);
    const hour = 6 + (i % 7);
    const who = companyId ? contactsAt(companyId).slice(0, 2) : [];
    const written = i < 23 && meetingNotes[i];
    return {
      id: i + 1, title: companyId ? `${pick(MEETING_TITLES)} — ${nameOf(companyId)}` : INTERNAL_MEETINGS[i % INTERNAL_MEETINGS.length], meetingDate: date, companyName: companyId ? nameOf(companyId) : null, companyId,
      projectId: i < 3 ? 3 + i : null, opportunityId: i === 5 || i === 9 ? 1 : null, attendees: who.map((c) => c.name || ''), agenda: null,
      discussion: written ? `- ${pick(REMARKS)}\n- ${pick(NOTE_TEXTS)}` : null, decisions: written && i % 2 ? `- ${pick(PROMISES)}` : null, actionItems: null, followUp: null, nextMeeting: null, noteId: null,
      createdAt: date, updatedAt: date, outlookEventId: `scale-evt-${i + 1}`, startAt: `${date}T${String(hour).padStart(2, '0')}:00:00Z`, endAt: `${date}T${String(hour).padStart(2, '0')}:45:00Z`, organizer: 'Ahmad Abdallah',
      location: null, isOnlineMeeting: true, onlineMeetingUrl: null, isCancelled: false, source: 'outlook', organizerEmail: 'ahmad@menabig.test', attendeeEmails: who.map((c) => c.email || '').filter(Boolean),
    };
  });

  // ── Tasks: three in four done; the open ones overdue or with no date ──
  const taskTitle = () => `${pick(TASK_VERBS)} ${pick(TASK_OBJECTS)}${pick(TASK_TAILS)}`;
  const todoShape = shuffle(spread([['done', 46], ['overdue', 5], ['open', 11]] as const));
  const todoProject = some(39, N.todos);
  const todoCompany = some(39, N.todos);
  const todoMeeting = some(16, N.todos);
  const doneDue = some(16, 46);
  let doneSeen = 0;
  const todos: Todo[] = todoShape.map((shape, i) => {
    const companyId = todoCompany[i] ? pick(meetingCompanies) : null;
    const done = shape === 'done';
    const finished = done ? ago(int(1, 24)) : null;
    const due = shape === 'overdue' ? ago(int(2, 15)) : done && doneDue[doneSeen++] ? addDays(finished!, int(-2, 3)) : null;
    return {
      id: i + 1, title: taskTitle(), type: companyId ? 'client' : 'general', client: companyId ? nameOf(companyId) : null, companyId, priority: i === 0 ? 'High' : 'Medium', dueDate: due, status: done ? 'Done' : 'Pending',
      description: null, createdAt: ago(int(20, 28)), completedAt: finished, projectId: todoProject[i] ? 1 + (i % N.projects) : null, parentId: null, areaId: null, section: null, sortOrder: i + 1, recurrenceRule: null,
      tags: [], meetingId: todoMeeting[i] ? 1 + (i % 23) : null,
    };
  });
  // Seven are steps of another task.
  todos.slice(20, 27).forEach((t, k) => { t.parentId = todos[k].id; t.projectId = todos[k].projectId; });

  // ── Promises: fourteen from meetings, five still open ──
  const openOurs = todos.filter((t) => t.status === 'Pending' && !t.parentId).slice(0, 3);
  const commitments: Commitment[] = spread<[Commitment['direction'], Commitment['status']]>([[['ours', 'kept'], 8], [['ours', 'open'], 3], [['theirs', 'kept'], 1], [['theirs', 'open'], 2]]).map(([direction, status], i) => {
    const m = meetings[i % 20];
    const task = direction === 'ours' && status === 'open' ? openOurs[i - 8] : null;
    const text = task ? task.title : pick(PROMISES);
    return {
      id: i + 1, direction, text, contactId: m.companyId ? contactsAt(m.companyId)[0]?.id ?? null : null, dueDate: status === 'open' ? addDays(m.meetingDate!, 7) : null, status,
      closedAt: status === 'kept' ? addDays(m.meetingDate!, 3) : null, dropReason: null, companyId: m.companyId ?? null, opportunityId: null, projectId: null, sourceType: 'meeting', sourceId: m.id, sourceKey: `${text.toLowerCase()} ${i}`,
      todoId: task?.id ?? null, createdAt: `${m.meetingDate}T10:00:00Z`, updatedAt: null,
    };
  });

  // ── Notes ──
  const noteClients = shuffle(idsOf('both')).slice(0, 4);
  const notes: Note[] = NOTE_TITLES.slice(0, N.notes).map((title, i) => {
    const companyId = i < 4 ? noteClients[i] : null;
    const at = ago(int(1, 25));
    return {
      id: i + 1, title: companyId ? `${nameOf(companyId)} — ${title}` : title, content: `# ${title}\n\n- ${pick(REMARKS)}\n- ${pick(NOTE_TEXTS)}\n- [ ] ${taskTitle()}`,
      folder: companyId ? 'Client Notes' : i % 3 ? 'Internal' : 'Meeting Notes', clientName: companyId ? nameOf(companyId) : null, companyId, tags: [], pinned: i === 0, createdAt: at, updatedAt: at,
    };
  });
  const noted108 = shuffle(companies.map((c) => c.name)).slice(0, N.companyNotes);
  const companyNotes: Record<string, string> = Object.fromEntries(noted108.map((name) => [name, pick(COMPANY_NOTE_TEXTS)]));
  const companyNoteEntries = idsOf('both').slice(0, 2).map((id, i) => ({ id: 8001 + i, companyId: id, companyName: nameOf(id), body: pick(COMPANY_NOTE_TEXTS), isLegacy: false, createdAt: `${ago(10 + i)}T09:00:00Z`, updatedAt: null, pinned: i === 0 }));

  // The reviewer and the owner by the names the small sample uses; the others are made up like the contacts.
  const teamMembers: TeamMember[] = ['Hassan Balaghi', 'Ahmad Abdallah', ...Array.from({ length: 6 }, person)].map((name, i) => ({ id: i + 1, name, email: null, jobTitle: null, department: null, isReviewer: i === 0, active: true, notes: null }));

  return {
    data: { proposals, contacts, agreements, todos, notes, noteFolders: ['Meeting Notes', 'Client Notes', 'Internal', 'Templates', 'Archive'], contactLists: [], companyNotes, commitments },
    companies, opportunities, projects, milestones: [], meetings, touches, teamMembers, companyNoteEntries,
  };
}
