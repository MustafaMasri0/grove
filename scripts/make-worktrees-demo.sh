#!/usr/bin/env bash
# A throwaway repository with three "agent" worktrees, two of them changing the
# same file, to try the Worktrees overview on:
#   bash scripts/make-worktrees-demo.sh C:/Temp/grove-demo
#   .\scripts\test-run.ps1 -Repo C:\Temp\grove-demo\example-app
set -euo pipefail
root="${1:?usage: make-worktrees-demo.sh <new folder>}"
if [ -e "$root" ]; then
  echo "$root already exists; pass a new folder" >&2
  exit 1
fi
mkdir -p "$root/example-app"
cd "$root/example-app"
g() { git -c user.name="Dev Example" -c user.email=dev@example.com -c commit.gpgsign=false "$@"; }
g init -q -b main
mkdir src
printf 'export function parse(s: string) {\n  return s.split(",");\n}\n' > src/parser.ts
printf 'export async function get(url: string) {\n  return fetch(url);\n}\n' > src/api.ts
printf '# Example app\n\nA small demo.\n' > README.md
g add . && g commit -q -m "Initial commit"

wt() { g worktree add -q -b "$2" "$root/worktrees/$1" main; }
wt agent-a agent/fix-parser
wt agent-b agent/add-cache
wt agent-c agent/docs

cd "$root/worktrees/agent-a"
printf 'export function parse(s: string) {\n  return s.split(",").map((x) => x.trim());\n}\n' > src/parser.ts
g commit -qam "Trim whitespace in the parser"
printf 'export async function get(url: string, retries = 3) {\n  return fetch(url);\n}\n' > src/api.ts

cd "$root/worktrees/agent-b"
printf 'const cache = new Map<string, Response>();\n' > src/cache.ts
printf 'import "./cache";\nexport async function get(url: string) {\n  return fetch(url, { cache: "force-cache" });\n}\n' > src/api.ts
g add . && g commit -qm "Cache GET requests"

cd "$root/worktrees/agent-c"
printf '# Example app\n\nA small demo.\n\n## Usage\n\nRun it.\n' > README.md
g commit -qam "Document usage"

cd "$root/example-app"
printf '{ "name": "example-app" }\n' > package.json
g add . && g commit -qm "Add package.json"
g worktree list
