//! The app's side of the helper protocol. Owns one long-running helper process
//! (behind `wsl.exe` or `ssh`, see `remote`) and multiplexes concurrent calls over it.

use crate::allowlist;
use crate::host::{DirEntry, FileRead, GitHost, GitOutput, OnChange, Progress, WatchSpec, WriteOutcome};
use crate::overview::Overview;
use crate::protocol::{FileBytes, Message, Op, Request};
use serde::de::DeserializeOwned;
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

type Watches = Arc<Mutex<HashMap<u64, OnChange>>>;

const LOST: &str = "the connection to the helper was lost";
/// A large reply with no part for this long is a stalled connection. Ending it fails the
/// calls waiting on it and starts a reconnect; nothing else would, since ssh still sees a
/// live server. Replies that are not parts have no such limit: git may just be slow.
const PART_TIMEOUT: Duration = Duration::from_secs(60);
/// How much of the helper's stderr a failed start can show.
const STDERR_KEEP: usize = 2000;

/// `WV_HELPER_LOG=<file>` records every call and how long it took, to find out what is slow on a real host.
fn trace(text: impl FnOnce() -> String) {
    static LOG: OnceLock<Option<(Mutex<std::fs::File>, Instant)>> = OnceLock::new();
    let log = LOG.get_or_init(|| {
        let path = std::env::var_os("WV_HELPER_LOG")?;
        let file = std::fs::OpenOptions::new().create(true).append(true).open(path).ok()?;
        Some((Mutex::new(file), Instant::now()))
    });
    if let Some((file, start)) = log {
        let _ = writeln!(file.lock().unwrap(), "{:9.3} {}", start.elapsed().as_secs_f64(), text());
    }
}

pub struct HelperClient {
    conn: Arc<Connection>,
    child: Arc<Mutex<Child>>,
    next_id: AtomicU64,
    watches: Watches,
    version: String,
}

/// What the client, the thread reading replies and the stall watchdog share about one connection.
struct Connection {
    gate: ReplyGate,
    /// The callers waiting for a reply, by request id.
    pending: Mutex<HashMap<u64, Sender<Message>>>,
    alive: AtomicBool,
    /// Told when a connection that said hello ends. Set once the hello arrives.
    on_lost: Mutex<Option<Box<dyn FnOnce() + Send>>>,
}

impl Connection {
    /// Ends the connection, once, whoever notices first: the reader at the end of the
    /// helper's stdout, or the watchdog after killing a stalled helper. The watchdog cannot
    /// wait for the reader, since a process it did not start (Git for Windows' `sh`
    /// launcher, a proxy behind `ssh`) can keep stdout open after the kill.
    fn end(&self) {
        if !self.alive.swap(false, Ordering::SeqCst) {
            return;
        }
        self.gate.connection_ended();
        // Dropping the senders wakes every waiting caller with an error.
        self.pending.lock().unwrap().clear();
        trace(|| "connection ended".into());
        let on_lost = self.on_lost.lock().unwrap().take();
        if let Some(on_lost) = on_lost {
            on_lost();
        }
    }
}

/// The helper's stdin. Requests wait while a large reply travels: see `protocol::LARGE_REPLY`.
struct ReplyGate {
    state: Mutex<SendState>,
    quiet_over: Condvar,
}

struct SendState {
    /// None once the client is dropped: the helper exits when its stdin closes.
    stdin: Option<ChildStdin>,
    /// The large reply on its way, and when its next part was asked for.
    large: Option<(u64, Instant)>,
    /// Large replies waiting for their turn.
    queued: VecDeque<u64>,
}

impl ReplyGate {
    fn go(state: &mut SendState, id: u64) {
        state.large = Some((id, Instant::now()));
        if let (Ok(line), Some(stdin)) = (serde_json::to_string(&Request { id, op: Op::Go }), state.stdin.as_mut()) {
            let _ = writeln!(stdin, "{line}").and_then(|_| stdin.flush());
        }
    }

    fn large_reply_ready(&self, id: u64) {
        let mut state = self.state.lock().unwrap();
        if state.large.is_some() {
            state.queued.push_back(id);
        } else {
            Self::go(&mut state, id);
        }
    }

