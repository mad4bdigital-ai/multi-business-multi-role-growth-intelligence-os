import assert from "node:assert/strict";
import {
  TENANT_GPT_OAUTH_CORRELATION_SCHEMA_VERSION,
  TENANT_GPT_OAUTH_CORRELATION_STAGES,
  advanceTenantGptOAuthOperationCorrelation,
  createTenantGptOAuthOperationCorrelation,
  safeTenantGptOAuthOperationCorrelationEvidence,
  tenantGptOAuthOperationCorrelationClaim,
  verifyTenantGptOAuthOperationCorrelation,
} from "./tenantGptOAuthOperationCorrelation.js";

const RESOURCE = "https://activation.mad4b.com";
const CLIENT_ID = "tenant-gpt-oauth-client";
const REQUEST_ID = "cf-request-raw-123";
const USER_ID = "user-sensitive-123";
const TENANT_ID = "tenant-sensitive-456";
const CODE_JTI = "oauth-code-jti-sensitive";
const ACCESS_JTI = "access-token-jti-sensitive";
const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
];
const idFactory = () => ids.shift();

const authorize = createTenantGptOAuthOperationCorrelation(
  {
    protected_resource: RESOURCE,
    client_id: CLIENT_ID,
    request_id: REQUEST_ID,
  },
  { idFactory, nowMs: Date.parse("2026-08-03T18:00:00.000Z") },
);

assert.equal(authorize.schema_version, TENANT_GPT_OAUTH_CORRELATION_SCHEMA_VERSION);
assert.equal(authorize.operation_id, "11111111-1111-4111-8111-111111111111");
assert.equal(authorize.correlation_id, "22222222-2222-4222-8222-222222222222");
assert.equal(authorize.stage, "oauth_authorize");
assert.equal(authorize.protected_resource, RESOURCE);
assert.equal(authorize.secrets_included, false);
assert.equal(Object.isFrozen(authorize), true);
assert.match(authorize.client_id_sha256, /^[0-9a-f]{64}$/);
assert.match(authorize.stage_request_id_sha256, /^[0-9a-f]{64}$/);

const identity = advanceTenantGptOAuthOperationCorrelation(
  authorize,
  {
    stage: "identity_verify",
    user_id: USER_ID,
    tenant_id: TENANT_ID,
    request_id: "identity-request",
  },
  { nowMs: Date.parse("2026-08-03T18:00:01.000Z") },
);
const code = advanceTenantGptOAuthOperationCorrelation(
  identity,
  {
    stage: "oauth_code_issue",
    oauth_code_jti: CODE_JTI,
    request_id: "code-request",
  },
  { nowMs: Date.parse("2026-08-03T18:00:02.000Z") },
);
const token = advanceTenantGptOAuthOperationCorrelation(
  code,
  {
    stage: "oauth_token_exchange",
    access_token_jti: ACCESS_JTI,
    request_id: "token-request",
  },
  { nowMs: Date.parse("2026-08-03T18:00:03.000Z") },
);
const gateway = advanceTenantGptOAuthOperationCorrelation(
  token,
  {
    stage: "gateway_verify",
    request_id: "gateway-request",
  },
  { nowMs: Date.parse("2026-08-03T18:00:04.000Z") },
);

assert.deepEqual(TENANT_GPT_OAUTH_CORRELATION_STAGES, [
  "oauth_authorize",
  "identity_verify",
  "oauth_code_issue",
  "oauth_token_exchange",
  "gateway_verify",
]);
for (const envelope of [identity, code, token, gateway]) {
  assert.equal(envelope.operation_id, authorize.operation_id);
  assert.equal(envelope.correlation_id, authorize.correlation_id);
  assert.equal(envelope.protected_resource, RESOURCE);
  assert.equal(envelope.client_id_sha256, authorize.client_id_sha256);
  assert.equal(envelope.secrets_included, false);
  assert.match(envelope.previous_envelope_sha256, /^[0-9a-f]{64}$/);
  assert.match(envelope.envelope_sha256, /^[0-9a-f]{64}$/);
}
assert.equal(identity.previous_envelope_sha256, authorize.envelope_sha256);
assert.equal(code.previous_envelope_sha256, identity.envelope_sha256);
assert.equal(token.previous_envelope_sha256, code.envelope_sha256);
assert.equal(gateway.previous_envelope_sha256, token.envelope_sha256);
assert.match(identity.subject_user_sha256, /^[0-9a-f]{64}$/);
assert.match(identity.subject_tenant_sha256, /^[0-9a-f]{64}$/);
assert.match(code.oauth_code_jti_sha256, /^[0-9a-f]{64}$/);
assert.match(token.access_token_jti_sha256, /^[0-9a-f]{64}$/);

assert.deepEqual(
  verifyTenantGptOAuthOperationCorrelation(gateway, {
    expected_resource: RESOURCE,
    expected_stage: "gateway_verify",
  }),
  gateway,
);

const claim = tenantGptOAuthOperationCorrelationClaim(token);
assert.notEqual(claim, token);
assert.deepEqual(claim, { ...token });
assert.equal(Object.isFrozen(claim), true);
assert.throws(() => {
  claim.stage = "tampered";
}, TypeError);
assert.equal(token.stage, "oauth_token_exchange");

const evidence = safeTenantGptOAuthOperationCorrelationEvidence(gateway);
assert.deepEqual(evidence, {
  schema_version: 1,
  operation_id: authorize.operation_id,
  correlation_id: authorize.correlation_id,
  parent_operation_id: null,
  stage: "gateway_verify",
  protected_resource: RESOURCE,
  client_id_sha256_prefix: authorize.client_id_sha256.slice(0, 12),
  subject_bound: true,
  oauth_code_bound: true,
  access_token_bound: true,
  envelope_sha256: gateway.envelope_sha256,
  issued_at: "2026-08-03T18:00:00.000Z",
  updated_at: "2026-08-03T18:00:04.000Z",
  secrets_included: false,
});
assert.equal(Object.isFrozen(evidence), true);

