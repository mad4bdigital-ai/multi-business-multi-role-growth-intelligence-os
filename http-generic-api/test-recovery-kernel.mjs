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
import { issueExecutionTicket } from "./recoveryExecutionTicket.js";
import { buildRoleBundleBinding } from "./recoveryExecutionBinding.js";
import {
  activateExceptionLifecycle,
  approveExceptionLifecycle,
  buildDisasterRecoveryPreview,
  consumeExceptionLifecycle,
  createExceptionLifecycle,
  expireExceptionLifecycle,
  heartbeatExceptionLease,
  revokeExceptionLifecycle,
} from "./recoveryExceptionLifecycle.js";

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
const ROLE_BUNDLE_BINDINGS = {
  governance: buildRoleBundleBinding({ role: "governance", bundleManifestSha256: "1".repeat(64), roleBundleSha256: "2".repeat(64), statementCount: 1, statementFingerprints: ["3".repeat(64)] }),
  runtime_persistence: buildRoleBundleBinding({ role: "runtime_persistence", bundleManifestSha256: "4".repeat(64), roleBundleSha256: "5".repeat(64), statementCount: 1, statementFingerprints: ["6".repeat(64)] }),
};
const DEPLOYMENT_IDENTITY_PROVIDER = {
  readAttestation: async ({ target_fingerprint, target_role = "composite" } = {}) => {
    const attestation = readRuntimeAttestation({ env: ENV, expectedSha: SHA });
    return {
      ...attestation,
      target_fingerprint: target_fingerprint || attestation.target_fingerprints[target_role] || attestation.target_fingerprints.composite,
      target_fingerprints: { ...attestation.target_fingerprints, [target_role]: target_fingerprint || attestation.target_fingerprints[target_role] || attestation.target_fingerprints.composite },
    };
  },
};

