//! Gets a helper running on a machine Grove reaches through a shell (a WSL distro
//! or an SSH host), whatever that machine is: find out its OS and architecture,
//! pick the embedded helper built for it, start it, and install it first if needed.

use crate::helper_client::HelperClient;
use crate::paths::SshTarget;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Output, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// How long `uname` and friends may take, on top of ssh's own connect timeout.
const PROBE_TIMEOUT: Duration = Duration::from_secs(30);
/// How long copying a helper may take on a slow link.
const UPLOAD_TIMEOUT: Duration = Duration::from_secs(120);
/// A host that just failed is not tried again for this long, so the burst of
/// calls behind one screen reports one failure instead of queueing one timeout each.
const RETRY_AFTER: Duration = Duration::from_secs(5);
/// ssh's own exit code for "could not connect or sign in".
const SSH_FAILED: i32 = 255;
/// A non-interactive shell skips the profile, where Homebrew and user installs add to PATH.
const EXTRA_PATH: &str = "/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin";
/// Where the helper lives, relative to the home folder on every system.
const HELPER_DIR: &str = ".local/share/grove";

/// A helper binary embedded in the app.
#[derive(Debug, Clone, Copy)]
pub struct HelperBinary {
    /// Rust target triple, e.g. `aarch64-unknown-linux-musl`.
    pub target: &'static str,
    /// Tells builds apart; part of the installed file's name.
    pub hash: &'static str,
    pub bytes: &'static [u8],
}

/// Somewhere commands can be started. `line` is for that machine's default shell.
pub trait Shell {
    /// Short and stable: names the connection in errors and in the connection cache.
    fn name(&self) -> String;
    fn command(&self, line: &str) -> Command;
    /// Copies a file to a path under the home folder, for systems that cannot
    /// store stdin (see `install`). None where there is no such system.
    fn upload(&self, _file: &Path, _remote: &str) -> Option<Command> {
        None
    }
}

pub struct WslDistro(pub String);

impl Shell for WslDistro {
    fn name(&self) -> String {
        format!("WSL {}", self.0)
    }

    fn command(&self, line: &str) -> Command {
        let mut c = Command::new("wsl.exe");
        c.args(["-d", &self.0, "--exec", "/bin/sh", "-c", line]);
        c
    }
}

impl Shell for SshTarget {
    fn name(&self) -> String {
        format!("ssh {}", self.authority())
    }

    /// The system's ssh, so the user's config, keys, agent, jump hosts and
    /// known_hosts all apply. It never prompts: there is no terminal to prompt on.
    fn command(&self, line: &str) -> Command {
        let mut c = Command::new("ssh");
        c.arg("-T").arg("-x");
        common_ssh_options(&mut c);
        if let Some(port) = self.port {
            c.arg("-p").arg(port.to_string());
        }
        if let Some(user) = &self.user {
            c.arg("-l").arg(user);
        }
        c.arg("--").arg(&self.host).arg(line);
        c
    }

    fn upload(&self, file: &Path, remote: &str) -> Option<Command> {
        let mut c = Command::new("scp");
        c.arg("-q");
        common_ssh_options(&mut c);
        if let Some(port) = self.port {
            c.arg("-P").arg(port.to_string());
        }
        let host = if self.host.contains(':') { format!("[{}]", self.host) } else { self.host.clone() };
        let user = self.user.as_ref().map(|u| format!("{u}@")).unwrap_or_default();
        c.arg("--").arg(file).arg(format!("{user}{host}:{remote}"));
        Some(c)
    }
}

