//! Tauri commands. Each one resolves the host from the repository path and runs
//! the blocking repo operation off the UI thread.

use crate::hosts::Hosts;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use wv_core::host::{Change, DirEntry, GitHost};
use wv_core::overview::{self, Overview};
use wv_core::paths::{wsl_unc, Route};
use wv_core::preview;
use wv_core::porcelain::blame::Blame;
use wv_core::porcelain::grep::GrepResult;
use wv_core::porcelain::log::CommitSummary;
use wv_core::porcelain::refs::BranchRef;
use wv_core::porcelain::status::Status;
use wv_core::porcelain::worktree::Worktree;
use wv_core::repo_ops::{self as ops, Action, BaseDiff, BranchStatus, CommitWithFiles, Content, FileHistoryEntry, FileList, GrepQuery, HistorySearch, Source};

#[derive(Default)]
pub struct App {
    pub hosts: Hosts,
    /// The watched worktrees, all of one repository: (repo, watch ids).
    watches: Mutex<Option<(String, Vec<u64>)>>,
    /// repo id → `owner/repo` on github.com (None: origin is elsewhere).
    github_repos: Mutex<std::collections::HashMap<String, Option<String>>>,
    /// The repository roots `wvfile:` URLs may read from.
    pub previews: wv_core::preview::Roots,
    /// HTML previews the UI prepared, served at `wvfile:` `/~page/<id>`.
    pub pages: wv_core::preview::Pages,
}

pub type AppState = Arc<App>;
type Res<T> = Result<T, String>;

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Res<T> + Send + 'static) -> Res<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

macro_rules! with_host {
    ($state:expr, $repo:expr, |$h:ident| $body:expr) => {{
        let app = $state.inner().clone();
        let repo = $repo;
        blocking(move || {
            let $h = app.hosts.host(&repo)?;
            let $h: &dyn GitHost = &*$h;
            $body
        })
        .await
    }};
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    /// The path as the user added it; the key for everything else.
    pub id: String,
    pub name: String,
    /// "windows" or "wsl".
    pub kind: &'static str,
    pub distro: Option<String>,
    /// Top-level folder on the host (a Linux path for WSL repos).
    pub root: String,
}