function makeDurableStore() {
  const runs = new Map();
  const plans = new Map();
  const findings = new Map();
  const approvals = new Map();
  const exceptions = new Map();
  const executionTickets = new Map();
  const executionTicketStates = new Map();
  const executionClaims = new Map();
  const approvalReservations = new Map();
  const exceptionEvents = [];
  const receipts = new Map();
  const events = [];
  const clone = (value) => structuredClone(value);
  return {
    recovery_store_contract: "mad4b.recovery-durable-store.v1",
    independent_of_target_databases: true,
    target_database_binding: "forbidden",
    provider_accessed: false,
    runs,
    plans,
    findings,
    approvals,
    exceptions,
    executionTickets,
    executionTicketStates,
    executionClaims,
    approvalReservations,
    exceptionEvents,
    ephemeralCapabilities: new Map(),
    receipts,
    events,
    async putRun(run) { runs.set(run.run_id, clone(run)); },
    async getRun(runId) { return runs.get(runId) ? clone(runs.get(runId)) : null; },
    async putPlan(plan) { plans.set(plan.plan_id, clone(plan)); },
    async getPlan(planId) { return plans.get(planId) ? clone(plans.get(planId)) : null; },
    async putFinding(finding) { findings.set(finding.finding_id, clone(finding)); },
    async getFinding(findingId) { return findings.get(findingId) ? clone(findings.get(findingId)) : null; },
    async putApproval(approval) { approvals.set(approval.approval_id, clone(approval)); },
    async getApprovalByPlanStep(planId, stepId) {
      const matches = [...approvals.values()].filter((approval) => approval.plan_id === planId && approval.step_id === stepId);
      return matches.length ? clone(matches.at(-1)) : null;
    },
    async markApprovalUsed(approvalId) {
      const approval = approvals.get(approvalId);
      if (!approval) return { already_finalized: true };
      if (approval.used === true) return { already_finalized: true };
      approvals.set(approvalId, { ...approval, used: true, reserved: false, finalized_at: new Date().toISOString() });
      return { finalized: true };
    },
    async releaseApprovalReservation(context) {
      const approval = approvals.get(context.approval_id);
      if (approval && approval.used !== true) approvals.set(context.approval_id, { ...approval, reserved: false });
      for (const [key, reservation] of approvalReservations.entries()) if (reservation.approval_id === context.approval_id && reservation.idempotency_key === context.idempotency_key) approvalReservations.delete(key);
      return { released: true };
    },
    async reserveApproval(context) {
      const key = `${context.approval_id}:${context.plan_hash}:${context.step_id}:${context.idempotency_key}`;
      if (approvalReservations.has(key)) return { reserved: false, existing: true };
      const approval = approvals.get(context.approval_id);
      if (!approval || approval.used === true || approval.reserved === true || approval.plan_hash !== context.plan_hash || approval.step_id !== context.step_id) return { reserved: false };
      approvalReservations.set(key, clone({ ...context, reserved_at: new Date().toISOString() }));
      approvals.set(context.approval_id, { ...approval, reserved: true });
      return { reserved: true };
    },
    async putException(exception) { exceptions.set(exception.exception_id, clone(exception)); },
    async getException(exceptionId) { return exceptions.get(exceptionId) ? clone(exceptions.get(exceptionId)) : null; },
    async appendExceptionEvent(exceptionId, event) { exceptionEvents.push(clone({ exception_id: exceptionId, ...event })); },
    async putEphemeralCapability(capability) { this.ephemeralCapabilities.set(capability.capability_id, clone(capability)); },
    async getEphemeralCapability(capabilityId) { return this.ephemeralCapabilities.get(capabilityId) ? clone(this.ephemeralCapabilities.get(capabilityId)) : null; },
    async getRunByIdempotency(idempotencyKey) {
      const receipt = receipts.get(idempotencyKey);
      if (receipt) return clone(receipt);
      return [...runs.values()].find((run) => run.idempotency_key === idempotencyKey) ? clone([...runs.values()].find((run) => run.idempotency_key === idempotencyKey)) : null;
    },
    async claimExecution(context) {
      const existing = executionClaims.get(context.idempotency_key);
      if (existing) return { existing: true, status: existing.status, claim_id: existing.claim_id };
      const claim = { claim_id: `claim:${context.idempotency_key}`, status: "claimed", ...context, claimed_at: new Date().toISOString() };
      executionClaims.set(context.idempotency_key, clone(claim));
      return { claimed: true, claim_id: claim.claim_id };
    },
    async releaseExecutionClaim(context) { executionClaims.delete(context.idempotency_key); },
    async getExecutionTicket(ticketId) { return executionTickets.get(ticketId) ? clone(executionTickets.get(ticketId)) : null; },
    async putExecutionTicket(ticket) { executionTickets.set(ticket.ticket_id, clone(ticket)); executionTicketStates.set(ticket.ticket_id, { status: "issued", ticket_hash: ticket.ticket_hash }); },
    async reserveExecutionTicket(context) {
      const state = executionTicketStates.get(context.ticket_id);
      if (!state || state.ticket_hash !== context.ticket_hash || state.status === "finalized" || (state.status === "reserved" && state.idempotency_key !== context.idempotency_key)) return { reserved: false };
      if (state.status === "reserved") return { reserved: false, existing: true };
      executionTicketStates.set(context.ticket_id, { ...state, status: "reserved", ...context, reserved_at: new Date().toISOString() });
      return { reserved: true };
    },
    async releaseExecutionTicket(context) {
      const state = executionTicketStates.get(context.ticket_id);
      if (state?.status === "reserved" && state.idempotency_key === context.idempotency_key) executionTicketStates.set(context.ticket_id, { ...state, status: "issued" });
      return { released: true };
    },
    async finalizeExecutionTicket(context) {
      const state = executionTicketStates.get(context.ticket_id);
      if (!state || state.ticket_hash !== context.ticket_hash) return { finalized: false };
      if (state.status === "finalized") return { already_finalized: true };
      if (state.status !== "reserved" || state.idempotency_key !== context.idempotency_key) return { finalized: false };
      executionTicketStates.set(context.ticket_id, { ...state, status: "finalized", finalized_at: new Date().toISOString() });
      return { finalized: true };
    },
    executionTicketVerifier: { verify: async ({ ticket_hash, ticket }) => ticket.signature === `sig:${ticket_hash}` },
    async getRunByPlanStep(planId, stepId) {
      const matches = [...runs.values()].filter((run) => run.plan_id === planId && run.step_id === stepId);
      return matches.length ? clone(matches.at(-1)) : null;
    },
    async appendEvidenceEvent(runId, event) { events.push(clone({ run_id: runId, ...event })); },
    async putIdempotencyReceipt(idempotencyKey, receipt) { receipts.set(idempotencyKey, clone(receipt)); },
  };
}