/// What ssh and scp share: never prompt, and leave the user's own sessions alone.
fn common_ssh_options(c: &mut Command) {
    if let Some(config) = std::env::var_os("WV_SSH_CONFIG") {
        c.arg("-F").arg(config);
    }
    for option in [
        "BatchMode=yes",
        "ConnectTimeout=10",
        // Notices a dead network in 45 s; calls in flight then fail instead of hanging.
        "ServerAliveInterval=15",
        "ServerAliveCountMax=3",
        // A long-lived connection must not fight the user's own sessions over ports.
        "ClearAllForwardings=yes",
        "RemoteCommand=none",
        // May use a master the user has open, but must not become one: a background
        // master would keep the pipes open that tell Grove this command has ended.
        "ControlMaster=no",
    ] {
        c.arg("-o").arg(option);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Linux,
    Macos,
    Windows,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Arch {
    X86_64,
    Aarch64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Platform {
    pub os: Os,
    pub arch: Arch,
}

impl Platform {
    /// Reads `uname -sm`, skipping whatever shell startup files printed first.
    /// None: not uname's output. `Err`: uname's output, for a system with no helper.
    fn from_uname(output: &str) -> Option<Result<Platform, String>> {
        let line = output.lines().rev().find(|l| l.split_whitespace().count() == 2)?;
        let (system, machine) = line.trim().split_once(' ')?;
        let os = match system {
            "Linux" => Os::Linux,
            "Darwin" => Os::Macos,
            // Git for Windows' uname, when it is on the PATH of an OpenSSH server on Windows.
            s if s.starts_with("MINGW") || s.starts_with("MSYS") || s.starts_with("CYGWIN") => Os::Windows,
            s if s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c)) && s.chars().next()?.is_ascii_uppercase() => {
                return Some(Err(format!("{s} is not supported")));
            }
            _ => return None,
        };
        let arch = match machine {
            "x86_64" | "amd64" => Arch::X86_64,
            "aarch64" | "arm64" => Arch::Aarch64,
            m => return Some(Err(format!("{system} on {m} is not supported"))),
        };
        Some(Ok(Platform { os, arch }))
    }

    /// Reads the `%OS% %PROCESSOR_ARCHITECTURE%` of a Windows host.
    fn from_cmd(output: &str) -> Option<Platform> {
        let line = output.lines().rev().find(|l| l.starts_with("Windows_NT "))?;
        let arch = match line.split_whitespace().nth(1)? {
            "AMD64" => Arch::X86_64,
            "ARM64" => Arch::Aarch64,
            _ => return None,
        };
        Some(Platform { os: Os::Windows, arch })
    }

    /// The helper targets that run here, best first.
    fn targets(self) -> &'static [&'static str] {
        match (self.os, self.arch) {
            (Os::Linux, Arch::X86_64) => &["x86_64-unknown-linux-musl"],
            (Os::Linux, Arch::Aarch64) => &["aarch64-unknown-linux-musl"],
            (Os::Macos, Arch::X86_64) => &["x86_64-apple-darwin"],
            (Os::Macos, Arch::Aarch64) => &["aarch64-apple-darwin"],
            (Os::Windows, Arch::X86_64) => &["x86_64-pc-windows-msvc"],
            // Windows on Arm runs x64 programs too.
            (Os::Windows, Arch::Aarch64) => &["aarch64-pc-windows-msvc", "x86_64-pc-windows-msvc"],
        }
    }

    fn helper<'a>(self, helpers: &'a [HelperBinary]) -> Result<&'a HelperBinary, String> {
        self.targets()
            .iter()
            .find_map(|t| helpers.iter().find(|h| h.target == *t))
            .ok_or_else(|| format!("this build of Grove has no helper for {} (scripts/build-helpers.sh was not run for it)", self.targets()[0]))
    }

    /// The line that replaces the shell with the helper, or fails with no hello if it is not installed.
    fn launch_line(self, hash: &str) -> String {
        match self.os {
            Os::Windows => format!(r"cmd /c {}\helper-{hash}.exe", windows_helper_dir()),
            _ => posix(&format!(
                r#"f="$HOME/{HELPER_DIR}/helper-{hash}"; [ -x "$f" ] || exit 1; export PATH="$PATH:{EXTRA_PATH}"; exec "$f""#
            )),
        }
    }

    /// The line that stores stdin as the helper and removes older versions.
    fn install_line(self, hash: &str) -> String {
        // Written aside and moved into place: a helper that is running is never overwritten.
        posix(&format!(
            r#"set -e; umask 077; d="$HOME/{HELPER_DIR}"; mkdir -p "$d"; t="$d/.tmp-$$"; cat > "$t"; chmod 700 "$t"; rm -f "$d"/helper-*; mv "$t" "$d/helper-{hash}""#
        ))
    }
}

