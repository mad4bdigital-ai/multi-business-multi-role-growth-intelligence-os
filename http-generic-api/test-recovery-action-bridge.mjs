import assert from "node:assert/strict";
import test from "node:test";
import { buildRecoveryTypedConfirmationRequirements, issueAndExecuteApprovedRecoveryStep } from "./recoveryActionBridge.js";
import { deriveRoleTargetFingerprints } from "./recoveryKernel.js";

const PLAN_ID = "plan:1234567890abcdef";
const PLAN_HASH = "a".repeat(64);
const STEP_ID = "step:1234567890abcdef";
const STEP_HASH = "b".repeat(64);
const SHA = "c".repeat(40);
const CHALLENGE_REF = "approval:1234567890abcdef";
const FIXTURE_VALUE = "bound-approval-token-bridge-001";
const IDEMPOTENCY_KEY = "idempotency:bridge-001";

function baseInput(overrides = {}) {
  return {
    plan_id: PLAN_ID,
    plan_hash: PLAN_HASH,
    step_id: STEP_ID,
    approval_token: FIXTURE_VALUE,
    idempotency_key: IDEMPOTENCY_KEY,
    ...overrides,
  };
}

function confirmationRequirements() {
  return buildRecoveryTypedConfirmationRequirements({
    approval_id: CHALLENGE_REF,
    plan_hash: PLAN_HASH,
    step_id: STEP_ID,
    expected_sha: SHA,
  });
}

function serverManagedInput(overrides = {}) {
  const confirmation = confirmationRequirements();
  return {
    plan_id: PLAN_ID,
    plan_hash: PLAN_HASH,
    step_id: STEP_ID,
    approval_id: CHALLENGE_REF,
    expected_sha: SHA,
    typed_confirmation: confirmation.confirmation_phrase,
    idempotency_key: "idempotency:bridge-server-managed-001",
    ...overrides,
  };
}

