#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const JOURNEY_ID = 'tenant-storage-route-and-repository-contract-convergence';
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

const route = runStructuredTest(
  'test-hostinger-storage-tenant-runtime-route.mjs',
  'hostinger_storage_tenant_runtime_route',
);
const durable = runStructuredTest(
  'test-hostinger-storage-control-plane-repository.mjs',
  'hostinger_storage_control_plane_repository',
);

assert.notEqual(route.gate, durable.gate, 'Child reports must remain independently attributable');

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

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_contract_convergence',
  journey_id: JOURNEY_ID,
  end_to_end: true,
  level: 'synthetic_runtime',
  actor: 'repository_ci_reviewer',
  entrypoint: 'node test-hostinger-storage-e2e.mjs',
  terminal_outcome: 'route_and_repository_contracts_passed',
  child_contracts: {
    mounted_route_gate: route.gate,
    durable_repository_gate: durable.gate,
  },
  assertions: {
    mounted_route_contract_passed: true,
    durable_repository_contract_passed: true,
    child_reports_independently_attributable: true,
    child_process_isolation: true,
    context_and_effective_authority_resolved: true,
    immutable_plan_and_single_use_consumption: true,
    fixed_synthetic_worker_dispatch: true,
    restart_safe_journal_contract: true,
    unknown_outcome_retry_guard: true,
    tenant_safe_projection: true,
    cross_tenant_leakage_rejected: true,
    expected_sha_bound: true,
  },
  contract_convergence_only: true,
  shared_operation_state: false,
  parent_feature_key: PARENT_FEATURE_KEY,
  parent_mvp_promoted: false,
  synthetic_only: true,
  live_provider_mutated: false,
  provider_dispatch_allowed: false,
  production_ready: false,
  secrets_included: false,
}));
