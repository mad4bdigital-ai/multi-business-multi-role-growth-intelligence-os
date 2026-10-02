import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const DEPLOYMENT_SHA = "2b464908bd2639792ff54eafd5f0132612de78b0";
const DEPLOYMENT_MANIFEST_JSON = JSON.stringify({
  repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
  branch: "main",
  commit_sha: DEPLOYMENT_SHA,
  secrets_included: false,
});

for (const key of ["NODE_ENV", "REMOTE_MCP_ENVIRONMENT"]) delete process.env[key];
Object.assign(process.env, {
  DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker",
  ACTIVATION_STAGING_GATEWAY_ENABLED: "true",
  DEPLOYMENT_EXPECTED_COMMIT_SHA: DEPLOYMENT_SHA,
  DEPLOY_COMMIT: DEPLOYMENT_SHA,
  DEPLOYMENT_MANIFEST_JSON,
});

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
  DEPLOYMENT_EXPECTED_COMMIT_SHA: DEPLOYMENT_SHA,
  DEPLOY_COMMIT: DEPLOYMENT_SHA,
  DEPLOYMENT_MANIFEST_JSON,
});
const AMBIGUOUS_STAGING_ENV = Object.freeze({
  DEPLOYMENT_ENVIRONMENT: "staging",
  DEPLOYMENT_EXPECTED_COMMIT_SHA: DEPLOYMENT_SHA,
  DEPLOYMENT_MANIFEST_JSON,
});
const HOSTED_STAGING_ENV = Object.freeze({
  DEPLOYMENT_ENVIRONMENT: "staging_hosted",
  DEPLOYMENT_EXPECTED_COMMIT_SHA: DEPLOYMENT_SHA,
  DEPLOY_COMMIT: DEPLOYMENT_SHA,
  DEPLOYMENT_MANIFEST_JSON,
});
const PRODUCTION_ENV = Object.freeze({
  DEPLOYMENT_ENVIRONMENT: "production_hostinger_autodeploy",
});

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

const authorize = createTenantGptOAuthOperationCorrelation({
  operation_id: OPERATION_ID,
  correlation_id: CORRELATION_ID,
  protected_resource: RESOURCE,
  client_id: CLIENT_ID,
  request_id: "recovery-authorize-request",
}, { nowMs: BASE_MS });

const identity = advanceTenantGptOAuthOperationCorrelation(authorize, {
  stage: "identity_verify",
  user_id: "user-123",
  tenant_id: "tenant-123",
  request_id: "recovery-identity-request",
}, { nowMs: BASE_MS + 10_000 });

const code = advanceTenantGptOAuthOperationCorrelation(identity, {
  stage: "oauth_code_issue",
  oauth_code_jti: "code-jti-123",
  request_id: "recovery-code-request",
}, { nowMs: BASE_MS + 20_000 });

const token = advanceTenantGptOAuthOperationCorrelation(code, {
  stage: "oauth_token_exchange",
  access_token_jti: "access-jti-123",
  request_id: "recovery-token-request",
}, { nowMs: BASE_MS + 30_000 });

const gateway = advanceTenantGptOAuthOperationCorrelation(token, {
  stage: "gateway_verify",
  request_id: "recovery-resource-request",
}, { nowMs: BASE_MS + 40_000 });

const correlations = new Map([
  ["authorize_received", authorize],
  ["login_consent_completed", identity],
  ["authorization_code_issued", code],
  ["token_exchange_completed", token],
  ["resource_request_verified", gateway],
]);

const stored = [];
const observedQueries = [];
async function query(sql, params = []) {
  const text = String(sql);
  observedQueries.push({ text, params: [...params] });
  if (text.includes("INSERT INTO `execution_log`")) {
    stored.push({
      id: stored.length + 1,
      action_key: params[5],
      correlation_id: params[7],
      runtime_evidence_json: params[8],
    });
    return [{ affectedRows: 1 }];
  }
  if (text.includes("SELECT id, runtime_evidence_json")) {
    const [, correlationId, operationId, deploymentSha] = params;
    return [stored.filter((row) => {
      const evidence = JSON.parse(row.runtime_evidence_json);
      return row.correlation_id === correlationId
        && evidence.operation_id === operationId
        && evidence.correlation_id === correlationId
        && evidence.deployment_sha === deploymentSha;
    })];
  }
  throw new Error("unexpected query: " + text);
}

