export interface ActivityNote {
  id: number;
  date: string | null;
  text: string | null;
}

/** The company a saved record ended up linked to (returned by per-record saves). */
export interface RecordCompanyLink {
  id: number;
  companyId: number | null;
}

export interface Proposal {
  id: number;
  client: string;
  /** Resolved server-side from `client` on every save — read-only. */
  companyId?: number | null;
  type: string | null;
  status: string;
  sentDate: string | null;
  dblSignedDate: string | null;
  kickoffDate: string | null;
  finance: string | null;
  hubspot: string | null;
  owner: string | null;
  remarks: string | null;
  dateAdded: string | null;
  monthlyFee: number | null;
  contractMonths: number | null;
  winLossReason: string | null;
  docLink: string | null;
  archived: boolean;
  archivedAt: string | null;
  snoozedUntil: string | null;
  dateSentToHassan: string | null;
  dateSentToClient: string | null;
  dateSigned: string | null;
  notes: ActivityNote[];
  // Commercial core. `type`, `monthlyFee` and `oneTimeFee` are derived from
  // `lines` whenever the proposal has lines (see syncProposalTotals).
  businessEntityId?: number | null;
  currency?: string | null;
  oneTimeFee?: number | null;
  primaryContactId?: number | null;
  ownerId?: number | null;
  reviewerId?: number | null;
  reviewStatus?: ReviewStatus | null;
  reviewRequestedAt?: string | null;
  reviewedAt?: string | null;
  reviewNote?: string | null;
  validUntil?: string | null;
  folderPath?: string | null;
  leadSource?: string | null;
  lines?: CommercialLine[];
  documents?: ProposalDocument[];
}

export type ReviewStatus = 'pending' | 'approved' | 'changes_requested';

/** One service on a proposal or agreement. */
export interface CommercialLine {
  id: number;
  serviceId: number | null;
  serviceName: string;
  description: string | null;
  billing: 'monthly' | 'one_time';
  quantity: number;
  unitPrice: number | null;
  commission: boolean;
  sortOrder: number;
  /** Priced rows shown in the proposal (tranches, categories, staff types, countries). */
  rates?: LineRate[];
  /** Employees the client has, when known (tranche services). */
  employeeCount?: number | null;
  /** Workforce proposals that include the recruitment process slides. */
  withRecruitment?: boolean;
}

export interface LineRate {
  label: string;
  from?: number | null;
  to?: number | null;
  price?: number | null;
  percent?: number | null;
  /** Counts toward the line's monthly value (e.g. the client's accountancy status). */
  counts?: boolean;
}

export interface ProposalDocument {
  id: number;
  kind: 'proposal' | 'commercials' | 'supporting';
  version: number | null;
  fileName: string;
  path: string | null;
  url: string | null;
  notes: string | null;
  createdAt: string | null;
}

export interface Service {
  id: number;
  name: string;
  category: string | null;
  description: string | null;
  agreementType: string | null;
  billing: 'monthly' | 'one_time';
  defaultPrice: number | null;
  rateCardId: number | null;
  templateKey: string | null;
  active: boolean;
  sortOrder: number | null;
  /** Set when this service was merged into another; the row stays so old proposals still resolve. */
  mergedInto: number | null;
}

export interface RateCard {
  id: number;
  name: string;
  category: string | null;
  pricing: import('./constants').PricingService | null;
  addons: { action: string; fee: string }[];
  sortOrder: number | null;
}

export interface BusinessEntity {
  id: number;
  code: string;
  name: string;
  currency: string;
  vatRate: number | null;
  country: string | null;
  active: boolean;
  sortOrder: number | null;
}

export interface TeamMember {
  id: number;
  name: string;
  email: string | null;
  jobTitle: string | null;
  department: string | null;
  isReviewer: boolean;
  active: boolean;
  notes: string | null;
}

export interface CommercialSetup {
  services: Service[];
  rateCards: RateCard[];
  businessEntities: BusinessEntity[];
  teamMembers: TeamMember[];
  /** SAR per one unit of each other currency. */
  fxRates: Record<string, number>;
  proposalsRoot: string | null;
}

