import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const bridge = readFileSync(
  new URL("../../.github/workflows/hostinger-nodejs-build-evidence-dispatch-bridge.yml", import.meta.url),
  "utf8",
);
const contractWorkflow = readFileSync(
  new URL("../../.github/workflows/hostinger-nodejs-build-evidence-dispatch-bridge-contract.yml", import.meta.url),
  "utf8",
);
const target = readFileSync(
  new URL("../../.github/workflows/hostinger-nodejs-build-evidence.yml", import.meta.url),
  "utf8",
);

function readBridgeEnv(name) {
  const match = bridge.match(new RegExp(`^\\s+${name}:\\s*(?:'([^']*)'|([^\\s#]+))\\s*$`, "m"));
  assert.ok(match, `dispatch bridge missing environment binding ${name}`);
  return match[1] ?? match[2];
}

const authorizationCommentId = readBridgeEnv("AUTHORIZATION_COMMENT_ID");
const authorizationToken = readBridgeEnv("AUTHORIZATION_TOKEN");
const triggerToken = readBridgeEnv("TRIGGER_TOKEN");
const workflowBlobSha = readBridgeEnv("EXPECTED_WORKFLOW_BLOB_SHA");
const expectedProductionSha = readBridgeEnv("EXPECTED_PRODUCTION_SHA");
const bindingId = readBridgeEnv("BINDING_ID");

assert.match(authorizationCommentId, /^[1-9][0-9]*$/);
assert.match(
  authorizationToken,
  /^AUTHORIZE_HOSTINGER_NODEJS_BUILD_EVIDENCE_F5C1AE88_09578A2C(?:_R[1-9][0-9]*)?$/,
);
assert.equal(
  triggerToken,
  authorizationToken.replace(/^AUTHORIZE_/, "RUN_"),
  "trigger and authorization tokens must use the same one-time generation",
);
assert.match(workflowBlobSha, /^[a-f0-9]{40}$/);
assert.match(expectedProductionSha, /^[a-f0-9]{40}$/);
assert.equal(
  bindingId,
  `${expectedProductionSha}:${workflowBlobSha}:${authorizationCommentId}`,
  "binding ID must be anchored to Production SHA, target workflow blob, and authorization comment",
);

for (const marker of [
  "workflow_dispatch:",
  "expected_head_sha:",
  "issue_comment:",
  "github.event.issue.pull_request == null",
  "github.event.issue.number == 4953",
  "startsWith(github.event.comment.body, 'RUN_HOSTINGER_NODEJS_BUILD_EVIDENCE_F5C1AE88_09578A2C",
  "expected_head_sha=",
  "AUTHORIZATION_COMMENT_ID:",
  "AUTHORIZATION_USER_ID: '271942579'",
  "AUTHORIZATION_TOKEN:",
  "TRIGGER_TOKEN:",
  "BINDING_ID:",
  "hostinger-nodejs-build-evidence.yml",
  "09578a2c9adcd0d1254b345248c33d2ba214d41f",
  "u338416126",
  "auth.mad4b.com",
  "f5c1ae8840b4d4452f2908bb0f23051880bb6896",
  "2026-08-03T00:53:07Z",
  "MUTATION_TARGET_BRANCH: issue-and-actions-metadata-only",
  '"main" || "${MUTATION_TARGET_BRANCH}" == "Production"',
  "CURRENT_HEAD_SHA=",
  'test "${CURRENT_HEAD_SHA}" = "${EXPECTED_HEAD_SHA}"',
  'grep -Fq "${AUTHORIZATION_TOKEN}"',
  "/actions/workflows/${TARGET_WORKFLOW}/dispatches",
  "account_username:$account",
  "expected_sha:$expected",
  "production_merged_at:$merged",
  "HOSTINGER_NODEJS_BUILD_EVIDENCE_DISPATCH status=claiming",
  "HOSTINGER_NODEJS_BUILD_EVIDENCE_DISPATCH status=dispatched",
  "HOSTINGER_NODEJS_BUILD_EVIDENCE_DISPATCH status=completed",
  "hostinger-nodejs-build-evidence-${TARGET_RUN_ID}",
  "mad4b.hostinger-nodejs-build-evidence.v1",
  "const reportMergedAtMs = Date.parse(report.identity?.production_merged_at ?? '');",
  "const expectedMergedAtMs = Date.parse(mergedAt);",
  "Number.isFinite(reportMergedAtMs)",
  "Number.isFinite(expectedMergedAtMs)",
  "reportMergedAtMs === expectedMergedAtMs",
  "report.request?.method === 'GET'",
  "report.request?.token_returned === false",
  "effects.provider_dispatch_performed === false",
  "effects.provider_mutation_performed === false",
  "effects.restart_performed === false",
  "effects.sql_execution_performed === false",
  "effects.migration_apply_performed === false",
  "effects.database_mutation_performed === false",
  "effects.external_send_performed === false",
  "issue_remains_open=true",
]) {
  assert(bridge.includes(marker), `dispatch bridge missing ${marker}`);
}

assert.doesNotMatch(bridge, /report\.identity\?\.production_merged_at === mergedAt/);
assert.doesNotMatch(bridge, /pull_request(?:_target)?:/);
assert.doesNotMatch(bridge, /secrets\./);
assert.doesNotMatch(bridge, /HOSTINGER_API_TOKEN/);
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
  "test-hostinger-nodejs-build-evidence-dispatch-bridge.mjs",
]) {
  assert(contractWorkflow.includes(marker), `contract workflow missing ${marker}`);
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
  "hostinger-nodejs-build-evidence-${{ github.run_id }}",
  "provider_dispatch_performed === false",
  "provider_mutation_performed === false",
  "restart_performed === false",
  "external_send_performed === false",
]) {
  assert(target.includes(marker), `target workflow missing ${marker}`);
}

assert.match(target, /permissions:\n\s+contents: read/);
assert.doesNotMatch(target, /contents:\s*write/);
assert.doesNotMatch(target, /issues:\s*write/);
assert.doesNotMatch(target, /actions:\s*write/);
assert.doesNotMatch(target, /pull_request_target:/);
assert.doesNotMatch(target, /\bgit\s+push\b/);
assert.doesNotMatch(target, /--apply/);

console.log("PASS Hostinger Node.js build evidence dispatch bridge contract");
