use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MicrosoftAccountStatus {
    /// "disconnected" | "connected" | "expired" | "error"
    pub status: String,
    #[serde(default)]
    pub account_email: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub connected_at: Option<String>,
    #[serde(default)]
    pub last_sync_at: Option<String>,
    /// Set only when status == "error", for a clear message in Settings.
    #[serde(default)]
    pub error_message: Option<String>,
    /// Whether a Client ID has been configured yet (Settings shows the setup
    /// instructions vs. the Connect button based on this).
    #[serde(default)]
    pub has_client_id: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EmailRecord {
    pub id: i64,
    pub message_id: String,
    #[serde(default)]
    pub conversation_id: Option<String>,
    pub subject: Option<String>,
    pub sender_name: Option<String>,
    pub sender_email: Option<String>,
    pub preview: Option<String>,
    pub received_at: Option<String>,
    /// "flagged" | "complete"
    pub flag_status: String,
    #[serde(default)]
    pub flag_due_at: Option<String>,
    pub web_link: Option<String>,
    #[serde(default)]
    pub is_read: bool,
    #[serde(default)]
    pub company_name: Option<String>,
    #[serde(default)]
    pub company_id: Option<i64>,
}

/// In-memory-only access-token cache — never written to disk. `expires_at` is
/// a Unix timestamp (seconds); see `now_unix()` in commands.rs.
#[derive(Debug, Clone, Default)]
pub struct TokenCache {
    pub access_token: Option<String>,
    pub expires_at: i64,
}

#[derive(Default)]
pub struct Ms365State(pub std::sync::Mutex<TokenCache>);
