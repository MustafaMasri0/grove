//! The `wvfile:` resources that image views and HTML previews load from the repository.

use wv_core::preview::{self, image_mime, served_mime, Pages, Request, Roots};
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
    // Scripts too, for previews that may run them; the page's policy decides.
    assert_eq!(served_mime("app.js"), Some("text/javascript"));
    assert_eq!(served_mime("m.mjs"), Some("text/javascript"));
    for no in ["page.html", "data.json", "README", "x.exe", "a.htm"] {
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

#[test]
fn prepared_pages_are_kept_until_dropped_and_only_the_latest_few() {
    let pages = Pages::default();
    let a = pages.put("<p>a</p>".into(), false);
    let b = pages.put("<p>b</p>".into(), true);
    assert_ne!(a, b);
    assert!(a.len() >= 24 && a.chars().all(|c| c.is_ascii_hexdigit()), "{a}");
    assert_eq!(pages.get(&a).map(|p| (p.html.to_string(), p.scripts)), Some(("<p>a</p>".into(), false)));
    assert_eq!(pages.get(&b).map(|p| p.scripts), Some(true));
    pages.remove(&a);
    assert!(pages.get(&a).is_none());
    // A page left behind (a crash, a missed drop) does not pile up.
    let ids: Vec<_> = (0..20).map(|i| pages.put(format!("{i}"), false)).collect();
    assert!(pages.get(&ids[0]).is_none());
    assert!(pages.get(ids.last().unwrap()).is_some());
    assert_eq!(preview::page_url(&b), format!("http://wvfile.localhost/~page/{b}"));
}

#[test]
fn page_requests_route_by_id() {
    let roots = Roots::default();
    match preview::route(&roots, "/~page/abc123", None) {
        Request::Page { id } => assert_eq!(id, "abc123"),
        other => panic!("{other:?}"),
    }
    assert!(matches!(preview::route(&roots, "/~page/", None), Request::NotFound));
    assert!(matches!(preview::route(&roots, "/~page/a/b", None), Request::NotFound));
}

#[test]
fn a_page_runs_scripts_only_when_asked_and_never_reaches_the_network() {
    let get = |h: &[(&str, String)], k: &str| h.iter().find(|(n, _)| n.eq_ignore_ascii_case(k)).map(|(_, v)| v.clone()).unwrap();
    let off = preview::page_headers(false);
    let on = preview::page_headers(true);
    assert_eq!(get(&off, "Content-Type"), "text/html; charset=utf-8");
    assert_eq!(get(&off, "Cache-Control"), "no-store");
    let (c_off, c_on) = (get(&off, "Content-Security-Policy"), get(&on, "Content-Security-Policy"));
    assert!(c_off.contains("script-src 'none'") && c_off.ends_with("sandbox"), "{c_off}");
    assert!(c_on.contains("script-src http://wvfile.localhost 'unsafe-inline' 'unsafe-eval'") && c_on.ends_with("sandbox allow-scripts"), "{c_on}");
    for c in [&c_off, &c_on] {
        for d in ["default-src 'none'", "connect-src 'none'", "frame-src 'none'", "form-action 'none'"] {
            assert!(c.contains(d), "{d} in {c}");
        }
    }
}
