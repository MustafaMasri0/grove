#!/usr/bin/env bash
# Runs the real-host tests against a stock OpenSSH sshd in a throwaway Docker container,
# with a throwaway key: nothing in ~/.ssh is read or changed. The container holds a
# repository with twelve worktrees far from their base, so the overview has work to do.
#   bash scripts/build-helpers.sh
#   bash scripts/test-ssh-host.sh [linux/amd64|linux/arm64]
set -euo pipefail
cd "$(dirname "$0")/.."
# Git Bash must not rewrite the container paths below into Windows ones.
export MSYS_NO_PATHCONV=1

platform="${1:-linux/amd64}"
case "$platform" in
  linux/amd64) target=x86_64-unknown-linux-musl ;;
  linux/arm64) target=aarch64-unknown-linux-musl ;;
  *) echo "usage: test-ssh-host.sh [linux/amd64|linux/arm64]" >&2; exit 1 ;;
esac
helper="src-tauri/bin/wv-helper-$target"
[ -f "$helper" ] || { echo "$helper is missing: run scripts/build-helpers.sh" >&2; exit 1; }

image="grove-test-sshd:${platform#linux/}"
name="grove-test-sshd-$$"
work="$(mktemp -d)"
trap 'docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT
native() { if command -v cygpath >/dev/null; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

docker build -q --platform "$platform" -t "$image" - <<'EOF' >/dev/null
FROM debian:stable-slim
RUN apt-get update -qq && apt-get install -qq -y --no-install-recommends openssh-server git >/dev/null
RUN useradd -m -s /bin/bash -p '*' dev && mkdir -p /run/sshd && ssh-keygen -A
EOF

ssh-keygen -q -t ed25519 -N "" -f "$work/key"
docker run -d --rm --platform "$platform" --name "$name" -p 127.0.0.1::22 "$image" /usr/sbin/sshd -D -e >/dev/null
port="$(docker port "$name" 22/tcp | sed 's/.*://' | head -1)"
docker exec -i "$name" sh -c 'install -d -m 700 -o dev -g dev /home/dev/.ssh && install -m 600 -o dev -g dev /dev/stdin /home/dev/.ssh/authorized_keys' < "$work/key.pub"

# Twelve worktrees that each add 5000 files; the first five also disagree on twenty more.
# `tr`, since a Windows checkout of this script has CRLF line endings.
tr -d '\r' <<'EOF' | docker exec -i -u dev -w /home/dev "$name" bash -s
set -eu
export GIT_AUTHOR_NAME=Dev GIT_AUTHOR_EMAIL=dev@example.com GIT_COMMITTER_NAME=Dev GIT_COMMITTER_EMAIL=dev@example.com
git init -q -b main repo
cd repo
mkdir shared
for f in $(seq 20); do echo base > "shared/$f.txt"; done
git add . && git commit -q -m base
for w in $(seq 12); do
  git worktree add -q -b "agent/$w" "../wt/$w" main
  (
    cd "../wt/$w"
    d="services/agent-$w/generated/a-fairly-long-folder-name-as-real-repositories-have"
    mkdir -p "$d"
    for f in $(seq 5000); do : > "$d/file-$f.txt"; done
    if [ "$w" -le 5 ]; then for f in $(seq 20); do echo "$w" > "shared/$f.txt"; done; fi
    git add . && git commit -q -m "agent $w"
    echo edit >> README.md
  )
done
EOF

cat > "$work/config" <<EOF
Host grove-test
  HostName 127.0.0.1
  Port $port
  User dev
  IdentityFile $(native "$work/key")
  IdentitiesOnly yes
  StrictHostKeyChecking no
  UserKnownHostsFile $(native "$work/known_hosts")
EOF

export WV_SSH_CONFIG="$(native "$work/config")"
export WV_TEST_SSH=ssh://grove-test/home/dev/repo
export WV_TEST_HELPER="$(native "$PWD/$helper")"
export WV_TEST_TARGET="$target"
export WV_TEST_BASE=main
cargo test -p wv-helper --test provision -- --ignored --nocapture --test-threads=1
