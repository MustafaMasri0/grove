//! Debounced change notifications for one worktree.
//!
//! On Linux (inside the WSL helper) a recursive inotify watch would descend
//! into node_modules and friends, so folders are walked by hand and skipped
//! folders never get a watch. On Windows one recursive watch is cheap, so
//! events are filtered instead.

use crate::host::{Change, OnChange, WatchSpec};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const SKIP_NAMES: &[&str] = &["node_modules", "dist", ".turbo"];
const QUIET: Duration = Duration::from_millis(250);
/// A burst reports at most this many changed paths (a checkout or build can touch thousands).
const MAX_PATHS: usize = 200;
const MAX_DELAY: Duration = Duration::from_millis(1500);

pub struct WorktreeWatcher {
    stop: Arc<AtomicBool>,
}

impl Drop for WorktreeWatcher {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

struct Filter {
    exclude: Vec<PathBuf>,
    git_dirs: Vec<PathBuf>,
}

impl Filter {
    /// Git's own state rather than a file of the worktree.
    fn in_git_dir(&self, path: &Path) -> bool {
        self.git_dirs.iter().any(|g| path.starts_with(g)) || path.components().any(|c| c.as_os_str() == ".git")
    }

    fn skip_dir(&self, path: &Path) -> bool {
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        SKIP_NAMES.contains(&name) || name == ".git" || self.exclude.iter().any(|e| path.starts_with(e))
    }