async function storeExecutionTicket(store, plan, step, idempotencyKey) {
  const ticket = await issueExecutionTicket({
    inspection_run_id: plan.role_selection_proof?.inspection_run_id || plan.inspection_run_ids?.[0] || `run:${plan.plan_id.slice(-32)}`,
    inspection_evidence_hash: plan.role_selection_proof?.inspection_evidence_hash || plan.inspection_evidence_hashes?.[0] || plan.finding_hash,
    finding_ids: plan.finding_ids,
    selected_roles: plan.role_selection_proof?.selected_roles || ["composite"],
    role_selection_required: step.mutation_class === "C5",
    role_selection_hash: plan.role_selection_hash || null,
    role_object_count_fingerprints: plan.role_selection_proof?.role_object_count_fingerprints || {},
    target_fingerprints: plan.target_fingerprints,
    production_sha: plan.expected_sha,
    target_key: plan.target_key,
    plan_hash: plan.plan_hash,
    step_hash: step.step_hash,
    step_id: step.step_id,
    target_role: step.target_role,
    idempotency_key: idempotencyKey,
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    nonce: `nonce:${idempotencyKey}`,
    deployment_attestation_hash: plan.runtime_attestation_hash,
    role_bundle_bindings: plan.role_bundle_bindings && Object.keys(plan.role_bundle_bindings).length ? plan.role_bundle_bindings : (step.role_bundle_binding ? { [step.target_role]: step.role_bundle_binding } : {}),
  }, { signer: { sign: async ({ ticket_hash }) => `sig:${ticket_hash}` } });
  await store.putExecutionTicket(ticket);
  return ticket;
}

async function prepareExecutableStep(idempotencyKey) {
  const durable = makeDurableStore();
  const finding = { finding_id: "finding:abcdefabcdefabcdefabcdefabcdefab", candidate_capability: "governance.mcp_catalog.repair", category: "known_migration_gap", repairability: "known", inspection_run_id: "run:abcdefabcdefabcdefabcdefabcdefab", inspection_evidence_hash: "b".repeat(64), subject: { target_role: "governance" }, observed_state: { actual: { classification: "nonempty_objects", object_count_fingerprint: "c".repeat(64) } }, secrets_included: false };
  await durable.putFinding(finding);
  const plan = await createRemediationPlan({ expected_sha: SHA, target_key: "production-runtime", finding_ids: [finding.finding_id] }, { env: ENV, recoveryStore: durable, deploymentIdentityProvider: DEPLOYMENT_IDENTITY_PROVIDER });
  const step = plan.steps.find((entry) => entry.consequential);
  const challenge = await createApprovalChallenge({ plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id }, { recoveryStore: durable, deploymentIdentityProvider: DEPLOYMENT_IDENTITY_PROVIDER });
  const ticket = await storeExecutionTicket(durable, plan, step, idempotencyKey);
  return { durable, plan, step, challenge, ticket };
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
    full_inspection: true,
    role_database_object_counts: { runtime: { tables: 7, views: 0, triggers: 0, routines: 0, events: 0, total: 7 }, governance: { tables: 0, views: 0, triggers: 0, routines: 0, events: 0, total: 0 }, runtime_persistence: { tables: 0, views: 0, triggers: 0, routines: 0, events: 0, total: 0 } },
    role_database_object_classifications: { runtime: "nonempty_objects", governance: "zero_objects", runtime_persistence: "zero_objects" },
    role_database_object_count_fingerprints: { runtime: "a".repeat(64), governance: "b".repeat(64), runtime_persistence: "c".repeat(64) },
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
  assert.deepEqual(result.mutation_capabilities, ["runtime.baseline.rebuild_empty", "governance.baseline.rebuild_empty", "runtime_persistence.baseline.rebuild_empty", "remediation_step_execute", "unsupported_capability_execute"]);
  assert.equal(result.database_independent_capabilities.includes("recovery_capabilities"), true);
});

