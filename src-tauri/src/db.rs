use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct DbState(pub Mutex<Connection>);

/// V1 baseline schema — unchanged from the original release. All statements are
/// idempotent (`CREATE TABLE IF NOT EXISTS`), so re-running this against an
/// existing V1 database is always safe and never touches existing rows.
const SCHEMA_V1: &str = r#"
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS proposals (
  id                  INTEGER PRIMARY KEY,
  client              TEXT NOT NULL,
  type                TEXT,
  status              TEXT NOT NULL,
  sent_date           TEXT,
  dbl_signed_date     TEXT,
  kickoff_date        TEXT,
  finance             TEXT,
  hubspot             TEXT,
  owner               TEXT,
  remarks             TEXT,
  date_added          TEXT,
  monthly_fee         REAL,
  contract_months     INTEGER,
  win_loss_reason     TEXT,
  doc_link            TEXT,
  archived            INTEGER NOT NULL DEFAULT 0,
  archived_at         TEXT,
  snoozed_until       TEXT,
  date_sent_to_hassan TEXT,
  date_sent_to_client TEXT,
  date_signed         TEXT
);

CREATE TABLE IF NOT EXISTS proposal_activity_notes (
  id          INTEGER PRIMARY KEY,
  proposal_id INTEGER NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  note_date   TEXT,
  text        TEXT
);
CREATE INDEX IF NOT EXISTS idx_activity_notes_proposal ON proposal_activity_notes(proposal_id);

CREATE TABLE IF NOT EXISTS contacts (
  id          INTEGER PRIMARY KEY,
  client_name TEXT,
  name        TEXT,
  role        TEXT,
  email       TEXT,
  phone       TEXT,
  whatsapp    TEXT,
  service     TEXT
);

