import { getPool } from "./db.js";
import {
  capabilityEnvelopeError,
  markCapabilityEnvelopeReferenced,
  resolveCapabilityExecutionEnvelope,
} from "./capabilityResolutionEnvelopeGuard.js";
import { stableCapabilityHash } from "./dynamicCapabilityGovernanceCompiler.js";

export const PLATFORM_CAPABILITY_SHADOW_CERTIFICATION_VERSION =
  "platform-capability-shadow-certification-v1";
export const PLATFORM_CAPABILITY_SHADOW_CERTIFICATION_CONFIRM =
  "ISSUE_SHADOW_CERTIFICATION_TENANT_CONNECTION_EFFECTIVE_CREDENTIAL_PLAN_VIEW";

const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const APP_KEY = "platform_orchestration";
const OPERATION_INTENTS = Object.freeze([
  "platform_capability_shadow_certification_issue",
  "internal_registry_write",
]);
const LOCK_KEY = "shadow_cert:tenant_connection_effective_credential_plan_view";
const CAPABILITY_KEY = "tenant_tool.tenant_connection_effective_credential_plan_view";
const TOOL_KEY = "tenant_connection_effective_credential_plan_view";
const CONTRACT_KEY = "tenant_connection_effective_credential_plan_view_readback_v1";
const ADAPTER_KEY = "tenant_connection_self_repair_routes_v1";
const CERTIFICATION_ID = "shadow-cert:tenant-connection-effective-credential-plan-view:v1";
const EVIDENCE_ID = "shadow-cert-evidence:tenant-connection-effective-credential-plan-view:v1";
const CERTIFICATION_STATUS = "shadow_certified";
const CERTIFICATION_TTL_DAYS = 7;

const FIXED_PLAN = Object.freeze({
  capability_key: CAPABILITY_KEY,
  tool_key: TOOL_KEY,
  contract_key: CONTRACT_KEY,
  adapter_key: ADAPTER_KEY,
  certification_id: CERTIFICATION_ID,
  evidence_id: EVIDENCE_ID,
  certification_type: "shadow_read_only",
  certification_status: CERTIFICATION_STATUS,
  contract_status_required: "shadow",
  contract_certification_status_after: CERTIFICATION_STATUS,
  effect_class_required: "read_only",
  tenant_tool_enabled_after: false,
  runtime_dispatch_changed: false,
  active_tenant_exports_created: false,
  provider_calls_allowed: false,
  external_writes_allowed: false,
  secrets_included: false,
});

function fail(code, message, status = 400, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = { ...details, secrets_included: false };
  throw error;
}

function normalizeMode(value) {
  const mode = String(value || "dry_run").trim().toLowerCase();
  if (!["dry_run", "apply"].includes(mode)) {
    fail("platform_capability_shadow_certification_mode_invalid", "mode must be dry_run or apply.");
  }
  return mode;
}

function requireConfirmation(value) {
  if (String(value || "").trim() !== PLATFORM_CAPABILITY_SHADOW_CERTIFICATION_CONFIRM) {
    fail(
      "platform_capability_shadow_certification_confirmation_required",
      `Typed confirmation ${PLATFORM_CAPABILITY_SHADOW_CERTIFICATION_CONFIRM} is required.`,
      400,
      { expected_confirmation: PLATFORM_CAPABILITY_SHADOW_CERTIFICATION_CONFIRM },
    );
  }
}

function planHash() {
  return stableCapabilityHash({
    version: PLATFORM_CAPABILITY_SHADOW_CERTIFICATION_VERSION,
    plan: FIXED_PLAN,
  });
}