export interface ProposalFolder {
  root: string | null;
  path: string | null;
  exists: boolean;
  files: LocalFileItem[];
}

export interface Contact {
  id: number;
  clientName: string | null;
  /** Resolved server-side from `clientName` on every save — read-only. */
  companyId?: number | null;
  name: string | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  service: string | null;
  lists: string[];
}

export interface Agreement {
  id: number;
  agrRef: string | null;
  client: string | null;
  /** Resolved server-side from `client` on every save — read-only. */
  companyId?: number | null;
  type: string | null;
  status: string | null;
  preparedBy: string | null;
  datePrepared: string | null;
  dateSentToClient: string | null;
  dateClientSigned: string | null;
  dateMenaSigned: string | null;
  dateFiled: string | null;
  monthlyFee: number | null;
  contractMonths: number | null;
  proposalId: number | null;
  hubspot: string | null;
  docLink: string | null;
  actionDate: string | null;
  remarks: string | null;
  createdAt: string | null;
  businessEntityId?: number | null;
  currency?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  serviceStatus?: ServiceStatus | null;
  autoRenew?: boolean;
  noticeDays?: number | null;
  preparedById?: number | null;
  lines?: CommercialLine[];
}

export type ServiceStatus = 'Not started' | 'Kickoff scheduled' | 'Active' | 'Ended';

export interface Todo {
  id: number;
  title: string;
  type: 'general' | 'client' | string | null;
  client: string | null;
  priority: 'High' | 'Medium' | 'Low' | string | null;
  dueDate: string | null;
  status: 'Pending' | 'In Progress' | 'Done' | string | null;
  description: string | null;
  createdAt: string | null;
  completedAt: string | null;
  // V2: hierarchy + project linkage (Parts 16-18)
  projectId: number | null;
  parentId: number | null;
  areaId: number | null;
  section: string | null;
  sortOrder: number | null;
  recurrenceRule: string | null;
  tags: string[];
  // Live Meeting Notes: which meeting (if any) this task was added from.
  meetingId: number | null;
  /** "HH:MM" on dueDate, when the task has a time. */
  dueTime?: string | null;
  /** Parked out of Today/Upcoming/Anytime. */
  someday?: boolean;
  /** Kept when the task is created with a company id and `client` is that
   * company's name; otherwise resolved server-side from `client`. */
  companyId?: number | null;
  /** The opportunity this task belongs to (Work Graph). */
  opportunityId?: number | null;
}

