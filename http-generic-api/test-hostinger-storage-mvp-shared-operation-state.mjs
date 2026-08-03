#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = path.join(HERE, 'test-hostinger-storage-tenant-runtime-route.mjs');
const TEMP_PATH = path.join(HERE, `.tmp-hostinger-storage-mvp-shared-state-${process.pid}.mjs`);

let source = fs.readFileSync(SOURCE_PATH, 'utf8');

function replaceOnce(needle, replacement, label) {
  const first = source.indexOf(needle);
  assert(first >= 0, `Missing ${label} insertion point`);
  assert.equal(source.indexOf(needle, first + needle.length), -1, `Ambiguous ${label} insertion point`);
  source = source.replace(needle, replacement);
}

replaceOnce(
  "try {\n  const applied = await postJson(app.url, {",
  `try {
  const beforeAppliedAggregate = appliedScenario.executionPackage.repository.readAggregate(
    appliedScenario.operation.operation_id,
  );
  assert(beforeAppliedAggregate);
  const beforeAppliedPlan = beforeAppliedAggregate.plans.find(
    (row) => row.plan_id === appliedScenario.fixture.plan.plan_id,
  );
  assert(beforeAppliedPlan);
  const immutablePlanBindingBefore = {
    plan_hash: beforeAppliedPlan.plan_hash,
    candidate_set_hash: beforeAppliedPlan.candidate_set_hash,
    impact_set_hash: beforeAppliedPlan.impact_set_hash,
    immutable_envelope_digest: beforeAppliedPlan.immutable_envelope_digest,
  };
  const approvalDigestsBefore = beforeAppliedAggregate.approvals.map((row) => row.record_digest);

  const applied = await postJson(app.url, {`,
  'pre-request aggregate',
);

replaceOnce(
  "  assert.equal(appliedScenario.executionPackage.enablementRegistry.exportState()[0].consumed, true);\n  const serialized = JSON.stringify(applied.body);",
  `  assert.equal(appliedScenario.executionPackage.enablementRegistry.exportState()[0].consumed, true);

  const afterAppliedAggregate = appliedScenario.executionPackage.repository.readAggregate(
    appliedScenario.operation.operation_id,
  );
  assert(afterAppliedAggregate);
  assert.equal(afterAppliedAggregate.operation.operation_id, appliedScenario.operation.operation_id);
  assert.equal(afterAppliedAggregate.operation.state, 'completed');
  assert(afterAppliedAggregate.transaction_version > beforeAppliedAggregate.transaction_version);

  const afterAppliedPlan = afterAppliedAggregate.plans.find(
    (row) => row.plan_id === appliedScenario.fixture.plan.plan_id,
  );
  assert(afterAppliedPlan);
  assert.equal(afterAppliedPlan.consumed, true);
  assert.equal(afterAppliedPlan.consumed_run_id, appliedScenario.fixture.run_id);
  assert.deepEqual({
    plan_hash: afterAppliedPlan.plan_hash,
    candidate_set_hash: afterAppliedPlan.candidate_set_hash,
    impact_set_hash: afterAppliedPlan.impact_set_hash,
    immutable_envelope_digest: afterAppliedPlan.immutable_envelope_digest,
  }, immutablePlanBindingBefore);
  assert.deepEqual(
    afterAppliedAggregate.approvals.map((row) => row.record_digest),
    approvalDigestsBefore,
  );

  assert.deepEqual(
    afterAppliedAggregate.journals.map((row) => row.phase),
    ['prepared', 'result', 'readback'],
  );
  assert(afterAppliedAggregate.journals.every((row) => (
    row.operation_id === appliedScenario.operation.operation_id
    && row.run_id === appliedScenario.fixture.run_id
    && row.plan_id === appliedScenario.fixture.plan.plan_id
  )));

  assert.equal(afterAppliedAggregate.reconciliations.length, 1);
  const reconciliation = afterAppliedAggregate.reconciliations[0];
  assert.equal(reconciliation.operation_id, appliedScenario.operation.operation_id);
  assert.equal(reconciliation.run_id, appliedScenario.fixture.run_id);
  assert.equal(reconciliation.outcome, applied.body.outcome);
  assert.equal(reconciliation.result_digest, applied.body.readback.result_digest);

  assert.equal(applied.body.readback.operation_id, appliedScenario.operation.operation_id);
  assert.equal(applied.body.readback.run_id, appliedScenario.fixture.run_id);
  assert.equal(applied.body.readback.plan_id, appliedScenario.fixture.plan.plan_id);
  assert.equal(applied.body.readback.outcome, reconciliation.outcome);
  assert.equal(applied.body.readback.result_digest, reconciliation.result_digest);

  const serialized = JSON.stringify(applied.body);`,
  'post-request aggregate',
);

