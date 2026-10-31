//! The app is read-only. Every git invocation, in the app and in the
//! helper, passes through [`check`] first. Only fetch, plain push,
//! `push -u origin <branch>` and a clone into a new folder may change anything,
//! and nothing may force or delete.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Access {
    /// Reads the repository only.
    Read,
    /// Talks to a remote: fetch, push, publish, clone.
    Network,
}

const READ_COMMANDS: &[&str] = &[
    "status", "diff", "log", "show", "ls-files", "ls-tree", "rev-parse", "rev-list",
    "for-each-ref", "grep", "merge-base", "cat-file",
];

/// Options that write files or run external programs, refused on every read command.
const FORBIDDEN_OPTIONS: &[&str] = &["--output", "--ext-diff", "--open-files-in-pager", "--no-index", "-O"];

/// The only `git branch` options allowed; all of them just list.
const BRANCH_LIST_OPTIONS: &[&str] = &[
    "-a", "--all", "-r", "--remotes", "-l", "--list", "--no-color", "--show-current", "-v", "-vv",
];

pub fn check(args: &[String]) -> Result<Access, String> {
    let Some(cmd) = args.first() else {
        return Err("empty git command".into());
    };
    let rest = &args[1..];
    match cmd.as_str() {
        c if READ_COMMANDS.contains(&c) => check_options(rest).map(|_| Access::Read),
        "worktree" => match rest.first().map(String::as_str) {
            Some("list") if rest[1..].iter().all(|a| a == "--porcelain" || a == "-z") => Ok(Access::Read),
            _ => Err("only `git worktree list` is allowed".into()),
        },
        // Exactly `blame --porcelain [<rev>] -- <path>`: no option can name another file to read.
        "blame" => match rest {
            [p, dd, _] if p == "--porcelain" && dd == "--" => Ok(Access::Read),
            [p, rev, dd, _] if p == "--porcelain" && !rev.starts_with('-') && dd == "--" => Ok(Access::Read),
            _ => Err("only `git blame --porcelain [<rev>] -- <path>` is allowed".into()),
        },
        "branch" => {
            let ok = rest.iter().all(|a| BRANCH_LIST_OPTIONS.contains(&a.as_str()) || a.starts_with("--format="));
            if ok { Ok(Access::Read) } else { Err("only listing branches is allowed".into()) }
        }
        "remote" => match rest {
            [] => Ok(Access::Read),
            [v] if v == "-v" => Ok(Access::Read),
            _ => Err("only listing remotes is allowed".into()),
        },
        "fetch" => match strip_progress(rest) {
            [remote] if valid_name(remote) => Ok(Access::Network),
            _ => Err("only `git fetch <remote>` is allowed".into()),
        },
        "push" => match strip_flag(strip_progress(rest), "--porcelain") {
            [] => Ok(Access::Network),
            [u, remote, branch] if u == "-u" && valid_name(remote) && valid_name(branch) => Ok(Access::Network),
            _ => Err("only `git push` and `git push -u <remote> <branch>` are allowed".into()),
        },
        // Exactly this shape: nothing can pass an option, and the folder can only be a new one inside `cwd`.
        "clone" => match rest {
            [p, dd, url, folder] if p == "--progress" && dd == "--" => {
                if !valid_clone_url(url) {
                    Err("only https://, ssh:// and user@host:path addresses can be cloned".into())
                } else if !valid_folder_name(folder) {
                    Err(format!("{folder} is not a valid folder name"))
                } else {
                    Ok(Access::Network)
                }
            }
            _ => Err("only `git clone --progress -- <url> <folder>` is allowed".into()),
        },
        other => Err(format!("git {other} is not allowed in a read-only viewer")),
    }
}

fn strip_progress(rest: &[String]) -> &[String] {
    strip_flag(rest, "--progress")
}

fn strip_flag<'a>(rest: &'a [String], flag: &str) -> &'a [String] {
    match rest.first() {
        Some(p) if p == flag => &rest[1..],
        _ => rest,
    }
}

