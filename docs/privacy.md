# What Grove writes and sends

Grove is meant to be safe to point at any repository, including ones where coding agents are busy.

## What Grove writes

Grove does not change your index, branches or stashes. Of your working tree it only writes the local config and secret files you name (`.env` and the like, see [Editable files](features.md#viewers-and-editing)), when you save one.

The only git commands that write anything are:

- `fetch`
- `push` (never forced) and `push -u origin <branch>`
- `clone` into a new folder

Each is started by an explicit button. Every git command Grove may run, in the app and in its helper, is on an allowlist (`crates/wv-core/src/allowlist.rs`), and reads are limited to known commands and options. More git actions are planned; they will go through the same allowlist.

## Network use

Apart from `fetch` and `push`, the app's only network traffic is author pictures and issues. Both are asked for by the app itself: a WSL distro or an SSH host only reports `origin`, and sends nothing to GitHub.

- **Author pictures.** For a repository whose `origin` is on github.com, the app asks GitHub's API which account a commit author's email belongs to. Otherwise it uses GitHub's avatar CDN for `…@users.noreply.github.com` addresses and Gravatar (a SHA-256 of the email). Pictures are cached under `%LOCALAPPDATA%\app.grove.desktop\avatars` for a week.
- **Issues**, for a repository whose `origin` is on github.com, while the Issues list or an issue is open: the first 300 issues (*Load more* for older ones), a check for changes every minute while the list is shown and the window has focus, and an issue's comments when it is opened. The check is a conditional request, so an unchanged list costs little. Issues are kept in memory only and dropped when the app closes. Nothing is ever written to GitHub.

## GitHub tokens

Requests to GitHub's API use `GH_TOKEN` or `GITHUB_TOKEN` if set, else the GitHub CLI's login (`gh auth token`). A repository's issues can be read with another of the CLI's accounts (its GitHub account in Settings, read with `gh auth token --user`); an environment token applies to every repository.

The token is kept in memory, read again after GitHub refuses it or on a refresh when there was none, and never stored. Without a login, public issues can still be read, without the minute checks.

Grove keeps to GitHub's rate limit per token: below 500 requests left it stops the minute checks and picture lookups, and at none it sends nothing until the limit resets.
