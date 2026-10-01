import { createHash } from "node:crypto";
import { TENANT_GPT_IS_STAGING_RUNTIME } from "./tenantGptOAuthPreset.js";
import { verifyTenantGptOAuthOperationCorrelation } from "./tenantGptOAuthOperationCorrelation.js";

export const TENANT_GPT_OAUTH_RECOVERY_SERVER_EVIDENCE_CONTRACT =
  "mad4b.tenant-gpt-oauth-recovery-server-evidence.v1";
export const TENANT_GPT_OAUTH_RECOVERY_SERVER_READBACK_CONTRACT =
  "mad4b.tenant-gpt-oauth-recovery-server-readback.v1";
export const TENANT_GPT_OAUTH_RECOVERY_SERVER_EVIDENCE_ACTION_KEY =
  "tenant_gpt_oauth_recovery_server_evidence";

export const TENANT_GPT_OAUTH_RECOVERY_SERVER_EVENTS = Object.freeze([
  "authorize_received",
  "login_consent_completed",
  "authorization_code_issued",
  "token_exchange_completed",
  "resource_request_verified",
]);

const EVENT_STAGE = Object.freeze({
  authorize_received: "oauth_authorize",
  login_consent_completed: "identity_verify",
  authorization_code_issued: "oauth_code_issue",
  token_exchange_completed: "oauth_token_exchange",
  resource_request_verified: "gateway_verify",
});

const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_TTL_MS = 60 * 60 * 1000;
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const SENSITIVE_INPUT_KEY = /(^|_)(authorization|code|credential|password|secret|token|cookie|raw)(_|$)/iu;

const INPUT_KEYS = new Set([
  "event",
  "correlation",
  "redirect_uri_sha256",
  "deployment_sha",
  "occurred_at",
  "expires_at",
]);

const EVIDENCE_KEYS = new Set([
  "contract",
  "schema_version",
  "source",
  "environment",
  "event",
  "oauth_stage",
  "operation_id",
  "correlation_id",
  "protected_resource",
  "client_id_sha256",
  "subject_user_sha256",
  "subject_tenant_sha256",
  "oauth_code_jti_sha256",
  "access_token_jti_sha256",
  "stage_request_id_sha256",
  "previous_envelope_sha256",
  "correlation_envelope_sha256",
  "redirect_uri_sha256",
  "deployment_sha",
  "occurred_at",
  "expires_at",
  "secrets_included",
  "canonical_sha256",
]);

function fail(code, message, status = 400) {
  const error = new Error(message || code);
  error.code = code;
  error.status = status;
  error.secrets_included = false;
  throw error;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stable(value[key])]),
    );
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function canonicalDigest(value) {
  const material = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "canonical_sha256"),
  );
  return sha256(JSON.stringify(stable(material)));
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("oauth_recovery_evidence_shape_invalid", `${label} must be an object.`);
  }
}

function assertAllowedKeys(value, allowed, label) {
  assertPlainObject(value, label);
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    if (SENSITIVE_INPUT_KEY.test(key)) {
      fail(
        "oauth_recovery_evidence_sensitive_field_forbidden",
        `${label}.${key} is forbidden; persist only bounded no-secret evidence.`,
      );
    }
    fail(
      "oauth_recovery_evidence_field_not_allowed",
      `${label}.${key} is not part of the recovery evidence contract.`,
    );
  }
}

function requireSha40(value, field) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!SHA40.test(normalized)) {
    fail("oauth_recovery_evidence_deployment_sha_invalid", `${field} must be an exact lowercase 40-character SHA.`);
  }
  return normalized;
}

function optionalSha256(value, field) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).trim().toLowerCase();
  if (!SHA256.test(normalized)) {
    fail("oauth_recovery_evidence_hash_invalid", `${field} must be a SHA-256 hex digest.`);
  }
  return normalized;
}

function requireUuid(value, field) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!UUID.test(normalized)) {
    fail("oauth_recovery_evidence_identity_invalid", `${field} must be a UUID.`);
  }
  return normalized;
}

function normalizeTimestamp(value, field) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    fail("oauth_recovery_evidence_timestamp_invalid", `${field} must be ISO-8601.`);
  }
  return new Date(parsed).toISOString();
}

function assertFreshness(occurredAt, expiresAt, nowMs) {
  const occurred = Date.parse(occurredAt);
  const expires = Date.parse(expiresAt);
  if (
    !Number.isFinite(occurred)
    || !Number.isFinite(expires)
    || expires <= occurred
    || expires - occurred > MAX_TTL_MS
    || occurred > Number(nowMs) + 60_000
    || expires <= Number(nowMs)
  ) {
    fail(
      "oauth_recovery_evidence_freshness_invalid",
      "Recovery evidence freshness window is invalid.",
    );
  }
}