test("Exception lifecycle is durable, dual-control bound, single-use, and providerless by default", async () => {
  const store = makeDurableStore();
  const admin = { verified: true };
  const base = {
    incident_id: "incident:exception-lifecycle-20260825",
    exception_class: "E6",
    expected_sha: SHA,
    target_key: "production-runtime",
    plan_hash: "b".repeat(64),
    scope_ref: "scope:recovery-contract-test",
    reason_ref: "reason:bounded-recovery-contract-test",
    expires_at: new Date(Date.now() + 120000).toISOString(),
    budget: { max_uses: 1, max_runtime_seconds: 10, max_rows: 2, max_bytes: 1024, max_commands: 1 },
  };
  const created = await createExceptionLifecycle(base, { adminPrincipal: admin, exceptionStore: store });
  assert.equal(created.state, "awaiting_approval");
  assert.equal(created.persistence.durable, true);
  assert.equal(created.execution_allowed, false);
  assert.equal(created.provider_connected, false);
  assert.equal(store.exceptionEvents.length, 1);

  const afterFirstApproval = await approveExceptionLifecycle(await store.getException(created.exception_id), {
    approval_id: "approval:first-exception",
    approval_hash: "c".repeat(64),
    principal_fingerprint: "d".repeat(64),
  }, { exceptionStore: store });
  assert.equal(afterFirstApproval.state, "awaiting_approval");
  const afterRestart = await store.getException(created.exception_id);
  const approved = await approveExceptionLifecycle(afterRestart, {
    approval_id: "approval:second-exception",
    approval_hash: "e".repeat(64),
    principal_fingerprint: "f".repeat(64),
  }, { exceptionStore: store });
  assert.equal(approved.state, "approved");
  assert.equal(new Set(approved.approvals.map((approval) => approval.principal_fingerprint)).size, 2);

  const active = await activateExceptionLifecycle(await store.getException(created.exception_id), { exceptionStore: store });
  assert.equal(active.state, "active");
  assert.equal(active.execution_allowed, false);
  const heartbeat = await heartbeatExceptionLease(await store.getException(created.exception_id), {
    exceptionStore: store,
    heartbeatRef: "heartbeat:exception-1",
  });
  assert.equal(heartbeat.state, "active");
  const consumed = await consumeExceptionLifecycle(await store.getException(created.exception_id), {
    exceptionStore: store,
    consumeRef: "consume:exception-1",
  });
  assert.equal(consumed.state, "consumed");
  assert.equal(consumed.runtime_mutation_performed, false);
  await assert.rejects(async () => consumeExceptionLifecycle(await store.getException(created.exception_id), {
    exceptionStore: store,
    consumeRef: "consume:exception-2",
  }), (error) => error.code === "EXCEPTION_NOT_ACTIVE");
  assert.ok(store.exceptionEvents.every((event) => event.secrets_included === false));
});

test("Disaster Recovery preview is phase-complete but cannot connect or mutate", () => {
  const preview = buildDisasterRecoveryPreview({
    incident_id: "incident:dr-preview-20260825",
    expected_sha: SHA,
    target_key: "production-runtime",
    plan_hash: "1".repeat(64),
  }, { adminPrincipal: { verified: true } });
  assert.equal(preview.read_only_probe, true);
  assert.equal(preview.execution_allowed, false);
  assert.equal(preview.provider_connected, false);
  assert.equal(preview.runtime_mutation_performed, false);
  assert.deepEqual(preview.phases.map((phase) => phase.phase), [
    "backup_create",
    "backup_verify",
    "restore_preview",
    "replacement_build",
    "schema_reconstruct",
    "data_copy_policy",
    "replacement_validation",
    "cutover_preview",
    "cutover_rollback_preview",
  ]);
  assert.equal(preview.cutover_requires_separate_approval, true);
  assert.equal(preview.credential_rotation_required_after_cutover, true);
  assert.equal(preview.secrets_included, false);
});

test("Disaster Recovery preview is exposed only through the fixed non-consequential call surface", async () => {
  const result = await callRecoveryKernelCapability("disaster_recovery_preview", {
    incident_id: "incident:dr-call-20260825",
    expected_sha: SHA,
    target_key: "production-runtime",
    plan_hash: "2".repeat(64),
  }, { env: ENV, adminPrincipal: { verified: true } });
  assert.equal(result.read_only_probe, true);
  assert.equal(result.execution_allowed, false);
  assert.equal(result.provider_connected, false);
  assert.equal(result.runtime_mutation_performed, false);
  assert.equal(result.secrets_included, false);
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
          full_inspection: true,
          role_database_object_counts: { runtime: { tables: 7, views: 0, triggers: 0, routines: 0, events: 0, total: 7 }, governance: { tables: 0, views: 0, triggers: 0, routines: 0, events: 0, total: 0 }, runtime_persistence: { tables: 0, views: 0, triggers: 0, routines: 0, events: 0, total: 0 } },
          role_database_object_classifications: { runtime: "nonempty_objects", governance: "zero_objects", runtime_persistence: "zero_objects" },
          role_database_object_count_fingerprints: { runtime: "a".repeat(64), governance: "b".repeat(64), runtime_persistence: "c".repeat(64) },
          role_bundle_bindings: ROLE_BUNDLE_BINDINGS,
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
  assert.equal(result.finding_count, 2);
  assert.deepEqual(result.findings.slice(0, 2).map((finding) => finding.category), ["empty_uninitialized_database", "empty_uninitialized_database"]);
  assert.deepEqual(result.findings.slice(0, 2).map((finding) => finding.subject.target_role), ["governance", "runtime_persistence"]);
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
  assert.equal(plan.steps.length, 2);
  assert.ok(plan.steps.every((step) => step.preconditions.includes("plan_hash_match")));
  assert.deepEqual(plan.selected_rebuild_roles, ["governance", "runtime_persistence"]);
  assert.equal(plan.steps.filter((step) => step.capability_key.endsWith(".baseline.rebuild_empty")).length, 2);
  assert.equal(plan.steps.some((step) => step.capability_key === "governance.mcp_catalog.repair" || step.capability_key === "governance.grant.repair" || step.capability_key === "runtime_persistence.schema.repair"), false);
  assert.ok(plan.steps.every((step) => step.inspection_run_id === run.run_id));

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
  assert.equal(challenge.target_fingerprint.length, 64);
  assert.equal(challenge.composite_target_fingerprint, plan.target_fingerprint);
  assert.equal(challenge.step_target_fingerprint, step.target_fingerprint);
  assert.equal(challenge.target_role, step.target_role);
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
    (error) => error?.code === "RECOVERY_MUTATION_STORE_UNAVAILABLE" && error?.status === 503,
  );
  assert.equal(executed, false);
});

