//! The app's one GitHub API client, shared by avatars and issues. It finds the login
//! token, keeps each token's rate limit and holds requests back when it runs low, and
//! sorts GitHub's error answers. Only GET requests, only to the API host, always from
//! the app itself (never through a WSL or SSH helper).

use async_trait::async_trait;
use serde::de::DeserializeOwned;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const API: &str = "https://api.github.com";
/// Below this many requests left, timed checks and avatar lookups stop until the reset.
const LOW: u32 = 500;
/// GitHub asks clients to wait at least a minute after a secondary limit without `retry-after`.
const SECONDARY_WAIT: u64 = 60;
const MAX_BODY: usize = 16 << 20;

/// The HTTP client for everything the app downloads: HTTPS through the OS's own TLS.
pub fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .user_agent(concat!("Grove/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("HTTP client")
    })
}

/// Who a request is for: the user waiting on it, or work done in the background
/// (timed checks, avatar lookups), which yields when requests run low.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Purpose {
    User,
    Background,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ApiError {
    NotFound { signed_in: bool },
    /// 410, with GitHub's message (issues turned off, or the issue deleted).
    Gone { message: String },
    SingleSignOn { url: Option<String> },
    Unauthorized,
    RateLimited { resets_at: u64 },
    /// Held back without sending: few requests left, or (None) background work without a login.
    Paused { resets_at: Option<u64> },
    Network(String),
    Status(u16),
}

pub struct Reply {
    pub status: u16,
    /// Names in lower case.
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl Reply {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }

    fn number(&self, name: &str) -> Option<u64> {
        self.header(name)?.trim().parse().ok()
    }

    pub fn not_modified(&self) -> bool {
        self.status == 304
    }

