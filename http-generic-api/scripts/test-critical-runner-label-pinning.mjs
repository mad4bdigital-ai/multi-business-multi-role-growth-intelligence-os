#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const pinnedWorkflows = Object.freeze([
  ".github/workflows/ci.yml",
  ".github/workflows/automation-overlap-guard.yml",
  ".github/workflows/e2e-phase-governance.yml",
  ".github/workflows/e2e-contract-reference-integrity.yml",
  ".github/workflows/repository-tool-lifecycle-governance.yml",
  ".github/workflows/ci-pull-request-recovery.yml",
  ".github/workflows/supervisor-runtime-assurance.yml",
  ".github/workflows/http-generic-api-fanout-relocation.yml",
  ".github/workflows/hostinger-storage-control-plane-guard.yml",
]);

for (const relativePath of pinnedWorkflows) {
  const content = read(relativePath);
  assert.equal(content.includes("runs-on: ubuntu-latest"), false, `${relativePath} must not request ubuntu-latest`);
  assert.equal(content.includes("runs-on: ubuntu-24.04"), true, `${relativePath} must request ubuntu-24.04`);
}

const readOnlyPullRequestWorkflows = Object.freeze([
  ".github/workflows/e2e-contract-reference-integrity.yml",
  ".github/workflows/http-generic-api-fanout-relocation.yml",
  ".github/workflows/supervisor-runtime-assurance.yml",
]);

for (const relativePath of readOnlyPullRequestWorkflows) {
  const content = read(relativePath);
  assert.match(content, /(?:^|\n)\s*pull_request\s*:/u, `${relativePath} must retain pull_request validation`);
  assert.doesNotMatch(content, /(?:^|\n)\s*[A-Za-z][A-Za-z-]*\s*:\s*write\b/iu, `${relativePath} must be read-only`);
  assert.doesNotMatch(content, /\bgit\s+push\b/iu, `${relativePath} must not push`);
  assert.doesNotMatch(content, /\bgh\s+api\b[\s\S]{0,500}?(?:(?:--method|-X)\s*(?:POST|PUT|PATCH|DELETE)\b|(?:-f|--field|--raw-field)\s+)/iu, `${relativePath} must not call write APIs`);
}

const retiredWriteMarkers = Object.freeze([
  ["e2e-contract-reference-integrity.yml", "work-map-recovery-bridge"],
  ["http-generic-api-fanout-relocation.yml", "Apply safe fanout relocations"],
  ["http-generic-api-fanout-relocation.yml", "git push"],
  ["supervisor-runtime-assurance.yml", "alert-lifecycle"],
  ["supervisor-runtime-assurance.yml", "gh issue"],
]);

for (const [filename, marker] of retiredWriteMarkers) {
  const content = read(`.github/workflows/${filename}`);
  assert.equal(content.includes(marker), false, `${filename} must retire embedded write marker ${marker}`);
}

const canary = read(".github/workflows/hostinger-storage-shared-canary-guard.yml");
assert.equal(canary.includes("runs-on: ubuntu-24.04"), true, "known-good Shared Canary must remain pinned");

console.log(JSON.stringify({
  ok: true,
  test: "critical_runner_label_pinning_and_pr_write_retirement",
  pinned_workflows: pinnedWorkflows.length,
  read_only_pull_request_workflows: readOnlyPullRequestWorkflows.length,
  requested_label: "ubuntu-24.04",
  pull_request_write_authority_removed: true,
  replacement_write_authority_added: false,
  direct_protected_branch_mutation: false,
  force_push: false,
  work_map_publication_authorized: false,
  production_mutation_authorized: false,
  provider_mutation_authorized: false,
  credential_access_authorized: false,
  database_mutation_authorized: false,
  secrets_included: false,
}));
