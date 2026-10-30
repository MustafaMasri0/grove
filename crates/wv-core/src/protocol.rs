//! JSON lines between the app and the helper: one message per line on
//! stdin/stdout. Requests carry an id; replies and progress echo it.

use crate::host::{Change, WatchSpec};
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
        #[serde(flatten)]
        change: Change,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_change_from_an_older_helper_reads_as_unknown() {
        let m: Message = serde_json::from_str(r#"{"type":"changed","watchId":3}"#).unwrap();
        assert!(matches!(m, Message::Changed { watch_id: 3, change } if change == Change::default()));
    }

    #[test]
    fn a_change_round_trips() {
        let change = Change { files: true, paths: vec!["src/a.ts".into()] };
        let line = serde_json::to_string(&Message::Changed { watch_id: 1, change: change.clone() }).unwrap();
        assert_eq!(line, r#"{"type":"changed","watchId":1,"files":true,"paths":["src/a.ts"]}"#);
        assert!(matches!(serde_json::from_str(&line).unwrap(), Message::Changed { watch_id: 1, change: c } if c == change));
    }
}
