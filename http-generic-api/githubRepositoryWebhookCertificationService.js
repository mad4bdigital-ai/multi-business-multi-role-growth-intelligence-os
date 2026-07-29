import { stableCapabilityHash } from "./dynamicCapabilityGovernanceCompiler.js";

const CERTIFICATION_TTL_DAYS = 90;
const CERTIFICATION_TYPE = "provider_external_write_readback";
const CERTIFICATION_STATUS = "same_cycle_readback_certified";
const EVIDENCE_TYPE = "provider_signed_delivery_and_configuration_readback";
const EVIDENCE_REASON = "GITHUB_WEBHOOK_SIGNED_PING_AND_READBACK_PASSED";

function text(value = "", max = 2048) {
  return String(value ?? "").trim().slice(0, max);
}

function fail(code, message, status = 409, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = { ...details, secrets_included: false };
  throw error;
}

function ids(capabilityBindingId, environment, envelopeId) {
  return {
    evidenceId: `github-webhook-readback:${envelopeId}`,
    certificationId: `github-webhook:${capabilityBindingId}:${environment}`,
  };
}

function buildEvidencePayload(input) {
  return {
    version: "github-repository-webhook-certification-v1",
    capability_key: input.capability.capability_key,
    capability_binding_id: input.capability.capability_binding_id,
    capability_binding_key: input.capability.capability_binding_key,
    repository_binding_id: input.authority.binding_id,
    repository_binding_key: input.authority.binding_key,
    repository_node_id: input.authority.repository_node_id || null,
    repository_external_id: input.authority.repository_external_id || null,
    repository: `${input.authority.canonical_owner}/${input.authority.canonical_name}`,
    environment: input.authority.environment,
    resource_uri: input.governance.resource_uri,
    expected_commit_sha: input.expectedCommitSha,
    binding_sha256: input.bindingSha256,
    capability_sha256: input.capabilitySha256,
    capability_envelope_id: input.governance.envelope_id,
    hook: {
      id: Number(input.hook.id || input.hook.hook_id || 0),
      callback_url: input.hook.callback_url,
      events: Array.isArray(input.hook.events) ? [...input.hook.events].sort() : [],
      active: input.hook.active === true,
      content_type: input.hook.content_type || null,
      insecure_ssl: input.hook.insecure_ssl || null,
    },
    signed_ping: {
      delivery_id: input.ping.delivery_id || null,
      event: input.ping.event || "ping",
      status_code: Number(input.ping.status_code || 0),
      signature_verified: true,
    },
    verification: {
      signed_ping_status_required: 200,
      hook_readback_matched: true,
      credential_reference_validation_marked: true,
      secrets_included: false,
    },
    secrets_included: false,
  };
}

