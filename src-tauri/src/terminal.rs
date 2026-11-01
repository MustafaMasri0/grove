//! Opens a terminal on a worktree, wherever it lives: Windows Terminal when it is installed,
//! else a console window. Only ever from the user asking; nothing here reads what the shell does.

use wv_core::paths::{route, Route, SshTarget};

/// A worktree's shell: a program to run, or the default shell (`program` None) in `dir`.
#[derive(Debug, PartialEq, Eq)]
struct Shell {
    program: Option<&'static str>,
    args: Vec<String>,
    dir: Option<String>,
}

fn shell_for(repo: &str, cwd: &str) -> Result<Shell, String> {
    Ok(match route(repo)? {
        Route::Local { .. } => Shell { program: None, args: vec![], dir: Some(cwd.replace('/', "\\")) },
        Route::Wsl { distro, .. } => Shell { program: Some("wsl.exe"), args: vec!["-d".into(), distro, "--cd".into(), cwd.into()], dir: None },
        Route::Ssh { target, .. } => Shell { program: Some("ssh"), args: ssh_args(&target, cwd), dir: None },
    })
}

/// Interactive, unlike Grove's own connections: this is where a password or a new host key can be answered.
fn ssh_args(target: &SshTarget, cwd: &str) -> Vec<String> {
    let mut args = vec!["-t".to_string()];
    if let Some(port) = target.port {
        args.extend(["-p".into(), port.to_string()]);
    }
    if let Some(user) = &target.user {
        args.extend(["-l".into(), user.clone()]);
    }
    args.push(target.host.clone());
    // A Windows host has no POSIX shell to run this: it gets its login shell, in the home folder.
    if !is_drive_path(cwd) {
        args.push(format!("cd -- {} && exec \"${{SHELL:-sh}}\" -l", sh_quote(cwd)));
    }
    args
}

fn is_drive_path(path: &str) -> bool {
    let b = path.as_bytes();
    b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':'
}

fn sh_quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', "'\\''"))
}

/// The arguments of `wt.exe`, which reads a bare `;` as the start of another command.
fn windows_terminal_args(shell: &Shell) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(dir) = &shell.dir {
        args.extend(["-d".to_string(), dir.clone()]);
    }
    args.extend(shell.program.map(str::to_string));
    args.extend(shell.args.iter().cloned());
    args.iter().map(|a| a.replace(';', "\\;")).collect()
}

/// The arguments of `conhost.exe`, which runs the shell on a console of its own. Started directly from
/// this windowed app, a shell would get the app's empty standard input and exit at once.
fn console_args(shell: &Shell) -> Vec<String> {
    let mut args = vec![shell.program.unwrap_or("cmd.exe").to_string()];
    args.extend(shell.args.iter().cloned());
    args
}

#[cfg(windows)]
fn launch(shell: &Shell) -> Result<(), String> {
    use std::io::ErrorKind;
    use std::path::PathBuf;
    use std::process::Command;

    // Its Store install is an alias in WindowsApps, a folder that need not be on PATH.
    let alias = std::env::var_os("LOCALAPPDATA").map(|d| PathBuf::from(d).join(r"Microsoft\WindowsApps\wt.exe"));
    for wt in std::iter::once(PathBuf::from("wt.exe")).chain(alias) {
        match Command::new(wt).args(windows_terminal_args(shell)).spawn() {
            Err(e) if e.kind() == ErrorKind::NotFound => {}
            other => return other.map(drop).map_err(|e| e.to_string()),
        }
    }
    let mut console = Command::new("conhost.exe");
    console.args(console_args(shell));
    if let Some(dir) = &shell.dir {
        console.current_dir(dir);
    }
    console.spawn().map(drop).map_err(|e| e.to_string())
}

#[cfg(not(windows))]
fn launch(_: &Shell) -> Result<(), String> {
    Err("Opening a terminal is only supported on Windows".into())
}

/// Opens a terminal in `cwd`, a worktree of `repo`, as its host names it.
#[tauri::command]
pub async fn open_terminal(repo: String, cwd: String) -> Result<(), String> {
    launch(&shell_for(&repo, &cwd)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_local_worktree_opens_the_default_shell_in_its_folder() {
        let s = shell_for("D:/src/example", "D:/src/example-wt").unwrap();
        assert_eq!(s, Shell { program: None, args: vec![], dir: Some("D:\\src\\example-wt".into()) });
        assert_eq!(windows_terminal_args(&s), ["-d", "D:\\src\\example-wt"]);
    }

    #[test]
    fn a_wsl_worktree_opens_in_its_distro() {
        let s = shell_for(r"\\wsl.localhost\Ubuntu\home\user\src\example", "/home/user/src/example-wt").unwrap();
        assert_eq!(windows_terminal_args(&s), ["wsl.exe", "-d", "Ubuntu", "--cd", "/home/user/src/example-wt"]);
    }

    #[test]
    fn an_ssh_worktree_changes_folder_then_starts_the_login_shell() {
        let s = shell_for("ssh://user@dev-box:2222/home/user/src/example", "/home/user/it's here").unwrap();
        assert_eq!(s.program, Some("ssh"));
        assert_eq!(s.args[..6], ["-t", "-p", "2222", "-l", "user", "dev-box"]);
        assert_eq!(s.args[6], "cd -- '/home/user/it'\\''s here' && exec \"${SHELL:-sh}\" -l");
    }

    #[test]
    fn a_windows_ssh_host_gets_its_login_shell() {
        let s = shell_for("ssh://dev-box/C:/src/example", "C:/src/example-wt").unwrap();
        assert_eq!(s.args, ["-t", "dev-box"]);
    }

    #[test]
    fn a_console_runs_the_shell_itself() {
        assert_eq!(console_args(&shell_for("D:/src/example", "D:/src/example").unwrap()), ["cmd.exe"]);
        let wsl = shell_for(r"\\wsl.localhost\Ubuntu\home\user\src\example", "/home/user/a").unwrap();
        assert_eq!(console_args(&wsl), ["wsl.exe", "-d", "Ubuntu", "--cd", "/home/user/a"]);
    }

    #[test]
    fn windows_terminal_does_not_split_on_a_semicolon() {
        let s = shell_for("D:/src/example", "D:/src/a;b").unwrap();
        assert_eq!(windows_terminal_args(&s)[1], "D:\\src\\a\\;b");
    }
}
