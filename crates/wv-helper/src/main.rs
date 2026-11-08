//! Runs where a repository lives, on a machine the app reaches through `wsl.exe` or `ssh`.
//! Reads JSON requests from stdin, answers on stdout, one message per line.
//! Exits when stdin closes, i.e. when the app goes away.

use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, Write};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use wv_core::host::{Change, GitHost};
use wv_core::local::LocalHost;
use wv_core::protocol::{Message, Op, Request, LARGE_REPLY};

type Out = Arc<Mutex<std::io::Stdout>>;
/// Large replies waiting for `Op::Go`, by request id.
type Gates = Arc<Mutex<HashMap<u64, Sender<()>>>>;

fn write_line(out: &Out, line: &str) {
    let mut o = out.lock().unwrap();
    let _ = writeln!(o, "{line}");
    let _ = o.flush();
}

fn send(out: &Out, msg: &Message) {
    if let Ok(line) = serde_json::to_string(msg) {
        write_line(out, &line);
    }
}

fn reply<T: Serialize>(out: &Out, gates: &Gates, id: u64, result: Result<T, String>) {
    let msg = match result.and_then(|v| serde_json::to_value(v).map_err(|e| e.to_string())) {
        Ok(result) => Message::Done { id, result },
        Err(error) => Message::Failed { id, error },
    };
    let Ok(line) = serde_json::to_string(&msg) else { return };
    if line.len() > LARGE_REPLY {
        let (go, wait) = channel();
        gates.lock().unwrap().insert(id, go);
        send(out, &Message::Large { id });
        let mut rest = line.as_str();
        while !rest.is_empty() {
            if wait.recv().is_err() {
                break;
            }
            let mut end = LARGE_REPLY.min(rest.len());
            while !rest.is_char_boundary(end) {
                end -= 1;
            }
            let (part, tail) = rest.split_at(end);
            rest = tail;
            send(out, &Message::Part { id, text: part.to_string(), last: rest.is_empty() });
        }
        gates.lock().unwrap().remove(&id);
        return;
    }
    write_line(out, &line);
}

fn handle(host: &LocalHost, out: &Out, gates: &Gates, req: Request) {
    let id = req.id;
    match req.op {
        Op::Git { cwd, args, progress } => {
            let out2 = out.clone();
            let forward = move |line: &str| send(&out2, &Message::Progress { id, line: line.to_string() });
            let p: Option<&(dyn Fn(&str) + Sync)> = if progress { Some(&forward) } else { None };
            reply(out, gates, id, host.git(&cwd, &args, p));
        }
        Op::ReadFile { path, max } => reply(out, gates, id, host.read_file(&path, max)),
        Op::CheckWritable { root, rel } => reply(out, gates, id, host.check_writable(&root, &rel)),
        Op::WriteFile { root, rel, data, expected } => reply(out, gates, id, host.write_file(&root, &rel, &data.0, &expected.0)),
        Op::ListDir { path } => reply(out, gates, id, host.list_dir(&path)),
        Op::Mtime { path } => reply(out, gates, id, host.mtime(&path)),
        Op::Watch { spec } => {
            let watch_id = Arc::new(OnceLock::new());
            let (out2, wid) = (out.clone(), watch_id.clone());
            let result = host.watch(
                spec,
                Arc::new(move |change: Change| {
                    if let Some(&watch_id) = wid.get() {
                        send(&out2, &Message::Changed { watch_id, change });
                    }
                }),
            );
            if let Ok(w) = result {
                let _ = watch_id.set(w);
            }
            reply(out, gates, id, result);
        }
        Op::Unwatch { watch_id } => {
            host.unwatch(watch_id);
            reply(out, gates, id, Ok(()));
        }
        Op::Overview { cwds, base, find_overlaps } => reply(out, gates, id, host.overview(&cwds, base.as_deref(), find_overlaps)),
        // Handled in `main`, in order with the requests before it.
        Op::Go => {}
    }
}

fn main() {
    if std::env::args().any(|a| a == "--version") {
        println!("{}", env!("CARGO_PKG_VERSION"));
        return;
    }
    let out: Out = Arc::new(Mutex::new(std::io::stdout()));
    send(&out, &Message::Hello { version: env!("CARGO_PKG_VERSION").into() });
    let host = Arc::new(LocalHost::new());
    let gates: Gates = Default::default();
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        match serde_json::from_str::<Request>(&line) {
            Ok(Request { id, op: Op::Go }) => {
                if let Some(go) = gates.lock().unwrap().get(&id) {
                    let _ = go.send(());
                }
            }
            Ok(req) => {
                let (host, out, gates) = (host.clone(), out.clone(), gates.clone());
                std::thread::spawn(move || handle(&host, &out, &gates, req));
            }
            Err(e) => eprintln!("wv-helper: bad request: {e}"),
        }
    }
    std::process::exit(0);
}
