// Dev-only IPC mock so the app can be visually QA'd in a plain browser tab
// (no Tauri webview / no `window.__TAURI_INTERNALS__.invoke`) during
// `npm run dev`. Uses Tauri's own officially-supported `@tauri-apps/api/mocks`
// helper. Statically stripped from production builds: `import.meta.env.DEV`
// is a Vite compile-time constant, so `vite build` dead-code-eliminates this
// entire branch and the real Tauri IPC bridge is untouched in the shipped app.
import catalogSeed from '../../src-tauri/src/catalog_seed.json';
import type { CommercialSetup, AppData, Project, Area, Meeting, InboxItem, NoteTemplate, Milestone, NoteRef, EmailRecord, EmailCompletedRecord, IntelligenceItem, Company, Opportunity, OpportunityActivity, ProjectActivity, EntityLink, ReviewQueueEntry, SavedList } from './types';

const SAMPLE: AppData = {
  proposals: [
    {
      id: 1, client: 'Acme Holdings', type: 'Payroll + PRO', status: 'Signed by Both Parties', sentDate: '2026-01-10',
      dblSignedDate: '2026-01-20', kickoffDate: '2026-02-01', finance: null, hubspot: null, owner: 'Ahmad',
      remarks: null, dateAdded: '2026-01-10', monthlyFee: 15000, contractMonths: 12, winLossReason: 'Referral / existing relationship',
      docLink: null, archived: false, archivedAt: null, snoozedUntil: null, dateSentToHassan: '2026-01-08',
      dateSentToClient: '2026-01-10', dateSigned: '2026-01-20', notes: [],
      businessEntityId: 1, currency: 'SAR', reviewerId: 1, reviewStatus: 'approved', reviewedAt: '2026-01-09',
      lines: [
        { id: 1, serviceId: 15, serviceName: 'Payroll', description: null, billing: 'monthly', quantity: 1, unitPrice: 9000, commission: false, sortOrder: 0 },
        { id: 2, serviceId: 17, serviceName: 'PRO', description: 'Up to 25 employees', billing: 'monthly', quantity: 1, unitPrice: 6000, commission: false, sortOrder: 1 },
      ],
      documents: [],
    },
    {
      id: 2, client: 'Acme Holdings', type: 'Recruitment', status: 'In Internal Review', sentDate: null,
      dblSignedDate: null, kickoffDate: null, finance: null, hubspot: null, owner: null,
      remarks: 'Five engineers for the Riyadh site', dateAdded: '2026-09-08', monthlyFee: 7000, contractMonths: 6, winLossReason: null,
      docLink: null, archived: false, archivedAt: null, snoozedUntil: null, dateSentToHassan: '2026-09-10',
      dateSentToClient: null, dateSigned: null, notes: [],
      businessEntityId: 1, currency: 'SAR', reviewerId: 1, reviewStatus: 'pending', reviewRequestedAt: '2026-09-10', leadSource: 'Referral',
      lines: [{ id: 3, serviceId: 18, serviceName: 'Recruitment', description: null, billing: 'monthly', quantity: 1, unitPrice: 7000, commission: false, sortOrder: 0 }],
      documents: [],
    },
  ],
  contacts: [
    { id: 1, clientName: 'Acme Holdings', name: 'Jane Doe', role: 'CEO', email: 'jane@acme.test', phone: null, whatsapp: null, service: null, lists: [] },
    { id: 2, clientName: 'Acme Holdings', companyId: 1, name: 'Omar Haddad', role: 'Finance manager', email: 'omar@acme.test', phone: null, whatsapp: null, service: null, lists: [] },
  ],
  agreements: [
    {
      id: 1, agrRef: 'ACME_ADM_001_0126', client: 'Acme Holdings', companyId: 1, type: 'Administration', status: 'Signed', preparedBy: 'Hassan Balaghi',
      datePrepared: '2026-01-21', dateSentToClient: '2026-01-22', dateClientSigned: '2026-01-25', dateMenaSigned: '2026-01-26', dateFiled: '2026-01-27',
      monthlyFee: 15000, contractMonths: 12, proposalId: 1, hubspot: 'Yes', docLink: null, actionDate: null, remarks: null, createdAt: '2026-01-21',
      businessEntityId: 1, currency: 'SAR', startDate: '2026-02-01', endDate: '2027-01-31', serviceStatus: 'Active', autoRenew: false, noticeDays: 60, preparedById: 1,
      lines: [
        { id: 11, serviceId: 15, serviceName: 'Payroll', description: null, billing: 'monthly', quantity: 1, unitPrice: 9000, commission: false, sortOrder: 0 },
        { id: 12, serviceId: 17, serviceName: 'PRO', description: 'Up to 25 employees', billing: 'monthly', quantity: 1, unitPrice: 6000, commission: false, sortOrder: 1 },
      ],
    },
  ],
  todos: [
    { id: 1, title: 'Follow up on Acme proposal', type: 'client', client: 'Acme Holdings', priority: 'High', dueDate: '2026-09-10', status: 'Pending', description: null, createdAt: '2026-09-01', completedAt: null, projectId: null, parentId: null, areaId: null, section: null, sortOrder: 1, recurrenceRule: null, meetingId: null, tags: ['urgent'] },
    { id: 2, title: 'Prepare Q3 recruitment report', type: 'general', client: null, priority: 'Medium', dueDate: '2026-09-15', status: 'In Progress', description: null, createdAt: '2026-09-02', completedAt: null, projectId: null, parentId: null, areaId: null, section: null, sortOrder: 2, recurrenceRule: null, meetingId: null, tags: ['reporting'] },
    { id: 3, title: 'Gather Q3 numbers', type: 'general', client: null, priority: 'Medium', dueDate: '2026-09-12', status: 'Done', description: null, createdAt: '2026-09-02', completedAt: '2026-09-08', projectId: null, parentId: 2, areaId: null, section: null, sortOrder: 1, recurrenceRule: null, meetingId: null, tags: [] },
    { id: 4, title: 'Draft summary slide', type: 'general', client: null, priority: 'Low', dueDate: '2026-09-14', status: 'Pending', description: null, createdAt: '2026-09-02', completedAt: null, projectId: null, parentId: 2, areaId: null, section: null, sortOrder: 2, recurrenceRule: null, meetingId: null, tags: [] },
    { id: 6, title: 'Send the revised quote for three people', type: 'client', client: 'Acme Holdings', priority: 'Medium', dueDate: '2026-09-19', status: 'Pending', description: 'From meeting: Monthly check-in', createdAt: '2026-09-15', completedAt: null, projectId: null, parentId: null, areaId: null, section: null, sortOrder: 4, recurrenceRule: null, meetingId: 2, companyId: 1, opportunityId: 1, tags: [], owner: 'Ahmad Abdallah' },
    { id: 7, title: 'Share the October headcount', type: 'client', client: 'Acme Holdings', priority: 'Medium', dueDate: null, status: 'Pending', description: 'From meeting: Monthly check-in', createdAt: '2026-09-15', completedAt: null, projectId: null, parentId: null, areaId: null, section: null, sortOrder: 5, recurrenceRule: null, meetingId: 2, tags: [], owner: 'Omar Haddad' },
    { id: 5, title: 'Weekly payroll review', type: 'general', client: null, priority: 'Medium', dueDate: '2026-09-11', status: 'Pending', description: null, createdAt: '2026-09-01', completedAt: null, projectId: null, parentId: null, areaId: null, section: null, sortOrder: 3, recurrenceRule: 'weekly', meetingId: null, tags: ['payroll'] },
  ],
  notes: [
    {
      id: 1, title: 'Welcome to MENA One', folder: 'Internal', clientName: null, tags: ['sample'], pinned: true,
      createdAt: '2026-09-01', updatedAt: '2026-09-01',
      content: '# Welcome to MENA One\n\nThis is sample data shown only in the browser dev-preview. See [[Acme Holdings Kickoff]].\n\n## Formatting check\n\n- **Bold**, *italic*, ~~strikethrough~~, and `inline code`\n- A [link](https://example.com)\n\n### Checklist\n\n- [x] Ship the Markdown-first editor\n- [ ] Migrate real production notes\n- [ ] Wire up attachments\n\n> A blockquote for good measure.\n\n```\nconst hello = "code block";\n```',
    },
    {
      id: 2, title: 'Acme Holdings Kickoff', folder: 'Client Notes/Acme Holdings', clientName: 'Acme Holdings', tags: ['kickoff'], pinned: false,
      createdAt: '2026-09-01', updatedAt: '2026-09-01',
      content: '# Acme Holdings Kickoff\n\nKickoff notes for Acme Holdings.\n\n## Attendees\n\n- Jane Doe (CEO)\n- Ahmad (MENA BIG)\n\n## Next steps\n\n- [ ] Send proposal\n- [ ] Confirm headcount',
    },
    {
      id: 3, title: 'Acme — Payroll Requirements', folder: 'Client Notes/Acme Holdings', clientName: 'Acme Holdings', tags: ['payroll'], pinned: false,
      createdAt: '2026-09-03', updatedAt: '2026-09-03',
      content: '# Acme — Payroll Requirements\n\nPayroll cycle requirements gathered from Acme finance team.',
    },
  ],
  noteFolders: ['Meeting Notes', 'Client Notes', 'Client Notes/Acme Holdings', 'Internal'],
  contactLists: [],
  companyNotes: {},
  // Fictional commitments from the Monthly check-in (meeting 2): one each way.
  commitments: [
    { id: 1, direction: 'ours', text: 'Send the revised quote for three people', contactId: null, dueDate: '2026-09-19', status: 'open', closedAt: null, dropReason: null,
      companyId: 1, opportunityId: 1, projectId: null, sourceType: 'meeting', sourceId: 2, sourceKey: 'send the revised quote for three people', todoId: 6, createdAt: '2026-09-15T10:00:00Z', updatedAt: null },
    { id: 2, direction: 'theirs', text: 'Omar to share the October headcount', contactId: 2, dueDate: '2026-09-18', status: 'open', closedAt: null, dropReason: null,
      companyId: 1, opportunityId: 1, projectId: null, sourceType: 'meeting', sourceId: 2, sourceKey: 'omar to share the october headcount', todoId: null, createdAt: '2026-09-15T10:00:00Z', updatedAt: null },
  ],
};

