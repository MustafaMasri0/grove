//! Picks the GitHost for a repository from its path: local paths use git directly,
//! WSL and `ssh://` paths go through one long-running helper per distro or host.

use std::sync::{Arc, OnceLock};
use wv_core::helper_client::HelperClient;
use wv_core::host::GitHost;
use wv_core::local::LocalHost;
use wv_core::paths::{route, Route};
use wv_core::remote::{connect, Connections, HelperBinary, OnLost, Shell, WslDistro};

include!(concat!(env!("OUT_DIR"), "/helpers.rs"));

#[derive(Default)]
pub struct Hosts {
    local: Arc<LocalHost>,
    remote: Connections,
    on_lost: OnceLock<OnLost>,
}

impl Hosts {
    /// `f` runs whenever a connection goes away, which also ends its watches.
    pub fn on_lost(&self, f: impl Fn() + Send + Sync + 'static) {
        let _ = self.on_lost.set(Arc::new(f));
    }

    /// The host for a repository and the path to use on that host.
    pub fn resolve(&self, repo_path: &str) -> Result<(Arc<dyn GitHost>, Route), String> {
        let r = route(repo_path)?;
        let host: Arc<dyn GitHost> = match &r {
            Route::Local { .. } => self.local.clone(),
            Route::Wsl { distro, .. } if cfg!(windows) => self.helper(&WslDistro(distro.clone()))?,
            Route::Wsl { .. } => return Err("WSL repositories can only be opened on Windows".into()),
            Route::Ssh { target, .. } => self.helper(target)?,
        };
        Ok((host, r))
    }

    /// The host only; `cwd` arguments from the UI are already host paths.
    pub fn host(&self, repo_path: &str) -> Result<Arc<dyn GitHost>, String> {
        self.resolve(repo_path).map(|(h, _)| h)
    }

    /// The host if it can be used right now, without connecting.
    pub fn connected(&self, repo_path: &str) -> Option<Arc<dyn GitHost>> {
        match route(repo_path).ok()? {
            Route::Local { .. } => Some(self.local.clone()),
            Route::Wsl { distro, .. } => Some(self.remote.current(&WslDistro(distro))?),
            Route::Ssh { target, .. } => Some(self.remote.current(&target)?),
        }
    }

    fn helper(&self, shell: &dyn Shell) -> Result<Arc<HelperClient>, String> {
        self.remote.get(shell, || {
            let on_lost = self.on_lost.get().cloned().unwrap_or_else(|| Arc::new(|| {}));
            connect(shell, HELPERS, on_lost)
        })
    }
}
