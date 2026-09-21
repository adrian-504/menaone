import type { PipelineFact, Service, RateCard, BusinessEntity, TeamMember, Proposal, Contact, Agreement, Todo, Note, Area, Project, Milestone, Meeting, InboxItem, NoteTemplate, MicrosoftAccountStatus, EmailRecord, EmailCompletedRecord, IntelligenceItem, Company, Opportunity, ThemeId, ReviewQueueEntry, SavedList, Commitment } from './types';

/** Today as YYYY-MM-DD in local time (state.ts can't import utils). */
const localToday = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

// Single mutable state container. The original app used bare `let` globals
// scattered through one <script> block; ES modules can't be reassigned from
// outside, so everything that used to be `let x = ...` at top level now lives
// as a property on this one object (`S.x`), mutated in place by whichever
// module needs to. Keeps the port close to 1:1 with the original control flow.
export const S = {
  // Core entities (loaded from SQLite at startup)
  proposals: [] as Proposal[],
  contacts: [] as Contact[],
  agreements: [] as Agreement[],
  todos: [] as Todo[],
  commitments: [] as Commitment[],
  notes: [] as Note[],
  noteFolders: ['Meeting Notes', 'Client Notes', 'Internal'] as string[],
  contactLists: [] as string[],
  companyNotes: {} as Record<string, string>,

  // Commercial setup: service catalog, rate cards, entities, team
  services: [] as Service[],
  rateCards: [] as RateCard[],
  businessEntities: [] as BusinessEntity[],
  team: [] as TeamMember[],
  /** The team member using this device, from the Microsoft sign-in (null until known). */
  currentUserId: null as number | null,
  /** SAR per one unit of each other currency (Settings). */
  fxRates: {} as Record<string, number>,
  proposalsRoot: null as string | null,
  /** Proposal open as a page in Proposals. */
  currentProposalId: null as number | null,
  /** New-proposal page is open. */
  proposalBuilderOpen: false,
  /** Agreement open as a page in Agreements. */
  currentAgreementId: null as number | null,

  // Client matching by email (clientMatch.ts), kept in app_meta
  /** Email domain → company id, confirmed by the user. */
  companyDomains: {} as Record<string, number>,
  /** Meetings whose suggested client link was dismissed. */
  dismissedMeetingLinks: [] as number[],
  /** Extra MENA BIG mail domains, beyond the Outlook account and team emails. */
  ownDomains: [] as string[],

  // Analytics
  pipelineFacts: [] as PipelineFact[],
  analyticsView: 'pipeline' as 'pipeline' | 'winloss' | 'monthly',

  // Global period filter
  globalPeriod: 'all',

  // Navigation
  currentTab: 'dashboard',

  // Database tab
  dbSortCol: 'dateAdded',
  dbSortDir: 'desc' as 'asc' | 'desc',
  dbPage: 1,
  PS: 25,

  // Charts registry (Chart.js instances keyed by canvas id)
  charts: {} as Record<string, any>,

  // Modal target state
  wlTargetId: null as number | null,
  wlMode: null as 'won' | 'lost' | null,
  notesTargetId: null as number | null,
  ctEditId: null as number | null,
  statusTargetId: null as number | null,
  lineCount: 0,

  // Follow-up / Pending archived toggles
  fuShowArchived: false,
  wqShowArchived: false,

  // Add-proposal duplicate-check debounce
  dupTimer: null as number | null,

  // Notes tab
  currentNoteId: null as number | null,
  currentNoteFolder: 'all',
  noteAutoSaveTimer: null as number | null,
  noteChanged: false,
  noteFolderCollapsed: new Set<string>(),

  // Todo tab
  todoFilter: 'anytime',
  /** Task open in the detail panel beside the list. */
  taskDetailId: null as number | null,
  /** Contact whose page is open in Contacts. */
  currentContactId: null as number | null,
  todoEditId: null as number | null,
  todoParentId: null as number | null,
  taskView: 'list' as 'list' | 'board' | 'calendar',
  todoSort: 'smart' as 'smart' | 'manual',
  taskCalAnchor: localToday as string,
  todoDragId: null as number | null,
  todoSubtasksCollapsed: new Set<number>(),

  // Contacts tab
  assignListContactId: null as number | null,
  selectedContactIds: new Set<number>(),

  // Companies tab
  currentCompany: null as string | null,
  coListView: 'grid' as 'grid' | 'list',
  coChart1: null as any,
  coChart2: null as any,

  // ═══ V2: Work Hub state ═══
  areas: [] as Area[],
  projects: [] as Project[],
  meetings: [] as Meeting[],
  inboxItems: [] as InboxItem[],
  noteTemplates: [] as NoteTemplate[],
  allTags: [] as string[],

  // Sidebar collapse (Part 1)
  sidebarCollapsed: false,

  // Projects tab
  currentProjectId: null as number | null,
  projectFilter: 'all' as 'all' | 'client' | 'internal' | 'active' | 'at-risk' | 'on-hold' | 'completed' | 'due-soon',
  projectSort: 'updated' as 'priority' | 'target' | 'updated' | 'progress' | 'status',
  projectEditId: null as number | null,
  currentProjectMilestones: [] as Milestone[],

  // Meetings tab
  meetingEditId: null as number | null,

  // Opportunities / Pipeline (Core Refinement & Product Maturity, Stage 2)
  companies: [] as Company[],
  /** Company lists and smart lists (lists.ts). */
  savedLists: [] as SavedList[],
  /** Pending Company Master Data review-queue entries — loaded lazily (only
   * when the Companies tab's Review Queue section is opened), not at
   * startup, since it's typically empty and rarely needs to be fresh. */
  reviewQueue: [] as ReviewQueueEntry[],
  opportunities: [] as Opportunity[],
  opportunityView: 'board' as 'board' | 'list',
  currentOpportunityId: null as number | null,
  opportunityFilter: { stage: '', owner: '' },
  /** Set right before opening the Proposal/Project creation modal from an
   * Opportunity's "Create Proposal"/"Create Project" action; the tail of
   * submitProposal/submitProject checks this and links the newly created
   * record back to that Opportunity, then clears it. */
  opportunityLinkPending: null as number | null,
  opportunityLinkPendingKind: null as 'proposal' | 'project' | null,

  // Command palette / search overlay
  commandPaletteOpen: false,
  searchOpen: false,
  searchQuery: '',

  // Theme (named color palette — see src/core/theme.ts)
  theme: 'light' as ThemeId,

  // ═══ Microsoft 365 ═══
  ms365Status: null as MicrosoftAccountStatus | null,
  ms365Connecting: false,
  ms365Syncing: false,
  emails: [] as EmailRecord[],
  emailCompletedLog: [] as EmailCompletedRecord[],

  // Action Required tab
  arFilter: 'all' as 'all' | 'due-today' | 'overdue' | 'recent' | 'completed',
  arSort: 'received' as 'received' | 'due' | 'sender',
  arLinkPopoverId: null as number | null,

  // Calendar tab
  calendarView: 'week' as 'day' | 'week' | 'month',
  calendarAnchor: localToday as string,
  calendarSyncing: false,
  calendarSyncError: null as string | null,
  outlookMeetingEditId: null as number | null,

  // Intelligence (Regulatory Watch / Business Watch)
  intelItems: [] as IntelligenceItem[],
  intelKind: 'regulatory' as 'regulatory' | 'business',
  intelImportanceFilter: '' as '' | 'critical' | 'important' | 'monitor',
  intelShowArchived: false,
  intelSyncing: false,
  intelSyncError: null as string | null,
  intelEditId: null as number | null,
  intelLinkPopoverId: null as number | null,
};
