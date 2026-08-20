import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const migrationWorkflow = read("../.github/workflows/github-repository-policy-1051-governed-rollout.yml");
const liveWorkflow = read("../.github/workflows/github-main-review-policy-live-activation.yml");
const publisherWorkflow = read("../.github/workflows/github-main-review-policy-readiness-publisher.yml");
const migrationRunner = read("../.github/ops/github-repository-policy-1051-governed-rollout.mjs");
const liveRunner = read("../.github/ops/github-main-review-policy-live-activation.mjs");
const publisher = read("./scripts/github-main-review-policy-readiness-issue-publisher.mjs");
const gitBlobSha = (path) => {
  const bytes = fs.readFileSync(new URL(path, import.meta.url));
  return createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest("hex");
};
const migrationBlobSha = gitBlobSha("../http-generic-api/migrations/1051_github_repository_policy_live_apply_authority.sql");
const envelopeCreatorBlobSha = gitBlobSha("../http-generic-api/scripts/capability-resolution-envelope-create.mjs");

assert.match(migrationWorkflow, /^name: Governed Migration 1051 GitHub Repository Policy Authority Rollout/m);
assert.match(migrationWorkflow, /permissions:\n  contents: read/);
assert.doesNotMatch(migrationWorkflow, /issues:\s*write/);
assert.match(migrationWorkflow, /AUTHORIZE_GOVERNED_MIGRATION_1051_GITHUB_REPOSITORY_POLICY_LIVE_APPLY_AUTHORITY/);
assert.match(migrationWorkflow, /APPLY_1051_GITHUB_REPOSITORY_POLICY_LIVE_APPLY_AUTHORITY/);
assert.match(migrationWorkflow, /VERIFY_GOVERNED_MIGRATION_1051_GITHUB_REPOSITORY_POLICY_LIVE_APPLY_AUTHORITY/);
assert.match(migrationWorkflow, /SOURCE_PR: '6631'/);
assert.match(migrationWorkflow, /persist-credentials: false/);

assert.match(liveWorkflow, /^name: Governed GitHub Review Policy Live Activation/m);
assert.match(liveWorkflow, /permissions:\n  contents: read/);
assert.doesNotMatch(liveWorkflow, /issues:\s*write/);
assert.match(liveWorkflow, /AUTHORIZE_GITHUB_MAIN_REVIEW_POLICY_READINESS/);
assert.match(liveWorkflow, /AUTHORIZE_GITHUB_PRODUCTION_POLICY_READINESS/);
assert.match(liveWorkflow, /APPLY_GITHUB_MAIN_REVIEW_POLICY/);
assert.match(liveWorkflow, /APPLY_GITHUB_PRODUCTION_POLICY/);
assert.match(liveWorkflow, /VERIFY_GITHUB_MAIN_REVIEW_POLICY/);
assert.match(liveWorkflow, /VERIFY_GITHUB_PRODUCTION_POLICY/);
assert.match(liveWorkflow, /TARGET_BRANCH:/);
assert.match(liveWorkflow, /persist-credentials: false/);

assert.match(publisherWorkflow, /^name: GitHub Review Policy Readiness Publisher/m);
assert.match(publisherWorkflow, /workflow_run:/);
assert.match(publisherWorkflow, /Governed GitHub Review Policy Live Activation/);
assert.match(publisherWorkflow, /actions: read/);
assert.match(publisherWorkflow, /contents: read/);
assert.match(publisherWorkflow, /issues: write/);
assert.match(publisherWorkflow, /const expected = `github-review-policy-readiness-\$\{context\.payload\.workflow_run\.id\}`;/);
assert.match(publisherWorkflow, /run-id: \$\{\{ github\.event\.workflow_run\.id \}\}/);
assert.match(publisherWorkflow, /persist-credentials: false/);

assert.equal((migrationRunner.match(/name: 'governed_migration_execute'/g) || []).length, 2, "Migration 1051 runner should contain one dry-run and one Apply transport call");
assert.match(migrationRunner, /apply_retried: false/);
assert.match(migrationRunner, /live_github_policy_apply: false/);
assert.match(migrationRunner, /provider_call_executed: false/);
assert.match(migrationRunner, /external_write_executed: false/);
assert.match(migrationRunner, /SOURCE_PR must identify the merged source PR/);
assert.ok(migrationRunner.includes("headers: { 'x-api-key': KEY, Accept: 'application/json', 'Content-Type': 'application/json' }"));
assert.doesNotMatch(migrationRunner, /Authorization: `Bearer \$\{KEY\}/);

assert.equal((liveRunner.match(/applyResponse = await requestRaw\(["']\/admin\/repository-automation\/policy-controller/g) || []).length, 1, "Live policy runner must contain exactly one Ruleset Apply transport call");
assert.match(liveRunner, /apply_retried: false/);
assert.match(liveRunner, /readinessMarkerPrefix\(TARGET_BRANCH\)/);
assert.match(liveRunner, /branchConfirmation\(TARGET_BRANCH\)/);
assert.match(liveRunner, /verifyMigration1051Applied/);
assert.match(liveRunner, /migration_1051_readback_transport_failed/);
assert.match(liveRunner, /response_error_code/);
assert.match(liveRunner, /response_keys/);
assert.ok(liveRunner.includes('headers: { "x-api-key": KEY, Accept: "application/json", "Content-Type": "application/json" }'));
assert.doesNotMatch(liveRunner, /Authorization: `Bearer \$\{KEY\}/);
assert.match(liveRunner, /capability_resolution_envelope_apply_authorize/);
assert.match(liveRunner, /currentRefSha\(TARGET_BRANCH\), targetSha/);
assert.match(liveRunner, /ambiguous_transport_reconciliation/);
assert.match(liveRunner, /Apply was not retried/);
assert.match(liveRunner, /force_push_executed: false/);
assert.match(liveRunner, /repository_content_mutation_executed: false/);
assert.match(liveRunner, new RegExp(`const MIGRATION_BLOB_SHA = "${migrationBlobSha}";`));
assert.match(liveRunner, new RegExp(`const ENVELOPE_CREATOR_BLOB_SHA = "${envelopeCreatorBlobSha}";`));

assert.match(publisher, /EXPECTED_WORKFLOW = "Governed GitHub Review Policy Live Activation"/);
assert.match(publisher, /assert\.equal\(summary\?\.migration_1051_verified, true\)/);
assert.match(publisher, /assert\.equal\(summary\?\.envelope_created_by_this_run, false\)/);
assert.match(publisher, /assert\.equal\(summary\?\.apply_sent_by_this_run, false\)/);
assert.match(publisher, /assert\.equal\(summary\?\.provider_call_executed, false\)/);
assert.match(publisher, /assert\.equal\(summary\?\.external_write_executed, false\)/);
assert.match(publisher, /assert\.equal\(summary\?\.secrets_included, false\)/);
assert.match(publisher, /target_branch=\$\{targetBranch\} target_sha=\$\{targetSha\}/);

console.log("github repository policy live activation contract tests passed");
