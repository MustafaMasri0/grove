//! Which files Grove may change. Everything else stays read-only: only local
//! settings and secrets that agents should not write (`.env` and the like), named
//! by the user's patterns, and never a file a tool owns, whatever the patterns say.

use serde::Deserialize;

/// The patterns a fresh install starts with. The settings UI reads the same file.
pub const DEFAULTS_JSON: &str = include_str!("editable_defaults.json");

/// Files no pattern can make editable: git's own, and state tools write themselves,
/// where a hand edit can break more than the file.
const PROTECTED_DIRS: &[&str] = &[".git", ".terraform"];
const PROTECTED_FILES: &[&str] = &["*.tfstate", "*.tfstate.*", ".terraform.lock.hcl", ".git"];

pub fn default_patterns() -> Vec<String> {
    serde_json::from_str(DEFAULTS_JSON).expect("editable_defaults.json is a list of strings")
}

/// Why `path` (relative to a worktree, or absolute) is never editable, if it is not.
/// The hosts check this again before writing, whatever the caller decided.
pub fn protected(path: &str) -> Option<String> {
    // As the file system resolves names: Windows and macOS ignore case, and Windows drops trailing dots and spaces.
    let parts: Vec<String> = path.split(['/', '\\']).map(|p| p.trim_end_matches(['.', ' ']).to_ascii_lowercase()).filter(|p| !p.is_empty()).collect();
    let (name, dirs) = parts.split_last()?;
    if let Some(dir) = dirs.iter().find(|d| PROTECTED_DIRS.contains(&d.as_str())) {
        return Some(format!("files inside {dir} are never edited"));
    }
    PROTECTED_FILES.iter().any(|p| glob(p, name)).then(|| format!("{name} is written by a tool and is never edited by hand"))
}

/// Ok when `rel` is a `/`-separated path that stays inside the worktree.
pub fn inside_worktree(rel: &str) -> Result<(), String> {
    if rel.is_empty() || rel.starts_with(['/', '\\']) || rel.contains('\\') || rel.contains(':') || rel.split('/').any(|p| p.is_empty() || p == "." || p == "..") {
        return Err(format!("{rel} is not a path inside the worktree"));
    }
    Ok(())
}

/// The user's list of editable files: gitignore-style patterns.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(transparent)]
pub struct Rules(Vec<String>);

impl Default for Rules {
    fn default() -> Self {
        Self(default_patterns())
    }
}

impl Rules {
    pub fn new(patterns: Vec<String>) -> Self {
        Self(patterns)
    }

    /// The rules in a saved settings.json (`editableFiles`), read as the UI's `normalizeSettings` reads
    /// them: entries that are not strings are dropped, and the defaults apply only when it holds no list.
    pub fn from_settings(settings: &serde_json::Value) -> Self {
        settings
            .get("editableFiles")
            .and_then(|v| v.as_array())
            .map(|list| Self(list.iter().filter_map(|p| p.as_str().map(str::to_string)).collect()))
            .unwrap_or_default()
    }

    /// Ok when `rel`, a path relative to the worktree with `/`, may be edited.
    pub fn check(&self, rel: &str) -> Result<(), String> {
        inside_worktree(rel)?;
        if let Some(why) = protected(rel) {
            return Err(why);
        }
        if self.0.iter().any(|p| matches(p, rel)) {
            Ok(())
        } else {
            Err(format!("{rel} is read-only: it matches none of the editable files in Settings"))
        }
    }

    pub fn allows(&self, rel: &str) -> bool {
        self.check(rel).is_ok()
    }
}

/// gitignore-style: a pattern without `/` matches the file name in any folder; one with `/`
/// matches the whole path from the worktree root, where `**` spans folders.
fn matches(pattern: &str, rel: &str) -> bool {
    let pattern = pattern.trim();
    if pattern.is_empty() || pattern.starts_with('#') {
        return false;
    }
    match pattern.trim_start_matches('/') {
        p if p.contains('/') || pattern.starts_with('/') => glob(p, rel),
        p => glob(p, rel.rsplit('/').next().unwrap_or(rel)),
    }
}