    /// The `rel="next"` page from the `Link` header, when it is on the API host.
    pub fn next_link(&self) -> Option<String> {
        self.header("link")?.split(',').find_map(|part| {
            let (url, params) = part.trim().split_once(';')?;
            let url = url.trim().strip_prefix('<')?.strip_suffix('>')?;
            let next = params.split(';').any(|p| p.trim() == r#"rel="next""#);
            (next && is_api_url(url)).then(|| url.to_string())
        })
    }

    pub fn json<T: DeserializeOwned>(&self) -> Result<T, ApiError> {
        serde_json::from_slice(&self.body).map_err(|e| ApiError::Network(format!("unexpected answer from GitHub: {e}")))
    }

    fn message(&self) -> String {
        serde_json::from_slice::<serde_json::Value>(&self.body)
            .ok()
            .and_then(|v| v.get("message")?.as_str().map(str::to_string))
            .unwrap_or_default()
    }
}

fn is_api_url(url: &str) -> bool {
    url.strip_prefix(API).is_some_and(|rest| rest.starts_with('/'))
}

/// Sends a GET. A seam so tests can answer from canned JSON.
#[async_trait]
pub trait Transport: Send + Sync {
    async fn get(&self, url: &str, headers: Vec<(&'static str, String)>) -> Result<Reply, String>;
}

struct Https;

#[async_trait]
impl Transport for Https {
    async fn get(&self, url: &str, headers: Vec<(&'static str, String)>) -> Result<Reply, String> {
        let mut req = http().get(url);
        for (k, v) in headers {
            req = req.header(k, v);
        }
        let mut resp = req.send().await.map_err(|e| e.to_string())?;
        let status = resp.status().as_u16();
        let headers = resp
            .headers()
            .iter()
            .filter_map(|(k, v)| Some((k.as_str().to_string(), v.to_str().ok()?.to_string())))
            .collect();
        let mut body = Vec::new();
        while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
            if body.len() + chunk.len() > MAX_BODY {
                return Err("the answer is too large".into());
            }
            body.extend_from_slice(&chunk);
        }
        Ok(Reply { status, headers, body })
    }
}

/// Finds the login token for an account (None: the default one). May block.
pub trait TokenSource: Send + Sync {
    fn read(&self, account: Option<&str>) -> Option<String>;
}

/// GH_TOKEN, GITHUB_TOKEN, then the GitHub CLI's login, as on the desktop.
struct DesktopTokens;

impl TokenSource for DesktopTokens {
    fn read(&self, account: Option<&str>) -> Option<String> {
        read_token(|var| std::env::var(var).ok(), run_gh, account)
    }
}

/// The token order. Environment tokens win and make the account setting moot.
pub fn read_token(env: impl Fn(&str) -> Option<String>, gh: impl Fn(Option<&str>) -> Option<String>, account: Option<&str>) -> Option<String> {
    let clean = |t: String| Some(t.trim().to_string()).filter(|t| !t.is_empty());
    ["GH_TOKEN", "GITHUB_TOKEN"].iter().find_map(|var| env(var).and_then(clean)).or_else(|| gh(account).and_then(clean))
}

fn is_login(s: &str) -> bool {
    !s.is_empty() && !s.starts_with('-') && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// `gh auth token [--user <login>]`.
fn run_gh(account: Option<&str>) -> Option<String> {
    let mut args = vec!["auth", "token"];
    if let Some(login) = account {
        if !is_login(login) {
            return None;
        }
        args.extend(["--user", login]);
    }
    for gh in ["gh", r"C:\Program Files\GitHub CLI\gh.exe"] {
        let mut cmd = std::process::Command::new(gh);
        cmd.args(&args).stdin(std::process::Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        if let Ok(out) = cmd.output() {
            return out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned());
        }
    }
    None
}

/// One token's rate limit, as GitHub last reported it.
#[derive(Default, Clone, Copy, Debug, PartialEq, Eq)]
struct Budget {
    remaining: Option<u32>,
    resets_at: u64,
    /// After a limit reply: nothing is sent before this.
    blocked_until: u64,
}

impl Budget {
    fn allows(&self, purpose: Purpose, now: u64) -> Result<(), ApiError> {
        if now < self.blocked_until {
            return Err(ApiError::RateLimited { resets_at: self.blocked_until });
        }
        if now < self.resets_at {
            match self.remaining {
                Some(0) => return Err(ApiError::RateLimited { resets_at: self.resets_at }),
                Some(n) if n < LOW && purpose == Purpose::Background => return Err(ApiError::Paused { resets_at: Some(self.resets_at) }),
                _ => {}
            }
        }
        Ok(())
    }

    fn record(&mut self, reply: &Reply, now: u64) {
        let core = reply.header("x-ratelimit-resource").is_none_or(|r| r == "core");
        if let (true, Some(remaining), Some(reset)) = (core, reply.number("x-ratelimit-remaining"), reply.number("x-ratelimit-reset")) {
            self.remaining = Some(remaining.min(u32::MAX as u64) as u32);
            self.resets_at = reset;
        }
        if let Some(until) = limited_until(reply, now) {
            self.blocked_until = self.blocked_until.max(until);
        }
    }
}

/// When a reply is a rate-limit refusal: the time to wait for.
fn limited_until(reply: &Reply, now: u64) -> Option<u64> {
    if !matches!(reply.status, 403 | 429) {
        return None;
    }
    if let Some(secs) = reply.number("retry-after") {
        return Some(now + secs);
    }
    if reply.number("x-ratelimit-remaining") == Some(0) {
        return Some(reply.number("x-ratelimit-reset").unwrap_or(now + SECONDARY_WAIT));
    }
    (reply.status == 429 || reply.message().to_lowercase().contains("rate limit")).then_some(now + SECONDARY_WAIT)
}

/// Sorts an answer: Ok for success and 304, otherwise why it failed.
fn classify(reply: &Reply, signed_in: bool, now: u64) -> Result<(), ApiError> {
    match reply.status {
        200..=299 | 304 => Ok(()),
        401 => Err(ApiError::Unauthorized),
        403 | 429 => {
            if let Some(until) = limited_until(reply, now) {
                return Err(ApiError::RateLimited { resets_at: until });
            }
            match reply.header("x-github-sso") {
                Some(sso) if sso.trim_start().starts_with("required") => Err(ApiError::SingleSignOn {
                    url: sso.split(';').find_map(|p| p.trim().strip_prefix("url=")).map(str::to_string),
                }),
                _ => Err(ApiError::Status(reply.status)),
            }
        }
        404 => Err(ApiError::NotFound { signed_in }),
        410 => Err(ApiError::Gone { message: reply.message() }),
        status => Err(ApiError::Status(status)),
    }
}

fn budget_key(token: Option<&str>) -> String {
    match token {
        Some(t) => Sha256::digest(t.as_bytes())[..8].iter().map(|b| format!("{b:02x}")).collect(),
        None => "anonymous".into(),
    }
}

fn unix_now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

pub struct Client {
    transport: Arc<dyn Transport>,
    tokens: Arc<dyn TokenSource>,
    clock: Arc<dyn Fn() -> u64 + Send + Sync>,
    /// Account → its token (None: none found). In memory for the run, never written anywhere.
    token_cache: Mutex<HashMap<Option<String>, Option<String>>>,
    /// Per token (by a hash of it), or "anonymous", which GitHub counts per address.
    budgets: Mutex<HashMap<String, Budget>>,
}

impl Default for Client {
    fn default() -> Self {
        Self::new(Arc::new(Https), Arc::new(DesktopTokens), Arc::new(unix_now))
    }
}

impl Client {
    pub fn new(transport: Arc<dyn Transport>, tokens: Arc<dyn TokenSource>, clock: Arc<dyn Fn() -> u64 + Send + Sync>) -> Self {
        Self { transport, tokens, clock, token_cache: Mutex::default(), budgets: Mutex::default() }
    }

    /// The account's token; looked up again when there was none and the user asks.
    async fn token(&self, account: Option<&str>, reread_missing: bool) -> Option<String> {
        let key = account.map(str::to_string);
        if let Some(cached) = self.token_cache.lock().unwrap().get(&key).cloned() {
            if cached.is_some() || !reread_missing {
                return cached;
            }
        }
        let (tokens, login) = (self.tokens.clone(), key.clone());
        let token = tauri::async_runtime::spawn_blocking(move || tokens.read(login.as_deref())).await.ok().flatten();
        self.token_cache.lock().unwrap().insert(key, token.clone());
        token
    }

    /// GETs an API URL as `account`, with `If-None-Match` when `etag` is given (check
    /// `Reply::not_modified`). After a 401 the token is read again and the request sent once more.
    pub async fn get(&self, account: Option<&str>, purpose: Purpose, url: &str, etag: Option<&str>) -> Result<Reply, ApiError> {
        if !is_api_url(url) {
            return Err(ApiError::Network(format!("not a GitHub API address: {url}")));
        }
        let mut retried = false;
        loop {
            let token = self.token(account, purpose == Purpose::User).await;
            if token.is_none() && purpose == Purpose::Background {
                return Err(ApiError::Paused { resets_at: None });
            }
            let key = budget_key(token.as_deref());
            let budget = self.budgets.lock().unwrap().get(&key).copied().unwrap_or_default();
            budget.allows(purpose, (self.clock)())?;

            let mut headers = vec![("accept", "application/vnd.github+json".to_string()), ("x-github-api-version", "2022-11-28".to_string())];
            if let Some(t) = &token {
                headers.push(("authorization", format!("Bearer {t}")));
            }
            if let Some(e) = etag {
                headers.push(("if-none-match", e.to_string()));
            }
            let reply = self.transport.get(url, headers).await.map_err(ApiError::Network)?;
            let now = (self.clock)();
            self.budgets.lock().unwrap().entry(key).or_default().record(&reply, now);
            match classify(&reply, token.is_some(), now) {
                Ok(()) => return Ok(reply),
                Err(ApiError::Unauthorized) if token.is_some() && !retried => {
                    self.token_cache.lock().unwrap().remove(&account.map(str::to_string));
                    retried = true;
                }
                Err(e) => return Err(e),
            }
        }
    }
}

#[cfg(test)]
pub mod testing {
    //! A transport answering from a queue of canned replies, recording what was sent.

    use super::*;
    use std::collections::VecDeque;
    use std::sync::atomic::{AtomicU64, Ordering};

    #[derive(Debug, Clone)]
    pub struct Sent {
        pub url: String,
        pub headers: Vec<(&'static str, String)>,
    }

    impl Sent {
        pub fn header(&self, name: &str) -> Option<&str> {
            self.headers.iter().find(|(k, _)| *k == name).map(|(_, v)| v.as_str())
        }
    }

    #[derive(Default)]
    pub struct Canned {
        replies: Mutex<VecDeque<Reply>>,
        pub sent: Mutex<Vec<Sent>>,
    }

    #[async_trait]
    impl Transport for Canned {
        async fn get(&self, url: &str, headers: Vec<(&'static str, String)>) -> Result<Reply, String> {
            self.sent.lock().unwrap().push(Sent { url: url.to_string(), headers });
            self.replies.lock().unwrap().pop_front().ok_or_else(|| format!("no canned reply for {url}"))
        }
    }

    pub fn reply(status: u16, headers: &[(&str, &str)], body: &str) -> Reply {
        Reply {
            status,
            headers: headers.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            body: body.as_bytes().to_vec(),
        }
    }

    /// Tokens handed out in order, one per read; the last one repeats.
    pub struct Tokens {
        pub list: Mutex<VecDeque<Option<String>>>,
        pub reads: Mutex<Vec<Option<String>>>,
    }

    impl TokenSource for Tokens {
        fn read(&self, account: Option<&str>) -> Option<String> {
            self.reads.lock().unwrap().push(account.map(str::to_string));
            let mut list = self.list.lock().unwrap();
            if list.len() > 1 { list.pop_front().flatten() } else { list.front().cloned().flatten() }
        }
    }

    pub struct Rig {
        pub client: Arc<Client>,
        pub transport: Arc<Canned>,
        pub tokens: Arc<Tokens>,
        pub now: Arc<AtomicU64>,
    }

    impl Rig {
        pub fn new(tokens: &[Option<&str>]) -> Self {
            let transport = Arc::new(Canned::default());
            let tokens = Arc::new(Tokens {
                list: Mutex::new(tokens.iter().map(|t| t.map(str::to_string)).collect()),
                reads: Mutex::default(),
            });
            let now = Arc::new(AtomicU64::new(1_000));
            let clock = now.clone();
            let client = Arc::new(Client::new(transport.clone(), tokens.clone(), Arc::new(move || clock.load(Ordering::SeqCst))));
            Self { client, transport, tokens, now }
        }

        pub fn answer(&self, r: Reply) -> &Self {
            self.transport.replies.lock().unwrap().push_back(r);
            self
        }

        pub fn sent(&self) -> Vec<Sent> {
            self.transport.sent.lock().unwrap().clone()
        }
    }

    pub fn run<F: std::future::Future>(f: F) -> F::Output {
        tauri::async_runtime::block_on(f)
    }
}

#[cfg(test)]
mod tests {
    use super::testing::*;
    use super::*;

    const URL: &str = "https://api.github.com/repos/example-org/example/issues";

    fn limits(remaining: &'static str, reset: &'static str) -> [(&'static str, &'static str); 3] {
        [("x-ratelimit-remaining", remaining), ("x-ratelimit-reset", reset), ("x-ratelimit-resource", "core")]
    }

    #[test]
    fn environment_tokens_come_first_then_the_cli_login() {
        let env = |v: &str| (v == "GITHUB_TOKEN").then(|| " env-token \n".to_string());
        let gh = |a: Option<&str>| Some(format!("gh-{}", a.unwrap_or("active")));
        assert_eq!(read_token(env, gh, Some("octo")).as_deref(), Some("env-token"));
        assert_eq!(read_token(|_| Some("  ".into()), gh, Some("octo")).as_deref(), Some("gh-octo"));
        assert_eq!(read_token(|_| None, gh, None).as_deref(), Some("gh-active"));
        assert_eq!(read_token(|_| None, |_| Some("\n".into()), None), None);
    }

    #[test]
    fn account_names_cannot_become_cli_options() {
        assert!(is_login("octo-cat"));
        assert!(!is_login("--hostname"));
        assert!(!is_login("a b"));
        assert!(!is_login(""));
    }

    #[test]
    fn sends_the_token_and_the_etag() {
        let rig = Rig::new(&[Some("secret")]);
        rig.answer(reply(200, &[], "[]"));
        run(rig.client.get(None, Purpose::User, URL, Some("W/\"abc\""))).unwrap();
        let sent = &rig.sent()[0];
        assert_eq!(sent.header("authorization"), Some("Bearer secret"));
        assert_eq!(sent.header("if-none-match"), Some("W/\"abc\""));
        assert_eq!(sent.header("accept"), Some("application/vnd.github+json"));
    }

    #[test]
    fn refuses_addresses_off_the_api_host() {
        let rig = Rig::new(&[Some("secret")]);
        for url in ["https://api.github.com.evil.example/x", "https://example.com/x", "https://api.github.comx/"] {
            assert!(matches!(run(rig.client.get(None, Purpose::User, url, None)), Err(ApiError::Network(_))), "{url}");
        }
        assert!(rig.sent().is_empty());
    }

    #[test]
    fn reads_the_token_again_after_a_401_and_retries_once() {
        let rig = Rig::new(&[Some("old"), Some("new")]);
        rig.answer(reply(401, &[], r#"{"message":"Bad credentials"}"#)).answer(reply(200, &[], "[]"));
        run(rig.client.get(Some("octo"), Purpose::User, URL, None)).unwrap();
        let auth: Vec<_> = rig.sent().iter().map(|s| s.header("authorization").unwrap().to_string()).collect();
        assert_eq!(auth, ["Bearer old", "Bearer new"]);
        assert_eq!(*rig.tokens.reads.lock().unwrap(), [Some("octo".to_string()), Some("octo".to_string())]);

        let rig = Rig::new(&[Some("bad")]);
        rig.answer(reply(401, &[], "{}")).answer(reply(401, &[], "{}"));
        assert_eq!(run(rig.client.get(None, Purpose::User, URL, None)).err(), Some(ApiError::Unauthorized));
        assert_eq!(rig.sent().len(), 2);
    }

    #[test]
    fn the_token_is_read_once_and_again_only_when_the_user_asks_while_there_is_none() {
        let rig = Rig::new(&[None]);
        rig.answer(reply(200, &[], "[]")).answer(reply(200, &[], "[]"));
        run(rig.client.get(None, Purpose::User, URL, None)).unwrap();
        assert_eq!(run(rig.client.get(None, Purpose::Background, URL, None)).err(), Some(ApiError::Paused { resets_at: None }));
        assert_eq!(rig.tokens.reads.lock().unwrap().len(), 1);
        run(rig.client.get(None, Purpose::User, URL, None)).unwrap();
        assert_eq!(rig.tokens.reads.lock().unwrap().len(), 2);
        assert!(rig.sent().iter().all(|s| s.header("authorization").is_none()));
    }

    #[test]
    fn background_work_stops_below_500_and_everything_at_zero() {
        let rig = Rig::new(&[Some("t")]);
        rig.answer(reply(200, &limits("499", "5000"), "[]"));
        run(rig.client.get(None, Purpose::User, URL, None)).unwrap();
        assert_eq!(run(rig.client.get(None, Purpose::Background, URL, None)).err(), Some(ApiError::Paused { resets_at: Some(5000) }));

        rig.answer(reply(200, &limits("0", "5000"), "[]"));
        run(rig.client.get(None, Purpose::User, URL, None)).unwrap();
        assert_eq!(run(rig.client.get(None, Purpose::User, URL, None)).err(), Some(ApiError::RateLimited { resets_at: 5000 }));
        assert_eq!(rig.sent().len(), 2);

        // After the reset, requests go out again.
        rig.now.store(5000, std::sync::atomic::Ordering::SeqCst);
        rig.answer(reply(200, &limits("4999", "8600"), "[]"));
        run(rig.client.get(None, Purpose::Background, URL, None)).unwrap();
    }

    #[test]
    fn limits_are_kept_per_token() {
        let rig = Rig::new(&[Some("t")]);
        rig.answer(reply(200, &limits("0", "5000"), "[]"));
        run(rig.client.get(None, Purpose::User, URL, None)).unwrap();
        rig.tokens.list.lock().unwrap().clear();
        rig.tokens.list.lock().unwrap().push_back(Some("other".into()));
        rig.answer(reply(200, &[], "[]"));
        run(rig.client.get(Some("other-login"), Purpose::User, URL, None)).unwrap();
    }

    #[test]
    fn a_limit_reply_blocks_until_the_reset_or_retry_after() {
        let rig = Rig::new(&[Some("t")]);
        rig.answer(reply(403, &limits("0", "4000"), r#"{"message":"API rate limit exceeded"}"#));
        assert_eq!(run(rig.client.get(None, Purpose::User, URL, None)).err(), Some(ApiError::RateLimited { resets_at: 4000 }));
        assert_eq!(run(rig.client.get(None, Purpose::User, URL, None)).err(), Some(ApiError::RateLimited { resets_at: 4000 }));
        assert_eq!(rig.sent().len(), 1);

        let rig = Rig::new(&[Some("t")]);
        rig.answer(reply(429, &[("retry-after", "30")], "{}"));
        assert_eq!(run(rig.client.get(None, Purpose::User, URL, None)).err(), Some(ApiError::RateLimited { resets_at: 1030 }));

        let rig = Rig::new(&[Some("t")]);
        rig.answer(reply(403, &[], r#"{"message":"You have exceeded a secondary rate limit."}"#));
        assert_eq!(run(rig.client.get(None, Purpose::User, URL, None)).err(), Some(ApiError::RateLimited { resets_at: 1060 }));
    }

    #[test]
    fn other_limits_than_core_are_ignored() {
        let rig = Rig::new(&[Some("t")]);
        rig.answer(reply(200, &[("x-ratelimit-remaining", "0"), ("x-ratelimit-reset", "5000"), ("x-ratelimit-resource", "search")], "[]"));
        rig.answer(reply(200, &[], "[]"));
        run(rig.client.get(None, Purpose::User, URL, None)).unwrap();
        run(rig.client.get(None, Purpose::Background, URL, None)).unwrap();
    }

    #[test]
    fn sorts_error_answers() {
        let sso = reply(403, &[("x-github-sso", "required; url=https://github.com/orgs/example-org/sso?authorization_request=x")], "{}");
        assert_eq!(classify(&sso, true, 0), Err(ApiError::SingleSignOn { url: Some("https://github.com/orgs/example-org/sso?authorization_request=x".into()) }));
        assert_eq!(classify(&reply(404, &[], "{}"), false, 0), Err(ApiError::NotFound { signed_in: false }));
        assert_eq!(
            classify(&reply(410, &[], r#"{"message":"Issues are disabled for this repo"}"#), true, 0),
            Err(ApiError::Gone { message: "Issues are disabled for this repo".into() })
        );
        assert_eq!(classify(&reply(403, &[], r#"{"message":"Resource not accessible"}"#), true, 0), Err(ApiError::Status(403)));
        assert_eq!(classify(&reply(502, &[], ""), true, 0), Err(ApiError::Status(502)));
        assert_eq!(classify(&reply(304, &[], ""), true, 0), Ok(()));
        // A partial-results notice on a success is not a refusal.
        assert_eq!(classify(&reply(200, &[("x-github-sso", "partial-results; organizations=1")], "[]"), true, 0), Ok(()));
    }

    #[test]
    fn follows_only_next_links_on_the_api_host() {
        let link = r#"<https://api.github.com/repositories/1/issues?page=3>; rel="next", <https://api.github.com/repositories/1/issues?page=9>; rel="last""#;
        assert_eq!(reply(200, &[("link", link)], "").next_link().as_deref(), Some("https://api.github.com/repositories/1/issues?page=3"));
        assert_eq!(reply(200, &[("link", r#"<https://evil.example/x>; rel="next""#)], "").next_link(), None);
        assert_eq!(reply(200, &[("link", r#"<https://api.github.com/x?page=1>; rel="prev""#)], "").next_link(), None);
        assert_eq!(reply(200, &[], "").next_link(), None);
    }
}
