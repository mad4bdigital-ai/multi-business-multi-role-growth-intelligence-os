#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const workflowPath = path.join(root, ".github/workflows/ci.yml");
const workflow = fs.readFileSync(workflowPath, "utf8");

assert(workflow.includes("name: CI\n"), "canonical CI workflow name must remain unchanged");
assert(workflow.includes("  workflow_dispatch:\n"), "manual diagnostic trigger must remain available");
assert(workflow.includes("  push:\n"), "push validation trigger must remain available");
assert(workflow.includes("  pull_request:\n    branches: [main, Production]\n"), "canonical CI pull-request trigger must remain unchanged");
assert(workflow.includes("  syntax:\n"), "syntax job must remain registered");
assert(workflow.includes("  test:\n"), "unit and integration test job must remain registered");
assert(workflow.includes("  execution-resolver-gate:\n"), "execution resolver gate must remain registered");
assert(workflow.includes("  architecture-drift:\n"), "architecture drift job must remain registered");
assert(!workflow.includes("  local-connector-production-closure:\n"), "obsolete one-shot Production closure must not remain in canonical CI");
assert(!workflow.includes("issues: write"), "pull-request CI must not receive issue write permission");
assert(!workflow.includes("pull-requests: write"), "pull-request CI must not receive pull-request write permission");
assert(!workflow.includes("BACKEND_API_KEY"), "pull-request CI must not bind the historical runtime mutation secret");
assert(!workflow.includes("governed-local-connector-production-closure.mjs"), "historical runtime closure script must not be invoked by canonical CI");
assert(!workflow.includes("RUN_LOCAL_CONNECTOR_PRODUCTION_CLOSURE_CI_V18_PR_3945_792FF63A"), "retired one-shot closure token must not remain in permanent CI");

console.log(JSON.stringify({
  ok: true,
  tests: 14,
  workflow: ".github/workflows/ci.yml",
  canonical_ci_registered: true,
  canonical_ci_read_only: true,
  obsolete_one_shot_closure_removed: true,
  pull_request_write_permissions: false,
  runtime_mutation_secret_bound: false,
  secrets_included: false
}));
