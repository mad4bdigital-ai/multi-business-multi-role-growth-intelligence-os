// frontend-surface-operation: post /admin/recovery/kernel/call
// frontend-surface-operation: post /admin/recovery/kernel/execute
// frontend-surface-operation: get /admin/recovery/kernel/runs/{run_id}
// frontend-surface-operation: get /admin/recovery/kernel/evidence/{run_id}

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import {
  getRecoveryCapabilities,
  getRecoveryTrustModel,
  readRuntimeAttestation,
  readProductionIdentity,
  inspectProductionDatabase,
  createRemediationPlan,
  previewRemediationPlan,
  createApprovalChallenge,
  executeRemediationStep,
  sanitizeEvidence,
  callRecoveryKernelCapability,
  RECOVERY_STATE_PHASES,
  deriveRoleTargetFingerprints,
  assertTrustForMutation,
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

function makeDurableStore() {
  const runs = new Map();
  const receipts = new Map();
  const events = [];
  const clone = (value) => structuredClone(value);
  return {
    runs,
    receipts,
    events,
    async putRun(run) { runs.set(run.run_id, clone(run)); },
    async getRun(runId) { return runs.get(runId) ? clone(runs.get(runId)) : null; },
    async getRunByIdempotency(idempotencyKey) {
      const receipt = receipts.get(idempotencyKey);
      if (receipt) return clone(receipt);
      return [...runs.values()].find((run) => run.idempotency_key === idempotencyKey) ? clone([...runs.values()].find((run) => run.idempotency_key === idempotencyKey)) : null;
    },
    async getRunByPlanStep(planId, stepId) {
      const matches = [...runs.values()].filter((run) => run.plan_id === planId && run.step_id === stepId);
      return matches.length ? clone(matches.at(-1)) : null;
    },
    async appendEvidenceEvent(runId, event) { events.push(clone({ run_id: runId, ...event })); },
    async putIdempotencyReceipt(idempotencyKey, receipt) { receipts.set(idempotencyKey, clone(receipt)); },
  };
}

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
  assert.equal(result.fixed_aliases.ssh_preview, "ssh_session_preview");
  assert.equal(result.manifest_hash.length, 64);
  assert.equal(result.capability_levels.R0, "observe");
  assert.equal(result.capability_levels.legacy_R0, "identity_and_readiness");
  assert.equal(result.ssh_levels.S1, "read_only_shell");
  assert.equal(result.sql_levels.Q0, "metadata_only");
  for (const key of [
    "production_identity",
    "recovery_manifest_get",
    "recovery_trust_model",
    "recovery_incident_create",
    "privileged_operation_preview",
    "privileged_lease_preview",
    "recovery_exception_preview",
    "recovery_reconciliation_preview",
    "recovery_cancel_preview",
    "recovery_evidence_chain_preview",
    "secret_observation",
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
    "runtime_attestation",
    "tool_surface_parity",
    "unsupported_recovery_escalate",
    "ssh_session_preview",
    "sql_session_preview",
    "ephemeral_capability_create",
    "unsupported_capability_execute",
  ]) assert.ok(result.capabilities.some((entry) => entry.capability_key === key), key);
  assert.deepEqual(result.mutation_capabilities, ["remediation_step_execute", "unsupported_capability_execute"]);
  assert.equal(result.database_independent_capabilities.includes("recovery_capabilities"), true);
});

test("Root of Trust manifest and runtime attestation are hash-only and exact-SHA bound", () => {
  const attestation = readRuntimeAttestation({ env: ENV, expectedSha: SHA });
  assert.equal(attestation.parity, true);
  assert.equal(attestation.manifest_bound, true);
  assert.equal(attestation.recovery_manifest_hash.length, 64);
  assert.equal(attestation.target_fingerprints.composite.length, 64);
  assert.equal(attestation.role_credentials_ready.runtime.raw_values_exposed, false);
  assert.equal(attestation.role_credentials_ready.runtime.secrets_included, false);
  const trust = getRecoveryTrustModel({ env: ENV, expectedSha: SHA });
  assert.equal(trust.ok, true);
  assert.equal(trust.database_independent_control_plane, true);
  assert.ok(trust.dependency_graph.some((edge) => edge.prohibited === true));
});

