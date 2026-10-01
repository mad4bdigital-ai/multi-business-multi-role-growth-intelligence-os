import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
delete process.env.NODE_ENV;
delete process.env.REMOTE_MCP_ENVIRONMENT;
process.env.DEPLOYMENT_ENVIRONMENT = "staging_local_windows_docker";
process.env.ACTIVATION_STAGING_GATEWAY_ENABLED = "true";

const {
  advanceTenantGptOAuthOperationCorrelation,
  createTenantGptOAuthOperationCorrelation,
} = await import("./tenantGptOAuthOperationCorrelation.js");
const {
  TENANT_GPT_OAUTH_RECOVERY_SERVER_EVENTS,
  buildTenantGptOAuthRecoveryServerEvidence,
  readTenantGptOAuthRecoveryServerEvidence,
  recordTenantGptOAuthRecoveryServerEvidence,
  verifyTenantGptOAuthRecoveryServerEvidence,
} = await import("./tenantGptOAuthRecoveryEvidenceSink.js");

const STAGING_ENV = Object.freeze({
  DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker",
  ACTIVATION_STAGING_GATEWAY_ENABLED: "true",
});
const PRODUCTION_ENV = Object.freeze({
  DEPLOYMENT_ENVIRONMENT: "production_hostinger_autodeploy",
});

const DEPLOYMENT_SHA = "2b464908bd2639792ff54eafd5f0132612de78b0";
const OPERATION_ID = "11111111-1111-4111-8111-111111111111";
const CORRELATION_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_OPERATION_ID = "33333333-3333-4333-8333-333333333333";
const CLIENT_ID = "mad4b-tenant-gpt-staging";
const RESOURCE = "https://activation-dev.mad4b.com";
const REDIRECT_URI = "https://chatgpt.com/aip/g-test/oauth/callback";
const REDIRECT_HASH = createHash("sha256").update(REDIRECT_URI).digest("hex");
const BASE_MS = Date.parse("2026-10-01T15:00:00.000Z");
const NOW_MS = BASE_MS + 60_000;

function errorCode(fn) {
  try {
    fn();
  } catch (error) {
    return error?.code;
  }
  return null;
}

async function asyncErrorCode(fn) {
  try {
    await fn();
  } catch (error) {
    return error?.code;
  }
  return null;
}

const authorize = createTenantGptOAuthOperationCorrelation(
  {
    operation_id: OPERATION_ID,
    correlation_id: CORRELATION_ID,
    protected_resource: RESOURCE,
    client_id: CLIENT_ID,
    request_id: "recovery-authorize-request",
  },
  { nowMs: BASE_MS },
);
const identity = advanceTenantGptOAuthOperationCorrelation(
  authorize,
  {
    stage: "identity_verify",
    user_id: "user-123",
    tenant_id: "tenant-123",
    request_id: "recovery-identity-request",
  },
  { nowMs: BASE_MS + 10_000 },
);
const code = advanceTenantGptOAuthOperationCorrelation(
  identity,
  {
    stage: "oauth_code_issue",
    oauth_code_jti: "code-jti-123",
    request_id: "recovery-code-request",
  },
  { nowMs: BASE_MS + 20_000 },
);
const token = advanceTenantGptOAuthOperationCorrelation(
  code,
  {
    stage: "oauth_token_exchange",
    access_token_jti: "access-jti-123",
    request_id: "recovery-token-request",
  },
  { nowMs: BASE_MS + 30_000 },
);
const gateway = advanceTenantGptOAuthOperationCorrelation(
  token,
  {
    stage: "gateway_verify",
    request_id: "recovery-resource-request",
  },
  { nowMs: BASE_MS + 40_000 },
);

const correlations = new Map([
  ["authorize_received", authorize],
  ["login_consent_completed", identity],
  ["authorization_code_issued", code],
  ["token_exchange_completed", token],
  ["resource_request_verified", gateway],
]);

const stored = [];
async function query(sql, params = []) {
  const text = String(sql);
  if (text.includes("INSERT INTO `execution_log`")) {
    stored.push({
      id: stored.length + 1,
      action_key: params[5],
      runtime_evidence_json: params[7],
    });
    return [{ affectedRows: 1 }];
  }
  if (text.includes("SELECT id, runtime_evidence_json")) {
    const [, operationId, correlationId, deploymentSha] = params;
    const rows = stored.filter((row) => {
      const evidence = JSON.parse(row.runtime_evidence_json);
      return (
        evidence.operation_id === operationId
        && evidence.correlation_id === correlationId
        && evidence.deployment_sha === deploymentSha
      );
    });
    return [rows];
  }
  throw new Error(`unexpected query: ${text}`);
}

