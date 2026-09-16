//! The API the phone app talks to — skeleton.
//!
//! Today it runs on this Mac and reads the desktop database directly, so the
//! phone screens can be built and judged against real data before anyone pays
//! for a server. The endpoints are the contract: when the cloud work happens,
//! the same routes are served from Azure against Postgres and the phone app
//! does not change.
//!
//!   GET  /api/me           who is signed in (stubbed until Entra sign-in exists)
//!   GET  /api/today        the phone's home screen: meetings, attention, tasks
//!   GET  /api/clients      the client list for lookup
//!   GET  /api/clients/:id  one client: the "before I walk in" page
//!   POST /api/capture      a task or note written on the phone
//!
//! Two decisions from the owner are already enforced here:
//!   * business records only — no mail cache, no calendar copy, no attachments;
//!   * capture needs a connection — there is no offline write path to merge.
//!
//! Run:  cargo run -- --db <path to a copy of menabig.sqlite3>
//! Never point it at the live database: it opens read-only, but a copy keeps
//! the promise obvious.

use axum::{extract::{Path, State}, http::StatusCode, response::Json, routing::{get, post}, Router};
use rusqlite::{params, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tower_http::{cors::CorsLayer, services::ServeDir};

struct App {
    db: Mutex<Connection>,
    /// Captures land here until there is a real backend to accept them.
    captured: Mutex<Vec<Value>>,
}

type Shared = Arc<App>;

fn err<E: std::fmt::Display>(e: E) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

// ── who is signed in ────────────────────────────────────────────────────────

/// Stub. Real identity is Microsoft Entra: the phone signs in, the token
/// carries the user's object id, and every record it sees is filtered by what
/// that user is allowed to see. None of that exists yet, and pretending
/// otherwise in the skeleton would hide the work.
async fn me() -> Json<Value> {
    Json(json!({
        "name": "Signed-in user",
        "identity": "stub",
        "note": "Microsoft sign-in is not built yet — this is the shape, not the thing."
    }))
}

// ── today ───────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Today {
    date: String,
    meetings: Vec<Value>,
    attention: Vec<Value>,
    tasks: Vec<Value>,
}