const serialized = JSON.stringify({ authorize, identity, code, token, gateway, evidence });
for (const sensitiveValue of [
  CLIENT_ID,
  REQUEST_ID,
  USER_ID,
  TENANT_ID,
  CODE_JTI,
  ACCESS_JTI,
  "identity-request",
  "code-request",
  "token-request",
  "gateway-request",
]) {
  assert.equal(serialized.includes(sensitiveValue), false, `${sensitiveValue} must not be retained`);
}
assert.equal(serialized.includes("Bearer "), false);
assert.equal(serialized.includes("authorization_code="), false);

assert.throws(
  () => advanceTenantGptOAuthOperationCorrelation(authorize, { stage: "oauth_code_issue" }),
  error => error?.code === "oauth_correlation_stage_transition_invalid",
);
assert.throws(
  () => advanceTenantGptOAuthOperationCorrelation(authorize, { stage: "identity_verify", user_id: USER_ID }),
  error => error?.code === "oauth_correlation_subject_binding_required",
);
assert.throws(
  () => advanceTenantGptOAuthOperationCorrelation(identity, { stage: "oauth_code_issue" }),
  error => error?.code === "oauth_correlation_code_binding_required",
);
assert.throws(
  () => advanceTenantGptOAuthOperationCorrelation(code, { stage: "oauth_token_exchange" }),
  error => error?.code === "oauth_correlation_access_binding_required",
);
assert.throws(
  () => advanceTenantGptOAuthOperationCorrelation(identity, {
    stage: "oauth_code_issue",
    oauth_code_jti: CODE_JTI,
    user_id: USER_ID,
  }),
  error => error?.code === "oauth_correlation_subject_binding_stage_invalid",
);
assert.throws(
  () => advanceTenantGptOAuthOperationCorrelation(identity, {
    stage: "oauth_code_issue",
    oauth_code_jti: CODE_JTI,
    access_token_jti: ACCESS_JTI,
  }),
  error => error?.code === "oauth_correlation_access_binding_stage_invalid",
);
assert.throws(
  () => advanceTenantGptOAuthOperationCorrelation(identity, {
    stage: "oauth_code_issue",
    oauth_code_jti: CODE_JTI,
    authorization: "Bearer secret",
  }),
  error => error?.code === "oauth_correlation_sensitive_field_forbidden",
);
assert.throws(
  () => advanceTenantGptOAuthOperationCorrelation(identity, { stage: "identity_verify" }),
  error => error?.code === "oauth_correlation_stage_transition_invalid",
);
assert.throws(
  () => advanceTenantGptOAuthOperationCorrelation(identity, { stage: "oauth_code_issue", oauth_code_jti: CODE_JTI }, {
    nowMs: Date.parse("2026-08-03T17:59:59.000Z"),
  }),
  error => error?.code === "oauth_correlation_clock_regression",
);
assert.throws(
  () => verifyTenantGptOAuthOperationCorrelation({ ...gateway, operation_id: authorize.correlation_id }),
  error => error?.code === "oauth_correlation_identity_collision" || error?.code === "oauth_correlation_digest_mismatch",
);
assert.throws(
  () => verifyTenantGptOAuthOperationCorrelation({ ...gateway, authorization: "Bearer secret" }),
  error => error?.code === "oauth_correlation_sensitive_field_forbidden",
);
assert.throws(
  () => verifyTenantGptOAuthOperationCorrelation({ ...gateway, arbitrary: true }),
  error => error?.code === "oauth_correlation_field_not_allowed",
);
assert.throws(
  () => verifyTenantGptOAuthOperationCorrelation(gateway, {
    expected_resource: "https://connector.mad4b.com",
  }),
  error => error?.code === "oauth_correlation_resource_mismatch",
);
assert.throws(
  () => verifyTenantGptOAuthOperationCorrelation(gateway, {
    expected_stage: "oauth_token_exchange",
  }),
  error => error?.code === "oauth_correlation_stage_mismatch",
);
assert.throws(
  () => createTenantGptOAuthOperationCorrelation({
    protected_resource: RESOURCE,
    client_id: CLIENT_ID,
    operation_id: "not-a-uuid",
  }),
  error => error?.code === "oauth_correlation_operation_id_invalid",
);
assert.throws(
  () => createTenantGptOAuthOperationCorrelation({
    protected_resource: RESOURCE,
    client_id: CLIENT_ID,
    stage: "identity_verify",
  }),
  error => error?.code === "oauth_correlation_initial_stage_invalid",
);
assert.throws(
  () => createTenantGptOAuthOperationCorrelation({
    protected_resource: RESOURCE,
    client_id: CLIENT_ID,
    operation_id: "33333333-3333-4333-8333-333333333333",
    correlation_id: "33333333-3333-4333-8333-333333333333",
  }),
  error => error?.code === "oauth_correlation_identity_collision",
);
assert.throws(
  () => createTenantGptOAuthOperationCorrelation({
    protected_resource: RESOURCE,
    client_id: CLIENT_ID,
    access_token: "secret",
  }),
  error => error?.code === "oauth_correlation_sensitive_field_forbidden",
);
assert.throws(() => {
  authorize.stage = "identity_verify";
}, TypeError);

console.log("Tenant GPT OAuth operation correlation tests passed");
