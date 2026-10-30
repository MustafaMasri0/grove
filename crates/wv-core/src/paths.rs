//! Decides where a repository path lives: on this machine, inside a WSL distro
//! reached through `\\wsl.localhost\<distro>\...` / `\\wsl$\<distro>\...`, or on
//! another machine reached through `ssh://[user@]host[:port]/path`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Route {
    /// A path the current OS can use directly (C:\..., D:\..., or a Linux path inside the helper).
    Local { path: String },
    /// A path inside a WSL distro; `linux_path` is absolute, with forward slashes.
    Wsl { distro: String, linux_path: String },
    /// A path on an SSH host: absolute, or relative to the home folder the helper starts in.
    Ssh { target: SshTarget, path: String },
}

/// What to hand `ssh`. `host` may be an alias from the user's ssh config.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SshTarget {
    pub user: Option<String>,
    pub host: String,
    pub port: Option<u16>,
}

impl SshTarget {
    /// `user@host:port`, the parts given.
    pub fn authority(&self) -> String {
        let host = if self.host.contains(':') { format!("[{}]", self.host) } else { self.host.clone() };
        let user = self.user.as_ref().map(|u| format!("{u}@")).unwrap_or_default();
        let port = self.port.map(|p| format!(":{p}")).unwrap_or_default();
        format!("{user}{host}{port}")
    }
}

/// Where `input` lives. `Err` is an `ssh://` address that cannot be used.
pub fn route(input: &str) -> Result<Route, String> {
    let trimmed = input.trim();
    if let Some(rest) = trimmed.get(..6).filter(|s| s.eq_ignore_ascii_case("ssh://")).map(|s| &trimmed[s.len()..]) {
        return ssh_route(rest).map_err(|e| format!("{trimmed}: {e}"));
    }
    if let Some(r) = wsl_route(trimmed) {
        return Ok(r);
    }
    Ok(Route::Local { path: trim_trailing_separator(trimmed).to_string() })
}

fn ssh_route(rest: &str) -> Result<Route, String> {
    const USAGE: &str = "expected ssh://[user@]host[:port]/path";
    let (authority, path) = rest.split_once('/').ok_or(USAGE)?;
    if path.trim_end_matches('/').is_empty() {
        return Err(USAGE.into());
    }
    let (user, host_port) = match authority.rsplit_once('@') {
        Some((user, rest)) => (Some(user), rest),
        None => (None, authority),
    };
    let (host, port) = split_port(host_port)?;
    // These become arguments of ssh: a name starting with `-` would be read as an option.
    if !valid_ssh_name(host, ".-_:%") {
        return Err(format!("{host:?} is not a host name"));
    }
    if let Some(user) = user.filter(|u| !valid_ssh_name(u, ".-_")) {
        return Err(format!("{user:?} is not a user name"));
    }
    let target = SshTarget { user: user.map(str::to_string), host: host.to_string(), port };
    Ok(Route::Ssh { target, path: ssh_host_path(path) })
}

fn split_port(host_port: &str) -> Result<(&str, Option<u16>), String> {
    if let Some(rest) = host_port.strip_prefix('[') {
        let (host, tail) = rest.split_once(']').ok_or("unclosed [ in the host")?;
        return match tail.strip_prefix(':') {
            Some(port) => Ok((host, Some(parse_port(port)?))),
            None if tail.is_empty() => Ok((host, None)),
            None => Err(format!("unexpected {tail:?} after the host")),
        };
    }
    match host_port.split_once(':') {
        Some((host, port)) => Ok((host, Some(parse_port(port)?))),
        None => Ok((host_port, None)),
    }
}

fn parse_port(port: &str) -> Result<u16, String> {
    port.parse().ok().filter(|p| *p != 0).ok_or_else(|| format!("{port:?} is not a port"))
}

fn valid_ssh_name(name: &str, punctuation: &str) -> bool {
    !name.is_empty() && !name.starts_with('-') && name.chars().all(|c| c.is_ascii_alphanumeric() || punctuation.contains(c))
}

