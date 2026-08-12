#!/usr/bin/env node
/**
 * Build a deterministic repository inventory from the Git index.
 * The JSON artifact is the complete machine-readable file inventory; the
 * Markdown artifact is a human-readable summary generated from the same data.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputJson = process.env.INVENTORY_JSON ?? "docs/repository-inventory.json";
const outputMarkdown = process.env.INVENTORY_MARKDOWN ?? "docs/repository-inventory.md";
const checkOnly = process.argv.includes("--check");
const generatedPaths = new Set([outputJson, outputMarkdown]);

function run(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: "utf8" }).trim();
}

function normalize(path) {
  return path.split(sep).join("/");
}

function category(path) {
  if (path.startsWith(".github/workflows/")) return "ci-workflows";
  if (path.startsWith(".github/")) return "ci-config";
  if (path.includes("/migrations/") || path.startsWith("migrations/")) return "database-migrations";
  if (path.includes("/openapi/") || path.includes("openapi")) return "api-contracts";
  if (path.startsWith("docs/") || path.endsWith(".md")) return "documentation";
  if (path.includes("test") || path.includes("spec")) return "tests-and-specs";
  if (path.includes("schema") || path.endsWith(".sql")) return "schemas-and-data";
  if (path.startsWith("apps/")) return "applications";
  if (path.startsWith("src/")) return "source";
  if (path.startsWith("http-generic-api/")) return "api-runtime";
  if (path.startsWith("local-connector/") || path.startsWith("edge/")) return "connectors-and-edge";
  if (/package(-lock)?\.json$|pnpm-lock|yarn\.lock|requirements|pyproject|Dockerfile|docker-compose/i.test(path)) return "build-and-dependencies";
  return "root-and-other";
}

function extension(path) {
  const base = path.split("/").pop();
  if (!base.includes(".")) return "[no extension]";
  return extname(base).toLowerCase() || "[no extension]";
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

const commit = {
  sha: run("git", ["rev-parse", "HEAD"]),
  branch: run("git", ["branch", "--show-current"]),
  subject: run("git", ["log", "-1", "--format=%s"]),
  date: run("git", ["log", "-1", "--format=%aI"]),
};

const tracked = run("git", ["ls-files", "-z"]).split("\0").filter(Boolean).map(normalize).filter((path) => !generatedPaths.has(path));
const files = tracked.map((path) => {
  const stats = statSync(`${root}/${path}`);
  return {
    path,
    category: category(path),
    extension: extension(path),
    bytes: stats.size,
    lines: lineCount(path, stats.size),
    generated: generatedPaths.has(path),
  };
});

const counts = (items, key) => Object.fromEntries([...items.reduce((map, item) => map.set(item[key], (map.get(item[key]) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1]));
const byCategory = counts(files, "category");
const byExtension = counts(files, "extension");
const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
const packages = files.filter((file) => /(^|\/)package\.json$/.test(file.path)).map((file) => readPackage(file.path)).filter(Boolean);
const workflows = files.filter((file) => file.category === "ci-workflows").map((file) => file.path);
const migrations = files.filter((file) => file.category === "database-migrations").map((file) => file.path);
const contracts = files.filter((file) => file.category === "api-contracts").map((file) => file.path);
const tests = files.filter((file) => file.category === "tests-and-specs").map((file) => file.path);

const inventory = {
  schemaVersion: 1,
  generatedFrom: "git-index",
  commit,
  totals: { files: files.length, bytes: totalBytes, lines: files.reduce((sum, file) => sum + (file.lines ?? 0), 0), categories: Object.keys(byCategory).length },
  counts: { byCategory, byExtension },
  packages,
  surfaces: { workflows, migrations, apiContracts: contracts, tests },
  files,
};

function rows(entries) { return entries.map(([key, value]) => `| \`${key}\` | ${value.toLocaleString("en-US")} |`).join("\n") || "| none | 0 |"; }
function fileRows(entries) { return entries.slice(0, 30).map((file) => `| \`${file.path}\` | ${file.category} | ${file.bytes.toLocaleString("en-US")} | ${file.lines ?? "n/a"} |`).join("\n") || "| none | — | 0 | n/a |"; }

const markdown = `<!-- GENERATED FILE. Run npm run inventory:write. Do not edit manually. -->
# Dynamic Repository Inventory

This report is generated from the Git index at commit \`${commit.sha.slice(0, 12)}\`. It is intentionally derived from the repository itself so that new files, packages, workflows, migrations, contracts, tests, and documentation appear automatically as the project grows.

## Snapshot

| Metric | Value |
|---|---:|
| Tracked files | ${inventory.totals.files.toLocaleString("en-US")} |
| Total bytes | ${inventory.totals.bytes.toLocaleString("en-US")} |
| Counted text lines | ${inventory.totals.lines.toLocaleString("en-US")} |
| Categories | ${inventory.totals.categories} |
| Git branch | \`${commit.branch}\` |
| Commit date | ${commit.date} |

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
| Test/spec files | ${tests.length.toLocaleString("en-US")} |
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

The complete inventory of every tracked file, including category, extension, byte size, line count, and generated-file marker, is available in the repository-inventory.json artifact. The JSON file is the authoritative artifact for automation and downstream analysis.

## Regeneration

Run npm run inventory:check to verify that committed artifacts match the current Git index. Run npm run inventory:write to regenerate both artifacts locally. CI regenerates the artifacts on relevant changes and fails if the working tree becomes dirty.
`;

const jsonText = `${JSON.stringify(inventory, null, 2)}\n`;
const outputs = [[outputJson, jsonText], [outputMarkdown, markdown]];
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
  writeFileSync(`${root}/${outputJson}`, jsonText);
  writeFileSync(`${root}/${outputMarkdown}`, markdown);
  console.log(JSON.stringify({ ok: true, files: files.length, bytes: totalBytes, workflows: workflows.length, migrations: migrations.length, contracts: contracts.length, tests: tests.length, outputJson, outputMarkdown }, null, 2));
}
