import { getPool } from "./db.js";
import { canonicalizeOperationValue, stableOperationHash } from "./operationRegistryContracts.js";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const KEY_PATTERN = /^[a-z0-9][a-z0-9._:-]{1,190}$/;
const DEFAULT_ROLLOUT_MODES = Object.freeze(["shadow", "canary", "active", "fallback"]);
const BLOCKED_OPERATION_STATUSES = new Set(["degraded", "disabled", "archived"]);
const SENSITIVE_KEY_PATTERN = /(?:password|passphrase|access[_-]?token|refresh[_-]?token|private[_-]?key|secret_value|authorization|cookie|credential_payload)/i;
const RAW_SCOPE_KEYS = new Set(["scope_ref", "resource_ref", "workspace_id", "tenant_id"]);

export class OperationRuntimeVerifierError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "OperationRuntimeVerifierError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function fail(code, message, status = 400, details = {}) {
  throw new OperationRuntimeVerifierError(code, message, status, details);
}

function isObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredObject(value, field) {
  if (!isObject(value)) fail("operation_runtime_verifier_invalid_object", `${field} must be an object.`, 400, { field });
  return value;
}

function requiredString(value, field, { max = 191, pattern = null } = {}) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > max || (pattern && !pattern.test(normalized))) {
    fail("operation_runtime_verifier_invalid_string", `${field} is invalid.`, 400, { field });
  }
  return normalized;
}

function optionalString(value, field, options = {}) {
  if (value === undefined || value === null || value === "") return null;
  return requiredString(value, field, options);
}

function requiredHash(value, field) {
  const normalized = requiredString(value, field, { max: 64 }).toLowerCase();
  if (!HASH_PATTERN.test(normalized)) fail("operation_runtime_verifier_invalid_hash", `${field} must be a SHA-256 hash.`, 400, { field });
  return normalized;
}

function timestamp(value, field) {
  const normalized = requiredString(value, field, { max: 64 });
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) fail("operation_runtime_verifier_invalid_timestamp", `${field} is invalid.`, 400, { field });
  return new Date(parsed).toISOString();
}

function stringList(value, field, { defaultValue = null } = {}) {
  const source = value === undefined && defaultValue ? defaultValue : value;
  if (!Array.isArray(source) || source.length === 0 || source.length > 50) {
    fail("operation_runtime_verifier_invalid_list", `${field} must contain 1-50 values.`, 400, { field });
  }
  return [...new Set(source.map((item, index) => requiredString(item, `${field}[${index}]`, { max: 64, pattern: KEY_PATTERN })))].sort();
}

function normalizeInput(input = {}) {
  const root = requiredObject(input, "input");
  const allowed = new Set([
    "operation_key",
    "operation_version",
    "scope_fingerprint",
    "allowed_compiler_versions",
    "allowed_rollout_modes",
    "require_certified",
    "expected_runtime_surface",
    "expected_risk_class",
    "now"
  ]);
  for (const key of Object.keys(root)) {
    if (!allowed.has(key)) fail("operation_runtime_verifier_unknown_field", `input.${key} is not supported.`, 400, { field: `input.${key}` });
  }
  const operationVersion = Number(root.operation_version);
  if (!Number.isInteger(operationVersion) || operationVersion < 1) {
    fail("operation_runtime_verifier_invalid_version", "input.operation_version must be positive.", 400, { field: "input.operation_version" });
  }
  if (root.require_certified !== undefined && typeof root.require_certified !== "boolean") {
    fail("operation_runtime_verifier_invalid_boolean", "input.require_certified must be boolean.", 400, { field: "input.require_certified" });
  }
  return {
    operation_key: requiredString(root.operation_key, "input.operation_key", { pattern: KEY_PATTERN }),
    operation_version: operationVersion,
    scope_fingerprint: requiredHash(root.scope_fingerprint, "input.scope_fingerprint"),
    allowed_compiler_versions: stringList(root.allowed_compiler_versions, "input.allowed_compiler_versions"),
    allowed_rollout_modes: stringList(root.allowed_rollout_modes, "input.allowed_rollout_modes", { defaultValue: DEFAULT_ROLLOUT_MODES }),
    require_certified: root.require_certified !== false,
    expected_runtime_surface: optionalString(root.expected_runtime_surface, "input.expected_runtime_surface", { pattern: KEY_PATTERN }),
    expected_risk_class: optionalString(root.expected_risk_class, "input.expected_risk_class", { max: 16, pattern: KEY_PATTERN }),
    now: timestamp(root.now || new Date().toISOString(), "input.now")
  };
}

