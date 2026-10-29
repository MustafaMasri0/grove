//! Parsers for git's machine-readable output. Every parser takes raw bytes and
//! never panics on unexpected input.

pub mod blame;
pub mod grep;
pub mod log;
pub mod misc;
pub mod name_status;
pub mod refs;
pub mod status;
pub mod worktree;

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeKind {
    Modified,
    Added,
    Deleted,
    Renamed,
    Copied,
    Untracked,
    Ignored,
    Conflicted,
}

pub(crate) fn lossy(b: &[u8]) -> String {
    String::from_utf8_lossy(b).into_owned()
}

/// Splits off the first `n - 1` space-separated fields; the last field keeps any spaces.
pub(crate) fn fields(b: &[u8], n: usize) -> Vec<&[u8]> {
    b.splitn(n, |&c| c == b' ').collect()
}
