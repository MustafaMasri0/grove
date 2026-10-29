//! Decides where a repository path lives: on Windows itself, or inside a WSL
//! distro reached through `\\wsl.localhost\<distro>\...` / `\\wsl$\<distro>\...`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Route {
    /// A path the current OS can use directly (C:\..., D:\..., or a Linux path inside the helper).
    Local { path: String },
    /// A path inside a WSL distro; `linux_path` is absolute, with forward slashes.
    Wsl { distro: String, linux_path: String },
}

pub fn route(input: &str) -> Route {
    let trimmed = input.trim();
    if let Some(r) = wsl_route(trimmed) {
        return r;
    }
    Route::Local { path: trim_trailing_separator(trimmed).to_string() }
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
