import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { classifyMigrationReadbackFailure } from "../.github/ops/lib/migration-readback-diagnostics.mjs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

const migrationWorkflow = read("../.github/workflows/github-repository-policy-1051-governed-rollout.yml");
const metadataState = read("../.github/ops/github-repository-policy-1051-metadata-state.mjs");
const liveWorkflow = read("../.github/workflows/github-main-review-policy-live-activation.yml");
const publisherWorkflow = read("../.github/workflows/github-main-review-policy-readiness-publisher.yml");
const migrationRunner = read("../.github/ops/github-repository-policy-1051-governed-rollout.mjs");
const liveRunner = read("../.github/ops/github-main-review-policy-live-activation.mjs");
const readbackDiagnostics = read("../.github/ops/lib/migration-readback-diagnostics.mjs");
const publisher = read("./scripts/github-main-review-policy-readiness-issue-publisher.mjs");
const conflictFailure = classifyMigrationReadbackFailure(
  { transport_ok: true, status: 409, http_ok: false, payload: { ok: false } },
  { readback_status: "fail", ledger: { found: false }, expectations: { missing: { tables: ["x"], columns: [], indexes: [], rule_conditions: [] } } },
);
assert.equal(conflictFailure.code, "migration_1051_readback_not_pass");
assert.equal(conflictFailure.status, 409);
assert.equal(conflictFailure.details.transport_ok, true);
assert.equal(conflictFailure.details.response_readback_status, "fail");
assert.equal(conflictFailure.details.response_ledger_found, false);
assert.deepEqual(conflictFailure.details.response_missing_counts, { tables: 1, columns: 0, indexes: 0, rule_conditions: 0 });

const transportFailure = classifyMigrationReadbackFailure(
  { transport_ok: false, status: null, http_ok: false, payload: null, transport_error: "AbortError" },
  null,
);
assert.equal(transportFailure.code, "migration_1051_readback_transport_failed");
assert.equal(transportFailure.status, 502);
assert.equal(transportFailure.details.transport_ok, false);

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

const readinessDiagnosticIndex = migrationWorkflow.indexOf("Capture Migration 225 envelope dependency diagnostic before authorization");
const readinessExecuteIndex = migrationWorkflow.indexOf("Execute Production-bound authorization and dry-run");
const applyGuardIndex = migrationWorkflow.indexOf("Enforce Migration 1051 pre-Apply metadata replay guard");
const applyExecuteIndex = migrationWorkflow.indexOf("Execute exactly-once metadata Apply and same-cycle certification");
const metadataDiagnosticIndex = migrationWorkflow.indexOf("Capture bounded Migration 1051 metadata diagnostic without Apply");
const ledgerVerifyIndex = migrationWorkflow.indexOf("Verify exact ledger and authority metadata without Apply");
assert.ok(readinessDiagnosticIndex >= 0, "Migration 1051 readiness must diagnose Migration 225 envelope dependency first");
assert.ok(readinessExecuteIndex > readinessDiagnosticIndex, "Migration 225 dependency diagnostic must run before 1051 authorization envelope creation");
assert.ok(applyGuardIndex >= 0, "Migration 1051 Apply must enforce a replay guard");
assert.ok(applyExecuteIndex > applyGuardIndex, "Replay guard must run before Migration 1051 Apply");
assert.ok(metadataDiagnosticIndex >= 0, "Migration 1051 VERIFY must capture bounded metadata diagnostics");
assert.ok(ledgerVerifyIndex > metadataDiagnosticIndex, "Metadata diagnostics must run before the exact ledger gate");
assert.match(migrationWorkflow, /github-repository-policy-1051-metadata-state\.mjs/);
assert.match(migrationWorkflow, /METADATA_DIAGNOSTIC_MODE: readiness/);
assert.match(migrationWorkflow, /METADATA_DIAGNOSTIC_MODE: pre_apply/);
assert.match(migrationWorkflow, /METADATA_DIAGNOSTIC_MODE: verify/);