    fn next_part(&self, id: u64) {
        Self::go(&mut self.state.lock().unwrap(), id);
    }

    fn reply_arrived(&self, id: u64) {
        let mut state = self.state.lock().unwrap();
        if state.large.is_none_or(|(large, _)| large != id) {
            return;
        }
        state.large = None;
        match state.queued.pop_front() {
            Some(next) => Self::go(&mut state, next),
            None => self.quiet_over.notify_all(),
        }
    }

    fn stalled(&self, limit: Duration) -> bool {
        self.state.lock().unwrap().large.is_some_and(|(_, asked)| asked.elapsed() > limit)
    }

    fn connection_ended(&self) {
        let mut state = self.state.lock().unwrap();
        state.large = None;
        state.queued.clear();
        self.quiet_over.notify_all();
    }

    fn send(&self, line: &str) -> std::io::Result<()> {
        let mut state = self.state.lock().unwrap();
        while state.large.is_some() {
            state = self.quiet_over.wait(state).unwrap();
        }
        let stdin = state.stdin.as_mut().ok_or(std::io::ErrorKind::BrokenPipe)?;
        writeln!(stdin, "{line}").and_then(|_| stdin.flush())
    }
}

impl HelperClient {
    /// Starts the helper and waits for its hello line. `on_lost` runs if a helper that
    /// said hello goes away, which ends its watches.
    pub fn spawn(cmd: Command, on_lost: Box<dyn FnOnce() + Send>) -> Result<Self, String> {
        Self::spawn_with_part_timeout(cmd, on_lost, PART_TIMEOUT)
    }

