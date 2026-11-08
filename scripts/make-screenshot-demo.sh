#!/usr/bin/env bash
# A throwaway repository for the README screenshots: a small TypeScript app with
# a few weeks of history by several made-up authors, and four "agent" worktrees
# with commits, uncommitted edits and files two of them both change.
#   bash scripts/make-screenshot-demo.sh C:/Temp/grove-shots
#   .\scripts\test-run.ps1 -Repo C:\Temp\grove-shots\example-app
set -euo pipefail
root="${1:?usage: make-screenshot-demo.sh <new folder>}"
if [ -e "$root" ]; then
  echo "$root already exists; pass a new folder" >&2
  exit 1
fi

now=$(date +%s)
# commit <hours ago> <author> <message>: commits everything staged, dated in the past.
commit() {
  local when=$((now - $1 * 3600)) name email
  case "$2" in
    ada) name="Ada Example"; email=ada@example.com ;;
    sam) name="Sam Sample"; email=sam@example.com ;;
    kim) name="Kim Placeholder"; email=kim@example.com ;;
    bot) name="Agent Example"; email=agent@example.com ;;
  esac
  GIT_AUTHOR_DATE="@$when" GIT_COMMITTER_DATE="@$when" \
    git -c user.name="$name" -c user.email="$email" -c commit.gpgsign=false \
    commit -q -m "$3"
}
put() { mkdir -p "$(dirname "$1")"; cat > "$1"; }

mkdir -p "$root/example-app"
cd "$root/example-app"
git init -q -b main
git config core.autocrlf false

put README.md <<'EOF'
# Weather board

A small dashboard that shows the forecast for a few cities.

## Getting started

```sh
npm install
npm run dev
```
EOF
put package.json <<'EOF'
{
  "name": "weather-board",
  "version": "0.3.0",
  "type": "module",
  "scripts": { "dev": "vite", "build": "tsc && vite build", "test": "vitest run" }
}
EOF
put .gitignore <<'EOF'
node_modules/
dist/
.env
EOF
put src/api/client.ts <<'EOF'
export interface Forecast {
  city: string;
  temperature: number;
  summary: string;
}

const BASE_URL = "https://api.example.com/v1";

export async function getForecast(city: string): Promise<Forecast> {
  const response = await fetch(`${BASE_URL}/forecast?city=${encodeURIComponent(city)}`);
  if (!response.ok) {
    throw new Error(`Forecast request failed: ${response.status}`);
  }
  return response.json();
}
EOF
put src/lib/format.ts <<'EOF'
export function formatTemperature(celsius: number): string {
  return `${Math.round(celsius)}°C`;
}

export function formatCity(city: string): string {
  return city.trim().replace(/\s+/g, " ");
}
EOF
put src/main.ts <<'EOF'
import { getForecast } from "./api/client";
import { formatCity, formatTemperature } from "./lib/format";

const cities = ["Lisbon", "Oslo", "Nairobi"];

async function render() {
  const list = document.querySelector("#forecasts")!;
  for (const city of cities) {
    const forecast = await getForecast(city);
    const item = document.createElement("li");
    item.textContent = `${formatCity(forecast.city)}: ${formatTemperature(forecast.temperature)}`;
    list.append(item);
  }
}

render();
EOF
git add . && commit 500 ada "Initial weather board"

put src/lib/format.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { formatCity, formatTemperature } from "./format";

describe("format", () => {
  it("rounds temperatures", () => {
    expect(formatTemperature(21.6)).toBe("22°C");
  });

  it("tidies city names", () => {
    expect(formatCity("  New   York ")).toBe("New York");
  });
});
EOF
git add . && commit 470 sam "Add tests for the formatters"

put src/styles.css <<'EOF'
body {
  font-family: system-ui, sans-serif;
  margin: 2rem;
}

#forecasts li {
  padding: 0.5rem 0;
  border-bottom: 1px solid #ddd;
}
EOF
git add . && commit 430 kim "Style the forecast list"

sed -i 's/const cities = \["Lisbon", "Oslo", "Nairobi"\];/const cities = ["Lisbon", "Oslo", "Nairobi", "Montreal"];/' src/main.ts
git add . && commit 380 ada "Add Montreal to the default cities"

put src/lib/units.ts <<'EOF'
export type Unit = "celsius" | "fahrenheit";

export function toFahrenheit(celsius: number): number {
  return celsius * 9 / 5 + 32;
}
EOF
git add . && commit 320 sam "Add a Fahrenheit conversion"

sed -i 's/"version": "0.3.0"/"version": "0.4.0"/' package.json
git add . && commit 300 kim "Release 0.4.0"

put src/api/cache.ts <<'EOF'
const entries = new Map<string, { value: unknown; expires: number }>();

export function remember<T>(key: string, value: T, seconds: number): T {
  entries.set(key, { value, expires: Date.now() + seconds * 1000 });
  return value;
}

export function recall<T>(key: string): T | undefined {
  const entry = entries.get(key);
  if (!entry || entry.expires < Date.now()) return undefined;
  return entry.value as T;
}
EOF
git add . && commit 200 ada "Add a small in-memory cache"