assert.match(metadataState, /github_repository_policy_1051_metadata_diagnostic\.v4/);
assert.match(metadataState, /github_repository_policy_1051_envelope_dependency_225\.v2/);
assert.match(metadataState, /github_repository_policy_1051_governance_writer_readiness\.v1/);
assert.match(metadataState, /225_sprint67_capability_resolution_envelope_ledger\.sql/);
assert.match(metadataState, /35b034940c2be63d9bf8a8099573cac1c5a75b5fffd8ccfad60a453ed3cf7419/);
assert.match(metadataState, /capability_resolution_envelope_ledger/);
assert.match(metadataState, /dependency-225-readback\.json/);
assert.match(metadataState, /\/deployment-info\?include_governance_db_readiness=1/);
assert.match(metadataState, /governance_db_privilege_readiness/);
assert.match(metadataState, /runtimeBranch === 'Production'/);
assert.match(metadataState, /privilege_matrix_exact === true/);
assert.match(metadataState, /database_connection_performed === true/);
assert.match(metadataState, /sql_readback_performed === true/);
assert.match(metadataState, /read_only_probe === true/);
assert.match(metadataState, /runtime_dependency_ready: runtimeDependencyReady/);
assert.match(metadataState, /governance_writer_ready: governanceWriter\.ready/);
assert.match(metadataState, /dependencyReady = runtimeDependencyReady && governanceWriter\.ready/);
assert.match(metadataState, /governance_writer_readiness_not_ready/);
assert.match(metadataState, /migration_1051_governance_writer_dependency_not_ready/);
assert.match(metadataState, /migration_1051_dependency_225_not_ready/);
assert.match(metadataState, /METADATA_DIAGNOSTIC_MODE must be verify, readiness, or pre_apply/);
assert.match(metadataState, /metadata-diagnostic-readback\.json/);
assert.match(metadataState, /operation_mode: 'read_only_readiness_probe'/);
assert.match(metadataState, /AS adapter_count/);
assert.match(metadataState, /AS readback_contract_count/);
assert.match(metadataState, /AS apply_policy_count/);
assert.match(metadataState, /AS capability_binding_count/);
assert.match(metadataState, /AS expected_policy_layer_count/);
assert.match(metadataState, /AS total_policy_layer_count/);
assert.match(metadataState, /AS migration_authorization_count/);
assert.match(metadataState, /target_metadata_state/);
assert.match(metadataState, /replay_safe_without_exact_ledger/);
assert.match(metadataState, /target_metadata_\$\{classification\.target_metadata_state\}_without_exact_ledger/);
assert.match(metadataState, /exact_apply_ledger_verified/);
assert.match(metadataState, /metadata_grants_apply_authority: false/);
assert.match(metadataState, /dependency_grants_apply_authority: false/);
assert.match(metadataState, /apply_sent: false/);
assert.match(metadataState, /provider_call_executed: false/);
assert.match(metadataState, /external_write_executed: false/);
assert.match(metadataState, /sql_mutation_performed: false/);
assert.match(metadataState, /migration_apply_performed: false/);
assert.match(metadataState, /provider_mutation_performed: false/);
assert.match(metadataState, /deployment_performed: false/);
assert.match(metadataState, /freeform_sql_accepted: false/);
assert.match(metadataState, /secrets_included: false/);

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
assert.match(migrationRunner, /assert\.ok\(result\.transport_ok && ledgerPass\(readback\), 'Exact Migration 1051 apply ledger is not proven'\)/);
assert.ok(migrationRunner.includes("headers: { 'x-api-key': KEY, Accept: 'application/json', 'Content-Type': 'application/json' }"));
assert.doesNotMatch(migrationRunner, /Authorization: `Bearer \$\{KEY\}/);

assert.equal((liveRunner.match(/applyResponse = await requestRaw\(["']\/admin\/repository-automation\/policy-controller/g) || []).length, 1, "Live policy runner must contain exactly one Ruleset Apply transport call");
assert.match(liveRunner, /apply_retried: false/);
assert.match(liveRunner, /readinessMarkerPrefix\(TARGET_BRANCH\)/);
assert.match(liveRunner, /branchConfirmation\(TARGET_BRANCH\)/);
assert.match(liveRunner, /verifyMigration1051Applied/);
assert.match(liveRunner, /classifyMigrationReadbackFailure/);
assert.match(readbackDiagnostics, /migration_1051_readback_transport_failed/);
assert.match(readbackDiagnostics, /migration_1051_readback_not_pass/);
assert.match(readbackDiagnostics, /response_error_code/);
assert.match(readbackDiagnostics, /response_readback_status/);
assert.match(readbackDiagnostics, /response_missing_counts/);
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
