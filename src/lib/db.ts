import { invoke } from '@tauri-apps/api/core';
import { toast } from './ui';
import { normalizeMeeting, normalizeEmail } from './outlookTime';
import type {
  AppData, Proposal, Contact, Agreement, Todo, Note, ImportSummary,
  Area, Project, Milestone, Meeting, EntityLink, NoteTemplate, InboxItem,
  SearchResult, EntityKind, NoteRef, MicrosoftAccountStatus, EmailRecord, EmailCompletedRecord, LocalFileItem, LinkedFileEntry,
  IntelligenceItem, IntelligenceKind, Attachment, Company, Opportunity, OpportunityActivity, ProjectActivity,
  CompanyMigrationReport, ReviewQueueEntry, RecordCompanyLink, LocalBackup, ActivityEntry, ActivityFilter,
  CommercialSetup, Service, RateCard, BusinessEntity, TeamMember, ProposalFolder,
  PipelineFact, ProposalTemplate, TemplateDetail, TemplateInspection, TokenInfo, GenerateResult, ProposalLibraryInfo, SavedList, Commitment } from './types';

// Thin wrappers around the Rust/SQLite command layer (src-tauri/src/commands.rs).
// Proposals, contacts, agreements, tasks and notes are written per record:
// persist.ts works out which records changed and calls upsert/delete here.

export async function loadAllData(): Promise<AppData> {
  return invoke<AppData>('get_all_data');
}

export async function upsertProposals(items: Proposal[]): Promise<RecordCompanyLink[]> { return (await invoke<RecordCompanyLink[] | null>('upsert_proposals', { items })) ?? []; }
export async function deleteProposals(ids: number[]): Promise<void> { await invoke('delete_proposals', { ids }); }
export async function upsertContacts(items: Contact[]): Promise<RecordCompanyLink[]> { return (await invoke<RecordCompanyLink[] | null>('upsert_contacts', { items })) ?? []; }
export async function deleteContacts(ids: number[]): Promise<void> { await invoke('delete_contacts', { ids }); }
export async function upsertAgreements(items: Agreement[]): Promise<RecordCompanyLink[]> { return (await invoke<RecordCompanyLink[] | null>('upsert_agreements', { items })) ?? []; }
export async function deleteAgreements(ids: number[]): Promise<void> { await invoke('delete_agreements', { ids }); }
export async function createAgreementsFromProposals(): Promise<Agreement[]> { return invoke<Agreement[]>('sync_agreements_from_proposals'); }
export interface PendingAgreement { proposalId: number; client: string; agreementType: string | null }
/** What drafting from proposals would create, without creating it. */
export async function pendingAgreementsFromProposals(): Promise<PendingAgreement[]> { return invoke<PendingAgreement[]>('pending_agreements_from_proposals'); }
export async function upsertTodos(items: Todo[]): Promise<RecordCompanyLink[]> { return (await invoke<RecordCompanyLink[] | null>('upsert_todos', { items })) ?? []; }
// Commitments (commitments.rs): saved by id; new ones from a source go through
// commitmentsAdd, which skips lines already read and creates the tasks.
export interface NewCommitment {
  direction: 'ours' | 'theirs'; text: string; contactId?: number | null; dueDate?: string | null; kept?: boolean;
  companyId?: number | null; opportunityId?: number | null; projectId?: number | null; meetingId?: number | null;
  sourceType: 'meeting' | 'note' | 'capture' | 'manual'; sourceId?: number | null; sourceKey?: string | null;
}
export async function commitmentsAdd(items: NewCommitment[]): Promise<{ commitments: Commitment[]; tasks: Todo[] }> {
  return (await invoke<{ commitments: Commitment[]; tasks: Todo[] } | null>('commitments_add', { items })) ?? { commitments: [], tasks: [] };
}
export async function upsertCommitments(items: Commitment[]): Promise<RecordCompanyLink[]> { return (await invoke<RecordCompanyLink[] | null>('upsert_commitments', { items })) ?? []; }
export async function deleteCommitments(ids: number[]): Promise<void> { await invoke('delete_commitments', { ids }); }
export async function deleteTodos(ids: number[]): Promise<void> { await invoke('delete_todos', { ids }); }
export async function upsertNotes(items: Note[]): Promise<RecordCompanyLink[]> { return (await invoke<RecordCompanyLink[] | null>('upsert_notes', { items })) ?? []; }
export async function deleteNotes(ids: number[]): Promise<void> { await invoke('delete_notes', { ids }); }
export async function saveNoteFolders(items: string[]): Promise<void> {
  await invoke('save_note_folders', { items });
}
export async function saveContactLists(items: string[]): Promise<void> {
  await invoke('save_contact_lists', { items });
}
export async function saveCompanyNote(companyName: string, text: string): Promise<void> {
  await invoke('save_company_note', { companyName, text });
}