function parseJson(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    fail("operation_runtime_verifier_persisted_json_invalid", `${field} contains invalid JSON.`, 500, { field });
  }
}

function inspectManifestSafety(value, field = "manifest", depth = 0) {
  const blockers = [];
  if (depth > 30) return [{ code: "manifest_depth_exceeded", field }];
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return blockers;
  if (Array.isArray(value)) {
    value.forEach((item, index) => blockers.push(...inspectManifestSafety(item, `${field}[${index}]`, depth + 1)));
    return blockers;
  }
  if (!isObject(value)) return [{ code: "manifest_non_json_value", field }];
  for (const [key, child] of Object.entries(value)) {
    const childField = `${field}.${key}`;
    if (key === "secrets_included" || key === "credential_payloads_read") {
      if (child !== false) blockers.push({ code: "manifest_safety_marker_invalid", field: childField });
      continue;
    }
    if (RAW_SCOPE_KEYS.has(key)) blockers.push({ code: "manifest_raw_scope_field_forbidden", field: childField });
    if (SENSITIVE_KEY_PATTERN.test(key)) blockers.push({ code: "manifest_sensitive_field_forbidden", field: childField });
    blockers.push(...inspectManifestSafety(child, childField, depth + 1));
  }
  return blockers;
}

function blocker(code, message, details = {}) {
  return { code, message, details };
}

