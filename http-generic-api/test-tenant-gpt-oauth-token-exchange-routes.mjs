import assert from "node:assert/strict";
import express from "express";
import { TENANT_GPT_OAUTH_CLIENT_ID } from "./tenantGptOAuthPreset.js";
import { buildTenantGptOAuthMetadataRoutes } from "./routes/tenantGptOAuthMetadataRoutes.js";
import { buildTenantGptOAuthTokenExchangeRoutes } from "./routes/tenantGptOAuthTokenExchangeRoutes.js";

const RESOURCE = "https://activation.mad4b.com";
const CALLBACK = "https://chatgpt.com/aip/g-route-test/oauth/callback";
const RAW_CODE = "raw-authorization-code-sensitive";
const CLIENT_SECRET = "client-secret-sensitive";
const BASE_BODY = Object.freeze({
  grant_type: "authorization_code",
  code: RAW_CODE,
  redirect_uri: CALLBACK,
  client_id: TENANT_GPT_OAUTH_CLIENT_ID,
  client_secret: CLIENT_SECRET,
});
const CODE_PAYLOAD = Object.freeze({
  purpose: "custom_gpt_oauth_code",
  jti: "oauth-code-jti-sensitive",
  user_id: "user-1",
  tenant_id: "tenant-1",
  redirect_uri: CALLBACK,
  client_id: TENANT_GPT_OAUTH_CLIENT_ID,
  resource: RESOURCE,
  scope: "https://auth.mad4b.com/scopes/tenant.activation",
  activation_context: { purpose: "tenant_activation", activation_mode: "managed" },
});

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function postForm(baseUrl, body = BASE_BODY, { headers = {} } = {}) {
  const response = await fetch(`${baseUrl}/auth/oauth/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-host": "activation.mad4b.com",
      cookie: "must-not-cross-token-boundary=1",
      ...headers,
    },
    body: new URLSearchParams(body).toString(),
  });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { parse_error: true, text }; }
  return { status: response.status, headers: response.headers, body: parsed };
}

function requestIds() {
  let count = 0;
  return () => `00000000-0000-4000-8000-${String(++count).padStart(12, "0")}`;
}

function createHarness(overrides = {}, { metadataMount = false } = {}) {
  const order = [];
  const diagnostics = [];
  const issuance = [];
  const activationContexts = [];
  let legacyReached = false;
  const pool = {
    async query(sql, params = []) {
      if (String(sql).includes("INSERT INTO `execution_log`")) {
        diagnostics.push({ sql, params });
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected route query: ${sql}`);
    },
  };
  const deps = {
    getPool: () => pool,
    randomUUID: requestIds(),
    now: () => Date.parse("2026-08-04T00:30:00.000Z"),
    validateClientCredentials: async (credentials) => {
      order.push("client");
      assert.equal(credentials.client_id, TENANT_GPT_OAUTH_CLIENT_ID);
      assert.equal(credentials.client_secret, CLIENT_SECRET);
      return {
        ok: true,
        source: "test",
        client_id: TENANT_GPT_OAUTH_CLIENT_ID,
        client_secret_required: true,
      };
    },
    verifyCode: () => {
      order.push("verify");
      return { ...CODE_PAYLOAD };
    },
    resolveActiveSubject: async () => {
      order.push("subject");
      return {
        ok: true,
        user: { user_id: "user-1", email: "user@example.com", status: "active" },
        tenant_id: "tenant-1",
        secrets_included: false,
      };
    },
    issueAccessToken: (payload, options) => {
      order.push("issue");
      assert.equal(payload.user_id, "user-1");
      assert.equal(payload.tenant_id, "tenant-1");
      assert.equal(options.resource, RESOURCE);
      issuance.push({ payload, options });
      return "access-token-safe-test";
    },
    consumeCode: async () => {
      order.push("consume");
      return {
        consumed: true,
        outcome: "consumed",
        table_recovered: false,
        replay_allowed: false,
        secrets_included: false,
      };
    },
    recordActivationContext: async (input) => {
      order.push("context");
      activationContexts.push(input);
      return { ok: true, stored: true, source: "test", secrets_included: false };
    },
    ...overrides,
  };

  const app = express();
  if (metadataMount) {
    app.use(buildTenantGptOAuthMetadataRoutes(deps));
  } else {
    app.use(buildTenantGptOAuthTokenExchangeRoutes(deps));
  }
  app.post("/auth/oauth/token", (_req, res) => {
    legacyReached = true;
    res.status(599).json({ error: "legacy_route_reached" });
  });
  return {
    app,
    deps,
    order,
    diagnostics,
    issuance,
    activationContexts,
    legacyReached: () => legacyReached,
  };
}