export async function getPipelineFacts(): Promise<PipelineFact[]> { return invoke<PipelineFact[]>('get_pipeline_facts'); }
export async function templatesList(): Promise<ProposalTemplate[]> { return invoke<ProposalTemplate[]>('templates_list'); }
export async function templateInspect(path: string): Promise<TemplateInspection> { return invoke<TemplateInspection>('template_inspect', { path }); }
export async function templateDetail(id: number): Promise<TemplateDetail> { return invoke<TemplateDetail>('template_detail', { id }); }
export async function templateSave(template: ProposalTemplate): Promise<TemplateDetail> { return invoke<TemplateDetail>('template_save', { template }); }
export async function templateDelete(id: number): Promise<void> { await invoke('template_delete', { id }); }
export async function templateTokens(): Promise<TokenInfo[]> { return invoke<TokenInfo[]>('template_tokens'); }
export async function proposalLibrary(): Promise<ProposalLibraryInfo> { return invoke<ProposalLibraryInfo>('proposal_library'); }
export async function proposalGenerate(request: { proposalId: number; templateId: number; date: string; fileName: string; keep?: number[] | null; logoPath?: string | null; dryRun: boolean; fromLibrary?: boolean; fromMaster?: boolean }): Promise<GenerateResult> {
  return invoke<GenerateResult>('proposal_generate', { request });
}
export async function getCommercialSetup(): Promise<CommercialSetup> { return invoke<CommercialSetup>('get_commercial_setup'); }
export async function saveService(service: Service): Promise<Service> { return invoke<Service>('save_service', { service }); }
export async function saveRateCard(card: RateCard): Promise<RateCard> { return invoke<RateCard>('save_rate_card', { card }); }
export async function saveBusinessEntity(entity: BusinessEntity): Promise<BusinessEntity> { return invoke<BusinessEntity>('save_business_entity', { entity }); }
export async function saveTeamMember(member: TeamMember): Promise<TeamMember> { return invoke<TeamMember>('save_team_member', { member }); }
export async function deleteTeamMember(id: number): Promise<void> { await invoke('delete_team_member', { id }); }
export async function setFxRate(currency: string, rate: number | null): Promise<Record<string, number>> { return invoke<Record<string, number>>('set_fx_rate', { currency, rate }); }
/** The client's folder inside OneDrive's Proposals folder (found or suggested). */
export async function proposalFolderLookup(client: string, folderPath: string | null): Promise<ProposalFolder> { return invoke<ProposalFolder>('proposal_folder_lookup', { client, folderPath }); }
export async function proposalFolderCreate(client: string): Promise<ProposalFolder> { return invoke<ProposalFolder>('proposal_folder_create', { client }); }
export async function setProposalsRoot(path: string | null): Promise<CommercialSetup> { return invoke<CommercialSetup>('set_proposals_root', { path }); }
export async function getActivity(filter: ActivityFilter): Promise<ActivityEntry[]> { return invoke<ActivityEntry[]>('get_activity', { filter }); }
/** Renames a company in place (same id); fails if the name belongs to another company. */
export async function renameCompany(id: number, name: string): Promise<Company> { return invoke<Company>('rename_company', { id, name }); }
export async function ms365GetEmailsByAddress(address: string): Promise<EmailRecord[]> { return invoke<EmailRecord[]>('ms365_get_emails_by_address', { address }); }
export async function listLocalBackups(): Promise<LocalBackup[]> { return invoke<LocalBackup[]>('list_local_backups'); }
export async function backupDatabaseNow(): Promise<LocalBackup> { return invoke<LocalBackup>('backup_database_now'); }
export async function revealBackupsFolder(): Promise<void> { return invoke<void>('reveal_backups_folder'); }
export async function exportBackupJson(): Promise<string> {
  return invoke<string>('export_backup_json');
}
export async function importBackupJson(json: string): Promise<ImportSummary> {
  return invoke<ImportSummary>('import_backup_json', { json });
}
export async function importLegacyBackupJson(json: string): Promise<ImportSummary> {
  return invoke<ImportSummary>('import_legacy_backup_json', { json });
}
export async function wipeAllData(): Promise<void> {
  await invoke('wipe_all_data');
}