/// `*` and `?` stay within one folder; `**` matches across folders.
fn glob(pattern: &str, text: &str) -> bool {
    fn go(p: &[u8], t: &[u8]) -> bool {
        match p {
            [] => t.is_empty(),
            // `**/`: any number of whole folders, none included.
            [b'*', b'*', b'/', rest @ ..] => (0..=t.len()).any(|i| (i == 0 || t[i - 1] == b'/') && go(rest, &t[i..])),
            [b'*', b'*', rest @ ..] => (0..=t.len()).any(|i| go(rest, &t[i..])),
            [b'*', rest @ ..] => (0..=t.len()).take_while(|&i| i == 0 || t[i - 1] != b'/').any(|i| go(rest, &t[i..])),
            [b'?', rest @ ..] => t.first().is_some_and(|&c| c != b'/') && go(rest, &t[1..]),
            [c, rest @ ..] => t.first() == Some(c) && go(rest, &t[1..]),
        }
    }
    go(pattern.as_bytes(), text.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rules(p: &[&str]) -> Rules {
        Rules::new(p.iter().map(|s| s.to_string()).collect())
    }

    #[test]
    fn the_defaults_cover_env_files_local_config_and_terraform_variables() {
        let r = Rules::default();
        for ok in [".env", ".env.local", "api/.env.production", "config.local.toml", "src/app.local.json", "terraform.tfvars", "infra/prod.auto.tfvars", ".dev.vars"] {
            assert!(r.allows(ok), "{ok}");
        }
        for no in ["src/main.ts", "env", "my.env", "README.md", "terraform.tfstate", "infra/.terraform/x.tfvars", "package.json"] {
            assert!(!r.allows(no), "{no}");
        }
    }

    #[test]
    fn patterns_without_a_slash_match_names_in_any_folder() {
        let r = rules(&["*.secret", "appsettings.Development.json"]);
        assert!(r.allows("a/b/c.secret"));
        assert!(r.allows("api/appsettings.Development.json"));
        assert!(!r.allows("a/b.secret/c"));
    }

    #[test]
    fn patterns_with_a_slash_match_from_the_root() {
        let r = rules(&["config/*.json", "/deploy/values.yaml", "secrets/**/*.yaml"]);
        assert!(r.allows("config/dev.json"));
        assert!(!r.allows("config/nested/dev.json"));
        assert!(!r.allows("app/config/dev.json"));
        assert!(r.allows("deploy/values.yaml"));
        assert!(r.allows("secrets/a.yaml"));
        assert!(r.allows("secrets/x/y/a.yaml"));
        assert!(!r.allows("other/secrets/a.yaml"));
    }

    #[test]
    fn blank_and_comment_lines_match_nothing() {
        let r = rules(&["", "  ", "# .env"]);
        assert!(!r.allows(".env"));
    }

    #[test]
    fn tool_owned_files_stay_protected_whatever_the_patterns() {
        let r = rules(&["*", "**", "**/*"]);
        assert!(r.allows("anything.txt"));
        for no in [".git/config", "sub/.git", "terraform.tfstate", "infra/terraform.tfstate.backup", ".terraform/modules/x.json", ".terraform.lock.hcl"] {
            assert!(r.check(no).is_err(), "{no}");
        }
    }

    #[test]
    fn paths_that_leave_the_worktree_are_refused() {
        let r = rules(&["*", "**"]);
        for no in ["", "/etc/passwd", "../.env", "a/../../.env", "a//b", "./.env", "C:/x/.env", "a\\.env"] {
            assert!(r.check(no).is_err(), "{no}");
        }
    }

    #[test]
    fn protected_reads_absolute_paths_of_any_system() {
        assert!(protected("/home/user/src/example/.git/config").is_some());
        assert!(protected(r"C:\src\example\.terraform\x").is_some());
        assert!(protected(r"C:\src\example\prod.tfstate").is_some());
        assert!(protected("/home/user/src/example/.env").is_none());
    }

    #[test]
    fn settings_without_the_key_or_with_a_bad_value_get_the_defaults() {
        assert_eq!(Rules::from_settings(&serde_json::json!({})), Rules::default());
        assert_eq!(Rules::from_settings(&serde_json::json!({ "editableFiles": 3 })), Rules::default());
        assert_eq!(Rules::from_settings(&serde_json::json!({ "editableFiles": [] })), rules(&[]));
        assert_eq!(Rules::from_settings(&serde_json::json!({ "editableFiles": ["a"] })), rules(&["a"]));
        // Like the UI: a bad entry is dropped, it does not bring back the defaults.
        assert_eq!(Rules::from_settings(&serde_json::json!({ "editableFiles": ["a", 1, null] })), rules(&["a"]));
    }

    #[test]
    fn protected_names_ignore_case_and_trailing_dots_and_spaces() {
        let r = rules(&["*", "**"]);
        for no in [".GIT/config", ".git./config", ".Git /HEAD", ".TERRAFORM/x.json", "PROD.TFSTATE", "prod.tfstate.", "sub/.GIT"] {
            assert!(r.check(no).is_err(), "{no}");
        }
    }
}