async function loadState(pool) {
  const [adapterRows] = await pool.query(
    `SELECT adapter_key,supports_read,supports_write,status,metadata_json
       FROM platform_resource_adapters
      WHERE adapter_key=? LIMIT 1`,
    [ADAPTER_KEY],
  );
  const [contractRows] = await pool.query(
    `SELECT contract_id,contract_key,contract_version,capability_key,adapter_key,
            expected_effect_class,certification_status,status,is_current,secrets_included,
            source_registry,source_key,valid_from,expires_at,revoked_at
       FROM platform_capability_readback_contracts
      WHERE contract_key=? AND is_current=1 LIMIT 1`,
    [CONTRACT_KEY],
  );
  const [toolRows] = await pool.query(
    `SELECT tool_key,is_enabled FROM tenant_platform_endpoint_tools
      WHERE tool_key=? LIMIT 1`,
    [TOOL_KEY],
  );
  const [certificationRows] = await pool.query(
    `SELECT certification_id,capability_key,certification_type,environment,
            subject_type,subject_key,certification_status,evidence_id,
            source_registry,source_key,certified_at,expires_at,revoked_at,
            metadata_json,secrets_included
       FROM platform_capability_certifications
      WHERE certification_id=? LIMIT 1`,
    [CERTIFICATION_ID],
  );
  const [evidenceRows] = await pool.query(
    `SELECT evidence_id,evidence_type,subject_type,subject_key,capability_key,
            envelope_id,certification_id,source_system,source_ref,evidence_status,
            reason_code,payload_hash,observed_at,expires_at,revoked_at,secrets_included
       FROM platform_evidence_events
      WHERE evidence_id=? LIMIT 1`,
    [EVIDENCE_ID],
  );
  const [exportRows] = await pool.query(
    `SELECT export_key,capability_key,export_status,exposure_scope
       FROM platform_plugin_capability_exports
      WHERE capability_key=? AND export_status='active'`,
    [CAPABILITY_KEY],
  );
  const [runtimeRows] = await pool.query(
    `SELECT certification_key,surface_key,tool_or_action_key,dispatch_allowed,apply_allowed
       FROM runtime_dispatch_certification_registry
      WHERE certification_key IN (?,?,?)
         OR surface_key IN (?,?,?)
         OR tool_or_action_key IN (?,?,?)`,
    [CAPABILITY_KEY, TOOL_KEY, ADAPTER_KEY, CAPABILITY_KEY, TOOL_KEY, ADAPTER_KEY, CAPABILITY_KEY, TOOL_KEY, ADAPTER_KEY],
  );
  return {
    adapter: adapterRows?.[0] || null,
    contract: contractRows?.[0] || null,
    tool: toolRows?.[0] || null,
    certification: certificationRows?.[0] || null,
    evidence: evidenceRows?.[0] || null,
    active_exports: exportRows || [],
    runtime_certifications: runtimeRows || [],
  };
}

function boundedState(state) {
  return {
    adapter_present: Boolean(state.adapter),
    adapter_supports_write: Boolean(Number(state.adapter?.supports_write || 0)),
    adapter_status: state.adapter?.status || null,
    contract_present: Boolean(state.contract),
    contract_status: state.contract?.status || null,
    contract_certification_status: state.contract?.certification_status || null,
    certification_present: Boolean(state.certification),
    certification_status: state.certification?.certification_status || null,
    evidence_present: Boolean(state.evidence),
    evidence_status: state.evidence?.evidence_status || null,
    tool_enabled: Boolean(Number(state.tool?.is_enabled || 0)),
    active_tenant_export_count: state.active_exports.length,
    runtime_dispatch_allowed_count: state.runtime_certifications.filter((row) => Number(row.dispatch_allowed || 0) === 1).length,
    runtime_apply_allowed_count: state.runtime_certifications.filter((row) => Number(row.apply_allowed || 0) === 1).length,
    secrets_included: false,
  };
}