export async function getAppMeta(key: string): Promise<string | null> {
  return invoke<string | null>('get_app_meta', { key });
}
export async function setAppMeta(key: string, value: string): Promise<void> {
  await invoke('set_app_meta', { key, value });
}

/** Asks where to save (system dialog) and writes the file; null when cancelled. */
/** The full backup (full_backup.rs): a complete copy of the database. */
export interface FullBackupSummary {
  schemaVersion: number; companies: number; contacts: number; opportunities: number; proposals: number; agreements: number;
  projects: number; meetings: number; tasks: number; notes: number; commitments: number;
}
export async function exportFullBackup(defaultName: string): Promise<string | null> { return invoke<string | null>('export_full_backup', { defaultName }); }
/** The file's bytes go as the raw request body, not as JSON. */
export async function inspectFullBackup(bytes: Uint8Array): Promise<FullBackupSummary> { return invoke<FullBackupSummary>('inspect_full_backup', bytes); }
export async function restoreFullBackup(bytes: Uint8Array): Promise<FullBackupSummary> { return invoke<FullBackupSummary>('restore_full_backup', bytes); }

export async function saveTextFileDialog(defaultName: string, contents: string, extensions: string[]): Promise<string | null> {
  return invoke<string | null>('save_text_file_dialog', { defaultName, contents, extensions });
}

// ═══════════════ V2: Work Hub commands ═══════════════

export async function getAreas(): Promise<Area[]> { return invoke<Area[]>('get_areas'); }
export async function saveArea(name: string): Promise<Area> { return invoke<Area>('save_area', { name }); }
export async function deleteArea(id: number): Promise<void> { await invoke('delete_area', { id }); }

export async function getProjects(includeArchived = false): Promise<Project[]> {
  return invoke<Project[]>('get_projects', { includeArchived });
}
export async function getProject(id: number): Promise<Project | null> {
  return invoke<Project | null>('get_project', { id });
}
export async function saveProject(project: Project): Promise<Project> {
  return invoke<Project>('save_project', { project });
}
export async function deleteProject(id: number): Promise<void> { await invoke('delete_project', { id }); }
export async function getProjectActivity(projectId: number): Promise<ProjectActivity[]> { return invoke<ProjectActivity[]>('get_project_activity', { projectId }); }

export async function getMilestones(projectId: number): Promise<Milestone[]> {
  return invoke<Milestone[]>('get_milestones', { projectId });
}
export async function saveMilestones(projectId: number, items: Milestone[]): Promise<void> {
  await invoke('save_milestones', { projectId, items });
}

export async function getCompanies(): Promise<Company[]> { return invoke<Company[]>('get_companies'); }
export async function createCompany(name: string): Promise<Company> { return invoke<Company>('create_company', { name }); }
export async function saveCompany(company: Company): Promise<Company> { return invoke<Company>('save_company', { company }); }
export async function mergeCompanyLinks(oldName: string, newName: string): Promise<void> {
  await invoke('merge_company_links', { oldName, newName });
}
export async function getSavedLists(): Promise<SavedList[]> { return invoke<SavedList[]>('get_saved_lists'); }
export async function saveSavedList(list: SavedList): Promise<SavedList> { return invoke<SavedList>('save_saved_list', { list }); }
export async function deleteSavedList(id: number): Promise<void> { await invoke('delete_saved_list', { id }); }
export async function setSavedListCompanies(listId: number, add: number[], remove: number[]): Promise<SavedList> {
  return invoke<SavedList>('set_saved_list_companies', { listId, add, remove });
}
export async function getIndustryTaxonomy(): Promise<string[]> { return invoke<string[]>('get_industry_taxonomy'); }
export async function runCompanyMigration(): Promise<CompanyMigrationReport> { return invoke<CompanyMigrationReport>('run_company_migration'); }
export async function getReviewQueue(): Promise<ReviewQueueEntry[]> { return invoke<ReviewQueueEntry[]>('get_review_queue'); }
export async function resolveReviewQueueEntry(id: number, action: 'confirm' | 'select' | 'create' | 'ignore', companyId?: number | null): Promise<void> {
  await invoke('resolve_review_queue_entry', { id, action, companyId: companyId ?? null });
}
export async function getOpportunities(): Promise<Opportunity[]> { return invoke<Opportunity[]>('get_opportunities'); }
export async function saveOpportunity(opportunity: Opportunity): Promise<Opportunity> { return invoke<Opportunity>('save_opportunity', { opportunity }); }
export async function deleteOpportunity(id: number): Promise<void> { await invoke('delete_opportunity', { id }); }
export async function getOpportunityActivity(opportunityId: number): Promise<OpportunityActivity[]> { return invoke<OpportunityActivity[]>('get_opportunity_activity', { opportunityId }); }