fn check_options(rest: &[String]) -> Result<(), String> {
    let mut skip_value = false;
    for a in rest {
        if skip_value {
            skip_value = false;
            continue;
        }
        if a == "--" {
            break;
        }
        // `-e <pattern>`: the pattern may itself look like an option.
        if a == "-e" {
            skip_value = true;
            continue;
        }
        let forbidden = FORBIDDEN_OPTIONS.iter().any(|f| {
            a == f || (f.starts_with("--") && a.starts_with(&format!("{f}="))) || (*f == "-O" && a.starts_with("-O"))
        });
        if forbidden {
            return Err(format!("option {a} is not allowed"));
        }
    }
    Ok(())
}

/// A remote or branch name that cannot be read as an option or a refspec.
fn valid_name(s: &str) -> bool {
    !s.is_empty()
        && !s.starts_with('-')
        && !s.contains("..")
        && s != "@"
        && !s.chars().any(|c| c.is_whitespace() || c.is_control() || ":+*?^~[\\".contains(c))
}

/// The part of an address that names the user and machine: nothing an ssh client could read as an option, even once percent-decoded.
fn valid_authority(s: &str) -> bool {
    s.split(['@', ':']).all(|part| !part.is_empty() && !part.starts_with('-')) && s.chars().all(|c| c.is_ascii_alphanumeric() || "._-@:~".contains(c))
}

/// https, ssh and scp-style addresses. Refuses the rest on purpose: `ext::` and other remote helpers run programs named in the address.
fn valid_clone_url(url: &str) -> bool {
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return false;
    }
    if let Some(rest) = url.strip_prefix("https://").or_else(|| url.strip_prefix("ssh://")) {
        return rest.split_once('/').is_some_and(|(authority, path)| valid_authority(authority) && !path.is_empty());
    }
    // `user@host:path`. One letter before the colon is a Windows drive, a second colon a remote helper, and `://` another scheme.
    url.split_once(':').is_some_and(|(place, path)| {
        let host = place.rsplit('@').next().unwrap_or(place);
        valid_authority(place) && host.len() > 1 && !path.is_empty() && !path.starts_with([':', '-']) && !path.starts_with("//")
    })
}