#[tauri::command]
pub async fn open_repo(state: State<'_, AppState>, path: String) -> Res<RepoInfo> {
    let app = state.inner().clone();
    blocking(move || {
        let (host, route) = app.hosts.resolve(&path)?;
        let (host_path, kind, distro) = match route {
            Route::Local { path } => (path, "windows", None),
            Route::Wsl { distro, linux_path } => (linux_path, "wsl", Some(distro)),
        };
        let root = ops::toplevel(&*host, &host_path).map_err(|e| format!("{path} is not a git repository ({e})"))?;
        let name = root.rsplit(['/', '\\']).find(|s| !s.is_empty()).unwrap_or(&root).to_string();
        Ok(RepoInfo { id: path, name, kind, distro, root })
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeInfo {
    #[serde(flatten)]
    pub worktree: Worktree,
    /// The path as Windows shows it.
    pub display_path: String,
    /// Prunable, or its folder is gone.
    pub missing: bool,
}

#[tauri::command]
pub async fn worktrees(state: State<'_, AppState>, repo: String, cwd: String) -> Res<Vec<WorktreeInfo>> {
    let app = state.inner().clone();
    blocking(move || {
        let (host, route) = app.hosts.resolve(&repo)?;
        let list = ops::worktrees(&*host, &cwd)?;
        Ok(list
            .into_iter()
            .map(|w| {
                let missing = w.prunable.is_some() || host.mtime(&w.path).ok().flatten().is_none();
                let display_path = match &route {
                    Route::Wsl { distro, .. } => wsl_unc(distro, &w.path),
                    Route::Local { .. } => w.path.replace('/', "\\"),
                };
                WorktreeInfo { worktree: w, display_path, missing }
            })
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn branches(state: State<'_, AppState>, repo: String, cwd: String) -> Res<Vec<BranchRef>> {
    with_host!(state, repo, |h| ops::branches(h, &cwd))
}

#[tauri::command]
pub async fn status(state: State<'_, AppState>, repo: String, cwd: String) -> Res<Status> {
    with_host!(state, repo, |h| ops::status(h, &cwd))
}

/// Every worktree in `cwds` side by side, compared with `base`, and the files they both change.
#[tauri::command]
pub async fn worktrees_overview(state: State<'_, AppState>, repo: String, cwds: Vec<String>, base: Option<String>) -> Res<Overview> {
    with_host!(state, repo, |h| Ok(overview::overview(h, &cwds, base.as_deref())))
}

#[tauri::command]
pub async fn resolve_base(state: State<'_, AppState>, repo: String, cwd: String, preferred: Option<String>) -> Res<Option<String>> {
    with_host!(state, repo, |h| ops::resolve_base(h, &cwd, preferred.as_deref()))
}

#[tauri::command]
pub async fn branch_changes(state: State<'_, AppState>, repo: String, cwd: String, base: String, rev: String) -> Res<BaseDiff> {
    with_host!(state, repo, |h| ops::branch_changes(h, &cwd, &base, &rev))
}

#[tauri::command]
pub async fn log(state: State<'_, AppState>, repo: String, cwd: String, rev: String, skip: u32, limit: u32) -> Res<Vec<CommitSummary>> {
    with_host!(state, repo, |h| ops::log(h, &cwd, &rev, skip, limit))
}

#[tauri::command]
pub async fn file_history(state: State<'_, AppState>, repo: String, cwd: String, rev: String, path: String, skip: u32, limit: u32) -> Res<Vec<FileHistoryEntry>> {
    with_host!(state, repo, |h| ops::file_history(h, &cwd, &rev, &path, skip, limit))
}

#[tauri::command]
pub async fn search_log(state: State<'_, AppState>, repo: String, cwd: String, rev: String, query: String, limit: u32) -> Res<HistorySearch> {
    with_host!(state, repo, |h| ops::search_log(h, &cwd, &rev, &query, limit))
}

#[tauri::command]
pub async fn blame(state: State<'_, AppState>, repo: String, cwd: String, source: Source) -> Res<Blame> {
    with_host!(state, repo, |h| ops::blame(h, &cwd, &source))
}

#[tauri::command]
pub async fn commit(state: State<'_, AppState>, repo: String, cwd: String, sha: String) -> Res<CommitWithFiles> {
    with_host!(state, repo, |h| ops::commit(h, &cwd, &sha))
}

#[tauri::command]
pub async fn read_sources(state: State<'_, AppState>, repo: String, cwd: String, sources: Vec<Source>) -> Res<Vec<Content>> {
    with_host!(state, repo, |h| {
        // Both sides of a diff load in parallel; through the WSL helper that halves the wait.
        std::thread::scope(|s| {
            let handles: Vec<_> = sources.iter().map(|src| s.spawn(|| ops::read_source(h, &cwd, src))).collect();
            handles.into_iter().map(|t| t.join().map_err(|_| "reader panicked".to_string())?).collect()
        })
    })
}

#[tauri::command]
pub async fn list_files(state: State<'_, AppState>, repo: String, cwd: String, rev: Option<String>, ignored: bool) -> Res<FileList> {
    with_host!(state, repo, |h| ops::list_files(h, &cwd, rev.as_deref(), ignored))
}

#[tauri::command]
pub async fn list_dir(state: State<'_, AppState>, repo: String, cwd: String, rel: String) -> Res<Vec<DirEntry>> {
    with_host!(state, repo, |h| h.list_dir(&wv_core::host::join(&cwd, &rel)))
}

#[tauri::command]
pub async fn grep(state: State<'_, AppState>, repo: String, cwd: String, rev: Option<String>, query: GrepQuery) -> Res<GrepResult> {
    with_host!(state, repo, |h| ops::grep(h, &cwd, rev.as_deref(), &query))
}

#[tauri::command]
pub async fn branch_status(state: State<'_, AppState>, repo: String, cwd: String, branch: String) -> Res<BranchStatus> {
    with_host!(state, repo, |h| ops::branch_status(h, &cwd, &branch))
}

#[derive(Clone, Serialize)]
struct ProgressEvent {
    line: String,
}

/// Fetch, push or publish. Progress lines are emitted as `action-progress`.
#[tauri::command]
pub async fn run_action(app_handle: AppHandle, state: State<'_, AppState>, repo: String, cwd: String, action: Action, branch: String) -> Res<String> {
    let app = state.inner().clone();
    blocking(move || {
        let host = app.hosts.host(&repo)?;
        let emit = |line: &str| {
            let _ = app_handle.emit("action-progress", ProgressEvent { line: line.to_string() });
        };
        let out = ops::run_action(&*host, &cwd, action, &branch, Some(&emit))?;
        if out.code == 0 {
            Ok(out.stderr.trim().to_string())
        } else {
            let text = out.stderr.trim();
            Err(if text.is_empty() { format!("git exited with code {}", out.code) } else { text.to_string() })
        }
    })
    .await
}

#[derive(Clone, Serialize)]
struct ChangedEvent {
    cwd: String,
    #[serde(flatten)]
    change: Change,
}

/// Watches the worktrees of one repository, replacing whatever was watched before;
/// `worktree-changed` fires for each after debounced changes. One that cannot be watched is skipped.
#[tauri::command]
pub async fn watch(app_handle: AppHandle, state: State<'_, AppState>, repo: String, cwds: Vec<String>) -> Res<()> {
    let app = state.inner().clone();
    blocking(move || {
        if let Some((old_repo, ids)) = app.watches.lock().unwrap().take() {
            if let Ok(h) = app.hosts.host(&old_repo) {
                ids.into_iter().for_each(|id| h.unwatch(id));
            }
        }
        let host = app.hosts.host(&repo)?;
        let ids = cwds
            .into_iter()
            .filter_map(|cwd| {
                let spec = ops::watch_spec(&*host, &cwd).ok()?;
                let app_handle = app_handle.clone();
                let on_change = Arc::new(move |change| {
                    let _ = app_handle.emit("worktree-changed", ChangedEvent { cwd: cwd.clone(), change });
                });
                host.watch(spec, on_change).ok()
            })
            .collect();
        *app.watches.lock().unwrap() = Some((repo, ids));
        Ok(())
    })
    .await
}

fn settings_path(app: &AppHandle) -> Res<PathBuf> {
    // WV_CONFIG_DIR keeps a test instance from touching the real settings.
    let dir = match std::env::var_os("WV_CONFIG_DIR") {
        Some(d) => PathBuf::from(d),
        None => app.path().app_config_dir().map_err(|e| e.to_string())?,
    };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

/// The UI owns the settings shape; the backend only stores it.
#[tauri::command]
pub fn load_settings(app: AppHandle) -> Res<serde_json::Value> {
    match std::fs::read_to_string(settings_path(&app)?) {
        // Tolerate a BOM from hand edits in Notepad or PowerShell.
        Ok(s) => Ok(serde_json::from_str(s.trim_start_matches('\u{feff}')).unwrap_or(serde_json::Value::Null)),
        Err(_) => Ok(serde_json::Value::Null),
    }
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: serde_json::Value) -> Res<()> {
    let path = settings_path(&app)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(&settings).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsFile {
    path: String,
    text: Option<String>,
}

/// settings.json as stored, for the read-only settings.json tab.
#[tauri::command]
pub fn settings_file(app: AppHandle) -> Res<SettingsFile> {
    let path = settings_path(&app)?;
    let text = std::fs::read_to_string(&path).ok().map(|s| s.trim_start_matches('\u{feff}').to_string());
    Ok(SettingsFile { path: path.to_string_lossy().into_owned(), text })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Automation {
    open_diffs: Option<u32>,
    open_file: Option<String>,
    show_history: Option<String>,
    run_action: Option<String>,
    open_settings: Option<String>,
    left_tab: Option<String>,
    settings_patch: Option<serde_json::Value>,
    context_menu: Option<String>,
    file_history: Option<String>,
    blame: Option<String>,
    history_search: Option<String>,
    open_rev_file: Option<String>,
    open_commit_file: Option<String>,
    image_zoom: Option<String>,
    preview_link: Option<u32>,
    reveal: Option<String>,
    list_keys: Option<String>,
    worktrees: Option<String>,
}

/// Test hooks, so memory and screens can be checked without driving the window:
/// `WV_OPEN_DIFFS=n` opens the first n "Branch vs base" diffs, `WV_OPEN_FILE=path`
/// opens a file, `WV_SHOW_HISTORY=1` selects the newest commit in History (or
/// `WV_SHOW_HISTORY=<sha>` that commit),
/// `WV_RUN_ACTION=fetch|push|publish` presses the action button,
/// `WV_LEFT_TAB=changes|history|explorer|search` shows that pane,
/// `WV_OPEN_SETTINGS=1` opens the Settings tab (`settings.json` also opens that
/// file, any other value is typed into its search box), and `WV_SETTINGS_PATCH=<json>` changes settings after the
/// rest has run, the way the Settings page would. `WV_CONTEXT_MENU=<place>[:key]`
/// then opens a context menu (changes, commitfile, commit, explorer, folder, search,
/// quickopen, tab, repo, worktree, branch), by right-click or with `:key` by Shift+F10;
/// `>Label` then chooses that option.
/// `WV_FILE_HISTORY=path` shows that file's history and opens its newest change,
/// `WV_BLAME=1` turns on blame in file views (`click:<line>` then clicks that line's margin), and `WV_HISTORY_SEARCH=text` types
/// that into the History search box.
/// `WV_OPEN_REV_FILE=<rev>:<path>` opens a file at a revision, `WV_OPEN_COMMIT_FILE=path` opens
/// that file's diff in the commit `WV_SHOW_HISTORY` selected, `WV_IMAGE_ZOOM=in|out|fit|<scale>`
/// zooms the image view, and `WV_PREVIEW_LINK=n` follows the n-th link of an HTML preview.
/// `WV_REVEAL=path` reveals a file in Explorer as "Reveal in Explorer" does, and
/// `WV_LIST_KEYS=ArrowDown,ArrowLeft,…` then presses those keys in the left pane's list.
/// `WV_WORKTREES=1` opens the Worktrees overview (`chip:<n>` then clicks the n-th worktree of a shared
/// file, `feed:<n>` the n-th link in Activity once there is one).
#[tauri::command]
pub fn automation() -> Automation {
    Automation {
        open_diffs: std::env::var("WV_OPEN_DIFFS").ok().and_then(|v| v.parse().ok()),
        open_file: std::env::var("WV_OPEN_FILE").ok(),
        show_history: std::env::var("WV_SHOW_HISTORY").ok(),
        run_action: std::env::var("WV_RUN_ACTION").ok(),
        open_settings: std::env::var("WV_OPEN_SETTINGS").ok(),
        left_tab: std::env::var("WV_LEFT_TAB").ok(),
        settings_patch: std::env::var("WV_SETTINGS_PATCH").ok().and_then(|v| serde_json::from_str(&v).ok()),
        context_menu: std::env::var("WV_CONTEXT_MENU").ok(),
        file_history: std::env::var("WV_FILE_HISTORY").ok(),
        blame: std::env::var("WV_BLAME").ok(),
        history_search: std::env::var("WV_HISTORY_SEARCH").ok(),
        open_rev_file: std::env::var("WV_OPEN_REV_FILE").ok(),
        open_commit_file: std::env::var("WV_OPEN_COMMIT_FILE").ok(),
        image_zoom: std::env::var("WV_IMAGE_ZOOM").ok(),
        preview_link: std::env::var("WV_PREVIEW_LINK").ok().and_then(|v| v.parse().ok()),
        reveal: std::env::var("WV_REVEAL").ok(),
        list_keys: std::env::var("WV_LIST_KEYS").ok(),
        worktrees: std::env::var("WV_WORKTREES").ok(),
    }
}

/// One side of an image view: its size and the `wvfile:` URL it loads from, or why it is not shown.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ImageSource {
    Image { size: u64, url: String },
    TooLarge { size: u64 },
    Missing,
}

/// Sizes and URLs of image sources (both sides of a diff), checked side by side; nothing is read yet.
/// Each URL carries the file's version, so it changes exactly when the file does.
#[tauri::command]
pub async fn image_sources(state: State<'_, AppState>, repo: String, cwd: String, sources: Vec<Source>) -> Res<Vec<ImageSource>> {
    let app = state.inner().clone();
    blocking(move || {
        let h = app.hosts.host(&repo)?;
        let h: &dyn GitHost = &*h;
        let stats: Vec<Res<Option<ops::SourceStat>>> = std::thread::scope(|s| {
            let handles: Vec<_> = sources.iter().map(|src| s.spawn(|| ops::source_stat(h, &cwd, src))).collect();
            handles.into_iter().map(|t| t.join().map_err(|_| "reader panicked".to_string())?).collect()
        });
        // The version makes a new URL only when the file changed, so the view keeps its picture (and zoom) otherwise.
        let url = |rev: Option<&str>, path: &str, version: &str| format!("{}?v={}", preview::file_url(&app.previews.token(&repo, &cwd, rev), path), version);
        sources
            .iter()
            .zip(stats)
            .map(|(src, stat)| {
                Ok(match (stat?, src) {
                    (None, _) | (_, Source::Empty) => ImageSource::Missing,
                    (Some(st), _) if st.size > ops::MAX_IMAGE_BYTES => ImageSource::TooLarge { size: st.size },
                    (Some(st), Source::Rev { rev, path }) => ImageSource::Image { size: st.size, url: url(Some(rev), path, &st.version) },
                    (Some(st), Source::Worktree { path }) => ImageSource::Image { size: st.size, url: url(None, path, &st.version) },
                })
            })
            .collect()
    })
    .await
}

/// The `wvfile:` URL of the repository root at a revision (None: the worktree), for HTML previews.
#[tauri::command]
pub fn preview_base(state: State<'_, AppState>, repo: String, cwd: String, rev: Option<String>) -> String {
    preview::base_url(&state.previews.token(&repo, &cwd, rev.as_deref()))
}

/// Keeps a prepared HTML preview for the preview frame to load; returns its URL.
/// With `scripts`, the page may run its own scripts (still without network access).
#[tauri::command]
pub fn preview_page(state: State<'_, AppState>, html: String, scripts: bool) -> String {
    preview::page_url(&state.pages.put(html, scripts))
}

/// Forgets a prepared preview once the frame no longer shows it.
#[tauri::command]
pub fn drop_preview_page(state: State<'_, AppState>, url: String) {
    if let Some(id) = url.rsplit('/').next() {
        state.pages.remove(id);
    }
}

/// Answers a `wvfile:` request: a prepared page, a repository file under a root, or a link clicked in an
/// HTML preview (told to the UI as `preview-link`; no content, so the preview stays).
pub fn serve_preview(app_handle: &AppHandle, req: &tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::{Response, StatusCode};
    let status = |code: StatusCode| Response::builder().status(code).body(Vec::new()).unwrap();
    if req.method() != tauri::http::Method::GET {
        return status(StatusCode::METHOD_NOT_ALLOWED);
    }
    let app = app_handle.state::<AppState>().inner().clone();
    match preview::route(&app.previews, req.uri().path(), req.uri().query()) {
        preview::Request::NotFound => status(StatusCode::NOT_FOUND),
        preview::Request::Page { id } => match app.pages.get(&id) {
            Some(page) => {
                let mut r = Response::builder().status(StatusCode::OK);
                for (k, v) in preview::page_headers(page.scripts) {
                    r = r.header(k, v);
                }
                r.body(page.html.as_bytes().to_vec()).unwrap()
            }
            None => status(StatusCode::NOT_FOUND),
        },
        preview::Request::Link { query } => {
            // Only a navigation of the preview frame (a click) counts, not an image or stylesheet naming the URL.
            let dest = req.headers().get("sec-fetch-dest").and_then(|v| v.to_str().ok());
            if matches!(dest, None | Some("iframe" | "document")) {
                let _ = app_handle.emit("preview-link", query);
            }
            status(StatusCode::NO_CONTENT)
        }
        preview::Request::File { root, source } => {
            let path = match &source {
                Source::Rev { path, .. } | Source::Worktree { path } => path.clone(),
                Source::Empty => return status(StatusCode::NOT_FOUND),
            };
            let Some(mime) = preview::served_mime(&path) else { return status(StatusCode::NOT_FOUND) };
            let bytes = app.hosts.host(&root.repo).and_then(|h| ops::read_bytes_max(&*h, &root.cwd, &source, ops::MAX_IMAGE_BYTES));
            match bytes {
                Ok(Some(b)) => {
                    let mut r = Response::builder().status(StatusCode::OK);
                    for (k, v) in preview::response_headers(mime) {
                        r = r.header(k, v);
                    }
                    r.body(b).unwrap()
                }
                _ => status(StatusCode::NOT_FOUND),
            }
        }
    }
}

/// An image referenced from a Markdown file, as a data URL (None if missing or too large).
#[tauri::command]
pub async fn read_image(state: State<'_, AppState>, repo: String, cwd: String, source: Source) -> Res<Option<String>> {
    with_host!(state, repo, |h| {
        let path = match &source {
            Source::Rev { path, .. } | Source::Worktree { path } => path.to_lowercase(),
            Source::Empty => return Ok(None),
        };
        let mime = match path.rsplit('.').next().unwrap_or("") {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "svg" => "image/svg+xml",
            "ico" => "image/x-icon",
            "bmp" => "image/bmp",
            "avif" => "image/avif",
            _ => return Ok(None),
        };
        use base64::Engine;
        Ok(ops::read_bytes(h, &cwd, &source)?
            .map(|b| format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(b))))
    })
}

/// A GitHub token for avatar lookups: GH_TOKEN / GITHUB_TOKEN, else `gh auth token`
/// (the GitHub CLI's login). Read once per run; never stored.
fn github_token() -> Option<String> {
    static TOKEN: std::sync::OnceLock<Option<String>> = std::sync::OnceLock::new();
    TOKEN
        .get_or_init(|| {
            for var in ["GH_TOKEN", "GITHUB_TOKEN"] {
                if let Some(t) = std::env::var(var).ok().filter(|t| !t.trim().is_empty()) {
                    return Some(t.trim().to_string());
                }
            }
            for gh in ["gh", r"C:\Program Files\GitHub CLI\gh.exe"] {
                let mut cmd = std::process::Command::new(gh);
                cmd.args(["auth", "token"]).stdin(std::process::Stdio::null());
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
                }
                if let Ok(out) = cmd.output() {
                    let t = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    return (out.status.success() && !t.is_empty()).then_some(t);
                }
            }
            None
        })
        .clone()
}

/// `owner/repo` when the repository's origin is on github.com; looked up once per repository.
fn github_repo_of(app: &App, repo: String, cwd: &str) -> Res<Option<String>> {
    if let Some(r) = app.github_repos.lock().unwrap().get(&repo).cloned() {
        return Ok(r);
    }
    // `git remote -v` is a read on the allowlist, on Windows or through the WSL helper.
    let h = app.hosts.host(&repo)?;
    let out = h.git(cwd, &["remote".to_string(), "-v".to_string()], None)?.ok()?;
    let r = crate::avatar::github_repo(&String::from_utf8_lossy(&out));
    app.github_repos.lock().unwrap().insert(repo, r.clone());
    Ok(r)
}

/// Puts text on the clipboard, for the context menus' copy options. Done here rather
/// than with the web clipboard API, which needs the window to have focus.
#[tauri::command]
pub async fn copy_text(text: String) -> Res<()> {
    blocking(move || arboard::Clipboard::new().and_then(|mut c| c.set_text(text)).map_err(|e| e.to_string())).await
}

/// For "Open on GitHub": the repository's `owner/repo` on github.com, or None.
#[tauri::command]
pub async fn github_repo(state: State<'_, AppState>, repo: String, cwd: String) -> Res<Option<String>> {
    let app = state.inner().clone();
    blocking(move || github_repo_of(&app, repo, &cwd)).await
}

/// The commit author's picture as a data URL (None: no picture, use initials).
/// With the repository and a commit, GitHub is asked whose commit it is.
/// Cached under the app's cache folder (or WV_CONFIG_DIR\avatars for test instances).
#[tauri::command]
pub async fn avatar(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    email: String,
    size: u32,
    repo: Option<String>,
    cwd: Option<String>,
    sha: Option<String>,
) -> Res<Option<String>> {
    let dir = match std::env::var_os("WV_CONFIG_DIR") {
        Some(d) => PathBuf::from(d),
        None => app_handle.path().app_cache_dir().map_err(|e| e.to_string())?,
    }
    .join("avatars");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let github = match (repo, cwd) {
        (Some(repo), Some(cwd)) => {
            let app = state.inner().clone();
            blocking(move || {
                let gh_repo = github_repo_of(&app, repo, &cwd)?;
                Ok(gh_repo.and_then(|repo| github_token().map(|token| crate::avatar::GithubLookup { repo, sha, token })))
            })
            .await
            .unwrap_or(None)
        }
        _ => None,
    };
    Ok(crate::avatar::get(&dir, &email, size.clamp(16, 256), github).await)
}
