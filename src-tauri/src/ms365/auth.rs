//! Microsoft identity platform OAuth2 (Authorization Code + PKCE) for a native
//! desktop "public client" — no client secret is used or stored anywhere,
//! because a secret embedded in a shipped desktop binary cannot be kept
//! confidential (Part 2: minimum permissions, no plaintext token storage).
//!
//! Flow: the app opens the system browser at Microsoft's `/authorize` endpoint;
//! a short-lived loopback HTTP listener on 127.0.0.1 catches the redirect
//! (RFC 8252 — the standard native-app OAuth pattern) and hands the
//! authorization code back to the app, which then exchanges it for tokens
//! directly (no browser involvement) using the PKCE code_verifier as proof of
//! possession instead of a secret.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::time::Duration;

/// Single-tenant app registrations (the default for anything created after
/// 2018-10-15, and what Settings' walkthrough has the user create) reject the
/// generic `/common` alias with AADSTS50194. So the tenant segment is always
/// resolved per-call from the user's own Directory (tenant) ID/domain, saved
/// alongside the Client ID; `/common` is kept only as a fallback for the rare
/// case someone deliberately registered a multi-tenant app and left it blank.
fn tenant_segment(tenant_id: &str) -> &str {
    let t = tenant_id.trim();
    if t.is_empty() { "common" } else { t }
}

pub fn auth_endpoint(tenant_id: &str) -> String {
    format!("https://login.microsoftonline.com/{}/oauth2/v2.0/authorize", tenant_segment(tenant_id))
}

pub fn token_endpoint(tenant_id: &str) -> String {
    format!("https://login.microsoftonline.com/{}/oauth2/v2.0/token", tenant_segment(tenant_id))
}

/// Fixed loopback port for the redirect URI. Must exactly match the redirect
/// URI configured on the Azure app registration (Settings walks the user
/// through entering `http://localhost:18473/callback` there).
pub const REDIRECT_PORT: u16 = 18473;

pub fn redirect_uri() -> String {
    format!("http://localhost:{REDIRECT_PORT}/callback")
}

/// Minimum scopes for the app's current surface: profile, flagged-email read +
/// flag updates, full calendar CRUD (covers create/update/cancel — Graph has
/// no narrower "create only" scope), and offline_access for a refresh token so
/// the user isn't prompted to sign in again every hour. The Microsoft Files
/// feature deliberately does NOT add Files.Read.All/Sites.Read.All here — it
/// reads the user's local Finder-synced OneDrive folder via the filesystem
/// instead of Graph, so no additional Graph consent is needed for it.
pub const SCOPES: &str = "offline_access User.Read Mail.ReadWrite Calendars.ReadWrite";

fn random_url_safe_token(byte_len: usize) -> String {
    let mut bytes = vec![0u8; byte_len];
    rand::thread_rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

/// PKCE code_verifier: a high-entropy random string (RFC 7636 recommends
/// 43-128 chars); 32 random bytes base64url-encoded lands at 43 chars.
pub fn generate_code_verifier() -> String {
    random_url_safe_token(32)
}

pub fn code_challenge_s256(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hasher.finalize())
}

/// CSRF-protection value echoed back by Microsoft; wait_for_redirect rejects
/// any callback whose `state` doesn't match.
pub fn generate_state() -> String {
    random_url_safe_token(16)
}

