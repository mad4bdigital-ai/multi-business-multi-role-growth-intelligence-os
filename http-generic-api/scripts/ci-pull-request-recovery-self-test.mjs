#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const recoveryPath = path.join(root, ".github/workflows/ci-pull-request-recovery.yml");
const canonicalPath = path.join(root, ".github/workflows/ci.yml");

const recovery = fs.readFileSync(recoveryPath, "utf8");
const canonical = fs.readFileSync(canonicalPath, "utf8");

const requiredRecoveryTokens = [
  "name: CI Pull Request Recovery",
  "pull_request:",
  "branches: [main, Production]",
  "types: [opened, reopened, synchronize, ready_for_review]",
  "permissions:\n  contents: read",
  "name: Syntax Check",
  "name: Unit & Integration Tests",
  "ref: ${{ github.event.pull_request.head.sha || github.sha }}",
  "Verify exact candidate checkout",
  "test \"$(git rev-parse HEAD)\" = \"$EXPECTED_SHA\"",
  "node scripts/user-jwt-auth-governance.mjs",
  "PULL_REQUEST_HEAD_REF: ${{ github.event.pull_request.head.ref }}",
  "PULL_REQUEST_BASE_REF: ${{ github.event.pull_request.base.ref }}",
  "\"$PULL_REQUEST_BASE_REF\" == \"Production\"",
  "node http-generic-api/scripts/e2e-parallel-pr-gate.mjs",
  "phase_evaluation_base",
  "git diff --name-only \"$BASE_SHA\" HEAD",
  "node scripts/context-kernel-hardcoding-scan.mjs --fail-on=runtime",
  "Run tests with exact checked-out identity",
  "GITHUB_SHA=\"$actual_sha\" npm test",
  "node test-server-startup-smoke.mjs",
  "node scripts/interruption-readiness.mjs --ci --skip-dependencies --skip-merge --skip-worktree --verify-evidence"
];

for (const token of requiredRecoveryTokens) {
  assert(recovery.includes(token), `missing recovery workflow token: ${token}`);
}

for (const forbidden of ["pull_request_target:", "actions: write", "contents: write", "deployments: write", "id-token: write", "secrets.", "gh workflow run", "workflow_run:"]) {
  assert(!recovery.includes(forbidden), `forbidden recovery workflow token: ${forbidden}`);
}

assert(canonical.includes("name: CI"), "canonical CI workflow name missing");
assert(canonical.includes("pull_request:\n    branches: [main, Production]"), "canonical CI pull_request trigger missing");
assert(canonical.includes("name: Syntax Check"), "canonical Syntax Check job missing");
assert(canonical.includes("name: Unit & Integration Tests"), "canonical Unit & Integration Tests job missing");

for (const token of [
  "PULL_REQUEST_HEAD_REF: ${{ github.event.pull_request.head.ref }}",
  "PULL_REQUEST_BASE_REF: ${{ github.event.pull_request.base.ref }}",
  "\"$PULL_REQUEST_BASE_REF\" == \"Production\"",
  "node http-generic-api/scripts/e2e-parallel-pr-gate.mjs",
  "phase_evaluation_base",
  "git diff --name-only \"$BASE_SHA\" HEAD"
]) {
  assert(canonical.includes(token), "canonical CI missing production ratchet token: " + token);
}

const exactCheckoutCount = recovery.split("ref: ${{ github.event.pull_request.head.sha || github.sha }}").length - 1;
assert.equal(exactCheckoutCount, 2, `expected two exact candidate checkouts, got ${exactCheckoutCount}`);

const testJobNeedsSyntax = /test:\n\s+name: Unit & Integration Tests[\s\S]*?needs: syntax/.test(recovery);
assert(testJobNeedsSyntax, "Unit & Integration Tests must depend on Syntax Check");

console.log(JSON.stringify({
  ok: true,
  tests: requiredRecoveryTokens.length + 8,
  workflow: ".github/workflows/ci-pull-request-recovery.yml",
  exact_checkout_count: exactCheckoutCount,
  canonical_workflow_unchanged: false,
  production_promotion_phase_base: true,
  pull_request_target: false,
  write_permissions: false,
  secrets_included: false
}));