export async function getMeetings(): Promise<Meeting[]> { return (await invoke<Meeting[]>('get_meetings')).map(normalizeMeeting); }
export async function saveMeeting(meeting: Meeting): Promise<Meeting> { return normalizeMeeting(await invoke<Meeting>('save_meeting', { meeting })); }
export async function deleteMeeting(id: number): Promise<void> { await invoke('delete_meeting', { id }); }

export async function getLinksFor(entityType: EntityKind, entityId: number): Promise<EntityLink[]> {
  return invoke<EntityLink[]>('get_links_for', { entityType, entityId });
}
export async function setLinksFrom(fromType: EntityKind, fromId: number, links: EntityLink[]): Promise<void> {
  await invoke('set_links_from', { fromType, fromId, links });
}

export async function getAllTags(): Promise<string[]> { return invoke<string[]>('get_all_tags'); }
export async function setTags(entityType: EntityKind, entityId: number, tags: string[]): Promise<void> {
  await invoke('set_tags', { entityType, entityId, tags });
}

export async function getNoteTemplates(): Promise<NoteTemplate[]> { return invoke<NoteTemplate[]>('get_note_templates'); }
export async function saveNoteTemplate(name: string, content: string): Promise<NoteTemplate> {
  return invoke<NoteTemplate>('save_note_template', { name, content });
}
export async function updateNoteTemplate(id: number, name: string, content: string): Promise<void> {
  await invoke('update_note_template', { id, name, content });
}
export async function deleteNoteTemplate(id: number): Promise<void> { await invoke('delete_note_template', { id }); }

export async function saveAttachment(noteId: number, filename: string, base64Data: string): Promise<Attachment> {
  return invoke<Attachment>('save_attachment', { noteId, filename, base64Data });
}
export async function getAttachmentDataUrl(id: number): Promise<string> { return invoke<string>('get_attachment_data_url', { id }); }
export async function deleteAttachment(id: number): Promise<void> { await invoke('delete_attachment', { id }); }

export async function getInboxItems(): Promise<InboxItem[]> { return invoke<InboxItem[]>('get_inbox_items'); }
export async function addInboxItem(itemType: string, content: string): Promise<InboxItem> {
  return invoke<InboxItem>('add_inbox_item', { itemType, content });
}
export async function resolveInboxItem(id: number, convertedToType?: string | null, convertedToId?: number | null): Promise<void> {
  await invoke('resolve_inbox_item', { id, convertedToType: convertedToType ?? null, convertedToId: convertedToId ?? null });
}
export async function deleteInboxItem(id: number): Promise<void> { await invoke('delete_inbox_item', { id }); }

export async function searchWorkspace(query: string): Promise<SearchResult[]> {
  return invoke<SearchResult[]>('search_workspace', { query });
}
export async function getNoteBacklinks(noteId: number): Promise<NoteRef[]> {
  return invoke<NoteRef[]>('get_note_backlinks', { noteId });
}
export async function rebuildSearchIndex(): Promise<void> { await invoke('rebuild_search_index'); }

// ═══════════════ Microsoft 365 ═══════════════

