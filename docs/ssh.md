# Remote hosts and supported systems

## How a remote repository works

A repository at `ssh://[user@]host[:port]/path` is handled exactly like a WSL one:
a small helper runs next to the repository and the app talks to it over a pipe
(JSON lines). Git, file reads and the worktree watcher all run on the remote
machine, so nothing depends on a network filesystem and the allowlist is enforced
there too.

```
app ── GitHost ─┬─ LocalHost ─ git
                └─ HelperClient ─ pipe ─┬─ wsl.exe ─ wv-helper ─ LocalHost ─ git
                                        └─ ssh     ─ wv-helper ─ LocalHost ─ git
```

`wv_core::remote` is the only code that knows how a machine is reached. A `Shell`
starts a command there (`WslDistro`, `SshTarget`). Connecting is the same for both:

1. **Probe.** `uname -sm`, or `%OS% %PROCESSOR_ARCHITECTURE%` through `cmd` on a
   Windows host. Exit code 255 is ssh itself failing, reported with its own text.
2. **Pick.** `Platform::targets` maps the system to a helper target.
3. **Start**, or install from the binary embedded in the app and start again. The
   installed name holds a hash of the binary, so updating the app updates the helper.
   It lives in `~/.local/share/grove` on every system. Unix hosts store it from
   stdin (`cat > file`). Windows hosts get it through `scp`, because PowerShell on an
   OpenSSH server stops reading a large stdin part way through and never exits.

`Connections` keeps one helper per machine, with a lock per machine so that a slow
host cannot hold up another, and remembers a failure for a few seconds so that the
burst of calls behind one screen does not queue one timeout each. When a helper goes
away the app emits `connection-lost`, and the UI reconnects and watches again.

## Large replies

Replies over `protocol::LARGE_REPLY` travel in parts, each sent after the client asks
for it, and the client sends no other request meanwhile. Tailscale SSH (seen on 1.104)
stopped a connection for good when several 1 MB replies went out at full speed in the
first megabytes of a session while requests were arriving: the helper stayed blocked
writing stdout, with both the Windows and the Git for Windows ssh, and through
`ssh -W` too. The same traffic spaced 200 ms apart, or after the first 4 MB, was fine.
The cause inside the server is not known, and no regular sshd has been compared.
With parts, 36 overviews of 12 worktrees (15 MB each) ran without a stall, where most
runs had stalled before.

`WV_HELPER_LOG=<file>` records every call and reply, for looking into a slow host.

## Why the system ssh

Grove runs the `ssh` that comes with Windows 10+, macOS and Linux instead of linking
an SSH library. The user's config, keys, agent, jump hosts and `known_hosts` then
work with nothing to configure, and the app holds no credentials or SSH crypto.

- **Keys or an agent only.** There is no terminal, so ssh runs with `BatchMode=yes`
  and passwords and passphrases cannot be asked for. This could be added later with
  `SSH_ASKPASS` and a dialog, with no change to this design.
- **Host keys are never accepted silently.** A new host needs one connection from a
  terminal first. Grove says so when that is the failure.
- **Fetch and push run on the remote machine** with its credentials. Agent forwarding
  is left to the user's ssh config (`ForwardAgent`).
- **An `ssh://` address is untrusted input** that ends up on ssh's command line:
  `paths::route` refuses anything but plain host and user names, and the arguments end
  with `--` before the host. Paths never reach a shell; they travel in the JSON.

`WV_SSH_CONFIG=<file>` makes Grove use that ssh config, for test setups.

## Supported systems

The app has two independent axes.

**Where a repository can live** is a row in `Platform::targets` plus a helper binary:

| Remote system     | Helper target                | Built by                     |
| ----------------- | ---------------------------- | ---------------------------- |
| Linux x86-64      | `x86_64-unknown-linux-musl`  | any OS                       |
| Linux Arm64       | `aarch64-unknown-linux-musl` | any OS                       |
| Windows x86-64    | `x86_64-pc-windows-msvc`     | Windows                      |
| Windows Arm64     | same x64 helper (emulated)   | Windows                      |
| macOS Apple chips | `aarch64-apple-darwin`       | macOS (not wired up in CI)   |
| macOS Intel       | `x86_64-apple-darwin`        | macOS (not wired up in CI)   |

The Linux helpers are static, so they do not depend on the server's glibc.
`build.rs` embeds every `src-tauri/bin/wv-helper-<target>[.exe]` it finds: a system
whose helper is missing gives a clear error, and adding one needs no code change.

**Where the app itself runs**: Windows today. The Rust side has no Windows-only
assumption left (WSL is refused at run time elsewhere, and paths use the separator
the backend reports).

## What macOS still needs

No architectural work. The helper code already type-checks for both Apple targets.

To reach Macs as **SSH hosts**:

- A macOS CI job that runs `scripts/build-helpers.sh` and passes
  `src-tauri/bin/wv-helper-*-apple-darwin` to the job that builds the app.
- Check that the Arm binary is still signed after `strip`
  (`codesign -v wv-helper`). Apple chips refuse unsigned programs; the ad-hoc
  signature from the linker is enough, and installing over ssh adds no quarantine.

To run the **app** on a Mac (and on Linux):

- `bundle.targets` and an `.icns` in a `tauri.macos.conf.json` (`tauri.linux.conf.json`).
- The title bar: the window has `decorations: false` and draws Windows-style controls
  (`WindowControls.tsx`). Macs want the native traffic lights.
- Shortcuts: `App.tsx` checks `ctrlKey`; Macs expect Cmd.
- Wording: "Reveal in File Explorer" in `contextMenus.ts`.
- `git` for local repositories: apps started from Finder get a minimal `PATH`, so
  Homebrew's git needs the same treatment as `EXTRA_PATH` in `remote.rs`.
- `README.md` install and settings paths.