/// `path` is what followed the host's `/`. `~/x` becomes relative, which means the
/// home folder since that is where the helper starts; `C:/x` is a Windows host's path.
fn ssh_host_path(path: &str) -> String {
    let path = path.trim_end_matches('/');
    if path == "~" {
        return ".".into();
    }
    if let Some(rest) = path.strip_prefix("~/") {
        return rest.to_string();
    }
    let drive = path.as_bytes().first().is_some_and(u8::is_ascii_alphabetic) && path[1..].starts_with(':');
    if drive { path.to_string() } else { format!("/{path}") }
}

/// A host path as the user sees it: what can be pasted into that machine's tools.
pub fn display_path(route: &Route, path: &str) -> String {
    match route {
        Route::Wsl { distro, .. } => wsl_unc(distro, path),
        Route::Ssh { .. } => path.to_string(),
        Route::Local { .. } => path.replace('/', &local_separator().to_string()),
    }
}

/// The separator of paths on this machine, as shown to the user.
pub fn local_separator() -> char {
    if cfg!(windows) { '\\' } else { '/' }
}

fn wsl_route(input: &str) -> Option<Route> {
    let unified = input.replace('\\', "/");
    let rest = unified
        .strip_prefix("//?/UNC/")
        .or_else(|| unified.strip_prefix("//"))?;
    let mut parts = rest.split('/').filter(|p| !p.is_empty());
    let host = parts.next()?;
    if !host.eq_ignore_ascii_case("wsl.localhost") && !host.eq_ignore_ascii_case("wsl$") {
        return None;
    }
    let distro = parts.next()?.to_string();
    let linux_path = format!("/{}", parts.collect::<Vec<_>>().join("/"));
    Some(Route::Wsl { distro, linux_path })
}

fn trim_trailing_separator(p: &str) -> &str {
    let t = p.trim_end_matches(['\\', '/']);
    // Keep the separator of a drive root (C:\) and of the filesystem root (/).
    if t.len() == 2 && t.ends_with(':') || t.is_empty() {
        &p[..(t.len() + 1).min(p.len())]
    } else {
        t
    }
}

