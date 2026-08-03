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
assert.match(workflow, new RegExp(triggerPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.doesNotMatch(workflow, /(?:^|[^A-Za-z0-9_.-])gpt\//m);
assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
assert.match(workflow, /github\.event\.pull_request\.user\.id == 271942579/);
assert.match(workflow, /github\.event\.pull_request\.draft == true/);
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

const jobEnv = workflow.match(/    env:\n(?<env>[\s\S]*?)\n\n    steps:/)?.groups?.env ?? "";
assert.ok(jobEnv, "R6 job-level env block must be present");
assert.doesNotMatch(
  jobEnv,
  /\$\{\{\s*runner\./,
  "runner context is unavailable in job-level env and prevents workflow registration",
);
assert.match(workflow, /EVIDENCE_DIR: \/tmp\/hostinger-production-release-evidence-r6/);

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
const issueCommentReadCount = (workflow.match(/\/issues\/\$\{CONTROL_ISSUE\}\/comments\?per_page=100/g) || []).length;
assert.equal(issueCommentReadCount, 1, "R6 may read the control issue once for duplicate-terminal protection");

console.log("Hostinger Production release evidence R6 read-only contract passed.");