function eventName(value) {
  const normalized = String(value || "").trim();
  if (normalized === "callback_received") {
    fail(
      "oauth_recovery_callback_external_authority_required",
      "callback_received is external authority and cannot be recorded by the server-owned sink.",
      403,
    );
  }
  if (!TENANT_GPT_OAUTH_RECOVERY_SERVER_EVENTS.includes(normalized)) {
    fail(
      "oauth_recovery_evidence_event_invalid",
      "Recovery event is not owned by the server evidence sink.",
    );
  }
  return normalized;
}

export function resolveTenantGptOAuthRecoveryDeploymentSha(env = process.env) {
  for (const key of [
    "REMOTE_MCP_EXPECTED_DEPLOYMENT_SHA",
    "STAGING_SOURCE_COMMIT",
    "SOURCE_COMMIT",
    "GIT_COMMIT_SHA",
  ]) {
    const value = String(env?.[key] || "").trim().toLowerCase();
    if (SHA40.test(value)) return value;
  }
  return null;
}

export function buildTenantGptOAuthRecoveryServerEvidence(input = {}, {
  nowMs = Date.now(),
  env = process.env,
} = {}) {
  assertAllowedKeys(input, INPUT_KEYS, "input");
  const event = eventName(input.event);
  const expectedStage = EVENT_STAGE[event];
  const correlation = verifyTenantGptOAuthOperationCorrelation(input.correlation, {
    expected_stage: expectedStage,
  });
  const deploymentSha = requireSha40(
    input.deployment_sha || resolveTenantGptOAuthRecoveryDeploymentSha(env),
    "deployment_sha",
  );
  const occurredAt = normalizeTimestamp(
    input.occurred_at || correlation.updated_at,
    "occurred_at",
  );
  const expiresAt = normalizeTimestamp(
    input.expires_at || new Date(Date.parse(occurredAt) + DEFAULT_TTL_MS).toISOString(),
    "expires_at",
  );
  assertFreshness(occurredAt, expiresAt, nowMs);

  const evidence = {
    contract: TENANT_GPT_OAUTH_RECOVERY_SERVER_EVIDENCE_CONTRACT,
    schema_version: 1,
    source: "server_owned_oauth_runtime",
    environment: "staging",
    event,
    oauth_stage: correlation.stage,
    operation_id: requireUuid(correlation.operation_id, "operation_id"),
    correlation_id: requireUuid(correlation.correlation_id, "correlation_id"),
    protected_resource: correlation.protected_resource,
    client_id_sha256: optionalSha256(correlation.client_id_sha256, "client_id_sha256"),
    subject_user_sha256: optionalSha256(correlation.subject_user_sha256, "subject_user_sha256"),
    subject_tenant_sha256: optionalSha256(correlation.subject_tenant_sha256, "subject_tenant_sha256"),
    oauth_code_jti_sha256: optionalSha256(correlation.oauth_code_jti_sha256, "oauth_code_jti_sha256"),
    access_token_jti_sha256: optionalSha256(correlation.access_token_jti_sha256, "access_token_jti_sha256"),
    stage_request_id_sha256: optionalSha256(correlation.stage_request_id_sha256, "stage_request_id_sha256"),
    previous_envelope_sha256: optionalSha256(correlation.previous_envelope_sha256, "previous_envelope_sha256"),
    correlation_envelope_sha256: optionalSha256(correlation.envelope_sha256, "correlation_envelope_sha256"),
    redirect_uri_sha256: optionalSha256(input.redirect_uri_sha256, "redirect_uri_sha256"),
    deployment_sha: deploymentSha,
    occurred_at: occurredAt,
    expires_at: expiresAt,
    secrets_included: false,
    canonical_sha256: null,
  };
  evidence.canonical_sha256 = canonicalDigest(evidence);
  return Object.freeze(evidence);
}