const SAMPLE_PROJECTS: Project[] = [
  {
    id: 1, name: 'Acme Holdings — Retainer Delivery', type: 'client', status: 'In Progress', priority: 'High',
    owner: 'Ahmad', description: null, companyName: 'Acme Holdings', areaId: null, startDate: '2026-02-01',
    targetDate: '2026-12-31', completionDate: null, progressOverride: null, tags: [], archived: false,
    createdAt: '2026-02-01', updatedAt: '2026-09-01', taskCount: 4, taskDoneCount: 1, computedProgress: 25,
  },
  {
    id: 2, name: 'Launch MENA BIG Recruitment Division', type: 'internal', status: 'Planning', priority: 'Medium',
    owner: 'Ahmad', description: null, companyName: null, areaId: null, startDate: '2026-08-01',
    targetDate: '2026-12-01', completionDate: null, progressOverride: null, tags: [], archived: false,
    createdAt: '2026-08-01', updatedAt: '2026-09-05', taskCount: 6, taskDoneCount: 2, computedProgress: 33,
  },
];

// Mutable in-memory store (session-only) so the Projects UI can be exercised
// end-to-end — add/edit/archive/milestones — while previewing in a plain
// browser tab. The real Tauri build never touches this file's state; it's
// re-seeded from SAMPLE_PROJECTS on every page load.
let projectsStore: Project[] = SAMPLE_PROJECTS.map((p) => ({ ...p }));
let milestonesStore: Milestone[] = [];
const mockMeeting = (id: number, title: string, date: string, emails: { email: string; name: string }[]): Meeting => ({
  id, title, meetingDate: date, companyName: null, companyId: null, projectId: null, opportunityId: null, attendees: emails.map((e) => e.name),
  agenda: null, discussion: null, decisions: null, actionItems: null, followUp: null, nextMeeting: null, noteId: null,
  createdAt: date, updatedAt: date, outlookEventId: `evt-${id}`, startAt: `${date}T09:00:00Z`, endAt: `${date}T10:00:00Z`, organizer: 'Ahmad Abdallah',
  location: null, isOnlineMeeting: true, onlineMeetingUrl: null, isCancelled: false, source: 'outlook', organizerEmail: 'ahmad@menabig.test',
  attendeeEmails: emails.map((e) => e.email),
});
let meetingsStore: Meeting[] = [
  { ...mockMeeting(1, 'Acme — payroll kickoff', '2026-08-20', [{ email: 'jane@acme.test', name: 'Jane Doe' }]), companyName: 'Acme Holdings', companyId: 1, followUp: 'Send the onboarding checklist\nConfirm GOSI access', decisions: 'Start payroll from October' },
  { ...mockMeeting(2, 'Monthly check-in', '2026-09-15', [{ email: 'jane@acme.test', name: 'Jane Doe' }, { email: 'omar@acme.test', name: 'Omar Haddad' }]), companyName: 'Acme Holdings', companyId: 1, opportunityId: 1,
    discussion: '- Headcount goes from 4 to **3** people\n- Omar wants the GOSI report monthly\n- [ ] Check the October payroll calendar', decisions: '- Price on three people from November\n- Monthly GOSI report from us',
    nextMeeting: '2026-10-13', inviteText: '________________________________\nMicrosoft Teams meeting\nJoin: https://teams.microsoft.com/l/meetup-join/demo\nMeeting ID: 000 000 000\n________________________________' },
  mockMeeting(3, 'Intro call — Northwind', '2026-09-16', [{ email: 'lina@northwind.test', name: 'Lina Saleh' }]),
  ...todaysMockMeetings(),
];

/** Meetings around the current time, so My Day's timeline has something to show. */
function todaysMockMeetings(): Meeting[] {
  const now = Date.now();
  const at = (hours: number) => new Date(now + hours * 3600e3);
  const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const make = (id: number, title: string, start: number, mins: number, extra: Partial<Meeting>): Meeting => ({
    ...mockMeeting(id, title, day(at(start)), []), startAt: at(start).toISOString(), endAt: at(start + mins / 60).toISOString(), ...extra,
  });
  return [
    make(11, 'Proposals review', -2, 30, { attendeeEmails: ['hassan@menabig.test'], attendees: ['Hassan Balaghi'], organizerEmail: 'ahmad@menabig.test' }),
    make(12, 'Acme — renewal terms', -0.2, 45, { companyName: 'Acme Holdings', companyId: 1, attendeeEmails: ['jane@acme.test'], attendees: ['Jane Doe'], onlineMeetingUrl: 'https://teams.microsoft.com/l/meetup-join/demo' }),
    make(13, 'GM Representative', 2, 30, { companyName: 'Northwind', attendeeEmails: ['lina@northwind.test'], attendees: ['Lina Saleh'], isOnlineMeeting: false, location: 'Riyadh office' }),
  ];
}
let companiesStore: Company[] = [];
let savedListsStore: SavedList[] = [];
/** Company notes as dated entries (schema 32). */
const companyNoteEntriesStore: any[] = [
  { id: 8001, companyId: 1, companyName: 'Acme Holdings', body: 'Finance signs off on anything above SAR 50k — allow an extra week.', isLegacy: false, createdAt: '2026-07-14T09:12:00Z', updatedAt: null },
  { id: 8002, companyId: 1, companyName: 'Acme Holdings', body: 'Prefers everything by email; the HR director is the real decision maker.', isLegacy: true, createdAt: '2026-05-02T08:00:00Z', updatedAt: null },
];
let nextSavedListId = 0;
function makeMockCompany(id: number, name: string): Company {
  return {
    id, name, legalName: null, industries: [], website: null, country: null, city: null,
    companyType: null, status: null, owner: null, description: null, archived: false,
    createdAt: new Date().toISOString(), updatedAt: null,
  };
}
companiesStore = [{ ...makeMockCompany(1, 'Acme Holdings'), industries: ['Logistics'], owner: 'Ahmad', website: 'acme.test', country: 'Saudi Arabia', city: 'Riyadh' }];
let reviewQueueStore: ReviewQueueEntry[] = [];
const mockOpp = (id: number, name: string, stage: string, value: number | null, created: string, extra: Partial<Opportunity> = {}): Opportunity => ({
  id, name, companyId: 1, companyName: 'Acme Holdings', owner: 'Ahmad', stage, status: stage === 'Won' ? 'Won' : stage === 'Lost' ? 'Lost' : 'Open',
  estimatedValue: value, currency: 'SAR', probability: null, expectedCloseDate: null, description: null, nextAction: null, proposalId: null,
  projectId: null, sortOrder: null, archived: false, createdAt: created, updatedAt: created, tags: [], ...extra,
});
let opportunitiesStore: Opportunity[] = [
  mockOpp(1, 'Acme — recruitment for Riyadh site', 'Proposal', 42000, '2026-07-01', { nextAction: 'Chase the signed proposal', expectedCloseDate: '2026-09-30', probability: 60 }),
  mockOpp(2, 'Acme — GOSI audit', 'Discovery', 15000, '2026-06-10'),
  mockOpp(3, 'Acme — payroll outsourcing', 'Won', 108000, '2026-05-01', { winLossReason: 'Referral / existing relationship' }),
  mockOpp(4, 'Acme — mobilization', 'Lost', 60000, '2026-04-01', { winLossReason: 'Price too high' }),
];
let opportunityActivityStore: OpportunityActivity[] = [];
let projectActivityStore: ProjectActivity[] = [];
let nextProjectId = 1000;
let nextMilestoneId = 1;
let nextMeetingId = 1;
let nextCompanyId = 100; // above the sample companies' ids
let nextOpportunityId = 100; // above the sample opportunities' ids
let nextOpportunityActivityId = 1;
let nextProjectActivityId = 1;
let nextMsFileId = 1;
const msFilesStore: { id: number; path: string; name: string; itemType: string }[] = [];
// A small fake OneDrive tree so the folder picker and the Company-matching
// wizard are both exercisable in the browser dev-preview — the real backend
// reads the actual Finder-synced folder instead. Names deliberately include
// an exact match, a fuzzy/containment match, and a no-match case against the
// mock "Acme Holdings" company, mirroring the roadmap's own Globex/Contoso example.
const mockOneDriveTree: Record<string, { path: string; name: string; isFolder: boolean }[]> = {
  '/mock/OneDrive-Business': [
    { path: '/mock/OneDrive-Business/Proposals', name: 'Proposals', isFolder: true },
  ],
  '/mock/OneDrive-Business/Proposals': [
    { path: '/mock/OneDrive-Business/Proposals/Acme Holdings', name: 'Acme Holdings', isFolder: true },
    { path: '/mock/OneDrive-Business/Proposals/Acme', name: 'Acme', isFolder: true },
    { path: '/mock/OneDrive-Business/Proposals/Unknown Client', name: 'Unknown Client', isFolder: true },
  ],
  '/mock/OneDrive-Business/Proposals/Acme Holdings': [
    { path: '/mock/OneDrive-Business/Proposals/Acme Holdings/Retainer Agreement.docx', name: 'Retainer Agreement.docx', isFolder: false },
    { path: '/mock/OneDrive-Business/Proposals/Acme Holdings/Acme Holdings_Payroll Proposal_10.01.2026_V1.pptx', name: 'Acme Holdings_Payroll Proposal_10.01.2026_V1.pptx', isFolder: false },
    { path: '/mock/OneDrive-Business/Proposals/Acme Holdings/Signed agreement.pdf', name: 'Signed agreement.pdf', isFolder: false },
    { path: '/mock/OneDrive-Business/Proposals/Acme Holdings/Fee model.xlsx', name: 'Fee model.xlsx', isFolder: false },
    { path: '/mock/OneDrive-Business/Proposals/Acme Holdings/Logo.png', name: 'Logo.png', isFolder: false },
    { path: '/mock/OneDrive-Business/Proposals/Acme Holdings/Correspondence', name: 'Correspondence', isFolder: true },
  ],
  '/mock/OneDrive-Business/Proposals/Acme': [],
  '/mock/OneDrive-Business/Proposals/Unknown Client': [],
};