test("durable execution follows the explicit state machine and cannot replay an approval", async () => {
  const sourcePlan = [..._testingRecoveryKernel.PLANS.values()].at(-1);
  const sourceRun = [..._testingRecoveryKernel.RUNS.values()].find((run) => run.run_id === sourcePlan.inspection_run_ids?.[0]) || [..._testingRecoveryKernel.RUNS.values()].at(-1);
  const durable = makeDurableStore();
  for (const finding of sourceRun.findings) await durable.putFinding(finding);
  const plan = await createRemediationPlan({ expected_sha: SHA, target_key: "production-runtime", finding_ids: sourcePlan.finding_ids }, { env: ENV, recoveryStore: durable, deploymentIdentityProvider: DEPLOYMENT_IDENTITY_PROVIDER });
  const step = plan.steps.find((entry) => entry.consequential);
  const challenge = await createApprovalChallenge({ plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id }, { recoveryStore: durable, deploymentIdentityProvider: DEPLOYMENT_IDENTITY_PROVIDER });
  const ticket = await storeExecutionTicket(durable, plan, step, "test-idempotency-durable-001");
  const receipt = await executeRemediationStep({
    plan_id: plan.plan_id,
    plan_hash: plan.plan_hash,
    step_id: step.step_id,
    approval_token: "bound-approval-token-for-test-001",
    execution_ticket_id: ticket.ticket_id,
    idempotency_key: "test-idempotency-durable-001",
  }, {
    env: { ...ENV, RECOVERY_MUTATIONS_ENABLED: "true" },
    adminPrincipal: { verified: true, binding: "test_admin_guard" },
    approvalVerifier: { verify: async ({ approval }) => approval.approval_id === challenge.approval_id },
    recoveryLock: { acquire: async () => ({ acquired: true, lock_id: "test-lock", lease_id: "lease:test-lock-001", fencing_token: "fence:test-lock-001", expires_at: new Date(Date.now() + 600000).toISOString() }), heartbeat: async () => ({ renewed: true }), assertFence: async () => ({ valid: true }), release: async () => {} },
    mutationExecutor: { execute: async () => ({ database_mutation_performed: false, provider_mutation_performed: false, secrets_included: false }) },
    readbackVerifier: { verify: async () => ({ postconditions_passed: true, behavioral_probe_passed: true }) },
    recoveryStore: durable,
    deploymentIdentityProvider: DEPLOYMENT_IDENTITY_PROVIDER,
  });
  assert.equal(receipt.status, "verifying");
  assert.equal(receipt.phase, "verifying");
  const executingRun = [...durable.runs.values()].at(-1);
  assert.deepEqual(executingRun.events.map((event) => event.phase), ["created", "planned", "awaiting_approval", "approval_granted", "locked", "executing", "provider_acknowledged", "verifying"]);
  assert.ok(executingRun.events.every((event) => event.evidence_hash.length === 64));
  assert.deepEqual(RECOVERY_STATE_PHASES.slice(0, 5), ["created", "inspecting", "classified", "planned", "awaiting_approval"]);

  const verification = await import("./recoveryKernel.js").then(({ verifyRemediationStep }) => verifyRemediationStep({ plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id }, {
    recoveryStore: durable,
    deploymentIdentityProvider: DEPLOYMENT_IDENTITY_PROVIDER,
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
  }, { env: { ...ENV, RECOVERY_MUTATIONS_ENABLED: "true" }, adminPrincipal: { verified: true }, recoveryStore: durable, deploymentIdentityProvider: DEPLOYMENT_IDENTITY_PROVIDER });
  assert.equal(replay.idempotent_replay, true);
  const secondTicket = await storeExecutionTicket(durable, plan, step, "test-idempotency-durable-002");
  await assert.rejects(
    () => executeRemediationStep({ plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id, approval_token: "bound-approval-token-for-test-001", execution_ticket_id: secondTicket.ticket_id, idempotency_key: "test-idempotency-durable-002" }, { env: { ...ENV, RECOVERY_MUTATIONS_ENABLED: "true" }, adminPrincipal: { verified: true }, approvalVerifier: { verify: async () => true }, recoveryLock: { acquire: async () => true }, readbackVerifier: { verify: async () => ({ postconditions_passed: true, behavioral_probe_passed: true }) }, recoveryStore: durable, deploymentIdentityProvider: DEPLOYMENT_IDENTITY_PROVIDER, mutationExecutor: { execute: async () => ({}) } }),
    (error) => error?.code === "RECOVERY_APPROVAL_INVALID",
  );
});

test("concurrent callers share one atomic execution claim and invoke the executor at most once", async () => {
  const { durable, plan, step, challenge, ticket } = await prepareExecutableStep("idempotency:concurrent-at-most-once");
  let executions = 0;
  const lock = { acquire: async () => ({ acquired: true, lease_id: "lease:concurrent-001", fencing_token: "fence:concurrent-001", expires_at: new Date(Date.now() + 600000).toISOString() }), heartbeat: async () => ({ renewed: true }), assertFence: async () => ({ valid: true }), release: async () => {} };
  const input = { plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id, approval_token: "bound-approval-token-concurrent-001", execution_ticket_id: ticket.ticket_id, idempotency_key: "idempotency:concurrent-at-most-once" };
  const deps = { env: { ...ENV, RECOVERY_MUTATIONS_ENABLED: "true" }, adminPrincipal: { verified: true, binding: "test_admin_guard" }, approvalVerifier: { verify: async ({ approval }) => approval.approval_id === challenge.approval_id }, recoveryLock: lock, mutationExecutor: { execute: async () => { executions += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return { database_mutation_performed: false, provider_mutation_performed: false, secrets_included: false }; } }, readbackVerifier: { verify: async () => ({ postconditions_passed: true, behavioral_probe_passed: true }) }, recoveryStore: durable, deploymentIdentityProvider: DEPLOYMENT_IDENTITY_PROVIDER };
  const results = await Promise.all([executeRemediationStep(input, deps), executeRemediationStep(input, deps)]);
  assert.equal(executions, 1);
  assert.equal(results.filter((result) => result.idempotent_replay === true).length, 1);
  assert.equal(results.filter((result) => result.contract === "mad4b.recovery-remediation-execution-receipt.v1").length, 1);
});

test("pre-provider failure releases the claim, approval reservation, and ticket reservation", async () => {
  const { durable, plan, step, ticket } = await prepareExecutableStep("idempotency:pre-provider-release");
  await assert.rejects(
    () => executeRemediationStep({ plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id, approval_token: "bound-approval-token-pre-provider-001", execution_ticket_id: ticket.ticket_id, idempotency_key: "idempotency:pre-provider-release" }, { env: { ...ENV, RECOVERY_MUTATIONS_ENABLED: "true" }, adminPrincipal: { verified: true }, approvalVerifier: { verify: async () => true }, recoveryLock: { acquire: async () => ({ acquired: true, lease_id: "lease:pre-provider-001", fencing_token: "fence:pre-provider-001", expires_at: new Date(Date.now() + 600000).toISOString() }), heartbeat: async () => ({ renewed: true }), assertFence: async () => ({ valid: true }), release: async () => {} }, readbackVerifier: { verify: async () => ({ postconditions_passed: true, behavioral_probe_passed: true }) }, recoveryStore: durable, deploymentIdentityProvider: DEPLOYMENT_IDENTITY_PROVIDER }),
    (error) => error?.code === "RECOVERY_EXECUTOR_UNAVAILABLE",
  );
  assert.equal(durable.executionClaims.size, 0);
  assert.equal(durable.approvalReservations.size, 0);
  assert.equal(durable.executionTicketStates.get(ticket.ticket_id).status, "issued");
});

test("provider acknowledgement followed by fence loss is permanently reconciliation-only", async () => {
  const { durable, plan, step, challenge, ticket } = await prepareExecutableStep("idempotency:fence-loss-unknown");
  let fenceChecks = 0;
  let executions = 0;
  await assert.rejects(
    () => executeRemediationStep({ plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id, approval_token: "bound-approval-token-fence-loss-001", execution_ticket_id: ticket.ticket_id, idempotency_key: "idempotency:fence-loss-unknown" }, { env: { ...ENV, RECOVERY_MUTATIONS_ENABLED: "true" }, adminPrincipal: { verified: true }, approvalVerifier: { verify: async ({ approval }) => approval.approval_id === challenge.approval_id }, recoveryLock: { acquire: async () => ({ acquired: true, lease_id: "lease:fence-loss-001", fencing_token: "fence:fence-loss-001", expires_at: new Date(Date.now() + 600000).toISOString() }), heartbeat: async () => ({ renewed: true }), assertFence: async () => { fenceChecks += 1; return { valid: fenceChecks < 2 }; }, release: async () => {} }, mutationExecutor: { execute: async () => { executions += 1; return { database_mutation_performed: true, provider_mutation_performed: true, secrets_included: false }; } }, readbackVerifier: { verify: async () => ({ postconditions_passed: true, behavioral_probe_passed: true }) }, recoveryStore: durable, deploymentIdentityProvider: DEPLOYMENT_IDENTITY_PROVIDER }),
    (error) => error?.code === "RECOVERY_EXECUTION_OUTCOME_UNKNOWN",
  );
  assert.equal(executions, 1);
  const run = [...durable.runs.values()].at(-1);
  assert.equal(run.phase, "execution_outcome_unknown");
  assert.equal(durable.executionClaims.size, 1);
  assert.equal(durable.executionTicketStates.get(ticket.ticket_id).status, "reserved");
  const replay = await executeRemediationStep({ plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id, approval_token: "bound-approval-token-fence-loss-001", execution_ticket_id: ticket.ticket_id, idempotency_key: "idempotency:fence-loss-unknown" }, { env: { ...ENV, RECOVERY_MUTATIONS_ENABLED: "true" }, adminPrincipal: { verified: true }, recoveryStore: durable, readbackVerifier: { verify: async () => ({ postconditions_passed: true, behavioral_probe_passed: true }) }, mutationExecutor: { execute: async () => { executions += 1; return { database_mutation_performed: true }; } } });
  assert.equal(replay.status, "reconciliation_required");
  assert.equal(executions, 1);
});

test("consequential execution rejects a durable store coupled to a target database", async () => {
  const plan = [..._testingRecoveryKernel.PLANS.values()].at(-1);
  const step = plan.steps.find((entry) => entry.consequential);
  const coupled = makeDurableStore();
  coupled.independent_of_target_databases = false;
  let executed = false;
  await assert.rejects(
    () => executeRemediationStep({
      plan_id: plan.plan_id,
      plan_hash: plan.plan_hash,
      step_id: step.step_id,
      approval_token: "bound-approval-token-for-test-coupled-store",
      idempotency_key: "test-idempotency-coupled-store-001",
    }, {
      env: { ...ENV, RECOVERY_MUTATIONS_ENABLED: "true" },
      adminPrincipal: { verified: true },
      approvalVerifier: { verify: async () => true },
      recoveryLock: { acquire: async () => true },
      recoveryStore: coupled,
      mutationExecutor: { execute: async () => { executed = true; } },
    }),
    (error) => error?.code === "RECOVERY_MUTATION_STORE_UNAVAILABLE" && error?.status === 503,
  );
  assert.equal(executed, false);
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


test("durable plans and findings survive a process-memory restart boundary", async () => {
  const durable = makeDurableStore();
  const inspection = await inspectProductionDatabase({ expected_sha: SHA, target_key: "production-runtime" }, {
    env: ENV,
    hostLocalExecutor: async () => readinessFailure(),
    recoveryStore: durable,
    deploymentIdentityProvider: DEPLOYMENT_IDENTITY_PROVIDER,
  });
  assert.equal(inspection.durability.inspection_durable, true);
  assert.equal(inspection.durability.mutation_grade_durable, true);
  assert.equal(durable.findings.size, 2);
  const findingIds = [...durable.findings.keys()];
  _testingRecoveryKernel.RUNS.clear();
  _testingRecoveryKernel.PLANS.clear();
  const plan = await createRemediationPlan({ expected_sha: SHA, target_key: "production-runtime", finding_ids: findingIds }, { env: ENV, recoveryStore: durable, deploymentIdentityProvider: DEPLOYMENT_IDENTITY_PROVIDER });
  assert.equal(durable.plans.has(plan.plan_id), true);
  _testingRecoveryKernel.RUNS.clear();
  _testingRecoveryKernel.PLANS.clear();
  const resumedPlan = await previewRemediationPlan({ plan_id: plan.plan_id, plan_hash: plan.plan_hash }, { recoveryStore: durable, deploymentIdentityProvider: DEPLOYMENT_IDENTITY_PROVIDER });
  assert.equal(resumedPlan.plan_id, plan.plan_id);
  assert.equal(resumedPlan.execution_allowed, false);
  const durableFinding = await callRecoveryKernelCapability("finding_details", { finding_id: findingIds[0] }, { recoveryStore: durable, env: ENV });
  assert.equal(durableFinding.durable_read, true);
  assert.equal(durableFinding.finding.inspection_run_id, inspection.run_id);
  const step = plan.steps.find((entry) => entry.consequential);
  const challenge = await createApprovalChallenge({ plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id }, { recoveryStore: durable, deploymentIdentityProvider: DEPLOYMENT_IDENTITY_PROVIDER });
  assert.equal(durable.approvals.has(challenge.approval_id), true);
  assert.equal(challenge.step_hash.length, 64);
  assert.equal(challenge.target_fingerprint.length, 64);
});


test("unsupported capability is plan-bound and brokerless execution fails closed", async () => {
  const durable = makeDurableStore();
  const capability = await callRecoveryKernelCapability("ephemeral_capability_create", {
    incident_id: "incident:plan-bound-unsupported-001",
    expected_sha: SHA,
    target_key: "production-runtime",
    transport: "sql",
    capability_type: "registered_sql_repair",
    artifact_sha256: "f".repeat(64),
    scope_ref: "scope:bounded-repair",
    expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    single_use: true,
    risk_class: "reversible",
  }, { env: ENV, adminPrincipal: { verified: true }, recoveryStore: durable, deploymentIdentityProvider: DEPLOYMENT_IDENTITY_PROVIDER });
  const ticketFinding = { finding_id: "finding:abcdef0123456789", subject: { target_role: "composite", resource: "registered unsupported capability" }, category: "unknown_fail_closed", severity: "high", desired_state: { expected: { provider: "governed" }, authority_ref: "test" }, observed_state: { actual: { provider: "unavailable" } }, confidence: "verified", repairability: "deterministic", mutation_required: false, candidate_capability: null };
  await durable.putFinding(ticketFinding);
  const plan = await createRemediationPlan({
    expected_sha: SHA,
    target_key: "production-runtime",
    finding_ids: [ticketFinding.finding_id],
    unsupported_capability_id: capability.capability_id,
    unsupported_capability_hash: capability.capability_hash,
  }, { env: ENV, recoveryStore: durable, deploymentIdentityProvider: DEPLOYMENT_IDENTITY_PROVIDER });
  await durable.putPlan(plan);
  const step = plan.steps.find((entry) => entry.capability_key === "unsupported_capability_execute");
  assert.ok(step);
  assert.equal(step.unsupported_capability_hash, capability.capability_hash);
  const challenge = await createApprovalChallenge({ plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id }, { recoveryStore: durable, deploymentIdentityProvider: DEPLOYMENT_IDENTITY_PROVIDER });
  const ticket = await storeExecutionTicket(durable, plan, step, "plan-bound-unsupported-idempotency-001");
  await assert.rejects(
    () => executeRemediationStep({ plan_id: plan.plan_id, plan_hash: plan.plan_hash, step_id: step.step_id, approval_token: "plan-bound-approval-token-001", execution_ticket_id: ticket.ticket_id, idempotency_key: "plan-bound-unsupported-idempotency-001" }, {
      env: { ...ENV, RECOVERY_MUTATIONS_ENABLED: "true" },
      adminPrincipal: { verified: true, binding: "test_admin_guard" },
      approvalVerifier: { verify: async ({ approval }) => approval.approval_id === challenge.approval_id },
      recoveryLock: { acquire: async () => ({ acquired: true, lock_id: "unsupported-test-lock", lease_id: "lease:unsupported-test-001", fencing_token: "fence:unsupported-test-001", expires_at: new Date(Date.now() + 600000).toISOString() }), heartbeat: async () => ({ renewed: true }), assertFence: async () => ({ valid: true }), release: async () => {} },
      readbackVerifier: { verify: async () => ({ postconditions_passed: true, behavioral_probe_passed: true }) },
      recoveryStore: durable,
    deploymentIdentityProvider: DEPLOYMENT_IDENTITY_PROVIDER,
    }),
    (error) => error?.code === "UNSUPPORTED_BROKER_UNAVAILABLE",
  );
  const run = [...durable.runs.values()].at(-1);
  assert.ok(run.events.some((event) => event.phase === "executing"));
  assert.equal(run.evidence.database_mutation_performed, undefined);
});
