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
const triggerBranch = "gpt/trigger-hostinger-production-release-evidence-r6-20260803";

assert.match(workflow, /name: Hostinger Production Release Evidence R6/);
assert.match(workflow, /pull_request:\n\s+branches: \[main\]/);
assert.doesNotMatch(workflow, /issue_comment:/);
assert.doesNotMatch(workflow, /workflow_dispatch:/);
assert.match(workflow, new RegExp(triggerPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(workflow, new RegExp(triggerBranch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.match(workflow, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
assert.match(workflow, /github\.event\.pull_request\.user\.id == 271942579/);
assert.match(workflow, /github\.event\.pull_request\.draft == true/);
assert.match(workflow, /mapfile -t CHANGED_FILES/);
assert.match(workflow, /test "\$\{#CHANGED_FILES\[@\]\}" -eq 1/);
assert.match(workflow, /test "\$\{CHANGED_FILES\[0\]\}" = "\$\{TRIGGER_PATH\}"/);
assert.match(workflow, /mad4b\.hostinger-production-release-evidence-r6-trigger\.v1/);
assert.match(workflow, /expected_tooling_sha == \$base/);
assert.match(workflow, new RegExp(`EXPECTED_PRODUCTION_SHA: ${expectedProduction}`));
assert.match(workflow, new RegExp(`PRODUCTION_MERGED_AT: '${expectedMergeTime}'`));
assert.match(workflow, new RegExp(authorizationToken));
assert.match(workflow, new RegExp(reporterBlob));
assert.match(workflow, new RegExp(reporterTestBlob));
assert.match(workflow, /trigger mode: `internal_draft_pull_request`/);
assert.match(workflow, /provider method: `GET` only/);
assert.match(workflow, /HOSTINGER_API_TOKEN: \$\{\{ secrets\.HOSTINGER_API_TOKEN \}\}/);
assert.match(workflow, /node scripts\/test-hostinger-nodejs-build-evidence\.mjs/);
assert.match(workflow, /node scripts\/hostinger-nodejs-build-evidence\.mjs/);
assert.match(workflow, /https:\/\/auth\.mad4b\.com\/health/);
assert.match(workflow, /https:\/\/auth\.mad4b\.com\/version/);
assert.match(workflow, /https:\/\/auth\.mad4b\.com\/deployment-info/);
assert.match(workflow, /https:\/\/auth\.mad4b\.com\/connector-agent\/version/);
assert.match(workflow, /HOSTINGER_PRODUCTION_RELEASE_EVIDENCE_R6 status=claiming/);
assert.match(workflow, /HOSTINGER_PRODUCTION_RELEASE_EVIDENCE_R6 status=completed/);
assert.match(workflow, /test -z "\$\{EXISTING\}"/);
assert.match(workflow, /persist-credentials: false/);
for (const marker of [
  "provider_mutation=false",
  "build_creation=false",
  "deployment=false",
  "release_activation=false",
  "restart=false",
  "sql=false",
  "migration_apply=false",
  "database_mutation=false",
  "external_send=false",
  "token_returned=false",
  "secrets_included=false",
]) assert.match(workflow, new RegExp(marker));

assert.doesNotMatch(workflow, /permissions:\n(?:.|\n)*?contents:\s+write/);
assert.doesNotMatch(workflow, /actions:\s+write/);
assert.doesNotMatch(workflow, /pull-requests:\s+write/);
assert.doesNotMatch(workflow, /\bssh\b|force-push|git push|migration.*--apply|mysql\s|mariadb\s/i);

const providerMutationPatterns = [
  /developers\.hostinger\.com[\s\S]{0,300}method:\s*["']?(POST|PUT|PATCH|DELETE)/i,
  /\/nodejs\/builds[\s\S]{0,200}--request\s+(POST|PUT|PATCH|DELETE)/i,
  /\/nodejs\/builds[\s\S]{0,200}-X\s*(POST|PUT|PATCH|DELETE)/i,
];
for (const pattern of providerMutationPatterns) assert.doesNotMatch(workflow, pattern);

const issuePostCount = (workflow.match(/gh api --method POST/g) || []).length;
assert.equal(issuePostCount, 2, "R6 may write only one claim and one bounded completion comment");
const issueCommentEndpointCount = (workflow.match(/\/issues\/\$\{CONTROL_ISSUE\}\/comments/g) || []).length;
assert.equal(issueCommentEndpointCount, 3, "R6 duplicate guard plus two bounded issue writes must remain explicit");

console.log("Hostinger Production release evidence R6 contract passed.");