export async function ms365GetClientId(): Promise<string | null> { return invoke<string | null>('ms365_get_client_id'); }
export async function ms365SetClientId(clientId: string): Promise<void> { await invoke('ms365_set_client_id', { clientId }); }
export async function ms365GetTenantId(): Promise<string | null> { return invoke<string | null>('ms365_get_tenant_id'); }
export async function ms365SetTenantId(tenantId: string): Promise<void> { await invoke('ms365_set_tenant_id', { tenantId }); }
export async function ms365Status(): Promise<MicrosoftAccountStatus> { return invoke<MicrosoftAccountStatus>('ms365_status'); }
export interface WeatherNow { id: string; temperature: number; symbol: string }
/** Current weather for places (MET Norway). Places that fail are left out. */
export async function weatherNow(places: { id: string; lat: number; lon: number }[]): Promise<WeatherNow[]> { return invoke<WeatherNow[]>('weather_now', { places }); }
/** The team member signed in on this device, linking the Microsoft account on first use. */
export async function identityCurrentUser(): Promise<number | null> { return invoke<number | null>('identity_current_user'); }
export async function ms365Connect(): Promise<MicrosoftAccountStatus> { return invoke<MicrosoftAccountStatus>('ms365_connect'); }
export async function ms365Disconnect(): Promise<MicrosoftAccountStatus> { return invoke<MicrosoftAccountStatus>('ms365_disconnect'); }

export async function ms365SyncFlaggedEmails(): Promise<EmailRecord[]> { return (await invoke<EmailRecord[]>('ms365_sync_flagged_emails')).map(normalizeEmail); }
export async function ms365GetCachedEmails(): Promise<EmailRecord[]> { return (await invoke<EmailRecord[]>('ms365_get_cached_emails')).map(normalizeEmail); }
export async function ms365GetEmailsByIds(ids: number[]): Promise<EmailRecord[]> { return ids.length ? invoke<EmailRecord[]>('ms365_get_emails_by_ids', { ids }) : Promise.resolve([]); }
export async function ms365GetEmailsByCompany(companyId: number): Promise<EmailRecord[]> { return invoke<EmailRecord[]>('ms365_get_emails_by_company', { companyId }); }
export async function ms365GetCompletedEmails(limit = 100): Promise<EmailCompletedRecord[]> { return invoke<EmailCompletedRecord[]>('ms365_get_completed_emails', { limit }); }
export async function ms365UpdateEmailFlag(id: number, complete: boolean): Promise<void> { await invoke('ms365_update_email_flag', { id, complete }); }
/** Undo for complete / remove flag: flags the message again in Outlook and returns the refreshed flagged list. */
export async function ms365ReflagEmail(messageId: string): Promise<EmailRecord[]> { return invoke<EmailRecord[]>('ms365_reflag_email', { messageId }); }
export async function ms365SetEmailCompany(id: number, companyName: string | null): Promise<void> { await invoke('ms365_set_email_company', { id, companyName }); }
export async function ms365OpenEmail(id: number): Promise<void> { await invoke('ms365_open_email', { id }); }

export async function ms365SyncCalendar(startIso: string, endIso: string): Promise<void> {
  await invoke('ms365_sync_calendar', { startIso, endIso });
}
export interface CreateTeamsMeetingInput {
  subject: string; startIso: string; endIso: string; timeZone: string; description: string;
  location: string; attendeeEmails: string[]; isTeamsMeeting: boolean;
}
export async function ms365CreateTeamsMeeting(input: CreateTeamsMeetingInput): Promise<Meeting> {
  return normalizeMeeting(await invoke<Meeting>('ms365_create_teams_meeting', { ...input }));
}
export async function ms365UpdateOutlookMeeting(outlookEventId: string, input: CreateTeamsMeetingInput): Promise<Meeting> {
  return normalizeMeeting(await invoke<Meeting>('ms365_update_outlook_meeting', { outlookEventId, ...input }));
}
export async function ms365CancelOutlookMeeting(outlookEventId: string): Promise<void> {
  await invoke('ms365_cancel_outlook_meeting', { outlookEventId });
}

// ═══════════════ Microsoft Files (local Finder-synced OneDrive) ═══════════════

export async function filesListRoots(): Promise<LocalFileItem[]> { return invoke<LocalFileItem[]>('files_list_roots'); }
export async function filesListFolder(path: string): Promise<LocalFileItem[]> { return invoke<LocalFileItem[]>('files_list_folder', { path }); }
export async function filesOpen(path: string): Promise<void> { await invoke('files_open', { path }); }
export async function filesRevealInFinder(path: string): Promise<void> { await invoke('files_reveal_in_finder', { path }); }
export async function filesGetOrCreateMsfile(path: string, name: string, itemType: 'file' | 'folder'): Promise<number> { return invoke<number>('files_get_or_create_msfile', { path, name, itemType }); }
export async function filesGetByIds(ids: number[]): Promise<LocalFileItem[]> { return ids.length ? invoke<LocalFileItem[]>('files_get_by_ids', { ids }) : Promise.resolve([]); }
export async function filesResolveCompanyId(name: string): Promise<number> { return invoke<number>('files_resolve_company_id', { name }); }
export async function filesListLinked(): Promise<LinkedFileEntry[]> { return invoke<LinkedFileEntry[]>('files_list_linked'); }
export async function filesStatPaths(paths: string[]): Promise<LocalFileItem[]> { return paths.length ? invoke<LocalFileItem[]>('files_stat_paths', { paths }) : Promise.resolve([]); }

