use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ActivityNote {
    pub id: i64,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Proposal {
    pub id: i64,
    pub client: String,
    /// Mirror of `client`, resolved server-side on every save (see
    /// write_proposals) — the frontend never sets this itself, same
    /// convention Opportunity already established for company_id.
    #[serde(default)]
    pub company_id: Option<i64>,
    #[serde(default)]
    pub r#type: Option<String>,
    pub status: String,
    #[serde(default)]
    pub sent_date: Option<String>,
    #[serde(default)]
    pub dbl_signed_date: Option<String>,
    #[serde(default)]
    pub kickoff_date: Option<String>,
    #[serde(default)]
    pub finance: Option<String>,
    #[serde(default)]
    pub hubspot: Option<String>,
    #[serde(default)]
    pub owner: Option<String>,
    #[serde(default)]
    pub remarks: Option<String>,
    #[serde(default)]
    pub date_added: Option<String>,
    #[serde(default)]
    pub monthly_fee: Option<f64>,
    #[serde(default)]
    pub contract_months: Option<i64>,
    #[serde(default)]
    pub win_loss_reason: Option<String>,
    #[serde(default)]
    pub doc_link: Option<String>,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub archived_at: Option<String>,
    #[serde(default)]
    pub snoozed_until: Option<String>,
    #[serde(default)]
    pub date_sent_to_hassan: Option<String>,
    #[serde(default)]
    pub date_sent_to_client: Option<String>,
    #[serde(default)]
    pub date_signed: Option<String>,
    #[serde(default)]
    pub notes: Vec<ActivityNote>,
    // Commercial core (schema v22). `type`, `monthly_fee` and `one_time_fee`
    // are derived from `lines` whenever a proposal has lines.
    #[serde(default)]
    pub business_entity_id: Option<i64>,
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    pub one_time_fee: Option<f64>,
    #[serde(default)]
    pub primary_contact_id: Option<i64>,
    #[serde(default)]
    pub owner_id: Option<i64>,
    #[serde(default)]
    pub reviewer_id: Option<i64>,
    /// pending | approved | changes_requested
    #[serde(default)]
    pub review_status: Option<String>,
    #[serde(default)]
    pub review_requested_at: Option<String>,
    #[serde(default)]
    pub reviewed_at: Option<String>,
    #[serde(default)]
    pub review_note: Option<String>,
    #[serde(default)]
    pub valid_until: Option<String>,
    #[serde(default)]
    pub folder_path: Option<String>,
    #[serde(default)]
    pub lead_source: Option<String>,
    #[serde(default)]
    pub lines: Vec<CommercialLine>,
    #[serde(default)]
    pub documents: Vec<ProposalDocument>,
}

/// One service on a proposal or agreement.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CommercialLine {
    pub id: i64,
    #[serde(default)]
    pub service_id: Option<i64>,
    #[serde(default)]
    pub service_name: String,
    #[serde(default)]
    pub description: Option<String>,
    /// monthly | one_time
    #[serde(default = "default_billing")]
    pub billing: String,
    #[serde(default = "default_quantity")]
    pub quantity: f64,
    #[serde(default)]
    pub unit_price: Option<f64>,
    #[serde(default)]
    pub commission: bool,
    #[serde(default)]
    pub sort_order: i64,
    /// Priced rows shown in the proposal: employee tranches, workforce
    /// categories, accountancy rows, staff types, countries.
    #[serde(default)]
    pub rates: Vec<LineRate>,
    /// Employees the client has, when known (tranche services).
    #[serde(default)]
    pub employee_count: Option<i64>,
    /// Workforce proposals that include the recruitment process slides.
    #[serde(default)]
    pub with_recruitment: bool,
}

/// One priced row of a proposal line.
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LineRate {
    pub label: String,
    /// Employee band limits for tranches ("6–15 employees").
    #[serde(default)]
    pub from: Option<i64>,
    #[serde(default)]
    pub to: Option<i64>,
    #[serde(default)]
    pub price: Option<f64>,
    /// Percentage fees (Recruitment: % of the annual package).
    #[serde(default)]
    pub percent: Option<f64>,
    /// Counts toward the line's monthly value (e.g. the client's accountancy status).
    #[serde(default)]
    pub counts: bool,
}

fn default_billing() -> String {
    "monthly".into()
}
fn default_quantity() -> f64 {
    1.0
}