export async function recordGithubRepositoryWebhookCertification(input = {}, deps = {}) {
  const pool = deps.pool || input.pool;
  if (!pool || typeof pool.getConnection !== "function") {
    fail("github_webhook_certification_pool_required", "A transactional database pool is required for evidence certification.", 500);
  }
  const authority = input.authority || {};
  const capability = input.capability || {};
  const governance = input.governance || {};
  const environment = text(authority.environment || "production", 64);
  const envelopeId = text(governance.envelope_id, 36);
  const capabilityBindingId = text(capability.capability_binding_id, 36);
  const bindingId = text(authority.binding_id, 36);
  const capabilityKey = text(capability.capability_key, 191);
  const expectedCommitSha = text(input.expectedCommitSha, 40).toLowerCase();
  const bindingSha256 = text(input.bindingSha256, 64).toLowerCase();
  const capabilitySha256 = text(input.capabilitySha256, 64).toLowerCase();
  if (!envelopeId || !capabilityBindingId || !bindingId || !capabilityKey) {
    fail("github_webhook_certification_context_incomplete", "Repository binding, capability binding, and envelope identifiers are required.");
  }
  if (!/^[0-9a-f]{40}$/.test(expectedCommitSha) || !/^[0-9a-f]{64}$/.test(bindingSha256) || !/^[0-9a-f]{64}$/.test(capabilitySha256)) {
    fail("github_webhook_certification_fingerprint_invalid", "Commit and repository planning fingerprints are required for certification.");
  }
  if (Number(input?.ping?.status_code || 0) !== 200 || input?.hook?.active !== true) {
    fail("github_webhook_certification_readback_not_verified", "Signed ping and active hook readback are required before certification.");
  }

  const { evidenceId, certificationId } = ids(capabilityBindingId, environment, envelopeId);
  const payload = buildEvidencePayload({
    ...input,
    authority,
    capability,
    governance,
    expectedCommitSha,
    bindingSha256,
    capabilitySha256,
  });
  const payloadHash = stableCapabilityHash(payload);
  const sourceSha = stableCapabilityHash({ expectedCommitSha, bindingSha256, capabilitySha256 });
  const hookId = Number(input.hook.id || input.hook.hook_id || 0);
  const sourceRef = `github_hook:${hookId}:delivery:${text(input.ping.delivery_id, 191) || "unknown"}`;
  const certificationMetadata = {
    version: "github-repository-webhook-certification-v1",
    repository_binding_id: bindingId,
    repository_binding_key: authority.binding_key,
    capability_binding_id: capabilityBindingId,
    capability_binding_key: capability.capability_binding_key,
    environment,
    resource_uri: governance.resource_uri,
    binding_sha256: bindingSha256,
    capability_sha256: capabilitySha256,
    expected_commit_sha: expectedCommitSha,
    latest_hook_id: hookId,
    latest_ping_delivery_id: input.ping.delivery_id || null,
    scope: "repository_capability_binding_and_environment",
    runtime_dispatch_changed: false,
    runtime_apply_changed: false,
    secrets_included: false,
  };

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query(
      `INSERT INTO platform_evidence_events
        (evidence_id,evidence_type,subject_type,subject_key,capability_key,envelope_id,binding_id,
         certification_id,source_system,source_ref,source_sha,evidence_status,reason_code,payload_hash,
         evidence_json,observed_at,expires_at,revoked_at,supersedes_evidence_id,secrets_included)
       VALUES (?,?, 'repository_capability_binding', ?,?,?,?,?, 'github',?,?,'passed',?,?,?,CURRENT_TIMESTAMP,
               DATE_ADD(CURRENT_TIMESTAMP,INTERVAL ? DAY),NULL,NULL,0)
       ON DUPLICATE KEY UPDATE
         capability_key=VALUES(capability_key),envelope_id=VALUES(envelope_id),binding_id=VALUES(binding_id),
         certification_id=VALUES(certification_id),source_system='github',source_ref=VALUES(source_ref),
         source_sha=VALUES(source_sha),evidence_status='passed',reason_code=VALUES(reason_code),
         payload_hash=VALUES(payload_hash),evidence_json=VALUES(evidence_json),observed_at=CURRENT_TIMESTAMP,
         expires_at=VALUES(expires_at),revoked_at=NULL,secrets_included=0,updated_at=CURRENT_TIMESTAMP`,
      [
        evidenceId,
        EVIDENCE_TYPE,
        capabilityBindingId,
        capabilityKey,
        envelopeId,
        bindingId,
        certificationId,
        sourceRef,
        sourceSha,
        EVIDENCE_REASON,
        payloadHash,
        JSON.stringify(payload),
        CERTIFICATION_TTL_DAYS,
      ],
    );
    await connection.query(
      `INSERT INTO platform_capability_certifications
        (certification_id,capability_key,certification_type,environment,subject_type,subject_key,
         certification_status,evidence_id,source_registry,source_key,certified_at,expires_at,
         revoked_at,metadata_json,secrets_included)
       VALUES (?,?,?,?,'repository_capability_binding',?,?,?,?,?,CURRENT_TIMESTAMP,
               DATE_ADD(CURRENT_TIMESTAMP,INTERVAL ? DAY),NULL,?,0)
       ON DUPLICATE KEY UPDATE
         capability_key=VALUES(capability_key),certification_type=VALUES(certification_type),
         environment=VALUES(environment),subject_type='repository_capability_binding',
         subject_key=VALUES(subject_key),certification_status=VALUES(certification_status),
         evidence_id=VALUES(evidence_id),source_registry=VALUES(source_registry),source_key=VALUES(source_key),
         certified_at=CURRENT_TIMESTAMP,expires_at=VALUES(expires_at),revoked_at=NULL,
         metadata_json=VALUES(metadata_json),secrets_included=0,updated_at=CURRENT_TIMESTAMP`,
      [
        certificationId,
        capabilityKey,
        CERTIFICATION_TYPE,
        environment,
        capabilityBindingId,
        CERTIFICATION_STATUS,
        evidenceId,
        "repository_capability_bindings",
        capability.capability_binding_key,
        CERTIFICATION_TTL_DAYS,
        JSON.stringify(certificationMetadata),
      ],
    );
    const [evidenceRows] = await connection.query(
      `SELECT evidence_id,evidence_status,payload_hash,secrets_included
         FROM platform_evidence_events WHERE evidence_id=? LIMIT 1`,
      [evidenceId],
    );
    const [certificationRows] = await connection.query(
      `SELECT certification_id,certification_status,evidence_id,subject_type,subject_key,
              environment,secrets_included
         FROM platform_capability_certifications WHERE certification_id=? LIMIT 1`,
      [certificationId],
    );
    const evidence = evidenceRows?.[0] || null;
    const certification = certificationRows?.[0] || null;
    if (
      evidence?.evidence_status !== "passed"
      || evidence?.payload_hash !== payloadHash
      || Number(evidence?.secrets_included || 0) !== 0
      || certification?.certification_status !== CERTIFICATION_STATUS
      || certification?.evidence_id !== evidenceId
      || certification?.subject_type !== "repository_capability_binding"
      || certification?.subject_key !== capabilityBindingId
      || certification?.environment !== environment
      || Number(certification?.secrets_included || 0) !== 0
    ) {
      fail("github_webhook_certification_readback_failed", "Transactional evidence and certification readback did not match the verified webhook result.", 500);
    }
    await connection.commit();
    return {
      ok: true,
      evidence_id: evidenceId,
      certification_id: certificationId,
      certification_type: CERTIFICATION_TYPE,
      certification_status: CERTIFICATION_STATUS,
      environment,
      payload_hash: payloadHash,
      expires_in_days: CERTIFICATION_TTL_DAYS,
      runtime_dispatch_changed: false,
      runtime_apply_changed: false,
      secrets_included: false,
    };
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
}

export const __test__ = {
  CERTIFICATION_TTL_DAYS,
  CERTIFICATION_TYPE,
  CERTIFICATION_STATUS,
  EVIDENCE_TYPE,
  EVIDENCE_REASON,
  ids,
  buildEvidencePayload,
};
