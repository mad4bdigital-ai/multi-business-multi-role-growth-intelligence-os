import { getPool } from "./db.js";
import { stableCapabilityHash } from "./dynamicCapabilityGovernanceCompiler.js";

export const DYNAMIC_CAPABILITY_ENFORCEMENT_SHADOW_VERSION = "dynamic-capability-enforcement-shadow-v1";

const REQUESTED_MODES = new Set(["preview", "apply"]);
const PRINCIPAL_SCOPES = new Set(["admin", "tenant", "internal"]);
const LEGACY_DECISIONS = new Set(["allow", "deny", "error", "not_evaluated"]);
const FAIL_STATES = new Set(["deny", "stale", "ambiguous", "not_evaluated"]);
const MUTATION_EFFECTS = new Set([
  "internal_write",
  "workspace_write",
  "external_write",
  "credential_touching",
  "deployment_affecting",
  "destructive",
]);
const EVIDENCE_KEYS = Object.freeze([
  "tenant_membership",
  "workspace_ready",
  "resource_authority",
  "capability_grant",
  "connection_present",
  "connection_validated",
  "credential_scope_match",
  "approval_present",
  "typed_confirmation_match",
  "idempotency_key_present",
  "quota_authority",
  "audit_ready",
  "readback_contract",
  "rollback_ready",
  "compensation_ready",
]);

function rowsOf(result) {
  return Array.isArray(result?.[0]) ? result[0] : [];
}

function bool(value) {
  return value === true || Number(value || 0) === 1 || String(value || "").toLowerCase() === "true";
}

function compact(value, maxLength = 191) {
  return String(value || "").trim().slice(0, maxLength);
}

function shadowError(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function optionalSha(value, field) {
  const normalized = compact(value, 64).toLowerCase();
  if (!normalized) return null;
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw shadowError(400, "capability_enforcement_shadow_hash_invalid", `${field} must be a lowercase SHA-256 hash.`, { field });
  }
  return normalized;
}

function parseJson(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return { ok: true, value };
  if (!String(value || "").trim()) return { ok: false, value: null };
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { ok: true, value: parsed }
      : { ok: false, value: null };
  } catch {
    return { ok: false, value: null };
  }
}

function normalizeEvidence(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(EVIDENCE_KEYS.map((key) => [
    key,
    Object.prototype.hasOwnProperty.call(source, key) ? bool(source[key]) : null,
  ]));
}

function normalizeInput(input = {}) {
  const capabilityKey = compact(input.capability_key);
  if (!capabilityKey) {
    throw shadowError(400, "capability_enforcement_shadow_capability_required", "capability_key is required.");
  }
  const requestedMode = compact(input.requested_mode || "preview", 16).toLowerCase();
  if (!REQUESTED_MODES.has(requestedMode)) {
    throw shadowError(400, "capability_enforcement_shadow_mode_invalid", "requested_mode must be preview or apply.");
  }
  const principalScope = compact(input.principal_scope || "admin", 16).toLowerCase();
  if (!PRINCIPAL_SCOPES.has(principalScope)) {
    throw shadowError(400, "capability_enforcement_shadow_principal_scope_invalid", "principal_scope must be admin, tenant, or internal.");
  }
  const legacyDecision = compact(input.legacy_decision || "not_evaluated", 32).toLowerCase();
  if (!LEGACY_DECISIONS.has(legacyDecision)) {
    throw shadowError(400, "capability_enforcement_shadow_legacy_decision_invalid", "legacy_decision must be allow, deny, error, or not_evaluated.");
  }
  return {
    capability_key: capabilityKey,
    requested_mode: requestedMode,
    principal_scope: principalScope,
    tenant_ref: compact(input.tenant_ref, 191) || null,
    workspace_ref: compact(input.workspace_ref, 191) || null,
    resource_ref: compact(input.resource_ref, 255) || null,
    runtime_surface: compact(input.runtime_surface, 191) || null,
    capability_envelope_id: compact(input.capability_envelope_id, 64) || null,
    context_revision: compact(input.context_revision, 191) || null,
    input_sha256: optionalSha(input.input_sha256, "input_sha256"),
    expected_request_hash: optionalSha(input.expected_request_hash, "expected_request_hash"),
    expected_manifest_hash: optionalSha(input.expected_manifest_hash, "expected_manifest_hash"),
    expected_source_revision_hash: optionalSha(input.expected_source_revision_hash, "expected_source_revision_hash"),
    legacy_decision: legacyDecision,
    legacy_reason_codes: Array.isArray(input.legacy_reason_codes)
      ? input.legacy_reason_codes.map((item) => compact(item, 128)).filter(Boolean).slice(0, 20)
      : [],
    legacy_explanation_ref: compact(input.legacy_explanation_ref, 512) || null,
    legacy_exception_approved: bool(input.legacy_exception_approved),
    evidence: normalizeEvidence(input.evidence),
  };
}

