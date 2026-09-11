// frontend-surface-operation: post /admin/recovery/kernel/execute-approved
// frontend-surface-operation: post /admin/recovery/kernel/approval-challenge
// frontend-surface-operation: post /admin/recovery/kernel/execute
// frontend-surface-operation: get /admin/recovery/kernel/runs/{run_id}
// frontend-surface-operation: get /admin/recovery/kernel/evidence/{run_id}

import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import { buildRecoveryKernelRoutes } from "./routes/recoveryKernelRoutes.js";

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function postJson(baseUrl, body, pathname = "/admin/recovery/kernel/execute-approved") {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function getJson(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  return { status: response.status, body: await response.json() };
}

const PLAN_ID = "plan:1234567890abcdef";
const PLAN_HASH = "a".repeat(64);
const STEP_ID = "step:1234567890abcdef";
const EXACT_SHA = "b".repeat(40);
const PLAN = {
  plan_id: PLAN_ID,
  plan_hash: PLAN_HASH,
  expected_sha: EXACT_SHA,
  expected_sha_at_creation: EXACT_SHA,
  target_key: "production-runtime",
  target_fingerprint: "c".repeat(64),
  target_fingerprint_at_creation: "c".repeat(64),
  manifest_hash: "e".repeat(64),
  role_selection_hash: null,
  proof: { manifest_bound: true, unknown_drift: false, preconditions_satisfied: true, role_selection_provenance_bound: true },
  steps: [{
    step_id: STEP_ID,
    step_hash: "d".repeat(64),
    consequential: true,
    approval_required: true,
    capability_key: "runtime.baseline.rebuild_empty",
    target_role: "runtime",
    mutation_class: "C5",
  }],
};

function readyEvidenceStore(overrides = {}) {
  const runs = new Map();
  const plans = new Map();
  const findings = new Map();
  const receipts = new Map();
  return {
    recovery_store_contract: "mad4b.recovery-durable-store.v1",
    independent_of_target_databases: true,
    target_database_binding: "forbidden",
    shared_replica_safe: true,
    schema_auto_apply: false,
    payload_integrity_verified_on_read: true,
    provider_accessed: false,
    async getReadiness() {
      return {
        contract: "mad4b.recovery-control-store-readiness.v1",
        ready: true,
        scope: "durable_inspection",
        database_mutation_performed: false,
        schema_auto_apply: false,
        secrets_included: false,
      };
    },
    async putRun(run) { runs.set(run.run_id, structuredClone(run)); },
    async getRun(runId) { return runs.get(runId) ? structuredClone(runs.get(runId)) : null; },
    async putPlan(plan) { plans.set(plan.plan_id, structuredClone(plan)); },
    async getPlan(planId) { return plans.get(planId) ? structuredClone(plans.get(planId)) : null; },
    async putFinding(finding) { findings.set(finding.finding_id, structuredClone(finding)); },
    async getFinding(findingId) { return findings.get(findingId) ? structuredClone(findings.get(findingId)) : null; },
    async getRunByIdempotency(idempotencyKey) { return receipts.get(idempotencyKey) || null; },
    async appendEvidenceEvent() {},
    async putIdempotencyReceipt(idempotencyKey, receipt) { receipts.set(idempotencyKey, structuredClone(receipt)); },
    ...overrides,
  };
}

function readyMutationStore(overrides = {}) {
  return {
    ...readyEvidenceStore(),
    async claimExecution() { return { claimed: true, claim_id: "claim:route-fixture" }; },
    async releaseExecutionClaim() {},
    async reserveApproval() { return { reserved: true }; },
    async releaseApprovalReservation() { return { released: true }; },
    async getExecutionTicket() { return null; },
    async putExecutionTicket() {},
    async reserveExecutionTicket() { return { reserved: true }; },
    async releaseExecutionTicket() { return { released: true }; },
    async finalizeExecutionTicket() { return { finalized: true }; },
    async markApprovalUsed() { return { finalized: true }; },
    executionTicketVerifier: { verify: async () => true },
    ...overrides,
  };
}

function buildTestApp({ recoveryStore, readOnlyRecoveryStore, mutationRecoveryStore, approvalIssuer, approvalStore, mutationExecutor } = {}) {
  const app = express();
  app.use(express.json());
  const routeOptions = {
    requireBackendApiKey: (_req, _res, next) => next(),
    requireAdminPrincipal: (req, _res, next) => {
      req.auth = { is_admin: true };
      next();
    },
    env: { NODE_ENV: "production" },
    recoveryStore,
    approvalIssuer,
    approvalStore,
    mutationExecutor,
  };
  if (readOnlyRecoveryStore !== undefined) routeOptions.readOnlyRecoveryStore = readOnlyRecoveryStore;
  if (mutationRecoveryStore !== undefined) routeOptions.mutationRecoveryStore = mutationRecoveryStore;
  app.use(buildRecoveryKernelRoutes(routeOptions));
  return app;
}

function validLegacyBody() {
  return {
    plan_id: PLAN_ID,
    plan_hash: PLAN_HASH,
    step_id: STEP_ID,
    approval_token: "bound-approval-token-route-test",
    idempotency_key: "idempotency:route-test-001",
  };
}

function validServerBody() {
  const challengeRef = "approval:1234567890abcdef";
  return {
    plan_id: PLAN_ID,
    plan_hash: PLAN_HASH,
    step_id: STEP_ID,
    approval_id: challengeRef,
    expected_sha: EXACT_SHA,
    typed_confirmation: `APPROVE PRODUCTION RECOVERY ${challengeRef} ${STEP_ID} ${EXACT_SHA}`,
    idempotency_key: "idempotency:route-test-server-001",
  };
}

test("private bridge route rejects caller-generated ticket fields and accepts only bounded approval modes", async () => {
  const app = buildTestApp({ recoveryStore: { getPlan: async () => PLAN } });
  const { server, baseUrl } = await startServer(app);
  try {
    const extraFieldResponse = await postJson(baseUrl, { ...validLegacyBody(), execution_ticket_id: "ticket:caller-made" });
    assert.equal(extraFieldResponse.status, 400);
    assert.equal(extraFieldResponse.body.error.code, "recovery_kernel_input_field_forbidden");

    const missingApproval = validLegacyBody();
    delete missingApproval.approval_token;
    const missingResponse = await postJson(baseUrl, missingApproval);
    assert.equal(missingResponse.status, 400);
    assert.equal(missingResponse.body.error.code, "recovery_action_bridge_server_approval_required");

    const serverModeResponse = await postJson(baseUrl, validServerBody());
    assert.equal(serverModeResponse.status, 503);
    assert.equal(serverModeResponse.body.error.code, "recovery_action_bridge_authority_unavailable");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("approval challenge returns exact typed-confirmation requirements without token or ticket material", async () => {
  let issuerCalls = 0;
  const mutationStore = readyMutationStore({
    getPlan: async () => PLAN,
    putApproval: async () => ({ persisted: true }),
    getApprovalByPlanStep: async () => null,
  });
  const app = buildTestApp({
    recoveryStore: mutationStore,
    approvalIssuer: { createChallenge: async () => { issuerCalls += 1; return { delivery_ref: "approval-delivery:test" }; } },
    approvalStore: {
      putChallenge: async () => ({ persisted: true }),
      getChallenge: async () => null,
    },
  });
  const { server, baseUrl } = await startServer(app);
  try {
    const response = await postJson(baseUrl, {
      plan_id: PLAN_ID,
      plan_hash: PLAN_HASH,
      step_id: STEP_ID,
    }, "/admin/recovery/kernel/approval-challenge");
    assert.equal(response.status, 201);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.approval_token_not_returned, true);
    assert.equal(response.body.execution_ticket_not_returned, true);
    assert.equal(response.body.result.confirmation_required, true);
    assert.equal(response.body.result.confirmation_requirements.expected_sha, EXACT_SHA);
    assert.equal(response.body.result.confirmation_requirements.step_id, STEP_ID);
    assert.match(response.body.result.confirmation_requirements.confirmation_phrase, /^APPROVE PRODUCTION RECOVERY approval:/u);
    assert.equal(response.body.result.confirmation_requirements.case_sensitive, true);
    assert.equal(Object.hasOwn(response.body.result, "approval_token"), false);
    assert.equal(Object.hasOwn(response.body.result, "execution_ticket_id"), false);
    assert.equal(Object.hasOwn(response.body.result, "execution_ticket_hash"), false);
    assert.equal(issuerCalls, 1);

    const extraField = await postJson(baseUrl, {
      plan_id: PLAN_ID,
      plan_hash: PLAN_HASH,
      step_id: STEP_ID,
      approval_token: "must-not-be-accepted",
    }, "/admin/recovery/kernel/approval-challenge");
    assert.equal(extraField.status, 400);
    assert.equal(extraField.body.error.code, "recovery_kernel_input_field_forbidden");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("approval challenge cannot fall back to read-only evidence authority", async () => {
  let evidenceStoreCalls = 0;
  let issuerCalls = 0;
  const evidenceStore = {
    getPlan: async () => { evidenceStoreCalls += 1; return PLAN; },
    putApproval: async () => { evidenceStoreCalls += 1; return { persisted: true }; },
    getApprovalByPlanStep: async () => { evidenceStoreCalls += 1; return null; },
  };
  const app = buildTestApp({
    recoveryStore: evidenceStore,
    readOnlyRecoveryStore: evidenceStore,
    mutationRecoveryStore: null,
    approvalIssuer: { createChallenge: async () => { issuerCalls += 1; return { delivery_ref: "must-not-issue" }; } },
    approvalStore: {
      putChallenge: async () => ({ persisted: true }),
      getChallenge: async () => null,
    },
  });
  const { server, baseUrl } = await startServer(app);
  try {
    const response = await postJson(baseUrl, {
      plan_id: PLAN_ID,
      plan_hash: PLAN_HASH,
      step_id: STEP_ID,
    }, "/admin/recovery/kernel/approval-challenge");
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, "RECOVERY_APPROVAL_CHALLENGE_AUTHORITY_UNAVAILABLE");
    assert.equal(response.body.database_mutation_performed, false);
    assert.equal(response.body.secrets_included, false);
    assert.equal(evidenceStoreCalls, 0, "approval issuance must not read or mutate through the evidence-only store");
    assert.equal(issuerCalls, 0, "approval issuer must not run without mutation-grade Recovery store authority");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("historical execute alias uses the same server-issued bridge and fails closed before provider", async () => {
  let providerCalls = 0;
  const app = buildTestApp({
    recoveryStore: { getPlan: async () => PLAN },
    mutationExecutor: { execute: async () => { providerCalls += 1; return { database_mutation_performed: true }; } },
  });
  const { server, baseUrl } = await startServer(app);
  try {
    const response = await postJson(baseUrl, validLegacyBody(), "/admin/recovery/kernel/execute");
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, "recovery_action_bridge_authority_unavailable");
    assert.equal(providerCalls, 0);
    assert.equal(response.body.database_mutation_performed, false);
    assert.equal(response.body.secrets_included, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("explicit route store boundary preserves evidence reads while denying execution when mutation store is null", async () => {
  let evidenceReads = 0;
  let providerCalls = 0;
  const evidenceStore = readyEvidenceStore({
    getRun: async (runId) => {
      evidenceReads += 1;
      return {
        run_id: runId,
        state: "failed_closed",
        findings: [],
        evidence: [],
        secrets_included: false,
      };
    },
  });
  const app = buildTestApp({
    recoveryStore: evidenceStore,
    readOnlyRecoveryStore: evidenceStore,
    mutationRecoveryStore: null,
    mutationExecutor: { execute: async () => { providerCalls += 1; return { database_mutation_performed: true }; } },
  });
  const { server, baseUrl } = await startServer(app);
  try {
    const runRead = await getJson(baseUrl, "/admin/recovery/kernel/runs/run:1234567890abcdef");
    assert.equal(runRead.status, 200);
    assert.equal(runRead.body.run_id, "run:1234567890abcdef");
    assert.equal(evidenceReads, 1);

    const execute = await postJson(baseUrl, validServerBody());
    assert.equal(execute.status, 503);
    assert.equal(execute.body.error.code, "recovery_action_bridge_authority_unavailable");
    assert.equal(providerCalls, 0);
    assert.equal(execute.body.database_mutation_performed, false);
    assert.equal(execute.body.secrets_included, false);
    assert.equal(evidenceReads, 1, "execution must not fall back to the read-only evidence store");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

console.log("recovery kernel route contract tests loaded");
