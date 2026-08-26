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

async function postJson(baseUrl, body) {
  const response = await fetch(`${baseUrl}/admin/recovery/kernel/execute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const PLAN_ID = "plan:1234567890abcdef";
const PLAN_HASH = "a".repeat(64);
const STEP_ID = "step:1234567890abcdef";
const TICKET_ID = "ticket:bootstrap-route-test";
const PLAN = {
  plan_id: PLAN_ID,
  plan_hash: PLAN_HASH,
  expected_sha: "b".repeat(40),
  expected_sha_at_creation: "b".repeat(40),
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
    capability_key: "runtime.baseline.rebuild_empty",
    target_role: "runtime",
    mutation_class: "C5",
  }],
};

function buildTestApp({ recoveryStore, mutationExecutor } = {}) {
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
    mutationExecutor,
  }));
  return app;
}

function validBody() {
  return {
    plan_id: PLAN_ID,
    plan_hash: PLAN_HASH,
    step_id: STEP_ID,
    approval_token: "bound-approval-token-route-test",
    idempotency_key: "idempotency:route-test-001",
    execution_ticket_id: TICKET_ID,
  };
}

test("private execute route requires the ticket reference and rejects fields outside the fixed contract", async () => {
  const app = buildTestApp({ recoveryStore: { getPlan: async () => PLAN } });
  const { server, baseUrl } = await startServer(app);
  try {
    const missingTicket = validBody();
    delete missingTicket.execution_ticket_id;
    const missingResponse = await postJson(baseUrl, missingTicket);
    assert.equal(missingResponse.status, 400);
    assert.equal(missingResponse.body.error.code, "recovery_kernel_required_field_missing");

    const extraFieldResponse = await postJson(baseUrl, { ...validBody(), execution_ticket_hash: "e".repeat(64) });
    assert.equal(extraFieldResponse.status, 400);
    assert.equal(extraFieldResponse.body.error.code, "recovery_kernel_input_field_forbidden");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("private execute route accepts the ticket ID field but default dependency wiring fails closed before provider", async () => {
  let providerCalls = 0;
  const app = buildTestApp({
    recoveryStore: { getPlan: async () => PLAN },
    mutationExecutor: { execute: async () => { providerCalls += 1; return { database_mutation_performed: true }; } },
  });
  const { server, baseUrl } = await startServer(app);
  try {
    const response = await postJson(baseUrl, validBody());
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, "RECOVERY_MUTATION_STORE_UNAVAILABLE");
    assert.equal(providerCalls, 0);
    assert.equal(response.body.database_mutation_performed, false);
    assert.equal(response.body.secrets_included, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

console.log("recovery kernel route contract tests loaded");