async function loadCurrentManifest(pool, capabilityKey) {
  const rows = rowsOf(await pool.query(
    `SELECT manifest_id, run_id, capability_key, manifest_version, manifest_hash,
            source_revision_hash, compiler_version, effect_class, risk_class,
            authority_requirement_type, status, rollout_mode, manifest_json, created_at
       FROM platform_capability_compiled_manifests
      WHERE capability_key = ? AND is_current = 1
      ORDER BY manifest_version DESC
      LIMIT 2`,
    [capabilityKey]
  ));
  if (rows.length > 1) {
    throw shadowError(409, "CAPABILITY_SELECTOR_AMBIGUOUS", "More than one current manifest exists for the capability.", {
      capability_key: capabilityKey,
      current_manifest_count: rows.length,
    });
  }
  return rows[0] || null;
}

async function loadEnvelope(pool, envelopeId) {
  if (!envelopeId) return null;
  const rows = rowsOf(await pool.query(
    `SELECT envelope_id, tenant_id, user_id, workspace_id, workspace_key, brand_key,
            app_key, capability_key, operation_intent, risk_class,
            selected_source_tier, selected_runtime_surface, authority_status,
            decision, envelope_status, dispatch_allowed, apply_allowed,
            approval_required, quota_required, audit_required, readback_required,
            blocking_gap_count, envelope_sha256, execution_ref, execution_status,
            expires_at, secrets_included, created_at, updated_at
       FROM capability_resolution_envelope_ledger
      WHERE envelope_id = ?
      LIMIT 1`,
    [envelopeId]
  ));
  return rows[0] || null;
}

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

async function loadCertifications(pool, keys) {
  const unique = [...new Set(keys.map((item) => compact(item)).filter(Boolean))];
  if (!unique.length) return [];
  const marks = placeholders(unique);
  return rowsOf(await pool.query(
    `SELECT certification_key, surface_key, surface_family, tool_or_action_key,
            risk_class, certification_status, smoke_strategy,
            dispatch_allowed, apply_allowed, requires_resource_authority,
            requires_dry_run, requires_audit_evidence, requires_readback,
            last_evidence_ref, last_certified_at, expires_at
       FROM runtime_dispatch_certification_registry
      WHERE certification_key IN (${marks})
         OR surface_key IN (${marks})
         OR tool_or_action_key IN (${marks})
      ORDER BY last_certified_at DESC, certification_key ASC`,
    [...unique, ...unique, ...unique]
  ));
}

function isExpired(value, nowMs) {
  if (!value) return false;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) && parsed <= nowMs;
}

function certificationScore(row, keys) {
  let score = 0;
  if (keys.runtime_surface && row.surface_key === keys.runtime_surface) score += 100;
  if (keys.runtime_surface && row.tool_or_action_key === keys.runtime_surface) score += 90;
  if (row.certification_key === keys.capability_key) score += 80;
  if (row.surface_key === keys.capability_key) score += 70;
  if (row.tool_or_action_key === keys.capability_key) score += 60;
  if (keys.source_key && row.surface_key === keys.source_key) score += 50;
  if (keys.source_key && row.tool_or_action_key === keys.source_key) score += 40;
  return score;
}

