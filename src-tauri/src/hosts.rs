//! Picks the GitHost for a repository from its path: Windows paths use git.exe
//! directly, `\\wsl.localhost\<distro>\...` paths go through one long-running
//! helper per distro.

use std::collections::HashMap;
use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use wv_core::helper_client::HelperClient;
use wv_core::host::GitHost;
use wv_core::local::LocalHost;
use wv_core::paths::{route, Route};

static HELPER: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/wv-helper"));
const HELPER_HASH: &str = env!("WV_HELPER_HASH");
/// Exit code of the launcher script when the helper is not installed yet.
const NOT_INSTALLED: &str = "87";

#[derive(Default)]
pub struct Hosts {
    local: Arc<LocalHost>,
    wsl: Mutex<HashMap<String, Arc<HelperClient>>>,
}

impl Hosts {
    /// The host for a repository and the path to use on that host.
    pub fn resolve(&self, repo_path: &str) -> Result<(Arc<dyn GitHost>, Route), String> {
        let r = route(repo_path);
        let host: Arc<dyn GitHost> = match &r {
            Route::Local { .. } => self.local.clone(),
            Route::Wsl { distro, .. } => self.helper(distro)?,
        };
        Ok((host, r))
    }

    /// The host only; `cwd` arguments from the UI are already host paths.
    pub fn host(&self, repo_path: &str) -> Result<Arc<dyn GitHost>, String> {
        self.resolve(repo_path).map(|(h, _)| h)
    }

    fn helper(&self, distro: &str) -> Result<Arc<HelperClient>, String> {
        let mut map = self.wsl.lock().unwrap();
        if let Some(h) = map.get(distro).filter(|h| h.is_alive()) {
            return Ok(h.clone());
        }
        let client = match HelperClient::spawn(launch(distro)) {
            Ok(c) => c,
            Err(_) => {
                install(distro)?;
                HelperClient::spawn(launch(distro)).map_err(|e| format!("WSL helper in {distro}: {e}"))?
            }
        };
        let client = Arc::new(client);
        map.insert(distro.to_string(), client.clone());
        Ok(client)
    }
}

fn helper_dir() -> &'static str {
    "$HOME/.local/share/grove"
}

fn wsl(distro: &str, script: &str) -> Command {
    let mut c = Command::new("wsl.exe");
    c.args(["-d", distro, "--exec", "/bin/sh", "-c", script]);
    c.stderr(Stdio::null());
    c
}

fn launch(distro: &str) -> Command {
    let script = format!(
        r#"f="{dir}/helper-{HELPER_HASH}"; [ -x "$f" ] || exit {NOT_INSTALLED}; exec "$f""#,
        dir = helper_dir()
    );
    wsl(distro, &script)
}

/// Copies the embedded helper into the distro, replacing older versions.
fn install(distro: &str) -> Result<(), String> {
    if HELPER.is_empty() {
        return Err("this build has no WSL helper (scripts/build-helper.sh was not run)".into());
    }
    let script = format!(
        r#"set -e; d="{dir}"; mkdir -p "$d"; rm -f "$d"/helper-*; cat > "$d/helper-{HELPER_HASH}.tmp"; chmod 755 "$d/helper-{HELPER_HASH}.tmp"; mv "$d/helper-{HELPER_HASH}.tmp" "$d/helper-{HELPER_HASH}""#,
        dir = helper_dir()
    );
    let mut cmd = wsl(distro, &script);
    cmd.stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::piped());
    wv_core::exec::hide_console(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| format!("could not start wsl.exe: {e}"))?;
    child.stdin.take().unwrap().write_all(HELPER).map_err(|e| format!("installing WSL helper: {e}"))?;
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!(
            "installing the WSL helper into {distro} failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(())
}
