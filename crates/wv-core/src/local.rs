//! Git and files on the machine this process runs on: the user's for the app,
//! the one holding the repository for the helper.

use crate::exec::run_git;
use crate::editable;
use crate::host::{DirEntry, FileRead, GitHost, GitOutput, OnChange, Progress, WatchSpec, WriteOutcome};
use crate::overview::{self, Overview};
use crate::watch::WorktreeWatcher;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
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

    fn write_file(&self, path: &str, data: &[u8], expected: &[u8]) -> Result<WriteOutcome, String> {
        if let Some(why) = editable::protected(path) {
            return Err(why);
        }
        let file = Path::new(path);
        let meta = std::fs::symlink_metadata(file).map_err(|e| format!("{path}: {e}"))?;
        if !meta.file_type().is_file() {
            // A link could point anywhere, and replacing it would turn it into a file.
            return Err(format!("{path} is not a regular file; links and folders are never edited"));
        }
        if std::fs::read(file).map_err(|e| format!("{path}: {e}"))? != expected {
            return Ok(WriteOutcome::ChangedOnDisk);
        }
        replace_file(file, data, meta.permissions()).map_err(|e| format!("could not save {path}: {e}"))?;
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

/// Writes a new copy next to `file` and moves it over the original, so a crash or a full
/// disk leaves the old file whole. The copy is private until it has the original's permissions.
fn replace_file(file: &Path, data: &[u8], permissions: std::fs::Permissions) -> std::io::Result<()> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let name = file.file_name().ok_or(std::io::ErrorKind::InvalidInput)?.to_string_lossy();
    let tmp = file.with_file_name(format!(".{name}.grove-{}-{}.tmp", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let written = (|| {
        let mut f = options.open(&tmp)?;
        f.write_all(data)?;
        f.sync_all()?;
        drop(f);
        std::fs::set_permissions(&tmp, permissions)?;
        std::fs::rename(&tmp, file)
    })();
    if written.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    written
}
