import { createHash, randomUUID } from "node:crypto";
import {
  expectedStagingGatewayDeployment,
  expectedStagingRegistration,
  recoveryExternalEvidenceHash,
  RECOVERY_EXTERNAL_EVIDENCE_CONTRACT,
  verifyRecoveryExternalEvidenceIntegrity,
} from "./recoveryReadinessEvidence.js";
import {
  recoveryExternalSourceProofHash,
} from "./recoveryExternalAcquisitionAuthority.js";
import {
  verifyCustomGptLiveRegistrationReadback,
} from "./customGptLiveRegistrationReadback.js";

export const RECOVERY_OAUTH_CORRELATION_EVENT_SEQUENCE = Object.freeze([
  "authorize_received",
  "login_consent_completed",
  "authorization_code_issued",
  "callback_received",
  "token_exchange_completed",
  "resource_request_verified",
]);

const SHA40 = /^[a-f0-9]{40}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9._:@/-]{8,200}$/u;
const MAX_TTL_MS = 60 * 60 * 1000;
const SECRET_FIELD =
  /^(?:authorization|password|secret|credential|credentials|private[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|api[_-]?key|bearer[_-]?token|authorization[_-]?code)$|(?:^|[_-])(?:password|secret|credential|private[_-]?key|access[_-]?token|refresh[_-]?token|authorization[_-]?code)(?:$|[_-])/iu;
const CAMEL_SECRET_FIELD =
  /(?:Secret|Password|Credential|PrivateKey|AccessToken|RefreshToken|IdToken|ApiKey|BearerToken|AuthorizationCode)(?:$|[A-Z])/u;

const stable = (value) =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, stable(value[key])]),
        )
      : value;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hasSecret(value) {
  return (
    value &&
    typeof value === "object" &&
    Object.entries(value).some(
      ([key, nested]) =>
        (key !== "secrets_included" &&
          (SECRET_FIELD.test(key) || CAMEL_SECRET_FIELD.test(key))) ||
        hasSecret(nested),
    )
  );
}

function fail(code, message = code) {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  error.secrets_included = false;
  throw error;
}

function freshness(observedAt, expiresAt, now = Date.now()) {
  const observed = Date.parse(observedAt || "");
  const expires = Date.parse(expiresAt || "");
  if (
    !Number.isFinite(observed) ||
    !Number.isFinite(expires) ||
    observed > now + 60_000 ||
    expires <= now ||
    expires <= observed ||
    expires - observed > MAX_TTL_MS
  ) {
    fail(
      "RECOVERY_EXTERNAL_EVIDENCE_FRESHNESS_INVALID",
      "External evidence freshness window is invalid.",
    );
  }
}

function baseEvidence(
  kind,
  payload,
  {
    deploymentSha,
    targetFingerprint,
    observationId = `recovery-${kind}:${randomUUID()}`,
    observedAt = new Date().toISOString(),
    expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(),
  } = {},
) {
  const source = {
    registration: ["chatgpt_registration", "chatgpt_live_readback"],
    oauth: ["oauth_browser_round_trip", "oauth_server_correlation"],
    network: ["origin_network_isolation", "independent_network_probe"],
  }[kind];
  if (
    !source ||
    !SHA40.test(deploymentSha || "") ||
    !SHA256.test(targetFingerprint || "") ||
    !SAFE_ID.test(observationId || "")
  ) {
    fail(
      "RECOVERY_EXTERNAL_EVIDENCE_BINDING_INVALID",
      "External evidence binding is invalid.",
    );
  }
  freshness(observedAt, expiresAt);
  if (hasSecret(payload)) {
    fail(
      "RECOVERY_EXTERNAL_EVIDENCE_SECRET_FIELD_FORBIDDEN",
      "Secret-bearing external evidence is forbidden.",
    );
  }
  const base = {
    ...payload,
    contract: RECOVERY_EXTERNAL_EVIDENCE_CONTRACT,
    evidence_kind: source[0],
    source_provenance: {
      source: source[1],
      observation_id: observationId,
    },
    deployment_sha: deploymentSha,
    target_fingerprint: targetFingerprint,
    observed_at: observedAt,
    expires_at: expiresAt,
    secrets_included: false,
  };
  return Object.freeze({
    ...base,
    evidence_hash: recoveryExternalEvidenceHash(base),
  });
}

export async function buildRecoveryRegistrationParityEvidence({
  observedRegistration,
  deploymentSha,
  targetFingerprint,
  observationId,
  observedAt,
  expiresAt,
} = {}) {
  let parity;
  try {
    parity = verifyCustomGptLiveRegistrationReadback({
      observed: observedRegistration,
      expectedHeadSha: deploymentSha,
    });
  } catch (error) {
    fail(
      "RECOVERY_REGISTRATION_PARITY_INVALID",
      error?.message || "Registration parity validation failed.",
    );
  }
  if (parity?.ready !== true) {
    fail(
      "RECOVERY_REGISTRATION_PARITY_INVALID",
      "Live registration parity did not match the exact-head schema.",
    );
  }
  const expected = await expectedStagingRegistration();
  return baseEvidence(
    "registration",
    {
      ...expected,
      observed_in: "chatgpt",
      registration_parity_verified: true,
      registration_parity_contract: parity.contract,
      registration_parity_sha256: sha256(
        JSON.stringify(stable(parity)),
      ),
      source_attestation_available: false,
    },
    {
      deploymentSha,
      targetFingerprint,
      observationId,
      observedAt,
      expiresAt,
    },
  );
}

