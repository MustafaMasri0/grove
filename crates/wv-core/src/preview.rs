//! Files the image views and HTML previews load from the repository, through the
//! app's `wvfile:` URL scheme (`http://wvfile.localhost/` in WebView2).
//!
//! The UI asks for a root (a repository, worktree and revision) and gets a random
//! token; URLs under `/<token>/` name files of that root, so relative images and
//! stylesheets in an HTML file resolve at the same revision. Only images,
//! stylesheets and fonts are served, never documents or scripts, and nothing
//! outside a root. `/~link?…` is where links in an HTML preview point: the app
//! answers it with no content (the preview stays put) and tells the UI.

use crate::repo_ops::Source;
use std::collections::hash_map::RandomState;
use std::collections::HashMap;
use std::hash::{BuildHasher, Hasher};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

pub const SCHEME: &str = "wvfile";
pub const ORIGIN: &str = "http://wvfile.localhost";

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Root {
    pub repo: String,
    pub cwd: String,
    /// None: the worktree on disk.
    pub rev: Option<String>,
}

#[derive(Default)]
pub struct Roots {
    by_token: Mutex<HashMap<String, Root>>,
    by_root: Mutex<HashMap<Root, String>>,
}

impl Roots {
    /// The token for a root; the same root always gets the same one for this run.
    pub fn token(&self, repo: &str, cwd: &str, rev: Option<&str>) -> String {
        let root = Root { repo: repo.into(), cwd: cwd.into(), rev: rev.map(Into::into) };
        let mut by_root = self.by_root.lock().unwrap();
        if let Some(t) = by_root.get(&root) {
            return t.clone();
        }
        let t = random_token();
        self.by_token.lock().unwrap().insert(t.clone(), root.clone());
        by_root.insert(root, t.clone());
        t
    }

    pub fn get(&self, token: &str) -> Option<Root> {
        self.by_token.lock().unwrap().get(token).cloned()
    }
}

/// 128 random bits as hex, from the standard library's per-process random hash keys.
fn random_token() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let half = || {
        let mut h = RandomState::new().build_hasher();
        h.write_u64(n);
        h.finish()
    };
    format!("{:016x}{:016x}", half(), half())
}

pub fn base_url(token: &str) -> String {
    format!("{ORIGIN}/{token}/")
}

/// The URL of a repository file under a root.
pub fn file_url(token: &str, path: &str) -> String {
    let enc: Vec<String> = path.split('/').map(encode_segment).collect();
    format!("{ORIGIN}/{token}/{}", enc.join("/"))
}

fn encode_segment(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-._~!$&'()*+,;=@".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn decode_segment(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = std::str::from_utf8(b.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

#[derive(Debug)]
pub enum Request {
    File { root: Root, source: Source },
    /// A link clicked in an HTML preview; the query says where it goes.
    Link { query: String },
    NotFound,
}

/// What a request path (and query) asks for.
pub fn route(roots: &Roots, path: &str, query: Option<&str>) -> Request {
    if path == "/~link" {
        return Request::Link { query: query.unwrap_or("").to_string() };
    }
    let Some(rest) = path.strip_prefix('/') else { return Request::NotFound };
    let Some((token, file)) = rest.split_once('/') else { return Request::NotFound };
    let Some(root) = roots.get(token) else { return Request::NotFound };
    let mut parts = Vec::new();
    for seg in file.split('/') {
        let Some(seg) = decode_segment(seg) else { return Request::NotFound };
        // Every segment must be a plain name: no climbing, no drive letters or backslashes.
        if seg.is_empty() || seg == "." || seg == ".." || seg.contains(['/', '\\', ':', '\0']) {
            return Request::NotFound;
        }
        parts.push(seg);
    }
    let path = parts.join("/");
    let source = match &root.rev {
        Some(rev) => Source::Rev { rev: rev.clone(), path },
        None => Source::Worktree { path },
    };
    Request::File { root, source }
}

fn ext(path: &str) -> String {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default()
}

/// The image types the app shows as pictures.
pub fn image_mime(path: &str) -> Option<&'static str> {
    Some(match ext(path).as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        _ => return None,
    })
}

/// What `wvfile:` serves: images, and the stylesheets and fonts an HTML preview uses.
pub fn served_mime(path: &str) -> Option<&'static str> {
    image_mime(path).or_else(|| match ext(path).as_str() {
        "css" => Some("text/css"),
        "woff" => Some("font/woff"),
        "woff2" => Some("font/woff2"),
        "ttf" => Some("font/ttf"),
        "otf" => Some("font/otf"),
        _ => None,
    })
}

/// Headers of every served file: never cached (memory, and files change on disk),
/// never sniffed as another type, and an SVG opened on its own runs nothing.
pub fn response_headers(mime: &str) -> Vec<(&'static str, String)> {
    vec![
        ("Content-Type", mime.to_string()),
        ("Cache-Control", "no-store".into()),
        ("X-Content-Type-Options", "nosniff".into()),
        ("Content-Security-Policy", format!("default-src 'none'; img-src {ORIGIN} data:; style-src {ORIGIN} 'unsafe-inline'; font-src {ORIGIN} data:; sandbox")),
        ("Access-Control-Allow-Origin", "*".into()),
    ]
}