function uniqueBlockers(blockers) {
  const seen = new Set();
  return blockers.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function blockedReport(input, blockers, evidence = {}) {
  const normalizedBlockers = uniqueBlockers(blockers);
  return {
    ok: true,
    report_type: "operation_runtime_verification",
    verification_status: "blocked_runtime_verification",
    ready: false,
    checked_at: input.now,
    operation: { operation_key: input.operation_key, operation_version: input.operation_version },
    scope_fingerprint: input.scope_fingerprint,
    blockers: normalizedBlockers,
    blocker_count: normalizedBlockers.length,
    evidence,
    next_required_stage: null,
    read_only: true,
    provider_calls_performed: false,
    external_writes_performed: false,
    credential_payloads_read: false,
    runtime_activation_changed: false,
    secrets_included: false
  };
}

function readyReport(input, manifestEvidence, authorityEvidence) {
  return {
    ok: true,
    report_type: "operation_runtime_verification",
    verification_status: "ready_for_runtime_authority_resolution",
    ready: true,
    checked_at: input.now,
    operation: { operation_key: input.operation_key, operation_version: input.operation_version },
    scope_fingerprint: input.scope_fingerprint,
    blockers: [],
    blocker_count: 0,
    evidence: { manifest: manifestEvidence, authorities: authorityEvidence },
    next_required_stage: "same_cycle_resource_credential_approval_and_readback_authority_resolution",
    read_only: true,
    provider_calls_performed: false,
    external_writes_performed: false,
    credential_payloads_read: false,
    runtime_activation_changed: false,
    secrets_included: false
  };
}

function manifestEvidence(row, manifest) {
  return {
    manifest_id: row.manifest_id,
    manifest_version: Number(row.manifest_version),
    manifest_hash: row.manifest_hash,
    source_revision_hash: row.source_revision_hash,
    operation_revision_hash: row.operation_revision_hash,
    compiler_version: row.compiler_version,
    validation_status: row.validation_status,
    rollout_mode: row.rollout_mode,
    certification_status: row.certification_status,
    pointer_revision: Number(row.pointer_revision),
    selected_binding_key: manifest?.selected_binding?.binding_key || null,
    dispatch_binding_key: manifest?.selected_binding?.dispatch_binding_key || null,
    endpoint_export_key: manifest?.selected_binding?.endpoint_export_key || null
  };
}

async function readCurrentManifest(connection, input) {
  const [rows] = await connection.query(
    `SELECT p.manifest_id,p.pointer_revision,m.manifest_version,m.scope_fingerprint,m.source_revision_hash,
            m.manifest_hash,m.compiler_version,m.validation_status,m.rollout_mode,m.certification_status,
            m.manifest_json,m.expires_at,m.revoked_at,o.operation_id,o.operation_key,o.version AS operation_version,
            o.revision_hash AS operation_revision_hash,o.status AS operation_status
       FROM operation_compiled_manifest_current p
       JOIN operation_compiled_manifests m
         ON m.manifest_id=p.manifest_id
        AND m.operation_registry_id=p.operation_registry_id
        AND m.scope_fingerprint=p.scope_fingerprint
       JOIN operation_registry o ON o.id=p.operation_registry_id
      WHERE o.operation_key=? AND o.version=? AND p.scope_fingerprint=?
      LIMIT 2`,
    [input.operation_key, input.operation_version, input.scope_fingerprint]
  );
  return rows || [];
}

function verifyManifest(row, manifest, input) {
  const blockers = [];
  if (!manifest || !isObject(manifest)) return [blocker("manifest_payload_invalid", "The current manifest payload is not an object.")];
  blockers.push(...inspectManifestSafety(manifest).map((item) => blocker(item.code, "The current manifest failed sensitive-data validation.", { field: item.field })));
  const { manifest_hash: embeddedHash, ...core } = manifest;
  const observedHash = stableOperationHash(core);
  if (embeddedHash !== row.manifest_hash || observedHash !== row.manifest_hash) {
    blockers.push(blocker("manifest_hash_mismatch", "The current manifest hash does not match its canonical content.", {
      persisted_manifest_hash: row.manifest_hash,
      embedded_manifest_hash: embeddedHash || null,
      observed_manifest_hash: observedHash
    }));
  }
  if (manifest.source_revision_hash !== row.source_revision_hash) blockers.push(blocker("manifest_source_revision_mismatch", "The source revision hash does not match persistence evidence."));
  if (manifest.scope_fingerprint !== row.scope_fingerprint || row.scope_fingerprint !== input.scope_fingerprint) blockers.push(blocker("manifest_scope_fingerprint_mismatch", "The current manifest scope fingerprint does not match the request."));
  if (manifest.compiler_version !== row.compiler_version || !input.allowed_compiler_versions.includes(row.compiler_version)) blockers.push(blocker("manifest_compiler_not_allowed", "The manifest compiler version is not allowed.", { compiler_version: row.compiler_version }));
  if (manifest?.operation?.operation_key !== row.operation_key || Number(manifest?.operation?.version) !== Number(row.operation_version)) blockers.push(blocker("manifest_operation_identity_mismatch", "The manifest operation identity does not match the current pointer."));
  if (manifest?.operation?.revision_hash !== row.operation_revision_hash) blockers.push(blocker("manifest_operation_revision_mismatch", "The operation revision changed after compilation.", { manifest_revision_hash: manifest?.operation?.revision_hash || null, current_revision_hash: row.operation_revision_hash }));
  if (BLOCKED_OPERATION_STATUSES.has(String(row.operation_status))) blockers.push(blocker("operation_lifecycle_blocked", "The operation lifecycle blocks runtime verification.", { status: row.operation_status }));
  if (row.validation_status !== "valid") blockers.push(blocker("manifest_validation_status_blocked", "The manifest validation status is not valid.", { status: row.validation_status }));
  if (!input.allowed_rollout_modes.includes(row.rollout_mode)) blockers.push(blocker("manifest_rollout_mode_blocked", "The manifest rollout mode is not allowed.", { rollout_mode: row.rollout_mode }));
  if (input.require_certified && row.certification_status !== "certified") blockers.push(blocker("manifest_not_certified", "The manifest certification status is not certified.", { certification_status: row.certification_status }));
  if (row.revoked_at || row.validation_status === "revoked" || row.certification_status === "revoked") blockers.push(blocker("manifest_revoked", "The current manifest is revoked."));
  if (row.expires_at && Date.parse(row.expires_at) <= Date.parse(input.now)) blockers.push(blocker("manifest_expired", "The current manifest is expired.", { expires_at: new Date(row.expires_at).toISOString() }));
  if (manifest?.safety?.provider_calls_performed !== false || manifest?.safety?.credential_payloads_read !== false || manifest?.safety?.external_writes_performed !== false || manifest?.safety?.runtime_activation_changed !== false || manifest?.safety?.secrets_included !== false) blockers.push(blocker("manifest_safety_contract_invalid", "The manifest safety contract is incomplete or unsafe."));
  const selected = manifest.selected_binding;
  if (!isObject(selected)) {
    blockers.push(blocker("selected_binding_missing", "The current manifest does not contain a selected binding."));
  } else {
    for (const key of ["dispatch_binding_key", "endpoint_export_key", "runtime_key", "readback_policy_key", "revision_hash"]) {
      if (!selected[key]) blockers.push(blocker("selected_binding_field_missing", "The selected binding is missing required authority evidence.", { field: key }));
    }
  }
  return blockers;
}

async function verifyAuthorities(connection, manifest, input) {
  const blockers = [];
  const selected = manifest.selected_binding;
  const [dispatchRows] = await connection.query(
    `SELECT binding_id,parent_action_key,endpoint_key,export_key,tool_key,capability_key,operation_intent,
            runtime_surface,readback_policy_key,status
       FROM platform_tool_dispatch_bindings
      WHERE binding_id=?
      LIMIT 2`,
    [selected.dispatch_binding_key]
  );
  const dispatch = dispatchRows?.[0] || null;
  if (dispatchRows?.length !== 1) blockers.push(blocker("dispatch_binding_cardinality_invalid", "The selected dispatch binding did not resolve uniquely.", { match_count: dispatchRows?.length || 0 }));
  if (dispatch) {
    if (dispatch.status !== "active") blockers.push(blocker("dispatch_binding_inactive", "The selected dispatch binding is not active.", { status: dispatch.status }));
    if (dispatch.export_key !== selected.endpoint_export_key) blockers.push(blocker("dispatch_export_key_mismatch", "The dispatch binding does not reference the selected endpoint export."));
    if (selected.capability_key && dispatch.capability_key !== selected.capability_key) blockers.push(blocker("dispatch_capability_mismatch", "The dispatch capability does not match the compiled binding."));
    if (dispatch.readback_policy_key !== selected.readback_policy_key) blockers.push(blocker("dispatch_readback_policy_mismatch", "The dispatch readback policy does not match the compiled binding."));
    if (input.expected_runtime_surface && dispatch.runtime_surface !== input.expected_runtime_surface) blockers.push(blocker("dispatch_runtime_surface_mismatch", "The dispatch runtime surface does not match the requested surface.", { runtime_surface: dispatch.runtime_surface }));
  }

  const [exportRows] = await connection.query(
    `SELECT export_key,parent_action_key,endpoint_key,tool_name,scope_class,status
       FROM platform_endpoint_tool_exports
      WHERE export_key=?
      LIMIT 2`,
    [selected.endpoint_export_key]
  );
  const endpointExport = exportRows?.[0] || null;
  if (exportRows?.length !== 1) blockers.push(blocker("endpoint_export_cardinality_invalid", "The selected endpoint export did not resolve uniquely.", { match_count: exportRows?.length || 0 }));
  if (endpointExport) {
    if (endpointExport.status !== "active") blockers.push(blocker("endpoint_export_inactive", "The selected endpoint export is not active.", { status: endpointExport.status }));
    if (dispatch && (endpointExport.parent_action_key !== dispatch.parent_action_key || endpointExport.endpoint_key !== dispatch.endpoint_key)) blockers.push(blocker("endpoint_export_dispatch_mismatch", "The endpoint export and dispatch binding resolve to different endpoints."));
  }

  const runtimeSurface = dispatch?.runtime_surface || selected.runtime_key;
  const toolOrActionKey = dispatch?.tool_key || selected.capability_key || selected.dispatch_binding_key;
  const [certificationRows] = await connection.query(
    `SELECT certification_key,surface_key,tool_or_action_key,risk_class,certification_status,dispatch_allowed,
            apply_allowed,requires_resource_authority,requires_dry_run,requires_audit_evidence,requires_readback,
            last_evidence_ref,last_certified_at,expires_at
       FROM runtime_dispatch_certification_registry
      WHERE surface_key=? AND (tool_or_action_key=? OR tool_or_action_key IS NULL)
      ORDER BY CASE WHEN tool_or_action_key=? THEN 0 ELSE 1 END
      LIMIT 2`,
    [runtimeSurface, toolOrActionKey, toolOrActionKey]
  );
  const certification = certificationRows?.[0] || null;
  if (!certification) blockers.push(blocker("runtime_certification_missing", "No runtime dispatch certification resolved for the selected surface."));
  if (certification) {
    if (certification.certification_status !== "certified") blockers.push(blocker("runtime_certification_inactive", "Runtime dispatch certification is not certified.", { certification_status: certification.certification_status }));
    if (!Boolean(certification.dispatch_allowed)) blockers.push(blocker("runtime_dispatch_not_allowed", "Runtime certification does not allow dispatch."));
    if (selected.requires_readback && !Boolean(certification.requires_readback)) blockers.push(blocker("runtime_readback_requirement_mismatch", "Runtime certification does not require the compiled readback posture."));
    if (input.expected_risk_class && certification.risk_class !== input.expected_risk_class) blockers.push(blocker("runtime_risk_class_mismatch", "Runtime certification risk class does not match the request.", { risk_class: certification.risk_class }));
    if (certification.expires_at && Date.parse(certification.expires_at) <= Date.parse(input.now)) blockers.push(blocker("runtime_certification_expired", "Runtime dispatch certification is expired.", { expires_at: new Date(certification.expires_at).toISOString() }));
  }

  return {
    blockers,
    evidence: {
      dispatch_binding: dispatch ? {
        binding_id: dispatch.binding_id,
        tool_key: dispatch.tool_key,
        capability_key: dispatch.capability_key,
        operation_intent: dispatch.operation_intent,
        runtime_surface: dispatch.runtime_surface,
        readback_policy_key: dispatch.readback_policy_key,
        status: dispatch.status
      } : null,
      endpoint_export: endpointExport ? {
        export_key: endpointExport.export_key,
        tool_name: endpointExport.tool_name,
        scope_class: endpointExport.scope_class,
        status: endpointExport.status
      } : null,
      runtime_certification: certification ? {
        certification_key: certification.certification_key,
        surface_key: certification.surface_key,
        tool_or_action_key: certification.tool_or_action_key,
        risk_class: certification.risk_class,
        certification_status: certification.certification_status,
        dispatch_allowed: Boolean(certification.dispatch_allowed),
        apply_allowed: Boolean(certification.apply_allowed),
        requires_resource_authority: Boolean(certification.requires_resource_authority),
        requires_dry_run: Boolean(certification.requires_dry_run),
        requires_audit_evidence: Boolean(certification.requires_audit_evidence),
        requires_readback: Boolean(certification.requires_readback),
        last_evidence_ref: certification.last_evidence_ref,
        last_certified_at: certification.last_certified_at,
        expires_at: certification.expires_at
      } : null
    }
  };
}

export async function verifyOperationRuntimeReadiness(input, dependencyOverrides = {}) {
  const normalized = normalizeInput(input);
  const pool = dependencyOverrides.pool || getPool();
  const connection = await pool.getConnection();
  try {
    const rows = await readCurrentManifest(connection, normalized);
    if (rows.length !== 1) {
      return blockedReport(normalized, [blocker("current_manifest_cardinality_invalid", "The current manifest did not resolve uniquely.", { match_count: rows.length })]);
    }
    const row = rows[0];
    const manifest = parseJson(row.manifest_json, "operation_compiled_manifests.manifest_json");
    const evidence = manifestEvidence(row, manifest);
    const manifestBlockers = verifyManifest(row, manifest, normalized);
    if (manifestBlockers.length > 0) return blockedReport(normalized, manifestBlockers, { manifest: evidence, authorities: null });
    const authorityResult = await verifyAuthorities(connection, manifest, normalized);
    if (authorityResult.blockers.length > 0) return blockedReport(normalized, authorityResult.blockers, { manifest: evidence, authorities: authorityResult.evidence });
    return readyReport(normalized, evidence, authorityResult.evidence);
  } finally {
    connection.release();
  }
}

export function createOperationRuntimeVerifier(dependencyOverrides = {}) {
  return Object.freeze({
    verify: (input) => verifyOperationRuntimeReadiness(input, dependencyOverrides)
  });
}
