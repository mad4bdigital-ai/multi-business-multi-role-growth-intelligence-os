// frontend-surface-operation: post /admin/recovery/kernel/call
// frontend-surface-operation: post /admin/recovery/kernel/execute
// frontend-surface-operation: get /admin/recovery/kernel/runs/{run_id}
// frontend-surface-operation: get /admin/recovery/kernel/evidence/{run_id}

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import {
  getRecoveryCapabilities,
  readProductionIdentity,
  inspectProductionDatabase,
  createRemediationPlan,
  previewRemediationPlan,
  createApprovalChallenge,
  executeRemediationStep,
  sanitizeEvidence,
  _testingRecoveryKernel,
} from "./recoveryKernel.js";
import { buildRecoveryKernelRoutes } from "./routes/recoveryKernelRoutes.js";

const SHA = "a".repeat(40);
const ENV = {
  GITHUB_REPOSITORY: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
  GITHUB_REF_NAME: "Production",
  GITHUB_SHA: SHA,
  DEPLOYMENT_MANIFEST_JSON: JSON.stringify({
    repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    branch: "Production",
    commit_sha: SHA,
    source: "test_fixture",
    secrets_included: false,
  }),
};

function readinessFailure() {
  return {
    ok: false,
    status: "blocked",
    checks: {
      mcp_catalog_schema_ready: false,
      governance_db_privilege_ready: false,
      runtime_persistence_ready: false,
    },
    dimensions: {
      governance: { ready: false },
      runtime_persistence: { ok: false },
    },
    database_connection_performed: true,
    read_only_probe: true,
    sql_mutation_performed: false,
    migration_apply_performed: false,
    provider_mutation_performed: false,
    deployment_performed: false,
    secrets_included: false,
  };
}

test("Recovery Kernel capability catalog is static, bounded, and secret-safe", () => {
  const result = getRecoveryCapabilities();
  assert.equal(result.ok, true);
  assert.equal(result.catalog_source, "repository_static_contract");
  assert.equal(result.secrets_included, false);
  assert.equal(result.fixed_aliases.production_host_local_database_inspect, "database_full_inspection");
  assert.equal(result.fixed_aliases.host_breakglass_plan, "remediation_plan_create");
  for (const key of [
    "production_identity",
    "system_tool_get",
    "system_tools_search",
    "production_activation_readiness",
    "database_full_inspection",
    "remediation_plan_create",
    "remediation_plan_preview",
    "approval_challenge_create",
    "remediation_step_execute",
    "remediation_step_verify",
    "recovery_run_get",
    "recovery_evidence_get",
  ]) assert.ok(result.capabilities.some((entry) => entry.capability_key === key), key);
  assert.deepEqual(result.mutation_capabilities, ["remediation_step_execute"]);
  assert.equal(result.database_independent_capabilities.includes("recovery_capabilities"), true);
});

test("Production identity is exact-SHA and DB-independent", () => {
  const result = readProductionIdentity({ env: ENV, expectedSha: SHA });
  assert.equal(result.parity, true);
  assert.equal(result.git_sha, SHA);
  assert.equal(result.database_connection_performed, false);
  assert.equal(result.database_mutation_performed, false);
  assert.equal(result.secrets_included, false);
  assert.throws(() => readProductionIdentity({ env: ENV, expectedSha: "b".repeat(40) }), (error) => error?.code === "RECOVERY_PRODUCTION_IDENTITY_MISMATCH");
});

test("host-local database inspection remains exact-SHA dry-run and registers sanitized findings", async () => {
  const calls = [];
  const result = await inspectProductionDatabase(
    { expected_sha: SHA, target_key: "production-runtime" },
    {
      env: ENV,
      hostLocalExecutor: async (request, options) => {
        calls.push({ request, options });
        return {
          contract: "mad4b.host-breakglass-host-local-inspection.v1",
          ok: false,
          mode: "dry_run",
          target_source: "host_local_role_env",
          migration: null,
          checks: readinessFailure().checks,
          dimensions: readinessFailure().dimensions,
          database_connection_performed: true,
          database_mutation_performed: false,
          migration_apply_performed: false,
          grant_mutation_performed: false,
          workflow_dispatch_performed: false,
          read_only: true,
          secrets_included: false,
        };
      },
    },
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].request, { expected_sha: SHA, target_key: "production-runtime" });
  assert.equal(calls[0].options.env, ENV);
  assert.equal(result.read_only, true);
  assert.equal(result.database_mutation_performed, false);
  assert.equal(result.finding_count, 3);
  assert.ok(result.findings.every((finding) => finding.finding_id.startsWith("finding:")));
  assert.equal(result.secrets_included, false);
  assert.ok(_testingRecoveryKernel.RUNS.has(result.run_id));
});