async fn today(State(app): State<Shared>) -> Result<Json<Today>, (StatusCode, String)> {
    let db = app.db.lock().map_err(err)?;
    let date = db
        .query_row("SELECT date('now','localtime')", [], |r| r.get::<_, String>(0))
        .map_err(err)?;

    let mut stmt = db
        .prepare(
            "SELECT m.id, m.title, m.start_at, m.end_at, COALESCE(c.name, m.company_name, ''), COALESCE(m.location,'')
             FROM meetings m LEFT JOIN companies c ON c.id = m.company_id
             WHERE m.meeting_date = ?1 AND COALESCE(m.is_cancelled,0) = 0
             ORDER BY COALESCE(m.start_at, m.meeting_date)",
        )
        .map_err(err)?;
    let meetings = stmt
        .query_map(params![date], |r| {
            Ok(json!({ "id": r.get::<_,i64>(0)?, "title": r.get::<_,String>(1)?,
                       "startAt": r.get::<_,Option<String>>(2)?, "endAt": r.get::<_,Option<String>>(3)?,
                       "company": r.get::<_,String>(4)?, "location": r.get::<_,String>(5)? }))
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;

    // What needs attention: the same idea as My Day on the desktop, narrowed to
    // what is worth reading on a phone — an agreement running out, and nothing
    // that needs a wide screen to understand.
    let mut stmt = db
        .prepare(
            "SELECT a.id, COALESCE(c.name, a.client, ''), COALESCE(a.agr_ref,''), a.end_date,
                    CAST(julianday(a.end_date) - julianday('now') AS INTEGER), a.notice_days
             FROM agreements a LEFT JOIN companies c ON c.id = a.company_id
             WHERE a.end_date IS NOT NULL AND a.status <> 'Canceled'
               AND julianday(a.end_date) - julianday('now') BETWEEN -30 AND 90
             ORDER BY a.end_date",
        )
        .map_err(err)?;
    let attention = stmt
        .query_map([], |r| {
            let days: i64 = r.get(4)?;
            let notice: Option<i64> = r.get(5)?;
            Ok(json!({
                "kind": "agreement", "id": r.get::<_,i64>(0)?, "company": r.get::<_,String>(1)?,
                "ref": r.get::<_,String>(2)?, "endDate": r.get::<_,String>(3)?, "days": days,
                "noticeDueInDays": notice.map(|n| days - n),
                "tone": if days <= 30 { "red" } else { "amber" }
            }))
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;

    let mut stmt = db
        .prepare(
            "SELECT t.id, t.title, t.due_date, COALESCE(c.name, t.client, ''), COALESCE(t.priority,'')
             FROM todos t LEFT JOIN companies c ON c.id = t.company_id
             WHERE t.status <> 'Done' AND (t.due_date IS NULL OR t.due_date <= date('now','localtime','+1 day'))
             ORDER BY t.due_date IS NULL, t.due_date LIMIT 25",
        )
        .map_err(err)?;
    let tasks = stmt
        .query_map([], |r| {
            Ok(json!({ "id": r.get::<_,i64>(0)?, "title": r.get::<_,String>(1)?,
                       "dueDate": r.get::<_,Option<String>>(2)?, "company": r.get::<_,String>(3)?,
                       "priority": r.get::<_,String>(4)? }))
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;

    Ok(Json(Today { date, meetings, attention, tasks }))
}

// ── clients ─────────────────────────────────────────────────────────────────

async fn clients(State(app): State<Shared>) -> Result<Json<Vec<Value>>, (StatusCode, String)> {
    let db = app.db.lock().map_err(err)?;
    let mut stmt = db
        .prepare(
            "SELECT c.id, c.name, COALESCE(c.city,''), COALESCE(c.status,''),
                    (SELECT COUNT(*) FROM contacts ct WHERE ct.company_id = c.id),
                    (SELECT COUNT(*) FROM agreements a WHERE a.company_id = c.id AND a.status = 'Signed')
             FROM companies c WHERE COALESCE(c.archived,0) = 0 ORDER BY c.name",
        )
        .map_err(err)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(json!({ "id": r.get::<_,i64>(0)?, "name": r.get::<_,String>(1)?, "city": r.get::<_,String>(2)?,
                       "status": r.get::<_,String>(3)?, "contacts": r.get::<_,i64>(4)?, "agreements": r.get::<_,i64>(5)? }))
        })
        .map_err(err)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(err)?;
    Ok(Json(rows))
}

/// The screen that matters most: what you need in the sixty seconds before you
/// walk into a client's office.
async fn client(State(app): State<Shared>, Path(id): Path<i64>) -> Result<Json<Value>, (StatusCode, String)> {
    let db = app.db.lock().map_err(err)?;
    let (name, city, status): (String, String, String) = db
        .query_row(
            "SELECT name, COALESCE(city,''), COALESCE(status,'') FROM companies WHERE id = ?1",
            params![id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| (StatusCode::NOT_FOUND, "no such client".to_string()))?;

    let list = |sql: &str, f: &dyn Fn(&rusqlite::Row) -> rusqlite::Result<Value>| -> Result<Vec<Value>, (StatusCode, String)> {
        let mut stmt = db.prepare(sql).map_err(err)?;
        let rows = stmt.query_map(params![id], |r| f(r)).map_err(err)?;
        rows.collect::<rusqlite::Result<Vec<_>>>().map_err(err)
    };

    let contacts = list(
        "SELECT name, COALESCE(role,''), COALESCE(email,''), COALESCE(phone,''), COALESCE(whatsapp,'')
         FROM contacts WHERE company_id = ?1 ORDER BY name",
        &|r| Ok(json!({ "name": r.get::<_,String>(0)?, "role": r.get::<_,String>(1)?, "email": r.get::<_,String>(2)?,
                        "phone": r.get::<_,String>(3)?, "whatsapp": r.get::<_,String>(4)? })),
    )?;
    let agreements = list(
        "SELECT COALESCE(agr_ref,'(no reference)'), COALESCE(type,''), COALESCE(status,''), end_date
         FROM agreements WHERE company_id = ?1 ORDER BY COALESCE(end_date,'9999') DESC LIMIT 10",
        &|r| Ok(json!({ "ref": r.get::<_,String>(0)?, "type": r.get::<_,String>(1)?,
                        "status": r.get::<_,String>(2)?, "endDate": r.get::<_,Option<String>>(3)? })),
    )?;
    let proposals = list(
        "SELECT id, COALESCE(type,''), COALESCE(status,''), COALESCE(sent_date,'')
         FROM proposals WHERE company_id = ?1 ORDER BY id DESC LIMIT 8",
        &|r| Ok(json!({ "id": r.get::<_,i64>(0)?, "type": r.get::<_,String>(1)?,
                        "status": r.get::<_,String>(2)?, "sent": r.get::<_,String>(3)? })),
    )?;
    let meetings = list(
        "SELECT title, meeting_date FROM meetings WHERE company_id = ?1 ORDER BY meeting_date DESC LIMIT 5",
        &|r| Ok(json!({ "title": r.get::<_,String>(0)?, "date": r.get::<_,Option<String>>(1)? })),
    )?;
    let notes = list(
        "SELECT body, created_at FROM company_note_entries WHERE company_id = ?1 ORDER BY created_at DESC LIMIT 5",
        &|r| Ok(json!({ "body": r.get::<_,String>(0)?, "at": r.get::<_,String>(1)? })),
    )?;
    let tasks = list(
        "SELECT title, due_date FROM todos WHERE company_id = ?1 AND status <> 'Done' ORDER BY due_date LIMIT 8",
        &|r| Ok(json!({ "title": r.get::<_,String>(0)?, "dueDate": r.get::<_,Option<String>>(1)? })),
    )?;

    Ok(Json(json!({
        "id": id, "name": name, "city": city, "status": status,
        "contacts": contacts, "agreements": agreements, "proposals": proposals,
        "meetings": meetings, "notes": notes, "tasks": tasks
    })))
}

// ── capture ─────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Capture {
    kind: String,
    text: String,
    company_id: Option<i64>,
}

/// Capture needs a connection, by the owner's own choice — so there is no
/// offline queue here and nothing to merge later. In the skeleton a capture is
/// held in memory and echoed back; writing it for real belongs to the backend
/// that does not exist yet, and faking the write would be the one thing that
/// makes a skeleton lie.
async fn capture(State(app): State<Shared>, Json(c): Json<Capture>) -> Result<Json<Value>, (StatusCode, String)> {
    if c.text.trim().is_empty() {
        return Err((StatusCode::BAD_REQUEST, "nothing to capture".into()));
    }
    let item = json!({ "kind": c.kind, "text": c.text.trim(), "companyId": c.company_id, "acceptedAt": "now" });
    app.captured.lock().map_err(err)?.push(item.clone());
    Ok(Json(json!({ "accepted": true, "item": item,
        "note": "held in the skeleton — the real backend is what writes it to the database" })))
}

async fn captured(State(app): State<Shared>) -> Result<Json<Vec<Value>>, (StatusCode, String)> {
    Ok(Json(app.captured.lock().map_err(err)?.clone()))
}

#[tokio::main]
async fn main() {
    let mut args = std::env::args().skip(1);
    let mut db_path = String::new();
    while let Some(a) = args.next() {
        if a == "--db" {
            db_path = args.next().unwrap_or_default();
        }
    }
    if db_path.is_empty() {
        eprintln!("usage: cargo run -- --db <copy of menabig.sqlite3>");
        std::process::exit(2);
    }
    let db = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .unwrap_or_else(|e| { eprintln!("could not open {db_path}: {e}"); std::process::exit(1) });

    let app: Shared = Arc::new(App { db: Mutex::new(db), captured: Mutex::new(Vec::new()) });
    let ui = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().join("mobile");

    let router = Router::new()
        .route("/api/me", get(me))
        .route("/api/today", get(today))
        .route("/api/clients", get(clients))
        .route("/api/clients/:id", get(client))
        .route("/api/capture", post(capture).get(captured))
        .fallback_service(ServeDir::new(ui).append_index_html_on_directories(true))
        .layer(CorsLayer::permissive())
        .with_state(app);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:1421").await.expect("port 1421");
    println!("phone skeleton on http://0.0.0.0:1421  (open it from your iPhone on the same wifi)");
    axum::serve(listener, router).await.unwrap();
}
