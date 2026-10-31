# Grove

**A Git client for worktrees.** Grove is a small, fast Windows desktop app for
working across git repositories and their worktrees: branches, uncommitted
changes, history, blame and files, with diffs shown in VS Code's editor
(Monaco). It is built for juggling several worktrees at once, for example when
coding agents work in parallel, so you can see what is going on in each of them
at a glance.

Grove is free and open source under the [MIT licence](LICENSE).

- **Safe by default.** Today Grove does not change your working tree, index,
  branches or stashes. The only git commands that write anything are `fetch`,
  `push` (never forced) and `push -u origin <branch>`, each started by an
  explicit button. Every git command Grove may run, in the app and in its
  helper, is on an allowlist, and reads are limited to known commands and
  options. Editing files and more git actions are planned. They will go
  through the same allowlist.
- **Windows only, for now.** It is a Tauri 2 app that uses WebView2. Linux and
  macOS builds are not supported yet. Contributions are welcome.
- **WSL support.** Repositories can live on Windows (`C:\src\example`) or inside
  any WSL distro (`\\wsl.localhost\Ubuntu\home\user\src\example`). For WSL
  repositories, a small helper runs git natively inside the distro instead of
  going through the slow `\\wsl$` file share.
- **SSH support.** Repositories can also live on another machine
  (`ssh://user@host/home/user/src/example`) running Linux or Windows, on x86-64 or
  Arm64. The same helper runs next to the repository there, so git, search and
  the live worktree watcher work as they do locally. macOS hosts are designed in
  and need their helper built on a Mac: see [docs/ssh.md](docs/ssh.md).

## Install

1. Download the latest `Grove_<version>_x64-setup.exe` from this
   repository's **Releases** page.
2. Run it. It installs for the current user only and needs no admin rights.

**SmartScreen warning:** the installer is not code-signed, so Windows
SmartScreen may show *"Windows protected your PC"*. Click **More info**, then
**Run anyway**. If you would rather not trust a prebuilt binary, build it
yourself (below). That gives the same result.

You need:

- Windows 10 or 11 with the WebView2 runtime (already installed on current
  Windows).
