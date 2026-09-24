// A small, fictional MENA One (no client data): four companies, six
// meetings, six open tasks, eight promises. Used by the phone snapshot tests
// and to write docs/phone/snapshot.example.json.

import type { PhoneSnapshotInput } from '../phoneSnapshot';
import type { Agreement, Commitment, Company, Contact, Meeting, Opportunity, Project, Proposal, Todo } from '../types';

export const FIXTURE_TODAY = '2026-09-24';

const company = (id: number, name: string, over: Partial<Company> = {}): Company => ({
  id, name, legalName: null, industries: [], website: null, country: 'Saudi Arabia', city: 'Riyadh', companyType: null, status: 'Active',
  owner: null, description: null, archived: false, createdAt: '2026-01-10', updatedAt: null, ...over,
});
const contact = (id: number, companyId: number, clientName: string, name: string, over: Partial<Contact> = {}): Contact => ({
  id, clientName, companyId, name, role: null, email: `${name.split(' ')[0].toLowerCase()}@${clientName.split(' ')[0].toLowerCase()}.test`,
  phone: null, whatsapp: null, service: null, lists: [], ...over,
});
const meeting = (id: number, title: string, date: string, hour: number | null, over: Partial<Meeting> = {}): Meeting => ({
  id, title, meetingDate: date, companyName: null, companyId: null, projectId: null, opportunityId: null, attendees: [], agenda: null, discussion: null,
  decisions: null, actionItems: null, followUp: null, nextMeeting: null, noteId: null, createdAt: date, updatedAt: null, outlookEventId: null,
  startAt: hour == null ? null : new Date(`${date}T${String(hour).padStart(2, '0')}:00:00`).toISOString(),
  endAt: hour == null ? null : new Date(`${date}T${String(hour + 1).padStart(2, '0')}:00:00`).toISOString(),
  organizer: null, location: null, isOnlineMeeting: false, onlineMeetingUrl: null, isCancelled: false, source: 'internal', attendeeEmails: [], ...over,
});
const todo = (id: number, title: string, over: Partial<Todo> = {}): Todo => ({
  id, title, type: 'general', client: null, priority: 'Medium', dueDate: null, status: 'Pending', description: null, createdAt: '2026-09-01',
  completedAt: null, projectId: null, parentId: null, areaId: null, section: null, sortOrder: id, recurrenceRule: null, tags: [], meetingId: null, ...over,
});
const promise = (id: number, text: string, over: Partial<Commitment> = {}): Commitment => ({
  id, direction: 'ours', text, contactId: null, dueDate: null, status: 'open', closedAt: null, dropReason: null, companyId: null,
  opportunityId: null, projectId: null, sourceType: 'meeting', sourceId: null, sourceKey: null, todoId: null, createdAt: '2026-09-10', updatedAt: null, ...over,
});

