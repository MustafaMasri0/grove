//! Git and files on the machine this process runs on: the user's for the app,
//! the one holding the repository for the helper.

use crate::exec::run_git;
use crate::editable;
use crate::host::{DirEntry, FileRead, GitHost, GitOutput, OnChange, Progress, WatchSpec, WriteOutcome};
use crate::overview::{self, Overview};
use crate::watch::WorktreeWatcher;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

#[derive(Default)]
pub struct LocalHost {
    next_watch: AtomicU64,
    watches: Mutex<HashMap<u64, WorktreeWatcher>>,
}

impl LocalHost {
    pub fn new() -> Self {
        Self::default()
    }
}

impl GitHost for LocalHost {
    fn git(&self, cwd: &str, args: &[String], progress: Option<Progress>) -> Result<GitOutput, String> {
        run_git(cwd, args, progress)
    }

    fn read_file(&self, path: &str, max: u64) -> Result<FileRead, String> {
        let mut f = std::fs::File::open(path).map_err(|e| format!("{path}: {e}"))?;
        let size = f.metadata().map_err(|e| e.to_string())?.len();
        if size > max {
            return Ok(FileRead { size, data: None });
        }
        let mut data = Vec::with_capacity(size as usize);
        f.read_to_end(&mut data).map_err(|e| format!("{path}: {e}"))?;
        Ok(FileRead { size, data: Some(data) })
    }

    fn check_writable(&self, root: &str, rel: &str) -> Result<(), String> {
        writable_path(root, rel).map(|_| ())
    }

    fn write_file(&self, root: &str, rel: &str, data: &[u8], expected: &[u8]) -> Result<WriteOutcome, String> {
        let file = writable_path(root, rel)?;
        if std::fs::read(&file).map_err(|e| format!("{rel}: {e}"))? != expected {
            return Ok(WriteOutcome::ChangedOnDisk);
        }
        overwrite(&file, data).map_err(|e| format!("could not save {rel}: {e}"))?;
        Ok(WriteOutcome::Written)
    }

    fn list_dir(&self, path: &str) -> Result<Vec<DirEntry>, String> {
        let rd = std::fs::read_dir(path).map_err(|e| format!("{path}: {e}"))?;
        Ok(rd
            .filter_map(Result::ok)
            .map(|e| DirEntry {
                name: e.file_name().to_string_lossy().into_owned(),
                is_dir: e.file_type().map(|t| t.is_dir()).unwrap_or(false),
            })
            .collect())
    }

    fn mtime(&self, path: &str) -> Result<Option<i64>, String> {
        match std::fs::metadata(path) {
            Ok(m) => Ok(m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(format!("{path}: {e}")),
        }
    }

    fn watch(&self, spec: WatchSpec, on_change: OnChange) -> Result<u64, String> {
        let watcher = WorktreeWatcher::start(spec, on_change)?;
        let id = self.next_watch.fetch_add(1, Ordering::Relaxed) + 1;
        self.watches.lock().unwrap().insert(id, watcher);
        Ok(id)
    }

    fn unwatch(&self, id: u64) {
        self.watches.lock().unwrap().remove(&id);
    }

    fn overview(&self, cwds: &[String], base: Option<&str>, find_overlaps: bool) -> Result<Overview, String> {
        Ok(overview::overview(self, cwds, base, find_overlaps))
    }
}

/// The worktree file `rel` under `root`, when Grove may write it: a regular file no protected name
/// covers, reached without passing through a link (a linked folder or file could lead anywhere, and
/// writing through it would change a file outside the worktree).
fn writable_path(root: &str, rel: &str) -> Result<PathBuf, String> {
    editable::inside_worktree(rel)?;
    if let Some(why) = editable::protected(rel).or_else(|| editable::protected(root)) {
        return Err(why);
    }
    let mut path = PathBuf::from(root);
    let parts: Vec<&str> = rel.split('/').collect();
    for (i, part) in parts.iter().enumerate() {
        path.push(part);
        let kind = std::fs::symlink_metadata(&path).map_err(|e| format!("{rel}: {e}"))?.file_type();
        if kind.is_symlink() {
            return Err(format!("{rel} is reached through a link, and links are never edited"));
        }
        if i + 1 == parts.len() && !kind.is_file() {
            return Err(format!("{rel} is not a regular file; folders are never edited"));
        }
    }
    Ok(path)
}

/// Writes `data` into the file itself rather than a replacement copy, so it keeps its owner, group,
/// ACLs and hard links: a new file would take the folder's defaults, which can widen who reads a secret.
fn overwrite(file: &Path, data: &[u8]) -> std::io::Result<()> {
    let mut f = std::fs::OpenOptions::new().write(true).open(file)?;
    f.write_all(data)?;
    f.set_len(data.len() as u64)?;
    f.sync_all()
}