const NOW = Date.now();
const emailsStore: EmailRecord[] = [
  {
    id: 1, messageId: 'mock-1', conversationId: null, subject: 'Retainer renewal — need sign-off',
    senderName: 'Jane Doe', senderEmail: 'jane@acme.test', preview: 'Can you confirm the renewal terms before Friday?',
    receivedAt: new Date(NOW - 2 * 3600_000).toISOString(), flagStatus: 'flagged',
    flagDueAt: new Date(NOW - 3600_000).toISOString(), webLink: 'https://outlook.office.com/mail/mock1', isRead: false, companyName: 'Acme Holdings',
  },
  {
    id: 2, messageId: 'mock-2', conversationId: null, subject: 'Proposal follow-up',
    senderName: 'Karim Haddad', senderEmail: 'karim@sngular.test', preview: 'Just checking in on the proposal we sent last week.',
    receivedAt: new Date(NOW - 26 * 3600_000).toISOString(), flagStatus: 'flagged',
    flagDueAt: new Date(NOW + 5 * 3600_000).toISOString(), webLink: 'https://outlook.office.com/mail/mock2', isRead: true, companyName: null,
  },
  {
    id: 3, messageId: 'mock-3', conversationId: null, subject: 'Q3 kickoff — agenda attached',
    senderName: 'Mona Al-Sayed', senderEmail: 'mona@fabrikam.test', preview: 'Agenda for Thursday is attached, let me know if anything is missing.',
    receivedAt: new Date(NOW - 5 * 24 * 3600_000).toISOString(), flagStatus: 'flagged',
    flagDueAt: null, webLink: 'https://outlook.office.com/mail/mock3', isRead: true, companyName: 'Fabrikam Engineering',
  },
];
const completedLogStore: EmailCompletedRecord[] = [
  { id: 100, messageId: 'mock-100', subject: 'Contract copy for records', senderName: 'Legal Team', senderEmail: 'legal@mena-big.test', completedAt: new Date(NOW - 3 * 24 * 3600_000).toISOString() },
];
let nextIntelId = 100;
let intelItemsStore: IntelligenceItem[] = [
  {
    id: 1, kind: 'regulatory', headline: 'GOSI announces updated contribution rates for 2027',
    summary: 'Annual adjustment to employer/employee contribution percentages.', whatChanged: 'Employer contribution rate increases by 0.5%.',
    effectiveDate: '2027-01-01', whoAffected: 'All private-sector employers', whyItMatters: 'Affects payroll cost modelling for all active clients.',
    country: 'Saudi Arabia', category: 'Labour', status: 'confirmed', importance: 'critical',
    sourceName: 'GOSI', sourceTier: 1, sourceUrl: 'https://gosi.gov.sa', publishedAt: '2026-09-01',
    saved: true, archived: false, createdAt: new Date(NOW - 5 * 24 * 3600_000).toISOString(), companyName: null, ingestedVia: null,
  },
  {
    id: 2, kind: 'business', headline: 'Major logistics investment announced in Riyadh',
    summary: 'A regional operator announced a new distribution hub.', whatChanged: null,
    effectiveDate: null, whoAffected: null, whyItMatters: 'Potential recruitment demand in logistics sector.',
    country: 'Saudi Arabia', category: 'Investment', status: 'announced', importance: 'monitor',
    sourceName: 'Argaam', sourceTier: 6, sourceUrl: 'https://argaam.com', publishedAt: '2026-09-05',
    saved: false, archived: false, createdAt: new Date(NOW - 2 * 24 * 3600_000).toISOString(), companyName: null, ingestedVia: null,
  },
];

function recomputeProject(p: Project): Project {
  const tasks = SAMPLE.todos.filter((t) => t.projectId === p.id);
  const done = tasks.filter((t) => t.status === 'Done').length;
  return { ...p, taskCount: tasks.length, taskDoneCount: done, computedProgress: tasks.length ? Math.round((done / tasks.length) * 100) : 0 };
}

