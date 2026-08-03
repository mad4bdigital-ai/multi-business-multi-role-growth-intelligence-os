#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(
  new URL("../../.github/workflows/hostinger-production-release-evidence-r5.yml", import.meta.url),
  "utf8",
);

const expectedProduction = "2669991a882c7f7939510fbbace17f462a42517c";
const expectedMergeTime = "2026-08-03T10:14:37Z";
const reporterBlob = "6134c0f8a454a5f8f1533f3f2a29ed6af77aa020";
const reporterTestBlob = "6e37c838129d38d6aee0ffe77d522dcf1d00d0cc";
const authorizationCommentId = "5165194648";
const authorizationToken = "AUTHORIZE_HOSTINGER_PRODUCTION_RELEASE_EVIDENCE_2669991A_6134C0F8_R5";
const triggerToken = "RUN_HOSTINGER_PRODUCTION_RELEASE_EVIDENCE_2669991A_6134C0F8_R5";

assert.match(workflow, /name: Hostinger Production Release Evidence R5/);
assert.match(workflow, /issue_comment:\n\s+types: \[created\]/);
assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, new RegExp(`EXPECTED_PRODUCTION_SHA: ${expectedProduction}`));
assert.match(workflow, new RegExp(`PRODUCTION_MERGED_AT: '${expectedMergeTime}'`));
assert.match(workflow, new RegExp(`AUTHORIZATION_COMMENT_ID: '${authorizationCommentId}'`));
assert.match(workflow, new RegExp(authorizationToken));
assert.match(workflow, new RegExp(triggerToken));
assert.match(workflow, new RegExp(reporterBlob));
assert.match(workflow, new RegExp(reporterTestBlob));
assert.match(workflow, /HOSTINGER_API_TOKEN: \$\{\{ secrets\.HOSTINGER_API_TOKEN \}\}/);
assert.match(workflow, /node scripts\/test-hostinger-nodejs-build-evidence\.mjs/);
assert.match(workflow, /node scripts\/hostinger-nodejs-build-evidence\.mjs/);
assert.match(workflow, /https:\/\/auth\.mad4b\.com\/health/);
assert.match(workflow, /https:\/\/auth\.mad4b\.com\/version/);
assert.match(workflow, /https:\/\/auth\.mad4b\.com\/deployment-info/);
assert.match(workflow, /https:\/\/auth\.mad4b\.com\/connector-agent\/version/);
assert.match(workflow, /provider method: `GET` only/);
assert.match(workflow, /HOSTINGER_PRODUCTION_RELEASE_EVIDENCE_R5 status=claiming/);
assert.match(workflow, /HOSTINGER_PRODUCTION_RELEASE_EVIDENCE_R5 status=completed/);
assert.match(workflow, /test -z "\$\{EXISTING\}"/);
assert.match(workflow, /persist-credentials: false/);
assert.match(workflow, /provider_mutation=false/);
assert.match(workflow, /build_creation=false/);
assert.match(workflow, /deployment=false/);
assert.match(workflow, /release_activation=false/);
assert.match(workflow, /restart=false/);
assert.match(workflow, /sql=false/);
assert.match(workflow, /migration_apply=false/);
assert.match(workflow, /database_mutation=false/);
assert.match(workflow, /external_send=false/);
assert.match(workflow, /token_returned=false/);
assert.match(workflow, /secrets_included=false/);
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
assert.equal(issuePostCount, 2, "R5 may write only the claim and bounded completion comments");
const issueCommentEndpointCount = (workflow.match(/\/issues\/\$\{CONTROL_ISSUE\}\/comments/g) || []).length;
assert.equal(issueCommentEndpointCount, 3, "duplicate guard plus two bounded issue writes must remain explicit");

console.log("Hostinger Production release evidence R5 contract passed.");