pub fn build_authorize_url(client_id: &str, tenant_id: &str, state: &str, code_challenge: &str) -> String {
    let mut url = url::Url::parse(&auth_endpoint(tenant_id)).expect("well-formed endpoint");
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", &redirect_uri())
        .append_pair("response_mode", "query")
        .append_pair("scope", SCOPES)
        .append_pair("state", state)
        .append_pair("code_challenge", code_challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("prompt", "select_account");
    url.to_string()
}

/// Blocks the calling thread (must be run off the async runtime — see
/// commands.rs's `spawn_blocking`) until the loopback redirect arrives, times
/// out, or the user's browser sends an error. Returns the authorization code.
pub fn wait_for_redirect(expected_state: &str, timeout: Duration) -> Result<String, String> {
    let listener = TcpListener::bind(("127.0.0.1", REDIRECT_PORT))
        .map_err(|e| format!("Could not open the local sign-in listener on port {REDIRECT_PORT}: {e}. Is another MENA One window already signing in?"))?;
    listener
        .set_nonblocking(false)
        .map_err(|e| e.to_string())?;
    // A single blocking accept with an overall deadline: poll with a short
    // read timeout per attempt rather than blocking forever on one accept().
    listener.set_nonblocking(true).ok();
    let deadline = std::time::Instant::now() + timeout;
    loop {
        if std::time::Instant::now() > deadline {
            return Err("Sign-in timed out waiting for the browser redirect.".into());
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
                let mut buf = [0u8; 4096];
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]);
                let first_line = request.lines().next().unwrap_or("");
                // "GET /callback?code=...&state=... HTTP/1.1"
                let path_and_query = first_line
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or("/");
                let full_url = format!("http://localhost{path_and_query}");
                let parsed = url::Url::parse(&full_url).map_err(|e| e.to_string())?;
                let params: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();

                let (status_line, body) = if let Some(err) = params.get("error") {
                    let desc = params.get("error_description").cloned().unwrap_or_default();
                    (
                        "HTTP/1.1 200 OK",
                        format!("<html><body style='font-family:-apple-system;padding:40px;text-align:center'><h2>Sign-in failed</h2><p>{err}: {desc}</p><p>You can close this window and return to MENA One.</p></body></html>"),
                    )
                } else {
                    (
                        "HTTP/1.1 200 OK",
                        "<html><body style='font-family:-apple-system;padding:40px;text-align:center'><h2>Signed in</h2><p>You can close this window and return to MENA One.</p></body></html>".to_string(),
                    )
                };
                let response = format!(
                    "{status_line}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();

                if let Some(err) = params.get("error") {
                    let desc = params.get("error_description").cloned().unwrap_or_default();
                    return Err(format!("Microsoft sign-in was cancelled or failed: {err} — {desc}"));
                }
                let state = params.get("state").cloned().unwrap_or_default();
                if state != expected_state {
                    return Err("Sign-in response failed a security check (state mismatch) — please try again.".into());
                }
                return params
                    .get("code")
                    .cloned()
                    .ok_or_else(|| "No authorization code in the sign-in response.".to_string());
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(150));
                continue;
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    /// Present on the initial code exchange; Microsoft may omit it on some
    /// refresh responses (in which case the caller should keep the prior one).
    pub refresh_token: Option<String>,
    pub expires_in: i64,
}

#[derive(Debug, Deserialize)]
struct GraphErrorBody {
    error: GraphErrorDetail,
}
#[derive(Debug, Deserialize)]
struct GraphErrorDetail {
    #[serde(default)]
    error_description: String,
    #[serde(default)]
    message: String,
}

async fn token_request(tenant_id: &str, params: &[(&str, &str)]) -> Result<TokenResponse, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let resp = client
        .post(token_endpoint(tenant_id))
        .form(params)
        .send()
        .await
        .map_err(|e| format!("Could not reach Microsoft sign-in servers: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let msg = serde_json::from_str::<GraphErrorBody>(&text)
            .map(|b| {
                if !b.error.error_description.is_empty() {
                    b.error.error_description
                } else {
                    b.error.message
                }
            })
            .unwrap_or(text);
        return Err(format!("Microsoft sign-in error: {msg}"));
    }
    serde_json::from_str(&text).map_err(|e| format!("Unexpected sign-in response: {e}"))
}

pub async fn exchange_code_for_tokens(
    client_id: &str,
    tenant_id: &str,
    code: &str,
    code_verifier: &str,
) -> Result<TokenResponse, String> {
    let redirect = redirect_uri();
    token_request(tenant_id, &[
        ("client_id", client_id),
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", &redirect),
        ("code_verifier", code_verifier),
        ("scope", SCOPES),
    ])
    .await
}

pub async fn refresh_access_token(
    client_id: &str,
    tenant_id: &str,
    refresh_token: &str,
) -> Result<TokenResponse, String> {
    token_request(tenant_id, &[
        ("client_id", client_id),
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("scope", SCOPES),
    ])
    .await
}

// ── Secure token storage (macOS Keychain, via the `security` CLI) ──
// Only the long-lived refresh token is ever persisted; the access token is
// kept in memory only (see commands.rs's TokenCache) since it's short-lived
// and re-derivable from the refresh token at any time.
//
// This shells out to /usr/bin/security instead of using the `keyring` crate's
// default SecItemAdd path, deliberately: without a paid Apple Developer ID
// certificate this app is ad-hoc code-signed, and ad-hoc signatures are not a
// stable trust anchor for Keychain — the OS can tie a saved item's access to
// the exact binary hash of the process that created it, which changes on
// every single rebuild (confirmed in practice: a Client/Tenant ID-stable
// re-sign was NOT enough to stop the connection from silently breaking after
// each update). `security add-generic-password -A` explicitly grants access
// to any application for this user account, sidestepping code-identity
// checks entirely, which is what actually keeps the sign-in working across
// app updates. The refresh token remains encrypted-at-rest in Keychain (not
// plaintext on disk) — the trade-off is that any process running as this
// same macOS user could read this one Keychain item if it knew the exact
// service/account name, which is an acceptable bar for a single-user desktop
// tool with no paid signing identity available.
const KEYCHAIN_SERVICE: &str = "com.menabig.tracker.ms365";
const KEYCHAIN_ACCOUNT: &str = "refresh_token";
#[cfg(target_os = "macos")]
const SECURITY_BIN: &str = "/usr/bin/security";

#[cfg(target_os = "macos")]
pub fn store_refresh_token(token: &str) -> Result<(), String> {
    let output = std::process::Command::new(SECURITY_BIN)
        .args(["add-generic-password", "-U", "-a", KEYCHAIN_ACCOUNT, "-s", KEYCHAIN_SERVICE, "-w", token, "-A"])
        .output()
        .map_err(|e| format!("Could not save the Microsoft sign-in to Keychain: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "Could not save the Microsoft sign-in to Keychain: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn load_refresh_token() -> Option<String> {
    let output = std::process::Command::new(SECURITY_BIN)
        .args(["find-generic-password", "-a", KEYCHAIN_ACCOUNT, "-s", KEYCHAIN_SERVICE, "-w"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let token = String::from_utf8(output.stdout).ok()?;
    let trimmed = token.trim();
    if trimmed.is_empty() { None } else { Some(trimmed.to_string()) }
}

#[cfg(target_os = "macos")]
pub fn delete_refresh_token() -> Result<(), String> {
    let output = std::process::Command::new(SECURITY_BIN)
        .args(["delete-generic-password", "-a", KEYCHAIN_ACCOUNT, "-s", KEYCHAIN_SERVICE])
        .output()
        .map_err(|e| format!("Could not remove the saved Microsoft sign-in: {e}"))?;
    // Exit code 44 ("item not found") is fine — already gone.
    if output.status.success() || output.status.code() == Some(44) {
        return Ok(());
    }
    Err(format!(
        "Could not remove the saved Microsoft sign-in: {}",
        String::from_utf8_lossy(&output.stderr).trim()
    ))
}

// Windows (and any other non-macOS target): the platform credential store —
// Windows Credential Manager — through the `keyring` crate.
#[cfg(not(target_os = "macos"))]
fn credential_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| format!("Could not access the credential store: {e}"))
}

#[cfg(not(target_os = "macos"))]
pub fn store_refresh_token(token: &str) -> Result<(), String> {
    credential_entry()?
        .set_password(token)
        .map_err(|e| format!("Could not save the Microsoft sign-in: {e}"))
}

#[cfg(not(target_os = "macos"))]
pub fn load_refresh_token() -> Option<String> {
    credential_entry().ok()?.get_password().ok().filter(|t| !t.trim().is_empty())
}

#[cfg(not(target_os = "macos"))]
pub fn delete_refresh_token() -> Result<(), String> {
    match credential_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not remove the saved Microsoft sign-in: {e}")),
    }
}
