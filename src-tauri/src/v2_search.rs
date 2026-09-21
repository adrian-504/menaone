//! Full-text search indexing (Part 21/33). Each `reindex_*` function does a
//! delete-then-reinsert of that one entity's row(s) in `search_index`, matching
//! the app's existing whole-record-replace convention. Called at the end of
//! each entity's save command (inside the same transaction) so the index never
//! drifts from the source tables.

use rusqlite::{params, Connection};

fn upsert(conn: &Connection, entity_type: &str, entity_id: i64, title: &str, body: &str) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM search_index WHERE entity_type = ?1 AND entity_id = ?2",
        params![entity_type, entity_id],
    )?;
    conn.execute(
        "INSERT INTO search_index (entity_type, entity_id, title, body) VALUES (?1,?2,?3,?4)",
        params![entity_type, entity_id, title, body],
    )?;
    Ok(())
}

pub fn reindex_project(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    let row = conn.query_row(
        "SELECT name, COALESCE(description,''), COALESCE(company_name,'') FROM projects WHERE id = ?1",
        params![id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
    );
    if let Ok((name, desc, company)) = row {
        upsert(conn, "project", id, &name, &format!("{desc} {company}"))?;
    }
    Ok(())
}

/// A commitment: its text, found by the company and the person involved.
pub fn reindex_commitment(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    let row = conn.query_row(
        "SELECT c.text, COALESCE(co.name,''), COALESCE(ct.name,'') FROM commitments c
         LEFT JOIN companies co ON co.id = c.company_id LEFT JOIN contacts ct ON ct.id = c.contact_id WHERE c.id = ?1",
        params![id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
    );
    if let Ok((text, company, who)) = row {
        upsert(conn, "commitment", id, &text, &format!("{company} {who}"))?;
    }
    Ok(())
}

pub fn reindex_meeting(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    let row = conn.query_row(
        "SELECT title, COALESCE(agenda,'') || ' ' || COALESCE(decisions,'') || ' ' || COALESCE(follow_up,''), COALESCE(discussion,''), COALESCE(company_name,'') FROM meetings WHERE id = ?1",
        params![id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?)),
    );
    if let Ok((title, agenda, discussion, company)) = row {
        upsert(conn, "meeting", id, &title, &format!("{agenda} {discussion} {company}"))?;
    }
    Ok(())
}

pub fn reindex_note(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    let row = conn.query_row(
        "SELECT COALESCE(title,''), COALESCE(content,'') FROM notes WHERE id = ?1",
        params![id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
    );
    if let Ok((title, content)) = row {
        // Content is Markdown text, not HTML, as of the Phase 3 rebuild — index
        // it as-is (strip_html would risk mangling a literal `<autolink>`).
        upsert(conn, "note", id, &title, &content)?;
    }
    Ok(())
}

pub fn reindex_proposal(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    let row = conn.query_row(
        "SELECT client, COALESCE(type,''), COALESCE(remarks,'') FROM proposals WHERE id = ?1",
        params![id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
    );
    if let Ok((client, ptype, remarks)) = row {
        upsert(conn, "proposal", id, &format!("{client} — {ptype}"), &remarks)?;
    }
    Ok(())
}

pub fn reindex_agreement(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    let row = conn.query_row(
        "SELECT COALESCE(agr_ref,''), COALESCE(client,''), COALESCE(remarks,'') FROM agreements WHERE id = ?1",
        params![id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
    );
    if let Ok((agr_ref, client, remarks)) = row {
        upsert(conn, "agreement", id, &format!("{agr_ref} — {client}"), &remarks)?;
    }
    Ok(())
}

pub fn reindex_todo(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    let row = conn.query_row(
        "SELECT title, COALESCE(description,'') FROM todos WHERE id = ?1",
        params![id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
    );
    if let Ok((title, desc)) = row {
        upsert(conn, "task", id, &title, &desc)?;
    }
    Ok(())
}

pub fn reindex_document(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    let row = conn.query_row(
        "SELECT title, COALESCE(doc_type,''), COALESCE(company_name,'') FROM documents WHERE id = ?1",
        params![id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
    );
    if let Ok((title, doc_type, company)) = row {
        upsert(conn, "document", id, &title, &format!("{doc_type} {company}"))?;
    }
    Ok(())
}

pub fn reindex_opportunity(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    let row = conn.query_row(
        "SELECT o.name, COALESCE(c.name,''), COALESCE(o.description,'')
         FROM opportunities o LEFT JOIN companies c ON c.id = o.company_id WHERE o.id = ?1",
        params![id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
    );
    if let Ok((name, company, desc)) = row {
        upsert(conn, "opportunity", id, &name, &format!("{company} {desc}"))?;
    }
    Ok(())
}

pub fn reindex_contact(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    let row = conn.query_row(
        "SELECT COALESCE(name,''), COALESCE(client_name,''), COALESCE(email,'') FROM contacts WHERE id = ?1",
        params![id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?)),
    );
    if let Ok((name, client, email)) = row {
        upsert(conn, "contact", id, &name, &format!("{client} {email}"))?;
    }
    Ok(())
}

pub fn reindex_intelligence(conn: &Connection, id: i64) -> rusqlite::Result<()> {
    let row = conn.query_row(
        "SELECT headline, COALESCE(summary,''), COALESCE(why_it_matters,''), COALESCE(source_name,''), COALESCE(company_name,'') FROM intelligence_items WHERE id = ?1",
        params![id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?)),
    );
    if let Ok((headline, summary, why, source, company)) = row {
        upsert(conn, "intelligence", id, &headline, &format!("{summary} {why} {source} {company}"))?;
    }
    Ok(())
}

pub fn reindex_company(conn: &Connection, name: &str) -> rusqlite::Result<()> {
    // Companies are derived (no id), so we hash-free key off the name itself by
    // storing entity_id = 0 and matching purely on title text for this one type;
    // simplest robust approach given there is no companies table.
    conn.execute("DELETE FROM search_index WHERE entity_type = 'company' AND title = ?1", params![name])?;
    conn.execute(
        "INSERT INTO search_index (entity_type, entity_id, title, body) VALUES ('company', 0, ?1, '')",
        params![name],
    )?;
    Ok(())
}

/// Extracts `[[Wiki Link]]` targets from note content (Part 13). Content is
/// stored as HTML from the rich-text editor, but a wikilink is just literal
/// bracket text inside it, so a plain substring scan (no HTML parsing needed)
/// is sufficient and avoids pulling in a full HTML parser for this one job.
pub fn extract_wikilink_titles(content: &str) -> Vec<String> {
    let mut out = Vec::new();
    let bytes: Vec<char> = content.chars().collect();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == '[' && bytes[i + 1] == '[' {
            if let Some(end_offset) = bytes[i + 2..].windows(2).position(|w| w[0] == ']' && w[1] == ']') {
                let title: String = bytes[i + 2..i + 2 + end_offset].iter().collect();
                let title = title.trim().to_string();
                if !title.is_empty() {
                    out.push(title);
                }
                i += 2 + end_offset + 2;
                continue;
            }
        }
        i += 1;
    }
    out
}

/// Extracts note ids stamped directly on wikilink anchors (`data-note-id="N"`,
/// set by `insertWikilink` in notes.ts going forward) — a plain byte-offset
/// scan, matching `extract_wikilink_titles`'s "no HTML parser needed" approach.
/// Links created before this stamping existed have no such attribute and fall
/// back to the title-based match below, so old notes keep resolving unchanged.
fn extract_stamped_note_ids(content: &str) -> Vec<i64> {
    let mut out = Vec::new();
    let marker = "data-note-id=\"";
    let mut i = 0;
    while let Some(pos) = content[i..].find(marker) {
        let start = i + pos + marker.len();
        match content[start..].find('"') {
            Some(end_rel) => {
                if let Ok(id) = content[start..start + end_rel].parse::<i64>() {
                    out.push(id);
                }
                i = start + end_rel + 1;
            }
            None => break,
        }
    }
    out
}

/// Rebuilds the entire note_links (backlink) graph from every note's content.
/// Called after every notes save — the note set is small enough that a full
/// rebuild is simpler and safer than incremental diffing.
pub fn rebuild_note_links(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM note_links", [])?;
    let mut stmt = conn.prepare("SELECT id, title, content FROM notes")?;
    let notes: Vec<(i64, String, String)> = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<String>>(1)?.unwrap_or_default(), r.get::<_, Option<String>>(2)?.unwrap_or_default())))?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);
    let title_to_id: std::collections::HashMap<String, i64> = notes
        .iter()
        .map(|(id, title, _)| (title.trim().to_lowercase(), *id))
        .collect();
    let valid_ids: std::collections::HashSet<i64> = notes.iter().map(|(id, _, _)| *id).collect();
    for (id, _title, content) in &notes {
        let mut targets: std::collections::HashSet<i64> = std::collections::HashSet::new();
        for stamped_id in extract_stamped_note_ids(content) {
            if stamped_id != *id && valid_ids.contains(&stamped_id) {
                targets.insert(stamped_id);
            }
        }
        for linked_title in extract_wikilink_titles(content) {
            if let Some(target_id) = title_to_id.get(&linked_title.trim().to_lowercase()) {
                if *target_id != *id {
                    targets.insert(*target_id);
                }
            }
        }
        for target_id in targets {
            conn.execute(
                "INSERT OR IGNORE INTO note_links (source_note_id, target_note_id) VALUES (?1, ?2)",
                params![id, target_id],
            )?;
        }
    }
    Ok(())
}

