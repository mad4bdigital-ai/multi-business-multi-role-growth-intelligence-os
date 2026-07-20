import { getPool } from "./db.js";
import {
  capabilityEnvelopeError,
  markCapabilityEnvelopeReferenced,
  resolveCapabilityExecutionEnvelope,
} from "./capabilityResolutionEnvelopeGuard.js";
import { stableCapabilityHash } from "./dynamicCapabilityGovernanceCompiler.js";

export const GITHUB_FILE_PATCH_SHADOW_CERTIFICATION_VERSION =
  "github-file-patch-shadow-certification-v1";
export const GITHUB_FILE_PATCH_SHADOW_CERTIFICATION_CONFIRM =
  "ISSUE_SHADOW_CERTIFICATION_GITHUB_FILE_PATCH_APPLY";

const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";
const APP_KEY = "platform_orchestration";
const OPERATION_INTENTS = Object.freeze([
  "github_file_patch_shadow_certification_issue",
  "internal_registry_write",
]);
const LOCK_KEY = "shadow_cert:github_file_patch_apply";
const CAPABILITY_KEY = "github_file_patch_apply";
const ADAPTER_KEY = "repository_change_set_apply";
const CONTRACT_KEY = "github_file_patch_apply__github_change_set_branch_head_v1__52d0eb30144b4bb4";
const RUNTIME_CERTIFICATION_KEY = "github_file_patch_apply_after_review";
const CERTIFICATION_ID = "shadow-cert:github-file-patch-apply:v1";
const ACK_EVIDENCE_ID = "shadow-cert-ack:github-file-patch-apply:v1";
const VERIFY_EVIDENCE_ID = "shadow-cert-verify:github-file-patch-apply:v1";
const WRITE_ENVELOPE_ID = "71024f58-21fa-45b5-83f2-a75d05694f92";
const CLEANUP_ENVELOPE_ID = "bb74693c-2b7b-4f05-a391-a918fab67cfa";
const WRITE_BINDING_ID = "814a84a3-3f06-4000-aa92-87c0714ff7ae";
const CLEANUP_BINDING_ID = "68f191de-c8bf-40de-9723-ed520f7b8799";
const WRITE_EXECUTION_REF = "3de5e578102ab1921e233abcda3dee77535c103b";
const CLEANUP_EXECUTION_REF = "0a77bd528150939db7bd4ba1f07490cbc458edc5";
const SMOKE_BLOB_SHA = "1cfe465f2e278172bd4b2d3c93bf9df6a6023673";
const SMOKE_BRANCH = "gpt/smoke/github-file-patch-shadow-cert-20260720";
const REPOSITORY_URI = "github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";
const CERTIFICATION_STATUS = "shadow_certified";
const CONTRACT_CERTIFICATION_STATUS = "certified";
const CERTIFICATION_TTL_DAYS = 7;

const FIXED_PLAN = Object.freeze({
  capability_key: CAPABILITY_KEY,
  adapter_key: ADAPTER_KEY,
  contract_key: CONTRACT_KEY,
  runtime_certification_key: RUNTIME_CERTIFICATION_KEY,
  certification_id: CERTIFICATION_ID,
  acknowledgement_evidence_id: ACK_EVIDENCE_ID,
  verification_evidence_id: VERIFY_EVIDENCE_ID,
  certification_type: "shadow_external_write",
  certification_status: CERTIFICATION_STATUS,
  contract_status_required_before: "shadow",
  contract_status_after: "certified",
  contract_certification_status_after: CONTRACT_CERTIFICATION_STATUS,
  write_envelope_id: WRITE_ENVELOPE_ID,
  cleanup_envelope_id: CLEANUP_ENVELOPE_ID,
  write_binding_id: WRITE_BINDING_ID,
  cleanup_binding_id: CLEANUP_BINDING_ID,
  write_execution_ref: WRITE_EXECUTION_REF,
  cleanup_execution_ref: CLEANUP_EXECUTION_REF,
  smoke_blob_sha: SMOKE_BLOB_SHA,
  smoke_branch: SMOKE_BRANCH,
  adapter_status_after: "active",
  runtime_dispatch_changed: false,
  runtime_apply_changed: false,
  active_capability_exports_created: false,
  tenant_authority_changed: false,
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
    fail("github_file_patch_shadow_certification_mode_invalid", "mode must be dry_run or apply.");
  }
  return mode;
}