/// A file that belongs to a proposal: a version of the proposal deck, the
/// commercials sheet, or a supporting document.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProposalDocument {
    pub id: i64,
    /// proposal | commercials | supporting
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub version: Option<i64>,
    #[serde(default)]
    pub file_name: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Contact {
    pub id: i64,
    #[serde(default)]
    pub client_name: Option<String>,
    /// Mirror of `client_name`, resolved server-side on every save.
    #[serde(default)]
    pub company_id: Option<i64>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub phone: Option<String>,
    #[serde(default)]
    pub whatsapp: Option<String>,
    #[serde(default)]
    pub service: Option<String>,
    #[serde(default)]
    pub lists: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Agreement {
    pub id: i64,
    #[serde(default)]
    pub agr_ref: Option<String>,
    #[serde(default)]
    pub client: Option<String>,
    /// Mirror of `client`, resolved server-side on every save.
    #[serde(default)]
    pub company_id: Option<i64>,
    #[serde(default)]
    pub r#type: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub prepared_by: Option<String>,
    #[serde(default)]
    pub date_prepared: Option<String>,
    #[serde(default)]
    pub date_sent_to_client: Option<String>,
    #[serde(default)]
    pub date_client_signed: Option<String>,
    #[serde(default)]
    pub date_mena_signed: Option<String>,
    #[serde(default)]
    pub date_filed: Option<String>,
    #[serde(default)]
    pub monthly_fee: Option<f64>,
    #[serde(default)]
    pub contract_months: Option<i64>,
    #[serde(default)]
    pub proposal_id: Option<i64>,
    #[serde(default)]
    pub hubspot: Option<String>,
    #[serde(default)]
    pub doc_link: Option<String>,
    #[serde(default)]
    pub action_date: Option<String>,
    #[serde(default)]
    pub remarks: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub business_entity_id: Option<i64>,
    #[serde(default)]
    pub currency: Option<String>,
    #[serde(default)]
    pub start_date: Option<String>,
    #[serde(default)]
    pub end_date: Option<String>,
    /// Not started | Kickoff scheduled | Active | Ended
    #[serde(default)]
    pub service_status: Option<String>,
    #[serde(default)]
    pub auto_renew: bool,
    #[serde(default)]
    pub notice_days: Option<i64>,
    #[serde(default)]
    pub prepared_by_id: Option<i64>,
    #[serde(default)]
    pub lines: Vec<CommercialLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Todo {
    pub id: i64,
    pub title: String,
    #[serde(default)]
    pub r#type: Option<String>,
    #[serde(default)]
    pub client: Option<String>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub completed_at: Option<String>,
    // V2 additions (Parts 16-18): task hierarchy + project linkage. All nullable —
    // existing rows and the original flat/unlinked workflow keep working unchanged.
    #[serde(default)]
    pub project_id: Option<i64>,
    #[serde(default)]
    pub parent_id: Option<i64>,
    #[serde(default)]
    pub area_id: Option<i64>,
    #[serde(default)]
    pub section: Option<String>,
    #[serde(default)]
    pub sort_order: Option<i64>,
    #[serde(default)]
    pub recurrence_rule: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    // Live Meeting Notes: which meeting (if any) this task was added from.
    #[serde(default)]
    pub meeting_id: Option<i64>,
    /// The opportunity this task is part of, when it is sales work.
    #[serde(default)]
    pub opportunity_id: Option<i64>,
    /// Who does it: a team member's name (linked by `owner_id` in the
    /// database) or anyone else, such as the client's contact.
    #[serde(default)]
    pub owner: Option<String>,
    /// "HH:MM" on `due_date`, when the task has a time.
    #[serde(default)]
    pub due_time: Option<String>,
    /// Parked out of Today/Upcoming/Anytime until picked up again.
    #[serde(default)]
    pub someday: bool,
    /// Resolved server-side from `client` on every save — read-only.
    #[serde(default)]
    pub company_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: i64,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub folder: Option<String>,
    #[serde(default)]
    pub client_name: Option<String>,
    /// Resolved server-side from `client_name` on every save — read-only.
    #[serde(default)]
    pub company_id: Option<i64>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}


/// Bundled snapshot of the whole database — used for fast app-startup load
/// and for the app's own (non-legacy) backup/export format.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppData {
    pub proposals: Vec<Proposal>,
    pub contacts: Vec<Contact>,
    pub agreements: Vec<Agreement>,
    pub todos: Vec<Todo>,
    pub notes: Vec<Note>,
    pub note_folders: Vec<String>,
    pub contact_lists: Vec<String>,
    pub company_notes: std::collections::HashMap<String, String>,
    /// Absent from backups made before schema v22; a restore leaves the
    /// current catalog, entities and team in place when they're empty.
    #[serde(default)]
    pub services: Vec<crate::commercial::Service>,
    #[serde(default)]
    pub business_entities: Vec<crate::commercial::BusinessEntity>,
    #[serde(default)]
    pub team_members: Vec<crate::commercial::TeamMember>,
    /// None: a backup made before commitments existed (schema 36) — a
    /// restore leaves today's commitments alone. Some, even empty: the
    /// backup's commitments are the whole set. New backups always write it.
    #[serde(default)]
    pub commitments: Option<Vec<crate::commitments::Commitment>>,
}

/// The company a saved record ended up linked to, returned by the per-record
/// save commands so the frontend's in-memory copy carries the same link.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecordCompanyLink {
    pub id: i64,
    pub company_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub proposals: usize,
    pub contacts: usize,
    pub agreements: usize,
    pub todos: usize,
    pub notes: usize,
    pub note_folders: usize,
    pub contact_lists: usize,
    pub company_notes: usize,
    pub warnings: Vec<String>,
}