test("Root of Trust rejects wrong SHA, manifest mismatch, and changed role target", () => {
  const wrongManifestEnv = { ...ENV, DEPLOYMENT_MANIFEST_JSON: JSON.stringify({ ...JSON.parse(ENV.DEPLOYMENT_MANIFEST_JSON), commit_sha: "b".repeat(40) }) };
  const wrongManifest = readRuntimeAttestation({ env: wrongManifestEnv, expectedSha: SHA });
  assert.equal(wrongManifest.parity, false);
  assert.equal(wrongManifest.manifest_verification.sha_match, false);
  const plannedFingerprint = deriveRoleTargetFingerprints({ env: ENV }).governance;
  assert.throws(() => assertTrustForMutation({ expectedSha: SHA, env: { ...ENV, GOVERNANCE_DB_NAME: "changed-only-in-test" }, targetRole: "governance", targetFingerprint: plannedFingerprint, adminPrincipal: { verified: true } }), (error) => error?.code === "TARGET_CHANGED" && error?.status === 409);
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
  assert.equal(result.causal_graph.contract, "mad4b.recovery-causal-finding-graph.v1");
  assert.equal(result.attestation.manifest_bound, true);
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
  }, { env: ENV });
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
    (error) => error?.code === "RECOVERY_STORE_UNAVAILABLE" && error?.status === 503,
  );
  assert.equal(executed, false);
});

test("durable execution follows the explicit state machine and cannot replay an approval", async () => {
  const plan = [..._testingRecoveryKernel.PLANS.values()].at(-1);
  const step = plan.steps.find((entry) => entry.consequential);
  const durable = makeDurableStore();
  const challenge = await createApprovalChallenge({ plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id });
  const receipt = await executeRemediationStep({
    plan_id: plan.plan_id,
    plan_hash: plan.plan_hash,
    step_id: step.step_id,
    approval_token: "bound-approval-token-for-test-001",
    idempotency_key: "test-idempotency-durable-001",
  }, {
    env: { ...ENV, RECOVERY_MUTATIONS_ENABLED: "true" },
    adminPrincipal: { verified: true, binding: "test_admin_guard" },
    approvalVerifier: { verify: async ({ approval }) => approval.approval_id === challenge.approval_id },
    recoveryLock: { acquire: async () => ({ acquired: true, lock_id: "test-lock" }), release: async () => {} },
    mutationExecutor: { execute: async () => ({ database_mutation_performed: false, provider_mutation_performed: false, secrets_included: false }) },
    recoveryStore: durable,
  });
  assert.equal(receipt.status, "verifying");
  assert.equal(receipt.phase, "verifying");
  const executingRun = [...durable.runs.values()].at(-1);
  assert.deepEqual(executingRun.events.map((event) => event.phase), ["created", "planned", "awaiting_approval", "approval_granted", "locked", "executing", "provider_acknowledged", "verifying"]);
  assert.ok(executingRun.events.every((event) => event.evidence_hash.length === 64));
  assert.deepEqual(RECOVERY_STATE_PHASES.slice(0, 5), ["created", "inspecting", "classified", "planned", "awaiting_approval"]);

  const verification = await import("./recoveryKernel.js").then(({ verifyRemediationStep }) => verifyRemediationStep({ plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id }, {
    recoveryStore: durable,
    readbackVerifier: { verify: async () => ({ postconditions_passed: true, behavioral_probe_passed: true, secrets_included: false }) },
  }));
  assert.equal(verification.recovered, true);
  assert.equal(verification.phase, "recovered");
  assert.deepEqual([...durable.runs.values()].at(-1).events.map((event) => event.phase).slice(-3), ["verifying", "verified", "recovered"]);

  const replay = await executeRemediationStep({
    plan_id: plan.plan_id,
    plan_hash: plan.plan_hash,
    step_id: step.step_id,
    approval_token: "bound-approval-token-for-test-001",
    idempotency_key: "test-idempotency-durable-001",
  }, { env: { ...ENV, RECOVERY_MUTATIONS_ENABLED: "true" }, adminPrincipal: { verified: true }, recoveryStore: durable });
  assert.equal(replay.idempotent_replay, true);
  await assert.rejects(
    () => executeRemediationStep({ plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id, approval_token: "bound-approval-token-for-test-001", idempotency_key: "test-idempotency-durable-002" }, { env: { ...ENV, RECOVERY_MUTATIONS_ENABLED: "true" }, adminPrincipal: { verified: true }, approvalVerifier: { verify: async () => true }, recoveryLock: { acquire: async () => true }, recoveryStore: durable, mutationExecutor: { execute: async () => ({}) } }),
    (error) => error?.code === "RECOVERY_APPROVAL_INVALID",
  );
});

test("fixed dispatcher never synthesizes an admin principal", async () => {
  await assert.rejects(
    () => callRecoveryKernelCapability("ssh_session_preview", {
      incident_id: "incident:principal-binding-001",
      expected_sha: SHA,
      target_key: "production-runtime",
      profile: "S1",
      command_sha256: "e".repeat(64),
    }, { env: ENV }),
    (error) => error?.code === "UNSUPPORTED_ADMIN_PRINCIPAL_REQUIRED" && error?.status === 403,
  );
});