put docs/architecture.md <<'EOF'
# Architecture

- `src/api`: talks to the forecast service.
- `src/lib`: formatting and unit helpers.
- `src/main.ts`: renders the list.
EOF
git add . && commit 150 kim "Describe the architecture"

sed -i 's/border-bottom: 1px solid #ddd;/border-bottom: 1px solid #e5e5e5;\n  display: flex;\n  justify-content: space-between;/' src/styles.css
git add . && commit 90 sam "Lay out forecast rows as flex rows"

wt() { git worktree add -q -b "$2" "$root/worktrees/$1" main; }
wt fix-retry agent/retry-failed-requests
wt cache agent/cache-forecasts
wt units agent/unit-toggle
wt docs agent/readme-usage

# Retries: committed, plus an uncommitted edit. Touches client.ts like the cache agent.
cd "$root/worktrees/fix-retry"
put src/api/client.ts <<'EOF'
export interface Forecast {
  city: string;
  temperature: number;
  summary: string;
}

const BASE_URL = "https://api.example.com/v1";
const MAX_ATTEMPTS = 3;

export async function getForecast(city: string): Promise<Forecast> {
  const url = `${BASE_URL}/forecast?city=${encodeURIComponent(city)}`;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      lastError = new Error(`Forecast request failed: ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 250));
  }
  throw lastError;
}
EOF
git add . && commit 6 bot "Retry failed forecast requests with backoff"
put src/api/client.test.ts <<'EOF'
import { describe, expect, it, vi } from "vitest";
import { getForecast } from "./client";

describe("getForecast", () => {
  it("retries after a failed request", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ city: "Oslo" }) });
    vi.stubGlobal("fetch", fetchMock);
    await expect(getForecast("Oslo")).resolves.toMatchObject({ city: "Oslo" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
EOF

# Cache: two commits, client.ts again, and main.ts like the units agent.
cd "$root/worktrees/cache"
put src/api/client.ts <<'EOF'
import { recall, remember } from "./cache";

export interface Forecast {
  city: string;
  temperature: number;
  summary: string;
}

const BASE_URL = "https://api.example.com/v1";

export async function getForecast(city: string): Promise<Forecast> {
  const cached = recall<Forecast>(city);
  if (cached) return cached;
  const response = await fetch(`${BASE_URL}/forecast?city=${encodeURIComponent(city)}`);
  if (!response.ok) {
    throw new Error(`Forecast request failed: ${response.status}`);
  }
  return remember(city, await response.json(), 600);
}
EOF
git add . && commit 20 bot "Cache forecasts for ten minutes"
sed -i 's/^render();$/render();\nsetInterval(render, 10 * 60 * 1000);/' src/main.ts
git add . && commit 3 bot "Refresh the board every ten minutes"

# Units: nothing committed yet, several files changing.
cd "$root/worktrees/units"
sed -i 's/^import { formatCity, formatTemperature } from ".\/lib\/format";$/import { formatCity, formatTemperature } from ".\/lib\/format";\nimport { toFahrenheit, type Unit } from ".\/lib\/units";\n\nlet unit: Unit = "celsius";/' src/main.ts
put src/lib/units.ts <<'EOF'
export type Unit = "celsius" | "fahrenheit";

export function toFahrenheit(celsius: number): number {
  return celsius * 9 / 5 + 32;
}

export function convert(celsius: number, unit: Unit): number {
  return unit === "celsius" ? celsius : toFahrenheit(celsius);
}
EOF
put src/components/UnitToggle.ts <<'EOF'
import type { Unit } from "../lib/units";

export function unitToggle(onChange: (unit: Unit) => void): HTMLButtonElement {
  const button = document.createElement("button");
  let unit: Unit = "celsius";
  button.textContent = "°C";
  button.addEventListener("click", () => {
    unit = unit === "celsius" ? "fahrenheit" : "celsius";
    button.textContent = unit === "celsius" ? "°C" : "°F";
    onChange(unit);
  });
  return button;
}
EOF

# Docs: one clean commit.
cd "$root/worktrees/docs"
cat >> README.md <<'EOF'

## Usage

Open the board and pick the cities you care about. Forecasts refresh on their
own, and temperatures can be shown in Celsius or Fahrenheit.
EOF
git add . && commit 30 kim "Document usage in the README"

# A local bare "origin", with some branches published and one ahead of it.
cd "$root/example-app"
git init -q --bare "$root/origin.git"
git remote add origin "$root/origin.git"
git push -q origin main agent/readme-usage
git push -q origin "$(git rev-parse agent/cache-forecasts~1):refs/heads/agent/cache-forecasts"
git branch -q -u origin/main main
git branch -q -u origin/agent/cache-forecasts agent/cache-forecasts
git branch -q -u origin/agent/readme-usage agent/readme-usage
git fetch -q origin

put .env <<'EOF'
FORECAST_API_KEY=example-key
EOF
git worktree list
