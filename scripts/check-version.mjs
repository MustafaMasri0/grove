// Checks that the app's version is the same everywhere it is written, and, given
// a release tag, that the tag names that version. The release workflow runs it
// before building, so an installer is never published under the wrong number.
//   node scripts/check-version.mjs          # the three files agree
//   node scripts/check-version.mjs v0.2.0   # ... and say 0.2.0
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const cargo = read("Cargo.toml").match(/\[workspace\.package\][^[]*?^version\s*=\s*"([^"]+)"/ms)?.[1];
const versions = {
  "src-tauri/tauri.conf.json": JSON.parse(read("src-tauri/tauri.conf.json")).version,
  "package.json": JSON.parse(read("package.json")).version,
  "Cargo.toml [workspace.package]": cargo,
};

const tag = process.argv[2];
const expected = tag ? tag.replace(/^v/, "") : versions["src-tauri/tauri.conf.json"];
const wrong = Object.entries(versions).filter(([, v]) => v !== expected);
if (wrong.length) {
  console.error(`Expected version ${expected}${tag ? ` (from tag ${tag})` : ""}, but:`);
  for (const [file, v] of wrong) console.error(`  ${file} has ${v ?? "no version"}`);
  process.exit(1);
}
console.log(`Version ${expected} everywhere.`);
