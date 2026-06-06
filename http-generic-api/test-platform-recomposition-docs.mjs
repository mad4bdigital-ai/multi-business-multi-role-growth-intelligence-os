import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const apiDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(apiDir, "..");
const docsDir = path.join(repoDir, "docs", "platform-recomposition");

const read = (relativePath) => fs.readFileSync(path.join(repoDir, relativePath), "utf8");
const readJson = (relativePath) => JSON.parse(read(relativePath));

const index = read("docs/platform-recomposition/README.md");
const plan = read("docs/platform-recomposition/schema-cleanup-and-promotion-plan-2026-05-28.md");
const connectorRecord = read("docs/platform-recomposition/local-connector-autoreconnect-and-desktop-manager-2026-05-18.md");
const workbookReview = read("docs/platform-recomposition/drive-workbooks-review-2026-05-18.md");

for (const name of fs.readdirSync(docsDir).filter((name) => fs.statSync(path.join(docsDir, name)).isFile())) {
  assert.ok(index.includes(`\`${name}\``) || index.includes(`(${name})`), `README must classify ${name}`);
}

for (const name of fs.readdirSync(docsDir).filter((name) => name.endsWith(".md"))) {
  const headings = fs.readFileSync(path.join(docsDir, name), "utf8")
    .split(/\r?\n/)
    .filter((line) => /^#{1,3}\s/.test(line))
    .map((line) => line.trim());
  const duplicates = headings.filter((heading, position) => headings.indexOf(heading) !== position);
  assert.deepEqual(duplicates, [], `${name} must not contain duplicate headings`);
}

assert.doesNotMatch(plan, /Status:\s*in progress/i);
for (const phase of ["S1", "S2", "S3", "S4", "S5"]) {
  assert.match(plan, new RegExp(`Phase ${phase}[\\s\\S]*?Status: completed\\.`), `${phase} must remain completed`);
}

assert.doesNotMatch(workbookReview, /\?\?\?/);
assert.doesNotMatch(connectorRecord, /still contains older duplicate provisioning logic/);
assert.match(connectorRecord, /delegates to `provisionLocalConnectorInstall\(\)`/);

function normalizeStagedRefs(value) {
  if (Array.isArray(value)) return value.map(normalizeStagedRefs);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    key === "$ref" && typeof child === "string" ? child.replace(/^\.\.\/\.\.\//, "") : normalizeStagedRefs(child),
  ]));
}

const stagedSchema = normalizeStagedRefs(readJson("docs/platform-recomposition/memory_schema.clean-v1.json"));
const rootSchema = readJson("memory_schema.json");
assert.deepEqual(stagedSchema, rootSchema, "staged memory schema must match promoted root schema after ref normalization");

console.log("platform recomposition documentation checks passed");