export function phoneFixture(over: Partial<PhoneSnapshotInput> = {}): PhoneSnapshotInput {
  const contoso = company(11, 'Contoso Logistics', { industries: ['Transportation & Logistics'], status: 'Client' });
  const northwind = company(12, 'Northwind Trading', { industries: ['Retail & Consumer'], city: 'Jeddah' });
  const fabrikam = company(13, 'Fabrikam Engineering', { industries: ['Engineering & Consulting'], country: 'United Arab Emirates', city: 'Dubai' });
  const tailspin = company(14, 'Tailspin Hotels', { industries: ['Hospitality'], city: 'Al Khobar' });
  const archived = company(15, 'Old Name Holdings', { archived: true });

  const contacts = [
    contact(21, 11, contoso.name, 'Sara Haddad', { role: 'HR Director', phone: '+966500000001', whatsapp: '+966500000001', isDecisionMaker: true }),
    contact(22, 11, contoso.name, 'Omar Nasser', { role: 'Finance Manager' }),
    contact(23, 12, northwind.name, 'Lina Farouk', { role: 'COO', isDecisionMaker: true }),
    contact(24, 13, fabrikam.name, 'Karim Aziz', { role: 'Country Manager' }),
  ];

  const agreements: Agreement[] = [{
    id: 31, agrRef: 'CON_ADM_001', client: contoso.name, companyId: 11, type: 'Administration', status: 'Signed', preparedBy: null, datePrepared: '2026-03-02',
    dateSentToClient: '2026-03-03', dateClientSigned: '2026-03-08', dateMenaSigned: '2026-03-09', dateFiled: null, monthlyFee: 18500, contractMonths: 12,
    proposalId: null, hubspot: null, docLink: null, actionDate: null, remarks: null, createdAt: '2026-03-02', currency: 'SAR',
    startDate: '2026-03-15', endDate: '2027-03-14', serviceStatus: 'Active', noticeDays: 60,
  }];
  const proposals = [
    { id: 41, client: contoso.name, companyId: 11, type: 'Payroll', status: 'In Internal Review', reviewStatus: 'approved', sentDate: null, dblSignedDate: null,
      kickoffDate: null, finance: null, hubspot: null, owner: null, remarks: null, dateAdded: '2026-09-15', monthlyFee: 6000, contractMonths: 12,
      winLossReason: null, docLink: null, archived: false, archivedAt: null, snoozedUntil: null, dateSentToHassan: '2026-09-18', dateSentToClient: null,
      dateSigned: null, notes: [] },
    { id: 42, client: northwind.name, companyId: 12, type: 'Recruitment', status: 'Sent to Client', sentDate: '2026-09-17', dblSignedDate: null,
      kickoffDate: null, finance: null, hubspot: null, owner: null, remarks: null, dateAdded: '2026-09-10', monthlyFee: null, contractMonths: null,
      winLossReason: null, docLink: null, archived: false, archivedAt: null, snoozedUntil: null, dateSentToHassan: '2026-09-12', dateSentToClient: '2026-09-17',
      dateSigned: null, notes: [] },
  ] as unknown as Proposal[];
  const opportunities: Opportunity[] = [{
    id: 51, name: 'Fabrikam UAE setup', companyId: 13, companyName: fabrikam.name, owner: null, stage: 'Discovery', status: 'Open', estimatedValue: 45000,
    currency: 'SAR', probability: null, expectedCloseDate: '2026-11-30', description: null, nextAction: 'Send the setup timeline', proposalId: null, projectId: null,
    sortOrder: null, archived: false, createdAt: '2026-09-05', updatedAt: '2026-09-22', tags: [],
  } as Opportunity];
  const projects: Project[] = [];

  const meetings = [
    meeting(61, 'Monthly check-in', '2026-09-18', 11, { companyId: 11, companyName: contoso.name, attendees: ['Sara Haddad', 'Omar Nasser'],
      attendeeEmails: ['sara@contoso.test', 'omar@contoso.test'], location: 'Contoso office, King Fahd Road, Riyadh', decisions: 'Move payroll to MENA BIG from November.',
      actionItems: '>> Send the payroll proposal by 26 Sep\n<< Share the October headcount', source: 'outlook' }),
    meeting(62, 'Payroll kick-off', '2026-09-25', 10, { companyId: 11, companyName: contoso.name, attendees: ['Sara Haddad'], attendeeEmails: ['sara@contoso.test'],
      location: 'Microsoft Teams Meeting; https://teams.microsoft.com/l/meetup-join/x', isOnlineMeeting: true, onlineMeetingUrl: 'https://teams.microsoft.com/l/meetup-join/x',
      agenda: 'Timeline, data handover, first cut-off date', source: 'outlook' }),
    meeting(63, 'Recruitment brief', '2026-09-25', 14, { companyId: 12, companyName: northwind.name, attendees: ['Lina Farouk'], attendeeEmails: ['lina@northwind.test'],
      location: 'Northwind HQ, Tahlia Street, Jeddah', source: 'outlook' }),
    meeting(64, 'Intro call', '2026-09-08', 15, { companyId: 13, companyName: fabrikam.name, attendees: ['Karim Aziz'], attendeeEmails: ['karim@fabrikam.test'],
      isOnlineMeeting: true, onlineMeetingUrl: 'https://teams.microsoft.com/l/meetup-join/y', followUp: 'Send the UAE setup options.' }),
    meeting(65, 'Site visit', '2026-10-06', null, { companyId: 14, companyName: tailspin.name, location: 'Tailspin Corniche Hotel, Al Khobar' }),
    meeting(66, 'Team weekly', '2026-09-22', 9, { attendees: ['Hassan Balaghi'], attendeeEmails: ['hassan@menabig.test'] }),
    meeting(67, 'Cancelled review', '2026-09-26', 11, { companyId: 11, companyName: contoso.name, isCancelled: true }),
    meeting(68, 'Old workshop', '2026-07-01', 10, { companyId: 11, companyName: contoso.name }),
  ];

  const todos = [
    todo(71, 'Send the payroll proposal', { client: contoso.name, companyId: 11, type: 'client', dueDate: '2026-09-26', priority: 'High' }),
    todo(72, 'Send the UAE setup options', { client: fabrikam.name, companyId: 13, type: 'client', dueDate: '2026-09-20' }),
    todo(73, 'Book the Al Khobar trip', { dueDate: '2026-10-02' }),
    todo(74, 'Update the rate card', { priority: 'Low' }),
    todo(75, 'Chase the Northwind shortlist', { client: northwind.name, companyId: 12, type: 'client', dueDate: '2026-09-29' }),
    todo(76, 'Prepare the Q4 pipeline review', { dueDate: '2026-09-30' }),
    todo(77, 'Old finished task', { status: 'Done', completedAt: '2026-09-02' }),
  ];

  const commitments = [
    promise(81, 'Send the payroll proposal', { companyId: 11, contactId: 21, dueDate: '2026-09-26', sourceId: 61, todoId: 71 }),
    promise(82, 'Share the October headcount', { direction: 'theirs', companyId: 11, contactId: 22, dueDate: '2026-09-30', sourceId: 61 }),
    promise(83, 'Send the UAE setup options', { companyId: 13, contactId: 24, dueDate: '2026-09-20', sourceId: 64, todoId: 72 }),
    promise(84, 'Confirm the hiring budget', { direction: 'theirs', companyId: 12, contactId: 23, dueDate: '2026-09-19', sourceType: 'capture' }),
    promise(85, 'Send the shortlist template', { companyId: 12, sourceType: 'manual', status: 'kept', closedAt: '2026-09-21T10:00:00Z' }),
    promise(86, 'Signed engagement letter', { direction: 'theirs', companyId: 11, status: 'kept', closedAt: '2026-09-09T08:00:00Z' }),
    promise(87, 'Visit the new site', { companyId: 14, sourceType: 'manual', status: 'dropped', dropReason: 'Moved to October', closedAt: '2026-09-15T12:00:00Z' }),
    promise(88, 'Old workshop slides', { companyId: 11, status: 'kept', closedAt: '2026-07-05T12:00:00Z' }),
  ];

  return {
    today: FIXTURE_TODAY, now: new Date(`${FIXTURE_TODAY}T09:12:03`), generatedAt: `${FIXTURE_TODAY}T09:12:03+03:00`, mac: "Ahmad's MacBook Pro",
    proposals, opportunities, pipelineFacts: [], agreements, meetings, todos, projects,
    commitments, companies: [contoso, northwind, fabrikam, tailspin, archived], contacts, emails: [],
    inboxCount: 0, reviewerName: () => 'Hassan', ownDomains: new Set(['menabig.test']), snoozed: {},
    pinnedNotes: [
      { id: 91, companyId: 11, companyName: contoso.name, body: 'Prefers WhatsApp; no calls before 10.', createdAt: '2026-08-02T09:00:00Z' },
    ],
    importedCaptureIds: ['5b0c7a2e-3f41-4d7e-9a61-0c2d8e4f1a90'],
    failedCaptures: [],
    ...over,
  };
}