test("fixed Unsupported Recovery previews are recorded, role-bound, and never open SSH or SQL", async () => {
  const ssh = await callRecoveryKernelCapability("ssh_preview", {
    incident_id: "incident:unsupported-test-001",
    expected_sha: SHA,
    target_key: "production-runtime",
    profile: "S1",
    risk_class: "read_only",
    command_sha256: "b".repeat(64),
  }, { env: ENV, adminPrincipal: { verified: true } });
  assert.equal(ssh.session_opened, false);
  assert.equal(ssh.execution_allowed, false);
  assert.equal(ssh.classification.profile_name, "read_only_shell");
  assert.equal(ssh.secrets_included, false);

  const sql = await callRecoveryKernelCapability("sql_preview", {
    incident_id: "incident:unsupported-test-001",
    expected_sha: SHA,
    target_key: "production-runtime",
    profile: "Q0",
    risk_class: "read_only",
    query_sha256: "c".repeat(64),
  }, { env: ENV, adminPrincipal: { verified: true } });
  assert.equal(sql.session_opened, false);
  assert.equal(sql.classification.profile_name, "metadata_only");
  assert.equal(sql.role_bound, true);

  const escalation = await callRecoveryKernelCapability("unsupported_recovery_escalate", {
    incident_id: "incident:unsupported-test-001",
    expected_sha: SHA,
    target_key: "production-runtime",
    reason: "No registered capability covers the observed runtime inconsistency.",
  }, { env: ENV, adminPrincipal: { verified: true } });
  assert.equal(escalation.status, "awaiting_unsupported_approval");
  assert.equal(escalation.ssh_sql_execution_enabled, false);
  assert.equal(escalation.temporary_authority_required, true);
});

test("ephemeral Unsupported Recovery capability is hash-only, expiring, and not executable by default", async () => {
  const capability = await callRecoveryKernelCapability("ephemeral_capability_create", {
    incident_id: "incident:unsupported-test-002",
    expected_sha: SHA,
    target_key: "production-runtime",
    transport: "sql",
    capability_type: "sql_patch",
    artifact_sha256: "d".repeat(64),
    scope_ref: "scope:metadata-only",
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    single_use: true,
    risk_class: "unknown",
  }, { env: ENV, adminPrincipal: { verified: true } });
  assert.equal(capability.content_received, false);
  assert.equal(capability.execution_allowed, false);
  assert.equal(capability.capability_hash.length, 64);
  await assert.rejects(
    () => callRecoveryKernelCapability("unsupported_capability_execute", {
      incident_id: "incident:unsupported-test-002",
      expected_sha: SHA,
      target_key: "production-runtime",
      capability_id: capability.capability_id,
      capability_hash: capability.capability_hash,
      approval_id: "approval:unsupported-test-001",
      idempotency_key: "idempotency:unsupported-test-001",
    }, { env: ENV, adminPrincipal: { verified: true } }),
    (error) => error?.code === "RECOVERY_MUTATIONS_DISABLED",
  );
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

test("private route exposes bounded Exception Framework previews only with auth-derived admin binding", async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.auth = { is_admin: true, mode: "test_admin" }; next(); });
  app.use(buildRecoveryKernelRoutes({
    requireBackendApiKey: (_req, _res, next) => next(),
    requireAdminPrincipal: (_req, _res, next) => next(),
    env: ENV,
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const port = server.address().port;
    const incidentResponse = await fetch(`http://127.0.0.1:${port}/admin/recovery/kernel/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capability_key: "recovery_incident_create", input: { incident_id: "incident:route-contract-001", expected_sha: SHA, target_key: "production-runtime", environment: "production", recovery_level: "R4", reason: "The normal catalog path is unavailable and requires bounded review." } }),
    });
    assert.equal(incidentResponse.status, 200);
    const incidentBody = await incidentResponse.json();
    assert.equal(incidentBody.result.recovery_mode, "RECOVERY_PRIVILEGED");
    assert.equal(incidentBody.result.secrets_included, false);

    const previewResponse = await fetch(`http://127.0.0.1:${port}/admin/recovery/kernel/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capability_key: "privileged_operation_preview", input: { incident_id: "incident:route-contract-001", expected_sha: SHA, target_key: "production-runtime", operation_type: "sql_statement", transport: "sql", profile: "Q0", scope_ref: "scope:metadata", artifact_sha256: "b".repeat(64), risk_class: "read_only", expires_at: new Date(Date.now() + 60_000).toISOString() } }),
    });
    assert.equal(previewResponse.status, 200);
    const previewBody = await previewResponse.json();
    assert.equal(previewBody.result.execution_allowed, false);
    assert.equal(previewBody.result.session_opened, false);
    assert.equal(previewBody.result.secrets_included, false);

    const rawResponse = await fetch(`http://127.0.0.1:${port}/admin/recovery/kernel/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capability_key: "privileged_operation_preview", input: { incident_id: "incident:route-contract-001", expected_sha: SHA, target_key: "production-runtime", operation_type: "sql_statement", transport: "sql", scope_ref: "scope:metadata", artifact_sha256: "b".repeat(64), query: "SELECT 1" } }),
    });
    assert.equal(rawResponse.status, 400);
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
