import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const bridge = readFileSync(
  new URL("../../.github/workflows/hostinger-nodejs-build-evidence-dispatch-r2.yml", import.meta.url),
  "utf8",
);
const contractWorkflow = readFileSync(
  new URL("../../.github/workflows/hostinger-nodejs-build-evidence-dispatch-r2-contract.yml", import.meta.url),
  "utf8",
);
const target = readFileSync(
  new URL("../../.github/workflows/hostinger-nodejs-build-evidence.yml", import.meta.url),
  "utf8",
);

for (const marker of [
  "issue_comment:",
  "github.event.issue.pull_request == null",
  "github.event.issue.number == 4953",
  "RUN_HOSTINGER_NODEJS_BUILD_EVIDENCE_F5C1AE88_09578A2C_R2 expected_head_sha=",
  "AUTHORIZATION_COMMENT_ID: '5162066131'",
  "AUTHORIZATION_USER_ID: '271942579'",
  "AUTHORIZE_HOSTINGER_NODEJS_BUILD_EVIDENCE_F5C1AE88_09578A2C_R2",
  "09578a2c9adcd0d1254b345248c33d2ba214d41f",
  "u338416126",
  "auth.mad4b.com",
  "f5c1ae8840b4d4452f2908bb0f23051880bb6896",
  "2026-08-03T00:53:07Z",
  "MUTATION_TARGET_BRANCH: issue-and-actions-metadata-only",
  '"main" || "${MUTATION_TARGET_BRANCH}" == "Production"',
  "CURRENT_HEAD_SHA=",
  'test "${CURRENT_HEAD_SHA}" = "${EXPECTED_HEAD_SHA}"',
  "WORKFLOW_BLOB=",
  'test "${WORKFLOW_BLOB}" = "${EXPECTED_WORKFLOW_BLOB_SHA}"',
  "PRODUCTION_SHA=",
  'test "${PRODUCTION_SHA}" = "${EXPECTED_PRODUCTION_SHA}"',
  "HOSTINGER_NODEJS_BUILD_EVIDENCE_R2_DISPATCH status=claiming",
  "HOSTINGER_NODEJS_BUILD_EVIDENCE_R2_DISPATCH status=dispatched",
  "/actions/workflows/${TARGET_WORKFLOW}/dispatches",
  "account_username:$account",
  "expected_sha:$expected",
  "production_merged_at:$merged",
  "provider_get_only=true",
  "provider_mutation=false",
  "deployment=false",
  "restart=false",
  "secrets_included=false",
  "issue_remains_open=true",
]) {
  assert(bridge.includes(marker), `R2 dispatch bridge missing ${marker}`);
}

assert.doesNotMatch(bridge, /pull_request(?:_target)?:/);
assert.doesNotMatch(bridge, /secrets\./);
assert.doesNotMatch(bridge, /developers\.hostinger\.com/);
assert.doesNotMatch(bridge, /\/nodejs\/builds/);
assert.doesNotMatch(bridge, /contents:\s*write/);
assert.doesNotMatch(bridge, /write-all/);
assert.doesNotMatch(bridge, /\bgit\s+push\b/);
assert.doesNotMatch(bridge, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b\s+/i);
assert.doesNotMatch(bridge, /--apply/);
assert.doesNotMatch(bridge, /\b(redeploy|restart application|create build)\b/i);

for (const marker of [
  "pull_request:",
  "branches: [main]",
  "permissions:\n  contents: read",
  "persist-credentials: false",
  "test-hostinger-nodejs-build-evidence-dispatch-r2.mjs",
]) {
  assert(contractWorkflow.includes(marker), `R2 contract workflow missing ${marker}`);
}
assert.doesNotMatch(contractWorkflow, /workflow_dispatch:/);
assert.doesNotMatch(contractWorkflow, /issue_comment:/);
assert.doesNotMatch(contractWorkflow, /(?:^|\n)\s*[A-Za-z][A-Za-z-]*:\s*write\b/m);
assert.doesNotMatch(contractWorkflow, /\bgh\s+api\b/);

for (const marker of [
  "workflow_dispatch:",
  "Enforce trusted workflow dispatch ref",
  "refs/heads/main",
  "secrets.HOSTINGER_API_TOKEN",
  "HOSTINGER_ACCOUNT_USERNAME",
  "HOSTINGER_NODEJS_DOMAIN",
  "EXPECTED_PRODUCTION_SHA",
  "PRODUCTION_MERGED_AT",
  "provider_dispatch_performed === false",
  "provider_mutation_performed === false",
  "restart_performed === false",
  "external_send_performed === false",
]) {
  assert(target.includes(marker), `target evidence workflow missing ${marker}`);
}

assert.match(target, /permissions:\n\s+contents: read/);
assert.doesNotMatch(target, /contents:\s*write/);
assert.doesNotMatch(target, /issues:\s*write/);
assert.doesNotMatch(target, /actions:\s*write/);
assert.doesNotMatch(target, /pull_request_target:/);
assert.doesNotMatch(target, /\bgit\s+push\b/);
assert.doesNotMatch(target, /--apply/);

console.log("PASS Hostinger Node.js build evidence R2 dispatch contract");