let templatesStore: NoteTemplate[] = [
  { id: 1, name: 'Meeting Notes', content: '## Attendees\n\n\n## Agenda\n\n\n## Decisions\n\n\n## Action Items\n', sortOrder: 1 },
  { id: 2, name: 'Client Check-in', content: '## Status\n\n\n## Blockers\n\n\n## Next Steps\n', sortOrder: 2 },
];
let nextTemplateId = 100;
let nextAttachmentId = 1;
/** The preview part of a mock generation (slides, values, report). */
function mockBuildDeck(r: any): any {
          if (r.fromLibrary) {
            const src = (i: number) => (i >= 11 && i <= 13 ? 'Labor Law - HR - Manpower Consultancy Services Proposal Template' : 'Accountancy & VAT Service Proposal Template');
            const titles = ['Cover', 'Attn: Acme Holdings', 'AGENDA', 'Detailed Approach & Project Fees', 'ACCOUNTANCY SERVICES', 'Detailed Approach', 'Detailed Approach', 'Detailed Approach', 'ACCOUNTANCY FEES BREAKDOWN', 'Value Based', 'LABOR LAW & EMPLOYMENT', 'Detailed Approach', 'Value Based', 'Terms & Conditions, and Acceptance', 'Terms', 'Applicable Law', 'We believe that this proposal', 'About MENA BIG', '50+ Clients', 'Selected References', 'MENA - BIG'];
            return {
              slides: titles.map((t, i) => ({ index: i + 1, slideId: String(256 + i), title: t, included: true, reason: i >= 4 && i <= 9 ? 'For Accountancy & VAT' : i >= 10 && i <= 12 ? 'For Labor Law Consultancy' : 'Standard slide', source: src(i + 1) })),
              values: { client_name: 'Acme Holdings', proposal_date_ordinal: '14th September 2026' },
              report: { slidesBefore: 21, slidesAfter: 21, partsRemoved: 0, tokensFilled: 0, missingTokens: [], smart: { filled: ['Client name in 15 places', 'Agenda page numbers recounted', 'Date on 2 slides'], feesToCheck: ['Slide 10: 2,250 SAR — Acct – bookkeeping + E-Invoicing'], warnings: [] } },
              folder: `${COMMERCIAL.proposalsRoot}/Acme Holdings`, folderExists: true, path: r.dryRun ? null : `${COMMERCIAL.proposalsRoot}/Acme Holdings/${r.fileName}`,
              fileName: r.fileName, warnings: [], baseTemplate: 'Accountancy & VAT Service Proposal Template', servicesTitle: 'Accountancy & VAT and Labor Law Consultancy Services',
            };
          }
          return {
            slides: MOCK_INSPECTION.slides.map((sl: any) => ({ index: sl.index, slideId: sl.slideId, title: sl.title, included: sl.tags.services.length === 0 || sl.tags.services.includes('Payroll'), reason: sl.tags.services.length ? `Only for ${sl.tags.services.join(', ')}` : 'Always included' })),
            values: { client_name: 'Acme Holdings', proposal_date_ordinal: '13th September 2026', services: 'Payroll and PRO', monthly_total: 'SAR 15,000', contact_name: '' },
            report: { slidesBefore: 6, slidesAfter: 4, partsRemoved: 12, tokensFilled: 9, missingTokens: [], smart: { filled: ['Client name in 3 places', 'Date on 2 slides', ...(r.logoPath ? ['Client logo placed'] : []), 'Agenda page numbers recounted', '1 fee amount updated from the proposal\'s services'], feesToCheck: ['Slide 5: 9% — a percentage; set it by hand', 'Slide 5: 12.000 SAR — Recruitment fee'], warnings: r.logoPath ? [] : ['No client logo was chosen, so the "Logo" box was removed.'] } },
            folder: `${COMMERCIAL.proposalsRoot}/Acme Holdings`, folderExists: true, path: r.dryRun ? null : `${COMMERCIAL.proposalsRoot}/Acme Holdings/${r.fileName}`,
            fileName: r.fileName, warnings: ['No primary contact is set; contact fields will be blank.'],
          };
        }
const generatedDecks: { proposalId: number; fileName: string; version: number }[] = [];

const attachmentDataStore = new Map<number, string>();
const appMetaStore = new Map<string, string>();
let entityLinksStore: EntityLink[] = [];

let proposalTemplatesStore: any[] = [];
const MOCK_INSPECTION: any = {
  slideCount: 6,
  tokens: ['client_name', 'proposal_date_ordinal', 'line.service', 'line.amount', 'monthly_total'],
  slides: [
    { index: 1, slideId: '256', title: 'Proposal for {{client_name}}', text: 'Proposal for {{client_name}}\n{{proposal_date_ordinal}}', notes: '[always]', tags: { always: true, never: false, services: [], entity: null }, tokens: ['client_name', 'proposal_date_ordinal'], hasLineTable: false, smartFields: ['Client name ×1', 'Date', 'Logo box'] },
    { index: 2, slideId: '257', title: 'About MENA BIG', text: '50+ clients across the region', notes: '', tags: { always: false, never: false, services: [], entity: null }, tokens: [], hasLineTable: false, smartFields: [] },
    { index: 3, slideId: '258', title: 'PAYROLL', text: 'Payroll module', notes: '[services: Payroll, GOSI & Payroll]', tags: { always: false, never: false, services: ['Payroll', 'GOSI & Payroll'], entity: null }, tokens: [], hasLineTable: false, smartFields: [] },
    { index: 4, slideId: '259', title: 'RECRUITMENT', text: 'Recruitment module', notes: '[services: Recruitment]', tags: { always: false, never: false, services: ['Recruitment'], entity: null }, tokens: [], hasLineTable: false, smartFields: [] },
    { index: 5, slideId: '260', title: 'Project Fees', text: '{{line.service}} {{line.amount}}\nTotal {{monthly_total}}', notes: '[always]', tags: { always: true, never: false, services: [], entity: null }, tokens: ['line.service', 'line.amount', 'monthly_total'], hasLineTable: true, smartFields: ['2 amounts'] },
    { index: 6, slideId: '261', title: 'MENA - BIG', text: 'Thank you', notes: '', tags: { always: false, never: false, services: [], entity: null }, tokens: [], hasLineTable: false, smartFields: [] },
  ],
};

const COMMERCIAL: CommercialSetup = {
  rateCards: catalogSeed.rateCards.map((r, i) => ({ id: i + 1, name: r.name, category: r.category, pricing: r.pricing as any, addons: r.addons, sortOrder: r.sortOrder })),
  services: catalogSeed.services.map((sv, i) => ({
    id: i + 1, name: sv.name, category: sv.category, description: null, agreementType: sv.agreementType, billing: sv.billing as 'monthly' | 'one_time',
    defaultPrice: null, rateCardId: sv.rateCard ? catalogSeed.rateCards.findIndex((r) => r.name === sv.rateCard) + 1 : null, templateKey: null, active: true, sortOrder: sv.sortOrder, mergedInto: null,
  })),
  businessEntities: [
    { id: 1, code: 'KSA', name: 'MENA BIG KSA', currency: 'SAR', vatRate: 15, country: 'Saudi Arabia', active: true, sortOrder: 0 },
    { id: 2, code: 'EU', name: 'MENA BIG Europe', currency: 'EUR', vatRate: null, country: null, active: true, sortOrder: 1 },
  ],
  teamMembers: [{ id: 1, name: 'Hassan Balaghi', email: null, jobTitle: null, department: null, isReviewer: true, active: true, notes: null }],
  fxRates: {},
  proposalsRoot: '/Users/demo/Library/CloudStorage/OneDrive-MENABIG/MENA BD 2026/Proposals',
};