/// One new folder inside the working directory, never a path out of it.
fn valid_folder_name(s: &str) -> bool {
    !s.is_empty() && s != "." && s != ".." && !s.starts_with('-') && !s.chars().any(|c| c.is_control() || "/\\:".contains(c))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(args: &[&str]) -> Result<Access, String> {
        check(&args.iter().map(|s| s.to_string()).collect::<Vec<_>>())
    }

    #[test]
    fn read_only_commands_are_allowed() {
        for args in [
            &["status", "--porcelain=v2", "-z", "--branch"][..],
            &["diff", "--name-status", "-z", "-M", "HEAD"],
            &["log", "-n", "100", "--format=%H", "main"],
            &["log", "--follow", "--name-status", "-z", "--skip=0", "HEAD", "--", "a.ts"],
            // A history search for text that looks like an option stays a pattern.
            &["log", "-i", "-F", "--grep=--output=x", "--max-count=5", "HEAD", "--"],
            &["merge-base", "--is-ancestor", "abc", "HEAD"],
            &["show", "HEAD:src/a b.ts"],
            &["ls-files", "-co", "--exclude-standard", "-z"],
            &["ls-tree", "-r", "-z", "--name-only", "main"],
            &["worktree", "list", "--porcelain", "-z"],
            &["branch", "--show-current"],
            &["rev-parse", "--git-common-dir"],
            &["rev-list", "--left-right", "--count", "a...b"],
            &["for-each-ref", "--format=%(refname)", "refs/heads"],
            &["grep", "-n", "-I", "-z", "-F", "-e", "needle"],
            &["merge-base", "main", "HEAD"],
            &["cat-file", "-s", "HEAD:a.txt"],
            &["remote"],
        ] {
            assert_eq!(c(args), Ok(Access::Read), "{args:?}");
        }
    }

    #[test]
    fn network_commands_have_exact_shapes() {
        assert_eq!(c(&["fetch", "origin"]), Ok(Access::Network));
        assert_eq!(c(&["fetch", "--progress", "origin"]), Ok(Access::Network));
        assert_eq!(c(&["push"]), Ok(Access::Network));
        assert_eq!(c(&["push", "--progress"]), Ok(Access::Network));
        assert_eq!(c(&["push", "--progress", "--porcelain"]), Ok(Access::Network));
        assert_eq!(c(&["push", "--progress", "--porcelain", "-u", "origin", "feature/x"]), Ok(Access::Network));
        assert_eq!(c(&["push", "--progress", "-u", "origin", "feature/x"]), Ok(Access::Network));
        assert_eq!(c(&["push", "-u", "origin", "feature/x"]), Ok(Access::Network));
    }

    #[test]
    fn force_delete_and_refspec_tricks_are_refused() {
        for args in [
            &["push", "--force"][..],
            &["push", "-f"],
            &["push", "--force-with-lease"],
            &["push", "--delete", "origin", "x"],
            &["push", "-d", "origin", "x"],
            &["push", "--mirror"],
            &["push", "--all"],
            &["push", "--prune"],
            &["push", "origin", "+main"],
            &["push", "-u", "origin", "+main"],
            &["push", "-u", "origin", ":main"],
            &["push", "-u", "origin", "a:b"],
            &["push", "-u", "origin", "--force"],
            &["push", "-u", "origin", "main", "extra"],
            &["push", "origin"],
            &["fetch", "--all"],
            &["fetch", "origin", "+refs/heads/*:refs/heads/*"],
            &["fetch", "--prune", "origin"],
            &["fetch", "-u", "origin"],
        ] {
            assert!(c(args).is_err(), "should refuse {args:?}");
        }
    }

    #[test]
    fn mutating_commands_are_refused() {
        for args in [
            &["checkout", "main"][..],
            &["switch", "main"],
            &["commit", "-m", "x"],
            &["add", "."],
            &["reset", "--hard"],
            &["stash"],
            &["pull"],
            &["clone"],
            &["merge", "x"],
            &["rebase", "x"],
            &["restore", "a"],
            &["clean", "-fdx"],
            &["gc"],
            &["config", "user.name", "x"],
            &["update-ref", "refs/heads/x", "HEAD"],
            &["worktree", "add", "x"],
            &["worktree", "remove", "x"],
            &["worktree", "prune"],
            &["branch", "-D", "x"],
            &["branch", "new-branch"],
            &["branch", "-m", "a", "b"],
            &["remote", "add", "x", "y"],
            &["remote", "remove", "origin"],
            &[],
        ] {
            assert!(c(args).is_err(), "should refuse {args:?}");
        }
    }

    #[test]
    fn clone_takes_a_known_kind_of_address() {
        for url in [
            "https://example.com/user/example.git",
            "https://token@example.com/user/example",
            "ssh://git@example.com/user/example.git",
            "ssh://git@example.com:2222/user/example.git",
            "git@example.com:user/example.git",
            "example.com:user/example.git",
        ] {
            assert_eq!(c(&["clone", "--progress", "--", url, "example"]), Ok(Access::Network), "{url}");
        }
    }

    #[test]
    fn clone_refuses_addresses_that_run_programs_or_read_local_paths() {
        for url in [
            "ext::sh -c touch% /tmp/x",
            "ext::sh",
            "fd::3",
            "file:///tmp/example",
            "/tmp/example",
            "C:\\src\\example",
            "C:/src/example",
            "http://example.com/user/example",
            "git://example.com/user/example",
            "ssh://-oProxyCommand=x/example",
            "ssh://%2doProxyCommand=x/example",
            "ssh://user@-host/example",
            "ssh://user:-secret@host/example",
            "ssh://@host/example",
            "-oProxyCommand=x@example.com:path",
            "git@example.com:-path",
            "git@example.com:",
            "https://example.com",
            "https://exa mple.com/x",
            "https://example.com/x\nfoo",
            "",
        ] {
            assert!(c(&["clone", "--progress", "--", url, "example"]).is_err(), "should refuse {url}");
        }
    }

    #[test]
    fn clone_has_one_shape_and_stays_inside_its_folder() {
        let url = "https://example.com/user/example.git";
        for args in [
            &["clone", url, "example"][..],
            &["clone", "--progress", url, "example"],
            &["clone", "--progress", "--", url],
            &["clone", "--progress", "--", url, "example", "extra"],
            &["clone", "--progress", "--recurse-submodules", "--", url, "example"],
            &["clone", "--progress", "-c", "core.hooksPath=x", "--", url, "example"],
            &["clone", "--progress", "--", url, ""],
            &["clone", "--progress", "--", url, "."],
            &["clone", "--progress", "--", url, ".."],
            &["clone", "--progress", "--", url, "../example"],
            &["clone", "--progress", "--", url, "a/b"],
            &["clone", "--progress", "--", url, "a\\b"],
            &["clone", "--progress", "--", url, "C:\\example"],
            &["clone", "--progress", "--", url, "/tmp/example"],
            &["clone", "--progress", "--", url, "-example"],
        ] {
            assert!(c(args).is_err(), "should refuse {args:?}");
        }
    }

    #[test]
    fn global_options_cannot_be_smuggled_in_front_of_the_subcommand() {
        assert!(c(&["-c", "core.pager=sh", "status"]).is_err());
        assert!(c(&["-C", "/tmp", "status"]).is_err());
        assert!(c(&["--git-dir=/x", "status"]).is_err());
    }

    #[test]
    fn options_that_write_files_or_run_programs_are_refused() {
        assert!(c(&["diff", "--output=/tmp/x"]).is_err());
        assert!(c(&["diff", "--output", "/tmp/x"]).is_err());
        assert!(c(&["log", "--output=x"]).is_err());
        assert!(c(&["diff", "--ext-diff"]).is_err());
        assert!(c(&["grep", "-O", "x"]).is_err());
        assert!(c(&["grep", "--open-files-in-pager=vim", "x"]).is_err());
        assert!(c(&["show", "--output=x", "HEAD"]).is_err());
    }

    #[test]
    fn paths_after_double_dash_are_not_treated_as_options() {
        assert_eq!(c(&["log", "--format=%H", "--", "--output=x"]), Ok(Access::Read));
        assert_eq!(c(&["grep", "-e", "-O", "--", "a"]), Ok(Access::Read));
    }

    #[test]
    fn blame_is_allowed_only_as_porcelain_of_one_path() {
        assert_eq!(c(&["blame", "--porcelain", "--", "src/a b.ts"]), Ok(Access::Read));
        assert_eq!(c(&["blame", "--porcelain", "HEAD", "--", "a.ts"]), Ok(Access::Read));
        assert_eq!(c(&["blame", "--porcelain", "refs/heads/feature/x", "--", "--output=x"]), Ok(Access::Read));
        for args in [
            &["blame"][..],
            &["blame", "a.ts"],
            &["blame", "--porcelain", "a.ts"],
            &["blame", "--porcelain", "--"],
            &["blame", "--porcelain", "--", "a.ts", "b.ts"],
            &["blame", "--porcelain", "--contents", "/etc/passwd", "--", "a.ts"],
            &["blame", "--porcelain", "--contents=/etc/passwd", "--", "a.ts"],
            &["blame", "--porcelain", "-S", "revs.txt", "--", "a.ts"],
            &["blame", "--porcelain", "--ignore-revs-file=x", "--", "a.ts"],
            &["blame", "--porcelain", "--output=x", "--", "a.ts"],
            &["blame", "--porcelain", "-w", "--", "a.ts"],
            &["blame", "-p", "--", "a.ts"],
            &["blame", "--porcelain", "HEAD", "main", "--", "a.ts"],
        ] {
            assert!(c(args).is_err(), "should refuse {args:?}");
        }
    }

    #[test]
    fn branch_is_only_allowed_for_listing() {
        assert_eq!(c(&["branch", "-a", "--format=%(refname)"]), Ok(Access::Read));
        assert_eq!(c(&["branch", "--list", "--no-color"]), Ok(Access::Read));
    }
}