/// Full rebuild across every entity type — used at startup and after a bulk
/// import/restore (where per-row reindexing on save doesn't run).
pub fn rebuild_all(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM search_index", [])?;

    let ids: Vec<i64> = conn.prepare("SELECT id FROM proposals")?.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    for id in ids { reindex_proposal(conn, id)?; }

    let ids: Vec<i64> = conn.prepare("SELECT id FROM contacts")?.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    for id in ids { reindex_contact(conn, id)?; }

    let ids: Vec<i64> = conn.prepare("SELECT id FROM agreements")?.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    for id in ids { reindex_agreement(conn, id)?; }

    let ids: Vec<i64> = conn.prepare("SELECT id FROM todos")?.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    for id in ids { reindex_todo(conn, id)?; }

    let ids: Vec<i64> = conn.prepare("SELECT id FROM notes")?.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    for id in ids { reindex_note(conn, id)?; }

    let ids: Vec<i64> = conn.prepare("SELECT id FROM projects")?.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    for id in ids { reindex_project(conn, id)?; }

    let ids: Vec<i64> = conn.prepare("SELECT id FROM opportunities")?.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    for id in ids { reindex_opportunity(conn, id)?; }

    let ids: Vec<i64> = conn.prepare("SELECT id FROM documents")?.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    for id in ids { reindex_document(conn, id)?; }

    let ids: Vec<i64> = conn.prepare("SELECT id FROM meetings")?.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    for id in ids { reindex_meeting(conn, id)?; }

    if conn.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = 'commitments')", [], |r| r.get::<_, bool>(0))? {
        let ids: Vec<i64> = conn.prepare("SELECT id FROM commitments")?.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
        for id in ids { reindex_commitment(conn, id)?; }
    }

    let ids: Vec<i64> = conn.prepare("SELECT id FROM intelligence_items")?.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    for id in ids { reindex_intelligence(conn, id)?; }

    let names: Vec<String> = conn.prepare(
        "SELECT DISTINCT client FROM proposals
         UNION SELECT DISTINCT client_name FROM contacts WHERE client_name IS NOT NULL
         UNION SELECT DISTINCT client FROM agreements WHERE client IS NOT NULL"
    )?.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
    for name in names { reindex_company(conn, &name)?; }

    Ok(())
}
