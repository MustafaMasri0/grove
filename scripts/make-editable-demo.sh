#!/usr/bin/env bash
# A throwaway repository with local config and secret files, to try editing them on:
#   bash scripts/make-editable-demo.sh C:/Temp/grove-editable
#   .\scripts\test-run.ps1 -Repo C:\Temp\grove-editable\example-app
# .env is ignored (editable, not in git), .env.example is tracked (editable, in git),
# config/app.local.json sits in a folder, secrets.local.bin is not text (named, but read-only),
# and src/app.ts matches no pattern (read-only). A second worktree has its own .env.
set -euo pipefail
root="${1:?usage: make-editable-demo.sh <new folder>}"
if [ -e "$root" ]; then
  echo "$root already exists; pass a new folder" >&2
  exit 1
fi
mkdir -p "$root/example-app"
cd "$root/example-app"
g() { git -c user.name="Dev Example" -c user.email=dev@example.com -c commit.gpgsign=false "$@"; }
g init -q -b main
mkdir -p src config
printf 'export const port = Number(process.env.PORT ?? 3000);\n' > src/app.ts
printf '# Copy to .env and fill in\nPORT=3000\nAPI_KEY=\n' > .env.example
printf '.env\n*.local.*\n' > .gitignore
printf '# Example app\n\nCopy .env.example to .env.\n' > README.md
g add . && g commit -q -m "Initial commit"

printf 'PORT=3000\nAPI_KEY=example-key\nDATABASE_URL=postgres://localhost/example\n' > .env
printf '{\n  "debug": true\n}\n' > config/app.local.json
printf 'not\0text\0' > secrets.local.bin

g worktree add -q -b agent/try-port "$root/worktrees/agent-a" main
printf 'PORT=4000\nAPI_KEY=other-key\n' > "$root/worktrees/agent-a/.env"
echo "Made $root/example-app and the worktree $root/worktrees/agent-a"
