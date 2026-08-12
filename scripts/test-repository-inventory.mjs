#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const inventory = JSON.parse(readFileSync(`${root}/docs/repository-inventory.json`, "utf8"));
const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
const generated = new Set(["docs/repository-inventory.json", "docs/repository-inventory.md"]);
const expected = tracked.filter((path) => !generated.has(path));
const paths = inventory.files.map((file) => file.path);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(inventory.schemaVersion === 1, "unexpected inventory schema version");
assert(inventory.generatedFrom === "git-index", "inventory must be generated from git index");
assert(inventory.totals.files === expected.length, `file count mismatch: ${inventory.totals.files} != ${expected.length}`);
assert(JSON.stringify(paths) === JSON.stringify([...paths].sort()), "file paths must be sorted deterministically");
assert(new Set(paths).size === paths.length, "inventory contains duplicate file paths");
assert(!paths.some((path) => generated.has(path)), "generated artifacts must not inventory themselves");
assert(inventory.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)), "every file must have a SHA-256 fingerprint");
assert(inventory.files.every((file) => /^[0-7]{3}$/.test(file.mode)), "every file must have a normalized Unix mode");
assert(inventory.totals.bytes === inventory.files.reduce((sum, file) => sum + file.bytes, 0), "byte total mismatch");
assert(inventory.directories.length === new Set(inventory.directories).size, "directory list contains duplicates");
console.log(`repository inventory self-test passed: ${inventory.totals.files} files, ${inventory.totals.directories} directories`);