for (const event of TENANT_GPT_OAUTH_RECOVERY_SERVER_EVENTS) {
  const result = await recordTenantGptOAuthRecoveryServerEvidence({
    query,
    enabled: true,
    nowMs: NOW_MS,
    input: {
      event,
      correlation: correlations.get(event),
      redirect_uri_sha256: REDIRECT_HASH,
      deployment_sha: DEPLOYMENT_SHA,
    },
  });
  assert.equal(result.recorded, true);
  assert.equal(result.evidence.event, event);
  assert.equal(result.evidence.operation_id, OPERATION_ID);
  assert.equal(result.evidence.correlation_id, CORRELATION_ID);
  assert.equal(result.evidence.secrets_included, false);
}

assert.equal(stored.length, 5);
const readback = await readTenantGptOAuthRecoveryServerEvidence({
  query,
  operation_id: OPERATION_ID,
  correlation_id: CORRELATION_ID,
  deployment_sha: DEPLOYMENT_SHA,
  nowMs: NOW_MS,
});
assert.equal(readback.complete, true);
assert.deepEqual(readback.missing_events, []);
assert.deepEqual(readback.events.map((event) => event.event), TENANT_GPT_OAUTH_RECOVERY_SERVER_EVENTS);

assert.equal(readback.chain_verified, true);

const repeatedGateway = advanceTenantGptOAuthOperationCorrelation(
  token,
  {
    stage: "gateway_verify",
    request_id: "recovery-resource-request-repeat",
  },
  { nowMs: BASE_MS + 50_000 },
);
await recordTenantGptOAuthRecoveryServerEvidence({
  query,
  enabled: true,
  nowMs: NOW_MS,
  input: {
    event: "resource_request_verified",
    correlation: repeatedGateway,
    deployment_sha: DEPLOYMENT_SHA,
  },
});
const duplicateReadback = await readTenantGptOAuthRecoveryServerEvidence({
  query,
  operation_id: OPERATION_ID,
  correlation_id: CORRELATION_ID,
  deployment_sha: DEPLOYMENT_SHA,
  nowMs: NOW_MS,
});
assert.equal(duplicateReadback.complete, true);
assert.equal(duplicateReadback.chain_verified, true);
assert.equal(duplicateReadback.duplicate_observation_counts.resource_request_verified, 1);
assert.equal(
  duplicateReadback.events.at(-1).canonical_sha256,
  readback.events.at(-1).canonical_sha256,
);

assert.equal(
  errorCode(() => buildTenantGptOAuthRecoveryServerEvidence({
    event: "callback_received",
    correlation: gateway,
    redirect_uri_sha256: REDIRECT_HASH,
    deployment_sha: DEPLOYMENT_SHA,
  }, { nowMs: NOW_MS })),
  "oauth_recovery_callback_external_authority_required",
);

assert.equal(
  errorCode(() => buildTenantGptOAuthRecoveryServerEvidence({
    event: "authorize_received",
    correlation: authorize,
    redirect_uri_sha256: REDIRECT_HASH,
    deployment_sha: DEPLOYMENT_SHA,
    raw_code: "must-never-be-persisted",
  }, { nowMs: NOW_MS })),
  "oauth_recovery_evidence_sensitive_field_forbidden",
);

assert.equal(
  errorCode(() => buildTenantGptOAuthRecoveryServerEvidence({
    event: "authorize_received",
    correlation: authorize,
    redirect_uri_sha256: REDIRECT_HASH,
    deployment_sha: DEPLOYMENT_SHA,
    unexpected_field: "nope",
  }, { nowMs: NOW_MS })),
  "oauth_recovery_evidence_field_not_allowed",
);

const valid = buildTenantGptOAuthRecoveryServerEvidence({
  event: "authorize_received",
  correlation: authorize,
  redirect_uri_sha256: REDIRECT_HASH,
  deployment_sha: DEPLOYMENT_SHA,
}, { nowMs: NOW_MS });
assert.equal(
  errorCode(() => verifyTenantGptOAuthRecoveryServerEvidence(
    { ...valid, protected_resource: "https://tampered.example" },
    { nowMs: NOW_MS },
  )),
  "oauth_recovery_evidence_canonical_hash_mismatch",
);
assert.equal(
  errorCode(() => verifyTenantGptOAuthRecoveryServerEvidence(valid, {
    expectedOperationId: OTHER_OPERATION_ID,
    nowMs: NOW_MS,
  })),
  "oauth_recovery_evidence_operation_mismatch",
);

assert.equal(
  errorCode(() => buildTenantGptOAuthRecoveryServerEvidence({
    event: "authorize_received",
    correlation: authorize,
    redirect_uri_sha256: REDIRECT_HASH,
    deployment_sha: DEPLOYMENT_SHA,
    occurred_at: "2026-10-01T13:00:00.000Z",
    expires_at: "2026-10-01T13:15:00.000Z",
  }, { nowMs: NOW_MS })),
  "oauth_recovery_evidence_freshness_invalid",
);

