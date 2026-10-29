//! The app's side of the helper protocol. Owns one long-running helper process
//! (normally `wsl.exe -d <distro> -- helper`) and multiplexes concurrent calls over it.

use crate::allowlist;
use crate::host::{Change, DirEntry, FileRead, GitHost, GitOutput, OnChange, Progress, WatchSpec};
use crate::protocol::{Message, Op, Request};
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

type Pending = Arc<Mutex<HashMap<u64, Sender<Message>>>>;
type Watches = Arc<Mutex<HashMap<u64, OnChange>>>;

pub struct HelperClient {
    stdin: Mutex<ChildStdin>,
    child: Mutex<Child>,
    next_id: AtomicU64,
    pending: Pending,
    watches: Watches,
    alive: Arc<AtomicBool>,
    version: String,
}

impl HelperClient {
    /// Starts the helper and waits for its hello line.
    pub fn spawn(mut cmd: Command) -> Result<Self, String> {
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped());
        crate::exec::hide_console(&mut cmd);
        let mut child = cmd.spawn().map_err(|e| format!("could not start helper: {e}"))?;
        let stdin = child.stdin.take().expect("piped stdin");
        let stdout = child.stdout.take().expect("piped stdout");

        let pending: Pending = Default::default();
        let watches: Watches = Default::default();
        let alive = Arc::new(AtomicBool::new(true));
        let (hello_tx, hello_rx) = channel();
        {
            let (pending, watches, alive) = (pending.clone(), watches.clone(), alive.clone());
            std::thread::spawn(move || {
                for line in BufReader::new(stdout).lines() {
                    let Ok(line) = line else { break };
                    let Ok(msg) = serde_json::from_str::<Message>(&line) else { continue };
                    match &msg {
                        Message::Hello { version } => {
                            let _ = hello_tx.send(version.clone());
                        }
                        Message::Changed { watch_id, files } => {
                            let cb = watches.lock().unwrap().get(watch_id).cloned();
                            if let Some(cb) = cb {
                                cb(Change { files: *files });
                            }
                        }
                        Message::Done { id, .. } | Message::Failed { id, .. } => {
                            if let Some(tx) = pending.lock().unwrap().remove(id) {
                                let _ = tx.send(msg);
                            }
                        }
                        Message::Progress { id, .. } => {
                            if let Some(tx) = pending.lock().unwrap().get(id) {
                                let _ = tx.send(msg);
                            }
                        }
                    }
                }
                alive.store(false, Ordering::SeqCst);
                // Dropping the senders wakes every waiting caller with an error.
                pending.lock().unwrap().clear();
            });
        }

        let version = match hello_rx.recv_timeout(Duration::from_secs(20)) {
            Ok(v) => v,
            Err(_) => {
                let _ = child.kill();
                let status = child.wait().ok().and_then(|s| s.code());
                return Err(format!("helper did not start (exit code {status:?})"));
            }
        };
        Ok(Self {
            stdin: Mutex::new(stdin),
            child: Mutex::new(child),
            next_id: AtomicU64::new(1),
            pending,
            watches,
            alive,
            version,
        })
    }

    pub fn version(&self) -> &str {
        &self.version
    }

    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    fn call<T: DeserializeOwned>(&self, op: Op, progress: Option<Progress>) -> Result<T, String> {
        if !self.is_alive() {
            return Err("the WSL helper has stopped".into());
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = channel();
        self.pending.lock().unwrap().insert(id, tx);
        let line = serde_json::to_string(&Request { id, op }).map_err(|e| e.to_string())?;
        {
            let mut stdin = self.stdin.lock().unwrap();
            let sent = writeln!(stdin, "{line}").and_then(|_| stdin.flush());
            if let Err(e) = sent {
                self.pending.lock().unwrap().remove(&id);
                return Err(format!("the WSL helper has stopped ({e})"));
            }
        }
        loop {
            match rx.recv() {
                Ok(Message::Progress { line, .. }) => {
                    if let Some(p) = progress {
                        p(&line);
                    }
                }
                Ok(Message::Done { result, .. }) => return serde_json::from_value(result).map_err(|e| e.to_string()),
                Ok(Message::Failed { error, .. }) => return Err(error),
                Ok(_) => {}
                Err(_) => return Err("the WSL helper has stopped".into()),
            }
        }
    }

    /// Sends a git request without the client-side allowlist check, so tests
    /// can prove the helper enforces it on its own.
    #[doc(hidden)]
    pub fn raw_git_unchecked(&self, cwd: &str, args: &[String]) -> Result<GitOutput, String> {
        self.call(Op::Git { cwd: cwd.into(), args: args.to_vec(), progress: false }, None)
    }
}

impl GitHost for HelperClient {
    fn git(&self, cwd: &str, args: &[String], progress: Option<Progress>) -> Result<GitOutput, String> {
        allowlist::check(args)?;
        self.call(Op::Git { cwd: cwd.into(), args: args.to_vec(), progress: progress.is_some() }, progress)
    }

    fn read_file(&self, path: &str, max: u64) -> Result<FileRead, String> {
        self.call(Op::ReadFile { path: path.into(), max }, None)
    }

    fn list_dir(&self, path: &str) -> Result<Vec<DirEntry>, String> {
        self.call(Op::ListDir { path: path.into() }, None)
    }

    fn mtime(&self, path: &str) -> Result<Option<i64>, String> {
        self.call(Op::Mtime { path: path.into() }, None)
    }

    fn watch(&self, spec: WatchSpec, on_change: OnChange) -> Result<u64, String> {
        let id: u64 = self.call(Op::Watch { spec }, None)?;
        self.watches.lock().unwrap().insert(id, on_change);
        Ok(id)
    }

    fn unwatch(&self, id: u64) {
        self.watches.lock().unwrap().remove(&id);
        let _ = self.call::<()>(Op::Unwatch { watch_id: id }, None);
    }
}

impl Drop for HelperClient {
    fn drop(&mut self) {
        let _ = self.child.lock().unwrap().kill();
    }
}