    /// [`Self::spawn`], with a limit on waiting for a part that tests need not sit through.
    #[doc(hidden)]
    pub fn spawn_with_part_timeout(mut cmd: Command, on_lost: Box<dyn FnOnce() + Send>, part_timeout: Duration) -> Result<Self, String> {
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped());
        crate::exec::hide_console(&mut cmd);
        let mut child = cmd.spawn().map_err(|e| format!("could not start helper: {e}"))?;
        let stdin = child.stdin.take().expect("piped stdin");
        let stdout = child.stdout.take().expect("piped stdout");
        let (stderr_tx, stderr_rx) = channel();
        if let Some(stderr) = child.stderr.take() {
            std::thread::spawn(move || {
                let mut kept = String::new();
                for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                    trace(|| format!("stderr: {line}"));
                    if kept.len() < STDERR_KEEP {
                        kept.push_str(&line);
                        kept.push('\n');
                    }
                }
                let _ = stderr_tx.send(kept);
            });
        }

        let conn = Arc::new(Connection {
            gate: ReplyGate { state: Mutex::new(SendState { stdin: Some(stdin), large: None, queued: VecDeque::new() }), quiet_over: Condvar::new() },
            pending: Default::default(),
            alive: AtomicBool::new(true),
            on_lost: Mutex::new(None),
        });
        let watches: Watches = Default::default();
        let (hello_tx, hello_rx) = channel();
        {
            let (conn, watches) = (conn.clone(), watches.clone());
            let mut on_lost = Some(on_lost);
            std::thread::spawn(move || {
                let sender = &conn.gate;
                let mut parts = String::new();
                for line in BufReader::new(stdout).lines() {
                    let Ok(line) = line else { break };
                    trace(|| format!("reply {} bytes", line.len()));
                    let Ok(mut msg) = serde_json::from_str::<Message>(&line) else { continue };
                    if let Message::Part { id, text, last } = &msg {
                        parts.push_str(text);
                        if !*last {
                            sender.next_part(*id);
                            continue;
                        }
                        // Requests wait for this reply, so one that can't be read ends the connection.
                        let Ok(whole) = serde_json::from_str::<Message>(&parts) else { break };
                        parts.clear();
                        msg = whole;
                    }
                    match &msg {
                        Message::Hello { version } => {
                            *conn.on_lost.lock().unwrap() = on_lost.take();
                            let _ = hello_tx.send(version.clone());
                        }
                        Message::Changed { watch_id, change } => {
                            trace(|| format!("changed watch={watch_id} files={} paths={}", change.files, change.paths.len()));
                            let cb = watches.lock().unwrap().get(watch_id).cloned();
                            if let Some(cb) = cb {
                                cb(change.clone());
                            }
                        }
                        Message::Large { id } => sender.large_reply_ready(*id),
                        Message::Done { id, .. } | Message::Failed { id, .. } => {
                            sender.reply_arrived(*id);
                            if let Some(tx) = conn.pending.lock().unwrap().remove(id) {
                                let _ = tx.send(msg);
                            }
                        }
                        Message::Progress { id, .. } => {
                            if let Some(tx) = conn.pending.lock().unwrap().get(id) {
                                let _ = tx.send(msg);
                            }
                        }
                        Message::Part { .. } => {}
                    }
                }
                conn.end();
            });
        }

        let version = match hello_rx.recv_timeout(Duration::from_secs(20)) {
            Ok(v) => v,
            Err(_) => {
                let _ = child.kill();
                let status = child.wait().ok().and_then(|s| s.code());
                let stderr = stderr_rx.recv_timeout(Duration::from_secs(1)).unwrap_or_default();
                return Err(format!("helper did not start (exit code {status:?}) {}", stderr.trim()).trim_end().to_string());
            }
        };
        let child = Arc::new(Mutex::new(child));
        {
            let (conn, child) = (conn.clone(), child.clone());
            std::thread::spawn(move || {
                while conn.alive.load(Ordering::SeqCst) {
                    if conn.gate.stalled(part_timeout) {
                        trace(|| "large reply stalled: ending the connection".into());
                        let _ = child.lock().unwrap().kill();
                        conn.end();
                        return;
                    }
                    std::thread::sleep((part_timeout / 4).min(Duration::from_secs(5)));
                }
            });
        }
        Ok(Self { conn, child, next_id: AtomicU64::new(1), watches, version })
    }

    pub fn version(&self) -> &str {
        &self.version
    }

    pub fn is_alive(&self) -> bool {
        self.conn.alive.load(Ordering::SeqCst)
    }

    fn call<T: DeserializeOwned>(&self, op: Op, progress: Option<Progress>) -> Result<T, String> {
        if !self.is_alive() {
            return Err(LOST.into());
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (started, what) = (Instant::now(), format!("{op:?}"));
        let (tx, rx) = channel();
        self.conn.pending.lock().unwrap().insert(id, tx);
        let line = serde_json::to_string(&Request { id, op }).map_err(|e| e.to_string())?;
        let done = |outcome: &str| trace(|| format!("{:7}ms {outcome} {}", started.elapsed().as_millis(), what.chars().take(140).collect::<String>()));
        if let Err(e) = self.conn.gate.send(&line) {
            self.conn.pending.lock().unwrap().remove(&id);
            return Err(format!("{LOST} ({e})"));
        }
        loop {
            match rx.recv() {
                Ok(Message::Progress { line, .. }) => {
                    if let Some(p) = progress {
                        p(&line);
                    }
                }
                Ok(Message::Done { result, .. }) => {
                    done("ok");
                    return serde_json::from_value(result).map_err(|e| e.to_string());
                }
                Ok(Message::Failed { error, .. }) => {
                    done("failed");
                    return Err(error);
                }
                Ok(_) => {}
                Err(_) => {
                    done("lost");
                    return Err(LOST.into());
                }
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

    fn check_writable(&self, root: &str, rel: &str) -> Result<(), String> {
        self.call(Op::CheckWritable { root: root.into(), rel: rel.into() }, None)
    }

    fn write_file(&self, root: &str, rel: &str, data: &[u8], expected: &[u8]) -> Result<WriteOutcome, String> {
        self.call(Op::WriteFile { root: root.into(), rel: rel.into(), data: FileBytes(data.to_vec()), expected: FileBytes(expected.to_vec()) }, None)
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

    fn overview(&self, cwds: &[String], base: Option<&str>, find_overlaps: bool) -> Result<Overview, String> {
        self.call(Op::Overview { cwds: cwds.to_vec(), base: base.map(str::to_string), find_overlaps }, None)
    }
}

impl Drop for HelperClient {
    fn drop(&mut self) {
        self.conn.gate.state.lock().unwrap().stdin = None;
        let _ = self.child.lock().unwrap().kill();
    }
}
