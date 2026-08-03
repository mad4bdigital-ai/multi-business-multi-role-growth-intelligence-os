#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const workflowPath = path.join(root, ".github/workflows/production-runtime-parity-comment-bridge.yml");
const workflow = fs.readFileSync(workflowPath, "utf8");

assert.match(workflow, /^  issue_comment:\n    types: \[created\]$/mu);
assert.match(workflow, /^permissions:\n  contents: read\n  issues: read$/mu);
assert.doesNotMatch(workflow, /contents: write|issues: write|actions: write|pull-requests: write/u);
assert.match(workflow, /github\.event\.issue\.pull_request == null/u);
assert.match(workflow, /github\.event\.issue\.number == 4953/u);
assert.match(workflow, /github\.event\.issue\.state == 'open'/u);
assert.match(workflow, /github\.event\.comment\.user\.id == 271942579/u);
assert.match(workflow, /\["OWNER","MEMBER","COLLABORATOR"\]/u);
assert.match(workflow, /startsWith\(github\.event\.comment\.body, 'RUN_PRODUCTION_RUNTIME_PARITY expected_sha='\)/u);
assert.match(workflow, /\^RUN_PRODUCTION_RUNTIME_PARITY\[\[:space:\]\]expected_sha=\(\[0-9a-f\]\{40\}\)\[\[:space:\]\]tooling_sha=\(\[0-9a-f\]\{40\}\)\$/u);
assert.match(workflow, /AUTH_URL: https:\/\/auth\.mad4b\.com\/version/u);
assert.doesNotMatch(workflow, /auth_url=|connector_url|dev_url|https:\/\/\$\{|workflow_dispatch/u);
assert.match(workflow, /ref: \$\{\{ steps\.trigger\.outputs\.tooling_sha \}\}/u);
assert.match(workflow, /fetch-depth: 0/u);
assert.match(workflow, /persist-credentials: false/u);
assert.match(workflow, /git\/ref\/heads\/main/u);
assert.match(workflow, /git\/ref\/heads\/Production/u);
assert.match(workflow, /scripts\/test-production-runtime-parity-evidence\.mjs/u);
assert.match(workflow, /scripts\/production-runtime-parity-evidence\.mjs/u);
assert.match(workflow, /--expected-sha "\$\{EXPECTED_SHA\}"/u);
assert.match(workflow, /--expected-branch "\$\{EXPECTED_BRANCH\}"/u);
assert.match(workflow, /--endpoint "auth=\$\{AUTH_URL\}"/u);
assert.match(workflow, /actions\/upload-artifact@v4/u);
assert.match(workflow, /\.identity\.tooling_sha == \$tooling/u);
for (const effect of ["repository_mutation_performed", "provider_dispatch_performed", "credential_access_performed", "sql_execution_performed", "migration_apply_performed", "external_send_performed"]) {
  assert.match(workflow, new RegExp(`\\.side_effects\\.${effect} == false`, "u"));
}
assert.match(workflow, /\.secrets_included == false/u);
assert.doesNotMatch(workflow, /secrets\./u);
assert.doesNotMatch(workflow, /^  (?:push|schedule|pull_request_target|deployment):/mu);

const triggerPattern = /^RUN_PRODUCTION_RUNTIME_PARITY expected_sha=([0-9a-f]{40}) tooling_sha=([0-9a-f]{40})$/u;
const expectedSha = "a".repeat(40);
const toolingSha = "b".repeat(40);
assert.deepEqual(`RUN_PRODUCTION_RUNTIME_PARITY expected_sha=${expectedSha} tooling_sha=${toolingSha}`.match(triggerPattern)?.slice(1), [expectedSha, toolingSha]);
for (const invalid of [
  `RUN_PRODUCTION_RUNTIME_PARITY expected_sha=${expectedSha}`,
  `RUN_PRODUCTION_RUNTIME_PARITY expected_sha=${expectedSha} tooling_sha=${toolingSha} extra=true`,
  `RUN_PRODUCTION_RUNTIME_PARITY expected_sha=${expectedSha.toUpperCase()} tooling_sha=${toolingSha}`,
  `RUN_PRODUCTION_RUNTIME_PARITY expected_sha=${expectedSha} tooling_sha=${toolingSha.slice(1)}`,
  `RUN_PRODUCTION_RUNTIME_PARITY auth_url=https://example.com expected_sha=${expectedSha} tooling_sha=${toolingSha}`
]) assert.equal(triggerPattern.test(invalid), false, invalid);

console.log(JSON.stringify({ok:true,tests:2,gate:"production_runtime_parity_comment_bridge",provider_method:"public_https_get",provider_mutation:false,secrets_included:false}));