replaceOnce(
  "  tenant_safe_readback: true,\n  provider_dispatch_allowed: false,",
  `  tenant_safe_readback: true,
  shared_operation_state: true,
  same_repository_identity_preserved: true,
  same_repository_operation_completed: true,
  same_repository_immutable_plan_consumed: true,
  same_repository_immutable_plan_bindings_preserved: true,
  same_repository_append_only_approvals_preserved: true,
  same_repository_prepared_result_readback_journal: true,
  same_repository_reconciliation_recorded: true,
  same_repository_tenant_readback_bound: true,
  provider_dispatch_allowed: false,`,
  'structured shared-state evidence',
);

let child;
try {
  fs.writeFileSync(TEMP_PATH, source, { flag: 'wx' });
  child = spawnSync(process.execPath, [TEMP_PATH], {
    cwd: HERE,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, CI: 'true' },
  });
} finally {
  fs.rmSync(TEMP_PATH, { force: true });
}

assert(child);
assert.equal(child.signal, null, `Instrumented route test terminated by ${child.signal}`);
assert.equal(
  child.status,
  0,
  `Instrumented route test failed:\n${String(child.stderr || child.stdout).slice(-6000)}`,
);
const lines = String(child.stdout || '').trim().split(/\r?\n/u).filter(Boolean);
assert(lines.length > 0, 'Instrumented route test produced no structured output');
const report = JSON.parse(lines.at(-1));
assert.equal(report.ok, true);
assert.equal(report.gate, 'hostinger_storage_tenant_runtime_route');
assert.equal(report.shared_operation_state, true);
assert.equal(report.same_repository_identity_preserved, true);
assert.equal(report.same_repository_operation_completed, true);
assert.equal(report.same_repository_immutable_plan_consumed, true);
assert.equal(report.same_repository_immutable_plan_bindings_preserved, true);
assert.equal(report.same_repository_append_only_approvals_preserved, true);
assert.equal(report.same_repository_prepared_result_readback_journal, true);
assert.equal(report.same_repository_reconciliation_recorded, true);
assert.equal(report.same_repository_tenant_readback_bound, true);
assert.equal(report.provider_dispatch_allowed, false);
assert.equal(report.production_ready, false);
assert.equal(report.secrets_included, false);
assert.equal(fs.existsSync(TEMP_PATH), false);

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_mvp_shared_operation_state',
  journey_id: 'tenant-storage-request-to-reconciled-readback',
  mounted_route: report.mounted_route,
  shared_operation_state: true,
  same_repository_identity_preserved: true,
  same_repository_operation_completed: true,
  same_repository_immutable_plan_consumed: true,
  same_repository_immutable_plan_bindings_preserved: true,
  same_repository_append_only_approvals_preserved: true,
  same_repository_prepared_result_readback_journal: true,
  same_repository_reconciliation_recorded: true,
  same_repository_tenant_readback_bound: true,
  one_shot_enablement_consumed: report.one_shot_enablement_consumed_after_all_checks === true,
  source_route_test_reused: true,
  fail_closed_source_instrumentation: true,
  temporary_file_removed: true,
  synthetic_only: true,
  live_provider_mutated: false,
  provider_dispatch_allowed: false,
  production_ready: false,
  secrets_included: false,
}));
