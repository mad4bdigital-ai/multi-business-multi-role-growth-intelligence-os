import assert from "node:assert/strict";
import test from "node:test";
import { buildHostBreakglassPlan } from "./hostBreakglassCatalog.js";
import {
  buildVerifiedHostBreakglassLocalRequest, verifyHostBreakglassLocalRequest, } from "./hostBreakglassLocalRequest.js";
import { rebuildVerifiedStagingAccessRepairPlan, rebuildVerifiedStagingPlan } from "./scripts/host-breakglass-local-verified.mjs";
import { readStagingRuntimeBootstrapContract } from "./stagingRuntimeBootstrapContract.js";
import { __adminHostBreakglassRoutesTest } from "./routes/adminHostBreakglassRoutes.js";

const SHA = "a".repeat(40);
const INPUT = Object.freeze({
  environment_key: "staging_local_windows_docker",
  operation_key: "database.repair",
  runbook_key: "database.access_repair",
  action: "dry_run",
  expected_sha: SHA,
  target_source: "staging_local_role_env",
  target_key: "staging-runtime",
  correlation_id: "staging-access-repair-local-request-001",
});

test("Staging local handoff emits an exact non-placeholder verified request bound to plan_sha256", () => {
  const plan = buildHostBreakglassPlan(INPUT, { bootstrapContract: readStagingRuntimeBootstrapContract() });
  const handoff = __adminHostBreakglassRoutesTest.attachVerifiedStagingLocalRequest(plan, {
    ok: true,
    contract: "mad4b.host-breakglass-local-handoff.v1",
    status: "local_execution_required",
    plan_sha256: plan.plan_sha256,
    database_mutation_performed: false,
    secrets_included: false,
  });

  assert.equal(handoff.status, "local_execution_required");
  assert.equal(handoff.verified_request.plan_sha256, plan.plan_sha256);
  assert.match(handoff.verified_request.request_sha256, /^[a-f0-9]{64}$/u);
  assert.equal(handoff.verified_request.environment_key, "staging_local_windows_docker");
  assert.equal(handoff.verified_request.runbook_key, "database.access_repair");
  assert.equal(handoff.verified_request.target_source, "staging_local_role_env");
  assert.equal(handoff.verified_request.secrets_included, false);
  assert.equal(handoff.command.includes("<verified-request.json>"), false);
  assert.match(handoff.command, /^node scripts\/host-breakglass-local-verified\.mjs --request-file \.\\verified-staging-access-repair-/u);

  const planInput = verifyHostBreakglassLocalRequest(handoff.verified_request);
  assert.deepEqual(planInput, {
    ...INPUT,
    migration: null,
    confirmation: null,
    execution_ticket_id: null,
    execution_ticket_hash: null,
    grant_binding_hash: null,
    authority_plan_hash: null,
    role_selection_proof: null,
  });

  const rebuilt = rebuildVerifiedStagingAccessRepairPlan(handoff.verified_request);
  assert.equal(rebuilt.plan_sha256, plan.plan_sha256);
});

test("verified local request fails closed on tampering before the legacy runner or database can execute", () => {
  const plan = buildHostBreakglassPlan(INPUT, { bootstrapContract: readStagingRuntimeBootstrapContract() });
  const request = buildVerifiedHostBreakglassLocalRequest(plan);
  const tampered = { ...request, expected_sha: "b".repeat(40) };

  assert.throws(
    () => rebuildVerifiedStagingAccessRepairPlan(tampered),
    (error) => error?.code === "host_breakglass_local_request_digest_mismatch",
  );
});

test("verified local request generation rejects Production plans outside canonical Staging local scope", () => {
  assert.throws(
    () => buildVerifiedHostBreakglassLocalRequest({
      ...buildHostBreakglassPlan(INPUT, { bootstrapContract: readStagingRuntimeBootstrapContract() }),
      environment_key: "production_hostinger_autodeploy",
    }),
    (error) => error?.code === "host_breakglass_local_request_environment_denied",
  );
});


test("Staging schema-repair local handoff emits an exact verified request", () => {
  const schemaInput = {
    ...INPUT,
    runbook_key: "database.schema_repair",
    action: "dry_run",
    migration: "20260902_staging_actions_runtime_contract_reconciliation.sql",
    correlation_id: "staging-schema-repair-local-request-001",
  };

  const plan = buildHostBreakglassPlan(schemaInput, {
    bootstrapContract: readStagingRuntimeBootstrapContract(),
  });

  const receipt = {
    ok: true,
    contract: "mad4b.host-breakglass-local-handoff.v1",
    status: "local_execution_required",
    plan_sha256: plan.plan_sha256,
    database_mutation_performed: false,
    secrets_included: false,
  };

  const handoff =
    __adminHostBreakglassRoutesTest.attachVerifiedStagingLocalRequest(
      plan,
      receipt,
    );

  assert.equal(handoff.status, "local_execution_required");
  assert.equal(handoff.verified_request.plan_sha256, plan.plan_sha256);
  assert.equal(handoff.verified_request.operation_key, "database.repair");
  assert.equal(handoff.verified_request.runbook_key, "database.schema_repair");
  assert.equal(handoff.verified_request.action, "dry_run");
  assert.equal(
    handoff.verified_request.migration,
    "20260902_staging_actions_runtime_contract_reconciliation.sql",
  );
  assert.equal(handoff.verified_request.secrets_included, false);

  assert.match(
    handoff.command,
    /^node scripts\/host-breakglass-local-verified\.mjs --request-file \.\\verified-staging-schema-repair-/u,
  );

  const verified =
    verifyHostBreakglassLocalRequest(handoff.verified_request);

  assert.equal(verified.operation_key, "database.repair");
  assert.equal(verified.runbook_key, "database.schema_repair");
  assert.equal(verified.action, "dry_run");

  const rebuilt =
    rebuildVerifiedStagingPlan(handoff.verified_request);

  assert.equal(rebuilt.plan_sha256, plan.plan_sha256);
});


test("unrelated repair runbook never receives a verified local request", () => {
  const plan = buildHostBreakglassPlan(INPUT, {
    bootstrapContract: readStagingRuntimeBootstrapContract(),
  });

  const unrelatedPlan = {
    ...plan,
    runbook_key: "database.full_inspection",
  };

  const receipt = {
    ok: true,
    contract: "mad4b.host-breakglass-local-handoff.v1",
    status: "local_execution_required",
    plan_sha256: plan.plan_sha256,
    database_mutation_performed: false,
    secrets_included: false,
  };

  const handoff =
    __adminHostBreakglassRoutesTest.attachVerifiedStagingLocalRequest(
      unrelatedPlan,
      receipt,
    );

  assert.equal(handoff, receipt);
  assert.equal(
    Object.hasOwn(handoff, "verified_request"),
    false,
  );
});

test("Staging schema-repair verified requests deny grant mutation authority", () => {
  const schemaInput = {
    ...INPUT,
    runbook_key: "database.schema_repair",
    action: "dry_run",
    migration: "20260902_staging_actions_runtime_contract_reconciliation.sql",
    correlation_id: "staging-schema-repair-action-boundary-001",
  };

  const validPlan = buildHostBreakglassPlan(schemaInput, {
    bootstrapContract: readStagingRuntimeBootstrapContract(),
  });

  assert.throws(
    () => buildVerifiedHostBreakglassLocalRequest({
      ...validPlan,
      action: "apply_grants",
    }),
    (error) => error?.code === "host_breakglass_local_request_action_denied",
  );
});