function makeStore() {
  const targetFingerprint = deriveRoleTargetFingerprints({ env: ENV }).runtime;
  const tickets = new Map();
  const ticketStates = new Map();
  const runs = new Map();
  const receipts = new Map();
  const findings = new Map([["finding:1234567890abcdef", { finding_id: "finding:1234567890abcdef" }]]);
  const approval = {
    approval_id: CHALLENGE_REF,
    plan_id: PLAN_ID,
    plan_hash: PLAN_HASH,
    step_id: STEP_ID,
    step_hash: STEP_HASH,
    expected_sha: SHA,
    target_key: "production-runtime",
    target_fingerprint: targetFingerprint,
    composite_target_fingerprint: targetFingerprint,
    step_target_fingerprint: targetFingerprint,
    target_role: "runtime",
    approval_version: "v1",
    challenge_hash: "9".repeat(64),
    expires_at: new Date(Date.now() + 600000).toISOString(),
    used: false,
  };
  const plan = {
    contract: "mad4b.recovery-remediation-plan.v1",
    plan_id: PLAN_ID,
    plan_hash: PLAN_HASH,
    expected_sha: SHA,
    expected_sha_at_creation: SHA,
    target_key: "production-runtime",
    target_fingerprint: targetFingerprint,
    target_fingerprint_at_creation: targetFingerprint,
    target_fingerprints: { composite: targetFingerprint, runtime: targetFingerprint },
    manifest_hash: "e".repeat(64),
    finding_ids: ["finding:1234567890abcdef"],
    role_selection_hash: null,
    proof: {
      manifest_bound: true,
      unknown_drift: false,
      preconditions_satisfied: true,
      role_selection_provenance_bound: true,
    },
    steps: [{
      step_id: STEP_ID,
      step_hash: STEP_HASH,
      consequential: true,
      capability_key: "governance.mcp_catalog.repair",
      operation: "apply_migration",
      target_role: "runtime",
      ownership_domain: "governance",
      database_target_role: "runtime",
      authority_ref: "20260815_custom_gpt_mcp_catalog_levels.sql",
      target_fingerprint: targetFingerprint,
      mutation_class: "C3",
    }],
  };
  return {
    recovery_store_contract: "mad4b.recovery-durable-store.v1",
    independent_of_target_databases: true,
    target_database_binding: "forbidden",
    provider_accessed: false,
    executionTicketVerifier: {
      verify: async ({ ticket_hash, ticket }) => ticket.signature === `sig:${ticket_hash}`,
    },
    async getRun(id) { return runs.get(id) ? structuredClone(runs.get(id)) : null; },
    async putPlan() {},
    async getPlan(id) { return id === PLAN_ID ? structuredClone(plan) : null; },
    async putFinding(finding) { findings.set(finding.finding_id, structuredClone(finding)); },
    async getFinding(id) { return findings.get(id) ? structuredClone(findings.get(id)) : null; },
    async getRunByIdempotency(id) { return receipts.get(id) || null; },
    async getExecutionTicket(id) { return tickets.get(id) || null; },
    async putExecutionTicket(ticket) {
      tickets.set(ticket.ticket_id, structuredClone(ticket));
      ticketStates.set(ticket.ticket_id, { status: "issued", ticket_hash: ticket.ticket_hash });
    },
    async claimExecution() { return { claimed: true, claim_id: "claim:bridge-001" }; },
    async releaseExecutionClaim() {},
    async getApprovalByPlanStep() { return structuredClone(approval); },
    async resolveApprovedExecutionApproval({ approval_id, admin_principal_verified }) {
      return approval_id === CHALLENGE_REF && admin_principal_verified === true ? { approval_token: FIXTURE_VALUE } : null;
    },
    async reserveApproval() { return { reserved: true }; },
    async releaseApprovalReservation() { return { released: true }; },
    async reserveExecutionTicket(context) {
      const state = ticketStates.get(context.ticket_id);
      if (!state || state.ticket_hash !== context.ticket_hash || state.status !== "issued") return { reserved: false };
      ticketStates.set(context.ticket_id, { ...state, ...context, status: "reserved" });
      return { reserved: true };
    },
    async releaseExecutionTicket() { return { released: true }; },
    async finalizeExecutionTicket(context) {
      const state = ticketStates.get(context.ticket_id);
      if (!state || state.ticket_hash !== context.ticket_hash) return { finalized: false };
      ticketStates.set(context.ticket_id, { ...state, status: "finalized" });
      return { finalized: true };
    },
    async markApprovalUsed() { return { finalized: true }; },
    async appendEvidenceEvent(runId, event) {
      const run = runs.get(runId) || { run_id: runId, events: [] };
      run.events = [...run.events, structuredClone(event)];
      runs.set(runId, run);
    },
    async putRun(run) { runs.set(run.run_id, structuredClone(run)); },
    async putIdempotencyReceipt(id, receipt) { receipts.set(id, structuredClone(receipt)); },
    _testing: { tickets, ticketStates, runs, receipts, plan, approval },
  };
}

const ENV = {
  NODE_ENV: "production",
  GITHUB_REF_NAME: "Production",
  GITHUB_SHA: SHA,
  GITHUB_REPOSITORY: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
  RECOVERY_MUTATIONS_ENABLED: "true",
  DEPLOYMENT_MANIFEST_JSON: JSON.stringify({
    repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    branch: "Production",
    commit_sha: SHA,
    source: "bridge_test_fixture",
    secrets_included: false,
  }),
};

