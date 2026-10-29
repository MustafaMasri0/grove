//! JSON lines between the app and the WSL helper: one message per line on
//! stdin/stdout. Requests carry an id; replies and progress echo it.

use crate::host::WatchSpec;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Request {
    pub id: u64,
    #[serde(flatten)]
    pub op: Op,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Op {
    Git { cwd: String, args: Vec<String>, progress: bool },
    ReadFile { path: String, max: u64 },
    ListDir { path: String },
    Mtime { path: String },
    Watch { spec: WatchSpec },
    Unwatch { watch_id: u64 },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Message {
    /// First line the helper prints.
    Hello { version: String },
    Done { id: u64, result: serde_json::Value },
    Failed { id: u64, error: String },
    Progress { id: u64, line: String },
    Changed {
        watch_id: u64,
        /// See [`crate::host::Change`]; an older helper does not say.
        #[serde(default)]
        files: bool,
    },
}
