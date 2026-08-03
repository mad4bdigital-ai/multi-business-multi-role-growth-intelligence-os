#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const workflowPath = new URL("../../.github/workflows/hostinger-completed-build-log-evidence-dispatch-r3.yml", import.meta.url);
const workflow = fs.readFileSync(workflowPath, "utf8");

const required = [
  "workflow_dispatch:",
  "issue_comment:",
  "permissions:\n  contents: read",
  "actions: write",
  "issues: write",
  "AUTHORIZATION_COMMENT_ID: '5162358174'",
  "AUTHORIZATION_USER_ID: '271942579'",
  "AUTHORIZE_HOSTINGER_COMPLETED_BUILD_LOG_EVIDENCE_R3_F5C1AE88_94321B27",
  "RUN_HOSTINGER_COMPLETED_BUILD_LOG_EVIDENCE_R3_F5C1AE88_94321B27",
  "EXPECTED_WORKFLOW_BLOB_SHA: 94321b273e70f96180c0f058adbb291b035fd237",
  "BUILD_UUID: 019fc51c-3947-7255-aa4d-f55cb8df7658",
  "EXPECTED_PRODUCTION_SHA: f5c1ae8840b4d4452f2908bb0f23051880bb6896",
  "TARGET_WORKFLOW: hostinger-nodejs-completed-build-log-evidence.yml",
  "CURRENT_HEAD_SHA",
  "test \"${CURRENT_HEAD_SHA}\" = \"${EXPECTED_HEAD_SHA}\"",
  "WORKFLOW_BLOB",
  "PRODUCTION_SHA",
  "HOSTINGER_COMPLETED_BUILD_LOG_R3_DISPATCH status=claiming",
  "HOSTINGER_COMPLETED_BUILD_LOG_R3_DISPATCH status=dispatched",
  "HOSTINGER_COMPLETED_BUILD_LOG_R3_DISPATCH status=completed",
  "hostinger-nodejs-completed-build-log-evidence-${TARGET_RUN_ID}",
  "mad4b.hostinger-nodejs-completed-build-log-evidence.v1",
  "provider_get_only=true",
  "provider_mutation=false",
  "deployment=false",
  "activation=false",
  "restart=false",
  "secrets_included=false",
];
for (const token of required) assert.ok(workflow.includes(token), `missing ${token}`);

assert.equal(workflow.includes("HOSTINGER_API_TOKEN: ${{"), false, "bridge must remain secret-blind");
assert.equal(workflow.includes("curl "), false, "bridge must not call Hostinger directly");
assert.equal(workflow.includes("--method DELETE"), false);
assert.equal(workflow.includes("--method PATCH"), false);
assert.equal(workflow.includes("--method PUT"), false);
assert.equal(workflow.includes("git push"), false);
assert.equal(workflow.includes("force" + "-push"), false);
assert.equal(workflow.includes("refs/heads/main"), false);
assert.equal(workflow.includes("refs/heads/Production"), false);

const firstWrite = workflow.indexOf("Record one-time R3 dispatch claim");
const headGuard = workflow.indexOf('test "${CURRENT_HEAD_SHA}" = "${EXPECTED_HEAD_SHA}"');
const authGuard = workflow.indexOf('grep -Fq "${AUTHORIZATION_TOKEN}"');
const duplicateGuard = workflow.indexOf("CLAIM_MARKERS");
assert.ok(headGuard > 0 && headGuard < firstWrite, "expected-head guard must precede first write");
assert.ok(authGuard > 0 && authGuard < firstWrite, "authorization guard must precede first write");
assert.ok(duplicateGuard > 0 && duplicateGuard < firstWrite, "one-time binding guard must precede first write");

console.log("Hostinger completed-build log evidence R3 dispatch contract passed.");
