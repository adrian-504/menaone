pub mod activity;
pub mod attachments;
pub mod backups;
pub mod commands;
pub mod commercial;
pub mod commitments;
pub mod company_migration;
pub mod db;
pub mod insights;
pub mod integrity;
pub mod intel;
pub mod lists;
pub mod localfiles;
pub mod models;
pub mod ms365;
pub mod opportunities;
pub mod pptx;
pub mod pptx_import;
pub mod proposal_library;
pub mod smartfill;
pub mod pricing;
pub mod feefill;
pub mod master;
pub mod generator;
pub mod identity;
pub mod meeting_text;
pub mod v2_commands;
pub mod v2_models;
pub mod v2_search;
pub mod weather;

use db::DbState;
use ms365::models::Ms365State;
use std::sync::Mutex;
use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{Emitter, Manager};

/// Opens the bundled USER_GUIDE.md with the user's default app for it (a
/// plain markdown/text file). Done from the Rust side rather than the
/// frontend opener API, which sidesteps configuring a file:// scope just for
/// this one menu item.
#[tauri::command]
fn open_user_guide(app: tauri::AppHandle) -> Result<(), String> {
    // tauri.conf.json declares this resource as "../USER_GUIDE.md" (the file
    // lives at the repo root, one level above src-tauri) — Tauri's bundler
    // nests any resource path that escapes src-tauri via `../` under an
    // `_up_/` folder inside the bundle's Resources dir, so that's where it
    // actually lands (confirmed by inspecting the built .app).
    let path = app
        .path()
        .resolve("_up_/USER_GUIDE.md", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| e.to_string())
}

/// Native macOS menu bar (File/Edit/View/Window/Help + the app menu). Custom
/// items emit a `menu-action` event with the item's id as payload; main.ts
/// listens for it and routes to the already-exposed frontend functions
/// (openTodoModal, createNewNote, etc.) — the menu is a second entry point
/// into existing behavior, not a new implementation of it. Edit's items are
/// all Tauri predefined items, which is what gives text fields real native
/// Cut/Copy/Paste/Select All behavior (without a menu, some of these are
/// flaky in a bare Tauri webview).
fn build_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let new_task = MenuItemBuilder::with_id("new_task", "New Task").accelerator("CmdOrCtrl+T").build(app)?;
    let new_note = MenuItemBuilder::with_id("new_note", "New Note").accelerator("CmdOrCtrl+N").build(app)?;
    let new_proposal = MenuItemBuilder::with_id("new_proposal", "New Proposal").build(app)?;

    let app_menu = SubmenuBuilder::new(app, "MENA One")
        .item(&PredefinedMenuItem::about(app, None, None)?)
        .separator();
    #[cfg(target_os = "macos")]
    let app_menu = app_menu
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator();
    let app_menu = app_menu.item(&PredefinedMenuItem::quit(app, None)?).build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&new_task)
        .item(&new_note)
        .item(&new_proposal)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    let toggle_sidebar = MenuItemBuilder::with_id("toggle_sidebar", "Toggle Sidebar").accelerator("CmdOrCtrl+\\").build(app)?;
    let cmd_palette = MenuItemBuilder::with_id("command_palette", "Search & Commands").accelerator("CmdOrCtrl+K").build(app)?;
    // Same theme ids as THEMES in src/core/theme.ts — the "theme_" prefix is
    // stripped and passed straight to setTheme() in src/main.ts's menu-action
    // listener, so this list only needs to be kept in sync by id/label, no
    // other wiring.
    let theme_light = MenuItemBuilder::with_id("theme_light", "Light").build(app)?;
    let theme_dark = MenuItemBuilder::with_id("theme_dark", "Dark").build(app)?;
    let theme_auto = MenuItemBuilder::with_id("theme_auto", "Auto").build(app)?;
    let theme_graphite = MenuItemBuilder::with_id("theme_graphite", "Graphite").build(app)?;
    let theme_menu = SubmenuBuilder::new(app, "Theme")
        .item(&theme_light)
        .item(&theme_dark)
        .item(&theme_auto)
        .item(&theme_graphite)
        .build()?;
    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&toggle_sidebar)
        .item(&cmd_palette)
        .separator()
        .item(&theme_menu)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    // Same 15 destinations, same order, as quickActions()'s "Navigate" group
    // in src/core/commandPalette.ts — reusing that exact list so the native
    // menu and the command palette never drift apart. First 9 get number
    // accelerators (standard macOS tab-switching convention); the rest are
    // menu-only, still fully discoverable, just not number-bound.
    let goto_myday = MenuItemBuilder::with_id("goto_myday", "My Day").accelerator("CmdOrCtrl+1").build(app)?;
    let goto_dashboard = MenuItemBuilder::with_id("goto_dashboard", "Dashboard").build(app)?;
    let goto_cleanup = MenuItemBuilder::with_id("goto_cleanup", "Clean-up").build(app)?;
    let goto_todo = MenuItemBuilder::with_id("goto_todo", "Tasks").accelerator("CmdOrCtrl+2").build(app)?;
    let goto_opportunities = MenuItemBuilder::with_id("goto_opportunities", "Opportunities").accelerator("CmdOrCtrl+3").build(app)?;
    let goto_projects = MenuItemBuilder::with_id("goto_projects", "Projects").accelerator("CmdOrCtrl+4").build(app)?;
    let goto_pending = MenuItemBuilder::with_id("goto_pending", "Pending").accelerator("CmdOrCtrl+5").build(app)?;
    let goto_notes = MenuItemBuilder::with_id("goto_notes", "Notes").accelerator("CmdOrCtrl+6").build(app)?;
    let goto_companies = MenuItemBuilder::with_id("goto_companies", "Companies").accelerator("CmdOrCtrl+7").build(app)?;
    let goto_contacts = MenuItemBuilder::with_id("goto_contacts", "Contacts").accelerator("CmdOrCtrl+8").build(app)?;
    let goto_followup = MenuItemBuilder::with_id("goto_followup", "Follow-Up").accelerator("CmdOrCtrl+9").build(app)?;
    let goto_database = MenuItemBuilder::with_id("goto_database", "Proposals").build(app)?;
    let goto_agreements = MenuItemBuilder::with_id("goto_agreements", "Agreements").build(app)?;
    let goto_pricing = MenuItemBuilder::with_id("goto_pricing", "Pricing").build(app)?;
    let goto_files = MenuItemBuilder::with_id("goto_files", "Files").build(app)?;
    let goto_reports = MenuItemBuilder::with_id("goto_reports", "Reports").build(app)?;
    let goto_analytics = MenuItemBuilder::with_id("goto_analytics", "Analytics").build(app)?;
    let navigate_menu = SubmenuBuilder::new(app, "Navigate")
        .items(&[
            &goto_myday, &goto_todo, &goto_opportunities, &goto_projects, &goto_pending,
            &goto_notes, &goto_companies, &goto_contacts, &goto_followup,
        ])
        .separator()
        .items(&[&goto_cleanup, &goto_database, &goto_agreements, &goto_pricing, &goto_files])
        .separator()
        .items(&[&goto_dashboard, &goto_reports, &goto_analytics])
        .build()?;

    let user_guide = MenuItemBuilder::with_id("help_user_guide", "User Guide").build(app)?;
    let shortcuts = MenuItemBuilder::with_id("help_shortcuts", "Keyboard Shortcuts").accelerator("CmdOrCtrl+/").build(app)?;
    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&shortcuts)
        .item(&user_guide)
        .build()?;

    MenuBuilder::new(app)
        .items(&[&app_menu, &file_menu, &edit_menu, &view_menu, &navigate_menu, &window_menu, &help_menu])
        .build()
}

