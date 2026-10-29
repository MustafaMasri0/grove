#!/usr/bin/env bash
# Builds a throwaway repo full of awkward cases and captures real git output
# from it into crates/wv-core/tests/fixtures. Re-run to refresh the fixtures.
set -euo pipefail

OUT="$(cd "$(dirname "$0")/.." && pwd)/crates/wv-core/tests/fixtures"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"

export GIT_AUTHOR_NAME="Fixture Author" GIT_AUTHOR_EMAIL="author@example.com"
export GIT_COMMITTER_NAME="Fixture Author" GIT_COMMITTER_EMAIL="author@example.com"
export GIT_AUTHOR_DATE="2026-01-02T03:04:05+01:00" GIT_COMMITTER_DATE="2026-01-02T03:04:05+01:00"

git init -q --bare "$WORK/remote.git"
git init -q -b main "$WORK/repo"
cd "$WORK/repo"
git config core.quotepath off

printf 'one\ntwo\nthree\n' > a.txt
printf 'keep me\n' > "with space.txt"
printf 'héllo\n' > "ünïcode – naïve.md"
mkdir -p dir/sub && printf 'x\n' > dir/sub/deep.rs
printf 'rename me\nline2\nline3\nline4\n' > old-name.txt
printf 'to delete\n' > gone.txt
printf 'conflict base\n' > conflict.txt
git add -A && git commit -q -m "Initial commit" -m "Body line one.
Body line two."
git remote add origin "$WORK/remote.git"
git push -q -u origin main

# Branch for a conflict
git checkout -q -b feature
printf 'feature side\n' > conflict.txt
git commit -q -am "Feature: change conflict.txt"
git checkout -q main
printf 'main side\n' > conflict.txt
git commit -q -am "Main: change conflict.txt"
git -c core.quotepath=off log -n 50 --format='%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e' main > "$OUT/log.txt"
git show -s --format='%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%cI%x1f%B' HEAD~1 > "$OUT/show-commit.txt"
git merge -q feature >/dev/null 2>&1 || true

# Working tree changes of every kind
printf 'one\nTWO\nthree\nfour\n' > a.txt                 # unstaged modify
git mv old-name.txt "new name ✓.txt"                      # staged rename
git rm -q gone.txt                                        # staged delete
printf 'new file\n' > staged-add.txt && git add staged-add.txt
printf 'changed after staging\n' >> staged-add.txt        # AM
printf 'untracked\n' > "untracked file.txt"
printf 'ünicode untracked\n' > "ñew.txt"
rm "with space.txt"                                       # unstaged delete

git status --porcelain=v2 -z --branch --untracked-files=all > "$OUT/status-v2.bin"
git diff --name-status -z -M HEAD > "$OUT/diff-name-status.bin"

# Worktrees: one on a branch, one detached, one prunable (directory removed)
git worktree add -q "$WORK/wt-branch" -b wt-branch-name main~1 2>/dev/null
git worktree add -q --detach "$WORK/wt detached" main~1 2>/dev/null
git worktree add -q "$WORK/wt-gone" -b wt-gone main~1 2>/dev/null
git worktree lock --reason "locked for test" "$WORK/wt-branch"
rm -rf "$WORK/wt-gone"
git worktree list --porcelain -z > "$OUT/worktree-list.bin"

# Ahead/behind: local main is ahead (merge state aborted first)
git merge --abort 2>/dev/null || true
git stash -q -u 2>/dev/null || true
git rev-list --left-right --count main...origin/main > "$OUT/rev-list-count.txt"
git for-each-ref --format='%(refname)%00%(objectname)%00%(upstream)%00%(upstream:track,nobracket)%00%(committerdate:unix)%00%(HEAD)' refs/heads refs/remotes > "$OUT/for-each-ref.txt"

git grep -n -I --column -z --no-color -F -e "e" > "$OUT/grep.bin" || true
git ls-files -co --exclude-standard -z > "$OUT/ls-files.bin"

# A larger made-up repo shaped like a busy project: many remote branches, a
# symbolic origin/HEAD, a long-lived branch far ahead of its upstream, a main
# far behind, and a stack of worktrees, most of them detached.
git init -q --bare "$WORK/large-remote.git"
git init -q -b main "$WORK/example"
cd "$WORK/example"
git commit -q --allow-empty -m "Initial commit"
git remote add origin "$WORK/large-remote.git"
git push -q -u origin main
git checkout -q -b rewrite
git push -q -u origin rewrite
for i in $(seq 61); do git commit -q --allow-empty -m "main $i"; done
git push -q origin HEAD:main
git reset -q --hard origin/rewrite
for b in feat/search-panel feat/blame-view fix/diff-scroll fix/unicode-paths chore/deps docs/readme \
         release/1.0 release/1.1 design/top-bar experiment/fast-status; do
  git push -q origin "HEAD:refs/heads/$b"
done
git remote set-head origin main
for i in $(seq 354); do git commit -q --allow-empty -m "rewrite $i"; done
git branch prototype/quick-open HEAD~3
git branch refactor/menu-model HEAD~2
git branch ticket/42 HEAD~1
git status --porcelain=v2 -z --branch --untracked-files=all > "$OUT/large-status-v2.bin"
git for-each-ref --format='%(refname)%00%(objectname)%00%(upstream)%00%(upstream:track,nobracket)%00%(committerdate:unix)%00%(HEAD)' refs/heads refs/remotes > "$OUT/large-for-each-ref.txt"

WT="$WORK/example-worktrees"
git worktree add -q --detach "$WT/wt-1" HEAD 2>/dev/null
git worktree add -q "$WT/wt-2" prototype/quick-open 2>/dev/null
git worktree add -q "$WT/wt-3" refactor/menu-model 2>/dev/null
git worktree add -q "$WT/wt-4" ticket/42 2>/dev/null
for i in 5 6 7 8 9; do git worktree add -q --detach "$WT/wt-$i" "HEAD~$i" 2>/dev/null; done
git worktree list --porcelain -z > "$OUT/large-worktree-list.bin"

echo "fixtures written to $OUT"
ls -la "$OUT"
