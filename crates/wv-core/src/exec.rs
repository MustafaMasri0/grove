//! Runs the git command-line tool. Shared by the Windows app (git.exe) and the
//! WSL helper (git), so both enforce the same allowlist and environment.

use crate::allowlist;
use crate::host::{GitOutput, Progress};
use std::io::Read;
use std::process::{Command, Stdio};

/// stderr kept for error messages; progress output can be long.
const STDERR_KEEP: usize = 64 * 1024;

pub fn run_git(cwd: &str, args: &[String], progress: Option<Progress>) -> Result<GitOutput, String> {
    allowlist::check(args)?;
    let mut cmd = Command::new("git");
    cmd.arg("-C")
        .arg(cwd)
        .args(["-c", "core.quotepath=off", "-c", "color.ui=never", "-c", "core.pager=cat"])
        .args(args)
        // Never wait for a password prompt; the user's credential helper must already work.
        .env("GIT_TERMINAL_PROMPT", "0")
        // Read-only: status must not refresh and rewrite the index.
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_console(&mut cmd);

    let mut child = cmd.spawn().map_err(|e| format!("could not run git: {e}"))?;
    let mut stdout = child.stdout.take().expect("piped stdout");
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        stdout.read_to_end(&mut buf).map(|_| buf)
    });

    let mut stderr_pipe = child.stderr.take().expect("piped stderr");
    let mut stderr = Vec::new();
    let mut line = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let n = stderr_pipe.read(&mut chunk).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        stderr.extend_from_slice(&chunk[..n]);
        if stderr.len() > STDERR_KEEP * 2 {
            stderr.drain(..stderr.len() - STDERR_KEEP);
        }
        if let Some(p) = progress {
            // Git redraws progress lines with \r.
            for &b in &chunk[..n] {
                if b == b'\r' || b == b'\n' {
                    if !line.is_empty() {
                        p(String::from_utf8_lossy(&line).trim());
                        line.clear();
                    }
                } else {
                    line.push(b);
                }
            }
        }
    }
    let stdout = reader.join().map_err(|_| "stdout reader panicked".to_string())?.map_err(|e| e.to_string())?;
    let status = child.wait().map_err(|e| e.to_string())?;
    Ok(GitOutput {
        code: status.code().unwrap_or(-1),
        stdout,
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
    })
}

/// Keeps child processes from flashing a console window on Windows.
pub fn hide_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}