const BRIDGE_TARGET_FINGERPRINT = deriveRoleTargetFingerprints({ env: ENV }).runtime;
const DEPLOYMENT_IDENTITY_PROVIDER = {
  readAttestation: async () => ({
    contract: "mad4b.recovery-runtime-attestation.v1",
    deployment_identity_contract: "mad4b.recovery-deployment-identity-attestation.v1",
    repository: ENV.GITHUB_REPOSITORY,
    branch: "Production",
    repository_sha: SHA,
    deployment_sha: SHA,
    recovery_manifest_hash: "e".repeat(64),
    manifest_bound: true,
    read_only_probe: true,
    attestation_hash: "f".repeat(64),
    target_fingerprint: BRIDGE_TARGET_FINGERPRINT,
    target_fingerprints: { composite: BRIDGE_TARGET_FINGERPRINT, governance: BRIDGE_TARGET_FINGERPRINT },
    database_connection_performed: false,
    database_mutation_performed: false,
    provider_mutation_performed: false,
    secrets_included: false,
  }),
};
const SIGNER = { sign: async ({ ticket_hash }) => `sig:${ticket_hash}` };
const LOCK = {
  acquire: async () => ({ acquired: true, lease_id: "lease:bridge-001", fencing_token: "fence:bridge-001", expires_at: new Date(Date.now() + 600000).toISOString() }),
  heartbeat: async () => ({ renewed: true }),
  assertFence: async () => ({ valid: true }),
  release: async () => {},
};
const APPROVAL_VERIFIER = { verify: async ({ token }) => token === FIXTURE_VALUE };
const APPROVAL_ISSUER = {
  resolveApprovedExecutionApproval: async ({ approval_id, admin_principal_verified }) => (
    approval_id === CHALLENGE_REF && admin_principal_verified === true ? { approval_token: FIXTURE_VALUE } : null
  ),
};
const READBACK = { independent_authority: true, role_aware: true, verify: async () => ({ postconditions_passed: true, structural_postconditions_passed: true, data_postconditions_passed: true, behavioral_probe_passed: true }) };
const MIGRATION_LEDGER = { contract: "mad4b.governance-migration-ledger.v1", finalize: async () => ({ finalized: true }) };

function authorities(store, executor) {
  return {
    env: ENV,
    adminPrincipal: { verified: true },
    deploymentIdentityProvider: DEPLOYMENT_IDENTITY_PROVIDER,
    recoveryStore: store,
    executionTicketSigner: SIGNER,
    approvalIssuer: APPROVAL_ISSUER,
    approvalVerifier: APPROVAL_VERIFIER,
    approvalStore: store,
    recoveryLock: LOCK,
    readbackVerifier: READBACK,
    hostBreakglassMutationExecutor: executor,
    migrationLedger: MIGRATION_LEDGER,
  };
}

test("bridge rejects caller-generated ticket references before authority resolution", async () => {
  await assert.rejects(
    issueAndExecuteApprovedRecoveryStep(baseInput({ execution_ticket_id: "ticket:caller-made" }), { adminPrincipal: { verified: true } }),
    (error) => error.code === "recovery_action_bridge_caller_ticket_forbidden" && error.status === 400,
  );
});

test("bridge fails closed before executor when the default composition has no authorities", async () => {
  let executorCalls = 0;
  await assert.rejects(
    issueAndExecuteApprovedRecoveryStep(baseInput(), {
      env: ENV,
      adminPrincipal: { verified: true },
      hostBreakglassMutationExecutor: async () => { executorCalls += 1; },
    }),
    (error) => error.code === "recovery_action_bridge_authority_unavailable" && error.status === 503,
  );
  assert.equal(executorCalls, 0);
});

test("bridge requires fenced lock and same-cycle readback authority before issuing a ticket", async () => {
  const store = makeStore();
  let executorCalls = 0;
  const deps = authorities(store, { execute: async () => { executorCalls += 1; } });
  const missingReadback = { ...deps, readbackVerifier: null };
  await assert.rejects(
    issueAndExecuteApprovedRecoveryStep(baseInput({ idempotency_key: "idempotency:bridge-missing-readback" }), missingReadback),
    (error) => error.code === "recovery_action_bridge_authority_unavailable" && error.status === 503,
  );
  const missingFence = { ...deps, recoveryLock: { acquire: LOCK.acquire, heartbeat: LOCK.heartbeat, release: LOCK.release } };
  await assert.rejects(
    issueAndExecuteApprovedRecoveryStep(baseInput({ idempotency_key: "idempotency:bridge-missing-fence" }), missingFence),
    (error) => error.code === "recovery_action_bridge_authority_unavailable" && error.status === 503,
  );
  assert.equal(executorCalls, 0);
  assert.equal(store._testing.tickets.size, 0);
});

