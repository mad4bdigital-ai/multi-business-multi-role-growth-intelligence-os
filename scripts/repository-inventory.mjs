#!/usr/bin/env node
/**
 * Build a deterministic repository inventory from the Git index.
 * The JSON artifact is the complete machine-readable file inventory; the
 * Markdown artifact is a human-readable summary generated from the same data.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { category, extension, isTestOrSpec } from "./repository-inventory-rules.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputJson = process.env.INVENTORY_JSON ?? "docs/repository-inventory.json";
const outputMarkdown = process.env.INVENTORY_MARKDOWN ?? "docs/repository-inventory.md";
const outputSummary = process.env.INVENTORY_SUMMARY ?? "docs/repository-inventory-summary.json";
const checkOnly = process.argv.includes("--check");
const generatedPaths = new Set([
  outputJson,
  outputMarkdown,
  outputSummary,
  "docs/repository-evaluation.json",
  "docs/repository-evaluation.md",
  "docs/repository-evaluation-summary.json",
]);

function run(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim();
}

function normalize(path) {
  return path.split(sep).join("/");
}

function readPackage(path) {
  try {
    const parsed = JSON.parse(readFileSync(`${root}/${path}`, "utf8"));
    return { path, name: parsed.name ?? null, version: parsed.version ?? null, scripts: Object.keys(parsed.scripts ?? {}), dependencies: Object.keys(parsed.dependencies ?? {}).length, devDependencies: Object.keys(parsed.devDependencies ?? {}).length };
  } catch {
    return null;
  }
}

function lineCount(path, bytes) {
  if (bytes > 5 * 1024 * 1024) return null;
  try { return readFileSync(`${root}/${path}`, "utf8").split(/\r?\n/).length; } catch { return null; }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(`${root}/${path}`)).digest("hex");
}

const tracked = run("git", ["ls-files", "-z"]).split("\0").filter(Boolean).map(normalize).filter((path) => !generatedPaths.has(path));
const files = tracked.map((path) => {
  const stats = statSync(`${root}/${path}`);
  return {
    path,
    category: category(path),
    extension: extension(path),
    bytes: stats.size,
    lines: lineCount(path, stats.size),
    sha256: sha256(path),
    mode: (stats.mode & 0o777).toString(8).padStart(3, "0"),
    executable: Boolean(stats.mode & 0o111),
    generated: generatedPaths.has(path),
  };
});

const counts = (items, key) => Object.fromEntries([...items.reduce((map, item) => map.set(item[key], (map.get(item[key]) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1]));
const byCategory = counts(files, "category");
const byExtension = counts(files, "extension");
const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
const directories = [...new Set(files.flatMap((file) => {
  const parts = file.path.split("/");
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
}))].sort();
const topLevel = counts(files.map((file) => ({ value: file.path.split("/")[0] })), "value");
const packages = files.filter((file) => /(^|\/)package\.json$/.test(file.path)).map((file) => readPackage(file.path)).filter(Boolean);
const workflows = files.filter((file) => file.category === "ci-workflows").map((file) => file.path);
const migrations = files.filter((file) => file.category === "database-migrations").map((file) => file.path);
const contracts = files.filter((file) => file.category === "api-contracts").map((file) => file.path);
const tests = files.filter((file) => isTestOrSpec(file.path)).map((file) => file.path);

const inventory = {
  schemaVersion: 1,
  generatedFrom: "git-index",
  deterministic: true,
  totals: { files: files.length, bytes: totalBytes, lines: files.reduce((sum, file) => sum + (file.lines ?? 0), 0), directories: directories.length, categories: Object.keys(byCategory).length },
  counts: { byCategory, byExtension, topLevel },
  directories,

  packages,
  surfaces: { workflows, migrations, apiContracts: contracts, tests, testSpecFiles: tests },
  files,
};

const largestFiles = [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 20).map(({ path, category, bytes, lines }) => ({ path, category, bytes, lines }));
const summary = {
  schemaVersion: 1,
  generatedFrom: "git-index",
  deterministic: true,
  totals: inventory.totals,
  counts: inventory.counts,
  packages,
  surfaces: {
    workflows: workflows.length,
    migrations: migrations.length,
    apiContracts: contracts.length,
    testSpecFiles: tests.length,
  },
  largestFiles,
};

function rows(entries) { return entries.map(([key, value]) => `| \`${key}\` | ${value.toLocaleString("en-US")} |`).join("\n") || "| none | 0 |"; }
function fileRows(entries) { return entries.slice(0, 30).map((file) => `| \`${file.path}\` | ${file.category} | ${file.bytes.toLocaleString("en-US")} | ${file.lines ?? "n/a"} |`).join("\n") || "| none | — | 0 | n/a |"; }

const markdown = `<!-- GENERATED FILE. Run npm run inventory:write. Do not edit manually. -->
# Dynamic Repository Inventory

This report is generated deterministically from the Git index. It is intentionally derived from the repository itself so that new files, packages, workflows, migrations, contracts, tests, and documentation appear automatically as the project grows. Generated inventory and evaluation artifacts are excluded from the counted inputs to avoid a self-referential write cycle.

## Snapshot

| Metric | Value |
|---|---:|
| Tracked files | ${inventory.totals.files.toLocaleString("en-US")} |
| Total bytes | ${inventory.totals.bytes.toLocaleString("en-US")} |
| Counted text lines | ${inventory.totals.lines.toLocaleString("en-US")} |
| Directories | ${inventory.totals.directories.toLocaleString("en-US")} |
| Categories | ${inventory.totals.categories} |

## Files by category

| Category | Files |
|---|---:|
${rows(Object.entries(byCategory))}

## Files by extension

| Extension | Files |
|---|---:|
${rows(Object.entries(byExtension).slice(0, 40))}

## Important surfaces

| Surface | Count |
|---|---:|
| GitHub Actions workflows | ${workflows.length.toLocaleString("en-US")} |
| Database migrations | ${migrations.length.toLocaleString("en-US")} |
| API/OpenAPI contracts | ${contracts.length.toLocaleString("en-US")} |
| Test/spec files (paths) | ${tests.length.toLocaleString("en-US")} |
| package.json manifests | ${packages.length.toLocaleString("en-US")} |

## Package manifests

| Path | Name | Version | Scripts | Dependencies | Dev dependencies |
|---|---|---|---:|---:|---:|
${packages.map((pkg) => `| \`${pkg.path}\` | \`${pkg.name ?? "—"}\` | \`${pkg.version ?? "—"}\` | ${pkg.scripts.length} | ${pkg.dependencies} | ${pkg.devDependencies} |`).join("\n") || "| none | — | — | 0 | 0 | 0 |"}

## Largest tracked files

| Path | Category | Bytes | Lines |
|---|---|---:|---:|
${fileRows([...files].sort((a, b) => b.bytes - a.bytes))}

## Complete machine-readable inventory

The complete inventory of every non-generated tracked file, including category, extension, byte size, line count, SHA-256 content fingerprint, Unix mode, executable marker, and generated-file marker, is available in the repository-inventory.json artifact. The compact repository-inventory-summary.json artifact contains totals, grouped counts, package manifests, surface counts, and the largest files for low-noise review and downstream dashboards. The JSON file is the authoritative artifact for automation and downstream analysis; generated inventory and evaluation artifacts are intentionally omitted to keep regeneration deterministic.

## Regeneration

Run npm run inventory:check to verify that committed artifacts match the current Git index. Run npm run inventory:write to regenerate both artifacts locally. CI regenerates the artifacts on relevant changes and fails if the working tree becomes dirty.
`;

const jsonText = `${JSON.stringify(inventory, null, 2)}\n`;
const summaryText = `${JSON.stringify(summary, null, 2)}\n`;
const outputs = [[outputJson, jsonText], [outputMarkdown, markdown], [outputSummary, summaryText]];
const mismatches = outputs.filter(([path, expected]) => {
  try { return readFileSync(`${root}/${path}`, "utf8") !== expected; } catch { return true; }
});
if (checkOnly) {
  if (mismatches.length) {
    console.error(`Inventory artifacts are stale: ${mismatches.map(([path]) => path).join(", ")}`);
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ ok: true, checked: outputs.map(([path]) => path) }, null, 2));
  }
} else {
  mkdirSync(dirname(`${root}/${outputJson}`), { recursive: true });
  mkdirSync(dirname(`${root}/${outputMarkdown}`), { recursive: true });
  mkdirSync(dirname(`${root}/${outputSummary}`), { recursive: true });
  writeFileSync(`${root}/${outputJson}`, jsonText);
  writeFileSync(`${root}/${outputMarkdown}`, markdown);
  writeFileSync(`${root}/${outputSummary}`, summaryText);
  console.log(JSON.stringify({ ok: true, files: files.length, bytes: totalBytes, workflows: workflows.length, migrations: migrations.length, contracts: contracts.length, tests: tests.length, outputJson, outputMarkdown, outputSummary }, null, 2));
}
