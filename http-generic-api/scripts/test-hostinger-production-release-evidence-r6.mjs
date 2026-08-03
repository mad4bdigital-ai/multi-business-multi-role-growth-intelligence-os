#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(
  new URL("../../.github/workflows/hostinger-production-release-evidence-r6.yml", import.meta.url),
  "utf8",
);

const expectedProduction = "2669991a882c7f7939510fbbace17f462a42517c";
const expectedMergeTime = "2026-08-03T10:14:37Z";
const reporterBlob = "6134c0f8a454a5f8f1533f3f2a29ed6af77aa020";
const reporterTestBlob = "6e37c838129d38d6aee0ffe77d522dcf1d00d0cc";
const authorizationToken = "AUTHORIZE_HOSTINGER_PRODUCTION_RELEASE_EVIDENCE_2669991A_6134C0F8_R6";
const triggerPath = ".github/ops/hostinger-production-release-evidence-r6-trigger.json";

assert.match(workflow, /name: Hostinger Production Release Evidence R6/);
assert.match(workflow, /pull_request:\n\s+branches: \[main\]\n\s+types: \[opened, reopened, synchronize\]/);
assert.doesNotMatch(workflow, /\n\s+paths:/);
assert.doesNotMatch(workflow, /issue_comment:/);
assert.doesNotMatch(workflow, /workflow_dispatch:/);
assert.match(
  workflow,
  /concurrency:\n\s+group: hostinger-production-release-evidence-r6-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n\s+cancel-in-progress: true/,
);
assert.doesNotMatch(workflow, /cancel-in-progress: false/);
assert.match(workflow, new RegExp(triggerPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.doesNotMatch(workflow, /(?:^|[^A-Za-z0-9_.-])gpt\//m);

const classifierStart = workflow.indexOf("  classify-trigger-scope:");
const collectorStart = workflow.indexOf("  collect-release-evidence:");
assert.ok(classifierStart >= 0, "R6 must classify trigger scope before evidence collection");
assert.ok(collectorStart > classifierStart, "R6 classifier must precede the provider-capable collector");
const classifier = workflow.slice(classifierStart, collectorStart);
const collector = workflow.slice(collectorStart);

assert.match(classifier, /name: Classify exact R6 trigger scope/);
assert.match(classifier, /permissions:\n\s+contents: read\n\s+pull-requests: read/);
assert.match(classifier, /outputs:\n\s+eligible: \$\{\{ steps\.scope\.outputs\.eligible \}\}/);
assert.match(classifier, /HEAD_REPOSITORY: \$\{\{ github\.event\.pull_request\.head\.repo\.full_name \}\}/);
assert.match(classifier, /PR_AUTHOR_ID: \$\{\{ github\.event\.pull_request\.user\.id \}\}/);
assert.match(classifier, /PR_DRAFT: \$\{\{ github\.event\.pull_request\.draft \}\}/);
assert.match(classifier, /mapfile -t changed_files/);
assert.match(classifier, /"\$\{#changed_files\[@\]\}" -eq 1/);
assert.match(classifier, /"\$\{changed_files\[0\]\}" == "\$\{TRIGGER_PATH\}"/);
assert.match(classifier, /echo "eligible=true" >> "\$\{GITHUB_OUTPUT\}"/);
assert.match(classifier, /echo "eligible=false" >> "\$\{GITHUB_OUTPUT\}"/);
assert.match(classifier, /R6 evidence collection skipped: pull request is not the exact one-file trigger/);
assert.doesNotMatch(classifier, /actions\/checkout|HOSTINGER_API_TOKEN|auth\.mad4b\.com|hostinger-nodejs-build-evidence|upload-artifact|GITHUB_STEP_SUMMARY/);
assert.doesNotMatch(classifier, /(?:--method|-X)\s*(?:POST|PUT|PATCH|DELETE)/i);

assert.match(collector, /needs: classify-trigger-scope/);
assert.match(collector, /if: needs\.classify-trigger-scope\.outputs\.eligible == 'true'/);
assert.match(collector, /Checkout exact trusted main tooling/);
assert.ok(
  collector.indexOf("Checkout exact trusted main tooling") < collector.indexOf("HOSTINGER_API_TOKEN"),
  "provider secret must remain after exact-scope eligibility and trusted checkout",
);

assert.match(workflow, /HEAD_REF: \$\{\{ github\.event\.pull_request\.head\.ref \}\}/);
assert.match(workflow, /mapfile -t CHANGED_FILES/);
assert.match(workflow, /test "\$\{#CHANGED_FILES\[@\]\}" -eq 1/);
assert.match(workflow, /test "\$\{CHANGED_FILES\[0\]\}" = "\$\{TRIGGER_PATH\}"/);
assert.match(workflow, /mad4b\.hostinger-production-release-evidence-r6-trigger\.v2/);
assert.match(workflow, /expected_trigger_branch == \$head_ref/);
assert.match(workflow, /expected_tooling_sha == \$base/);
assert.match(workflow, new RegExp(`EXPECTED_PRODUCTION_SHA: ${expectedProduction}`));
assert.match(workflow, new RegExp(`PRODUCTION_MERGED_AT: '${expectedMergeTime}'`));
assert.match(workflow, new RegExp(authorizationToken));
assert.match(workflow, new RegExp(reporterBlob));
assert.match(workflow, new RegExp(reporterTestBlob));
assert.match(workflow, /trigger mode: `internal_draft_pull_request_read_only`/);
assert.match(workflow, /provider method: `GET` only/);
assert.match(workflow, /HOSTINGER_API_TOKEN: \$\{\{ secrets\.HOSTINGER_API_TOKEN \}\}/);
assert.match(workflow, /node scripts\/test-hostinger-nodejs-build-evidence\.mjs/);
assert.match(workflow, /node scripts\/hostinger-nodejs-build-evidence\.mjs/);
assert.match(workflow, /https:\/\/auth\.mad4b\.com\/health/);
assert.match(workflow, /https:\/\/auth\.mad4b\.com\/version/);
assert.match(workflow, /https:\/\/auth\.mad4b\.com\/deployment-info/);
assert.match(workflow, /https:\/\/auth\.mad4b\.com\/connector-agent\/version/);
assert.match(workflow, /test -z "\$\{EXISTING\}"/);
assert.match(workflow, /persist-credentials: false/);
assert.match(workflow, /actions\/upload-artifact@v4/);
assert.match(workflow, /GITHUB_STEP_SUMMARY/);
assert.match(workflow, /repository_read_only:true/);

assert.match(workflow, /- name: Initialize runtime evidence directory/);
assert.match(
  workflow,
  /echo "EVIDENCE_DIR=\$\{RUNNER_TEMP\}\/hostinger-production-release-evidence-r6" >> "\$\{GITHUB_ENV\}"/,
);
assert.match(workflow, /mkdir -p "\$\{RUNNER_TEMP\}\/hostinger-production-release-evidence-r6"/);
assert.doesNotMatch(
  workflow,
  /^\s{6}EVIDENCE_DIR:\s*\$\{\{\s*runner\./m,
  "R6 job-level env must not reference runner context before runner allocation",
);
assert.match(
  workflow,
  /HOSTINGER_NODEJS_BUILD_EVIDENCE_DIR: \$\{\{ runner\.temp \}\}\/hostinger-production-release-evidence-r6\/build/,
);
assert.doesNotMatch(workflow, /HOSTINGER_NODEJS_BUILD_EVIDENCE_DIR: \$\{\{ env\.EVIDENCE_DIR \}\}/);
assert.match(
  workflow,
  /path: \$\{\{ runner\.temp \}\}\/hostinger-production-release-evidence-r6\/\*\*/,
);

assert.match(workflow, /mad4b\.hostinger-production-release-evidence-r6-context\.v1/);
assert.match(workflow, /execution-context\.json/);
assert.match(workflow, /trigger_nonce:\$trigger_nonce/);
assert.match(workflow, /trigger_branch:\$trigger_branch/);
assert.match(workflow, /source_run_id:\$source_run_id/);
assert.match(workflow, /trigger_pr:\$trigger_pr/);
assert.match(workflow, /deployed_at:deployedAt\|\|null/);
assert.match(workflow, /runtime_sha_current_branch_provenance_mismatch/);
assert.match(workflow, /created_at:build\.latest_build_after_merge\?\.created_at\|\|null/);
assert.match(workflow, /updated_at:build\.latest_build_after_merge\?\.updated_at\|\|null/);
assert.match(workflow, /classification:"build_evidence_missing"/);
assert.match(workflow, /classification:"topology_evidence_missing"/);
assert.match(workflow, /request:\{method:"GET",token_returned:false\}/);
assert.match(workflow, /echo "- deployed_at: \$\{DEPLOYED_AT\}"/);

assert.match(workflow, /\.key == "secrets_included"/);
assert.match(workflow, /\(\.value \| type\) == "boolean"/);
assert.match(workflow, /manifest_secret_free:deployment\?\.evidence\?\.secrets_included===false/);
assert.match(
  workflow,
  /authorization\|cookie\|password\|secret\|token\|api\[_-\]\?key\|private\[_-\]\?key\|credential/,
);
assert.match(workflow, /\.value = "\[REDACTED\]"/);

for (const marker of [
  "repository_write_performed:false",
  "provider_mutation_performed:false",
  "build_creation_performed:false",
  "deployment_performed:false",
  "release_activation_performed:false",
  "restart_performed:false",
  "sql_execution_performed:false",
  "migration_apply_performed:false",
  "database_mutation_performed:false",
  "external_send_performed:false",
  "secrets_included:false",
]) assert.match(workflow, new RegExp(marker));

assert.doesNotMatch(workflow, /permissions:\n(?:.|\n)*?contents:\s+write/);
assert.doesNotMatch(workflow, /(?:^|\n)\s*[A-Za-z][A-Za-z-]*:\s+write\b/);
assert.doesNotMatch(workflow, /gh api --method\s+(?:POST|PUT|PATCH|DELETE)/i);
assert.doesNotMatch(workflow, /\bgh\s+(?:pr\s+merge|workflow\s+run|release\s+create)\b/i);
assert.doesNotMatch(workflow, /\bssh\b|force-push|git push|migration.*--apply|mysql\s|mariadb\s/i);

const providerMutationPatterns = [
  /developers\.hostinger\.com[\s\S]{0,300}method:\s*["']?(POST|PUT|PATCH|DELETE)/i,
  /\/nodejs\/builds[\s\S]{0,200}--request\s+(POST|PUT|PATCH|DELETE)/i,
  /\/nodejs\/builds[\s\S]{0,200}-X\s*(POST|PUT|PATCH|DELETE)/i,
];
for (const pattern of providerMutationPatterns) assert.doesNotMatch(workflow, pattern);

const issueWriteCount = (workflow.match(/gh api --method\s+(?:POST|PUT|PATCH|DELETE)/gi) || []).length;
assert.equal(issueWriteCount, 0, "R6 pull-request workflow must remain repository read-only");
const authorizationReadCount = (workflow.match(/\/issues\/comments\/\$\{AUTHORIZATION_COMMENT_ID\}/g) || []).length;
assert.equal(authorizationReadCount, 1, "R6 must read the immutable authorization comment exactly once");
const issueCommentReadCount = (workflow.match(/\/issues\/\$\{CONTROL_ISSUE\}\/comments\?per_page=100/g) || []).length;
assert.equal(issueCommentReadCount, 1, "R6 may read the control issue once for duplicate-terminal protection");

console.log("Hostinger Production release evidence R6 scoped read-only contract passed.");