    fn relevant(&self, path: &Path) -> bool {
        let mut after_git = false;
        for c in path.components() {
            let c = c.as_os_str().to_str().unwrap_or("");
            if SKIP_NAMES.contains(&c) || (after_git && (c == "objects" || c == "logs")) {
                return false;
            }
            after_git = c == ".git" || (after_git && c == "worktrees");
        }
        !self.exclude.iter().any(|e| path.starts_with(e))
    }
}

impl WorktreeWatcher {
    pub fn start(spec: WatchSpec, on_change: OnChange) -> Result<Self, String> {
        let (tx, rx) = channel();
        let watcher = notify::recommended_watcher(move |res| {
            let _ = tx.send(res);
        })
        .map_err(|e| format!("cannot watch {}: {e}", spec.root))?;
        let watcher = Arc::new(Mutex::new(watcher));
        let filter = Arc::new(Filter {
            exclude: spec.exclude.iter().map(PathBuf::from).collect(),
            git_dirs: spec.git_dirs.iter().map(PathBuf::from).collect(),
        });
        let manual = cfg!(target_os = "linux");

        {
            let mut w = watcher.lock().unwrap();
            let root = Path::new(&spec.root);
            if manual {
                add_tree(&mut w, root, &filter);
            } else {
                w.watch(root, RecursiveMode::Recursive).map_err(|e| format!("cannot watch {}: {e}", spec.root))?;
            }
            for g in &spec.git_dirs {
                let g = Path::new(g);
                let _ = w.watch(g, RecursiveMode::NonRecursive);
                let refs = g.join("refs");
                if refs.is_dir() {
                    if manual {
                        add_tree(&mut w, &refs, &Filter { exclude: vec![], git_dirs: vec![] });
                    } else {
                        let _ = w.watch(&refs, RecursiveMode::Recursive);
                    }
                }
            }
        }

        let stop = Arc::new(AtomicBool::new(false));
        let stop_thread = stop.clone();
        let root = PathBuf::from(&spec.root);
        std::thread::spawn(move || {
            let mut first: Option<Instant> = None;
            let mut last = Instant::now();
            let mut change = Change::default();
            while !stop_thread.load(Ordering::SeqCst) {
                match rx.recv_timeout(Duration::from_millis(50)) {
                    Ok(Ok(event)) => {
                        if matches!(event.kind, EventKind::Access(_)) {
                            continue;
                        }
                        if manual && matches!(event.kind, EventKind::Create(_)) {
                            let mut w = watcher.lock().unwrap();
                            for p in event.paths.iter().filter(|p| p.is_dir() && !filter.skip_dir(p)) {
                                add_tree(&mut w, p, &filter);
                            }
                        }
                        let relevant: Vec<_> = event.paths.iter().filter(|p| filter.relevant(p)).collect();
                        if !relevant.is_empty() {
                            for p in relevant.iter().filter(|p| !filter.in_git_dir(p)) {
                                change.files = true;
                                if let Some(rel) = relative(&root, p).filter(|_| change.paths.len() < MAX_PATHS) {
                                    if !change.paths.contains(&rel) {
                                        change.paths.push(rel);
                                    }
                                }
                            }
                            first.get_or_insert_with(Instant::now);
                            last = Instant::now();
                        }
                    }
                    Ok(Err(_)) | Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                }
                if let Some(f) = first {
                    if last.elapsed() >= QUIET || f.elapsed() >= MAX_DELAY {
                        first = None;
                        on_change(std::mem::take(&mut change));
                    }
                }
            }
            drop(watcher);
        });
        Ok(Self { stop })
    }
}

/// `path` relative to the worktree `root`, with `/` separators; None outside it.
fn relative(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let parts: Vec<_> = rel.components().map(|c| c.as_os_str().to_string_lossy()).collect();
    (!parts.is_empty()).then(|| parts.join("/"))
}

fn add_tree(w: &mut RecommendedWatcher, dir: &Path, filter: &Filter) {
    if w.watch(dir, RecursiveMode::NonRecursive).is_err() {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.filter_map(Result::ok) {
        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let p = e.path();
        if is_dir && !filter.skip_dir(&p) {
            add_tree(w, &p, filter);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relevance() {
        let f = Filter { exclude: vec![PathBuf::from("/r/.claude/worktrees")], git_dirs: vec![] };
        assert!(f.relevant(Path::new("/r/src/a.ts")));
        assert!(f.relevant(Path::new("/r/.git/index")));
        assert!(f.relevant(Path::new("/r/.git/refs/heads/main")));
        assert!(f.relevant(Path::new("/r/.git/worktrees/x/HEAD")));
        assert!(!f.relevant(Path::new("/r/.git/objects/ab/cdef")));
        assert!(!f.relevant(Path::new("/r/.git/logs/HEAD")));
        assert!(!f.relevant(Path::new("/r/app/node_modules/x/y.js")));
        assert!(!f.relevant(Path::new("/r/app/dist/main.js")));
        assert!(!f.relevant(Path::new("/r/.turbo/cache")));
        assert!(!f.relevant(Path::new("/r/.claude/worktrees/wt-1/a.ts")));
        // A file merely named like a skipped folder is still relevant.
        assert!(f.relevant(Path::new("/r/src/objects/a.ts")));
    }

    #[test]
    fn paths_are_relative_to_the_worktree() {
        assert_eq!(relative(Path::new("/r"), Path::new("/r/src/a.ts")).as_deref(), Some("src/a.ts"));
        assert_eq!(relative(Path::new("/r"), Path::new("/other/a.ts")), None);
        assert_eq!(relative(Path::new("/r"), Path::new("/r")), None);
    }

    #[test]
    fn git_state_is_told_apart_from_worktree_files() {
        let f = Filter { exclude: vec![], git_dirs: vec![PathBuf::from("/r/.git/worktrees/wt"), PathBuf::from("/r/.git")] };
        assert!(f.in_git_dir(Path::new("/r/.git/refs/heads/main")));
        assert!(f.in_git_dir(Path::new("/r/.git/worktrees/wt/index")));
        // The main worktree's .git sits inside its root.
        assert!(f.in_git_dir(Path::new("/wt/.git")));
        assert!(!f.in_git_dir(Path::new("/r/src/a.ts")));
        assert!(!f.in_git_dir(Path::new("/r/src/.gitignore")));
    }
}
