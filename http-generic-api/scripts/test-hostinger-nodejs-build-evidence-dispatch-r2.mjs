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
  new URL("../../.github/workflows/hostinger-nodejs-completed-build-log-evidence.yml", import.meta.url),
  "utf8",
);

for (const marker of [
  "Hostinger Completed Build Log Evidence Dispatch R3B",
  "workflow_dispatch:",
  "expected_head_sha:",
  "github.event_name == 'workflow_dispatch' && github.actor == github.repository_owner",
  "issue_comment:",
  "github.event.issue.pull_request == null",
  "github.event.issue.number == 4953",
  "RUN_HOSTINGER_COMPLETED_BUILD_LOG_EVIDENCE_R3B_F5C1AE88_94321B27 expected_head_sha=",
  "INPUT_EXPECTED_HEAD_SHA: ${{ inputs.expected_head_sha || '' }}",
  "AUTHORIZATION_COMMENT_ID: '5162389651'",
  "AUTHORIZATION_USER_ID: '271942579'",
  "AUTHORIZE_HOSTINGER_COMPLETED_BUILD_LOG_EVIDENCE_BRIDGE_R3B_F5C1AE88_94321B27",
  "hostinger-nodejs-completed-build-log-evidence.yml",
  ".github/workflows/hostinger-nodejs-completed-build-log-evidence.yml",
  "94321b273e70f96180c0f058adbb291b035fd237",
  "u338416126",
  "auth.mad4b.com",
  "019fc51c-3947-7255-aa4d-f55cb8df7658",
  "f5c1ae8840b4d4452f2908bb0f23051880bb6896",
  "MUTATION_TARGET_BRANCH: issue-and-actions-metadata-only",
  '"main" || "${MUTATION_TARGET_BRANCH}" == "Production"',
  'if [[ "${GITHUB_EVENT_NAME}" == "issue_comment" ]]',
  'EXPECTED_HEAD_SHA="${INPUT_EXPECTED_HEAD_SHA}"',
  '[[ "${EXPECTED_HEAD_SHA}" =~ ^[a-f0-9]{40}$ ]]',
  "CURRENT_HEAD_SHA=",
  'test "${CURRENT_HEAD_SHA}" = "${EXPECTED_HEAD_SHA}"',
  "WORKFLOW_BLOB=",
  'test "${WORKFLOW_BLOB}" = "${EXPECTED_WORKFLOW_BLOB_SHA}"',
  "PRODUCTION_SHA=",
  'test "${PRODUCTION_SHA}" = "${EXPECTED_PRODUCTION_SHA}"',
  "HOSTINGER_COMPLETED_BUILD_LOG_EVIDENCE_R3B_DISPATCH status=claiming",
  "HOSTINGER_COMPLETED_BUILD_LOG_EVIDENCE_R3B_DISPATCH status=dispatched",
  "/actions/workflows/${TARGET_WORKFLOW}/dispatches",
  "account_username:$account",
  "build_uuid:$build",
  "expected_sha:$expected",
  "provider_get_only=true",
  "provider_mutation=false",
  "build_creation=false",
  "deployment=false",
  "release_activation=false",
  "restart=false",
  "secrets_included=false",
  "issue_remains_open=true",
]) {
  assert(bridge.includes(marker), `R3B dispatch bridge missing ${marker}`);
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
  assert(contractWorkflow.includes(marker), `R3B contract workflow missing ${marker}`);
}
assert.doesNotMatch(contractWorkflow, /workflow_dispatch:/);
assert.doesNotMatch(contractWorkflow, /issue_comment:/);
assert.doesNotMatch(contractWorkflow, /(?:^|\n)\s*[A-Za-z][A-Za-z-]*:\s*write\b/m);
assert.doesNotMatch(contractWorkflow, /\bgh\s+api\b/);

for (const marker of [
  "Hostinger Node.js Completed Build Log Evidence",
  "workflow_dispatch:",
  "account_username:",
  "build_uuid:",
  "expected_sha:",
  "Live Completed Build Log Evidence",
  "github.event_name == 'workflow_dispatch'",
  "ref: main",
  "secrets.HOSTINGER_API_TOKEN",
  "HOSTINGER_ACCOUNT_USERNAME",
  "HOSTINGER_NODEJS_BUILD_UUID",
  "EXPECTED_PRODUCTION_SHA",
  "--domain auth.mad4b.com",
  "report.request?.method === \"GET\"",
  "effects.provider_dispatch_performed === false",
  "effects.provider_mutation_performed === false",
  "effects.restart_performed === false",
  "effects.external_send_performed === false",
]) {
  assert(target.includes(marker), `target completed-build log workflow missing ${marker}`);
}

assert.match(target, /permissions:\n\s+contents: read/);
assert.doesNotMatch(target, /contents:\s*write/);
assert.doesNotMatch(target, /issues:\s*write/);
assert.doesNotMatch(target, /actions:\s*write/);
assert.doesNotMatch(target, /pull_request_target:/);
assert.doesNotMatch(target, /\bgit\s+push\b/);
assert.doesNotMatch(target, /--apply/);

console.log("PASS Hostinger completed-build log evidence R3B dispatch contract");