function normalizeOAuthEvents(events, {
  issuer = "https://dev.mad4b.com",
  resource = "https://activation-dev.mad4b.com",
  redirectOrigin = "https://dev.mad4b.com",
  now = Date.now(),
  freshnessMs = 15 * 60 * 1000,
} = {}) {
  if (!Array.isArray(events) || events.length !== RECOVERY_OAUTH_CORRELATION_EVENT_SEQUENCE.length) {
    fail(
      "RECOVERY_OAUTH_CORRELATION_SEQUENCE_INVALID",
      "OAuth server correlation requires the complete event sequence.",
    );
  }
  if (hasSecret(events)) {
    fail(
      "RECOVERY_OAUTH_CORRELATION_SECRET_FIELD_FORBIDDEN",
      "OAuth correlation evidence must not include tokens, codes, or secrets.",
    );
  }
  const correlationIds = new Set();
  const sessionIds = new Set();
  const clientIds = new Set();
  let previous = -Infinity;
  const normalized = events.map((event, index) => {
    if (
      event?.event !== RECOVERY_OAUTH_CORRELATION_EVENT_SEQUENCE[index] ||
      event?.result !== "pass" ||
      !SAFE_ID.test(event?.correlation_id || "") ||
      !SAFE_ID.test(event?.session_id || "") ||
      !SAFE_ID.test(event?.client_id || "")
    ) {
      fail(
        "RECOVERY_OAUTH_CORRELATION_SEQUENCE_INVALID",
        "OAuth server correlation event identity or order is invalid.",
      );
    }
    const occurred = Date.parse(event.occurred_at || "");
    if (
      !Number.isFinite(occurred) ||
      occurred < now - freshnessMs ||
      occurred > now + 60_000 ||
      occurred < previous
    ) {
      fail(
        "RECOVERY_OAUTH_CORRELATION_FRESHNESS_INVALID",
        "OAuth server correlation event is stale or out of order.",
      );
    }
    previous = occurred;
    correlationIds.add(event.correlation_id);
    sessionIds.add(event.session_id);
    clientIds.add(event.client_id);
    return {
      event: event.event,
      correlation_id: event.correlation_id,
      session_id: event.session_id,
      client_id: event.client_id,
      occurred_at: event.occurred_at,
      result: "pass",
      issuer: event.issuer || issuer,
      resource: event.resource || resource,
      redirect_origin: event.redirect_origin || redirectOrigin,
      event_ref_hash: SHA256.test(event.event_ref_hash || "")
        ? event.event_ref_hash
        : sha256(
            JSON.stringify(
              stable({
                event: event.event,
                correlation_id: event.correlation_id,
                session_id: event.session_id,
                client_id: event.client_id,
                occurred_at: event.occurred_at,
                result: "pass",
              }),
            ),
          ),
    };
  });
  if (
    correlationIds.size !== 1 ||
    sessionIds.size !== 1 ||
    clientIds.size !== 1 ||
    normalized.some(
      (event) =>
        event.issuer !== issuer ||
        event.resource !== resource ||
        event.redirect_origin !== redirectOrigin,
    )
  ) {
    fail(
      "RECOVERY_OAUTH_CORRELATION_BINDING_INVALID",
      "OAuth correlation events must share the same Staging correlation, session, client, issuer, redirect and resource bindings.",
    );
  }
  return normalized;
}

export function buildRecoveryOAuthServerCorrelationEvidence({
  events,
  deploymentSha,
  targetFingerprint,
  observationId,
  observedAt,
  expiresAt,
  issuer = "https://dev.mad4b.com",
  resource = "https://activation-dev.mad4b.com",
  redirectOrigin = "https://dev.mad4b.com",
  now = Date.now(),
} = {}) {
  const normalized = normalizeOAuthEvents(events, {
    issuer,
    resource,
    redirectOrigin,
    now,
  });
  const steps = {
    authorize: "pass",
    login_consent: "pass",
    code: "pass",
    callback: "pass",
    token: "pass",
    resource: "pass",
  };
  return baseEvidence(
    "oauth",
    {
      issuer,
      resource,
      redirect_origin: redirectOrigin,
      server_correlation_verified: true,
      correlation_id: normalized[0].correlation_id,
      session_id: normalized[0].session_id,
      client_id_hash: sha256(normalized[0].client_id),
      event_sequence: normalized.map((event) => event.event),
      event_chain_sha256: sha256(JSON.stringify(stable(normalized))),
      events: normalized,
      steps,
    },
    {
      deploymentSha,
      targetFingerprint,
      observationId,
      observedAt,
      expiresAt,
    },
  );
}