test("legacy bridge still issues a server-side execution ticket without returning it", async () => {
  const store = makeStore();
  let forwarded = null;
  const executor = {
    execute: async (payload) => {
      forwarded = payload;
      return { status: "host_breakglass_test_handoff", database_mutation_performed: false, secrets_included: false };
    },
  };
  const result = await issueAndExecuteApprovedRecoveryStep(baseInput(), authorities(store, executor));
  assert.equal(result.ok, true);
  assert.equal(result.contract, "mad4b.recovery-action-bridge.v2");
  assert.equal(result.approval_mode, "caller_token_legacy");
  assert.equal(result.approval_token_returned, false);
  assert.equal(result.server_issued_execution_ticket, true);
  assert.equal(result.execution_ticket_forwarded_internally, true);
  assert.equal(result.execution_ticket_returned, false);
  assert.equal(Object.hasOwn(result, "execution_ticket_id"), false);
  assert.equal(Object.hasOwn(result, "execution_ticket_hash"), false);
  assert.equal(JSON.stringify(result).includes("signature"), false);
  assert.equal(typeof forwarded.execution_ticket_id, "string");
  assert.equal(typeof forwarded.execution_ticket_hash, "string");
  assert.equal(store._testing.tickets.size, 1);
  assert.equal(store._testing.ticketStates.values().next().value.status, "finalized");

  const replay = await issueAndExecuteApprovedRecoveryStep(baseInput(), authorities(store, {
    execute: async () => { throw new Error("replay must not reach Host Breakglass"); },
  }));
  assert.equal(replay.execution.idempotent_replay, true);
  assert.equal(store._testing.tickets.size, 1);
});

test("Admin GPT typed confirmation resolves approval material only inside the server", async () => {
  const store = makeStore();
  let forwarded = null;
  const result = await issueAndExecuteApprovedRecoveryStep(serverManagedInput(), authorities(store, {
    execute: async (payload) => {
      forwarded = payload;
      return { status: "host_breakglass_server_approved_handoff", database_mutation_performed: false, secrets_included: false };
    },
  }));
  assert.equal(result.ok, true);
  assert.equal(result.contract, "mad4b.recovery-action-bridge.v2");
  assert.equal(result.approval_mode, "server_managed_confirmation");
  assert.equal(result.confirmation_transport, "explicit_v2_fields");
  assert.equal(result.approval_material_resolved_server_side, true);
  assert.equal(result.approval_token_returned, false);
  assert.equal(JSON.stringify(result).includes(FIXTURE_VALUE), false);
  assert.equal(typeof forwarded.execution_ticket_id, "string");
  assert.equal(store._testing.tickets.size, 1);
});

test("published legacy approval_token schema can transport the typed phrase without exposing a token", async () => {
  const store = makeStore();
  const confirmation = confirmationRequirements();
  let forwarded = null;
  const deps = authorities(store, {
    execute: async (payload) => {
      forwarded = payload;
      return { status: "host_breakglass_legacy_schema_confirmation_handoff", database_mutation_performed: false, secrets_included: false };
    },
  });
  deps.approvalIssuer = null;
  const result = await issueAndExecuteApprovedRecoveryStep({
    plan_id: PLAN_ID,
    plan_hash: PLAN_HASH,
    step_id: STEP_ID,
    approval_token: confirmation.confirmation_phrase,
    idempotency_key: "idempotency:bridge-legacy-schema-confirmation-001",
  }, deps);
  assert.equal(result.ok, true);
  assert.equal(result.approval_mode, "server_managed_confirmation");
  assert.equal(result.confirmation_transport, "legacy_schema_field");
  assert.equal(result.approval_material_resolved_server_side, true);
  assert.equal(result.approval_token_returned, false);
  assert.equal(JSON.stringify(result).includes(FIXTURE_VALUE), false);
  assert.equal(JSON.stringify(result).includes(confirmation.confirmation_phrase), false);
  assert.equal(typeof forwarded.execution_ticket_id, "string");
  assert.equal(store._testing.tickets.size, 1);
});

test("typed confirmation is exact, SHA-bound, and fails before ticket or executor", async () => {
  const store = makeStore();
  let executorCalls = 0;
  await assert.rejects(
    issueAndExecuteApprovedRecoveryStep(serverManagedInput({ typed_confirmation: "APPROVE SOMETHING ELSE", idempotency_key: "idempotency:bridge-server-reject" }), authorities(store, {
      execute: async () => { executorCalls += 1; },
    })),
    (error) => error.code === "recovery_action_bridge_typed_confirmation_invalid" && error.status === 401,
  );
  assert.equal(executorCalls, 0);
  assert.equal(store._testing.tickets.size, 0);
});

console.log("recovery action bridge contract tests loaded");
