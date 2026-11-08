#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod avatar;
mod commands;
mod github;
mod hosts;
mod issues;
mod remote;
mod terminal;

use tauri::{Emitter, Manager};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(commands::AppState::default())
        // Image views and HTML previews load repository files from http://wvfile.localhost/.
        .register_asynchronous_uri_scheme_protocol(wv_core::preview::SCHEME, |ctx, req, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || responder.respond(commands::serve_preview(&app, &req)));
        })
        .setup(|app| {
            let handle = app.handle().clone();
            app.state::<commands::AppState>().hosts.on_lost(move |name| {
                let _ = handle.emit("connection-lost", name);
            });
            // Lets test and measurement instances be told apart from the real one.
            if let (Ok(title), Some(w)) = (std::env::var("WV_TITLE"), app.get_webview_window("main")) {
                let _ = w.set_title(&title);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_repo,
            commands::clone_repo,
            commands::worktrees,
            commands::branches,
            commands::status,
            commands::worktrees_overview,
            commands::resolve_base,
            commands::branch_changes,
            commands::log,
            commands::commit,
            commands::file_history,
            commands::search_log,
            commands::blame,
            commands::read_sources,
            commands::file_access,
            commands::save_file,
            commands::list_files,
            commands::list_dir,
            commands::grep,
            commands::branch_status,
            commands::run_action,
            commands::watch,
            commands::load_settings,
            commands::save_settings,
            commands::settings_file,
            commands::automation,
            commands::read_image,
            commands::image_sources,
            commands::preview_base,
            commands::preview_page,
            commands::drop_preview_page,
            commands::avatar,
            commands::github_repo,
            commands::issue_tracker,
            commands::issues,
            commands::issue,
            commands::issue_logins,
            commands::copy_text,
            terminal::open_terminal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Grove");
}