for (const event of TENANT_GPT_OAUTH_RECOVERY_SERVER_EVENTS) {
  const result = await recordTenantGptOAuthRecoveryServerEvidence({
    query,
    enabled: true,
    env: STAGING_ENV,
    nowMs: NOW_MS,
    input: {
      event,
      correlation: correlations.get(event),
      ...(event === "resource_request_verified" ? {} : { redirect_uri_sha256: REDIRECT_HASH }),
    },
  });
  assert.equal(result.recorded, true);
  assert.equal(result.evidence.event, event);
  assert.equal(result.evidence.operation_id, OPERATION_ID);
  assert.equal(result.evidence.correlation_id, CORRELATION_ID);
  assert.equal(result.evidence.deployment_sha, DEPLOYMENT_SHA);
  assert.equal(result.evidence.integrity, "canonical_digest");
  assert.equal(result.evidence.source_authenticity, "not_established");
  assert.equal(result.evidence.secrets_included, false);
}

assert.equal(stored.length, 5);
assert.equal(stored.every((row) => row.correlation_id === CORRELATION_ID), true);
assert.equal(
  observedQueries.some(({ text }) =>
    text.includes("correlation_id, runtime_evidence_json")
  ),
  true,
  "Recovery evidence writer must populate normalized execution_log.correlation_id",
);
const readback = await readTenantGptOAuthRecoveryServerEvidence({
  query,
  operation_id: OPERATION_ID,
  correlation_id: CORRELATION_ID,
  deployment_sha: DEPLOYMENT_SHA,
  env: STAGING_ENV,
  nowMs: NOW_MS,
});
assert.equal(readback.complete, true);
assert.equal(readback.chain_verified, true);
assert.equal(readback.integrity, "canonical_digest");
assert.equal(readback.source_authenticity, "not_established");
assert.deepEqual(readback.missing_events, []);
assert.deepEqual(readback.events.map((event) => event.event), TENANT_GPT_OAUTH_RECOVERY_SERVER_EVENTS);
assert.equal(readback.events.at(-1).redirect_uri_sha256, null);
const readbackQuery = observedQueries.find(({ text }) =>
  text.includes("SELECT id, runtime_evidence_json")
);
assert.ok(readbackQuery, "Recovery readback query must be observed");
assert.equal(
  readbackQuery.text.includes("AND correlation_id = ?"),
  true,
  "Recovery readback must use the indexed normalized correlation_id predicate",
);
assert.equal(
  readbackQuery.text.includes("$.correlation_id"),
  false,
  "Recovery readback candidate selection must not require a JSON correlation scan",
);

const repeatedGateway = advanceTenantGptOAuthOperationCorrelation(token, {
  stage: "gateway_verify",
  request_id: "recovery-resource-request-repeat",
}, { nowMs: BASE_MS + 50_000 });
await recordTenantGptOAuthRecoveryServerEvidence({
  query,
  enabled: true,
  env: STAGING_ENV,
  nowMs: NOW_MS,
  input: {
    event: "resource_request_verified",
    correlation: repeatedGateway,
  },
});
const duplicateReadback = await readTenantGptOAuthRecoveryServerEvidence({
  query,
  operation_id: OPERATION_ID,
  correlation_id: CORRELATION_ID,
  deployment_sha: DEPLOYMENT_SHA,
  env: STAGING_ENV,
  nowMs: NOW_MS,
});
assert.equal(duplicateReadback.complete, true);
assert.equal(duplicateReadback.chain_verified, true);
assert.equal(duplicateReadback.duplicate_observation_counts.resource_request_verified, 1);
assert.equal(duplicateReadback.events.at(-1).canonical_sha256, readback.events.at(-1).canonical_sha256);

assert.equal(
  errorCode(() => buildTenantGptOAuthRecoveryServerEvidence({
    event: "callback_received",
    correlation: gateway,
    redirect_uri_sha256: REDIRECT_HASH,
  }, { nowMs: NOW_MS, env: STAGING_ENV })),
  "oauth_recovery_callback_external_authority_required",
);

assert.equal(
  errorCode(() => buildTenantGptOAuthRecoveryServerEvidence({
    event: "authorize_received",
    correlation: authorize,
    redirect_uri_sha256: REDIRECT_HASH,
    raw_code: "must-never-be-persisted",
  }, { nowMs: NOW_MS, env: STAGING_ENV })),
  "oauth_recovery_evidence_sensitive_field_forbidden",
);

assert.equal(
  errorCode(() => buildTenantGptOAuthRecoveryServerEvidence({
    event: "authorize_received",
    correlation: authorize,
    redirect_uri_sha256: REDIRECT_HASH,
    unexpected_field: "nope",
  }, { nowMs: NOW_MS, env: STAGING_ENV })),
  "oauth_recovery_evidence_field_not_allowed",
);

assert.equal(
  errorCode(() => buildTenantGptOAuthRecoveryServerEvidence({
    event: "authorize_received",
    correlation: authorize,
    redirect_uri_sha256: REDIRECT_HASH,
    deployment_sha: DEPLOYMENT_SHA,
  }, { nowMs: NOW_MS, env: STAGING_ENV })),
  "oauth_recovery_evidence_field_not_allowed",
);