/// Shows what went wrong before the app has a window, then quits.
fn startup_failure(message: &str, detail: &str) -> ! {
    eprintln!("[startup] {message}\n{detail}");
    rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Error)
        .set_title("MENA One can't start")
        .set_description(format!("{message}\n\n{detail}"))
        .set_buttons(rfd::MessageButtons::Ok)
        .show();
    std::process::exit(1);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data directory");
            let db_file = db::db_path(&app_data_dir);
            let backups_dir = backups::backups_dir(&app_data_dir);
            if let Err(e) = backups::backup_before_migrations(&db_file, &backups_dir) {
                // Refuse to migrate a database we couldn't copy first.
                startup_failure(
                    "MENA One couldn't back up your data before updating it, so it stopped without changing anything.",
                    &format!("{e}\n\nYour data is at:\n{}", db_file.display()),
                );
            }
            let conn = match db::init_connection(&db_file) {
                Ok(conn) => conn,
                Err(e) => startup_failure(
                    "MENA One couldn't open or update your data. Nothing from this update was applied.",
                    &format!("{e}\n\nYour data is at:\n{}\nBackups are in:\n{}", db_file.display(), backups_dir.display()),
                ),
            };
            if let Err(e) = backups::ensure_daily_backup(&conn, &backups_dir, backups::DAILY_KEEP) {
                eprintln!("[backups] daily snapshot failed: {e}");
            }
            // The FTS index and note-link graph are derived data — rebuild them once at
            // startup so they're guaranteed consistent even after a manual DB edit, a
            // restore, or an upgrade from a V1 database that never populated them.
            let _ = v2_search::rebuild_all(&conn);
            let _ = v2_search::rebuild_note_links(&conn);
            app.manage(DbState(Mutex::new(conn)));
            backups::spawn_daily_backup_loop(app.handle().clone(), backups_dir);
            app.manage(Ms365State::default());

            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                let _ = app.emit("menu-action", event.id().as_ref());
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_all_data,
            commands::upsert_proposals,
            commands::delete_proposals,
            commands::upsert_contacts,
            commands::delete_contacts,
            commands::upsert_agreements,
            commands::delete_agreements,
            commands::sync_agreements_from_proposals,
            commercial::pending_agreements_from_proposals,
            insights::get_pipeline_facts,
            generator::templates_list,
            generator::template_inspect,
            generator::template_detail,
            generator::template_save,
            generator::template_delete,
            generator::template_tokens,
            generator::proposal_generate,
            generator::proposal_library,
            commercial::get_commercial_setup,
            commercial::save_service,
            commercial::merge_services,
            commercial::service_usage,
            commercial::save_rate_card,
            commercial::save_business_entity,
            commercial::save_team_member,
            commercial::delete_team_member,
            commercial::set_fx_rate,
            commercial::proposal_folder_lookup,
            commercial::proposal_folder_create,
            commercial::set_proposals_root,
            commands::upsert_todos,
            commitments::get_commitments,
            commitments::commitments_add,
            commitments::upsert_commitments,
            commitments::delete_commitments,
            commands::delete_todos,
            commands::upsert_notes,
            commands::delete_notes,
            commands::save_note_folders,
            commands::save_contact_lists,
            commands::save_company_note,
            commands::export_backup_json,
            activity::get_activity,
            ms365::commands::ms365_get_emails_by_address,
            activity::rename_company,
            activity::company_note_entries,
            activity::add_company_note_entry,
            activity::update_company_note_entry,
            activity::delete_company_note_entry,
            activity::move_company_note_entries,
            backups::list_local_backups,
            backups::backup_database_now,
            backups::reveal_backups_folder,
            commands::import_backup_json,
            commands::import_legacy_backup_json,
            commands::save_text_file_dialog,
            commands::wipe_all_data,
            commands::get_app_meta,
            commands::set_app_meta,
            open_user_guide,
            v2_commands::get_areas,
            v2_commands::save_area,
            v2_commands::delete_area,
            v2_commands::get_projects,
            v2_commands::get_project,
            v2_commands::save_project,
            v2_commands::delete_project,
            v2_commands::get_project_activity,
            v2_commands::get_milestones,
            v2_commands::save_milestones,
            v2_commands::get_meetings,
            v2_commands::save_meeting,
            v2_commands::delete_meeting,
            v2_commands::get_documents,
            v2_commands::save_document,
            v2_commands::delete_document,
            v2_commands::get_links_for,
            v2_commands::set_links_from,
            v2_commands::get_all_tags,
            v2_commands::set_tags,
            v2_commands::get_note_templates,
            v2_commands::save_note_template,
            v2_commands::update_note_template,
            v2_commands::delete_note_template,
            v2_commands::get_inbox_items,
            v2_commands::add_inbox_item,
            v2_commands::resolve_inbox_item,
            v2_commands::delete_inbox_item,
            v2_commands::search_workspace,
            v2_commands::get_note_backlinks,
            v2_commands::rebuild_search_index,
            ms365::commands::ms365_get_client_id,
            ms365::commands::ms365_set_client_id,
            ms365::commands::ms365_get_tenant_id,
            ms365::commands::ms365_set_tenant_id,
            ms365::commands::ms365_status,
            ms365::commands::ms365_connect,
            ms365::commands::ms365_disconnect,
            identity::identity_current_user,
            weather::weather_now,
            ms365::commands::ms365_sync_flagged_emails,
            ms365::commands::ms365_get_cached_emails,
            ms365::commands::ms365_get_emails_by_ids,
            ms365::commands::ms365_get_emails_by_company,
            ms365::commands::ms365_get_completed_emails,
            ms365::commands::ms365_update_email_flag,
            ms365::commands::ms365_reflag_email,
            ms365::commands::ms365_set_email_company,
            ms365::commands::ms365_open_email,
            ms365::commands::ms365_sync_calendar,
            ms365::commands::ms365_create_teams_meeting,
            ms365::commands::ms365_update_outlook_meeting,
            ms365::commands::ms365_cancel_outlook_meeting,
            localfiles::files_list_roots,
            localfiles::files_list_folder,
            localfiles::files_open,
            localfiles::files_reveal_in_finder,
            localfiles::files_get_or_create_msfile,
            localfiles::files_get_by_ids,
            localfiles::files_resolve_company_id,
            localfiles::files_list_linked,
            localfiles::files_stat_paths,
            intel::get_intelligence_items,
            intel::save_intelligence_item,
            intel::delete_intelligence_item,
            intel::set_intelligence_saved,
            intel::set_intelligence_archived,
            intel::sync_intelligence_feeds,
            intel::intelligence_feed_status,
            attachments::save_attachment,
            attachments::get_attachment_data_url,
            attachments::delete_attachment,
            opportunities::get_companies,
            opportunities::create_company,
            opportunities::save_company,
            company_migration::get_industry_taxonomy,
            company_migration::run_company_migration,
            company_migration::get_review_queue,
            company_migration::resolve_review_queue_entry,
            opportunities::merge_company_links,
            integrity::get_integrity_report,
            lists::get_saved_lists,
            lists::save_saved_list,
            lists::delete_saved_list,
            lists::set_saved_list_companies,
            opportunities::get_opportunities,
            opportunities::save_opportunity,
            opportunities::delete_opportunity,
            opportunities::get_opportunity_activity,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