function verifyPreconditions(state) {
  const errors = [];
  if (!state.adapter) errors.push("ADAPTER_REQUIRED");
  if (state.adapter && Number(state.adapter.supports_write || 0) !== 0) errors.push("ADAPTER_MUST_NOT_SUPPORT_WRITE");
  if (state.adapter && state.adapter.status !== "active") errors.push("ADAPTER_INACTIVE");
  if (!state.contract) errors.push("READBACK_CONTRACT_REQUIRED");
  if (state.contract && state.contract.capability_key !== CAPABILITY_KEY) errors.push("CONTRACT_CAPABILITY_MISMATCH");
  if (state.contract && state.contract.adapter_key !== ADAPTER_KEY) errors.push("CONTRACT_ADAPTER_MISMATCH");
  if (state.contract && state.contract.expected_effect_class !== "read_only") errors.push("CONTRACT_EFFECT_CLASS_MISMATCH");
  if (state.contract && state.contract.status !== "shadow") errors.push("CONTRACT_MUST_REMAIN_SHADOW");
  if (state.contract && !["pending", CERTIFICATION_STATUS].includes(state.contract.certification_status)) {
    errors.push("CONTRACT_CERTIFICATION_STATUS_INVALID");
  }
  if (state.contract && Number(state.contract.secrets_included || 0) !== 0) errors.push("CONTRACT_SECRET_POLICY_VIOLATION");
  if (!state.tool) errors.push("TENANT_TOOL_REQUIRED");
  if (state.tool && Number(state.tool.is_enabled || 0) !== 0) errors.push("TENANT_TOOL_MUST_REMAIN_DISABLED");
  if (state.active_exports.length) errors.push("ACTIVE_TENANT_EXPORT_FORBIDDEN");
  if (state.runtime_certifications.some((row) => Number(row.dispatch_allowed || 0) === 1)) {
    errors.push("RUNTIME_DISPATCH_MUST_REMAIN_DISABLED");
  }
  return errors;
}

function verifyReadback(state) {
  const errors = verifyPreconditions(state);
  if (!state.certification) errors.push("SHADOW_CERTIFICATION_MISSING");
  if (state.certification && state.certification.capability_key !== CAPABILITY_KEY) errors.push("CERTIFICATION_CAPABILITY_MISMATCH");
  if (state.certification && state.certification.certification_status !== CERTIFICATION_STATUS) errors.push("CERTIFICATION_STATUS_MISMATCH");
  if (state.certification && state.certification.certification_type !== "shadow_read_only") errors.push("CERTIFICATION_TYPE_MISMATCH");
  if (state.certification && Number(state.certification.secrets_included || 0) !== 0) errors.push("CERTIFICATION_SECRET_POLICY_VIOLATION");
  if (!state.evidence) errors.push("CERTIFICATION_EVIDENCE_MISSING");
  if (state.evidence && state.evidence.evidence_status !== "passed") errors.push("CERTIFICATION_EVIDENCE_NOT_PASSED");
  if (state.evidence && Number(state.evidence.secrets_included || 0) !== 0) errors.push("EVIDENCE_SECRET_POLICY_VIOLATION");
  if (state.contract && state.contract.certification_status !== CERTIFICATION_STATUS) errors.push("CONTRACT_CERTIFICATION_NOT_LINKED");
  return { ok: errors.length === 0, errors, ...boundedState(state) };
}