function requireConfirmation(value) {
  if (String(value || "").trim() !== GITHUB_FILE_PATCH_SHADOW_CERTIFICATION_CONFIRM) {
    fail(
      "github_file_patch_shadow_certification_confirmation_required",
      `Typed confirmation ${GITHUB_FILE_PATCH_SHADOW_CERTIFICATION_CONFIRM} is required.`,
      400,
      { expected_confirmation: GITHUB_FILE_PATCH_SHADOW_CERTIFICATION_CONFIRM },
    );
  }
}

function parseJson(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

function planHash() {
  return stableCapabilityHash({
    version: GITHUB_FILE_PATCH_SHADOW_CERTIFICATION_VERSION,
    plan: FIXED_PLAN,
  });
}

function byKey(rows, key) {
  return Object.fromEntries((rows || []).map((row) => [String(row?.[key] || ""), row]));
}

async function loadState(pool) {
  const [adapterRows] = await pool.query(
    `SELECT adapter_key,resource_type,provider_key,adapter_kind,installed_tool_key,
            identity_resolver_key,metadata_normalizer_key,content_policy,
            supports_plan,supports_read,supports_write,status,metadata_json
       FROM platform_resource_adapters WHERE adapter_key=? LIMIT 1`,
    [ADAPTER_KEY],
  );
  const [contractRows] = await pool.query(
    `SELECT contract_id,contract_key,contract_version,capability_key,adapter_key,
            verification_type,acknowledgement_required,verification_required,
            expected_effect_class,certification_status,status,is_current,secrets_included,
            source_registry,source_key,valid_from,expires_at,revoked_at
       FROM platform_capability_readback_contracts
      WHERE contract_key=? AND is_current=1 LIMIT 1`,
    [CONTRACT_KEY],
  );
  const [capabilityRows] = await pool.query(
    `SELECT capability_key,operation_class,risk_class,runtime_status,exposure_scope,
            dispatch_allowed,apply_allowed,requires_readback,status
       FROM platform_plugin_capabilities WHERE capability_key=? LIMIT 1`,
    [CAPABILITY_KEY],
  );
  const [certificationRows] = await pool.query(
    `SELECT certification_id,capability_key,certification_type,environment,
            subject_type,subject_key,certification_status,evidence_id,
            source_registry,source_key,certified_at,expires_at,revoked_at,
            metadata_json,secrets_included
       FROM platform_capability_certifications WHERE certification_id=? LIMIT 1`,
    [CERTIFICATION_ID],
  );
  const [evidenceRows] = await pool.query(
    `SELECT evidence_id,evidence_type,subject_type,subject_key,capability_key,
            envelope_id,binding_id,certification_id,source_system,source_ref,
            evidence_status,reason_code,payload_hash,observed_at,expires_at,
            revoked_at,secrets_included
       FROM platform_evidence_events WHERE evidence_id IN (?,?)`,
    [ACK_EVIDENCE_ID, VERIFY_EVIDENCE_ID],
  );
  const [exportRows] = await pool.query(
    `SELECT export_key,capability_key,export_status,exposure_scope
       FROM platform_plugin_capability_exports WHERE capability_key=?`,
    [CAPABILITY_KEY],
  );
  const [runtimeRows] = await pool.query(
    `SELECT certification_key,surface_key,tool_or_action_key,certification_status,
            dispatch_allowed,apply_allowed,requires_resource_authority,
            requires_dry_run,requires_audit_evidence,requires_readback
       FROM runtime_dispatch_certification_registry WHERE certification_key=? LIMIT 1`,
    [RUNTIME_CERTIFICATION_KEY],
  );
  const [envelopeRows] = await pool.query(
    `SELECT envelope_id,tenant_id,user_id,workspace_id,app_key,capability_key,
            operation_intent,selected_runtime_surface,execution_ref,execution_status,
            secrets_included,created_at,updated_at
       FROM capability_resolution_envelope_ledger WHERE envelope_id IN (?,?)`,
    [WRITE_ENVELOPE_ID, CLEANUP_ENVELOPE_ID],
  );
  const [bindingRows] = await pool.query(
    `SELECT binding_id,tenant_id,workspace_id,user_id,resource_type,resource_uri,
            resource_ref_json,recipe_key,permission_level,allowed_modes_json,
            authority_source,expires_at,status,created_at,updated_at
       FROM platform_resource_authority_bindings WHERE binding_id IN (?,?)`,
    [WRITE_BINDING_ID, CLEANUP_BINDING_ID],
  );
  return {
    adapter: adapterRows?.[0] || null,
    contract: contractRows?.[0] || null,
    capability: capabilityRows?.[0] || null,
    certification: certificationRows?.[0] || null,
    evidence: byKey(evidenceRows, "evidence_id"),
    exports: exportRows || [],
    runtime_certification: runtimeRows?.[0] || null,
    envelopes: byKey(envelopeRows, "envelope_id"),
    bindings: byKey(bindingRows, "binding_id"),
  };
}

function smokeEnvelopeErrors(row, expectedRef, label) {
  const errors = [];
  if (!row) return [`${label}_ENVELOPE_REQUIRED`];
  if (row.app_key !== "github") errors.push(`${label}_ENVELOPE_APP_MISMATCH`);
  if (row.capability_key !== CAPABILITY_KEY) errors.push(`${label}_ENVELOPE_CAPABILITY_MISMATCH`);
  if (row.operation_intent !== "github_repo_patch") errors.push(`${label}_ENVELOPE_INTENT_MISMATCH`);
  if (row.selected_runtime_surface !== ADAPTER_KEY) errors.push(`${label}_ENVELOPE_RUNTIME_MISMATCH`);
  if (row.execution_status !== "executed") errors.push(`${label}_ENVELOPE_NOT_EXECUTED`);
  if (row.execution_ref !== expectedRef) errors.push(`${label}_ENVELOPE_EXECUTION_REF_MISMATCH`);
  if (Number(row.secrets_included || 0) !== 0) errors.push(`${label}_ENVELOPE_SECRET_POLICY_VIOLATION`);
  return errors;
}

function bindingErrors(row, expectedMode, label) {
  const errors = [];
  if (!row) return [`${label}_BINDING_REQUIRED`];
  const modes = parseJson(row.allowed_modes_json, []);
  const ref = parseJson(row.resource_ref_json, {});
  if (row.resource_type !== "github_repo") errors.push(`${label}_BINDING_RESOURCE_TYPE_MISMATCH`);
  if (row.resource_uri !== REPOSITORY_URI) errors.push(`${label}_BINDING_RESOURCE_URI_MISMATCH`);
  if (row.recipe_key !== "repo_patch_apply") errors.push(`${label}_BINDING_RECIPE_MISMATCH`);
  if (row.permission_level !== "patch") errors.push(`${label}_BINDING_PERMISSION_MISMATCH`);
  if (!["active", "expired"].includes(row.status)) errors.push(`${label}_BINDING_STATUS_INVALID`);
  if (!Array.isArray(modes) || !modes.includes(expectedMode)) errors.push(`${label}_BINDING_MODE_MISSING`);
  if (String(ref.branch || "") !== SMOKE_BRANCH) errors.push(`${label}_BINDING_BRANCH_MISMATCH`);
  return errors;
}

function verifyPreconditions(state) {
  const errors = [];
  if (state.adapter) {
    if (state.adapter.resource_type !== "github_file") errors.push("ADAPTER_RESOURCE_TYPE_MISMATCH");
    if (state.adapter.provider_key !== "github") errors.push("ADAPTER_PROVIDER_MISMATCH");
    if (state.adapter.adapter_kind !== "composite") errors.push("ADAPTER_KIND_MISMATCH");
    if (state.adapter.installed_tool_key !== "repo_patch_apply") errors.push("ADAPTER_TOOL_MISMATCH");
    if (Number(state.adapter.supports_write || 0) !== 1) errors.push("ADAPTER_WRITE_SUPPORT_MISMATCH");
    if (!["planned", "active"].includes(state.adapter.status)) errors.push("ADAPTER_STATUS_INVALID");
  }
  if (!state.contract) errors.push("READBACK_CONTRACT_REQUIRED");
  if (state.contract && state.contract.capability_key !== CAPABILITY_KEY) errors.push("CONTRACT_CAPABILITY_MISMATCH");
  if (state.contract && state.contract.adapter_key !== ADAPTER_KEY) errors.push("CONTRACT_ADAPTER_MISMATCH");
  if (state.contract && state.contract.expected_effect_class !== "external_write") errors.push("CONTRACT_EFFECT_CLASS_MISMATCH");
  if (state.contract && !["shadow", "certified"].includes(state.contract.status)) errors.push("CONTRACT_STATUS_INVALID");
  if (state.contract && !["pending", CONTRACT_CERTIFICATION_STATUS].includes(state.contract.certification_status)) {
    errors.push("CONTRACT_CERTIFICATION_STATUS_INVALID");
  }
  if (state.contract && Number(state.contract.secrets_included || 0) !== 0) errors.push("CONTRACT_SECRET_POLICY_VIOLATION");
  if (!state.capability) errors.push("CAPABILITY_REQUIRED");
  if (state.capability && Number(state.capability.apply_allowed || 0) !== 0) errors.push("CAPABILITY_APPLY_MUST_REMAIN_DISABLED");
  if (!state.runtime_certification) errors.push("RUNTIME_CERTIFICATION_REQUIRED");
  if (state.runtime_certification && Number(state.runtime_certification.dispatch_allowed || 0) !== 0) {
    errors.push("RUNTIME_DISPATCH_MUST_REMAIN_DISABLED");
  }
  if (state.runtime_certification && Number(state.runtime_certification.apply_allowed || 0) !== 0) {
    errors.push("RUNTIME_APPLY_MUST_REMAIN_DISABLED");
  }
  if (state.exports.some((row) => row.export_status === "active")) errors.push("ACTIVE_CAPABILITY_EXPORT_FORBIDDEN");
  if (state.exports.some((row) => String(row.exposure_scope || "").toLowerCase() === "tenant")) {
    errors.push("TENANT_CAPABILITY_EXPORT_FORBIDDEN");
  }
  errors.push(...smokeEnvelopeErrors(state.envelopes[WRITE_ENVELOPE_ID], WRITE_EXECUTION_REF, "WRITE_SMOKE"));
  errors.push(...smokeEnvelopeErrors(state.envelopes[CLEANUP_ENVELOPE_ID], CLEANUP_EXECUTION_REF, "CLEANUP_SMOKE"));
  errors.push(...bindingErrors(state.bindings[WRITE_BINDING_ID], "write_file", "WRITE_SMOKE"));
  errors.push(...bindingErrors(state.bindings[CLEANUP_BINDING_ID], "delete_file", "CLEANUP_SMOKE"));
  return errors;
}

function boundedState(state) {
  const acknowledgement = state.evidence[ACK_EVIDENCE_ID] || null;
  const verification = state.evidence[VERIFY_EVIDENCE_ID] || null;
  return {
    adapter_present: Boolean(state.adapter),
    adapter_status: state.adapter?.status || null,
    adapter_supports_write: Boolean(Number(state.adapter?.supports_write || 0)),
    contract_present: Boolean(state.contract),
    contract_status: state.contract?.status || null,
    contract_certification_status: state.contract?.certification_status || null,
    certification_present: Boolean(state.certification),
    certification_status: state.certification?.certification_status || null,
    acknowledgement_status: acknowledgement?.evidence_status || null,
    verification_status: verification?.evidence_status || null,
    write_smoke_execution_ref: state.envelopes[WRITE_ENVELOPE_ID]?.execution_ref || null,
    cleanup_smoke_execution_ref: state.envelopes[CLEANUP_ENVELOPE_ID]?.execution_ref || null,
    active_capability_export_count: state.exports.filter((row) => row.export_status === "active").length,
    tenant_export_count: state.exports.filter((row) => String(row.exposure_scope || "").toLowerCase() === "tenant").length,
    capability_apply_allowed: Boolean(Number(state.capability?.apply_allowed || 0)),
    runtime_dispatch_allowed: Boolean(Number(state.runtime_certification?.dispatch_allowed || 0)),
    runtime_apply_allowed: Boolean(Number(state.runtime_certification?.apply_allowed || 0)),
    secrets_included: false,
  };
}

function verifyReadback(state) {
  const errors = verifyPreconditions(state);
  const acknowledgement = state.evidence[ACK_EVIDENCE_ID] || null;
  const verification = state.evidence[VERIFY_EVIDENCE_ID] || null;
  if (!state.adapter) errors.push("CERTIFIED_ADAPTER_MISSING");
  if (state.adapter && state.adapter.status !== "active") errors.push("CERTIFIED_ADAPTER_INACTIVE");
  if (state.adapter && Number(state.adapter.supports_write || 0) !== 1) errors.push("CERTIFIED_ADAPTER_WRITE_SUPPORT_MISSING");
  if (!state.certification) errors.push("SHADOW_CERTIFICATION_MISSING");
  if (state.certification && state.certification.capability_key !== CAPABILITY_KEY) errors.push("CERTIFICATION_CAPABILITY_MISMATCH");
  if (state.certification && state.certification.certification_type !== "shadow_external_write") errors.push("CERTIFICATION_TYPE_MISMATCH");
  if (state.certification && state.certification.certification_status !== CERTIFICATION_STATUS) errors.push("CERTIFICATION_STATUS_MISMATCH");
  if (state.certification && state.certification.evidence_id !== VERIFY_EVIDENCE_ID) errors.push("CERTIFICATION_EVIDENCE_MISMATCH");
  if (state.certification && Number(state.certification.secrets_included || 0) !== 0) errors.push("CERTIFICATION_SECRET_POLICY_VIOLATION");
  if (!acknowledgement) errors.push("ACKNOWLEDGEMENT_EVIDENCE_MISSING");
  if (acknowledgement && acknowledgement.evidence_type !== "provider_acknowledgement") errors.push("ACKNOWLEDGEMENT_TYPE_MISMATCH");
  if (acknowledgement && acknowledgement.evidence_status !== "passed") errors.push("ACKNOWLEDGEMENT_NOT_PASSED");
  if (acknowledgement && acknowledgement.envelope_id !== WRITE_ENVELOPE_ID) errors.push("ACKNOWLEDGEMENT_ENVELOPE_MISMATCH");
  if (acknowledgement && Number(acknowledgement.secrets_included || 0) !== 0) errors.push("ACKNOWLEDGEMENT_SECRET_POLICY_VIOLATION");
  if (!verification) errors.push("VERIFICATION_EVIDENCE_MISSING");
  if (verification && verification.evidence_type !== "same_cycle_readback_verification") errors.push("VERIFICATION_TYPE_MISMATCH");
  if (verification && verification.evidence_status !== "passed") errors.push("VERIFICATION_NOT_PASSED");
  if (verification && verification.envelope_id !== CLEANUP_ENVELOPE_ID) errors.push("VERIFICATION_ENVELOPE_MISMATCH");
  if (verification && Number(verification.secrets_included || 0) !== 0) errors.push("VERIFICATION_SECRET_POLICY_VIOLATION");
  if (state.contract && state.contract.status !== "certified") errors.push("READBACK_CONTRACT_NOT_CERTIFIED");
  if (state.contract && state.contract.certification_status !== CONTRACT_CERTIFICATION_STATUS) {
    errors.push("READBACK_CONTRACT_CERTIFICATION_NOT_LINKED");
  }
  return { ok: errors.length === 0, errors, ...boundedState(state) };
}

export async function issueGithubFilePatchShadowCertification(args = {}, deps = {}) {
  const pool = deps.pool || getPool();
  const mode = normalizeMode(args.mode);
  const expectedPlanHash = planHash();
  const before = await loadState(pool);
  const preconditionErrors = verifyPreconditions(before);

  if (mode === "dry_run") {
    return {
      ok: true,
      report_type: "github_file_patch_shadow_certification_issue",
      version: GITHUB_FILE_PATCH_SHADOW_CERTIFICATION_VERSION,
      mode,
      plan_hash: expectedPlanHash,
      expected_confirmation: GITHUB_FILE_PATCH_SHADOW_CERTIFICATION_CONFIRM,
      target: FIXED_PLAN,
      current_state: boundedState(before),
      precondition_errors: preconditionErrors,
      apply_ready: preconditionErrors.length === 0,
      apply_requires_capability_envelope: true,
      mutations_performed: false,
      runtime_dispatch_changed: false,
      runtime_apply_changed: false,
      provider_calls_performed: false,
      external_writes_performed: false,
      tenant_authority_changed: false,
      active_capability_exports_created: false,
      secrets_included: false,
    };
  }

  requireConfirmation(args.confirm);
  if (preconditionErrors.length) {
    fail("github_file_patch_shadow_certification_preconditions_failed", "Shadow certification preconditions failed.", 409, {
      blockers: preconditionErrors,
    });
  }
  if (args.expected_plan_hash && String(args.expected_plan_hash).toLowerCase() !== expectedPlanHash) {
    fail("github_file_patch_shadow_certification_plan_hash_mismatch", "The fixed certification plan hash changed.", 409, {
      expected_plan_hash: args.expected_plan_hash,
      observed_plan_hash: expectedPlanHash,
    });
  }
  const capabilityEnvelopeId = String(args.capability_envelope_id || "").trim();
  if (!capabilityEnvelopeId) {
    fail("github_file_patch_shadow_certification_envelope_required", "capability_envelope_id is required for apply.");
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
    throw capabilityEnvelopeError(resolvedEnvelope, "GitHub file patch shadow certification requires an approved platform_orchestration envelope.");
  }
  if (!resolvedEnvelope.apply_allowed) {
    fail("github_file_patch_shadow_certification_apply_not_authorized", "The capability envelope is not apply-authorized.", 403);
  }

  const connection = await pool.getConnection();
  let lockAcquired = false;
  try {
    const [lockRows] = await connection.query("SELECT GET_LOCK(?, 10) AS acquired", [LOCK_KEY]);
    lockAcquired = Number(lockRows?.[0]?.acquired || 0) === 1;
    if (!lockAcquired) fail("github_file_patch_shadow_certification_locked", "Another certification issue is active.", 409);

    await connection.beginTransaction();
    const lockedState = await loadState(connection);
    const lockedErrors = verifyPreconditions(lockedState);
    if (lockedErrors.length) {
      fail("github_file_patch_shadow_certification_preconditions_changed", "Certification preconditions changed before apply.", 409, {
        blockers: lockedErrors,
      });
    }

    const commonEvidence = {
      version: GITHUB_FILE_PATCH_SHADOW_CERTIFICATION_VERSION,
      plan_hash: expectedPlanHash,
      capability_key: CAPABILITY_KEY,
      adapter_key: ADAPTER_KEY,
      contract_key: CONTRACT_KEY,
      smoke_branch: SMOKE_BRANCH,
      smoke_blob_sha: SMOKE_BLOB_SHA,
      runtime_dispatch_changed: false,
      runtime_apply_changed: false,
      active_capability_exports_created: false,
      tenant_authority_changed: false,
      provider_calls_performed: false,
      external_writes_performed: false,
      secrets_included: false,
    };
    const acknowledgementPayload = {
      ...commonEvidence,
      phase: "write_acknowledgement",
      envelope_id: WRITE_ENVELOPE_ID,
      binding_id: WRITE_BINDING_ID,
      execution_ref: WRITE_EXECUTION_REF,
    };
    const verificationPayload = {
      ...commonEvidence,
      phase: "cleanup_and_same_cycle_readback_verification",
      envelope_id: CLEANUP_ENVELOPE_ID,
      binding_id: CLEANUP_BINDING_ID,
      write_execution_ref: WRITE_EXECUTION_REF,
      cleanup_execution_ref: CLEANUP_EXECUTION_REF,
      net_repository_content_change: false,
    };
    const certificationMetadata = {
      ...commonEvidence,
      certification_scope: "shadow_only",
      apply_certification_granted: false,
      runtime_dispatch_allowed: false,
      runtime_apply_allowed: false,
      capability_exports_promoted: false,
      tenant_exports_created: false,
    };

    await connection.query(
      `INSERT INTO platform_resource_adapters
        (adapter_key,resource_type,provider_key,adapter_kind,installed_tool_key,
         identity_resolver_key,metadata_normalizer_key,content_policy,
         supports_plan,supports_read,supports_write,status,metadata_json)
       VALUES (?,'github_file','github','composite','repo_patch_apply',
               'github_file_ref_v1','github_file_patch_apply_summary_v1','content_hash_only_after_review',
               1,0,1,'active',?)
       ON DUPLICATE KEY UPDATE
         resource_type='github_file',provider_key='github',adapter_kind='composite',
         installed_tool_key='repo_patch_apply',identity_resolver_key='github_file_ref_v1',
         metadata_normalizer_key='github_file_patch_apply_summary_v1',
         content_policy='content_hash_only_after_review',supports_plan=1,supports_read=0,
         supports_write=1,status='active',metadata_json=VALUES(metadata_json),updated_at=CURRENT_TIMESTAMP`,
      [ADAPTER_KEY, JSON.stringify(certificationMetadata)],
    );

    const evidenceRows = [
      {
        id: ACK_EVIDENCE_ID,
        type: "provider_acknowledgement",
        envelope: WRITE_ENVELOPE_ID,
        binding: WRITE_BINDING_ID,
        ref: `github_commit:${WRITE_EXECUTION_REF}`,
        reason: "GITHUB_FILE_PATCH_SMOKE_ACKNOWLEDGED",
        payload: acknowledgementPayload,
      },
      {
        id: VERIFY_EVIDENCE_ID,
        type: "same_cycle_readback_verification",
        envelope: CLEANUP_ENVELOPE_ID,
        binding: CLEANUP_BINDING_ID,
        ref: `github_commit:${CLEANUP_EXECUTION_REF}`,
        reason: "GITHUB_FILE_PATCH_SMOKE_READBACK_VERIFIED",
        payload: verificationPayload,
      },
    ];
    for (const evidence of evidenceRows) {
      const payloadHash = stableCapabilityHash(evidence.payload);
      await connection.query(
        `INSERT INTO platform_evidence_events
          (evidence_id,evidence_type,subject_type,subject_key,capability_key,envelope_id,binding_id,
           certification_id,source_system,source_ref,evidence_status,reason_code,payload_hash,
           evidence_json,observed_at,expires_at,revoked_at,secrets_included)
         VALUES (?,?, 'platform_resource_adapter', ?,?,?,?,?, 'github',?,'passed',?,?,?,CURRENT_TIMESTAMP,
                 DATE_ADD(CURRENT_TIMESTAMP,INTERVAL ? DAY),NULL,0)
         ON DUPLICATE KEY UPDATE
           envelope_id=VALUES(envelope_id),binding_id=VALUES(binding_id),certification_id=VALUES(certification_id),
           source_system='github',source_ref=VALUES(source_ref),evidence_status='passed',
           reason_code=VALUES(reason_code),payload_hash=VALUES(payload_hash),evidence_json=VALUES(evidence_json),
           observed_at=CURRENT_TIMESTAMP,expires_at=VALUES(expires_at),revoked_at=NULL,
           secrets_included=0,updated_at=CURRENT_TIMESTAMP`,
        [
          evidence.id,
          evidence.type,
          ADAPTER_KEY,
          CAPABILITY_KEY,
          evidence.envelope,
          evidence.binding,
          CERTIFICATION_ID,
          evidence.ref,
          evidence.reason,
          payloadHash,
          JSON.stringify(evidence.payload),
          CERTIFICATION_TTL_DAYS,
        ],
      );
    }

    await connection.query(
      `INSERT INTO platform_capability_certifications
        (certification_id,capability_key,certification_type,environment,subject_type,subject_key,
         certification_status,evidence_id,source_registry,source_key,certified_at,expires_at,
         revoked_at,metadata_json,secrets_included)
       VALUES (?,?,'shadow_external_write','production','platform_resource_adapter',?,?,?,
               'platform_capability_readback_contracts',?,CURRENT_TIMESTAMP,
               DATE_ADD(CURRENT_TIMESTAMP,INTERVAL ? DAY),NULL,?,0)
       ON DUPLICATE KEY UPDATE
         capability_key=VALUES(capability_key),certification_type='shadow_external_write',
         environment='production',subject_type='platform_resource_adapter',subject_key=VALUES(subject_key),
         certification_status=VALUES(certification_status),evidence_id=VALUES(evidence_id),
         source_registry='platform_capability_readback_contracts',source_key=VALUES(source_key),
         certified_at=CURRENT_TIMESTAMP,expires_at=VALUES(expires_at),revoked_at=NULL,
         metadata_json=VALUES(metadata_json),secrets_included=0,updated_at=CURRENT_TIMESTAMP`,
      [
        CERTIFICATION_ID,
        CAPABILITY_KEY,
        ADAPTER_KEY,
        CERTIFICATION_STATUS,
        VERIFY_EVIDENCE_ID,
        CONTRACT_KEY,
        CERTIFICATION_TTL_DAYS,
        JSON.stringify(certificationMetadata),
      ],
    );

    const [contractUpdate] = await connection.query(
      `UPDATE platform_capability_readback_contracts
          SET status='certified',certification_status=?,valid_from=COALESCE(valid_from,CURRENT_TIMESTAMP),
              expires_at=DATE_ADD(CURRENT_TIMESTAMP,INTERVAL ? DAY),revoked_at=NULL,updated_at=CURRENT_TIMESTAMP
        WHERE contract_key=? AND is_current=1 AND capability_key=? AND adapter_key=?
          AND expected_effect_class='external_write' AND status IN ('shadow','certified')
          AND certification_status IN ('pending','certified') AND secrets_included=0`,
      [CONTRACT_CERTIFICATION_STATUS, CERTIFICATION_TTL_DAYS, CONTRACT_KEY, CAPABILITY_KEY, ADAPTER_KEY],
    );
    if (Number(contractUpdate?.affectedRows || 0) !== 1) {
      fail("github_file_patch_shadow_certification_contract_update_failed", "Exactly one current contract must be certified.", 409);
    }

    const readback = await loadState(connection);
    const verified = verifyReadback(readback);
    if (!verified.ok) {
      fail("github_file_patch_shadow_certification_readback_failed", "Transactional readback did not match the fixed certification plan.", 500, verified);
    }

    await connection.commit();
    const markReferenced = deps.markReferenced || markCapabilityEnvelopeReferenced;
    const envelopeReadback = await markReferenced({
      pool,
      envelopeId: capabilityEnvelopeId,
      executionRef: `github-file-patch-shadow-certification:${expectedPlanHash.slice(0, 16)}`,
    });
    if (!envelopeReadback?.ok) {
      fail("github_file_patch_shadow_certification_envelope_readback_failed", "Certification committed but envelope reference readback failed.", 500);
    }

    return {
      ok: true,
      report_type: "github_file_patch_shadow_certification_issue",
      version: GITHUB_FILE_PATCH_SHADOW_CERTIFICATION_VERSION,
      mode,
      plan_hash: expectedPlanHash,
      certification_id: CERTIFICATION_ID,
      acknowledgement_evidence_id: ACK_EVIDENCE_ID,
      verification_evidence_id: VERIFY_EVIDENCE_ID,
      readback: verified,
      envelope_readback: envelopeReadback,
      mutations_performed: true,
      runtime_dispatch_changed: false,
      runtime_apply_changed: false,
      provider_calls_performed: false,
      external_writes_performed: false,
      tenant_authority_changed: false,
      active_capability_exports_created: false,
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

export const _testingGithubFilePatchShadowCertification = Object.freeze({
  CAPABILITY_KEY,
  ADAPTER_KEY,
  CONTRACT_KEY,
  RUNTIME_CERTIFICATION_KEY,
  CERTIFICATION_ID,
  ACK_EVIDENCE_ID,
  VERIFY_EVIDENCE_ID,
  WRITE_ENVELOPE_ID,
  CLEANUP_ENVELOPE_ID,
  WRITE_BINDING_ID,
  CLEANUP_BINDING_ID,
  WRITE_EXECUTION_REF,
  CLEANUP_EXECUTION_REF,
  SMOKE_BLOB_SHA,
  SMOKE_BRANCH,
  FIXED_PLAN,
  planHash,
  verifyPreconditions,
  verifyReadback,
});
