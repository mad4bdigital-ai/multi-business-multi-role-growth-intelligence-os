import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DATABASE_RUNTIME_IDENTITY_ENV,
  readDatabaseIdentityChangedFiles,
  scanDatabaseRuntimeIdentity,
} from "./scripts/database-runtime-identity-policy.mjs";

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "database-runtime-identity-policy-"));

try {
  fs.mkdirSync(path.join(temporaryRoot, ".github", "workflows"), { recursive: true });
  fs.mkdirSync(path.join(temporaryRoot, "http-generic-api"), { recursive: true });
  fs.mkdirSync(path.join(temporaryRoot, "docs"), { recursive: true });
  fs.mkdirSync(path.join(temporaryRoot, "tests"), { recursive: true });

  fs.writeFileSync(path.join(temporaryRoot, "http-generic-api", "safe.js"), `
export function resolve(env = process.env) {
  return {
    runtime: String(env.DB_NAME || "").trim(),
    governance: String(env.GOVERNANCE_DB_NAME || "").trim(),
    persistence: String(env.RUNTIME_PERSISTENCE_DB_NAME || "").trim(),
  };
}
`, "utf8");

  fs.writeFileSync(path.join(temporaryRoot, "http-generic-api", "bad-fallback.js"), `
const database = process.env.DB_NAME || "synthetic_runtime_db";
`, "utf8");

  fs.writeFileSync(path.join(temporaryRoot, "http-generic-api", "bad-static.js"), `
const TARGET_SCHEMA = "synthetic_schema";
`, "utf8");

  fs.writeFileSync(path.join(temporaryRoot, "http-generic-api", "bad-hostinger.js"), `
const database = "u123456_synthetic_db";
`, "utf8");

  fs.writeFileSync(path.join(temporaryRoot, "http-generic-api", "bad-shell.sh"), `
DATABASE="\${GOVERNANCE_DB_NAME:-synthetic_governance_db}"
`, "utf8");

  fs.writeFileSync(path.join(temporaryRoot, ".github", "workflows", "bad-manual.yml"), `
on:
  workflow_dispatch:
    inputs:
      target_schema:
        required: true
jobs:
  capture:
    env:
      TARGET_SCHEMA: \${{ inputs.target_schema }}
`, "utf8");

  fs.writeFileSync(path.join(temporaryRoot, ".github", "workflows", "safe-env.yml"), `
jobs:
  observe:
    steps:
      - run: node observe.mjs
        env:
          DB_IDENTITY_ENV_KEY: DB_NAME
`, "utf8");

  fs.writeFileSync(path.join(temporaryRoot, "docs", "example.md"), `
Documentation example only: DB_NAME: synthetic_documentation_db
`, "utf8");

  fs.writeFileSync(path.join(temporaryRoot, "tests", "fixture.js"), `
export const db = "u123456_fixture_db";
`, "utf8");

  fs.writeFileSync(path.join(temporaryRoot, "http-generic-api", "suppressed.js"), `
// database-runtime-identity-policy: allow database_identity_literal -- Synthetic compatibility fixture owned by an external protocol.
const TARGET_SCHEMA = "synthetic_protocol_schema";
`, "utf8");

  assert.deepEqual(DATABASE_RUNTIME_IDENTITY_ENV, {
    runtime: "DB_NAME",
    governance: "GOVERNANCE_DB_NAME",
    persistence: "RUNTIME_PERSISTENCE_DB_NAME",
  });

  const safe = scanDatabaseRuntimeIdentity({
    repositoryRoot: temporaryRoot,
    changedFiles: [
      "http-generic-api/safe.js",
      ".github/workflows/safe-env.yml",
    ],
  });
  assert.equal(safe.summary.blocking_finding_count, 0);
  assert.equal(safe.secrets_included, false);

  const bad = scanDatabaseRuntimeIdentity({
    repositoryRoot: temporaryRoot,
    changedFiles: [
      "http-generic-api/bad-fallback.js",
      "http-generic-api/bad-static.js",
      "http-generic-api/bad-hostinger.js",
      "http-generic-api/bad-shell.sh",
      ".github/workflows/bad-manual.yml",
      "docs/example.md",
      "tests/fixture.js",
      "http-generic-api/suppressed.js",
    ],
  });
  const blockingRules = new Set(
    bad.findings
      .filter((item) => !item.suppressed && item.zone === "runtime")
      .map((item) => item.rule_id),
  );
  assert(blockingRules.has("database_identity_literal"));
  assert(blockingRules.has("database_identity_fallback_literal"));
  assert(blockingRules.has("database_identity_manual_override"));
  assert(bad.findings.some((item) => item.zone === "documentation"));
  assert(bad.findings.some((item) => item.zone === "test"));
  assert(bad.findings.some((item) => item.path.endsWith("suppressed.js") && item.suppressed));
  assert(bad.findings.every((item) => item.value_disclosed === false));
  assert.equal(bad.secrets_included, false);

  const changedFilesPath = path.join(temporaryRoot, "changed-files.txt");
  fs.writeFileSync(changedFilesPath, "./http-generic-api/safe.js\n.github/workflows/bad-manual.yml\n", "utf8");
  assert.deepEqual(readDatabaseIdentityChangedFiles(changedFilesPath), [
    "http-generic-api/safe.js",
    ".github/workflows/bad-manual.yml",
  ]);

  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const liveWorkflow = fs.readFileSync(
    path.join(repositoryRoot, ".github", "workflows", "ueacp-live-source-capture.yml"),
    "utf8",
  );
  assert.doesNotMatch(liveWorkflow, /\$\{\{\s*inputs\.target_schema\s*\}\}/u);
  assert.doesNotMatch(liveWorkflow, /^\s+target_schema:\s*$/mu);
  assert.match(liveWorkflow, /name:\s*"DB_NAME"/u);
  assert.match(liveWorkflow, /TARGET_SCHEMA=/u);
  assert.match(liveWorkflow, /Hostinger App Env/u);

  const actualPolicy = scanDatabaseRuntimeIdentity({
    repositoryRoot,
    changedFiles: [
      ".github/workflows/ueacp-live-source-capture.yml",
      ".github/scripts/authority-live-census-observation.mjs",
      "http-generic-api/db.js",
      "http-generic-api/governanceDb.js",
    ],
  });
  assert.equal(actualPolicy.summary.blocking_finding_count, 0, JSON.stringify(actualPolicy.findings, null, 2));

  console.log("database runtime identity policy tests passed");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