/// The Windows UNC form of a path inside a distro, for display and for the folder picker.
pub fn wsl_unc(distro: &str, linux_path: &str) -> String {
    let tail = linux_path.trim_start_matches('/').replace('/', "\\");
    format!(r"\\wsl.localhost\{distro}\{tail}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn route(input: &str) -> Route {
        super::route(input).unwrap()
    }

    fn ssh(user: Option<&str>, host: &str, port: Option<u16>, path: &str) -> Route {
        let target = SshTarget { user: user.map(str::to_string), host: host.into(), port };
        Route::Ssh { target, path: path.into() }
    }

    #[test]
    fn ssh_addresses_name_a_host_and_a_path() {
        assert_eq!(route("ssh://build/home/user/src/example/"), ssh(None, "build", None, "/home/user/src/example"));
        assert_eq!(route("ssh://dev@build.example.com:2222/srv/x"), ssh(Some("dev"), "build.example.com", Some(2222), "/srv/x"));
        assert_eq!(route("SSH://build/srv/a b/ü"), ssh(None, "build", None, "/srv/a b/ü"));
        assert_eq!(route("ssh://[2001:db8::1]:22/srv"), ssh(None, "2001:db8::1", Some(22), "/srv"));
    }

    #[test]
    fn ssh_paths_may_start_at_home_or_on_a_windows_drive() {
        assert_eq!(route("ssh://build/~/src/x"), ssh(None, "build", None, "src/x"));
        assert_eq!(route("ssh://build/~"), ssh(None, "build", None, "."));
        assert_eq!(route("ssh://build/C:/src/x"), ssh(None, "build", None, "C:/src/x"));
    }

    #[test]
    fn nothing_in_an_ssh_address_can_become_an_ssh_option() {
        for bad in ["ssh://-oProxyCommand=calc/x", "ssh://-x@build/x", "ssh://a b/x", "ssh://us;er@build/x", "ssh://build:0/x", "ssh://build:port/x"] {
            assert!(super::route(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn an_ssh_address_needs_a_path() {
        assert!(super::route("ssh://build").is_err());
        assert!(super::route("ssh://build/").is_err());
    }

    #[test]
    fn ssh_authority_round_trips() {
        for a in ["build", "dev@build:2222", "dev@[2001:db8::1]:22"] {
            let Route::Ssh { target, .. } = route(&format!("ssh://{a}/x")) else { panic!() };
            assert_eq!(target.authority(), a);
        }
    }

    #[test]
    fn display_paths_are_what_each_machine_calls_them() {
        let wsl_route = wsl("Ubuntu", "/");
        assert_eq!(display_path(&wsl_route, "/home/x"), r"\\wsl.localhost\Ubuntu\home\x");
        assert_eq!(display_path(&ssh(None, "build", None, "/"), "/home/x"), "/home/x");
        let local = Route::Local { path: "x".into() };
        assert_eq!(display_path(&local, "a/b"), format!("a{0}b", local_separator()));
    }

    fn wsl(distro: &str, p: &str) -> Route {
        Route::Wsl { distro: distro.into(), linux_path: p.into() }
    }

    #[test]
    fn wsl_localhost_paths_route_to_the_distro() {
        assert_eq!(
            route(r"\\wsl.localhost\Ubuntu-24.04\home\user\src\example"),
            wsl("Ubuntu-24.04", "/home/user/src/example")
        );
    }

    #[test]
    fn wsl_dollar_paths_route_to_the_distro() {
        assert_eq!(route(r"\\wsl$\Ubuntu\home\me\repo\"), wsl("Ubuntu", "/home/me/repo"));
    }

    #[test]
    fn host_name_is_case_insensitive_and_forward_slashes_work() {
        assert_eq!(route("//WSL.LOCALHOST/Debian/srv/x"), wsl("Debian", "/srv/x"));
        assert_eq!(route(r"\\WSL$\Debian\srv"), wsl("Debian", "/srv"));
    }

    #[test]
    fn long_unc_prefix_from_the_folder_picker_is_understood() {
        assert_eq!(route(r"\\?\UNC\wsl.localhost\Ubuntu\home\a b"), wsl("Ubuntu", "/home/a b"));
    }

    #[test]
    fn distro_root_maps_to_slash() {
        assert_eq!(route(r"\\wsl.localhost\Ubuntu"), wsl("Ubuntu", "/"));
        assert_eq!(route(r"\\wsl.localhost\Ubuntu\"), wsl("Ubuntu", "/"));
    }

    #[test]
    fn unicode_and_spaces_survive() {
        assert_eq!(route(r"\\wsl.localhost\Ubuntu\home\ü ñ\✓"), wsl("Ubuntu", "/home/ü ñ/✓"));
    }

    #[test]
    fn windows_drive_paths_stay_local_without_trailing_separator() {
        assert_eq!(route(r"D:\src\example\"), Route::Local { path: r"D:\src\example".into() });
        assert_eq!(route(r"C:\"), Route::Local { path: r"C:\".into() });
        assert_eq!(route("D:/src/x"), Route::Local { path: "D:/src/x".into() });
    }

    #[test]
    fn other_unc_shares_and_linux_paths_stay_local() {
        assert_eq!(route(r"\\server\share\repo"), Route::Local { path: r"\\server\share\repo".into() });
        assert_eq!(route("/home/me/repo/"), Route::Local { path: "/home/me/repo".into() });
        // A host merely starting with "wsl" is not WSL.
        assert_eq!(route(r"\\wslbox\share"), Route::Local { path: r"\\wslbox\share".into() });
    }

    #[test]
    fn unc_round_trip() {
        assert_eq!(wsl_unc("Ubuntu-24.04", "/home/user/src"), r"\\wsl.localhost\Ubuntu-24.04\home\user\src");
        assert_eq!(wsl_unc("Ubuntu", "/"), r"\\wsl.localhost\Ubuntu\");
        let p = wsl_unc("Ubuntu", "/home/x y");
        assert_eq!(route(&p), wsl("Ubuntu", "/home/x y"));
    }
}
