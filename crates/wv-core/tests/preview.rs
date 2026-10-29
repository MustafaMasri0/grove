//! The `wvfile:` resources that image views and HTML previews load from the repository.

use wv_core::preview::{self, image_mime, served_mime, Request, Roots};
use wv_core::repo_ops::Source;

#[test]
fn a_root_has_one_token_per_repository_worktree_and_revision() {
    let roots = Roots::default();
    let a = roots.token("D:\\r", "D:/r", Some("abc123"));
    assert_eq!(roots.token("D:\\r", "D:/r", Some("abc123")), a);
    let wt = roots.token("D:\\r", "D:/r", None);
    assert_ne!(wt, a);
    assert_ne!(roots.token("D:\\r", "D:/r-wt", None), wt);
    // Not guessable from the inputs, and safe in a URL path.
    assert!(a.len() >= 24 && a.chars().all(|c| c.is_ascii_hexdigit()), "{a}");
    let root = roots.get(&a).unwrap();
    assert_eq!((root.repo.as_str(), root.cwd.as_str(), root.rev.as_deref()), ("D:\\r", "D:/r", Some("abc123")));
    assert!(roots.get("ffff").is_none());
}

#[test]
fn base_url_is_the_folder_files_resolve_against() {
    let roots = Roots::default();
    let t = roots.token("r", "/home/me/r", None);
    assert_eq!(preview::base_url(&t), format!("http://wvfile.localhost/{t}/"));
    assert_eq!(preview::file_url(&t, "docs/a b/#1.png"), format!("http://wvfile.localhost/{t}/docs/a%20b/%231.png"));
}

#[test]
fn file_requests_map_to_a_source_at_the_root_revision() {
    let roots = Roots::default();
    let rev = roots.token("r", "/r", Some("v1"));
    let wt = roots.token("r", "/r", None);
    match preview::route(&roots, &format!("/{rev}/docs/img%20one.png"), None) {
        Request::File { root, source } => {
            assert_eq!(root.cwd, "/r");
            assert_eq!(source, Source::Rev { rev: "v1".into(), path: "docs/img one.png".into() });
        }
        other => panic!("{other:?}"),
    }
    match preview::route(&roots, &format!("/{wt}/styles.css"), Some("v=3")) {
        Request::File { source, .. } => assert_eq!(source, Source::Worktree { path: "styles.css".into() }),
        other => panic!("{other:?}"),
    }
}

#[test]
fn requests_outside_a_root_are_refused() {
    let roots = Roots::default();
    let t = roots.token("r", "/r", None);
    for bad in [
        "/unknown/a.png".to_string(),
        format!("/{t}/"),
        format!("/{t}/../x.png"),
        format!("/{t}/a/%2e%2e/%2e%2e/x.png"),
        format!("/{t}/a%2F..%2F..%2Fx.png"),
        format!("/{t}/C:%5Cwindows%5Cwin.ini"),
        format!("/{t}/a%5C..%5Cb.png"),
        format!("/{t}/a%00.png"),
        format!("/{t}//etc/passwd"),
        "/".to_string(),
    ] {
        assert!(matches!(preview::route(&roots, &bad, None), Request::NotFound), "{bad}");
    }
}

#[test]
fn link_requests_carry_their_query_to_the_ui() {
    let roots = Roots::default();
    match preview::route(&roots, "/~link", Some("open=docs%2Fa.html")) {
        Request::Link { query } => assert_eq!(query, "open=docs%2Fa.html"),
        other => panic!("{other:?}"),
    }
    assert!(matches!(preview::route(&roots, "/~link", None), Request::Link { .. }));
}

#[test]
fn only_images_styles_and_fonts_are_served() {
    assert_eq!(served_mime("a/B.PNG"), Some("image/png"));
    assert_eq!(served_mime("x.svg"), Some("image/svg+xml"));
    assert_eq!(served_mime("x.jpeg"), Some("image/jpeg"));
    assert_eq!(served_mime("s.css"), Some("text/css"));
    assert_eq!(served_mime("f.woff2"), Some("font/woff2"));
    for no in ["page.html", "app.js", "data.json", "README", "x.exe", "a.htm", "m.mjs"] {
        assert_eq!(served_mime(no), None, "{no}");
    }
    assert_eq!(image_mime("s.css"), None);
    for ext in ["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif"] {
        assert!(image_mime(&format!("x.{ext}")).is_some(), "{ext}");
    }
}

#[test]
fn responses_are_never_cached_sniffed_or_scripted() {
    let h = preview::response_headers("image/svg+xml");
    let get = |k: &str| h.iter().find(|(n, _)| n.eq_ignore_ascii_case(k)).map(|(_, v)| v.as_str());
    assert_eq!(get("Content-Type"), Some("image/svg+xml"));
    assert_eq!(get("Cache-Control"), Some("no-store"));
    assert_eq!(get("X-Content-Type-Options"), Some("nosniff"));
    let csp = get("Content-Security-Policy").unwrap();
    assert!(csp.contains("default-src 'none'") && csp.contains("sandbox"), "{csp}");
    // Fonts are fetched in CORS mode from the preview's opaque origin.
    assert_eq!(get("Access-Control-Allow-Origin"), Some("*"));
}
