#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const JOURNEY_ID = 'tenant-storage-request-to-reconciled-readback';
const PARENT_FEATURE_KEY = '014-governed-hostinger-storage-orchestration';

function runStructuredTest(path, expectedGate) {
  const child = spawnSync(process.execPath, [path], {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, CI: 'true' },
  });
  assert.equal(child.signal, null, `${path} terminated by ${child.signal}`);
  assert.equal(child.status, 0, `${path} failed:\n${String(child.stderr || child.stdout).slice(-4000)}`);
  const lines = String(child.stdout || '').trim().split(/\r?\n/u).filter(Boolean);
  assert(lines.length > 0, `${path} produced no structured output`);
  const report = JSON.parse(lines.at(-1));
  assert.equal(report.ok, true, `${path} did not report ok=true`);
  assert.equal(report.gate, expectedGate, `${path} returned an unexpected gate`);
  assert.equal(report.secrets_included, false, `${path} included secrets`);
  return report;
}

const sharedState = runStructuredTest(
  'test-hostinger-storage-mvp-shared-operation-state.mjs',
  'hostinger_storage_mvp_shared_operation_state',
);
const route = runStructuredTest(
  'test-hostinger-storage-tenant-runtime-route.mjs',
  'hostinger_storage_tenant_runtime_route',
);
const durable = runStructuredTest(
  'test-hostinger-storage-control-plane-repository.mjs',
  'hostinger_storage_control_plane_repository',
);
const unknownOutcome = runStructuredTest(
  'test-hostinger-storage-unknown-outcome.mjs',
  'hostinger_storage_unknown_outcome',
);

assert.equal(sharedState.journey_id, JOURNEY_ID);
assert.equal(sharedState.mounted_route, 'POST /tenant/storage-operations/apply-plan');
assert.equal(sharedState.shared_operation_state, true);
assert.equal(sharedState.same_repository_identity_preserved, true);
assert.equal(sharedState.same_repository_operation_completed, true);
assert.equal(sharedState.same_repository_immutable_plan_consumed, true);
assert.equal(sharedState.same_repository_immutable_plan_bindings_preserved, true);
assert.equal(sharedState.same_repository_append_only_approvals_preserved, true);
assert.equal(sharedState.same_repository_prepared_result_readback_journal, true);
assert.equal(sharedState.same_repository_reconciliation_recorded, true);
assert.equal(sharedState.same_repository_tenant_readback_bound, true);
assert.equal(sharedState.one_shot_enablement_consumed, true);
assert.equal(sharedState.direct_mounted_route_execution, true);
assert.equal(sharedState.source_text_rewriting_used, false);
assert.equal(sharedState.temporary_test_file_created, false);
assert.equal(sharedState.provider_dispatch_allowed, false);
assert.equal(sharedState.production_ready, false);

assert.equal(route.mounted_route, 'POST /tenant/storage-operations/apply-plan');
assert.equal(route.context_kernel_mutation_gate, true);
assert.equal(route.effective_authority_dynamic_evidence, true);
assert.equal(route.current_capsule_dependency_readback, true);
assert.equal(route.one_shot_enablement_consumed_after_all_checks, true);
assert.equal(route.request_authority_injection_rejected_before_resolution, true);
assert.equal(route.expected_sha_mismatch_rejected_before_canary_dispatch, true);
assert.equal(route.cross_tenant_context_rejected, true);
assert.equal(route.tenant_safe_readback, true);
assert.equal(route.provider_dispatch_allowed, false);
assert.equal(route.production_ready, false);

assert.equal(durable.operation_idempotency, true);
assert.equal(durable.immutable_plan, true);
assert.equal(durable.append_only_approvals, true);
assert.equal(durable.cas_lease_generation, true);
assert.equal(durable.restart_safe_journal, true);
assert.equal(durable.single_use_plan, true);
assert.equal(durable.unknown_outcome_retry_guard, true);
assert.equal(durable.production_ready, false);

assert.equal(unknownOutcome.crash_before_mutation_reconciled_not_applied, true);
assert.equal(unknownOutcome.crash_after_mutation_recovered_from_receipt, true);
assert.equal(unknownOutcome.reconciliation_record_replay_safe, true);
assert.equal(unknownOutcome.automatic_retry_forbidden, true);
assert.equal(unknownOutcome.conflict_blocks_operation, true);
assert.equal(unknownOutcome.dispatch_allowed, false);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_mvp_shared_operation_state_convergence',
  journey_id: JOURNEY_ID,
  end_to_end: true,
  level: 'synthetic_runtime',
  actor: 'tenant_workspace_owner',
  entrypoint: 'POST /tenant/storage-operations/apply-plan',
  terminal_outcome: 'same_operation_completed_with_persisted_journal_reconciliation_and_tenant_readback',
  child_contracts: {
    shared_operation_state_gate: sharedState.gate,
    mounted_route_gate: route.gate,
    durable_repository_gate: durable.gate,
    unknown_outcome_gate: unknownOutcome.gate,
  },
  assertions: {
    mounted_route_contract_passed: true,
    direct_mounted_route_shared_state_proof: true,
    source_text_rewriting_used: false,
    temporary_test_file_created: false,
    durable_repository_contract_passed: true,
    context_and_effective_authority_resolved: true,
    same_repository_identity_preserved: true,
    same_repository_operation_completed: true,
    immutable_plan_and_single_use_consumption: true,
    immutable_plan_bindings_preserved: true,
    append_only_approvals_preserved: true,
    fixed_synthetic_worker_dispatch: true,
    prepared_result_readback_journal_persisted: true,
    reconciliation_recorded_for_same_operation: true,
    tenant_safe_projection_bound_to_same_run_plan_and_result: true,
    unknown_outcome_retry_guard: true,
    crash_before_mutation_reconciled_not_applied: true,
    crash_after_mutation_recovered_from_receipt: true,
    reconciliation_record_replay_safe: true,
    automatic_retry_forbidden: true,
    conflict_blocks_operation: true,
    cross_tenant_leakage_rejected: true,
    expected_sha_bound: true,
  },
  failure_retry_evidence_scope: 'supplemental_synthetic_executor_contract',
  failure_retry_evidence_same_mounted_request: false,
  contract_convergence_only: false,
  shared_operation_state: true,
  parent_feature_key: PARENT_FEATURE_KEY,
  parent_mvp_ready_for_promotion: true,
  parent_mvp_promoted: false,
  synthetic_only: true,
  live_provider_mutated: false,
  provider_dispatch_allowed: false,
  migration_apply_authorized: false,
  schema_verified: false,
  production_ready: false,
  secrets_included: false,
}));