function selectCertification(rows, keys, nowMs) {
  const ranked = rows
    .map((row) => ({ row, score: certificationScore(row, keys) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(b.row.last_certified_at || "").localeCompare(String(a.row.last_certified_at || "")) || String(a.row.certification_key).localeCompare(String(b.row.certification_key)));
  const current = ranked.filter(({ row }) => bool(row.dispatch_allowed) && !isExpired(row.expires_at, nowMs));
  if (!current.length) {
    const stale = ranked.find(({ row }) => bool(row.dispatch_allowed) && isExpired(row.expires_at, nowMs));
    return stale
      ? { state: "stale", reason_code: "CERTIFICATION_STALE", row: stale.row, candidate_count: ranked.length }
      : { state: "deny", reason_code: "CERTIFICATION_REQUIRED", row: null, candidate_count: ranked.length };
  }
  if (current.length > 1 && current[0].score === current[1].score) {
    return { state: "ambiguous", reason_code: "ADAPTER_BINDING_AMBIGUOUS", row: null, candidate_count: current.length };
  }
  return { state: "pass", reason_code: null, row: current[0].row, candidate_count: current.length };
}

function gate(gateName, state, required, reasonCode = null, evidenceRef = null) {
  return { gate: gateName, state, required: Boolean(required), reason_code: reasonCode, evidence_ref: evidenceRef || null };
}

function evidenceGate(gateName, required, value, reasonCode) {
  if (!required) return gate(gateName, "not_applicable", false, null);
  if (value === true) return gate(gateName, "pass", true, null);
  if (value === false) return gate(gateName, "deny", true, reasonCode);
  return gate(gateName, "not_evaluated", true, reasonCode);
}

function envelopeGate({ required, envelope, request, nowMs }) {
  if (!required) return gate("capability_envelope", "not_applicable", false, null);
  if (!request.capability_envelope_id || !envelope) return gate("capability_envelope", "not_evaluated", true, "CAPABILITY_ENVELOPE_REQUIRED");
  if (String(envelope.capability_key || "") !== request.capability_key || Number(envelope.secrets_included || 0) !== 0) {
    return gate("capability_envelope", "deny", true, "CAPABILITY_ENVELOPE_STALE", envelope.envelope_id);
  }
  if (isExpired(envelope.expires_at, nowMs) || envelope.envelope_status === "expired") {
    return gate("capability_envelope", "stale", true, "CAPABILITY_ENVELOPE_STALE", envelope.envelope_id);
  }
  if (Number(envelope.blocking_gap_count || 0) > 0 || !bool(envelope.dispatch_allowed)) {
    return gate("capability_envelope", "deny", true, "CAPABILITY_ENVELOPE_STALE", envelope.envelope_id);
  }
  if (envelope.envelope_status === "ready_requires_approval") {
    return gate("capability_envelope", "not_evaluated", true, "APPROVAL_REQUIRED", envelope.envelope_id);
  }
  if (envelope.envelope_status !== "ready_for_dispatch") {
    return gate("capability_envelope", "deny", true, "CAPABILITY_ENVELOPE_STALE", envelope.envelope_id);
  }
  return gate("capability_envelope", "pass", true, null, envelope.envelope_id);
}

function reasonNextAction(reasonCode) {
  const map = {
    CAPABILITY_ENVELOPE_REQUIRED: "create_capability_envelope",
    CAPABILITY_ENVELOPE_STALE: "create_fresh_capability_envelope",
    APPROVAL_REQUIRED: "obtain_scoped_approval",
    TYPED_CONFIRMATION_MISMATCH: "provide_matching_typed_confirmation",
    TENANT_TO_ADMIN_SURFACE_BLOCKED: "use_tenant_safe_projection",
    SURFACE_NOT_EXPOSED_TO_PRINCIPAL: "use_authorized_surface",
    WORKSPACE_NOT_READY: "complete_workspace_readiness",
    RESOURCE_AUTHORITY_MISSING: "establish_resource_authority",
    CAPABILITY_GRANT_MISSING: "grant_capability_in_scope",
    CONNECTION_MISSING: "configure_connection",
    CONNECTION_NOT_VALIDATED: "validate_connection",
    CREDENTIAL_SCOPE_MISMATCH: "repair_credential_scope",
    QUOTA_AUTHORITY_MISSING: "establish_quota_authority",
    CERTIFICATION_REQUIRED: "certify_runtime_surface",
    CERTIFICATION_STALE: "recertify_runtime_surface",
    ADAPTER_BINDING_AMBIGUOUS: "resolve_certification_ambiguity",
    READBACK_CONTRACT_REQUIRED: "register_readback_contract",
    IDEMPOTENCY_CONFLICT: "provide_idempotency_evidence",
  };
  return map[reasonCode] || "review_governance_gap";
}

function parityClassification(adaptiveDecision, legacyDecision) {
  const adaptiveAllow = adaptiveDecision === "allow_preview" || adaptiveDecision === "ready_for_dispatch";
  if (legacyDecision === "not_evaluated") return "not_comparable";
  if (legacyDecision === "error") return "legacy_error_adaptive_decision";
  if (adaptiveAllow && legacyDecision === "allow") return "match_allow";
  if (!adaptiveAllow && legacyDecision === "deny") return "match_deny";
  if (!adaptiveAllow && legacyDecision === "allow") return "adaptive_stricter";
  if (adaptiveAllow && legacyDecision === "deny") return "adaptive_allow_legacy_deny";
  return "not_comparable";
}

function boundedEnvelopeSummary(envelope) {
  if (!envelope) return null;
  return {
    envelope_id: envelope.envelope_id,
    capability_key: envelope.capability_key || null,
    operation_intent: envelope.operation_intent || null,
    selected_source_tier: envelope.selected_source_tier || null,
    selected_runtime_surface: envelope.selected_runtime_surface || null,
    envelope_status: envelope.envelope_status,
    dispatch_allowed: bool(envelope.dispatch_allowed),
    apply_allowed: bool(envelope.apply_allowed),
    blocking_gap_count: Number(envelope.blocking_gap_count || 0),
    envelope_sha256: envelope.envelope_sha256,
    expires_at: envelope.expires_at || null,
    execution_status: envelope.execution_status || null,
    secrets_included: false,
  };
}

function boundedCertificationSummary(selection) {
  if (!selection?.row) {
    return { state: selection?.state || "not_evaluated", reason_code: selection?.reason_code || null, candidate_count: Number(selection?.candidate_count || 0), certification: null, secrets_included: false };
  }
  const row = selection.row;
  return {
    state: selection.state,
    reason_code: selection.reason_code,
    candidate_count: Number(selection.candidate_count || 0),
    certification: {
      certification_key: row.certification_key,
      surface_key: row.surface_key,
      surface_family: row.surface_family,
      tool_or_action_key: row.tool_or_action_key || null,
      certification_status: row.certification_status,
      dispatch_allowed: bool(row.dispatch_allowed),
      apply_allowed: bool(row.apply_allowed),
      requires_resource_authority: bool(row.requires_resource_authority),
      requires_dry_run: bool(row.requires_dry_run),
      requires_audit_evidence: bool(row.requires_audit_evidence),
      requires_readback: bool(row.requires_readback),
      last_evidence_ref: row.last_evidence_ref || null,
      last_certified_at: row.last_certified_at || null,
      expires_at: row.expires_at || null,
    },
    secrets_included: false,
  };
}

export async function buildDynamicCapabilityEnforcementShadow(input = {}, deps = {}) {
  const request = normalizeInput(input);
  const pool = deps.pool || getPool();
  const observedAt = typeof deps.now === "function" ? deps.now() : new Date().toISOString();
  const nowMs = new Date(observedAt).getTime();
  const manifestRow = await loadCurrentManifest(pool, request.capability_key);
  if (!manifestRow) {
    throw shadowError(404, "CAPABILITY_NOT_REGISTERED", "No current persisted manifest exists for the capability.", { capability_key: request.capability_key });
  }
  const parsed = parseJson(manifestRow.manifest_json);
  const manifest = parsed.value || {};
  const requirements = manifest.requirements && typeof manifest.requirements === "object" ? manifest.requirements : {};
  const envelope = await loadEnvelope(pool, request.capability_envelope_id);
  const sourceKey = compact(manifest?.source?.key);
  const runtimeSurface = request.runtime_surface || compact(envelope?.selected_runtime_surface) || sourceKey || request.capability_key;
  const certificationRows = request.requested_mode === "apply"
    ? await loadCertifications(pool, [runtimeSurface, request.capability_key, sourceKey])
    : [];
  const certification = request.requested_mode === "apply"
    ? selectCertification(certificationRows, { runtime_surface: runtimeSurface, capability_key: request.capability_key, source_key: sourceKey }, nowMs)
    : { state: "not_evaluated", reason_code: null, row: null, candidate_count: 0 };

  const requestDescriptor = {
    capability_key: request.capability_key,
    requested_mode: request.requested_mode,
    principal_scope: request.principal_scope,
    tenant_ref: request.tenant_ref,
    workspace_ref: request.workspace_ref,
    resource_ref: request.resource_ref,
    runtime_surface: runtimeSurface,
    capability_envelope_id: request.capability_envelope_id,
    context_revision: request.context_revision,
    input_sha256: request.input_sha256,
  };
  const requestHash = stableCapabilityHash(requestDescriptor);
  const gates = [];
  const manifestIdentityValid = parsed.ok
    && String(manifest.capability_key || "") === request.capability_key
    && String(manifest.manifest_hash || "") === String(manifestRow.manifest_hash || "");
  gates.push(gate("manifest_identity", manifestIdentityValid ? "pass" : "deny", true, manifestIdentityValid ? null : "CAPABILITY_SELECTOR_AMBIGUOUS", manifestRow.manifest_id));

  const revisionMismatch =
    (request.expected_manifest_hash && request.expected_manifest_hash !== String(manifestRow.manifest_hash || ""))
    || (request.expected_source_revision_hash && request.expected_source_revision_hash !== String(manifestRow.source_revision_hash || ""))
    || (request.context_revision && request.context_revision !== String(manifestRow.source_revision_hash || ""));
  gates.push(gate("manifest_revision", revisionMismatch ? "stale" : "pass", true, revisionMismatch ? "CAPABILITY_ENVELOPE_STALE" : null, manifestRow.manifest_hash));
  const requestHashMismatch = request.expected_request_hash && request.expected_request_hash !== requestHash;
  gates.push(gate("request_hash", requestHashMismatch ? "stale" : "pass", true, requestHashMismatch ? "CAPABILITY_ENVELOPE_STALE" : null, requestHash));

  const rolloutBlocked = ["disabled", "revoked", "invalid"].includes(String(manifestRow.rollout_mode || manifestRow.status || "").toLowerCase());
  gates.push(gate("rollout_state", rolloutBlocked ? "deny" : "pass", true, rolloutBlocked ? "SURFACE_NOT_EXPOSED_TO_PRINCIPAL" : null, manifestRow.rollout_mode));
  const sourceTable = String(manifest?.source?.table || "");
  const tenantProjection = String(manifest?.projection?.tenant || "not_applicable");
  const tenantAdminBlocked = request.principal_scope === "tenant" && sourceTable === "admin_platform_endpoint_tools";
  const tenantSurfaceBlocked = request.principal_scope === "tenant" && tenantProjection !== "candidate";
  gates.push(gate("surface_exposure", tenantAdminBlocked || tenantSurfaceBlocked ? "deny" : "pass", true, tenantAdminBlocked ? "TENANT_TO_ADMIN_SURFACE_BLOCKED" : tenantSurfaceBlocked ? "SURFACE_NOT_EXPOSED_TO_PRINCIPAL" : null, sourceKey || request.capability_key));

  gates.push(evidenceGate("tenant_membership", request.principal_scope === "tenant", request.evidence.tenant_membership, "TENANT_MEMBERSHIP_REQUIRED"));
  gates.push(evidenceGate("workspace_readiness", bool(requirements.scope_guard) || Boolean(request.workspace_ref), request.evidence.workspace_ready, "WORKSPACE_NOT_READY"));
  gates.push(evidenceGate("resource_authority", bool(requirements.resource_binding), request.evidence.resource_authority, "RESOURCE_AUTHORITY_MISSING"));
  gates.push(evidenceGate("capability_grant", request.principal_scope !== "internal", request.evidence.capability_grant, "CAPABILITY_GRANT_MISSING"));
  const connectionRequired = bool(requirements.validated_connection) || bool(requirements.credential_reference);
  gates.push(evidenceGate("connection_presence", connectionRequired, request.evidence.connection_present, "CONNECTION_MISSING"));
  gates.push(evidenceGate("connection_validation", bool(requirements.validated_connection), request.evidence.connection_validated, "CONNECTION_NOT_VALIDATED"));
  gates.push(evidenceGate("credential_scope", bool(requirements.credential_reference), request.evidence.credential_scope_match, "CREDENTIAL_SCOPE_MISMATCH"));

  const applyMode = request.requested_mode === "apply";
  const approvalRequired = applyMode && String(requirements.approval_mode || "none") !== "none";
  const envelopeApproved = envelope?.envelope_status === "ready_for_dispatch" && bool(envelope?.dispatch_allowed);
  gates.push(evidenceGate("approval", approvalRequired, envelopeApproved || request.evidence.approval_present === true ? true : request.evidence.approval_present, "APPROVAL_REQUIRED"));
  gates.push(evidenceGate("typed_confirmation", applyMode && bool(requirements.typed_confirmation), request.evidence.typed_confirmation_match, "TYPED_CONFIRMATION_MISMATCH"));
  gates.push(envelopeGate({ required: applyMode && bool(requirements.capability_envelope), envelope, request, nowMs }));
  gates.push(evidenceGate("idempotency", applyMode && bool(requirements.idempotency), request.evidence.idempotency_key_present, "IDEMPOTENCY_CONFLICT"));
  gates.push(evidenceGate("quota_authority", applyMode && bool(requirements.quota), request.evidence.quota_authority, "QUOTA_AUTHORITY_MISSING"));
  gates.push(evidenceGate("audit_readiness", applyMode && bool(requirements.audit), request.evidence.audit_ready, "MUTATION_POLICY_REQUIRED"));
  gates.push(evidenceGate("readback_contract", applyMode && bool(requirements.readback), request.evidence.readback_contract, "READBACK_CONTRACT_REQUIRED"));
  gates.push(evidenceGate("rollback_readiness", applyMode && bool(requirements.rollback), request.evidence.rollback_ready, "COMPENSATION_AUTHORITY_REQUIRED"));
  gates.push(evidenceGate("compensation_readiness", applyMode && bool(requirements.compensation), request.evidence.compensation_ready, "COMPENSATION_AUTHORITY_REQUIRED"));
  const certificationRequired = applyMode && bool(requirements.certification);
  gates.push(gate("certification", certificationRequired ? certification.state : "not_applicable", certificationRequired, certificationRequired ? certification.reason_code : null, certification.row?.certification_key || null));

  const requiredFailures = gates.filter((item) => item.required && FAIL_STATES.has(item.state));
  const envelopeDecisionGate = gates.find((item) => item.gate === "capability_envelope");
  const approvalDecisionGate = gates.find((item) => item.gate === "approval");
  const hardFailures = requiredFailures.filter((item) => !["capability_envelope", "approval"].includes(item.gate));
  let adaptiveDecision = "deny";
  if (request.requested_mode === "preview" && requiredFailures.length === 0) adaptiveDecision = "allow_preview";
  if (request.requested_mode === "apply") {
    if (hardFailures.length > 0) adaptiveDecision = "deny";
    else if (envelopeDecisionGate?.state !== "pass") adaptiveDecision = "ready_for_envelope";
    else if (approvalDecisionGate?.state !== "pass") adaptiveDecision = "ready_requires_approval";
    else adaptiveDecision = "ready_for_dispatch";
  }

  const blockers = [...new Set(requiredFailures.map((item) => item.reason_code).filter(Boolean))].slice(0, 20);
  const nextActions = [...new Set(blockers.map(reasonNextAction))].slice(0, 5);
  const parityClass = parityClassification(adaptiveDecision, request.legacy_decision);
  const parityExceptionComplete = Boolean(request.legacy_explanation_ref && request.legacy_exception_approved);
  const parityBlocking = parityClass === "adaptive_allow_legacy_deny" && !parityExceptionComplete;
  const evidenceSnapshot = { explicit: request.evidence, envelope: boundedEnvelopeSummary(envelope), certification: boundedCertificationSummary(certification) };
  const evidenceHash = stableCapabilityHash(evidenceSnapshot);
  const decisionHash = stableCapabilityHash({
    version: DYNAMIC_CAPABILITY_ENFORCEMENT_SHADOW_VERSION,
    request_hash: requestHash,
    manifest_hash: manifestRow.manifest_hash,
    source_revision_hash: manifestRow.source_revision_hash,
    gates,
    adaptive_decision: adaptiveDecision,
    legacy_decision: request.legacy_decision,
    parity_classification: parityClass,
    evidence_hash: evidenceHash,
  });

  return {
    ok: true,
    report_type: "dynamic_capability_enforcement_shadow",
    shadow_version: DYNAMIC_CAPABILITY_ENFORCEMENT_SHADOW_VERSION,
    mode: "shadow",
    observed_at: observedAt,
    capability_key: request.capability_key,
    requested_mode: request.requested_mode,
    request_hash: requestHash,
    input_sha256: request.input_sha256,
    decision_hash: decisionHash,
    manifest: {
      manifest_id: manifestRow.manifest_id,
      manifest_version: Number(manifestRow.manifest_version || 0),
      manifest_hash: manifestRow.manifest_hash,
      source_revision_hash: manifestRow.source_revision_hash,
      compiler_version: manifestRow.compiler_version,
      effect_class: manifestRow.effect_class,
      risk_class: manifestRow.risk_class,
      status: manifestRow.status,
      rollout_mode: manifestRow.rollout_mode,
      source: manifest.source || { table: null, key: null },
      requirements,
      secrets_included: false,
    },
    adaptive_decision: adaptiveDecision,
    authoritative_decision_source: "legacy_runtime",
    effective_authority_decision: request.legacy_decision,
    gates,
    blockers,
    next_actions: nextActions,
    parity: {
      classification: parityClass,
      blocking: parityBlocking,
      legacy_decision: request.legacy_decision,
      legacy_reason_codes: request.legacy_reason_codes,
      explanation_ref: request.legacy_explanation_ref,
      exception_approved: request.legacy_exception_approved,
      exception_complete: parityExceptionComplete,
    },
    evidence: {
      evidence_hash: evidenceHash,
      capability_envelope: boundedEnvelopeSummary(envelope),
      certification: boundedCertificationSummary(certification),
      raw_input_returned: false,
      secrets_included: false,
    },
    diagnostics: {
      mutation_effect_class: MUTATION_EFFECTS.has(String(manifestRow.effect_class || "")),
      dispatch_would_be_allowed_by_adaptive: adaptiveDecision === "ready_for_dispatch",
      preview_would_be_allowed_by_adaptive: adaptiveDecision === "allow_preview",
      legacy_authority_preserved: true,
      parity_requires_explanation: parityClass === "adaptive_allow_legacy_deny",
    },
    execution_performed: false,
    guarantees: {
      registry: "mysql_primary",
      current_persisted_manifest_only: true,
      manifest_revision_bound: true,
      request_hash_bound: true,
      legacy_authority_preserved: true,
      runtime_authority_changed: false,
      envelope_consumed: false,
      idempotency_reserved: false,
      mutations_performed: false,
      provider_calls_performed: false,
      external_writes_performed: false,
      tenant_authority_changed: false,
      credential_payloads_read: false,
      raw_input_returned: false,
      fail_closed: true,
      secrets_included: false,
    },
    secrets_included: false,
  };
}