async function runScenario(harness, body = BASE_BODY, options = {}) {
  const { server, baseUrl } = await startServer(harness.app);
  try {
    const result = await postForm(baseUrl, body, options);
    await new Promise((resolve) => setTimeout(resolve, 5));
    return result;
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function diagnosticEvidence(harness) {
  return harness.diagnostics.map(({ params }) => JSON.parse(params.at(-1)));
}

const successHarness = createHarness({}, { metadataMount: true });
const success = await runScenario(successHarness);
assert.equal(success.status, 200);
assert.deepEqual(success.body, {
  access_token: "access-token-safe-test",
  token_type: "bearer",
  expires_in: 3600,
  scope: CODE_PAYLOAD.scope,
});
assert.equal(success.headers.get("cache-control"), "no-store");
assert.equal(success.headers.get("pragma"), "no-cache");
assert.match(success.headers.get("x-request-id") || "", /^[0-9a-f-]{36}$/i);
assert.equal(successHarness.legacyReached(), false);
assert.equal(successHarness.order.indexOf("subject") < successHarness.order.indexOf("issue"), true);
assert.equal(successHarness.order.indexOf("issue") < successHarness.order.indexOf("consume"), true);
assert.equal(successHarness.order.indexOf("consume") < successHarness.order.indexOf("context"), true);
assert.equal(successHarness.issuance.length, 1);
assert.equal(successHarness.issuance[0].options.expiresIn, 3600);
assert.equal(successHarness.activationContexts.length, 1);
assert.equal(
  new Date(successHarness.activationContexts[0].expires_at).toISOString(),
  "2026-08-04T01:30:00.000Z",
);
const successEvidence = diagnosticEvidence(successHarness)
  .filter((entry) => entry.classification === "token_response_committed");
assert.equal(successEvidence.length, 1, "success must create exactly one terminal evidence record");
assert.equal(successEvidence[0].phase, "response_committed");
assert.equal(successEvidence[0].status, "success");
assert.deepEqual(successEvidence[0].bearer_profile, {
  ttl_seconds: 3600,
  issuer_claim_required: true,
  audience_claim_required: true,
  subject_claim_required: true,
  expiry_claim_required: true,
  user_claim_required: true,
  tenant_claim_required: true,
  short_lived: true,
  secrets_included: false,
});
assert.equal(
  diagnosticEvidence(successHarness).some((entry) =>
    entry.classification === "token_response_committed" && entry.phase !== "response_committed"),
  false,
  "success evidence must not precede response commitment",
);

let replayConsumeCalls = 0;
const replayHarness = createHarness({
  consumeCode: async () => {
    replayConsumeCalls++;
    return {
      consumed: false,
      outcome: "already_consumed",
      replay_allowed: false,
      secrets_included: false,
    };
  },
});
const replay = await runScenario(replayHarness);
assert.equal(replay.status, 400);
assert.equal(replay.body.error, "invalid_grant");
assert.equal(replay.body.error_code, "oauth_code_already_consumed");
assert.equal(replay.body.retry_same_code, false);
assert.equal(replay.body.restart_authorization, true);
assert.equal(replayConsumeCalls, 1);

const unknownError = new Error("connection reset after uncertain commit");
unknownError.code = "ECONNRESET";
unknownError.oauth_consumption = Object.freeze({
  consumed: false,
  outcome: "consumption_outcome_unknown",
  readback_outcome: "already_consumed",
  replay_allowed: false,
  store_error_code: "ECONNRESET",
  secrets_included: false,
});
const unknownHarness = createHarness({
  consumeCode: async () => { throw unknownError; },
});
const unknown = await runScenario(unknownHarness);
assert.equal(unknown.status, 503);
assert.equal(unknown.body.error, "temporarily_unavailable");
assert.equal(unknown.body.error_code, "oauth_code_consumption_outcome_unknown");
assert.equal(unknown.body.retry_same_code, false);
assert.equal(unknown.body.outcome_unknown, true);
assert.equal(unknown.body.operator_reconciliation_required, true);

const issuedError = new Error("connection timed out before commit");
issuedError.code = "ETIMEDOUT";
issuedError.oauth_consumption = Object.freeze({
  consumed: false,
  outcome: "store_unavailable_code_still_issued",
  readback_outcome: "issued_not_consumed",
  replay_allowed: true,
  store_error_code: "ETIMEDOUT",
  secrets_included: false,
});
const issuedHarness = createHarness({
  consumeCode: async () => { throw issuedError; },
});
const issued = await runScenario(issuedHarness);
assert.equal(issued.status, 503);
assert.equal(issued.body.error_code, "oauth_code_store_temporarily_unavailable");
assert.equal(issued.body.retry_same_code, true);
assert.equal(issued.body.outcome_unknown, false);
assert.equal(issued.body.operator_reconciliation_required, false);

let inactiveConsumeCalled = false;
const inactiveHarness = createHarness({
  resolveActiveSubject: async () => ({ ok: false, outcome: "user_inactive" }),
  consumeCode: async () => {
    inactiveConsumeCalled = true;
    return { consumed: true, outcome: "consumed" };
  },
});
const inactive = await runScenario(inactiveHarness);
assert.equal(inactive.status, 400);
assert.equal(inactive.body.error_code, "oauth_code_user_inactive");
assert.equal(inactive.body.restart_authorization, true);
assert.equal(inactiveConsumeCalled, false);

let membershipConsumeCalled = false;
const membershipHarness = createHarness({
  resolveActiveSubject: async () => ({ ok: false, outcome: "membership_inactive" }),
  consumeCode: async () => {
    membershipConsumeCalled = true;
    return { consumed: true, outcome: "consumed" };
  },
});
const membership = await runScenario(membershipHarness);
assert.equal(membership.status, 400);
assert.equal(membership.body.error_code, "oauth_code_membership_inactive");
assert.equal(membershipConsumeCalled, false);

const preConsumptionHarness = createHarness({
  resolveActiveSubject: async () => {
    const error = new Error("subject database unavailable");
    error.code = "ECONNREFUSED";
    throw error;
  },
});
const preConsumption = await runScenario(preConsumptionHarness);
assert.equal(preConsumption.status, 503);
assert.equal(preConsumption.body.error_code, "oauth_token_exchange_preconsumption_unavailable");
assert.equal(preConsumption.body.retry_same_code, true);
assert.equal(preConsumption.body.outcome_unknown, false);
assert.equal(preConsumption.body.operator_reconciliation_required, false);

let missingVerifierConsumeCalled = false;
const missingVerifierHarness = createHarness({
  verifyCode: undefined,
  consumeCode: async () => {
    missingVerifierConsumeCalled = true;
    return { consumed: true, outcome: "consumed" };
  },
});
const missingVerifier = await runScenario(missingVerifierHarness);
assert.equal(missingVerifier.status, 503);
assert.equal(missingVerifier.body.error_code, "oauth_token_exchange_preconsumption_unavailable");
assert.equal(missingVerifier.body.retry_same_code, true);
assert.equal(missingVerifierConsumeCalled, false);

let missingIssuerConsumeCalled = false;
const missingIssuerHarness = createHarness({
  issueAccessToken: undefined,
  consumeCode: async () => {
    missingIssuerConsumeCalled = true;
    return { consumed: true, outcome: "consumed" };
  },
});
const missingIssuer = await runScenario(missingIssuerHarness);
assert.equal(missingIssuer.status, 503);
assert.equal(missingIssuer.body.error_code, "oauth_token_exchange_preconsumption_unavailable");
assert.equal(missingIssuer.body.retry_same_code, true);
assert.equal(missingIssuerConsumeCalled, false);

const postConsumptionHarness = createHarness({
  recordActivationContext: async () => {
    const error = new Error("post-consumption context failure");
    error.code = "CONTEXT_WRITE_FAILED";
    throw error;
  },
});
const postConsumption = await runScenario(postConsumptionHarness);
assert.equal(postConsumption.status, 503);
assert.equal(postConsumption.body.error_code, "oauth_token_response_not_committed");
assert.equal(postConsumption.body.retry_same_code, false);
assert.equal(postConsumption.body.outcome_unknown, true);
assert.equal(postConsumption.body.operator_reconciliation_required, true);

let raceConsumed = false;
const raceHarness = createHarness({
  consumeCode: async () => {
    await new Promise((resolve) => setTimeout(resolve, 2));
    if (!raceConsumed) {
      raceConsumed = true;
      return { consumed: true, outcome: "consumed", replay_allowed: false, secrets_included: false };
    }
    return { consumed: false, outcome: "already_consumed", replay_allowed: false, secrets_included: false };
  },
});
const { server: raceServer, baseUrl: raceBaseUrl } = await startServer(raceHarness.app);
let raceResults;
try {
  raceResults = await Promise.all([postForm(raceBaseUrl), postForm(raceBaseUrl)]);
  await new Promise((resolve) => setTimeout(resolve, 5));
} finally {
  await new Promise((resolve) => raceServer.close(resolve));
}
assert.equal(raceResults.filter((result) => result.status === 200).length, 1);
assert.equal(raceResults.filter((result) => result.status === 400 && result.body.error_code === "oauth_code_already_consumed").length, 1);

const invalidHostHarness = createHarness();
const invalidHost = await runScenario(invalidHostHarness, BASE_BODY, {
  headers: { "x-forwarded-host": "unregistered.example.com" },
});
assert.equal(invalidHost.status, 400);
assert.equal(invalidHost.body.error, "invalid_target");

assert.throws(
  () => buildTenantGptOAuthTokenExchangeRoutes({ accessTokenTtlSeconds: 3601 }),
  (error) => error?.code === "tenant_gpt_access_token_ttl_invalid",
  "route construction must reject an access-token TTL above the governed maximum",
);

for (const harness of [
  successHarness,
  replayHarness,
  unknownHarness,
  issuedHarness,
  inactiveHarness,
  membershipHarness,
  preConsumptionHarness,
  missingVerifierHarness,
  missingIssuerHarness,
  postConsumptionHarness,
  raceHarness,
  invalidHostHarness,
]) {
  const diagnosticText = JSON.stringify(harness.diagnostics);
  assert.equal(diagnosticText.includes(RAW_CODE), false, "diagnostics must not contain the raw authorization code");
  assert.equal(diagnosticText.includes(CLIENT_SECRET), false, "diagnostics must not contain the client secret");
  assert.equal(diagnosticText.includes("access-token-safe-test"), false, "diagnostics must not contain the access token");
}
for (const response of [
  replay,
  unknown,
  issued,
  inactive,
  membership,
  preConsumption,
  missingVerifier,
  missingIssuer,
  postConsumption,
  invalidHost,
]) {
  const serialized = JSON.stringify(response.body);
  assert.equal(serialized.includes(RAW_CODE), false);
  assert.equal(serialized.includes(CLIENT_SECRET), false);
  assert.equal(response.body.secrets_included, false);
}

console.log("PASS tenant-gpt-oauth-token-exchange-routes");