/// Relative, since commands start in the home folder. `%USERPROFILE%` would be expanded after
/// PowerShell, as a login shell, has dropped the quotes that a space in it needs.
fn windows_helper_dir() -> String {
    HELPER_DIR.replace('/', r"\")
}

/// Runs a POSIX script from whatever the login shell is (fish, zsh, ...). The script has no single quotes.
fn posix(script: &str) -> String {
    debug_assert!(!script.contains('\''));
    format!("/bin/sh -c '{script}'")
}

/// `cmd.output()` with a time limit, since a jump host or proxy can hang past ssh's connect
/// timeout. `input` is sent to its stdin.
fn output_within(mut cmd: Command, limit: Duration, input: Option<&'static [u8]>) -> Result<Output, String> {
    let program = cmd.get_program().to_string_lossy().into_owned();
    cmd.stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() }).stdout(Stdio::piped()).stderr(Stdio::piped());
    crate::exec::hide_console(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| could_not_start(&program, &e))?;
    if let (Some(bytes), Some(mut stdin)) = (input, child.stdin.take()) {
        // A failing command stops reading; its stderr says why, not this write.
        std::thread::spawn(move || {
            let _ = stdin.write_all(bytes);
        });
    }
    let (mut out, mut err) = (child.stdout.take().expect("piped stdout"), child.stderr.take().expect("piped stderr"));
    let out = std::thread::spawn(move || {
        let mut v = Vec::new();
        out.read_to_end(&mut v).map(|_| v)
    });
    let err = std::thread::spawn(move || {
        let mut v = Vec::new();
        err.read_to_end(&mut v).map(|_| v)
    });
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        if start.elapsed() > limit {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("{program} did not answer within {} seconds", limit.as_secs()));
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    let read = |t: std::thread::JoinHandle<std::io::Result<Vec<u8>>>| t.join().ok().and_then(Result::ok).unwrap_or_default();
    Ok(Output { status, stdout: read(out), stderr: read(err) })
}

fn could_not_start(program: &str, e: &std::io::Error) -> String {
    if program == "ssh" && e.kind() == std::io::ErrorKind::NotFound {
        return "ssh was not found. Install an OpenSSH client (on Windows: Settings > System > Optional features).".into();
    }
    format!("could not start {program}: {e}")
}

/// ssh's complaint, with what to do about the ones Grove cannot solve by asking.
fn explain_ssh_failure(stderr: &str) -> String {
    let text = stderr.trim();
    if text.contains("Host key verification failed") {
        format!("{text}\nGrove does not accept host keys on its own: connect once with ssh in a terminal, then try again.")
    } else if text.contains("Permission denied") {
        format!("{text}\nGrove signs in with your ssh config, keys and agent. It cannot ask for a password or passphrase: load the key into ssh-agent.")
    } else {
        text.to_string()
    }
}