export function verifyTenantGptOAuthRecoveryServerEvidence(evidence, {
  expectedOperationId = null,
  expectedCorrelationId = null,
  expectedDeploymentSha = null,
  nowMs = Date.now(),
} = {}) {
  assertAllowedKeys(evidence, EVIDENCE_KEYS, "evidence");
  if (
    evidence.contract !== TENANT_GPT_OAUTH_RECOVERY_SERVER_EVIDENCE_CONTRACT
    || Number(evidence.schema_version) !== 1
    || evidence.source !== "server_owned_oauth_runtime"
    || evidence.environment !== "staging"
    || evidence.secrets_included !== false
  ) {
    fail("oauth_recovery_evidence_contract_invalid", "Recovery evidence contract is invalid.");
  }
  const event = eventName(evidence.event);
  if (evidence.oauth_stage !== EVENT_STAGE[event]) {
    fail("oauth_recovery_evidence_stage_mismatch", "Recovery event does not match its OAuth runtime stage.");
  }
  const operationId = requireUuid(evidence.operation_id, "operation_id");
  const correlationId = requireUuid(evidence.correlation_id, "correlation_id");
  if (expectedOperationId && operationId !== requireUuid(expectedOperationId, "expectedOperationId")) {
    fail("oauth_recovery_evidence_operation_mismatch", "Recovery evidence belongs to another operation.", 409);
  }
  if (expectedCorrelationId && correlationId !== requireUuid(expectedCorrelationId, "expectedCorrelationId")) {
    fail("oauth_recovery_evidence_correlation_mismatch", "Recovery evidence belongs to another correlation.", 409);
  }
  const deploymentSha = requireSha40(evidence.deployment_sha, "deployment_sha");
  if (expectedDeploymentSha && deploymentSha !== requireSha40(expectedDeploymentSha, "expectedDeploymentSha")) {
    fail("oauth_recovery_evidence_deployment_mismatch", "Recovery evidence belongs to another deployment.", 409);
  }
  for (const field of [
    "client_id_sha256",
    "subject_user_sha256",
    "subject_tenant_sha256",
    "oauth_code_jti_sha256",
    "access_token_jti_sha256",
    "stage_request_id_sha256",
    "previous_envelope_sha256",
    "correlation_envelope_sha256",
    "redirect_uri_sha256",
  ]) {
    optionalSha256(evidence[field], field);
  }
  const occurredAt = normalizeTimestamp(evidence.occurred_at, "occurred_at");
  const expiresAt = normalizeTimestamp(evidence.expires_at, "expires_at");
  assertFreshness(occurredAt, expiresAt, nowMs);
  if (
    !SHA256.test(String(evidence.canonical_sha256 || ""))
    || canonicalDigest(evidence) !== evidence.canonical_sha256
  ) {
    fail("oauth_recovery_evidence_canonical_hash_mismatch", "Recovery evidence canonical hash does not match its content.", 409);
  }
  return Object.freeze({ ...evidence });
}

export async function recordTenantGptOAuthRecoveryServerEvidence({
  query,
  input,
  enabled = TENANT_GPT_IS_STAGING_RUNTIME,
  env = process.env,
  nowMs = Date.now(),
} = {}) {
  if (!enabled) {
    return Object.freeze({
      recorded: false,
      reason: "staging_runtime_required",
      production_mutation_performed: false,
      secrets_included: false,
    });
  }
  if (typeof query !== "function") {
    fail("oauth_recovery_evidence_query_required", "A governed execution_log query function is required.", 500);
  }
  const evidence = buildTenantGptOAuthRecoveryServerEvidence(input, { nowMs, env });
  const now = new Date(Number(nowMs));
  await query(
    `INSERT INTO \`execution_log\`
      (run_date, start_time, end_time, duration_seconds, entry_type, execution_class, source_layer,
       execution_status, failure_reason, output_summary, action_key, endpoint_key, parent_action_key,
       runtime_evidence_json, created_at)
     VALUES (?, ?, ?, ?, 'diagnostic', 'oauth', 'tenant_gpt_oauth_recovery_evidence_sink',
       'success', NULL, ?, ?, ?, 'tenant_gpt_oauth_recovery', ?, CURRENT_TIMESTAMP)`,
    [
      now.toISOString().slice(0, 10),
      now.toISOString(),
      now.toISOString(),
      "0.000",
      JSON.stringify({
        ok: true,
        event: evidence.event,
        operation_id: evidence.operation_id,
        correlation_id: evidence.correlation_id,
        secrets_included: false,
      }),
      TENANT_GPT_OAUTH_RECOVERY_SERVER_EVIDENCE_ACTION_KEY,
      `oauth_recovery_${evidence.event}`,
      JSON.stringify(evidence),
    ],
  );
  return Object.freeze({
    recorded: true,
    evidence,
    production_mutation_performed: false,
    secrets_included: false,
  });
}

function rowsFromQueryResult(result) {
  if (Array.isArray(result?.[0])) return result[0];
  if (Array.isArray(result)) return result;
  return [];
}

function parseEvidenceRow(row) {
  const raw = row?.runtime_evidence_json;
  if (raw && typeof raw === "object") return raw;
  try {
    return JSON.parse(String(raw || ""));
  } catch {
    fail("oauth_recovery_evidence_row_invalid", "execution_log contains invalid recovery evidence JSON.", 409);
  }
}

