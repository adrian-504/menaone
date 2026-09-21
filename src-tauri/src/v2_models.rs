use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Area {
    pub id: i64,
    pub name: String,
    pub sort_order: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: i64,
    pub name: String,
    /// "client" | "internal"
    pub r#type: String,
    pub status: String,
    pub priority: String,
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub company_name: Option<String>,
    /// Mirror of `company_name`, resolved server-side on every save (see
    /// save_project) — same convention as Proposal/Contact/Agreement.
    #[serde(default)]
    pub company_id: Option<i64>,
    #[serde(default)]
    pub area_id: Option<i64>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub target_date: Option<String>,
    #[serde(default)]
    pub completion_date: Option<String>,
    #[serde(default)]
    pub progress_override: Option<i64>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    // Derived, read-only fields populated on fetch (not stored directly on the row).
    #[serde(default)]
    pub task_count: i64,
    #[serde(default)]
    pub task_done_count: i64,
    #[serde(default)]
    pub computed_progress: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Milestone {
    pub id: i64,
    pub project_id: i64,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    pub status: String,
    #[serde(default)]
    pub target_date: Option<String>,
    #[serde(default)]
    pub completion_date: Option<String>,
    #[serde(default)]
    pub sort_order: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Meeting {
    pub id: i64,
    pub title: String,
    #[serde(default)]
    pub meeting_date: Option<String>,
    #[serde(default)]
    pub company_name: Option<String>,
    /// Resolved server-side from `company_name` on every save — read-only.
    #[serde(default)]
    pub company_id: Option<i64>,
    #[serde(default)]
    pub project_id: Option<i64>,
    #[serde(default)]
    pub opportunity_id: Option<i64>,
    #[serde(default)]
    pub attendees: Vec<String>,
    #[serde(default)]
    pub agenda: Option<String>,
    #[serde(default)]
    pub discussion: Option<String>,
    #[serde(default)]
    pub decisions: Option<String>,
    #[serde(default)]
    pub action_items: Option<String>,
    #[serde(default)]
    pub follow_up: Option<String>,
    #[serde(default)]
    pub next_meeting: Option<String>,
    #[serde(default)]
    pub note_id: Option<i64>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    // ── Outlook/Teams sync (read-only from the frontend's perspective — set
    // only by the ms365:: sync/create/update commands, never by save_meeting) ──
    #[serde(default)]
    pub outlook_event_id: Option<String>,
    #[serde(default)]
    pub start_at: Option<String>,
    #[serde(default)]
    pub end_at: Option<String>,
    #[serde(default)]
    pub organizer: Option<String>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub is_online_meeting: bool,
    #[serde(default)]
    pub online_meeting_url: Option<String>,
    /// The invite's text from Outlook, kept apart from the meeting's notes.
    #[serde(default)]
    pub invite_text: Option<String>,
    #[serde(default)]
    pub is_cancelled: bool,
    #[serde(default = "default_meeting_source")]
    pub source: String,
    /// From Outlook sync — read-only.
    #[serde(default)]
    pub organizer_email: Option<String>,
    #[serde(default)]
    pub attendee_emails: Vec<String>,
}

fn default_meeting_source() -> String { "internal".to_string() }

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRecord {
    pub id: i64,
    pub title: String,
    #[serde(default)]
    pub link: Option<String>,
    #[serde(default)]
    pub doc_type: Option<String>,
    #[serde(default)]
    pub company_name: Option<String>,
    #[serde(default)]
    pub company_id: Option<i64>,
    #[serde(default)]
    pub project_id: Option<i64>,
    #[serde(default)]
    pub proposal_id: Option<i64>,
    #[serde(default)]
    pub agreement_id: Option<i64>,
    #[serde(default)]
    pub meeting_id: Option<i64>,
    #[serde(default)]
    pub note_id: Option<i64>,
    #[serde(default)]
    pub opportunity_id: Option<i64>,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EntityLink {
    pub from_type: String,
    pub from_id: i64,
    pub to_type: String,
    pub to_id: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NoteTemplate {
    pub id: i64,
    pub name: String,
    pub content: String,
    #[serde(default)]
    pub sort_order: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: i64,
    pub note_id: i64,
    pub filename: String,
    pub mime_type: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InboxItem {
    pub id: i64,
    /// "task" | "note" | "idea" | "followup"
    pub item_type: String,
    pub content: String,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub processed: bool,
    #[serde(default)]
    pub converted_to_type: Option<String>,
    #[serde(default)]
    pub converted_to_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub entity_type: String,
    pub entity_id: i64,
    pub title: String,
    pub snippet: String,
}

/// Minimal note reference used for [[wikilink]] backlink display and the
/// wikilink-autocomplete menu — just enough to show and jump to a note.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NoteRef {
    pub id: i64,
    pub title: String,
}

// ═══════════════ OPPORTUNITIES (Core Refinement & Product Maturity, Stage 2) ═══════════════

/// The canonical Company entity (Company Master Data & Relationship Layer).
/// `industries` is multi-value (a company can span more than one), stored in
/// the separate `company_industries` table keyed by company_id — not a
/// second CRM product, just the fields a real client-relationship record
/// needs: identity, classification, and ownership.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Company {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub legal_name: Option<String>,
    #[serde(default)]
    pub industries: Vec<String>,
    #[serde(default)]
    pub website: Option<String>,
    #[serde(default)]
    pub country: Option<String>,
    #[serde(default)]
    pub city: Option<String>,
    #[serde(default)]
    pub company_type: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Opportunity {
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub company_id: Option<i64>,
    /// Read: joined from `companies.name` for display. Write: the frontend
    /// sends a plain name here and the backend resolves/creates the
    /// `companies` row and sets `company_id` itself — callers never handle
    /// Company ids directly.
    #[serde(default)]
    pub company_name: Option<String>,
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub stage: String,
    /// Derived rollup (Open/Won/Lost/On Hold) — always recomputed from
    /// `stage` server-side on save; the frontend should treat this as
    /// read-only.
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub estimated_value: Option<f64>,
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    pub business_entity_id: Option<i64>,
    /// Why it was won or lost, asked when it moves to Won or Lost.
    #[serde(default)]
    pub win_loss_reason: Option<String>,
    #[serde(default)]
    pub probability: Option<i64>,
    #[serde(default)]
    pub expected_close_date: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub next_action: Option<String>,
    #[serde(default)]
    pub proposal_id: Option<i64>,
    #[serde(default)]
    pub project_id: Option<i64>,
    #[serde(default)]
    pub sort_order: Option<i64>,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OpportunityActivity {
    pub id: i64,
    pub opportunity_id: i64,
    pub kind: String,
    #[serde(default)]
    pub detail: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProjectActivity {
    pub id: i64,
    pub project_id: i64,
    pub kind: String,
    #[serde(default)]
    pub detail: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
}