export async function installDevMockIfNeeded(): Promise<void> {
  if (!import.meta.env.DEV) return;
  if ((window as any).__TAURI_INTERNALS__?.invoke) return; // real Tauri bridge present — never mock it

  await import('@tauri-apps/api/mocks').then(({ mockIPC }) => {
    mockIPC((cmd: string, _payload: unknown) => {
      switch (cmd) {
        case 'get_all_data':
          return SAMPLE;
        case 'get_pipeline_facts':
          return opportunitiesStore.map((o) => ({ opportunityId: o.id, stageEnteredAt: (o.createdAt || '').slice(0, 10), lastActivityAt: o.id === 1 ? '2026-09-10' : (o.createdAt || '').slice(0, 10), stages: [{ stage: 'Lead', enteredAt: (o.createdAt || '').slice(0, 10) }, { stage: o.stage, enteredAt: (o.createdAt || '').slice(0, 10) }] }));
        case 'templates_list':
          return proposalTemplatesStore;
        case 'template_tokens':
          return [
            { token: 'client_name', label: 'Client name', example: 'Acme Holdings' },
            { token: 'proposal_date_ordinal', label: 'Date with ordinal', example: '13th September 2026' },
            { token: 'services', label: 'Services, as a sentence', example: 'Payroll and PRO' },
            { token: 'monthly_total', label: 'Monthly total', example: 'SAR 9,000' },
            { token: 'line.service', label: 'Fee table row: service', example: 'Payroll' },
            { token: 'line.amount', label: 'Fee table row: amount', example: 'SAR 6,000' },
          ];
        case 'template_inspect':
        case 'template_detail': {
          const t = cmd === 'template_detail' ? proposalTemplatesStore.find((x: any) => x.id === (_payload as any).id) : null;
          const rules = MOCK_INSPECTION.slides.map((sl: any) => t?.config.slides.find((r: any) => r.slideId === sl.slideId) || { slideId: sl.slideId, include: sl.tags.services.length ? 'services' : 'always', services: sl.tags.services, entity: null });
          return cmd === 'template_inspect' ? MOCK_INSPECTION : { template: t, inspection: MOCK_INSPECTION, rules };
        }
        case 'template_save': {
          const t = { ...(_payload as any).template, slideCount: MOCK_INSPECTION.slideCount, exists: true };
          if (!t.id) t.id = proposalTemplatesStore.length + 1;
          proposalTemplatesStore = [...proposalTemplatesStore.filter((x: any) => x.id !== t.id), t];
          return { template: t, inspection: MOCK_INSPECTION, rules: t.config.slides };
        }
        case 'proposal_library':
          return { master: '/OneDrive/MENA BD 2026/Proposals Templates/MENA BIG Proposal Master 2026.pptx', dir: '/OneDrive/MENA BD 2026/Proposals Templates/Proposals New Logo', templates: [
            { name: 'Accountancy & VAT Service Proposal Template', path: 'a.pptx', slideCount: 18, services: ['Accountancy & VAT'], sentTo: null },
            { name: 'Labor Law - HR - Manpower Consultancy Services Proposal Template', path: 'b.pptx', slideCount: 22, services: ['Labor Law Consultancy'], sentTo: null },
          ] };
        case 'proposal_generate': {
          const r = (_payload as any).request;
          const built = mockBuildDeck(r);
          if (r.dryRun) return { ...built, path: null, errors: [], document: null };
          // Like the real generator: an existing file name or a failure records nothing.
          const taken = generatedDecks.some((d) => d.fileName === r.fileName) || /acme holdings_payroll & pro proposal_08\.01\.2026(_v2)?\.pptx$/i.test(r.fileName);
          if (taken) throw `${r.fileName} already exists in the client folder. Choose another name.`;
          if (/fail/i.test(r.fileName)) throw 'Could not save the proposal: the client folder is read-only.';
          const own = generatedDecks.filter((d) => d.proposalId === r.proposalId).map((d) => d.version);
          const recorded = Math.max(0, ...own, ...((SAMPLE.proposals.find((x: any) => x.id === r.proposalId)?.documents || []) as any[]).filter((d) => d.kind === 'proposal').map((d) => d.version || 0));
          const named = Number((r.fileName.match(/_V(\d+)\.pptx$/i) || [])[1] || 0);
          const version = Math.max(recorded + 1, named);
          const id = 900 + generatedDecks.length + 1;
          const document = { id, kind: 'proposal', version, fileName: r.fileName, path: built.path, url: null, notes: `Generated from ${built.baseTemplate || 'Standard deck'}`, createdAt: new Date().toISOString().slice(0, 10) };
          generatedDecks.push({ proposalId: r.proposalId, fileName: r.fileName, version });
          return { ...built, errors: [], document };
        }
        case 'get_commercial_setup':
          return COMMERCIAL;
        case 'save_rate_card': {
          const c = (_payload as any).card;
          const i = COMMERCIAL.rateCards.findIndex((x) => x.id === c.id);
          if (i > -1) COMMERCIAL.rateCards[i] = c;
          return c;
        }
        case 'save_service': {
          const sv = (_payload as any).service;
          if (sv.id) { const i = COMMERCIAL.services.findIndex((x) => x.id === sv.id); COMMERCIAL.services[i] = sv; return sv; }
          const created = { ...sv, id: Math.max(...COMMERCIAL.services.map((x) => x.id)) + 1 };
          COMMERCIAL.services.push(created);
          return created;
        }
        case 'save_team_member': {
          const m = (_payload as any).member;
          if (m.id) { const i = COMMERCIAL.teamMembers.findIndex((x) => x.id === m.id); COMMERCIAL.teamMembers[i] = m; return m; }
          const created = { ...m, id: Math.max(0, ...COMMERCIAL.teamMembers.map((x) => x.id)) + 1 };
          COMMERCIAL.teamMembers.push(created);
          return created;
        }
        case 'save_business_entity': {
          const e = (_payload as any).entity;
          const i = COMMERCIAL.businessEntities.findIndex((x) => x.id === e.id);
          if (i > -1) COMMERCIAL.businessEntities[i] = e;
          return e;
        }
        case 'set_fx_rate': {
          const { currency, rate } = _payload as any;
          if (rate) COMMERCIAL.fxRates[currency] = rate; else delete COMMERCIAL.fxRates[currency];
          return COMMERCIAL.fxRates;
        }
        case 'proposal_folder_lookup': {
          const client = (_payload as any).client as string;
          const exists = /acme/i.test(client);
          const path = `${COMMERCIAL.proposalsRoot}/${client}`;
          return {
            root: COMMERCIAL.proposalsRoot, path, exists,
            files: exists ? [
              { path: `${path}/Acme Holdings_Payroll & PRO Proposal_08.01.2026.pptx`, name: 'Acme Holdings_Payroll & PRO Proposal_08.01.2026.pptx', isFolder: false, size: 4200000, modifiedAt: '2026-01-08T10:00:00Z', exists: true },
              { path: `${path}/Acme Holdings_Payroll & PRO Proposal_08.01.2026_V2.pptx`, name: 'Acme Holdings_Payroll & PRO Proposal_08.01.2026_V2.pptx', isFolder: false, size: 4300000, modifiedAt: '2026-01-09T10:00:00Z', exists: true },
              { path: `${path}/Commercials.xlsx`, name: 'Commercials.xlsx', isFolder: false, size: 40000, modifiedAt: '2026-01-09T09:00:00Z', exists: true },
            ] : [],
          };
        }
        case 'proposal_folder_create': {
          const client = (_payload as any).client as string;
          return { root: COMMERCIAL.proposalsRoot, path: `${COMMERCIAL.proposalsRoot}/${client}`, exists: true, files: [] };
        }
        case 'get_projects':
          return projectsStore.map(recomputeProject);
        case 'get_project': {
          const id = (_payload as any)?.id;
          const p = projectsStore.find((x) => x.id === id);
          return p ? recomputeProject(p) : null;
        }
        case 'save_project': {
          const project = (_payload as any)?.project as Project;
          if (project.id && project.id !== 0) {
            const idx = projectsStore.findIndex((x) => x.id === project.id);
            if (idx > -1) {
              const prevStatus = projectsStore[idx].status;
              projectsStore[idx] = { ...project, updatedAt: new Date().toISOString() };
              if (prevStatus !== project.status) projectActivityStore.push({ id: ++nextProjectActivityId, projectId: project.id, kind: 'status_changed', detail: `${prevStatus} → ${project.status}`, createdAt: new Date().toISOString().slice(0,10) });
              return recomputeProject(projectsStore[idx]);
            }
          }
          const created: Project = { ...project, id: ++nextProjectId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
          projectsStore.push(created);
          projectActivityStore.push({ id: ++nextProjectActivityId, projectId: created.id, kind: 'created', detail: null, createdAt: new Date().toISOString().slice(0,10) });
          return recomputeProject(created);
        }
        case 'get_project_activity': {
          const projectId = (_payload as any)?.projectId;
          return projectActivityStore.filter((a) => a.projectId === projectId).slice().reverse();
        }
        case 'delete_project': {
          const id = (_payload as any)?.id;
          projectsStore = projectsStore.filter((p) => p.id !== id);
          return null;
        }
        case 'get_milestones': {
          const projectId = (_payload as any)?.projectId;
          return milestonesStore.filter((m) => m.projectId === projectId);
        }
        case 'save_milestones': {
          const projectId = (_payload as any)?.projectId;
          const items = ((_payload as any)?.items ?? []) as Milestone[];
          milestonesStore = milestonesStore.filter((m) => m.projectId !== projectId);
          milestonesStore.push(...items.map((m) => ({ ...m, id: m.id || ++nextMilestoneId, projectId })));
          return null;
        }
        case 'sync_agreements_from_proposals':
          return [];
        case 'get_activity': {
          const f = (_payload as any)?.filter ?? {};
          const now = Date.now();
          const rows = [
            { id: 3, createdAt: new Date(now - 3600_000).toISOString(), actor: null, action: 'status_changed', entityType: 'proposal', entityId: 1, entityLabel: 'Acme Holdings — Retainer', detail: 'Proposal Drafted → Proposal sent to Client', companyId: 1, contactId: null, opportunityId: null, projectId: null },
            { id: 2, createdAt: new Date(now - 26 * 3600_000).toISOString(), actor: null, action: 'completed', entityType: 'task', entityId: 1, entityLabel: 'Send renewal pack', detail: null, companyId: 1, contactId: null, opportunityId: null, projectId: null },
            { id: 1, createdAt: '2026-09-01', actor: null, action: 'created', entityType: 'contact', entityId: 1, entityLabel: 'Jane Doe', detail: 'CEO', companyId: 1, contactId: 1, opportunityId: null, projectId: null },
          ];
          return rows.filter((r) => (f.companyId == null || r.companyId === f.companyId) && (f.contactId == null || r.contactId === f.contactId));
        }
        case 'rename_company': {
          const p = _payload as any;
          return { id: p.id, name: p.name, legalName: null, industries: [], website: null, country: null, city: null, companyType: null, status: null, owner: null, description: null, archived: false, createdAt: null, updatedAt: null };
        }
        case 'ms365_get_emails_by_address':
          return emailsStore.filter((e) => (e.senderEmail || '').toLowerCase() === String((_payload as any)?.address || '').toLowerCase());
        case 'list_local_backups':
          return [{ fileName: 'daily-2026-09-13.sqlite3', sizeBytes: 1_500_000, modifiedAt: Math.floor(Date.now() / 1000) - 3600, kind: 'daily' }];
        case 'backup_database_now':
          return { fileName: 'manual-now.sqlite3', sizeBytes: 1_500_000, modifiedAt: Math.floor(Date.now() / 1000), kind: 'manual' };
        case 'reveal_backups_folder':
          return null;
        case 'upsert_todos': {
          // Projects' computedProgress is derived from task completion (see
          // recomputeProject below), so the mock needs the live task list to
          // make that loop visible while previewing in a plain browser tab.
          const items = ((_payload as any)?.items ?? []) as AppData['todos'];
          for (const t of items) {
            const idx = SAMPLE.todos.findIndex((x) => x.id === t.id);
            if (idx > -1) SAMPLE.todos[idx] = t; else SAMPLE.todos.push(t);
          }
          return items.map((t) => ({ id: t.id, companyId: t.companyId ?? null }));
        }
        case 'commitments_add': {
          // Same rules as commitments.rs: a line already read from the same source is skipped; ours gets a task.
          const items = ((_payload as any)?.items ?? []) as any[];
          const out = { commitments: [] as any[], tasks: [] as any[] };
          const list = (SAMPLE.commitments ||= []);
          for (const n of items) {
            if (n.sourceType !== 'manual' && n.sourceType !== 'capture' && list.some((c) => c.sourceType === n.sourceType && c.sourceId === (n.sourceId ?? null) && c.sourceKey === n.sourceKey)) continue;
            const id = Math.max(0, ...list.map((c) => c.id)) + 1;
            const c: any = { id, direction: n.direction, text: n.text, contactId: n.contactId ?? null, dueDate: n.dueDate ?? null, status: n.kept ? 'kept' : 'open',
              closedAt: null, dropReason: null, companyId: n.companyId ?? null, opportunityId: n.opportunityId ?? null, projectId: n.projectId ?? null,
              sourceType: n.sourceType, sourceId: n.sourceId ?? null, sourceKey: n.sourceKey ?? null, todoId: null, createdAt: new Date().toISOString(), updatedAt: null };
            if (n.direction === 'ours' && !n.kept) {
              const tid = Math.max(0, ...SAMPLE.todos.map((t) => t.id)) + 1;
              const client = n.companyId === 1 ? 'Acme Holdings' : null;
              const t: any = { id: tid, title: n.text, type: client ? 'client' : 'general', client, companyId: n.companyId ?? null, priority: 'Medium', dueDate: n.dueDate ?? null,
                status: 'Pending', description: null, createdAt: new Date().toISOString().slice(0, 10), completedAt: null, projectId: n.projectId ?? null, parentId: null,
                areaId: null, section: null, sortOrder: null, recurrenceRule: null, meetingId: n.meetingId ?? null, opportunityId: n.opportunityId ?? null, tags: [], owner: null };
              SAMPLE.todos.push(t);
              c.todoId = tid;
              out.tasks.push(t);
            }
            list.push(c);
            out.commitments.push(c);
          }
          return out;
        }
        case 'upsert_commitments': {
          const items = ((_payload as any)?.items ?? []) as any[];
          const list = (SAMPLE.commitments ||= []);
          for (const c of items) { const i = list.findIndex((x) => x.id === c.id); if (i > -1) list[i] = c; else list.push(c); }
          return items.map((c) => ({ id: c.id, companyId: c.companyId ?? null }));
        }
        case 'delete_commitments': {
          const ids = ((_payload as any)?.ids ?? []) as number[];
          SAMPLE.commitments = (SAMPLE.commitments || []).filter((c) => !ids.includes(c.id));
          return null;
        }
        case 'delete_todos': {
          const ids = ((_payload as any)?.ids ?? []) as number[];
          SAMPLE.todos = SAMPLE.todos.filter((t) => !ids.includes(t.id) && !(t.parentId != null && ids.includes(t.parentId)));
          return null;
        }
        case 'get_areas':
          return [] as Area[];
        case 'get_meetings':
          return meetingsStore;
        case 'save_meeting': {
          const meeting = (_payload as any)?.meeting as Meeting;
          if (meeting.id && meeting.id !== 0) {
            const idx = meetingsStore.findIndex((x) => x.id === meeting.id);
            const companyId = companiesStore.find((c) => c.name === (meeting.companyName || '').trim())?.id ?? null;
            if (idx > -1) { meetingsStore[idx] = { ...meeting, companyId, updatedAt: new Date().toISOString() }; return meetingsStore[idx]; }
          }
          const created: Meeting = { ...meeting, id: ++nextMeetingId + 100, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
          meetingsStore.push(created);
          return created;
        }
        case 'delete_meeting': {
          const id = (_payload as any)?.id;
          meetingsStore = meetingsStore.filter((m) => m.id !== id);
          return null;
        }
        case 'get_companies':
          return companiesStore;
        case 'get_saved_lists':
          return savedListsStore;
        case 'save_saved_list': {
          const list = (_payload as any)?.list as SavedList;
          const name = (list.name || '').trim();
          if (!name) throw new Error('A list needs a name.');
          if (savedListsStore.some((l) => l.entity === list.entity && l.id !== list.id && l.name.toLowerCase() === name.toLowerCase())) throw new Error(`There is already a list called "${name}".`);
          const now = new Date().toISOString();
          const idx = savedListsStore.findIndex((l) => l.id === list.id);
          if (idx > -1) { savedListsStore[idx] = { ...savedListsStore[idx], name, filters: list.filters, updatedAt: now }; return savedListsStore[idx]; }
          const created: SavedList = { ...list, name, id: ++nextSavedListId, companyIds: [], createdAt: now, updatedAt: now };
          savedListsStore.push(created);
          return created;
        }
        case 'delete_saved_list':
          savedListsStore = savedListsStore.filter((l) => l.id !== (_payload as any)?.id);
          return null;
        case 'set_saved_list_companies': {
          const { listId, add, remove } = _payload as any;
          const l = savedListsStore.find((x) => x.id === listId);
          if (!l) throw new Error('Company list not found.');
          l.companyIds = [...new Set([...l.companyIds, ...(add as number[]).filter((id) => companiesStore.some((c) => c.id === id))])].filter((id) => !(remove as number[]).includes(id)).sort((a, b) => a - b);
          return l;
        }
        case 'create_company': {
          const name = ((_payload as any)?.name || '').trim();
          const existing = companiesStore.find((c) => c.name === name);
          if (existing) return existing;
          const created = makeMockCompany(++nextCompanyId, name);
          companiesStore.push(created);
          return created;
        }
        case 'save_company': {
          const patch = (_payload as any)?.company as Company;
          const idx = companiesStore.findIndex((c) => c.id === patch.id);
          if (idx > -1) { companiesStore[idx] = { ...companiesStore[idx], ...patch, updatedAt: new Date().toISOString() }; return companiesStore[idx]; }
          return patch;
        }
        case 'get_industry_taxonomy':
          return ['Construction & Infrastructure', 'Engineering & Consulting', 'Transportation & Logistics', 'Industrial & Manufacturing', 'Technology', 'Energy & Utilities', 'Real Estate', 'Financial Services', 'Healthcare', 'Education', 'Retail & Consumer', 'Hospitality', 'Government/Public Sector', 'Professional Services', 'Other', 'Unknown'];
        case 'get_review_queue':
          return reviewQueueStore;
        case 'resolve_review_queue_entry': {
          const { id } = (_payload as any) ?? {};
          reviewQueueStore = reviewQueueStore.filter((q) => q.id !== id);
          return null;
        }
        case 'run_company_migration':
          return {
            backupPath: '(dev preview — no real backup file written)',
            distinctLegacyNamesSeen: 0, companiesCreated: 0, fuzzyMatchesLinked: 0, queuedForReview: 0,
            contactsLinked: 0, proposalsLinked: 0, agreementsLinked: 0, projectsLinked: 0, industriesMigrated: 0,
            companiesTotal: companiesStore.length, companiesMissingIndustry: companiesStore.filter((c) => c.industries.length === 0).length,
            companiesWithoutContacts: companiesStore.length,
          };
        case 'save_company_note':
          return null;
        case 'merge_company_links': {
          const { oldName, newName } = (_payload as any) ?? {};
          const oldCo = companiesStore.find((c) => c.name === oldName);
          const newCo = companiesStore.find((c) => c.name === newName);
          if (oldCo && !newCo) {
            oldCo.name = newName;
          } else if (oldCo && newCo) {
            entityLinksStore.forEach((l) => { if (l.toType === 'company' && l.toId === oldCo.id) l.toId = newCo.id; });
            opportunitiesStore.forEach((o) => { if (o.companyId === oldCo.id) o.companyId = newCo.id; });
            companiesStore = companiesStore.filter((c) => c.id !== oldCo.id);
          }
          return null;
        }
        case 'files_list_roots':
          return [{ path: '/mock/OneDrive-Business', name: 'Business', isFolder: true, size: null, modifiedAt: null, exists: true }];
        case 'files_list_folder': {
          const path = (_payload as any)?.path as string;
          return (mockOneDriveTree[path] || []).map((i) => ({ ...i, size: i.isFolder ? null : 2048, modifiedAt: '2026-09-01T00:00:00Z', exists: true }));
        }
        case 'files_open':
        case 'files_reveal_in_finder':
          console.info(`[devMock] ${cmd} — only opens a real file in the built app, not this in-browser preview.`);
          return null;
        case 'files_get_or_create_msfile': {
          const p = _payload as any;
          const existing = msFilesStore.find((f) => f.path === p?.path);
          if (existing) return existing.id;
          const created = { id: ++nextMsFileId, path: p?.path, name: p?.name, itemType: p?.itemType };
          msFilesStore.push(created);
          return created.id;
        }
        case 'files_get_by_ids': {
          const ids: number[] = (_payload as any)?.ids ?? [];
          return msFilesStore.filter((f) => ids.includes(f.id)).map((f) => ({ path: f.path, name: f.name, isFolder: f.itemType === 'folder', size: null, modifiedAt: null, exists: true }));
        }
        case 'files_resolve_company_id': {
          const name = ((_payload as any)?.name || '').trim();
          const existingCo = companiesStore.find((c) => c.name === name);
          if (existingCo) return existingCo.id;
          const created = makeMockCompany(++nextCompanyId, name);
          companiesStore.push(created);
          return created.id;
        }
        case 'files_list_linked': {
          return entityLinksStore
            .filter((l) => l.fromType === 'msfile' && (l.toType === 'company' || l.toType === 'project'))
            .map((l) => {
              const f = msFilesStore.find((x) => x.id === l.fromId);
              if (!f) return null;
              const linkedToName = l.toType === 'company' ? companiesStore.find((c) => c.id === l.toId)?.name : projectsStore.find((p) => p.id === l.toId)?.name;
              return { path: f.path, name: f.name, isFolder: f.itemType === 'folder', exists: true, linkedToType: l.toType, linkedToName: linkedToName || 'Unknown' };
            })
            .filter(Boolean);
        }
        case 'files_stat_paths': {
          const paths: string[] = (_payload as any)?.paths ?? [];
          // Resolve against the mock tree first (matches the real backend's live
          // filesystem stat) — msFilesStore only has entries for items that were
          // actually linked, so a pinned-but-never-linked folder would otherwise
          // wrongly fall back to isFolder:false.
          const treeItems = [
            { path: '/mock/OneDrive-Business', name: 'Business', isFolder: true },
            ...Object.values(mockOneDriveTree).flat(),
          ];
          return paths.map((p) => {
            const known = treeItems.find((x) => x.path === p);
            const f = msFilesStore.find((x) => x.path === p);
            return {
              path: p,
              name: known?.name || f?.name || p.split('/').pop() || p,
              isFolder: known ? known.isFolder : f?.itemType === 'folder',
              size: null, modifiedAt: null, exists: true,
            };
          });
        }
        case 'get_opportunities':
          return opportunitiesStore.filter((o) => !o.archived);
        case 'save_opportunity': {
          const o = (_payload as any)?.opportunity as Opportunity;
          const name = (o.companyName || '').trim();
          let companyId: number | null = null;
          if (name) {
            const existingCo = companiesStore.find((c) => c.name === name);
            if (existingCo) companyId = existingCo.id;
            else { const created = makeMockCompany(++nextCompanyId, name); companiesStore.push(created); companyId = created.id; }
          }
          const status = o.stage === 'Won' ? 'Won' : o.stage === 'Lost' ? 'Lost' : o.stage === 'On Hold' ? 'On Hold' : 'Open';
          const prev = o.id && o.id > 0 ? opportunitiesStore.find((x) => x.id === o.id) : undefined;
          const saved: Opportunity = { ...o, id: prev ? prev.id : ++nextOpportunityId, companyId, status, updatedAt: new Date().toISOString(), createdAt: prev?.createdAt || new Date().toISOString() };
          if (prev) { const idx = opportunitiesStore.findIndex((x) => x.id === prev.id); opportunitiesStore[idx] = saved; }
          else opportunitiesStore.push(saved);
          if (!prev) opportunityActivityStore.push({ id: ++nextOpportunityActivityId, opportunityId: saved.id, kind: 'created', detail: null, createdAt: new Date().toISOString().slice(0,10) });
          else if (prev.stage !== saved.stage) opportunityActivityStore.push({ id: ++nextOpportunityActivityId, opportunityId: saved.id, kind: 'stage_changed', detail: `${prev.stage} → ${saved.stage}`, createdAt: new Date().toISOString().slice(0,10) });
          if (prev && !prev.proposalId && saved.proposalId) opportunityActivityStore.push({ id: ++nextOpportunityActivityId, opportunityId: saved.id, kind: 'proposal_linked', detail: null, createdAt: new Date().toISOString().slice(0,10) });
          if (prev && !prev.projectId && saved.projectId) opportunityActivityStore.push({ id: ++nextOpportunityActivityId, opportunityId: saved.id, kind: 'project_created', detail: null, createdAt: new Date().toISOString().slice(0,10) });
          return saved;
        }
        case 'delete_opportunity': {
          const id = (_payload as any)?.id;
          opportunitiesStore = opportunitiesStore.filter((o) => o.id !== id);
          return null;
        }
        case 'get_opportunity_activity': {
          const oppId = (_payload as any)?.opportunityId;
          return opportunityActivityStore.filter((a) => a.opportunityId === oppId).slice().reverse();
        }
        case 'get_inbox_items':
          return [] as InboxItem[];
        case 'add_inbox_item': {
          const p = _payload as any;
          return { id: Math.floor(Math.random() * 100000) + 1, itemType: p?.itemType, content: p?.content, createdAt: new Date().toISOString(), processed: false, convertedToType: null, convertedToId: null } as InboxItem;
        }
        case 'get_note_templates':
          return templatesStore;
        case 'save_note_template': {
          const p = _payload as any;
          const created: NoteTemplate = { id: ++nextTemplateId, name: p?.name, content: p?.content, sortOrder: templatesStore.length };
          templatesStore.push(created);
          return created;
        }
        case 'update_note_template': {
          const p = _payload as any;
          const idx = templatesStore.findIndex((t) => t.id === p?.id);
          if (idx > -1) templatesStore[idx] = { ...templatesStore[idx], name: p?.name, content: p?.content };
          return null;
        }
        case 'delete_note_template': {
          const p = _payload as any;
          templatesStore = templatesStore.filter((t) => t.id !== p?.id);
          return null;
        }
        case 'get_all_tags':
          return ['sample'] as string[];
        case 'get_note_backlinks': {
          const noteId = (_payload as any)?.noteId;
          // Sample note #1 wikilinks to note #2 — reflect that one static edge.
          if (noteId === 2) return [{ id: 1, title: SAMPLE.notes[0].title || '' }] as NoteRef[];
          return [] as NoteRef[];
        }
        case 'get_links_for': {
          const p = _payload as any;
          return entityLinksStore.filter((l) => (l.fromType === p?.entityType && l.fromId === p?.entityId) || (l.toType === p?.entityType && l.toId === p?.entityId));
        }
        case 'set_links_from': {
          const p = _payload as any;
          entityLinksStore = entityLinksStore.filter((l) => !(l.fromType === p?.fromType && l.fromId === p?.fromId));
          entityLinksStore.push(...((p?.links || []) as EntityLink[]));
          return null;
        }
        case 'search_workspace': {
          const q = ((_payload as any)?.query ?? '').toLowerCase();
          if (!q) return [];
          const pool = [
            { entityType: 'note', entityId: 1, title: 'Welcome to MENA BIG Workspace', snippet: 'sample data shown only in the browser dev-preview' },
            { entityType: 'project', entityId: 1, title: 'Acme Holdings — Retainer Delivery', snippet: 'Client project' },
            { entityType: 'company', entityId: 0, title: 'Acme Holdings', snippet: 'Company' },
          ];
          return pool.filter((r) => r.title.toLowerCase().includes(q));
        }
        case 'ms365_get_client_id':
        case 'ms365_get_tenant_id':
          return null;
        case 'ms365_set_tenant_id':
          return null;
        case 'pending_agreements_from_proposals':
          return [];
        case 'identity_current_user':
          return null;
        case 'weather_now': {
          const sample: Record<string, [number, string]> = { bcn: [24, 'partlycloudy_day'], bey: [29, 'clearsky_day'], ruh: [39, 'clearsky_day'], dxb: [37, 'fair_day'] };
          return ((_payload as any)?.places || []).filter((p: any) => sample[p.id]).map((p: any) => ({ id: p.id, temperature: sample[p.id][0], symbol: sample[p.id][1] }));
        }
        case 'ms365_status':
          return { status: 'disconnected', accountEmail: null, displayName: null, connectedAt: null, lastSyncAt: null, errorMessage: null, hasClientId: false };
        case 'ms365_connect':
          throw new Error('Microsoft 365 sign-in only works in the built desktop app (needs a real OAuth browser round-trip), not this in-browser preview.');
        case 'ms365_get_cached_emails':
          return emailsStore.filter((e) => e.flagStatus === 'flagged');
        case 'ms365_get_emails_by_ids': {
          const ids: number[] = (_payload as any)?.ids ?? [];
          return emailsStore.filter((e) => ids.includes(e.id));
        }
        case 'ms365_get_emails_by_company': {
          const companyId = (_payload as any)?.companyId;
          return emailsStore.filter((e) => e.companyId === companyId);
        }
        case 'ms365_sync_flagged_emails':
          return emailsStore;
        case 'ms365_get_completed_emails':
          return completedLogStore;
        case 'ms365_update_email_flag': {
          const p = _payload as any;
          const idx = emailsStore.findIndex((e) => e.id === p?.id);
          if (idx > -1) {
            const [removed] = emailsStore.splice(idx, 1);
            if (p?.complete) {
              completedLogStore.unshift({ id: removed.id, messageId: removed.messageId, subject: removed.subject, senderName: removed.senderName, senderEmail: removed.senderEmail, completedAt: new Date().toISOString() });
            }
          }
          return null;
        }
        case 'intelligence_feed_status':
          return [
            { name: 'Ministry of Human Resources (MHRSD)', kind: 'regulatory', lastRunAt: new Date().toISOString(), added: 2, considered: 40, error: null },
            { name: 'ZATCA', kind: 'regulatory', lastRunAt: new Date().toISOString(), added: 1, considered: 38, error: null },
            { name: 'Argaam', kind: 'business', lastRunAt: new Date().toISOString(), added: 0, considered: 30, error: null },
            { name: 'GOSI & payroll', kind: 'regulatory', lastRunAt: new Date().toISOString(), added: 0, considered: 0, error: 'Could not reach this source: timed out' },
          ];
        case 'company_note_entries': {
          const p = _payload as any;
          return companyNoteEntriesStore.filter((n) => (p?.companyId != null && n.companyId === p.companyId) || (p?.companyName && n.companyName === p.companyName));
        }
        case 'add_company_note_entry': {
          const p = _payload as any;
          const entry = { id: Date.now(), companyId: p?.companyId ?? null, companyName: p?.companyName ?? null, body: String(p?.body || ''), isLegacy: false, createdAt: new Date().toISOString(), updatedAt: null };
          companyNoteEntriesStore.unshift(entry);
          return entry;
        }
        case 'update_company_note_entry': {
          const p = _payload as any;
          const n = companyNoteEntriesStore.find((x) => x.id === p?.id);
          if (n) { n.body = String(p?.body || ''); n.updatedAt = new Date().toISOString(); }
          return n ?? null;
        }
        case 'delete_company_note_entry': {
          const p = _payload as any;
          const i = companyNoteEntriesStore.findIndex((x) => x.id === p?.id);
          if (i > -1) companyNoteEntriesStore.splice(i, 1);
          return null;
        }
        case 'move_company_note_entries': {
          const p = _payload as any;
          companyNoteEntriesStore.forEach((n) => { if (n.companyName === p?.oldName) { n.companyName = p?.newName ?? n.companyName; if (p?.newId != null) n.companyId = p.newId; } });
          return null;
        }
        case 'ms365_reflag_email': {
          // Undo: put the email back in the flagged list, as the real command
          // does by re-flagging it in Outlook and re-syncing.
          const p = _payload as any;
          const i = completedLogStore.findIndex((e) => e.messageId === p?.messageId);
          if (i > -1) {
            const [back] = completedLogStore.splice(i, 1);
            if (!emailsStore.some((e) => e.messageId === back.messageId)) {
              emailsStore.unshift({ id: back.id, messageId: back.messageId, subject: back.subject, senderName: back.senderName, senderEmail: back.senderEmail,
                preview: null, receivedAt: new Date().toISOString(), isRead: true, webLink: null, flagDueAt: null, companyId: null, companyName: null } as any);
            }
          }
          return emailsStore;
        }
        case 'ms365_set_email_company': {
          const p = _payload as any;
          const e = emailsStore.find((x) => x.id === p?.id);
          if (e) e.companyName = p?.companyName ?? null;
          return null;
        }
        case 'ms365_open_email':
          return null;
        case 'ms365_sync_calendar':
          return null;
        case 'ms365_create_teams_meeting':
        case 'ms365_update_outlook_meeting': {
          const p = _payload as any;
          const isUpdate = cmd === 'ms365_update_outlook_meeting';
          const outlookEventId = isUpdate ? p.outlookEventId : `mock-evt-${++nextMeetingId}`;
          const existingIdx = meetingsStore.findIndex((m) => (m as any).outlookEventId === outlookEventId);
          const draft = {
            id: existingIdx > -1 ? meetingsStore[existingIdx].id : ++nextMeetingId,
            title: p.subject, meetingDate: (p.startIso || '').slice(0, 10), companyName: null, projectId: null,
            attendees: p.attendeeEmails ?? [], agenda: null, discussion: p.description || null, decisions: null,
            actionItems: null, followUp: null, nextMeeting: null, noteId: null,
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            outlookEventId, startAt: p.startIso, endAt: p.endIso, organizer: 'You', location: p.location || null,
            isOnlineMeeting: !!p.isTeamsMeeting, onlineMeetingUrl: p.isTeamsMeeting ? 'https://teams.microsoft.com/l/meetup-join/mock' : null,
            isCancelled: false, source: 'outlook',
          } as unknown as Meeting;
          if (existingIdx > -1) meetingsStore[existingIdx] = draft; else meetingsStore.push(draft);
          return draft;
        }
        case 'get_intelligence_items': {
          const p = _payload as any;
          return intelItemsStore.filter((it) => (!p?.kind || it.kind === p.kind) && (p?.includeArchived || !it.archived));
        }
        case 'save_intelligence_item': {
          const item = (_payload as any)?.item;
          if (item.id && item.id !== 0) {
            const idx = intelItemsStore.findIndex((x) => x.id === item.id);
            if (idx > -1) { intelItemsStore[idx] = { ...item }; return intelItemsStore[idx]; }
          }
          const created = { ...item, id: ++nextIntelId, createdAt: new Date().toISOString() };
          intelItemsStore.push(created);
          return created;
        }
        case 'delete_intelligence_item': {
          const id = (_payload as any)?.id;
          intelItemsStore = intelItemsStore.filter((x) => x.id !== id);
          return null;
        }
        case 'sync_intelligence_feeds': {
          // Simulates one feed-sync result the first time it's called this
          // session (so the "Auto" badge/sync-status are visible in dev
          // preview), then a no-op on subsequent syncs — same dedup-by-story
          // behavior the real backend has.
          if (intelItemsStore.some((it) => it.ingestedVia === 'feed')) return 0;
          intelItemsStore.push({
            id: ++nextIntelId, kind: 'business', headline: '(Dev preview) Saudi PIF announces new investment fund',
            summary: null, whatChanged: null, effectiveDate: null, whoAffected: null, whyItMatters: null,
            country: null, category: null, status: null, importance: 'monitor', sourceName: 'Argaam', sourceTier: 5,
            sourceUrl: 'https://www.argaam.com', publishedAt: new Date().toISOString().slice(0, 10),
            saved: false, archived: false, createdAt: new Date().toISOString().slice(0, 10),
            companyName: null, ingestedVia: 'feed',
          });
          return 1;
        }
        case 'get_app_meta': {
          const p = _payload as any;
          return appMetaStore.get(p?.key) ?? null;
        }
        case 'set_app_meta': {
          const p = _payload as any;
          appMetaStore.set(p?.key, p?.value);
          return null;
        }
        case 'save_attachment': {
          const p = _payload as any;
          const id = ++nextAttachmentId;
          attachmentDataStore.set(id, p?.base64Data);
          return { id, noteId: p?.noteId, filename: p?.filename, mimeType: null, createdAt: new Date().toISOString() };
        }
        case 'get_attachment_data_url': {
          const p = _payload as any;
          return attachmentDataStore.get(p?.id) || '';
        }
        default:
          if (cmd.startsWith('save_') || cmd.startsWith('upsert_') || cmd.startsWith('set_') || cmd.startsWith('delete_') || cmd.startsWith('resolve_') || cmd.startsWith('rebuild_') || cmd.startsWith('add_')) {
            // fire-and-forget writes: no-op in the browser preview (record upserts report no company changes)
            return cmd.startsWith('upsert_') ? [] : null;
          }
          console.warn(`[devMock] unmocked Tauri command: ${cmd}`);
          return null;
      }
    });
    console.info('[devMock] Running with sample data — no Tauri backend detected (plain browser preview).');
  });
}