const valid = buildTenantGptOAuthRecoveryServerEvidence({
  event: "authorize_received",
  correlation: authorize,
  redirect_uri_sha256: REDIRECT_HASH,
}, { nowMs: NOW_MS, env: STAGING_ENV });
assert.equal(
  errorCode(() => verifyTenantGptOAuthRecoveryServerEvidence(
    { ...valid, protected_resource: "https://tampered.example" },
    { nowMs: NOW_MS },
  )),
  "oauth_recovery_evidence_resource_invalid",
);
assert.equal(
  errorCode(() => verifyTenantGptOAuthRecoveryServerEvidence(valid, {
    expectedOperationId: OTHER_OPERATION_ID,
    nowMs: NOW_MS,
  })),
  "oauth_recovery_evidence_operation_mismatch",
);

const staleAuthorize = createTenantGptOAuthOperationCorrelation({
  operation_id: "55555555-5555-4555-8555-555555555555",
  correlation_id: "66666666-6666-4666-8666-666666666666",
  protected_resource: RESOURCE,
  client_id: CLIENT_ID,
  request_id: "stale-recovery-authorize-request",
}, { nowMs: BASE_MS - (20 * 60 * 1000) });
assert.equal(
  errorCode(() => buildTenantGptOAuthRecoveryServerEvidence({
    event: "authorize_received",
    correlation: staleAuthorize,
    redirect_uri_sha256: REDIRECT_HASH,
  }, { nowMs: NOW_MS, env: STAGING_ENV })),
  "oauth_recovery_evidence_freshness_invalid",
);