export interface Note {
  id: number;
  title: string | null;
  content: string | null;
  folder: string | null;
  clientName: string | null;
  /** Resolved server-side from `clientName` on every save — read-only. */
  companyId?: number | null;
  tags: string[];
  pinned: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface AppData {
  proposals: Proposal[];
  contacts: Contact[];
  agreements: Agreement[];
  todos: Todo[];
  notes: Note[];
  noteFolders: string[];
  contactLists: string[];
  companyNotes: Record<string, string>;
  services?: Service[];
  businessEntities?: BusinessEntity[];
  teamMembers?: TeamMember[];
}

// ═══════════════ V2: Work Hub entities ═══════════════

export type ProjectType = 'client' | 'internal';
export type ProjectStatus = 'Idea' | 'Planning' | 'Not Started' | 'In Progress' | 'At Risk' | 'On Hold' | 'Completed' | 'Cancelled';

export interface Area {
  id: number;
  name: string;
  sortOrder: number | null;
}

export interface Project {
  id: number;
  name: string;
  type: ProjectType;
  status: ProjectStatus | string;
  priority: 'High' | 'Medium' | 'Low' | string;
  owner: string | null;
  description: string | null;
  companyName: string | null;
  /** Resolved server-side from `companyName` on every save — read-only. */
  companyId?: number | null;
  areaId: number | null;
  startDate: string | null;
  targetDate: string | null;
  completionDate: string | null;
  progressOverride: number | null;
  tags: string[];
  archived: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  // Derived (read-only, computed server-side on fetch)
  taskCount: number;
  taskDoneCount: number;
  computedProgress: number;
}

export type MilestoneStatus = 'Not Started' | 'In Progress' | 'Done';

export interface Milestone {
  id: number;
  projectId: number;
  name: string;
  description: string | null;
  status: MilestoneStatus | string;
  targetDate: string | null;
  completionDate: string | null;
  sortOrder: number | null;
}

export interface Meeting {
  id: number;
  title: string;
  meetingDate: string | null;
  companyName: string | null;
  /** Resolved server-side from `companyName` on every save — read-only. */
  companyId?: number | null;
  projectId: number | null;
  opportunityId: number | null;
  attendees: string[];
  agenda: string | null;
  discussion: string | null;
  decisions: string | null;
  actionItems: string | null;
  followUp: string | null;
  nextMeeting: string | null;
  noteId: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  // Outlook/Teams sync — set only by ms365* commands, never by saveMeeting.
  outlookEventId: string | null;
  startAt: string | null;
  endAt: string | null;
  organizer: string | null;
  location: string | null;
  isOnlineMeeting: boolean;
  onlineMeetingUrl: string | null;
  isCancelled: boolean;
  source: 'internal' | 'outlook' | string;
  /** From Outlook sync. */
  organizerEmail?: string | null;
  attendeeEmails?: string[];
}

/** Polymorphic entity kind used by entity_links, tags, and search. */
export type EntityKind = 'proposal' | 'contact' | 'agreement' | 'task' | 'note' | 'project' | 'meeting' | 'company' | 'email' | 'intelligence' | 'opportunity' | 'msfile';

// ═══════════════ OPPORTUNITIES (Core Refinement & Product Maturity, Stage 2) ═══════════════

export const INDUSTRY_TAXONOMY = [
  'Construction & Infrastructure', 'Engineering & Consulting', 'Transportation & Logistics',
  'Industrial & Manufacturing', 'Technology', 'Energy & Utilities', 'Real Estate',
  'Financial Services', 'Healthcare', 'Education', 'Retail & Consumer', 'Hospitality',
  'Government/Public Sector', 'Professional Services', 'Other', 'Unknown',
] as const;
export type Industry = typeof INDUSTRY_TAXONOMY[number];

/** A saved company list (hand-picked or smart) or a smart contact list. */
export interface SavedList {
  id: number;
  name: string;
  entity: 'company' | 'contact';
  /** Saved filters for a smart list; null for a hand-picked list. */
  filters: Record<string, string> | null;
  /** Hand-picked members (company lists only). */
  companyIds: number[];
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface Company {
  id: number;
  name: string;
  legalName: string | null;
  industries: string[];
  website: string | null;
  country: string | null;
  city: string | null;
  companyType: string | null;
  status: string | null;
  owner: string | null;
  description: string | null;
  archived: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface CompanyMigrationReport {
  backupPath: string;
  distinctLegacyNamesSeen: number;
  companiesCreated: number;
  fuzzyMatchesLinked: number;
  queuedForReview: number;
  contactsLinked: number;
  proposalsLinked: number;
  agreementsLinked: number;
  projectsLinked: number;
  industriesMigrated: number;
  companiesTotal: number;
  companiesMissingIndustry: number;
  companiesWithoutContacts: number;
}

export interface ReviewQueueEntry {
  id: number;
  rawName: string;
  suggestedCompanyId: number | null;
  suggestedCompanyName: string | null;
  status: string;
  createdAt: string | null;
}

export const OPPORTUNITY_STAGES = [
  'Lead', 'Qualified', 'Discovery', 'Meeting', 'Solution Design', 'Proposal',
  'Negotiation', 'Verbal Commitment', 'Won', 'Lost', 'On Hold',
] as const;
export type OpportunityStage = typeof OPPORTUNITY_STAGES[number];
export type OpportunityStatus = 'Open' | 'Won' | 'Lost' | 'On Hold';

export interface Opportunity {
  id: number;
  name: string;
  companyId: number | null;
  /** Read: joined company name. Write: send a plain name here — the backend
   * resolves/creates the Company row and sets companyId itself. */
  companyName: string | null;
  owner: string | null;
  stage: OpportunityStage | string;
  /** Derived server-side from stage on every save — read-only from the UI. */
  status: OpportunityStatus | string;
  estimatedValue: number | null;
  currency: string | null;
  businessEntityId?: number | null;
  /** Why it was won or lost. */
  winLossReason?: string | null;
  probability: number | null;
  expectedCloseDate: string | null;
  description: string | null;
  nextAction: string | null;
  proposalId: number | null;
  projectId: number | null;
  sortOrder: number | null;
  archived: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  tags: string[];
}

export interface OpportunityActivity {
  id: number;
  opportunityId: number;
  kind: 'created' | 'stage_changed' | 'proposal_linked' | 'project_created' | string;
  detail: string | null;
  createdAt: string | null;
}

export interface ProjectActivity {
  id: number;
  projectId: number;
  kind: 'created' | 'status_changed' | string;
  detail: string | null;
  createdAt: string | null;
}

export interface EntityLink {
  fromType: EntityKind;
  fromId: number;
  toType: EntityKind;
  toId: number;
}

export interface NoteTemplate {
  id: number;
  name: string;
  content: string;
  sortOrder: number | null;
}

export interface Attachment {
  id: number;
  noteId: number;
  filename: string;
  mimeType: string | null;
  createdAt: string | null;
}

export type InboxItemType = 'task' | 'note' | 'idea' | 'followup';

export interface InboxItem {
  id: number;
  itemType: InboxItemType;
  content: string;
  createdAt: string | null;
  processed: boolean;
  convertedToType: string | null;
  convertedToId: number | null;
}

export interface SearchResult {
  entityType: EntityKind;
  entityId: number;
  title: string;
  snippet: string;
}

export interface NoteRef {
  id: number;
  title: string;
}

// ═══════════════ Microsoft 365 ═══════════════

export type Ms365ConnectionStatus = 'disconnected' | 'connected' | 'expired' | 'error';

export interface MicrosoftAccountStatus {
  status: Ms365ConnectionStatus;
  accountEmail: string | null;
  displayName: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  errorMessage: string | null;
  hasClientId: boolean;
}

export interface EmailRecord {
  id: number;
  messageId: string;
  conversationId: string | null;
  subject: string | null;
  senderName: string | null;
  senderEmail: string | null;
  preview: string | null;
  receivedAt: string | null;
  flagStatus: 'flagged' | 'complete' | string;
  flagDueAt: string | null;
  webLink: string | null;
  isRead: boolean;
  companyName: string | null;
  companyId?: number | null;
}

/** A OneDrive folder/file as it exists on disk under this Mac's Finder-synced
 * `~/Library/CloudStorage/OneDrive-*` folder — read live from the filesystem.
 * `path` is the absolute local path, which doubles as this item's stable
 * identity (and, once linked, the join key into `microsoft_files`). */
export interface LocalFileItem {
  path: string;
  name: string;
  isFolder: boolean;
  size: number | null;
  modifiedAt: string | null;
  /** False only for a linked/recent item whose path no longer resolves on
   * disk (moved/renamed/deleted) — always true for a live folder listing. */
  exists: boolean;
}

/** One row of the Files tab's "Linked" view — every msfile currently linked
 * to a Company or Project, joined server-side into one list. */
export interface LinkedFileEntry {
  path: string;
  name: string;
  isFolder: boolean;
  exists: boolean;
  linkedToType: 'company' | 'project';
  linkedToName: string;
}

// ═══════════════ Intelligence (Regulatory Watch / Business Watch) ═══════════════

export type IntelligenceKind = 'regulatory' | 'business';
export type IntelligenceImportance = 'critical' | 'important' | 'monitor';

export interface IntelligenceItem {
  id: number;
  kind: IntelligenceKind;
  headline: string;
  summary: string | null;
  whatChanged: string | null;
  effectiveDate: string | null;
  /** Services this story touches, worked out from its words when it was pulled in. */
  affectedServices?: string[];
  whoAffected: string | null;
  whyItMatters: string | null;
  country: string | null;
  category: string | null;
  status: string | null;
  importance: IntelligenceImportance;
  sourceName: string;
  sourceTier: number;
  sourceUrl: string;
  publishedAt: string | null;
  saved: boolean;
  archived: boolean;
  createdAt: string | null;
  companyName: string | null;
  /** "feed" for automatically-ingested items, null for manually-added ones. */
  ingestedVia: string | null;
  companyId?: number | null;
}

export interface EmailCompletedRecord {
  id: number;
  messageId: string;
  subject: string | null;
  senderName: string | null;
  senderEmail: string | null;
  completedAt: string;
}

export interface ActivityEntry {
  id: number;
  /** ISO timestamp, or a bare YYYY-MM-DD for history carried over from before the log existed. */
  createdAt: string;
  actor: string | null;
  action: string;
  entityType: 'proposal' | 'agreement' | 'contact' | 'task' | 'note' | 'meeting' | 'opportunity' | 'project' | 'company' | string;
  entityId: number;
  entityLabel: string | null;
  detail: string | null;
  companyId: number | null;
  contactId: number | null;
  opportunityId: number | null;
  projectId: number | null;
}

export interface ActivityFilter {
  companyId?: number;
  contactId?: number;
  entityType?: string;
  entityId?: number;
  limit?: number;
}

export interface LocalBackup {
  fileName: string;
  sizeBytes: number;
  /** Seconds since the Unix epoch. */
  modifiedAt: number;
  kind: 'daily' | 'pre-migration' | 'manual' | 'other';
}

export interface ImportSummary {
  proposals: number;
  contacts: number;
  agreements: number;
  todos: number;
  notes: number;
  noteFolders: number;
  contactLists: number;
  companyNotes: number;
  warnings: string[];
}

// ═══════════════ Theme (named color palettes) ═══════════════

export type ThemeId = 'light' | 'dark' | 'graphite' | 'sepia' | 'ocean' | 'forest';

// ═══════════════ Insights, templates, generator ═══════════════

export interface StageVisit { stage: string; enteredAt: string }

export interface PipelineFact {
  opportunityId: number;
  stageEnteredAt: string | null;
  lastActivityAt: string | null;
  stages: StageVisit[];
}

export interface SlideTags { always: boolean; never: boolean; services: string[]; entity: string | null }

export interface TemplateSlide {
  index: number;
  slideId: string;
  title: string;
  text: string;
  notes: string;
  tags: SlideTags;
  tokens: string[];
  hasLineTable: boolean;
  /** What the automatic fields would fill on this slide. */
  smartFields: string[];
}

export interface TemplateInspection { slideCount: number; slides: TemplateSlide[]; tokens: string[] }

export interface SlideRule { slideId: string; include: 'always' | 'services' | 'never'; services: string[]; entity: string | null }
export interface TemplateReplacement { find: string; token: string }
export interface TemplateConfig { smartFields: boolean; slides: SlideRule[]; replacements: TemplateReplacement[] }

export interface ProposalTemplate {
  id: number;
  name: string;
  path: string;
  businessEntityId: number | null;
  config: TemplateConfig;
  slideCount: number | null;
  fileModifiedAt: string | null;
  isDefault: boolean;
  exists: boolean;
}

export interface TemplateDetail { template: ProposalTemplate; inspection: TemplateInspection; rules: SlideRule[] }
export interface TokenInfo { token: string; label: string; example: string }

export interface SlideChoice { index: number; slideId: string; title: string; included: boolean; reason: string; source?: string }
export interface ProposalLibraryInfo { dir: string | null; templates: { name: string; path: string; slideCount: number; services: string[]; sentTo: string | null }[]; master?: string | null }
export interface SmartFillReport { filled: string[]; feesToCheck: string[]; warnings: string[]; checks?: string[] }
export interface DeckBuildReport { slidesBefore: number; slidesAfter: number; partsRemoved: number; tokensFilled: number; missingTokens: string[]; smart: SmartFillReport | null }
export interface GenerateResult {
  slides: SlideChoice[];
  values: Record<string, string>;
  report: DeckBuildReport | null;
  folder: string | null;
  folderExists: boolean;
  path: string | null;
  fileName: string;
  warnings: string[];
  /** Problems that stop the deck from being saved. */
  errors: string[];
  /** The version recorded on the proposal after a successful save. */
  document: ProposalDocument | null;
  baseTemplate?: string | null;
  servicesTitle?: string | null;
}