export async function readTenantGptOAuthRecoveryServerEvidence({
  query,
  operation_id,
  correlation_id,
  deployment_sha,
  nowMs = Date.now(),
} = {}) {
  if (typeof query !== "function") {
    fail("oauth_recovery_evidence_query_required", "A governed execution_log query function is required.", 500);
  }
  const operationId = requireUuid(operation_id, "operation_id");
  const correlationId = requireUuid(correlation_id, "correlation_id");
  const deploymentSha = requireSha40(deployment_sha, "deployment_sha");
  const result = await query(
    `SELECT id, runtime_evidence_json
       FROM \`execution_log\`
      WHERE action_key = ?
        AND JSON_UNQUOTE(JSON_EXTRACT(runtime_evidence_json, '$.operation_id')) = ?
        AND JSON_UNQUOTE(JSON_EXTRACT(runtime_evidence_json, '$.correlation_id')) = ?
        AND JSON_UNQUOTE(JSON_EXTRACT(runtime_evidence_json, '$.deployment_sha')) = ?
      ORDER BY id ASC`,
    [
      TENANT_GPT_OAUTH_RECOVERY_SERVER_EVIDENCE_ACTION_KEY,
      operationId,
      correlationId,
      deploymentSha,
    ],
  );
  const byEvent = new Map(
    TENANT_GPT_OAUTH_RECOVERY_SERVER_EVENTS.map((event) => [event, []]),
  );
  for (const row of rowsFromQueryResult(result)) {
    const evidence = verifyTenantGptOAuthRecoveryServerEvidence(parseEvidenceRow(row), {
      expectedOperationId: operationId,
      expectedCorrelationId: correlationId,
      expectedDeploymentSha: deploymentSha,
      nowMs,
    });
    byEvent.get(evidence.event).push({
      row_id: Number(row?.id || 0),
      evidence,
    });
  }

  function matchingNext(prefix, event) {
    const prior = prefix[prefix.length - 1]?.evidence || null;
    return (byEvent.get(event) || []).filter((candidate) =>
      !prior
        || candidate.evidence.previous_envelope_sha256 === prior.correlation_envelope_sha256);
  }

  function completeChains(prefix = [], index = 0) {
    if (index >= TENANT_GPT_OAUTH_RECOVERY_SERVER_EVENTS.length) return [prefix];
    const event = TENANT_GPT_OAUTH_RECOVERY_SERVER_EVENTS[index];
    const candidates = matchingNext(prefix, event);
    if (!candidates.length) return [];
    return candidates.flatMap((candidate) =>
      completeChains([...prefix, candidate], index + 1));
  }

  const chains = completeChains();
  let selected = null;
  if (chains.length) {
    const prefixHashes = new Set(
      chains.map((chain) =>
        chain
          .slice(0, -1)
          .map((item) => item.evidence.canonical_sha256)
          .join(":")),
    );
    if (prefixHashes.size > 1) {
      fail(
        "oauth_recovery_evidence_multiple_chain_conflict",
        "More than one complete server-owned OAuth Recovery chain exists for this operation.",
        409,
      );
    }
    selected = [...chains].sort(
      (left, right) =>
        Number(left[left.length - 1]?.row_id || 0)
        - Number(right[right.length - 1]?.row_id || 0),
    )[0];
  }

  const presentEvents = new Set(
    [...byEvent.entries()]
      .filter(([, candidates]) => candidates.length > 0)
      .map(([event]) => event),
  );
  if (!selected && presentEvents.size === TENANT_GPT_OAUTH_RECOVERY_SERVER_EVENTS.length) {
    fail(
      "oauth_recovery_evidence_chain_mismatch",
      "All Recovery stages are present but they do not form one continuous signed OAuth correlation chain.",
      409,
    );
  }

  const events = selected
    ? selected.map((item) => item.evidence)
    : [];
  return Object.freeze({
    contract: TENANT_GPT_OAUTH_RECOVERY_SERVER_READBACK_CONTRACT,
    operation_id: operationId,
    correlation_id: correlationId,
    deployment_sha: deploymentSha,
    complete: Boolean(selected),
    chain_verified: Boolean(selected),
    missing_events: TENANT_GPT_OAUTH_RECOVERY_SERVER_EVENTS.filter(
      (event) => !presentEvents.has(event),
    ),
    duplicate_observation_counts: Object.fromEntries(
      TENANT_GPT_OAUTH_RECOVERY_SERVER_EVENTS.map((event) => [
        event,
        Math.max(0, (byEvent.get(event) || []).length - 1),
      ]),
    ),
    events,
    production_mutation_performed: false,
    secrets_included: false,
  });
}