export function verifyRecoveryOAuthServerCorrelationSource(evidence, options = {}) {
  try {
    if (
      evidence?.server_correlation_verified !== true ||
      evidence?.issuer !== "https://dev.mad4b.com" ||
      evidence?.resource !== "https://activation-dev.mad4b.com" ||
      evidence?.redirect_origin !== "https://dev.mad4b.com" ||
      !Array.isArray(evidence?.events)
    ) {
      return Object.freeze({ verified: false, reason_code: "RECOVERY_OAUTH_SOURCE_INVALID", secrets_included: false });
    }
    const normalized = normalizeOAuthEvents(evidence.events, {
      issuer: evidence.issuer,
      resource: evidence.resource,
      redirectOrigin: evidence.redirect_origin,
      now: options.now,
    });
    if (
      evidence.event_chain_sha256 !== sha256(JSON.stringify(stable(normalized))) ||
      !verifyRecoveryExternalEvidenceIntegrity(evidence, {
        kind: "oauth",
        expectedSha: options.expectedSha,
        expectedTargetFingerprint: options.expectedTargetFingerprint,
        now: options.now,
      })
    ) {
      return Object.freeze({ verified: false, reason_code: "RECOVERY_OAUTH_SOURCE_INVALID", secrets_included: false });
    }
    return Object.freeze({
      verified: true,
      evidence_hash: evidence.evidence_hash,
      source_proof_hash: recoveryExternalSourceProofHash(evidence),
      source: "oauth_server_correlation",
      secrets_included: false,
    });
  } catch {
    return Object.freeze({ verified: false, reason_code: "RECOVERY_OAUTH_SOURCE_INVALID", secrets_included: false });
  }
}

export async function buildRecoveryNetworkIsolationEvidence({
  direct,
  gateway,
  deploymentSha,
  targetFingerprint,
  observationId,
  observedAt,
  expiresAt,
} = {}) {
  const expected = await expectedStagingGatewayDeployment();
  const emptyBodyHash = sha256("");
  if (
    direct?.method !== "GET" ||
    gateway?.method !== "GET" ||
    direct?.path !== "/admin/recovery/staging/contract" ||
    gateway?.path !== direct.path ||
    direct?.body_sha256 !== emptyBodyHash ||
    gateway?.body_sha256 !== direct.body_sha256 ||
    direct?.status !== 403 ||
    direct?.reason !== "RECOVERY_TRUSTED_INGRESS_REQUIRED" ||
    !Number.isInteger(gateway?.status) ||
    gateway.status < 200 ||
    gateway.status >= 300
  ) {
    fail(
      "RECOVERY_NETWORK_SOURCE_INVALID",
      "Network acquisition requires the same GET request, explicit trusted-ingress denial, and signed Gateway 2xx.",
    );
  }
  return baseEvidence(
    "network",
    {
      environment: "staging",
      gateway_host: expected.gateway_host,
      upstream_origin: expected.upstream_origin,
      gateway_only: true,
      signed_ingress_required: true,
      network_restriction_verified: true,
      direct_recovery_surface_bypass_denied: true,
      request_method: direct.method,
      request_body_sha256: direct.body_sha256,
      direct_recovery_surface_status: direct.status,
      direct_recovery_surface_reason: direct.reason,
      direct_recovery_surface_path: direct.path,
      signed_gateway_recovery_path: gateway.path,
      signed_gateway_recovery_method: gateway.method,
      signed_gateway_recovery_body_sha256: gateway.body_sha256,
      signed_gateway_recovery_status: gateway.status,
      public_health_status: gateway.public_health_status ?? null,
    },
    {
      deploymentSha,
      targetFingerprint,
      observationId,
      observedAt,
      expiresAt,
    },
  );
}

export function verifyRecoveryNetworkIsolationSource(evidence, options = {}) {
  const valid = verifyRecoveryExternalEvidenceIntegrity(evidence, {
    kind: "network",
    expectedSha: options.expectedSha,
    expectedTargetFingerprint: options.expectedTargetFingerprint,
    now: options.now,
  });
  if (
    !valid ||
    evidence?.direct_recovery_surface_status !== 403 ||
    evidence?.direct_recovery_surface_reason !==
      "RECOVERY_TRUSTED_INGRESS_REQUIRED"
  ) {
    return Object.freeze({
      verified: false,
      reason_code: "RECOVERY_NETWORK_SOURCE_INVALID",
      secrets_included: false,
    });
  }
  return Object.freeze({
    verified: true,
    evidence_hash: evidence.evidence_hash,
    source_proof_hash: recoveryExternalSourceProofHash(evidence),
    source: "independent_network_probe",
    secrets_included: false,
  });
}

export function unavailableRegistrationSourceVerification(registrationEvidence) {
  return Object.freeze({
    verified: false,
    reason_code: "RECOVERY_REGISTRATION_SOURCE_ATTESTATION_UNAVAILABLE",
    evidence_hash: registrationEvidence?.evidence_hash || null,
    source_proof_hash: registrationEvidence
      ? recoveryExternalSourceProofHash(registrationEvidence)
      : null,
    source: "chatgpt_live_readback",
    secrets_included: false,
  });
}