// ═══════════════ Intelligence (Regulatory Watch / Business Watch) ═══════════════

export async function getIntelligenceItems(kind?: IntelligenceKind, includeArchived = false): Promise<IntelligenceItem[]> {
  return invoke<IntelligenceItem[]>('get_intelligence_items', { kind: kind ?? null, includeArchived });
}
export async function saveIntelligenceItem(item: IntelligenceItem): Promise<IntelligenceItem> {
  return invoke<IntelligenceItem>('save_intelligence_item', { item });
}
export async function deleteIntelligenceItem(id: number): Promise<void> {
  await invoke('delete_intelligence_item', { id });
}
export async function setIntelligenceSaved(id: number, saved: boolean): Promise<void> {
  await invoke('set_intelligence_saved', { id, saved });
}
export async function setIntelligenceArchived(id: number, archived: boolean): Promise<void> {
  await invoke('set_intelligence_archived', { id, archived });
}
export async function syncIntelligenceFeeds(): Promise<number> { return invoke<number>('sync_intelligence_feeds'); }

/** Fire-and-log persistence helper: never let a save failure crash the UI. */
export async function persist<T>(label: string, fn: () => Promise<T>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[persist] ${label} failed:`, err);
    showSaveErrorToast(label);
  }
}

/** Like persist(), but resolves to the saved value on success (or undefined on
 * failure) instead of discarding it — for callers that need the server-assigned
 * row back (e.g. a newly-created project/opportunity/meeting's id). */
export async function persistReturning<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[persist] ${label} failed:`, err);
    showSaveErrorToast(label);
    return undefined;
  }
}

function showSaveErrorToast(label: string) {
  toast(`Couldn't save ${label}`, { tone: 'error', detail: 'Your change may not have been kept — please try again.' });
}

// ── Company notes (dated entries) ────────────────────────────────────────────
export interface CompanyNoteEntry { id: number; companyId: number | null; companyName: string | null; body: string; isLegacy: boolean; createdAt: string; updatedAt: string | null; }
export async function companyNoteEntries(companyId: number | null, companyName: string | null): Promise<CompanyNoteEntry[]> { return invoke<CompanyNoteEntry[]>('company_note_entries', { companyId, companyName }); }
export async function addCompanyNoteEntryDb(companyId: number | null, companyName: string | null, body: string): Promise<CompanyNoteEntry> { return invoke<CompanyNoteEntry>('add_company_note_entry', { companyId, companyName, body }); }
export async function updateCompanyNoteEntryDb(id: number, body: string): Promise<CompanyNoteEntry> { return invoke<CompanyNoteEntry>('update_company_note_entry', { id, body }); }
export async function deleteCompanyNoteEntryDb(id: number): Promise<void> { await invoke('delete_company_note_entry', { id }); }
export async function moveCompanyNoteEntries(oldName: string, newName: string, newId: number | null): Promise<void> { await invoke('move_company_note_entries', { oldName, newName, newId }); }

/** Merges a service into another: lines repoint, the retired row stays and points at the survivor. */
export async function mergeServices(fromId: number, toId: number): Promise<{ proposalLines: number; agreementLines: number; survivor: Service }> { return invoke('merge_services', { fromId, toId }); }
export async function serviceUsage(id: number): Promise<[number, number]> { return invoke<[number, number]>('service_usage', { id }); }

/** Per-source result of the last Watch sync: what each feed brought back, or why it failed. */
export interface FeedStatus { name: string; kind: string; lastRunAt: string | null; added: number; considered: number; error: string | null; }
export async function intelligenceFeedStatus(): Promise<FeedStatus[]> { return invoke<FeedStatus[]>('intelligence_feed_status'); }
