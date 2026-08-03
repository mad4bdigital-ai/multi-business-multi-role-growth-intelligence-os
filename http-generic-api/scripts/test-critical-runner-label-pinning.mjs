#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const workflows = Object.freeze([
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

for (const relativePath of workflows) {
  const absolutePath = path.join(root, relativePath);
  assert.equal(fs.existsSync(absolutePath), true, `${relativePath} must exist`);
  const content = fs.readFileSync(absolutePath, "utf8");
  assert.equal(content.includes("runs-on: ubuntu-latest"), false, `${relativePath} must not request ubuntu-latest`);
  assert.equal(content.includes("runs-on: ubuntu-24.04"), true, `${relativePath} must request ubuntu-24.04`);
}

const canary = fs.readFileSync(
  path.join(root, ".github/workflows/hostinger-storage-shared-canary-guard.yml"),
  "utf8",
);
assert.equal(canary.includes("runs-on: ubuntu-24.04"), true, "known-good Shared Canary must remain pinned");

console.log(JSON.stringify({
  ok: true,
  test: "critical_runner_label_pinning",
  pinned_workflows: workflows.length,
  requested_label: "ubuntu-24.04",
  repository_write_authority_added: false,
  production_mutation_authorized: false,
  provider_mutation_authorized: false,
  credential_access_authorized: false,
  database_mutation_authorized: false,
  secrets_included: false,
}));