const writeDeadlineStartedAt = Date.now();
assert.equal(
  await asyncErrorCode(() => recordTenantGptOAuthRecoveryServerEvidence({
    query: async () => new Promise(() => {}),
    enabled: true,
    env: STAGING_ENV,
    nowMs: NOW_MS,
    writeBudgetMs: 15,
    input: {
      event: "authorize_received",
      correlation: authorize,
      redirect_uri_sha256: REDIRECT_HASH,
    },
  })),
  "oauth_recovery_evidence_write_deadline_exceeded",
);
assert.ok(
  Date.now() - writeDeadlineStartedAt < 500,
  "Recovery evidence persistence timeout must bound caller latency",
);
assert.equal(
  await asyncErrorCode(() => recordTenantGptOAuthRecoveryServerEvidence({
    query: async () => [{ affectedRows: 1 }],
    enabled: true,
    env: STAGING_ENV,
    nowMs: NOW_MS,
    writeBudgetMs: 5,
    input: {
      event: "authorize_received",
      correlation: authorize,
      redirect_uri_sha256: REDIRECT_HASH,
    },
  })),
  "oauth_recovery_evidence_write_budget_invalid",
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

const ambiguousSkipped = await recordTenantGptOAuthRecoveryServerEvidence({
  query: async () => {
    throw new Error("ambiguous Staging must not write");
  },
  enabled: true,
  env: AMBIGUOUS_STAGING_ENV,
  input: null,
  nowMs: NOW_MS,
});
assert.equal(ambiguousSkipped.recorded, false);
assert.equal(
  errorCode(() => buildTenantGptOAuthRecoveryServerEvidence({
    event: "authorize_received",
    correlation: authorize,
    redirect_uri_sha256: REDIRECT_HASH,
  }, { nowMs: NOW_MS, env: AMBIGUOUS_STAGING_ENV })),
  "oauth_recovery_evidence_staging_runtime_required",
);
assert.equal(
  errorCode(() => buildTenantGptOAuthRecoveryServerEvidence({
    event: "authorize_received",
    correlation: authorize,
    redirect_uri_sha256: REDIRECT_HASH,
  }, { nowMs: NOW_MS, env: HOSTED_STAGING_ENV })),
  "oauth_recovery_evidence_staging_runtime_required",
);

assert.equal(
  errorCode(() => buildTenantGptOAuthRecoveryServerEvidence({
    event: "authorize_received",
    correlation: authorize,
    redirect_uri_sha256: REDIRECT_HASH,
  }, {
    nowMs: NOW_MS,
    env: {
      ...STAGING_ENV,
      DEPLOYMENT_EXPECTED_COMMIT_SHA: "f".repeat(40),
      DEPLOY_COMMIT: "f".repeat(40),
    },
  })),
  "oauth_recovery_evidence_deployment_mismatch",
);

assert.equal(
  errorCode(() => buildTenantGptOAuthRecoveryServerEvidence({
    event: "authorize_received",
    correlation: authorize,
    redirect_uri_sha256: REDIRECT_HASH,
  }, {
    nowMs: NOW_MS,
    env: {
      DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker",
      DEPLOYMENT_EXPECTED_COMMIT_SHA: DEPLOYMENT_SHA,
    },
  })),
  "oauth_recovery_evidence_deployment_identity_invalid",
);

for (const manifestPatch of [
  { repository: "other/repository" },
  { branch: "feature/not-main" },
]) {
  assert.equal(
    errorCode(() => buildTenantGptOAuthRecoveryServerEvidence({
      event: "authorize_received",
      correlation: authorize,
      redirect_uri_sha256: REDIRECT_HASH,
    }, {
      nowMs: NOW_MS,
      env: {
        ...STAGING_ENV,
        DEPLOYMENT_MANIFEST_JSON: JSON.stringify({
          ...JSON.parse(DEPLOYMENT_MANIFEST_JSON),
          ...manifestPatch,
        }),
      },
    })),
    "oauth_recovery_evidence_deployment_identity_invalid",
  );
}

const isolated = await readTenantGptOAuthRecoveryServerEvidence({
  query,
  operation_id: OTHER_OPERATION_ID,
  correlation_id: CORRELATION_ID,
  deployment_sha: DEPLOYMENT_SHA,
  env: STAGING_ENV,
  nowMs: NOW_MS,
});
assert.equal(isolated.complete, false);
assert.equal(isolated.events.length, 0);

const alternateToken = advanceTenantGptOAuthOperationCorrelation(code, {
  stage: "oauth_token_exchange",
  access_token_jti: "alternate-access-jti",
  request_id: "alternate-token-request",
}, { nowMs: BASE_MS + 35_000 });
const alternateGateway = advanceTenantGptOAuthOperationCorrelation(alternateToken, {
  stage: "gateway_verify",
  request_id: "alternate-resource-request",
}, { nowMs: BASE_MS + 45_000 });
const alternateResourceEvidence = buildTenantGptOAuthRecoveryServerEvidence({
  event: "resource_request_verified",
  correlation: alternateGateway,
}, { nowMs: NOW_MS, env: STAGING_ENV });
const brokenRows = [
  ...stored.slice(0, 4),
  { id: 999, runtime_evidence_json: JSON.stringify(alternateResourceEvidence) },
];
assert.equal(
  await asyncErrorCode(() => readTenantGptOAuthRecoveryServerEvidence({
    query: async (sql) => {
      if (String(sql).includes("SELECT id, runtime_evidence_json")) return [brokenRows];
      throw new Error("unexpected broken-chain query");
    },
    operation_id: OPERATION_ID,
    correlation_id: CORRELATION_ID,
    deployment_sha: DEPLOYMENT_SHA,
    env: STAGING_ENV,
    nowMs: NOW_MS,
  })),
  "oauth_recovery_evidence_chain_mismatch",
);

const tokenEvidence = buildTenantGptOAuthRecoveryServerEvidence({
  event: "token_exchange_completed",
  correlation: token,
  redirect_uri_sha256: REDIRECT_HASH,
}, { nowMs: NOW_MS, env: STAGING_ENV });
assert.equal(
  errorCode(() => verifyTenantGptOAuthRecoveryServerEvidence({
    ...tokenEvidence,
    previous_envelope_sha256: null,
  }, { nowMs: NOW_MS })),
  "oauth_recovery_evidence_hash_required",
);

const oversizedRows = Array.from({ length: 129 }, (_, index) => ({
  id: index + 1,
  runtime_evidence_json: JSON.stringify(valid),
}));
assert.equal(
  await asyncErrorCode(() => readTenantGptOAuthRecoveryServerEvidence({
    query: async (sql) => {
      if (String(sql).includes("SELECT id, runtime_evidence_json")) return [oversizedRows];
      throw new Error("unexpected bounded readback query");
    },
    operation_id: OPERATION_ID,
    correlation_id: CORRELATION_ID,
    deployment_sha: DEPLOYMENT_SHA,
    env: STAGING_ENV,
    nowMs: NOW_MS,
  })),
  "oauth_recovery_evidence_readback_bound_exceeded",
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
assert.equal(liveSources.verifier.includes('event: "resource_request_verified"'), false);
assert.equal(liveSources.verifier.includes("onRecoveryEvidence"), false);
assert.equal(liveSources.gateway.includes('event: "resource_request_verified"'), true);
assert.equal(liveSources.gateway.includes("await effectiveOAuthRecoveryEvidenceRecorder"), true);
assert.equal(
  liveSources.gateway.includes("recoveryObservationCache.get(observationIdentity) === pending"),
  true,
  "Gateway de-duplication must coalesce only the in-flight write and release successful observations",
);
for (const [name, sourceText] of Object.entries(liveSources)) {
  assert.equal(sourceText.includes('event: "callback_received"'), false, name + " must not synthesize callback_received");
}

console.log("tenant GPT OAuth Recovery evidence sink tests passed");