export async function issuePlatformCapabilityShadowCertification(args = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const mode = normalizeMode(args.mode);
  const expectedPlanHash = planHash();
  const before = await loadState(pool);
  const preconditionErrors = verifyPreconditions(before);

  if (mode === "dry_run") {
    return {
      ok: true,
      report_type: "platform_capability_shadow_certification_issue",
      version: PLATFORM_CAPABILITY_SHADOW_CERTIFICATION_VERSION,
      mode,
      plan_hash: expectedPlanHash,
      expected_confirmation: PLATFORM_CAPABILITY_SHADOW_CERTIFICATION_CONFIRM,
      target: FIXED_PLAN,
      current_state: boundedState(before),
      precondition_errors: preconditionErrors,
      apply_ready: preconditionErrors.length === 0,
      apply_requires_capability_envelope: true,
      mutations_performed: false,
      runtime_dispatch_changed: false,
      provider_calls_performed: false,
      external_writes_performed: false,
      tenant_authority_changed: false,
      secrets_included: false,
    };
  }

  requireConfirmation(args.confirm);
  if (preconditionErrors.length) {
    fail("platform_capability_shadow_certification_preconditions_failed", "Shadow certification preconditions failed.", 409, {
      blockers: preconditionErrors,
    });
  }
  if (args.expected_plan_hash && String(args.expected_plan_hash).toLowerCase() !== expectedPlanHash) {
    fail("platform_capability_shadow_certification_plan_hash_mismatch", "The fixed certification plan hash changed.", 409, {
      expected_plan_hash: args.expected_plan_hash,
      observed_plan_hash: expectedPlanHash,
    });
  }
  const capabilityEnvelopeId = String(args.capability_envelope_id || "").trim();
  if (!capabilityEnvelopeId) {
    fail("platform_capability_shadow_certification_envelope_required", "capability_envelope_id is required for apply.");
  }

  const resolveEnvelope = deps.resolveEnvelope || resolveCapabilityExecutionEnvelope;
  const resolvedEnvelope = await resolveEnvelope({
    pool,
    envelopeId: capabilityEnvelopeId,
    source: { capability_envelope_id: capabilityEnvelopeId },
    acceptedAppKeys: [APP_KEY],
    acceptedIntents: OPERATION_INTENTS,
    expectedTenantId: deps.auth?.tenant_id || PLATFORM_TENANT_ID,
    expectedUserId: deps.auth?.user_id || "",
    requireReadyForDispatch: true,
    requireDispatchAllowed: true,
    requireNoApprovalRequired: true,
    requireNoBlockingGaps: true,
    requireNoSecrets: true,
  });
  if (!resolvedEnvelope?.ok) {
    throw capabilityEnvelopeError(resolvedEnvelope, "Shadow certification requires an approved platform_orchestration envelope.");
  }
  if (!resolvedEnvelope.apply_allowed) {
    fail("platform_capability_shadow_certification_apply_not_authorized", "The capability envelope is not apply-authorized.", 403);
  }

  const connection = await pool.getConnection();
  let lockAcquired = false;
  try {
    const [lockRows] = await connection.query("SELECT GET_LOCK(?, 10) AS acquired", [LOCK_KEY]);
    lockAcquired = Number(lockRows?.[0]?.acquired || 0) === 1;
    if (!lockAcquired) fail("platform_capability_shadow_certification_locked", "Another certification issue is active.", 409);

    await connection.beginTransaction();
    const lockedState = await loadState(connection);
    const lockedErrors = verifyPreconditions(lockedState);
    if (lockedErrors.length) {
      fail("platform_capability_shadow_certification_preconditions_changed", "Certification preconditions changed before apply.", 409, {
        blockers: lockedErrors,
      });
    }

    const payload = {
      version: PLATFORM_CAPABILITY_SHADOW_CERTIFICATION_VERSION,
      plan_hash: expectedPlanHash,
      capability_key: CAPABILITY_KEY,
      tool_key: TOOL_KEY,
      contract_key: CONTRACT_KEY,
      adapter_key: ADAPTER_KEY,
      contract_status_after: "shadow",
      contract_certification_status_after: CERTIFICATION_STATUS,
      tenant_tool_enabled_after: false,
      runtime_dispatch_changed: false,
      provider_calls_performed: false,
      external_writes_performed: false,
      secrets_included: false,
    };
    const payloadHash = stableCapabilityHash(payload);
    const metadata = {
      ...payload,
      certification_scope: "preview_only",
      apply_certification_granted: false,
      runtime_dispatch_allowed: false,
      active_tenant_export_created: false,
    };

    await connection.query(
      `INSERT INTO platform_evidence_events
        (evidence_id,evidence_type,subject_type,subject_key,capability_key,envelope_id,
         certification_id,source_system,source_ref,evidence_status,reason_code,payload_hash,
         evidence_json,observed_at,expires_at,revoked_at,secrets_included)
       VALUES (?,?,?,?,?,?,?,?,?,'passed','SHADOW_READ_ONLY_CERTIFICATION',?,?,CURRENT_TIMESTAMP,
               DATE_ADD(CURRENT_TIMESTAMP,INTERVAL ? DAY),NULL,0)
       ON DUPLICATE KEY UPDATE
         envelope_id=VALUES(envelope_id),certification_id=VALUES(certification_id),
         evidence_status='passed',reason_code=VALUES(reason_code),payload_hash=VALUES(payload_hash),
         evidence_json=VALUES(evidence_json),observed_at=CURRENT_TIMESTAMP,
         expires_at=VALUES(expires_at),revoked_at=NULL,secrets_included=0,updated_at=CURRENT_TIMESTAMP`,
      [
        EVIDENCE_ID,
        "shadow_certification_verification",
        "tenant_platform_endpoint_tool",
        TOOL_KEY,
        CAPABILITY_KEY,
        capabilityEnvelopeId,
        CERTIFICATION_ID,
        "mysql_primary",
        `platform_capability_readback_contracts:${CONTRACT_KEY}`,
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
       VALUES (?,?,?,'production','tenant_platform_endpoint_tool',?,?,?,
               'platform_capability_readback_contracts',?,CURRENT_TIMESTAMP,
               DATE_ADD(CURRENT_TIMESTAMP,INTERVAL ? DAY),NULL,?,0)
       ON DUPLICATE KEY UPDATE
         capability_key=VALUES(capability_key),certification_type=VALUES(certification_type),
         environment='production',subject_type=VALUES(subject_type),subject_key=VALUES(subject_key),
         certification_status=VALUES(certification_status),evidence_id=VALUES(evidence_id),
         source_registry=VALUES(source_registry),source_key=VALUES(source_key),
         certified_at=CURRENT_TIMESTAMP,expires_at=VALUES(expires_at),revoked_at=NULL,
         metadata_json=VALUES(metadata_json),secrets_included=0,updated_at=CURRENT_TIMESTAMP`,
      [
        CERTIFICATION_ID,
        CAPABILITY_KEY,
        "shadow_read_only",
        TOOL_KEY,
        CERTIFICATION_STATUS,
        EVIDENCE_ID,
        CONTRACT_KEY,
        CERTIFICATION_TTL_DAYS,
        JSON.stringify(metadata),
      ],
    );

    const [contractUpdate] = await connection.query(
      `UPDATE platform_capability_readback_contracts
          SET certification_status=?,updated_at=CURRENT_TIMESTAMP
        WHERE contract_key=? AND is_current=1 AND status='shadow'
          AND capability_key=? AND adapter_key=? AND expected_effect_class='read_only'
          AND secrets_included=0`,
      [CERTIFICATION_STATUS, CONTRACT_KEY, CAPABILITY_KEY, ADAPTER_KEY],
    );
    if (Number(contractUpdate?.affectedRows || 0) !== 1) {
      fail("platform_capability_shadow_certification_contract_update_failed", "Exactly one shadow contract must be updated.", 409);
    }

    const readback = await loadState(connection);
    const verified = verifyReadback(readback);
    if (!verified.ok) {
      fail("platform_capability_shadow_certification_readback_failed", "Transactional readback did not match the fixed shadow certification plan.", 500, verified);
    }

    await connection.commit();
    const markReferenced = deps.markReferenced || markCapabilityEnvelopeReferenced;
    const envelopeReadback = await markReferenced({
      pool,
      envelopeId: capabilityEnvelopeId,
      executionRef: `platform-capability-shadow-certification:${expectedPlanHash.slice(0, 16)}`,
    });
    if (!envelopeReadback?.ok) {
      fail("platform_capability_shadow_certification_envelope_readback_failed", "Certification committed but envelope reference readback failed.", 500);
    }

    return {
      ok: true,
      report_type: "platform_capability_shadow_certification_issue",
      version: PLATFORM_CAPABILITY_SHADOW_CERTIFICATION_VERSION,
      mode,
      plan_hash: expectedPlanHash,
      certification_id: CERTIFICATION_ID,
      evidence_id: EVIDENCE_ID,
      readback: verified,
      envelope_readback: envelopeReadback,
      mutations_performed: true,
      runtime_dispatch_changed: false,
      provider_calls_performed: false,
      external_writes_performed: false,
      tenant_authority_changed: false,
      active_tenant_exports_created: false,
      secrets_included: false,
    };
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    if (lockAcquired) {
      try { await connection.query("SELECT RELEASE_LOCK(?) AS released", [LOCK_KEY]); } catch {}
    }
    connection.release();
  }
}

export const _testingPlatformCapabilityShadowCertification = Object.freeze({
  CAPABILITY_KEY,
  TOOL_KEY,
  CONTRACT_KEY,
  ADAPTER_KEY,
  CERTIFICATION_ID,
  EVIDENCE_ID,
  FIXED_PLAN,
  planHash,
  verifyPreconditions,
  verifyReadback,
});
