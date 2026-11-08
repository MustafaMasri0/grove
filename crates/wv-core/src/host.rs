//! One interface over "run git / read files / watch" so the UI never knows
//! whether a repository lives here, in a WSL distro or on an SSH host.

use crate::overview::Overview;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitOutput {
    pub code: i32,
    #[serde(with = "b64")]
    pub stdout: Vec<u8>,
    pub stderr: String,
}

impl GitOutput {
    /// stdout when git succeeded, otherwise git's own error text.
    pub fn ok(self) -> Result<Vec<u8>, String> {
        if self.code == 0 {
            Ok(self.stdout)
        } else {
            Err(self.stderr.trim().to_string())
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRead {
    pub size: u64,
    /// None when the file is larger than the requested maximum.
    #[serde(with = "b64_opt")]
    pub data: Option<Vec<u8>>,
}

/// What [`GitHost::write_file`] did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WriteOutcome {
    Written,
    /// The file no longer holds what the caller expected, so it was left alone.
    ChangedOnDisk,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchSpec {
    /// The worktree root, watched recursively minus skipped folders.
    pub root: String,
    /// Git directories (the worktree's gitdir and the common dir); their
    /// top level and `refs/` are watched, `objects/` is not.
    pub git_dirs: Vec<String>,
    /// Folders under `root` to skip entirely, e.g. other worktrees nested inside it.
    pub exclude: Vec<String>,
}

/// What a debounced burst of watcher events touched. Missing fields (an older helper) read as nothing.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Change {
    /// Files of the worktree itself, not only git's own state (refs, index, HEAD), which
    /// worktrees share: a commit in one also moves refs every other worktree watches.
    pub files: bool,
    /// Those files (and folders), relative to the worktree with `/`, in the order first seen; capped.
    pub paths: Vec<String>,
}

pub type Progress<'a> = &'a (dyn Fn(&str) + Sync);
pub type OnChange = Arc<dyn Fn(Change) + Send + Sync>;

pub trait GitHost: Send + Sync {
    /// Runs an allowlisted git command in `cwd`. A non-zero exit is not an `Err`;
    /// `Err` means git could not be run at all (or the command was refused).
    fn git(&self, cwd: &str, args: &[String], progress: Option<Progress>) -> Result<GitOutput, String>;
    fn read_file(&self, path: &str, max: u64) -> Result<FileRead, String>;
    /// Replaces an existing regular file's contents with `data`, if it still holds `expected`.
    /// The only write Grove makes to a worktree: the caller checks the user's editable files
    /// first, and every host refuses the files `editable::protected` names on its own.
    /// Errors name the file, never its contents.
    fn write_file(&self, path: &str, data: &[u8], expected: &[u8]) -> Result<WriteOutcome, String>;
    fn list_dir(&self, path: &str) -> Result<Vec<DirEntry>, String>;
    /// Modification time in unix seconds, None if the path does not exist.
    fn mtime(&self, path: &str) -> Result<Option<i64>, String>;
    fn watch(&self, spec: WatchSpec, on_change: OnChange) -> Result<u64, String>;
    fn unwatch(&self, id: u64);
    /// Every worktree in `cwds` side by side, computed on the machine holding the repository:
    /// it takes many git commands and long file lists, of which the result keeps little.
    /// Most of that is `find_overlaps`, the work behind `Overview::overlaps`.
    fn overview(&self, cwds: &[String], base: Option<&str>, find_overlaps: bool) -> Result<Overview, String>;
}

/// Joins a host path and a repository-relative path. Every OS accepts `/`.
pub fn join(base: &str, rel: &str) -> String {
    if rel.is_empty() {
        return base.to_string();
    }
    format!("{}/{}", base.trim_end_matches(['/', '\\']), rel.trim_start_matches('/'))
}

pub(crate) mod b64 {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(v: &[u8], s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&STANDARD.encode(v))
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
        let s = String::deserialize(d)?;
        STANDARD.decode(s).map_err(serde::de::Error::custom)
    }
}

mod b64_opt {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(v: &Option<Vec<u8>>, s: S) -> Result<S::Ok, S::Error> {
        match v {
            Some(b) => s.serialize_some(&STANDARD.encode(b)),
            None => s.serialize_none(),
        }
    }
    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Vec<u8>>, D::Error> {
        Option::<String>::deserialize(d)?
            .map(|s| STANDARD.decode(s).map_err(serde::de::Error::custom))
            .transpose()
    }
}
