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

function buildTestApp({ recoveryStore, approvalIssuer, approvalStore, mutationExecutor } = {}) {
  const app = express();
  app.use(express.json());
  app.use(buildRecoveryKernelRoutes({
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
  }));
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
  const app = buildTestApp({
    recoveryStore: {
      getPlan: async () => PLAN,
      putApproval: async () => ({ persisted: true }),
      getApprovalByPlanStep: async () => null,
    },
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

console.log("recovery kernel route contract tests loaded");
