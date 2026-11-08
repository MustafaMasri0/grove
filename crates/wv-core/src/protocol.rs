//! JSON lines between the app and the helper: one message per line on
//! stdin/stdout. Requests carry an id; replies and progress echo it.

use crate::host::{Change, WatchSpec};
use serde::{Deserialize, Serialize};

/// A reply longer than this travels in parts of this size, each sent after [`Op::Go`] for
/// the one before, while the client sends nothing else. A real SSH server (Tailscale SSH)
/// was seen to stop a connection for good when megabytes were sent at full speed soon
/// after it opened, with requests still arriving. Little in flight at a time avoids it.
pub const LARGE_REPLY: usize = 128 * 1024;

/// A file's contents on the wire. Its `Debug` gives only the size: requests are traced
/// (`WV_HELPER_LOG`), and an edited file is often a secret.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileBytes(#[serde(with = "crate::host::b64")] pub Vec<u8>);

impl std::fmt::Debug for FileBytes {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "<{} bytes>", self.0.len())
    }
}

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
    WriteFile { path: String, data: FileBytes, expected: FileBytes },
    ListDir { path: String },
    Mtime { path: String },
    Watch { spec: WatchSpec },
    Unwatch { watch_id: u64 },
    Overview { cwds: Vec<String>, base: Option<String>, find_overlaps: bool },
    /// The client is ready for the next part of the large reply to this request id.
    Go,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Message {
    /// First line the helper prints.
    Hello { version: String },
    /// The reply to `id` is large: answer with [`Op::Go`] when nothing else is being sent.
    Large { id: u64 },
    /// The next part of the reply line to `id`; `last` completes it.
    Part { id: u64, text: String, last: bool },
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
    fn written_contents_never_reach_the_trace() {
        let op = Op::WriteFile { path: "/x/.env".into(), data: FileBytes(b"TOKEN=secret".to_vec()), expected: FileBytes(b"TOKEN=old".to_vec()) };
        let traced = format!("{op:?}");
        assert!(!traced.contains("secret") && !traced.contains("old") && !traced.contains("84"), "{traced}");
        assert!(traced.contains("<12 bytes>"), "{traced}");
        let line = serde_json::to_string(&Request { id: 1, op }).unwrap();
        assert!(matches!(serde_json::from_str::<Request>(&line).unwrap().op, Op::WriteFile { data, .. } if data.0 == b"TOKEN=secret"));
    }

    #[test]
    fn a_change_round_trips() {
        let change = Change { files: true, paths: vec!["src/a.ts".into()] };
        let line = serde_json::to_string(&Message::Changed { watch_id: 1, change: change.clone() }).unwrap();
        assert_eq!(line, r#"{"type":"changed","watchId":1,"files":true,"paths":["src/a.ts"]}"#);
        assert!(matches!(serde_json::from_str(&line).unwrap(), Message::Changed { watch_id: 1, change: c } if c == change));
    }
}
