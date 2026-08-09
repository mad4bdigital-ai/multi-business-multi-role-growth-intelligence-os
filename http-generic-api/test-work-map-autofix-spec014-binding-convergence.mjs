#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.resolve(HERE, "..", ".github", "workflows", "spec-kit-work-map-autofix.yml");
const producerPath = path.join(HERE, "scripts", "spec014-refresh-final-work-map-binding.mjs");
const workflow = fs.readFileSync(workflowPath, "utf8");
const producer = fs.readFileSync(producerPath, "utf8");

const hostingerManifest = "specs/014-governed-hostinger-storage-orchestration/work-map-integration.json";
const hostingerTasks = "specs/014-governed-hostinger-storage-orchestration/tasks.md";
const retailManifest = "specs/014-retail-commerce-operations-growth-os/work-map-integration.json";

assert.match(workflow, /node http-generic-api\/scripts\/platform-work-map-generator\.mjs --write/u);
assert.match(workflow, /node http-generic-api\/scripts\/spec014-refresh-final-work-map-binding\.mjs\s*$/mu);
assert.match(
  workflow,
  /node http-generic-api\/scripts\/spec014-refresh-final-work-map-binding\.mjs --feature-key 014-retail-commerce-operations-growth-os/u,
);
assert.match(workflow, /node http-generic-api\/scripts\/platform-work-map-generator\.mjs --check/u);
assert.match(workflow, /node http-generic-api\/scripts\/spec014-refresh-final-work-map-binding\.mjs --check/u);
assert.match(
  workflow,
  /node http-generic-api\/scripts\/spec014-refresh-final-work-map-binding\.mjs --feature-key 014-retail-commerce-operations-growth-os --check/u,
);

for (const governedPath of [hostingerManifest, hostingerTasks, retailManifest]) {
  assert.ok(workflow.includes(governedPath), `writer allowlist/staging must include ${governedPath}`);
}

assert.match(workflow, /first_diff_hash=/u);
assert.match(workflow, /second_diff_hash=/u);
assert.match(workflow, /test "\$\{first_diff_hash\}" = "\$\{second_diff_hash\}"/u);
assert.match(workflow, /git add -- docs\/work-maps/u);
assert.doesNotMatch(workflow, /git push[^\n]*(?:--force|-f)(?:\s|$)/u);
assert.match(workflow, /remote_head_sha=.*git ls-remote/u);
assert.match(workflow, /test "\$\{remote_head_sha\}" = "\$\{EXPECTED_HEAD_SHA\}"/u);

assert.match(producer, /const DEFAULT_FEATURE_KEY = "014-governed-hostinger-storage-orchestration"/u);
assert.match(producer, /--feature-key/u);
assert.match(producer, /--check/u);
assert.match(producer, /classification_coverage_percent !== 100/u);
assert.match(producer, /effectiveRegistry\.maps\.length !== 19/u);
assert.match(producer, /effectiveRegistry\.domains\.length !== 16/u);
assert.match(producer, /provider_dispatch: false/u);
assert.match(producer, /live_database_access: false/u);
assert.match(producer, /migration_apply: false/u);
assert.match(producer, /secrets_included: false/u);

console.log(JSON.stringify({
  contract: "mad4b.work-map-autofix-spec014-binding-convergence-test.v1",
  ok: true,
  combined_idempotency: true,
  exact_head_push: true,
  force_push: false,
  protected_branch_mutation: false,
  provider_dispatch: false,
  live_database_access: false,
  migration_apply: false,
  secrets_included: false,
}));
