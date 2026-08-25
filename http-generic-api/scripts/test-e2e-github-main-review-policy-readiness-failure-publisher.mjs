import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const publisherWorkflow = read("../../.github/workflows/github-main-review-policy-readiness-publisher.yml");
const failurePublisher = read("../../.github/ops/github-main-review-policy-readiness-failure-publisher.mjs");

assert.match(publisherWorkflow, /^name: GitHub Review Policy Readiness Publisher/m);
assert.match(publisherWorkflow, /workflow_run:/);
assert.match(publisherWorkflow, /github\.event\.workflow_run\.conclusion == 'success'/);
assert.match(publisherWorkflow, /github\.event\.workflow_run\.conclusion != 'success'/);
assert.match(publisherWorkflow, /Publish bounded no-secret readiness failure diagnostic/);
assert.match(publisherWorkflow, /\.github\/ops\/github-main-review-policy-readiness-failure-publisher\.mjs/);
assert.match(publisherWorkflow, /SOURCE_CONCLUSION: \$\{\{ github\.event\.workflow_run\.conclusion \}\}/);
assert.match(publisherWorkflow, /READINESS_FAILURE_PATH:/);
assert.match(publisherWorkflow, /READINESS_STATE_PATH:/);
assert.match(publisherWorkflow, /persist-credentials: false/);

assert.match(failurePublisher, /EXPECTED_WORKFLOW = "Governed GitHub Review Policy Live Activation"/);
assert.match(failurePublisher, /DIAGNOSTIC_PREFIX = "GITHUB_REVIEW_POLICY_READINESS_DIAGNOSTIC result=fail"/);
assert.doesNotMatch(failurePublisher, /GITHUB_MAIN_REVIEW_POLICY_READINESS result=pass/);
assert.match(failurePublisher, /assert\.equal\(phase, "readiness"/);
assert.match(failurePublisher, /assert\.notEqual\(failure\?\.apply_sent, true/);
assert.match(failurePublisher, /assert\.notEqual\(failure\?\.provider_call_executed, true/);
assert.match(failurePublisher, /assert\.notEqual\(failure\?\.external_write_executed, true/);
assert.match(failurePublisher, /marker_grants_apply_authority: false/);
assert.match(failurePublisher, /response_ledger_found/);
assert.match(failurePublisher, /response_missing_counts/);
assert.match(failurePublisher, /secrets_included: false/);
assert.match(failurePublisher, /This is bounded no-secret failure evidence only\. It is not a readiness success marker and grants no Apply authority\./);

console.log("github review-policy readiness failure publisher contract tests passed");
