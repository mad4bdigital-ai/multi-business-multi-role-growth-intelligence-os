import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const publisherWorkflow = read("../../.github/workflows/github-main-review-policy-readiness-publisher.yml");
const readinessPublisher = read("./github-main-review-policy-readiness-issue-publisher.mjs");

assert.match(publisherWorkflow, /^name: GitHub Review Policy Readiness Publisher/m);
assert.match(publisherWorkflow, /workflow_run:/);
assert.match(publisherWorkflow, /github\.event\.workflow_run\.conclusion == 'success'/);
assert.match(publisherWorkflow, /github\.event\.workflow_run\.conclusion != 'success'/);
assert.match(publisherWorkflow, /Publish bounded no-secret readiness failure diagnostic/);
assert.doesNotMatch(publisherWorkflow, /github-main-review-policy-readiness-failure-publisher\.mjs/);
assert.match(publisherWorkflow, /SOURCE_CONCLUSION: \$\{\{ github\.event\.workflow_run\.conclusion \}\}/);
assert.match(publisherWorkflow, /READINESS_FAILURE_PATH:/);
assert.match(publisherWorkflow, /READINESS_STATE_PATH:/);
assert.match(publisherWorkflow, /persist-credentials: false/);

assert.match(readinessPublisher, /EXPECTED_WORKFLOW = "Governed GitHub Review Policy Live Activation"/);
assert.match(readinessPublisher, /DIAGNOSTIC_PREFIX = "GITHUB_REVIEW_POLICY_READINESS_DIAGNOSTIC result=fail"/);
assert.match(readinessPublisher, /readinessMarkerPrefix/);
assert.match(readinessPublisher, /if \(SOURCE_CONCLUSION === "success"\) await publishSuccessMarker\(\);/);
assert.match(readinessPublisher, /else await publishFailureDiagnostic\(\);/);
assert.match(readinessPublisher, /assert\.notEqual\(SOURCE_CONCLUSION, "success"/);
assert.match(readinessPublisher, /assert\.equal\(phase, "readiness"/);
assert.match(readinessPublisher, /assert\.notEqual\(failure\?\.apply_sent, true/);
assert.match(readinessPublisher, /assert\.notEqual\(failure\?\.provider_call_executed, true/);
assert.match(readinessPublisher, /assert\.notEqual\(failure\?\.external_write_executed, true/);
assert.match(readinessPublisher, /marker_grants_apply_authority: false/);
assert.match(readinessPublisher, /response_ledger_found/);
assert.match(readinessPublisher, /response_missing_counts/);
assert.match(readinessPublisher, /secrets_included: false/);
assert.match(readinessPublisher, /This is bounded no-secret failure evidence only\. It is not a readiness success marker and grants no Apply authority\./);

console.log("github review-policy readiness publisher success/failure contract tests passed");
