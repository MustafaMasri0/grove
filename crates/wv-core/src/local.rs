//! Git and files on the machine this process runs on: Windows for the app,
//! Linux for the WSL helper.

use crate::exec::run_git;
use crate::host::{DirEntry, FileRead, GitHost, GitOutput, OnChange, Progress, WatchSpec};
use crate::watch::WorktreeWatcher;
use std::collections::HashMap;
use std::io::Read;
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
}
