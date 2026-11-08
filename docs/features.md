# Features

A tour of everything Grove does. For a short overview, see the [README](../README.md).

- [Worktrees at a glance](#worktrees-at-a-glance)
- [Browsing a worktree](#browsing-a-worktree)
- [Viewers and editing](#viewers-and-editing)
- [Issues](#issues)
- [Settings](#settings)
- [Keyboard shortcuts](#keyboard-shortcuts)

## Worktrees at a glance

- **Rail**: the repository, Overview, Issues, the worktrees with what each one is doing (*Changing*, *Has changes*, *Clean*, *Push rejected*), and Settings. Filter it, or show only worktrees with changes. Ctrl+B folds it to icons and its edge resizes it. Below 1100px wide it is icons on its own, with the left pane as a drawer that Ctrl+B opens.
- **Worktrees overview** (Overview in the rail, or Ctrl+Shift+O): every worktree of the repository side by side, with its branch, uncommitted files, commits ahead of and behind the base branch and origin, and its last commit, in a table you can sort. It keeps its order while the pointer is over it. The overview uses only read commands (`status`, `diff`, `rev-list`, `merge-base`, `log`).
- **Live activity**: Grove watches all worktrees while it is open. A worktree whose files are changing reads *Changing*, and an activity feed lists commits, branch switches and file edits in any of them.
- **Possible conflicts**: files that two worktrees both change, committed since the base or not committed yet. A file committed on both sides only counts when the two versions differ and neither branch already contains the other. The rail counts them per worktree. A checkbox on the overview (also in Settings) turns this off, and Grove then skips the git commands behind it.
- **Base branch**: what *Branch vs base* and the Worktrees overview compare with. Pick it with **Base** on either, or in Settings; it is remembered per repository. Until then Grove uses `development`, `main` or `master` (local first, then origin's), else the default branch of origin (`origin/HEAD`).

## Browsing a worktree

- **Page header**: the worktree, its branch selector, commits ahead of and behind the base, and one action button (*Fetch origin*, *Push origin ↑N* or *Publish branch*), with *Fetch origin* behind its chevron. Picking a branch never checks it out. If a worktree has it, the app switches to that worktree. Otherwise the branch is shown read-only (the files and history of its tip).
- **Left pane** (Ctrl+1/2/3): Changes (uncommitted, or branch vs its base), History and Explorer. Ctrl+Shift+F opens Search (`git grep`), and Ctrl+P opens Quick Open. Ctrl+K finds worktrees, the files each one has changed, and commands.
- **Changed files** in Changes and in a commit show as a flat list or as a folder tree (the toggle next to the filter). The tree counts the files in each folder and joins single-child folders (`src/main/java`), like VS Code.
- **Explorer follows the editor**: the active tab's file is selected, its folders expanded and scrolled into view (a Settings option turns this off). *Reveal in Explorer* on tabs and file rows does the same on demand.
- **Diffs** show the whole file, side by side or inline. Unchanged regions can be collapsed and whitespace ignored.
- **History**: commit list with author avatars. Selecting a commit opens its changed files and details. The search box searches the branch's whole history by message, author, email or SHA prefix.
- **File history** follows renames. **Blame** shows each line's last commit in the margin. Click one to open that commit.
- **Context menus** on files, folders, tabs, commits, worktrees, repositories and branches, on the rail and the overview table: open a worktree in a terminal (Windows Terminal if installed; `ssh` for SSH repositories), copy paths (WSL paths come out as `\\wsl.localhost\<distro>\…`), reveal in File Explorer (not for SSH repositories), open a commit on GitHub, and more.

## Viewers and editing

- **Markdown** files open rendered, with working links between files.
- **Images** (png, jpg, gif, webp, svg, ico, bmp, avif) open as pictures, fitted to the window, over a checkerboard where they are transparent, with their pixel and file size. Ctrl+wheel and Ctrl+= / Ctrl+- / Ctrl+0 zoom. A changed image compares its before and after side by side, by swiping or as an onion skin. Files over 32 MB or 64 megapixels are not shown.
- **HTML** files open rendered (Preview/Source, like Markdown) in a sandboxed frame with its own opaque origin: no network and no access to the app. Relative images and stylesheets load from the repository at the same revision, and links work like Markdown links. Scripts are off by default; **Run scripts** in the toolbar turns them on for a repository you trust. Then the page's inline scripts and its scripts from the repository run, still without network access (scripts from a CDN do not load), and web links ask before opening.
- **Editable files**: every file opens read-only, except the local config and secret files the *Editable files* setting names, as gitignore-style patterns (by default `.env`, `.env.*`, `*.local.*`, `*.tfvars` and `.dev.vars`). Such a file, opened from Explorer, search or Quick Open (not a diff), shows **Editable**, and whether git tracks it, so a save would show up as a change to commit. Ctrl+S or Save writes it, unless it changed on disk since it was loaded: then Reload takes the disk's version and Overwrite keeps yours. A refresh never replaces unsaved edits. Closing a tab, the window, or switching repository asks before throwing edits away. Files tools own (`.git`, `.terraform`, Terraform state) are never editable, and the backend checks the saved patterns again on every save.

## Issues

**Issues** (Issues in the rail, or Ctrl+I) shows the issues of the repository at `origin`, when it is on github.com, read-only. The list filters the loaded issues by open or closed, text or number, label and assignee, and loads more on request. Issues open as tabs beside files, with their comments as sanitised Markdown; web images stay blocked until clicked, which opens them in the browser. While the list is shown and the window has focus it checks for changes every minute (a Settings option turns this off).

What Grove sends to GitHub, and which token it uses, is described in [privacy.md](privacy.md).

## Settings

Settings (the gear at the foot of the rail, or Ctrl+,) cover theme, zoom, editor and diff options, the repository list with each repository's base branch and GitHub account for issues, and a list of shortcuts. They are stored in `%APPDATA%\app.grove.desktop\settings.json`.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl+K | Search worktrees, changed files and commands |
| Ctrl+P | Quick open a file |
| Ctrl+Shift+F | Search in files |
| Ctrl+1 / 2 / 3 | Show Changes / History / Explorer |
| Ctrl+Shift+O | Open the Worktrees overview |
| Ctrl+I | Show the repository's issues |
| Ctrl+B | Fold the rail (below 1100px wide, the list drawer) |
| Ctrl+, | Open Settings |
| F5 / Ctrl+R | Refresh |
| Ctrl+= / Ctrl+- / Ctrl+0 | Zoom in / out / reset |
| Ctrl+W | Close the tab |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab |
| Ctrl+F | Find in the file |
| Ctrl+G | Go to line |
| Ctrl+S | Save a file named in *Editable files* |
| F7 / Shift+F7 | Next / previous change in a diff |