CREATE TABLE IF NOT EXISTS contact_list_defs (
  name TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS contact_list_members (
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  list_name  TEXT NOT NULL,
  PRIMARY KEY (contact_id, list_name)
);

CREATE TABLE IF NOT EXISTS agreements (
  id                  INTEGER PRIMARY KEY,
  agr_ref             TEXT,
  client              TEXT,
  type                TEXT,
  status              TEXT,
  prepared_by         TEXT,
  date_prepared       TEXT,
  date_sent_to_client TEXT,
  date_client_signed  TEXT,
  date_mena_signed    TEXT,
  date_filed          TEXT,
  monthly_fee         REAL,
  contract_months     INTEGER,
  proposal_id         INTEGER,
  hubspot             TEXT,
  doc_link            TEXT,
  action_date         TEXT,
  remarks             TEXT,
  created_at          TEXT
);

CREATE TABLE IF NOT EXISTS todos (
  id           INTEGER PRIMARY KEY,
  title        TEXT NOT NULL,
  type         TEXT,
  client       TEXT,
  priority     TEXT,
  due_date     TEXT,
  status       TEXT,
  description  TEXT,
  created_at   TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS notes (
  id         INTEGER PRIMARY KEY,
  title      TEXT,
  content    TEXT,
  folder     TEXT,
  client_name TEXT,
  tags_json  TEXT,
  pinned     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS note_folders (
  name        TEXT PRIMARY KEY,
  sort_order  INTEGER
);

CREATE TABLE IF NOT EXISTS company_notes (
  company_name TEXT PRIMARY KEY,
  note_text    TEXT
);

CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
"#;

/// Versioned, additive migrations applied on top of SCHEMA_V1. Each entry runs
/// exactly once (gated by `app_meta.schema_version`), in a single transaction,
/// and never drops or rewrites an existing table — only adds new tables/columns/
/// indexes. This is how V2 (projects, milestones, meetings, documents, tags,
/// note links, inbox, full-text search) layers onto the V1 database without
/// touching a single existing row.
const MIGRATIONS: &[(i64, &str)] = &[
    (2, r#"
        -- Lightweight top-of-hierarchy grouping ("Area" in Part 17: Area -> Project -> Section -> Task -> Subtask).
        CREATE TABLE IF NOT EXISTS areas (
          id         INTEGER PRIMARY KEY,
          name       TEXT NOT NULL UNIQUE,
          sort_order INTEGER
        );

        -- Projects are first-class: a project's company is OPTIONAL (Part 3/5). Company is
        -- referenced by name, matching the existing app-wide convention (proposals/contacts/
        -- agreements all key off client name, not a numeric company id) — this keeps company
        -- membership derived and avoids an invasive, risky renormalization of existing data.
        CREATE TABLE IF NOT EXISTS projects (
          id              INTEGER PRIMARY KEY,
          name            TEXT NOT NULL,
          type            TEXT NOT NULL DEFAULT 'internal', -- 'client' | 'internal'
          status          TEXT NOT NULL DEFAULT 'Not Started',
          priority        TEXT NOT NULL DEFAULT 'Medium',
          owner           TEXT,
          description     TEXT,
          company_name    TEXT,
          area_id         INTEGER REFERENCES areas(id) ON DELETE SET NULL,
          start_date      TEXT,
          target_date     TEXT,
          completion_date TEXT,
          progress_override INTEGER, -- NULL = derive from task completion; else manual override 0-100
          tags_json       TEXT,
          archived        INTEGER NOT NULL DEFAULT 0,
          created_at      TEXT,
          updated_at      TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_projects_company ON projects(company_name);
        CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
        CREATE INDEX IF NOT EXISTS idx_projects_type ON projects(type);

        CREATE TABLE IF NOT EXISTS project_milestones (
          id              INTEGER PRIMARY KEY,
          project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name            TEXT NOT NULL,
          description     TEXT,
          status          TEXT NOT NULL DEFAULT 'Not Started', -- Not Started | In Progress | Done
          target_date     TEXT,
          completion_date TEXT,
          sort_order      INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_milestones_project ON project_milestones(project_id);

        CREATE TABLE IF NOT EXISTS meetings (
          id             INTEGER PRIMARY KEY,
          title          TEXT NOT NULL,
          meeting_date   TEXT,
          company_name   TEXT,
          project_id     INTEGER REFERENCES projects(id) ON DELETE SET NULL,
          attendees_json TEXT,
          agenda         TEXT,
          discussion     TEXT,
          decisions      TEXT,
          action_items   TEXT,
          follow_up      TEXT,
          next_meeting   TEXT,
          note_id        INTEGER REFERENCES notes(id) ON DELETE SET NULL,
          created_at     TEXT,
          updated_at     TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_meetings_company ON meetings(company_name);
        CREATE INDEX IF NOT EXISTS idx_meetings_project ON meetings(project_id);

        CREATE TABLE IF NOT EXISTS documents (
          id           INTEGER PRIMARY KEY,
          title        TEXT NOT NULL,
          link         TEXT,
          doc_type     TEXT,
          company_name TEXT,
          project_id   INTEGER REFERENCES projects(id) ON DELETE SET NULL,
          proposal_id  INTEGER REFERENCES proposals(id) ON DELETE SET NULL,
          agreement_id INTEGER REFERENCES agreements(id) ON DELETE SET NULL,
          meeting_id   INTEGER REFERENCES meetings(id) ON DELETE SET NULL,
          note_id      INTEGER REFERENCES notes(id) ON DELETE SET NULL,
          created_at   TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);
        CREATE INDEX IF NOT EXISTS idx_documents_company ON documents(company_name);

        -- Generic polymorphic relationship graph: covers Note<->Project, Task<->Company,
        -- Meeting<->Contact, etc. (Parts 12/18) without a combinatorial explosion of
        -- per-entity-pair join tables. One row per link; queried from either side.
        CREATE TABLE IF NOT EXISTS entity_links (
          id        INTEGER PRIMARY KEY,
          from_type TEXT NOT NULL,
          from_id   INTEGER NOT NULL,
          to_type   TEXT NOT NULL,
          to_id     INTEGER NOT NULL,
          created_at TEXT,
          UNIQUE(from_type, from_id, to_type, to_id)
        );
        CREATE INDEX IF NOT EXISTS idx_links_from ON entity_links(from_type, from_id);
        CREATE INDEX IF NOT EXISTS idx_links_to ON entity_links(to_type, to_id);

        -- Note-to-note [[wikilink]] backlinks (Part 13) — kept distinct from entity_links
        -- since backlink display semantics (source/target) are note-specific.
        CREATE TABLE IF NOT EXISTS note_links (
          id             INTEGER PRIMARY KEY,
          source_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
          target_note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
          UNIQUE(source_note_id, target_note_id)
        );
        CREATE INDEX IF NOT EXISTS idx_note_links_source ON note_links(source_note_id);
        CREATE INDEX IF NOT EXISTS idx_note_links_target ON note_links(target_note_id);

        -- Freeform tags (Part 14) across notes/tasks/projects. Distinct tag values are
        -- derived from this table directly (no separate defs table to keep in sync).
        CREATE TABLE IF NOT EXISTS entity_tags (
          entity_type TEXT NOT NULL,
          entity_id   INTEGER NOT NULL,
          tag         TEXT NOT NULL,
          PRIMARY KEY (entity_type, entity_id, tag)
        );
        CREATE INDEX IF NOT EXISTS idx_tags_tag ON entity_tags(tag);

        CREATE TABLE IF NOT EXISTS note_templates (
          id      INTEGER PRIMARY KEY,
          name    TEXT NOT NULL UNIQUE,
          content TEXT NOT NULL,
          sort_order INTEGER
        );

        -- Universal quick-capture (Part 10).
        CREATE TABLE IF NOT EXISTS inbox_items (
          id               INTEGER PRIMARY KEY,
          item_type        TEXT NOT NULL, -- task | note | idea | followup
          content          TEXT NOT NULL,
          created_at       TEXT,
          processed        INTEGER NOT NULL DEFAULT 0,
          converted_to_type TEXT,
          converted_to_id   INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_inbox_processed ON inbox_items(processed);

        -- Task hierarchy + project linkage (Parts 16-18). Existing rows keep working
        -- unchanged: these columns are all nullable additions, defaulting to the prior
        -- flat/unlinked behavior.
        ALTER TABLE todos ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
        ALTER TABLE todos ADD COLUMN parent_id INTEGER REFERENCES todos(id) ON DELETE CASCADE;
        ALTER TABLE todos ADD COLUMN area_id INTEGER REFERENCES areas(id) ON DELETE SET NULL;
        ALTER TABLE todos ADD COLUMN section TEXT;
        ALTER TABLE todos ADD COLUMN sort_order INTEGER;
        ALTER TABLE todos ADD COLUMN recurrence_rule TEXT;
        CREATE INDEX IF NOT EXISTS idx_todos_project ON todos(project_id);
        CREATE INDEX IF NOT EXISTS idx_todos_parent ON todos(parent_id);

        ALTER TABLE notes ADD COLUMN is_template INTEGER NOT NULL DEFAULT 0;
    "#),
    (3, r#"
        -- FTS5 full-text index for universal search (Part 21/33). Populated by the
        -- Rust command layer (delete+reinsert per entity on every relevant save,
        -- matching the app's existing whole-table replace pattern) rather than
        -- triggers, so the indexing logic stays visible and testable in Rust.
        CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
          entity_type UNINDEXED,
          entity_id UNINDEXED,
          title,
          body,
          tokenize = 'porter unicode61'
        );
    "#),
    (4, r#"
        -- ═══ Microsoft 365 integration ═══
        -- Single-row connection status/profile. Tokens themselves NEVER live here —
        -- they're stored only in the macOS Keychain (Part 2: "Do not store
        -- access/refresh tokens in localStorage or plaintext application
        -- data"). This table just tracks *whether* an account is connected and its
        -- display info, so the UI can show status without touching the Keychain.
        CREATE TABLE IF NOT EXISTS microsoft_account (
          id            INTEGER PRIMARY KEY CHECK (id = 1),
          account_email TEXT,
          display_name  TEXT,
          tenant_id     TEXT,
          connected_at  TEXT,
          last_sync_at  TEXT,
          status        TEXT NOT NULL DEFAULT 'disconnected' -- disconnected | connected | expired | error
        );

        -- Cached flagged-email metadata (Part 3). Outlook remains the source of
        -- truth — this is a local mirror of just enough fields to render "Action
        -- Required" and link emails into the work graph, keyed by the Graph message
        -- id so re-syncs upsert instead of duplicating.
        CREATE TABLE IF NOT EXISTS emails (
          id                INTEGER PRIMARY KEY,
          message_id        TEXT NOT NULL UNIQUE, -- Microsoft Graph message id (stable external id)
          conversation_id   TEXT,
          subject           TEXT,
          sender_name       TEXT,
          sender_email      TEXT,
          preview           TEXT,
          received_at       TEXT,
          flag_status       TEXT NOT NULL DEFAULT 'flagged', -- flagged | complete
          flag_due_at       TEXT,
          web_link          TEXT, -- opens the message in Outlook web/desktop
          is_read           INTEGER NOT NULL DEFAULT 0,
          last_synced_at    TEXT,
          created_at        TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_emails_flag_status ON emails(flag_status);
        CREATE INDEX IF NOT EXISTS idx_emails_flag_due ON emails(flag_due_at);

        -- Extend the existing Meeting entity (added in the prior upgrade) with
        -- Outlook/Teams sync fields, all nullable so every existing internal-only
        -- meeting row keeps working unchanged (Part 13: "store the Outlook event ID
        -- as the external identifier" on the SAME Meeting entity, not a parallel one).
        ALTER TABLE meetings ADD COLUMN outlook_event_id TEXT;
        ALTER TABLE meetings ADD COLUMN ms_calendar_id TEXT;
        ALTER TABLE meetings ADD COLUMN start_at TEXT;   -- ISO 8601 UTC instant (Outlook-sourced meetings)
        ALTER TABLE meetings ADD COLUMN end_at TEXT;
        ALTER TABLE meetings ADD COLUMN organizer TEXT;
        ALTER TABLE meetings ADD COLUMN location TEXT;
        ALTER TABLE meetings ADD COLUMN is_online_meeting INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE meetings ADD COLUMN online_meeting_url TEXT; -- Teams join link
        ALTER TABLE meetings ADD COLUMN is_cancelled INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE meetings ADD COLUMN source TEXT NOT NULL DEFAULT 'internal'; -- internal | outlook
        ALTER TABLE meetings ADD COLUMN last_synced_at TEXT;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_outlook_event ON meetings(outlook_event_id) WHERE outlook_event_id IS NOT NULL;

        -- ═══ Intelligence (Regulatory Watch / Business Watch) ═══
        -- Deliberately flat (no separate IntelligenceSource table yet — Part 37 lists
        -- it as a *potential* entity, and the source fields below are enough to
        -- render and filter by source until enough sources exist to warrant a
        -- registry table of their own; adding one later is a pure additive migration).
        CREATE TABLE IF NOT EXISTS intelligence_items (
          id               INTEGER PRIMARY KEY,
          kind             TEXT NOT NULL,              -- regulatory | business
          headline         TEXT NOT NULL,
          summary          TEXT,
          what_changed     TEXT,
          effective_date   TEXT,
          who_affected     TEXT,
          why_it_matters   TEXT,
          affected_services_json TEXT,
          country          TEXT,
          category         TEXT,
          status           TEXT,                       -- confirmed | official_announcement | draft | consultation | proposed | guidance | enforcement_update
          importance       TEXT NOT NULL DEFAULT 'monitor', -- critical | important | monitor
          source_name      TEXT NOT NULL,
          source_tier      INTEGER NOT NULL DEFAULT 7,  -- 1 = government/official ... 7 = reputable news (Part 20 hierarchy)
          source_url       TEXT NOT NULL,
          published_at     TEXT,
          dedup_key        TEXT,                        -- normalized-headline hash used to group duplicate coverage
          is_analysis       INTEGER NOT NULL DEFAULT 0,  -- 1 = why_it_matters is MENA BIG-generated interpretation, not sourced fact
          saved            INTEGER NOT NULL DEFAULT 0,
          archived         INTEGER NOT NULL DEFAULT 0,
          created_at       TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_intel_kind ON intelligence_items(kind);
        CREATE INDEX IF NOT EXISTS idx_intel_importance ON intelligence_items(importance);
        CREATE INDEX IF NOT EXISTS idx_intel_dedup ON intelligence_items(dedup_key);
        CREATE INDEX IF NOT EXISTS idx_intel_saved ON intelligence_items(saved);
    "#),
    (5, r#"
        -- Local audit trail of emails completed from "Action Required" (Part 3's
        -- Completed filter). Graph's flagged-messages query (`flag/flagStatus eq
        -- 'flagged'`) never returns complete-flagged mail, so a completed email
        -- simply disappears from `emails` on the next sync — this table is the
        -- only record of what was handled and when, populated solely by the local
        -- Complete action (not synced from Outlook).
        CREATE TABLE IF NOT EXISTS email_completed_log (
          id            INTEGER PRIMARY KEY,
          message_id    TEXT NOT NULL,
          subject       TEXT,
          sender_name   TEXT,
          sender_email  TEXT,
          completed_at  TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_email_completed_log_at ON email_completed_log(completed_at);

        -- Company association for an email. Companies aren't a separate entity
        -- table in this schema (Proposal.client / Contact.clientName are already
        -- free-text company names, not foreign keys) — this column follows that
        -- same convention rather than inventing a Company entity id for
        -- entity_links, which is reserved for the real numeric-id entities
        -- (project/contact/task/note).
        ALTER TABLE emails ADD COLUMN company_name TEXT;
    "#),
    (6, r#"
        -- Company association for an intelligence item — same free-text
        -- convention as emails.company_name (see migration 5's comment);
        -- Project/Contact links go through entity_links (real numeric ids).
        ALTER TABLE intelligence_items ADD COLUMN company_name TEXT;
    "#),
    (7, r#"
        -- Managed note attachments (Part 22 of the MENA One rebuild): the
        -- Markdown-first note model must reference attachments rather than
        -- embed binary data inline, so images/files live on disk under
        -- <app_data_dir>/attachments/<id>_<filename> (deterministic path,
        -- no separate path column needed) and a note's Markdown references
        -- one via `![](attachment://<id>)`.
        CREATE TABLE IF NOT EXISTS note_attachments (
          id         INTEGER PRIMARY KEY,
          note_id    INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
          filename   TEXT NOT NULL,
          mime_type  TEXT,
          created_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_note_attachments_note ON note_attachments(note_id);
    "#),
    (8, r#"
        -- Live Meeting Notes: tasks added while working inside a meeting
        -- need to be reliably re-listed on that meeting's page (not just
        -- tracked in memory for one session), so a task can now record which
        -- meeting it was created from, same optional-FK convention as
        -- project_id/area_id above.
        ALTER TABLE todos ADD COLUMN meeting_id INTEGER REFERENCES meetings(id) ON DELETE SET NULL;
    "#),
    (9, r#"
        -- Opportunities (Core Refinement & Product Maturity, Stage 2): the
        -- app's first proper Company entity, kept deliberately minimal (just
        -- an identity row) so Opportunity.company_id can be a real FK without
        -- migrating every other entity's existing free-text company fields.
        CREATE TABLE IF NOT EXISTS companies (
          id         INTEGER PRIMARY KEY,
          name       TEXT NOT NULL UNIQUE,
          created_at TEXT
        );

        -- Stage is the 11-value pipeline position (including the terminal
        -- Won/Lost/On Hold stages); status is a small derived Open/Won/Lost/
        -- On Hold rollup kept in sync with stage server-side on every save,
        -- so there's no second field the user has to remember to update.
        CREATE TABLE IF NOT EXISTS opportunities (
          id                  INTEGER PRIMARY KEY,
          name                TEXT NOT NULL,
          company_id          INTEGER REFERENCES companies(id) ON DELETE SET NULL,
          owner               TEXT,
          stage               TEXT NOT NULL DEFAULT 'Lead',
          status              TEXT NOT NULL DEFAULT 'Open',
          estimated_value     REAL,
          currency            TEXT DEFAULT 'SAR',
          probability         INTEGER,
          expected_close_date TEXT,
          description         TEXT,
          next_action         TEXT,
          proposal_id         INTEGER REFERENCES proposals(id) ON DELETE SET NULL,
          project_id          INTEGER REFERENCES projects(id) ON DELETE SET NULL,
          sort_order          INTEGER,
          archived            INTEGER NOT NULL DEFAULT 0,
          created_at          TEXT,
          updated_at          TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_opportunities_stage ON opportunities(stage);

        -- Lightweight history, sized for "foundation" (Part 15 of the doc) —
        -- just creation + stage changes, not a general cross-entity Activity
        -- system.
        CREATE TABLE IF NOT EXISTS opportunity_activity (
          id             INTEGER PRIMARY KEY,
          opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
          kind           TEXT NOT NULL,
          detail         TEXT,
          created_at     TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_opportunity_activity_opp ON opportunity_activity(opportunity_id);

        -- Meetings/Documents relate to an Opportunity the same way they
        -- already relate to a Project — a direct optional FK, not a second
        -- linking mechanism.
        ALTER TABLE meetings ADD COLUMN opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL;
        ALTER TABLE documents ADD COLUMN opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL;
    "#),
    // get_opportunities (opportunities.rs) LEFT JOINs companies ON company_id
    // without an index on that column — harmless at today's row counts, but
    // a real full-table-scan-per-query once the pipeline grows (Stage 5
    // performance pass).
    (10, r#"
        CREATE INDEX IF NOT EXISTS idx_opportunities_company ON opportunities(company_id);
    "#),
    // Microsoft Files (OneDrive/SharePoint business-context layer). Graph
    // items are addressed by string drive_item_id, but entity_links needs a
    // numeric id on both sides — this table's own integer `id` is that
    // numeric handle, minted only when the user actually links an item
    // (never populated by pure browsing, per "don't duplicate OneDrive into
    // SQLite"). `provider`/`drive_id` keep the model open to a SharePoint
    // site's drive later without a schema change — same drive-item shape,
    // different drive_id. UNIQUE(provider, drive_id, drive_item_id) makes
    // linking the same item twice an upsert, not a duplicate row.
    (11, r#"
        CREATE TABLE IF NOT EXISTS microsoft_files (
          id             INTEGER PRIMARY KEY,
          provider       TEXT NOT NULL DEFAULT 'onedrive',
          drive_id       TEXT NOT NULL,
          drive_item_id  TEXT NOT NULL,
          parent_item_id TEXT,
          name           TEXT NOT NULL,
          item_type      TEXT NOT NULL, -- 'file' | 'folder'
          mime_type      TEXT,
          web_url        TEXT,
          size           INTEGER,
          modified_at    TEXT,
          created_at     TEXT,
          last_synced_at TEXT,
          UNIQUE(provider, drive_id, drive_item_id)
        );
        CREATE INDEX IF NOT EXISTS idx_microsoft_files_parent ON microsoft_files(parent_item_id);
    "#),
    // Microsoft Files was rebuilt on migration 12 to read OneDrive straight
    // from this Mac's Finder-synced ~/Library/CloudStorage folder instead of
    // the Microsoft Graph API (no extra OAuth consent needed, "Open" is
    // always a real native-app handoff) — migration 11's table above was
    // never actually written to under that design and is superseded here.
    // The absolute local path is now the stable identity entity_links needs
    // (drive_id/drive_item_id no longer apply); this table's own integer
    // `id` is still only minted when the user actually links an item, never
    // by pure browsing.
    (12, r#"
        DROP TABLE IF EXISTS microsoft_files;
        CREATE TABLE microsoft_files (
          id         INTEGER PRIMARY KEY,
          path       TEXT NOT NULL UNIQUE,
          name       TEXT NOT NULL,
          item_type  TEXT NOT NULL, -- 'file' | 'folder'
          created_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_microsoft_files_path ON microsoft_files(path);
    "#),
    // Company industries (multi-value — a company can span more than one
    // industry) — reuses the existing free-text-name-keyed company_notes
    // table rather than a new one, same rationale as note_text. Stored as a
    // JSON array string, same convention as Note.tags. NOT NULL DEFAULT
    // '[]' keeps existing rows (which only had note_text) valid immediately.
    (13, r#"
        ALTER TABLE company_notes ADD COLUMN industries TEXT NOT NULL DEFAULT '[]';
    "#),
    // Project activity log — mirrors opportunity_activity's shape/FK pattern
    // exactly (a second scoped table, not a generalized cross-entity one,
    // matching the existing convention: just creation + status changes).
    (14, r#"
        CREATE TABLE IF NOT EXISTS project_activity (
          id          INTEGER PRIMARY KEY,
          project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          kind        TEXT NOT NULL,
          detail      TEXT,
          created_at  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_project_activity_project ON project_activity(project_id);
    "#),
    // Marks which Intelligence items came from automatic feed ingestion
    // rather than a human typing them in — NULL (the existing default for
    // every row so far) means manually added. dedup_key already existed
    // (reserved, unused until now) and is what ingestion uses to skip a
    // story it's already pulled in on a previous sync.
    (15, r#"
        ALTER TABLE intelligence_items ADD COLUMN ingested_via TEXT;
    "#),
    // Company master-data layer: `companies` gains the real fields a
    // canonical entity needs (it was previously just id/name/created_at);
    // industries move off `company_notes` (keyed by free-text name, the
    // exact identity problem this migration fixes) into a proper table
    // keyed by company_id, multi-value per the existing multi-industry UX;
    // a review queue holds any legacy company reference the one-time
    // migration command (see commands.rs/opportunities.rs) can't confidently
    // resolve on its own; and the four entities that only had a free-text
    // company name (Opportunity already had company_id) gain the real FK,
    // additively — the free-text columns are kept and stay in sync, not
    // replaced.
    (16, r#"
        ALTER TABLE companies ADD COLUMN legal_name TEXT;
        ALTER TABLE companies ADD COLUMN website TEXT;
        ALTER TABLE companies ADD COLUMN country TEXT;
        ALTER TABLE companies ADD COLUMN city TEXT;
        ALTER TABLE companies ADD COLUMN company_type TEXT;
        ALTER TABLE companies ADD COLUMN status TEXT;
        ALTER TABLE companies ADD COLUMN owner TEXT;
        ALTER TABLE companies ADD COLUMN description TEXT;
        ALTER TABLE companies ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE companies ADD COLUMN updated_at TEXT;

        CREATE TABLE IF NOT EXISTS company_industries (
          company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          industry   TEXT NOT NULL,
          PRIMARY KEY (company_id, industry)
        );
        CREATE INDEX IF NOT EXISTS idx_company_industries_industry ON company_industries(industry);

        CREATE TABLE IF NOT EXISTS company_review_queue (
          id                    INTEGER PRIMARY KEY,
          source_table          TEXT NOT NULL,
          source_id             INTEGER NOT NULL,
          raw_name              TEXT NOT NULL,
          suggested_company_id  INTEGER REFERENCES companies(id) ON DELETE SET NULL,
          status                TEXT NOT NULL DEFAULT 'pending',
          created_at            TEXT,
          resolved_at           TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_company_review_status ON company_review_queue(status);

        ALTER TABLE contacts ADD COLUMN company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL;
        ALTER TABLE proposals ADD COLUMN company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL;
        ALTER TABLE agreements ADD COLUMN company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL;
        ALTER TABLE projects ADD COLUMN company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_contacts_company_id ON contacts(company_id);
        CREATE INDEX IF NOT EXISTS idx_proposals_company_id ON proposals(company_id);
        CREATE INDEX IF NOT EXISTS idx_agreements_company_id ON agreements(company_id);
        CREATE INDEX IF NOT EXISTS idx_projects_company_id ON projects(company_id);
    "#),
    // Every remaining entity that names a company in free text gets the real
    // link too. Exact name matches are filled in here; anything else is picked
    // up by the Company Master Data migration (Settings) and on the next save.
    (18, r#"
        ALTER TABLE meetings ADD COLUMN company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL;
        ALTER TABLE notes ADD COLUMN company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL;
        ALTER TABLE todos ADD COLUMN company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL;
        ALTER TABLE intelligence_items ADD COLUMN company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL;
        ALTER TABLE emails ADD COLUMN company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL;
        ALTER TABLE documents ADD COLUMN company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_meetings_company_id ON meetings(company_id);
        CREATE INDEX IF NOT EXISTS idx_notes_company_id ON notes(company_id);
        CREATE INDEX IF NOT EXISTS idx_todos_company_id ON todos(company_id);
        CREATE INDEX IF NOT EXISTS idx_intelligence_items_company_id ON intelligence_items(company_id);
        CREATE INDEX IF NOT EXISTS idx_emails_company_id ON emails(company_id);
        CREATE INDEX IF NOT EXISTS idx_documents_company_id ON documents(company_id);
        UPDATE meetings SET company_id = (SELECT c.id FROM companies c WHERE c.name = TRIM(meetings.company_name)) WHERE company_name IS NOT NULL;
        UPDATE notes SET company_id = (SELECT c.id FROM companies c WHERE c.name = TRIM(notes.client_name)) WHERE client_name IS NOT NULL;
        UPDATE todos SET company_id = (SELECT c.id FROM companies c WHERE c.name = TRIM(todos.client)) WHERE client IS NOT NULL;
        UPDATE intelligence_items SET company_id = (SELECT c.id FROM companies c WHERE c.name = TRIM(intelligence_items.company_name)) WHERE company_name IS NOT NULL;
        UPDATE emails SET company_id = (SELECT c.id FROM companies c WHERE c.name = TRIM(emails.company_name)) WHERE company_name IS NOT NULL;
        UPDATE documents SET company_id = (SELECT c.id FROM companies c WHERE c.name = TRIM(documents.company_name)) WHERE company_name IS NOT NULL;
    "#),
    // Keep the email addresses Outlook sends for meeting attendees and mail
    // recipients (previously only display names were kept), so meetings and
    // emails can later be matched to contacts and companies by address.
    (19, r#"
        ALTER TABLE meetings ADD COLUMN organizer_email TEXT;
        ALTER TABLE meetings ADD COLUMN attendee_emails_json TEXT;
        ALTER TABLE emails ADD COLUMN recipients_json TEXT;
    "#),
    // Tasks redesign: an optional time on the due date, and "Someday" for
    // tasks deliberately parked out of the active lists.
    (20, r#"
        ALTER TABLE todos ADD COLUMN due_time TEXT;
        ALTER TABLE todos ADD COLUMN someday INTEGER NOT NULL DEFAULT 0;
    "#),
    // Unified activity log fed by triggers on every module (activity.rs).
    (21, crate::activity::ACTIVITY_MIGRATION),
    // Pipeline insights and proposal templates (insights.rs, pptx.rs).
    (23, crate::insights::INSIGHTS_MIGRATION),
];

/// Migrations that are generated in code rather than written out as SQL,
/// interleaved with MIGRATIONS by version number.
const CODE_MIGRATIONS: &[(i64, fn(&Connection) -> rusqlite::Result<()>)] = &[
    (17, add_sync_columns),
    // Commercial core: service catalog, business entities, team directory,
    // proposal/agreement lines, review workflow, status clean-up (commercial.rs).
    (22, crate::commercial::migrate_commercial_core),
    (24, add_template_sync_columns),
    // Rate cards as ranges with a standard price; Liquidation and Recruitment cards.
    (25, crate::commercial::migrate_pricing_ranges),
    // Priced rows per service line (tranches, workforce categories, staff
    // types, countries), the client's employee count, Workforce with recruitment.
    (26, crate::commercial::add_line_rate_columns),
    // Proposal row presets (Accountancy rows, Recruitment staff types) and cards
    // for Business Setup (8,000), GM Representative and Mobilization by country.
    (27, crate::commercial::migrate_pricing_ranges),
    // Company lists (hand-picked or smart) and smart contact lists (lists.rs).
    (28, crate::lists::migrate_saved_lists),
    // Foundation Lock: former company names, and links to records that no longer exist.
    (29, migrate_foundation_lock),
    // Company notes follow the company by id (they were keyed by its name).
    (30, migrate_company_notes_ids),
    // Work Graph: tasks can belong to an opportunity; task activity carries it.
    (31, migrate_task_opportunities),
    // Company notes become a dated log instead of one overwritable text box.
    (32, migrate_company_note_entries),
    // Services can be merged: the retired name stays, pointing at the survivor.
    (33, migrate_service_merges),
    (34, migrate_identity_foundation),
    // The Outlook invite text gets its own column instead of filling Discussion;
    // tasks get an owner.
    (35, migrate_meeting_invite_text),
    // Commitments (who promised what, by when) and what an opportunity is waiting on.
    (36, crate::commitments::migrate_commitments),
    // Company 360 as a briefing: pinned company notes, decision makers.
    (37, migrate_company_brief),
    // Agreements import: chains, evidence, renewal rules, groups, billing.
    (38, migrate_agreements_import),
];

fn column_exists(conn: &Connection, table: &str, col: &str) -> rusqlite::Result<bool> {
    Ok(conn
        .prepare(&format!("PRAGMA table_info({table})"))?
        .query_map([], |r| r.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .iter()
        .any(|c| c == col))
}

/// Agreements import (the agreements review's IMPORT_SPEC v1.1, §4): additive
/// columns on agreements and companies, and the monthly `billing` table.
fn migrate_agreements_import(conn: &Connection) -> rusqlite::Result<()> {
    let add = |table: &str, col: &str, def: &str| -> rusqlite::Result<()> {
        if !column_exists(conn, table, col)? {
            conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {col} {def};"))?;
        }
        Ok(())
    };
    add("agreements", "parent_agreement_id", "INTEGER REFERENCES agreements(id) ON DELETE SET NULL")?;
    add("agreements", "chain_root_id", "INTEGER REFERENCES agreements(id) ON DELETE SET NULL")?;
    add("agreements", "carries_current_terms", "INTEGER NOT NULL DEFAULT 1")?;
    add("agreements", "adds_to_parent", "INTEGER NOT NULL DEFAULT 0")?;
    add("agreements", "terms_evidence", "TEXT")?;
    add("agreements", "fee_basis", "TEXT")?;
    add("agreements", "signature_status", "TEXT")?;
    add("agreements", "renewal_rule", "TEXT")?;
    add("agreements", "absorbed_into_id", "INTEGER REFERENCES agreements(id) ON DELETE SET NULL")?;
    // The review's key for each agreement, so a re-run updates instead of duplicating.
    add("agreements", "import_key", "TEXT")?;
    add("companies", "parent_company_id", "INTEGER REFERENCES companies(id) ON DELETE SET NULL")?;
    conn.execute_batch(
        r#"-- One current link per chain.
        CREATE UNIQUE INDEX IF NOT EXISTS idx_agreements_chain_current ON agreements(chain_root_id)
          WHERE carries_current_terms = 1 AND chain_root_id IS NOT NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_agreements_import_key ON agreements(import_key) WHERE import_key IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_companies_parent ON companies(parent_company_id);
        -- auto_renew is derived from renewal_rule from now on.
        UPDATE agreements SET renewal_rule = 'auto' WHERE renewal_rule IS NULL AND auto_renew = 1;
        CREATE TABLE IF NOT EXISTS billing (
          id                 INTEGER PRIMARY KEY,
          company_id         INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
          service_id         INTEGER REFERENCES services(id) ON DELETE SET NULL,
          finance_department TEXT,
          finance_service    TEXT,
          sales_type         TEXT,
          month              TEXT NOT NULL,
          amount             REAL NOT NULL,
          currency           TEXT NOT NULL DEFAULT 'SAR',
          invoice_lines      INTEGER,
          source             TEXT NOT NULL,
          loaded_at          TEXT NOT NULL
        );
        -- Finance's own row is the identity: several of its (department, service,
        -- sales type) rows map to one catalogue service in the same month.
        CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_row ON billing(company_id, month, source,
          COALESCE(finance_department, ''), COALESCE(finance_service, ''), COALESCE(sales_type, ''));
        CREATE INDEX IF NOT EXISTS idx_billing_company_month ON billing(company_id, month);"#,
    )?;
    // A restored backup may already carry the table with its sync columns.
    if column_exists(conn, "billing", "uuid")? { return Ok(()); }
    add_sync_columns_to(conn, &["billing"])
}

fn migrate_company_brief(conn: &Connection) -> rusqlite::Result<()> {
    if !column_exists(conn, "company_note_entries", "pinned")? {
        conn.execute_batch("ALTER TABLE company_note_entries ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;")?;
    }
    if !column_exists(conn, "contacts", "is_decision_maker")? {
        conn.execute_batch("ALTER TABLE contacts ADD COLUMN is_decision_maker INTEGER NOT NULL DEFAULT 0;")?;
    }
    Ok(())
}

fn migrate_meeting_invite_text(conn: &Connection) -> rusqlite::Result<()> {
    let has = conn
        .prepare("PRAGMA table_info(meetings)")?
        .query_map([], |r| r.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .iter()
        .any(|c| c == "invite_text");
    if !has {
        conn.execute_batch("ALTER TABLE meetings ADD COLUMN invite_text TEXT;")?;
    }
    crate::meeting_text::move_invite_text(conn)?;
    // Action items say who does them: tasks get an owner like companies do.
    let todo_cols = conn
        .prepare("PRAGMA table_info(todos)")?
        .query_map([], |r| r.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if !todo_cols.iter().any(|c| c == "owner") {
        conn.execute_batch("ALTER TABLE todos ADD COLUMN owner TEXT;")?;
    }
    if !todo_cols.iter().any(|c| c == "owner_id") {
        conn.execute_batch("ALTER TABLE todos ADD COLUMN owner_id INTEGER REFERENCES team_members(id) ON DELETE SET NULL;")?;
    }
    conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_todos_owner_id ON todos(owner_id);")?;
    Ok(())
}

/// The catalogue carried the same service under several names (Company
/// Constitution / Business Setup, Workforce / Employer of Record, PRO / Admin
/// PRO). Merging one into another keeps the retired row — so proposals that
/// were sent under the old name still read correctly — and points it at the
/// service that survives.
/// Identity groundwork (see identity.rs): team members can be linked to their
/// Microsoft account, companies/opportunities/projects get an owner link to
/// the team directory beside the free-text owner, and each activity entry
/// records the team member who was using the app. Existing owner names that
/// match a team member are linked; nothing else is guessed.
fn migrate_identity_foundation(conn: &Connection) -> rusqlite::Result<()> {
    let has_col = |table: &str, col: &str| -> rusqlite::Result<bool> {
        Ok(conn
            .prepare(&format!("PRAGMA table_info({table})"))?
            .query_map([], |r| r.get::<_, String>(1))?
            .collect::<rusqlite::Result<Vec<_>>>()?
            .iter()
            .any(|c| c == col))
    };
    if !has_col("team_members", "entra_object_id")? {
        conn.execute_batch("ALTER TABLE team_members ADD COLUMN entra_object_id TEXT;")?;
    }
    conn.execute_batch(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_team_members_entra_object_id ON team_members(entra_object_id) WHERE entra_object_id IS NOT NULL;",
    )?;
    for table in crate::identity::OWNED_TABLES {
        if !has_col(table, "owner_id")? {
            conn.execute_batch(&format!(
                "ALTER TABLE {table} ADD COLUMN owner_id INTEGER REFERENCES team_members(id) ON DELETE SET NULL;"
            ))?;
        }
        conn.execute_batch(&format!("CREATE INDEX IF NOT EXISTS idx_{table}_owner_id ON {table}(owner_id);"))?;
    }
    if !has_col("activity", "actor_id")? {
        conn.execute_batch("ALTER TABLE activity ADD COLUMN actor_id INTEGER REFERENCES team_members(id) ON DELETE SET NULL;")?;
    }
    conn.execute_batch(
        "CREATE TRIGGER IF NOT EXISTS act_stamp_actor AFTER INSERT ON activity
         WHEN NEW.actor_id IS NULL
         BEGIN
           UPDATE activity SET actor_id = (
             SELECT t.id FROM app_meta m JOIN team_members t ON t.id = CAST(m.value AS INTEGER)
             WHERE m.key = 'current_user_id'
           ) WHERE id = NEW.id;
         END;",
    )?;
    crate::identity::relink_owners(conn)?;
    Ok(())
}

fn migrate_service_merges(conn: &Connection) -> rusqlite::Result<()> {
    let has_col = conn
        .prepare("PRAGMA table_info(services)")?
        .query_map([], |r| r.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .iter()
        .any(|c| c == "merged_into");
    if !has_col {
        conn.execute_batch("ALTER TABLE services ADD COLUMN merged_into INTEGER REFERENCES services(id) ON DELETE SET NULL;")?;
    }
    conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_services_merged_into ON services(merged_into);")
}

/// A company's notes were one text field that every edit overwrote. They become
/// dated entries, so what was written in March survives a note added in
/// September. The existing text is kept as the first entry of that company's
/// log, marked `is_legacy` because its real date was never recorded, and the
/// old `company_notes` rows are left untouched as a fallback.
fn migrate_company_note_entries(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        r#"CREATE TABLE IF NOT EXISTS company_note_entries (
          id           INTEGER PRIMARY KEY,
          company_id   INTEGER REFERENCES companies(id) ON DELETE CASCADE,
          company_name TEXT,
          body         TEXT NOT NULL,
          is_legacy    INTEGER NOT NULL DEFAULT 0,
          created_at   TEXT NOT NULL,
          updated_at   TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_company_note_entries_company ON company_note_entries(company_id);
        CREATE INDEX IF NOT EXISTS idx_company_note_entries_name ON company_note_entries(company_name);"#,
    )?;
    let already: i64 = conn.query_row("SELECT COUNT(*) FROM company_note_entries", [], |r| r.get(0))?;
    if already > 0 {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO company_note_entries (company_id, company_name, body, is_legacy, created_at)
         SELECT n.company_id, COALESCE(c.name, n.company_name), n.note_text, 1, strftime('%Y-%m-%dT%H:%M:%fZ','now')
         FROM company_notes n LEFT JOIN companies c ON c.id = n.company_id
         WHERE n.note_text IS NOT NULL AND TRIM(n.note_text) <> ''",
        [],
    )?;
    Ok(())
}

fn migrate_task_opportunities(conn: &Connection) -> rusqlite::Result<()> {
    let has_col = conn.prepare("PRAGMA table_info(todos)")?
        .query_map([], |r| r.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .iter()
        .any(|c| c == "opportunity_id");
    if !has_col {
        conn.execute_batch("ALTER TABLE todos ADD COLUMN opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL;")?;
    }
    conn.execute_batch(
        r#"CREATE INDEX IF NOT EXISTS idx_todos_opportunity ON todos(opportunity_id);
        DROP TRIGGER IF EXISTS act_task_insert;
        DROP TRIGGER IF EXISTS act_task_done;
        CREATE TRIGGER act_task_insert AFTER INSERT ON todos
        WHEN NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'activity_muted' AND value = '1')
        BEGIN
          INSERT INTO activity (created_at, action, entity_type, entity_id, entity_label, company_id, project_id, opportunity_id)
          VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'created', 'task', NEW.id, NEW.title, NEW.company_id, NEW.project_id, NEW.opportunity_id);
        END;
        CREATE TRIGGER act_task_done AFTER UPDATE OF status ON todos
        WHEN NEW.status = 'Done' AND OLD.status IS NOT 'Done' AND NOT EXISTS (SELECT 1 FROM app_meta WHERE key = 'activity_muted' AND value = '1')
        BEGIN
          INSERT INTO activity (created_at, action, entity_type, entity_id, entity_label, company_id, project_id, opportunity_id)
          VALUES (strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'completed', 'task', NEW.id, NEW.title, NEW.company_id, NEW.project_id, NEW.opportunity_id);
        END;
        CREATE TRIGGER IF NOT EXISTS act_link_todo_opportunity AFTER UPDATE OF opportunity_id ON todos WHEN NEW.opportunity_id IS NOT NULL
        BEGIN UPDATE activity SET opportunity_id = NEW.opportunity_id WHERE entity_type = 'task' AND entity_id = NEW.id AND opportunity_id IS NULL; END;"#,
    )
}

fn migrate_company_notes_ids(conn: &Connection) -> rusqlite::Result<()> {
    let has_col = conn.prepare("PRAGMA table_info(company_notes)")?
        .query_map([], |r| r.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .iter()
        .any(|c| c == "company_id");
    if !has_col {
        conn.execute_batch("ALTER TABLE company_notes ADD COLUMN company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL;")?;
    }
    conn.execute_batch("CREATE UNIQUE INDEX IF NOT EXISTS idx_company_notes_company ON company_notes(company_id) WHERE company_id IS NOT NULL;")?;
    link_company_notes(conn)?;
    Ok(())
}

/// Gives company notes that aren't linked yet the company their name
/// unambiguously refers to. A company that already has linked notes, or a
/// name matching several companies, is left as it is (still readable by name).
pub fn link_company_notes(conn: &Connection) -> rusqlite::Result<usize> {
    let rows: Vec<String> = conn
        .prepare("SELECT company_name FROM company_notes WHERE company_id IS NULL")?
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let mut linked = 0;
    for name in rows {
        if let crate::opportunities::CompanyMatch::One(id) = crate::opportunities::match_company_name(conn, &name)? {
            linked += conn.execute(
                "UPDATE company_notes SET company_id = ?1 WHERE company_name = ?2 AND company_id IS NULL
                   AND NOT EXISTS (SELECT 1 FROM company_notes WHERE company_id = ?1)",
                rusqlite::params![id, name],
            )?;
        }
    }
    Ok(linked)
}

fn migrate_foundation_lock(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(FOUNDATION_LOCK_MIGRATION)?;
    remove_orphan_links(conn)?;
    Ok(())
}

/// Entity types used in `entity_links`, and the table each lives in.
pub const LINK_ENTITY_TABLES: &[(&str, &str)] = &[
    ("company", "companies"), ("contact", "contacts"), ("opportunity", "opportunities"), ("project", "projects"),
    ("proposal", "proposals"), ("agreement", "agreements"), ("meeting", "meetings"), ("note", "notes"),
    ("task", "todos"), ("msfile", "microsoft_files"), ("intelligence", "intelligence_items"), ("email", "emails"),
    ("document", "documents"),
];

const FOUNDATION_LOCK_MIGRATION: &str = r#"
    CREATE TABLE IF NOT EXISTS company_aliases (
      alias      TEXT NOT NULL COLLATE NOCASE PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      created_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_company_aliases_company ON company_aliases(company_id);
"#;

/// Deletes entity links whose source or target record no longer exists.
/// Returns how many were removed.
pub fn remove_orphan_links(conn: &Connection) -> rusqlite::Result<usize> {
    let mut removed = 0;
    for (kind, _) in LINK_ENTITY_TABLES {
        removed += remove_orphan_links_of(conn, kind)?;
    }
    Ok(removed)
}

/// Same, for links from or to one kind of record — called after deleting records of that kind.
pub fn remove_orphan_links_of(conn: &Connection, kind: &str) -> rusqlite::Result<usize> {
    let Some((_, table)) = LINK_ENTITY_TABLES.iter().find(|(k, _)| *k == kind) else { return Ok(0) };
    Ok(conn.execute(
        &format!(
            "DELETE FROM entity_links WHERE (from_type = ?1 AND from_id NOT IN (SELECT id FROM {table}))
                OR (to_type = ?1 AND to_id NOT IN (SELECT id FROM {table}))"
        ),
        rusqlite::params![kind],
    )?)
}

fn add_template_sync_columns(conn: &Connection) -> rusqlite::Result<()> {
    add_sync_columns_to(conn, &["proposal_templates"])
}

/// Tables holding shared business records. Each gets a global identity and
/// change tracking so a future sync layer can move rows between devices:
/// local integer ids stay device-local, `uuid` is the identity that travels.
pub const SYNC_TABLES: &[&str] = &[
    "proposals", "proposal_activity_notes", "contacts", "agreements", "todos", "notes",
    "areas", "projects", "project_milestones", "meetings", "documents", "entity_links",
    "note_templates", "inbox_items", "intelligence_items", "note_attachments",
    "companies", "opportunities", "opportunity_activity", "project_activity",
];

const SQL_UUID_V4: &str = "lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))";
const SQL_NOW_MS: &str = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/// Adds `uuid`, `row_version` and `row_updated_at` to every sync table, kept
/// current by triggers so no individual write path has to remember them, and
/// records hard deletes in `sync_tombstones`. The update trigger only bumps
/// when the writer didn't set `row_version` itself, leaving room for a sync
/// client to apply remote rows verbatim.
fn add_sync_columns(conn: &Connection) -> rusqlite::Result<()> {
    add_sync_columns_to(conn, SYNC_TABLES)
}

/// Same sync columns and triggers for tables added after migration 17.
pub fn add_sync_columns_to(conn: &Connection, tables: &[&str]) -> rusqlite::Result<()> {
    atomic(conn, "sync_columns", |tx| add_sync_columns_inner(tx, tables))
}

fn add_sync_columns_inner(tx: &Connection, tables: &[&str]) -> rusqlite::Result<()> {
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS sync_tombstones (
           id         INTEGER PRIMARY KEY,
           table_name TEXT NOT NULL,
           uuid       TEXT NOT NULL,
           deleted_at TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_sync_tombstones_deleted_at ON sync_tombstones(deleted_at);",
    )?;
    for t in tables {
        tx.execute_batch(&format!(
            "ALTER TABLE {t} ADD COLUMN uuid TEXT;
             ALTER TABLE {t} ADD COLUMN row_version INTEGER NOT NULL DEFAULT 1;
             ALTER TABLE {t} ADD COLUMN row_updated_at TEXT;
             UPDATE {t} SET uuid = {SQL_UUID_V4}, row_updated_at = {SQL_NOW_MS} WHERE uuid IS NULL;
             CREATE UNIQUE INDEX IF NOT EXISTS idx_{t}_uuid ON {t}(uuid);
             CREATE TRIGGER IF NOT EXISTS trg_{t}_sync_insert AFTER INSERT ON {t}
               WHEN NEW.uuid IS NULL OR NEW.row_updated_at IS NULL
             BEGIN
               UPDATE {t} SET uuid = COALESCE(NEW.uuid, {SQL_UUID_V4}),
                              row_updated_at = COALESCE(NEW.row_updated_at, {SQL_NOW_MS})
               WHERE id = NEW.id;
             END;
             CREATE TRIGGER IF NOT EXISTS trg_{t}_sync_update AFTER UPDATE ON {t}
               WHEN NEW.row_version = OLD.row_version AND OLD.uuid IS NOT NULL
             BEGIN
               UPDATE {t} SET row_version = OLD.row_version + 1, row_updated_at = {SQL_NOW_MS}
               WHERE id = NEW.id;
             END;
             CREATE TRIGGER IF NOT EXISTS trg_{t}_sync_delete AFTER DELETE ON {t}
               WHEN OLD.uuid IS NOT NULL
             BEGIN
               INSERT INTO sync_tombstones (table_name, uuid, deleted_at) VALUES ('{t}', OLD.uuid, {SQL_NOW_MS});
             END;"
        ))?;
    }
    Ok(())
}

/// Resolve the SQLite database file path inside the app's data directory
/// (e.g. ~/Library/Application Support/com.menabig.tracker/menabig.sqlite3 on macOS).
pub fn db_path(app_data_dir: &PathBuf) -> PathBuf {
    app_data_dir.join("menabig.sqlite3")
}

pub fn init_connection(path: &PathBuf) -> rusqlite::Result<Connection> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let conn = Connection::open(path)?;
    bring_up_to_date(&conn)?;
    Ok(conn)
}

/// Creates what's missing and runs pending migrations — on opening, and after
/// a full backup from an older version is copied into the open database.
pub fn bring_up_to_date(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(SCHEMA_V1)?;
    // Company names are resolved by several older migrations too, and that
    // lookup reads former names — so the table exists before any of them run.
    conn.execute_batch(FOUNDATION_LOCK_MIGRATION)?;
    run_migrations(conn)?;
    seed_defaults(conn)
}

/// The schema version this build migrates databases up to.
pub fn latest_schema_version() -> i64 {
    MIGRATIONS.iter().map(|(v, _)| *v).chain(CODE_MIGRATIONS.iter().map(|(v, _)| *v)).max().unwrap_or(1)
}

pub fn schema_version(conn: &Connection) -> rusqlite::Result<i64> {
    current_schema_version(conn)
}

fn current_schema_version(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT value FROM app_meta WHERE key = 'schema_version'",
        [],
        |r| r.get::<_, String>(0),
    )
    .map(|s| s.parse::<i64>().unwrap_or(1))
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(1),
        other => Err(other),
    })
}

enum MigrationStep {
    Sql(&'static str),
    Code(fn(&Connection) -> rusqlite::Result<()>),
}

/// Runs `f` inside a savepoint: everything it writes is kept only if it
/// succeeds. Savepoints nest, so a step that is itself atomic can run inside
/// another one (a migration inside the migration runner, for example).
pub fn atomic<T>(conn: &Connection, name: &str, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> rusqlite::Result<T> {
    conn.execute_batch(&format!("SAVEPOINT {name}"))?;
    match f(conn) {
        Ok(value) => {
            conn.execute_batch(&format!("RELEASE {name}"))?;
            Ok(value)
        }
        Err(e) => {
            let _ = conn.execute_batch(&format!("ROLLBACK TO {name}; RELEASE {name}"));
            Err(e)
        }
    }
}

fn run_migrations(conn: &Connection) -> rusqlite::Result<()> {
    let mut steps: Vec<(i64, MigrationStep)> = MIGRATIONS.iter().map(|(v, sql)| (*v, MigrationStep::Sql(sql))).collect();
    steps.extend(CODE_MIGRATIONS.iter().map(|(v, f)| (*v, MigrationStep::Code(*f))));
    run_steps(conn, steps)
}

/// A migration and the schema version it reaches are written together: one
/// that fails part-way leaves no trace, and the database stays at the last
/// version that fully applied (instead of half-migrated and unable to start).
fn run_steps(conn: &Connection, mut steps: Vec<(i64, MigrationStep)>) -> rusqlite::Result<()> {
    let mut version = current_schema_version(conn)?;
    steps.sort_by_key(|(v, _)| *v);
    for (target_version, step) in &steps {
        if version >= *target_version {
            continue;
        }
        atomic(conn, "migration_step", |conn| {
            match step {
                MigrationStep::Sql(sql) => conn.execute_batch(sql)?,
                MigrationStep::Code(f) => f(conn)?,
            }
            conn.execute(
                "INSERT INTO app_meta (key, value) VALUES ('schema_version', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![target_version.to_string()],
            )?;
            Ok(())
        })?;
        version = *target_version;
    }
    Ok(())
}

/// Test hook: runs made-up migration steps through the real runner.
#[doc(hidden)]
pub fn run_test_steps(conn: &Connection, sql_steps: &[(i64, &'static str)]) -> rusqlite::Result<()> {
    run_steps(conn, sql_steps.iter().map(|(v, sql)| (*v, MigrationStep::Sql(sql))).collect())
}

/// First-run defaults: default note folders (matching the original app's
/// hard-coded list) and the initial note-template library (Part 15).
fn seed_defaults(conn: &Connection) -> rusqlite::Result<()> {
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM note_folders", [], |r| r.get(0))?;
    if count == 0 {
        for (i, name) in ["Meeting Notes", "Client Notes", "Internal"].iter().enumerate() {
            conn.execute(
                "INSERT INTO note_folders (name, sort_order) VALUES (?1, ?2)",
                rusqlite::params![name, i as i64],
            )?;
        }
    }

    let tcount: i64 = conn.query_row("SELECT COUNT(*) FROM note_templates", [], |r| r.get(0))?;
    if tcount == 0 {
        for (i, (name, content)) in default_templates().iter().enumerate() {
            conn.execute(
                "INSERT INTO note_templates (name, content, sort_order) VALUES (?1, ?2, ?3)",
                rusqlite::params![name, content, i as i64],
            )?;
        }
    }
    Ok(())
}

fn default_templates() -> Vec<(&'static str, &'static str)> {
    let meeting = "<h2>Attendees</h2><p></p><h2>Context</h2><p></p><h2>Discussion</h2><p></p><h2>Decisions</h2><p></p><h2>Open Questions</h2><p></p><h2>Action Items</h2><p></p><h2>Follow-Up</h2><p></p><h2>Next Meeting</h2><p></p>";
    vec![
        ("Client Meeting", meeting),
        ("Internal Meeting", meeting),
        ("Client Research", "<h2>Company Overview</h2><p></p><h2>Key People</h2><p></p><h2>Needs / Pain Points</h2><p></p><h2>Opportunity</h2><p></p><h2>Next Steps</h2><p></p>"),
        ("Proposal Notes", "<h2>Scope</h2><p></p><h2>Pricing Considerations</h2><p></p><h2>Risks</h2><p></p><h2>Open Items</h2><p></p>"),
        ("Sales Call", "<h2>Attendees</h2><p></p><h2>Context</h2><p></p><h2>Discussion</h2><p></p><h2>Objections</h2><p></p><h2>Next Steps</h2><p></p>"),
        ("Follow-Up", "<h2>Summary</h2><p></p><h2>Status</h2><p></p><h2>Next Action</h2><p></p><h2>Due</h2><p></p>"),
        ("Project Kickoff", "<h2>Objective</h2><p></p><h2>Scope</h2><p></p><h2>Stakeholders</h2><p></p><h2>Milestones</h2><p></p><h2>Risks</h2><p></p><h2>First Steps</h2><p></p>"),
        ("Agreement Review", "<h2>Key Terms</h2><p></p><h2>Concerns</h2><p></p><h2>Redlines</h2><p></p><h2>Next Steps</h2><p></p>"),
        ("Research Note", "<h2>Question</h2><p></p><h2>Findings</h2><p></p><h2>Sources</h2><p></p><h2>Implications</h2><p></p>"),
        ("Recruitment Assignment", "<h2>Role</h2><p></p><h2>Client</h2><p></p><h2>Requirements</h2><p></p><h2>Candidates</h2><p></p><h2>Status</h2><p></p>"),
        ("Internal Project Update", "<h2>Progress</h2><p></p><h2>Blockers</h2><p></p><h2>Decisions Needed</h2><p></p><h2>Next Steps</h2><p></p>"),
    ]
}