let productionQueryCalled = false;
const skipped = await recordTenantGptOAuthRecoveryServerEvidence({
  query: async () => {
    productionQueryCalled = true;
    throw new Error("must not write");
  },
  enabled: true,
  env: PRODUCTION_ENV,
  input: null,
  nowMs: NOW_MS,
});
assert.equal(skipped.recorded, false);
assert.equal(skipped.production_mutation_performed, false);
assert.equal(productionQueryCalled, false);

assert.equal(
  errorCode(() => buildTenantGptOAuthRecoveryServerEvidence({
    event: "authorize_received",
    correlation: authorize,
    redirect_uri_sha256: REDIRECT_HASH,
    deployment_sha: DEPLOYMENT_SHA,
  }, { nowMs: NOW_MS, env: PRODUCTION_ENV })),
  "oauth_recovery_evidence_staging_runtime_required",
);

const isolated = await readTenantGptOAuthRecoveryServerEvidence({
  query,
  operation_id: OTHER_OPERATION_ID,
  correlation_id: CORRELATION_ID,
  deployment_sha: DEPLOYMENT_SHA,
  nowMs: NOW_MS,
});
assert.equal(isolated.complete, false);
assert.equal(isolated.events.length, 0);

const alternateToken = advanceTenantGptOAuthOperationCorrelation(
  code,
  {
    stage: "oauth_token_exchange",
    access_token_jti: "alternate-access-jti",
    request_id: "alternate-token-request",
  },
  { nowMs: BASE_MS + 35_000 },
);
const alternateGateway = advanceTenantGptOAuthOperationCorrelation(
  alternateToken,
  {
    stage: "gateway_verify",
    request_id: "alternate-resource-request",
  },
  { nowMs: BASE_MS + 45_000 },
);
const alternateResourceEvidence = buildTenantGptOAuthRecoveryServerEvidence({
  event: "resource_request_verified",
  correlation: alternateGateway,
  deployment_sha: DEPLOYMENT_SHA,
}, { nowMs: NOW_MS });
const brokenRows = [
  ...stored.slice(0, 4),
  {
    id: 999,
    runtime_evidence_json: JSON.stringify(alternateResourceEvidence),
  },
];
const brokenQuery = async (sql) => {
  if (String(sql).includes("SELECT id, runtime_evidence_json")) return [brokenRows];
  throw new Error("unexpected broken-chain query");
};
assert.equal(
  await asyncErrorCode(() => readTenantGptOAuthRecoveryServerEvidence({
    query: brokenQuery,
    operation_id: OPERATION_ID,
    correlation_id: CORRELATION_ID,
    deployment_sha: DEPLOYMENT_SHA,
    nowMs: NOW_MS,
  })),
  "oauth_recovery_evidence_chain_mismatch",
);

const serialized = JSON.stringify(stored);
assert.equal(serialized.includes("must-never-be-persisted"), false);
assert.equal(serialized.includes("code-jti-123"), false);
assert.equal(serialized.includes("access-jti-123"), false);

const source = readFileSync(new URL("./tenantGptOAuthRecoveryEvidenceSink.js", import.meta.url), "utf8");
assert.equal(/CREATE\s+TABLE/iu.test(source), false);
assert.equal(/activation_run/iu.test(source), false);
assert.equal(/INSERT\s+INTO\s+(?!\\?`?execution_log)/iu.test(source), false);

const liveSources = {
  auth: readFileSync(new URL("./routes/authRoutes.js", import.meta.url), "utf8"),
  token: readFileSync(new URL("./routes/tenantGptOAuthTokenExchangeRoutes.js", import.meta.url), "utf8"),
  verifier: readFileSync(new URL("./tenantGptAccessTokenVerifier.js", import.meta.url), "utf8"),
  gateway: readFileSync(new URL("./routes/activationHostGatewayRoutes.js", import.meta.url), "utf8"),
};
assert.equal(liveSources.auth.includes('event: "authorize_received"'), true);
assert.equal(liveSources.auth.includes('event: "login_consent_completed"'), true);
assert.equal(liveSources.auth.includes('event: "authorization_code_issued"'), true);
assert.equal(liveSources.token.includes('event: "token_exchange_completed"'), true);
assert.equal(liveSources.verifier.includes('event: "resource_request_verified"'), true);
assert.equal(liveSources.gateway.includes("effectiveOAuthRecoveryEvidenceRecorder"), true);
for (const [name, sourceText] of Object.entries(liveSources)) {
  assert.equal(
    sourceText.includes('event: "callback_received"'),
    false,
    `${name} must not synthesize callback_received`,
  );
}

console.log("tenant GPT OAuth Recovery evidence sink tests passed");
