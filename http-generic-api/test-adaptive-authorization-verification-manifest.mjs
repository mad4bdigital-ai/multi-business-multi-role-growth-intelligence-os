import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.join(
  root,
  "..",
  "specs",
  "006-adaptive-authorization-execution-governance",
  "verification-test-manifest.json",
);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const runner = fs.readFileSync(
  path.join(root, "scripts", "run-adaptive-authorization-verification-manifest.mjs"),
  "utf8",
);
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const tasks = fs.readFileSync(
  path.join(
    root,
    "..",
    "specs",
    "006-adaptive-authorization-execution-governance",
    "tasks.md",
  ),
  "utf8",
);

const expectedCategories = [
  "unit",
  "integration",
  "tenant_isolation",
  "replay",
  "stale_revision",
  "ambiguity",
  "redaction",
];
assert.deepEqual(manifest.required_categories, expectedCategories);
assert.equal(manifest.task, "T050");
assert.equal(manifest.evidence_contract.skipped_tests_count_as_pass, false);

const covered = new Set(manifest.tests.flatMap((entry) => entry.categories));
for (const category of expectedCategories) assert(covered.has(category));

const ids = manifest.tests.map((entry) => entry.id);
assert.equal(new Set(ids).size, ids.length);
for (const entry of manifest.tests) {
  assert.match(entry.script, /^[A-Za-z0-9._-]+\.mjs$/);
  assert(fs.existsSync(path.join(root, entry.script)), entry.script);
}

for (const value of Object.values(manifest.safety)) assert.equal(value, false);
assert(packageJson.scripts.test.includes("run-adaptive-authorization-verification-manifest.mjs"));
assert(runner.includes("spawnSync(process.execPath"));
assert(runner.includes('sensitiveDataScan: "passed"'));
assert(runner.includes("skipped: 0"));
assert(tasks.includes("- [x] T050 Register unit, integration, isolation, replay, stale-revision, ambiguity, and redaction tests."));

console.log("adaptive authorization verification manifest tests passed");