- [Git for Windows](https://git-scm.com/download/win) on your `PATH` for
  repositories on Windows.
- `git` inside each WSL distro you open repositories from. The app installs its
  helper into `~/.local/share/grove/` in that distro on first use and
  replaces it when the app is updated.
- For SSH repositories: `ssh` on your `PATH` (Windows 10 and 11 include it) and
  `git` on the host. Grove installs the same helper there. It signs in with your
  ssh config, keys and agent and cannot ask for a password or passphrase, so
  load keys into `ssh-agent`, and connect once from a terminal to accept a new
  host key. Fetch and push run on the host, with its credentials.

Add a repository from the **Repository** menu at the top left. Pick a folder,
paste a path, or use **Connect over SSH…**.

## Features

- **Rail**: the repository, Overview, the worktrees with what each one is doing
  (Changing, Has changes, Clean, Push rejected), and Settings. Filter it, or show
  only worktrees with changes. Ctrl+B folds it to icons, its edge resizes it, and
  below 1100px wide it is icons on its own, with the left pane as a drawer that
  Ctrl+B opens.
- **Page header**: the worktree, its branch selector, commits ahead of and behind
  the base, and one action button (Fetch origin / Push origin ↑N / Publish
  branch), with Fetch origin behind its chevron. Picking a branch never checks it
  out. If a worktree has it, the app switches to that worktree. Otherwise the
  branch is shown read-only (the files and history of its tip).
- **Worktrees overview** (Overview in the rail, or
  Ctrl+Shift+O): every worktree of the repository side by side, with its
  branch, uncommitted files, commits ahead of and behind the base branch and
  origin, and its last commit. Grove watches all worktrees while it is open: a
  worktree whose files are changing pulses green (and reads Changing in the rail),
  and an activity feed lists commits, branch switches and file edits in any of
  them. **Possible conflicts** lists files that two worktrees both
  change, committed since the base or not committed yet. A file committed on
  both sides only counts when the two versions differ and neither branch
  already contains the other. The rail counts them per worktree. A checkbox on
  the overview (also in Settings) turns this off, and Grove then skips the git
  commands behind it. The overview uses only read commands (`status`, `diff`,
  `rev-list`, `merge-base`, `log`).
- **Base branch**: what "Branch vs base" and the Worktrees overview compare
  with. Pick it with **Base** on either, or in Settings; it is remembered per
  repository. Until then Grove uses development, main or master (local first,
  then origin's), else the default branch of origin (`origin/HEAD`).
- **Left pane** (Ctrl+1/2/3): Changes (uncommitted, or branch vs its base),
  History and Explorer. Ctrl+Shift+F opens Search (`git grep`), and Ctrl+P opens
  Quick Open.
- **Changed files** in Changes and in a commit show as a flat list or as a
  folder tree (the toggle next to the filter). The tree counts the files in
  each folder and joins single-child folders (`src/main/java`), like VS Code.
- **Explorer follows the editor**: the active tab's file is selected, its
  folders expanded and scrolled into view (a Settings option turns this off).
  "Reveal in Explorer" on tabs and file rows does the same on demand.
- **Diffs** show the whole file, side by side or inline. Unchanged regions can
  be collapsed and whitespace ignored.
- **History**: commit list with author avatars. Selecting a commit opens its
  changed files and details. The search box searches the branch's whole history
  by message, author, email or SHA prefix.
- **File history** follows renames. **Blame** shows each line's last commit in
  the margin. Click one to open that commit.
- **Markdown** files open rendered, with working links between files.
- **Images** (png, jpg, gif, webp, svg, ico, bmp, avif) open as pictures,
  fitted to the window, over a checkerboard where they are transparent, with
  their pixel and file size. Ctrl+wheel and Ctrl+= / Ctrl+- / Ctrl+0 zoom. A
  changed image compares its before and after side by side, by swiping or as an
  onion skin. Files over 32 MB or 64 megapixels are not shown.
- **HTML** files open rendered (Preview/Source, like Markdown) in a sandboxed
  frame with its own opaque origin: no network and no access to the app.
  Relative images and stylesheets load from the repository at the same
  revision, and links work like Markdown links. Scripts are off by default;
  **Run scripts** in the toolbar turns them on for a repository you trust. Then
  the page's inline scripts and its scripts from the repository run, still
  without network access (scripts from a CDN do not load), and web links ask
  before opening.
- **Context menus** on files, folders, tabs, commits and the top-bar lists:
  copy paths (WSL paths come out as `\\wsl.localhost\<distro>\…`), reveal in
  File Explorer (not for SSH repositories), open a commit on GitHub, and more.
- **Settings** (gear at the foot of the rail, or Ctrl+,): theme, zoom, editor and diff
  options, the repository list and each repository's base branch, and a list of
  shortcuts. Stored in `%APPDATA%\app.grove.desktop\settings.json`.

Shortcuts: Ctrl+, settings, Ctrl+P quick open, Ctrl+Shift+F search,
Ctrl+Shift+O worktrees overview, Ctrl+B fold the rail, Ctrl+F find,
Ctrl+G go to line, F7 / Shift+F7 next/previous change, Ctrl+W close tab,
Ctrl+Tab / Ctrl+Shift+Tab switch tabs, F5 refresh, Ctrl+= / Ctrl+- / Ctrl+0
zoom.

### Network use

Apart from `fetch` and `push`, the app's only network traffic is author
pictures. For a repository whose `origin` is on github.com, it asks GitHub's API
which account a commit author's email belongs to. It uses `GH_TOKEN` /
`GITHUB_TOKEN`, or the GitHub CLI's login (`gh auth token`), if either is
available. The token is read once per run and never stored. Otherwise it uses
GitHub's avatar CDN for `…@users.noreply.github.com` addresses and Gravatar (a
SHA-256 of the email). Pictures are cached under
`%LOCALAPPDATA%\app.grove.desktop\avatars` for a week.

## Building from source

You need, on Windows:

- [Rust](https://rustup.rs) with the MSVC toolchain (and the Visual Studio C++
  build tools it asks for).
- A current LTS release of [Node.js](https://nodejs.org), and pnpm
  (`corepack enable`).

```powershell
# 1. Build the helpers the app embeds (Git Bash is fine; WSL is not needed).
#    Repeat whenever crates/wv-helper or crates/wv-core changes.
bash scripts/build-helpers.sh

# 2. Build the app:
pnpm install
pnpm tauri dev      # run in development mode
pnpm tauri build    # installer in target\release\bundle\nsis\
```

If you skip step 1, the app still builds, with a warning, but WSL and SSH
repositories won't open.

### Tests

```sh
cargo test           # core parsers, path routing, helper protocol and install
pnpm test            # UI logic (Vitest)
```

`cargo test` covers the shared crates on any OS, against that OS's git.
`cargo test -p grove` covers the Tauri side. `bash scripts/test-ssh-host.sh` runs the
helper against a stock OpenSSH server in a throwaway Docker container.

## How it works

- `crates/wv-core`: git output parsers, the command allowlist, local/WSL/SSH path
  routing, the `GitHost` trait with a local implementation, the helper protocol
  client, helper installation (`remote`), the file watcher, and every repository operation the UI uses.
- `crates/wv-helper`: a small binary started once per WSL distro or SSH host, on
  the machine holding the repository. It runs git, reads files and watches
  worktrees there, and talks JSON lines over stdin/stdout. See
  [docs/ssh.md](docs/ssh.md).
- `src-tauri`: the Tauri 2 shell and commands, and the `wvfile:` URL scheme
  (`http://wvfile.localhost/`) that image views and HTML previews read
  repository files from: images, stylesheets, fonts and scripts only,
  read-only, under a random token per repository, worktree and revision, never
  cached. HTML previews are served from it too, prepared by the UI, under a
  content security policy that allows no network and scripts only when the
  repository allows them.
- `src`: the React UI. Monaco is bundled locally, with only the editor worker.

### Test hooks

Environment variables let a second instance be driven without touching your
own settings: `WV_CONFIG_DIR` (settings folder), `WV_TITLE` (window title),
`WV_OPEN_DIFFS=n`, `WV_OPEN_FILE=path`, `WV_SHOW_HISTORY=1|<sha>`,
`WV_RUN_ACTION=fetch|push|publish`,
`WV_LEFT_TAB=changes|history|explorer|search`,
`WV_OPEN_SETTINGS=1|settings.json|<search>`, `WV_SETTINGS_PATCH=<json>`,
`WV_CONTEXT_MENU=<place>[:key][>Label]` (e.g. `WV_CONTEXT_MENU="tab>Close others"`),
`WV_FILE_HISTORY=path`, `WV_BLAME=1|click:<line>` and
`WV_HISTORY_SEARCH=text`, `WV_OPEN_REV_FILE=<rev>:<path>`,
`WV_OPEN_COMMIT_FILE=path` (a file of the commit `WV_SHOW_HISTORY` selected),
`WV_IMAGE_ZOOM=in|out|fit|<scale>`, `WV_PREVIEW_LINK=n` (follows an HTML
preview's n-th link), `WV_REVEAL=path` (Reveal in Explorer),
`WV_LIST_KEYS=ArrowDown,ArrowLeft,…` (keys pressed in the left pane's list) and
`WV_WORKTREES=1|chip:<n>|feed:<n>` (opens the Worktrees overview, then clicks
the n-th worktree of a shared file or the n-th Activity link). Set `WEBVIEW2_USER_DATA_FOLDER` to give the instance
its own WebView2 processes. `scripts/test-run.ps1 -Repo <path>` starts such an
instance, and `scripts/measure-memory.ps1 -Proc <name>` sums its memory use.
`scripts/make-worktrees-demo.sh <folder>` builds a throwaway repository with
three worktrees that overlap, to try the Worktrees overview on.

## Contributing

Issues and pull requests are welcome.

- Open an issue first for larger changes, so we can agree on the approach.
- Every git command the app runs goes through the allowlist in
  `crates/wv-core/src/allowlist.rs`. A new command, especially one that writes
  to a repository, needs an entry there with tests, and must be triggered by an
  explicit user action. Nothing may be forced or run in the background.
- Run `cargo test` and `pnpm test` before sending a pull request, and add tests
  for new parsing or path logic.
- Test fixtures are generated by `scripts/make-fixtures.sh` from throwaway
  repositories. Don't commit output captured from real repositories, or paths,
  names or emails from your own machine. Use made-up examples such as
  `\\wsl.localhost\Ubuntu\home\user\src\example`.

## Licence

MIT. See [LICENSE](LICENSE). Bundled third-party components and their licences
are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