fn probe(shell: &dyn Shell) -> Result<Platform, String> {
    let uname = output_within(shell.command("uname -sm"), PROBE_TIMEOUT, None)?;
    if uname.status.code() == Some(SSH_FAILED) {
        return Err(explain_ssh_failure(&String::from_utf8_lossy(&uname.stderr)));
    }
    if let Some(found) = Platform::from_uname(&String::from_utf8_lossy(&uname.stdout)) {
        let platform = found?;
        if platform.os != Os::Windows {
            return Ok(platform);
        }
    }
    // No uname, or Git for Windows' which says too little about the machine: ask Windows.
    let cmd = output_within(shell.command(r#"cmd /c "echo %OS% %PROCESSOR_ARCHITECTURE%""#), PROBE_TIMEOUT, None)?;
    Platform::from_cmd(&String::from_utf8_lossy(&cmd.stdout)).ok_or_else(|| {
        let why = String::from_utf8_lossy(&uname.stderr);
        format!("could not tell what system this is ({})", why.trim())
    })
}

/// Installs through a copy where stdin cannot be trusted: on a Windows host, PowerShell
/// stops reading a large stdin part way through and never ends. It also keeps the
/// host free of a script: scp ships with every OpenSSH.
fn install_by_copy(shell: &dyn Shell, helper: &HelperBinary) -> Result<Output, String> {
    let dir = windows_helper_dir();
    let remote = format!("{HELPER_DIR}/helper-{}.exe", helper.hash);
    // Both may fail harmlessly: the folder exists, or an older helper is in use. The copy has the last word.
    for line in [format!(r"cmd /c mkdir {dir}"), format!(r"cmd /c del /q {dir}\helper-*.exe")] {
        let _ = output_within(shell.command(&line), PROBE_TIMEOUT, None)?;
    }
    let local = std::env::temp_dir().join(format!("grove-{}-{}.exe", helper.hash, std::process::id()));
    std::fs::write(&local, helper.bytes).map_err(|e| e.to_string())?;
    let copied = match shell.upload(&local, &remote) {
        Some(cmd) => output_within(cmd, UPLOAD_TIMEOUT, None),
        None => Err("this connection cannot copy files".to_string()),
    };
    let _ = std::fs::remove_file(&local);
    copied
}

fn install(shell: &dyn Shell, platform: Platform, helper: &HelperBinary) -> Result<(), String> {
    let done = match platform.os {
        Os::Windows => install_by_copy(shell, helper)?,
        _ => output_within(shell.command(&platform.install_line(helper.hash)), UPLOAD_TIMEOUT, Some(helper.bytes))?,
    };
    if !done.status.success() {
        return Err(format!("installing the helper failed: {}", String::from_utf8_lossy(&done.stderr).trim()));
    }
    Ok(())
}

/// Runs when a connection that was up goes away.
pub type OnLost = Arc<dyn Fn() + Send + Sync>;

/// Starts the helper for `platform`, installing it if it is not there yet.
pub fn provision(shell: &dyn Shell, platform: Platform, helpers: &[HelperBinary], on_lost: OnLost) -> Result<HelperClient, String> {
    let helper = platform.helper(helpers)?;
    let start = || {
        let mut cmd = shell.command(&platform.launch_line(helper.hash));
        cmd.stderr(Stdio::piped());
        let on_lost = on_lost.clone();
        HelperClient::spawn(cmd, Box::new(move || on_lost()))
    };
    start().or_else(|_| {
        install(shell, platform, helper)?;
        start()
    })
}

#[derive(Default)]
struct Slot {
    client: Option<Arc<HelperClient>>,
    failed: Option<(Instant, String)>,
}

/// One helper per machine, connected on demand and reconnected after it is lost.
#[derive(Default)]
pub struct Connections {
    // A lock per machine: connecting can take seconds and must not hold up the others.
    slots: Mutex<HashMap<String, Arc<Mutex<Slot>>>>,
}

impl Connections {
    fn slot(&self, name: String) -> Arc<Mutex<Slot>> {
        self.slots.lock().unwrap().entry(name).or_default().clone()
    }

    pub fn get(
        &self,
        shell: &dyn Shell,
        connect: impl FnOnce() -> Result<HelperClient, String>,
    ) -> Result<Arc<HelperClient>, String> {
        let name = shell.name();
        let slot = self.slot(name.clone());
        let mut slot = slot.lock().unwrap();
        if let Some(client) = slot.client.as_ref().filter(|c| c.is_alive()) {
            return Ok(client.clone());
        }
        if let Some((_, error)) = slot.failed.as_ref().filter(|(at, _)| at.elapsed() < RETRY_AFTER) {
            return Err(error.clone());
        }
        match connect() {
            Ok(client) => {
                let client = Arc::new(client);
                slot.client = Some(client.clone());
                slot.failed = None;
                Ok(client)
            }
            Err(e) => {
                let error = format!("{name}: {e}");
                slot.client = None;
                slot.failed = Some((Instant::now(), error.clone()));
                Err(error)
            }
        }
    }

    /// The connection if it is up, without waiting for one to be made.
    pub fn current(&self, shell: &dyn Shell) -> Option<Arc<HelperClient>> {
        let slot = self.slot(shell.name());
        let slot = slot.try_lock().ok()?;
        slot.client.as_ref().filter(|c| c.is_alive()).cloned()
    }
}

/// Probes the machine, then starts its helper.
pub fn connect(shell: &dyn Shell, helpers: &[HelperBinary], on_lost: OnLost) -> Result<HelperClient, String> {
    provision(shell, probe(shell)?, helpers, on_lost)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(cmd: &Command) -> Vec<String> {
        cmd.get_args().map(|a| a.to_string_lossy().into_owned()).collect()
    }

    fn platform(os: Os, arch: Arch) -> Option<Result<Platform, String>> {
        Some(Ok(Platform { os, arch }))
    }

    #[test]
    fn uname_names_every_supported_system() {
        assert_eq!(Platform::from_uname("Linux x86_64\n"), platform(Os::Linux, Arch::X86_64));
        assert_eq!(Platform::from_uname("Linux aarch64\n"), platform(Os::Linux, Arch::Aarch64));
        assert_eq!(Platform::from_uname("Darwin arm64\n"), platform(Os::Macos, Arch::Aarch64));
        assert_eq!(Platform::from_uname("Darwin x86_64\n"), platform(Os::Macos, Arch::X86_64));
        assert_eq!(Platform::from_uname("MINGW64_NT-10.0-26100 x86_64\n"), platform(Os::Windows, Arch::X86_64));
    }

    #[test]
    fn noise_from_shell_startup_files_is_skipped() {
        let out = "Welcome to the build farm\nyour quota is fine\nLinux x86_64\n";
        assert_eq!(Platform::from_uname(out), platform(Os::Linux, Arch::X86_64));
    }

    #[test]
    fn unsupported_systems_say_so_and_other_output_is_not_uname() {
        assert_eq!(Platform::from_uname("FreeBSD amd64\n"), Some(Err("FreeBSD is not supported".into())));
        assert_eq!(Platform::from_uname("Linux armv7l\n"), Some(Err("Linux on armv7l is not supported".into())));
        assert_eq!(Platform::from_uname(""), None);
        assert_eq!(Platform::from_uname("'uname' is not recognized as an internal command\n"), None);
    }

    #[test]
    fn windows_is_told_apart_by_its_environment() {
        assert_eq!(Platform::from_cmd("Windows_NT AMD64\r\n"), Some(Platform { os: Os::Windows, arch: Arch::X86_64 }));
        assert_eq!(Platform::from_cmd("Windows_NT ARM64\r\n"), Some(Platform { os: Os::Windows, arch: Arch::Aarch64 }));
        assert_eq!(Platform::from_cmd("%OS% %PROCESSOR_ARCHITECTURE%\n"), None);
    }

    const fn binary(target: &'static str) -> HelperBinary {
        HelperBinary { target, hash: "abc", bytes: b"x" }
    }

    #[test]
    fn the_helper_is_picked_by_target_and_a_missing_one_is_named() {
        let helpers = [binary("x86_64-unknown-linux-musl"), binary("x86_64-pc-windows-msvc")];
        let linux = Platform { os: Os::Linux, arch: Arch::X86_64 };
        assert_eq!(linux.helper(&helpers).unwrap().target, "x86_64-unknown-linux-musl");
        // Windows on Arm falls back to the x64 helper.
        let arm = Platform { os: Os::Windows, arch: Arch::Aarch64 };
        assert_eq!(arm.helper(&helpers).unwrap().target, "x86_64-pc-windows-msvc");
        // A Mac is a table entry waiting for its binary, not a special case.
        let mac = Platform { os: Os::Macos, arch: Arch::Aarch64 };
        assert!(mac.helper(&helpers).unwrap_err().contains("aarch64-apple-darwin"));
    }

    #[test]
    fn every_target_is_one_of_the_built_ones() {
        let script = include_str!("../../../scripts/build-helpers.sh");
        for os in [Os::Linux, Os::Macos, Os::Windows] {
            for arch in [Arch::X86_64, Arch::Aarch64] {
                let target = (Platform { os, arch }).targets()[0];
                assert!(script.contains(target) || target == "aarch64-pc-windows-msvc", "{target}");
            }
        }
    }

    #[test]
    fn unix_lines_survive_any_login_shell() {
        let p = Platform { os: Os::Macos, arch: Arch::Aarch64 };
        for line in [p.launch_line("abc"), p.install_line("abc")] {
            assert!(line.starts_with("/bin/sh -c '") && line.ends_with('\''), "{line}");
            assert_eq!(line.matches('\'').count(), 2, "{line}");
        }
        assert!(p.launch_line("abc").contains("/opt/homebrew/bin"));
    }

    #[test]
    fn windows_hosts_keep_the_helper_in_the_home_folder_not_the_app_install_folder() {
        let p = Platform { os: Os::Windows, arch: Arch::X86_64 };
        // Relative and with no variable, so no shell has anything to get wrong.
        assert_eq!(p.launch_line("abc"), r"cmd /c .local\share\grove\helper-abc.exe");
    }

    #[test]
    fn scp_gets_the_same_options_and_addresses_the_host_like_ssh() {
        let target = SshTarget { user: Some("dev".into()), host: "2001:db8::1".into(), port: Some(2222) };
        let a = args(&target.upload(Path::new("h.exe"), ".local/share/grove/h.exe").unwrap());
        assert!(a.windows(2).any(|w| w == ["-o", "BatchMode=yes"]));
        assert!(a.windows(2).any(|w| w == ["-P", "2222"]));
        assert_eq!(&a[a.len() - 3..], ["--", "h.exe", "dev@[2001:db8::1]:.local/share/grove/h.exe"]);
    }

    #[test]
    fn ssh_never_prompts_and_ends_its_options_before_the_host() {
        let target = SshTarget { user: Some("dev".into()), host: "build.example.com".into(), port: Some(2222) };
        let a = args(&target.command("uname -sm"));
        assert!(a.windows(2).any(|w| w == ["-o", "BatchMode=yes"]));
        assert!(a.windows(2).any(|w| w == ["-p", "2222"]));
        assert!(a.windows(2).any(|w| w == ["-l", "dev"]));
        assert_eq!(&a[a.len() - 3..], ["--", "build.example.com", "uname -sm"]);
    }

    fn sh(script: &str) -> Command {
        let mut c = Command::new("sh");
        c.arg("-c").arg(script);
        c
    }

    #[test]
    fn a_command_that_hangs_is_stopped_at_the_limit() {
        let start = Instant::now();
        let err = output_within(sh("sleep 30"), Duration::from_millis(200), Some(b"x")).unwrap_err();
        assert!(err.contains("did not answer"), "{err}");
        assert!(start.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn input_reaches_the_command_and_its_output_comes_back() {
        let out = output_within(sh("cat"), Duration::from_secs(10), Some(b"hello")).unwrap();
        assert_eq!(out.stdout, b"hello");
    }

    #[test]
    fn known_failures_say_what_to_do() {
        assert!(explain_ssh_failure("Host key verification failed.\n").contains("terminal"));
        assert!(explain_ssh_failure("dev@host: Permission denied (publickey).\n").contains("ssh-agent"));
        assert_eq!(explain_ssh_failure("connect to host x port 22: Connection refused\n"), "connect to host x port 22: Connection refused");
    }

    struct Named;
    impl Shell for Named {
        fn name(&self) -> String {
            "test".into()
        }
        fn command(&self, _: &str) -> Command {
            Command::new("unused")
        }
    }

    #[test]
    fn a_failed_host_is_not_retried_by_every_waiting_call() {
        let c = Connections::default();
        let attempts = std::sync::atomic::AtomicU32::new(0);
        for _ in 0..3 {
            let r = c.get(&Named, || {
                attempts.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                Err("unreachable".into())
            });
            assert_eq!(r.err().unwrap(), "test: unreachable");
        }
        assert_eq!(attempts.into_inner(), 1);
        assert!(c.current(&Named).is_none());
    }
}
