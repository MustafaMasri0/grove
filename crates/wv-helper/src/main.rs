//! Runs inside a WSL distro, started by the app as `wsl.exe -d <distro> -- <this>`.
//! Reads JSON requests from stdin, answers on stdout, one message per line.
//! Exits when stdin closes, i.e. when the app goes away.

use serde::Serialize;
use std::io::{BufRead, Write};
use std::sync::{Arc, Mutex, OnceLock};
use wv_core::host::{Change, GitHost};
use wv_core::local::LocalHost;
use wv_core::protocol::{Message, Op, Request};

type Out = Arc<Mutex<std::io::Stdout>>;

fn send(out: &Out, msg: &Message) {
    if let Ok(line) = serde_json::to_string(msg) {
        let mut o = out.lock().unwrap();
        let _ = writeln!(o, "{line}");
        let _ = o.flush();
    }
}

fn reply<T: Serialize>(out: &Out, id: u64, result: Result<T, String>) {
    let msg = match result.and_then(|v| serde_json::to_value(v).map_err(|e| e.to_string())) {
        Ok(result) => Message::Done { id, result },
        Err(error) => Message::Failed { id, error },
    };
    send(out, &msg);
}

fn handle(host: &LocalHost, out: &Out, req: Request) {
    let id = req.id;
    match req.op {
        Op::Git { cwd, args, progress } => {
            let out2 = out.clone();
            let forward = move |line: &str| send(&out2, &Message::Progress { id, line: line.to_string() });
            let p: Option<&(dyn Fn(&str) + Sync)> = if progress { Some(&forward) } else { None };
            reply(out, id, host.git(&cwd, &args, p));
        }
        Op::ReadFile { path, max } => reply(out, id, host.read_file(&path, max)),
        Op::ListDir { path } => reply(out, id, host.list_dir(&path)),
        Op::Mtime { path } => reply(out, id, host.mtime(&path)),
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
            reply(out, id, result);
        }
        Op::Unwatch { watch_id } => {
            host.unwatch(watch_id);
            reply(out, id, Ok(()));
        }
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
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        match serde_json::from_str::<Request>(&line) {
            Ok(req) => {
                let (host, out) = (host.clone(), out.clone());
                std::thread::spawn(move || handle(&host, &out, req));
            }
            Err(e) => eprintln!("wv-helper: bad request: {e}"),
        }
    }
    std::process::exit(0);
}