test("plan and preview are deterministic and never execution-authorized", async () => {
  const run = [..._testingRecoveryKernel.RUNS.values()].at(-1);
  assert.ok(run?.findings?.length);
  const plan = await createRemediationPlan({
    expected_sha: SHA,
    target_key: "production-runtime",
    finding_ids: run.findings.map((finding) => finding.finding_id),
  });
  assert.equal(plan.database_independent_control_plane, true);
  assert.equal(plan.execution_allowed, false);
  assert.equal(plan.expected_sha, SHA);
  assert.ok(plan.plan_hash);
  assert.equal(plan.steps.length, 3);
  assert.ok(plan.steps.every((step) => step.preconditions.includes("plan_hash_match")));
  assert.equal(plan.steps.some((step) => step.capability_key === "governance.mcp_catalog.repair"), true);

  const preview = await previewRemediationPlan({ plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: plan.steps[0].step_id });
  assert.equal(preview.ok, true);
  assert.equal(preview.execution_allowed, false);
  assert.equal(preview.read_only_probe, true);
  assert.equal(preview.database_mutation_performed, false);
  assert.equal(preview.secrets_included, false);
});

test("approval challenge is bound to plan/step and never returns an approval token", async () => {
  const plan = [..._testingRecoveryKernel.PLANS.values()].at(-1);
  const step = plan.steps.find((entry) => entry.consequential);
  const challenge = await createApprovalChallenge({ plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id });
  assert.equal(challenge.execution_ready, false);
  assert.equal(challenge.approval_token_not_returned, true);
  assert.equal(challenge.plan_hash, plan.plan_hash);
  assert.equal(challenge.step_hash.length, 64);
  assert.equal(challenge.secrets_included, false);
});

test("consequential execution fails closed without durable approval, lock, or executor", async () => {
  const plan = [..._testingRecoveryKernel.PLANS.values()].at(-1);
  const step = plan.steps.find((entry) => entry.consequential);
  let executed = false;
  await assert.rejects(
    () => executeRemediationStep({
      plan_id: plan.plan_id,
      plan_hash: plan.plan_hash,
      step_id: step.step_id,
      approval_token: "not-a-real-bound-token-12345",
      idempotency_key: "test-idempotency-recovery-001",
    }, {
      mutationExecutor: { execute: async () => { executed = true; } },
      recoveryLock: { acquire: async () => true },
      approvalVerifier: { verify: async () => false },
    }),
    (error) => error?.code === "RECOVERY_APPROVAL_INVALID" && error?.status === 401,
  );
  assert.equal(executed, false);
});

test("evidence sanitization redacts sensitive keys and connection material", () => {
  const sanitized = sanitizeEvidence({ password: "do-not-return", bearer_token: "do-not-return", url: "mysql://user:pass@example.test/db", nested: { client_secret: "hidden" } });
  assert.equal(sanitized.password, "[REDACTED]");
  assert.equal(sanitized.bearer_token, "[REDACTED]");
  assert.equal(sanitized.url, "[REDACTED]");
  assert.equal(sanitized.nested.client_secret, "[REDACTED]");
});

test("private Recovery Kernel route is admin-guarded and exposes no shared staging route", async () => {
  const app = express();
  app.use(express.json());
  app.use(buildRecoveryKernelRoutes({
    requireBackendApiKey: (_req, _res, next) => next(),
    requireAdminPrincipal: (_req, _res, next) => next(),
    env: ENV,
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/admin/recovery/kernel/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capability_key: "recovery_capabilities", input: {} }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result.catalog_source, "repository_static_contract");
    assert.equal(body.secrets_included, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("private Recovery Kernel route rejects Staging at runtime before dispatch", async () => {
  let invoked = false;
  const app = express();
  app.use(express.json());
  app.use(buildRecoveryKernelRoutes({
    requireBackendApiKey: (_req, _res, next) => next(),
    requireAdminPrincipal: (_req, _res, next) => next(),
    env: { NODE_ENV: "staging" },
    productionActivationReadinessExecutor: async () => { invoked = true; return { ok: true }; },
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const port = server.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/admin/recovery/kernel/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capability_key: "recovery_capabilities", input: {} }),
    });
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error.code, "recovery_kernel_production_only");
    assert.equal(invoked, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
