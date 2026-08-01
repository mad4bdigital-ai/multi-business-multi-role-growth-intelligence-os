import { createHash } from "node:crypto";
import { getPool } from "./db.js";
import { buildDynamicCapabilityEnforcementShadow } from "./dynamicCapabilityEnforcementShadow.js";
import { mergeIntentBinding, normalizeIntentKey, resolveExecutionIntentBinding } from "./executionIntentBindingResolver.js";

export const CANONICAL_EXECUTION_CONTRACT_RESOLVER_VERSION = "canonical-execution-contract-resolver-shadow-v2";

const REQUESTED_MODES = new Set(["preview", "apply"]);
const PRINCIPAL_SCOPES = new Set(["admin", "tenant", "internal"]);
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const READY_VALIDATION_STATES = new Set(["", "ready", "valid", "validated", "verified", "pass", "passed", "active", "approved", "not_required"]);

function rowsOf(result) {
  return Array.isArray(result?.[0]) ? result[0] : [];
}

function compact(value, maxLength = 191) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function lower(value) {
  return compact(value, 191).toLowerCase();
}

function bool(value) {
  return value === true || Number(value || 0) === 1 || ["true", "yes", "required", "active"].includes(lower(value));
}

function resolverError(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function optionalSha(value, field) {
  const normalized = lower(value);
  if (!normalized) return null;
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw resolverError(400, "EXECUTION_CONTRACT_HASH_INVALID", `${field} must be a lowercase SHA-256 hash.`, { field });
  }
  return normalized;
}

function normalizeInput(input = {}) {
  const requestedMode = lower(input.requested_mode || "preview");
  if (!REQUESTED_MODES.has(requestedMode)) {
    throw resolverError(400, "EXECUTION_CONTRACT_MODE_INVALID", "requested_mode must be preview or apply.");
  }
  const principalScope = lower(input.principal_scope || "admin");
  if (!PRINCIPAL_SCOPES.has(principalScope)) {
    throw resolverError(400, "EXECUTION_CONTRACT_PRINCIPAL_SCOPE_INVALID", "principal_scope must be admin, tenant, or internal.");
  }
  const tenantRef = compact(input.tenant_ref) || null;
  const intentKey = normalizeIntentKey(input.intent_key);
  if (principalScope === "tenant" && !tenantRef) {
    throw resolverError(400, "EXECUTION_INTENT_TENANT_REQUIRED", "tenant_ref is required for tenant execution resolution.", {
      intent_key: intentKey,
      principal_scope: principalScope,
    });
  }
  const request = {
    intent_key: intentKey,
    parent_action_key: compact(input.parent_action_key) || null,
    endpoint_key: compact(input.endpoint_key) || null,
    capability_key: compact(input.capability_key) || null,
    requested_mode: requestedMode,
    principal_scope: principalScope,
    tenant_ref: tenantRef,
    workspace_ref: compact(input.workspace_ref) || null,
    resource_ref: compact(input.resource_ref, 512) || null,
    runtime_surface: compact(input.runtime_surface) || null,
    capability_envelope_id: compact(input.capability_envelope_id, 64) || null,
    idempotency_key: compact(input.idempotency_key, 191) || null,
    context_revision: compact(input.context_revision) || null,
    input_sha256: optionalSha(input.input_sha256, "input_sha256"),
    expected_contract_hash: optionalSha(input.expected_contract_hash, "expected_contract_hash"),
    evidence: input.evidence && typeof input.evidence === "object" && !Array.isArray(input.evidence) ? input.evidence : {},
    intent_binding: null,
  };
  if (!intentKey) requireExactBindings(request);
  return request;
}

function requireExactBindings(request) {
  if (!request.parent_action_key) throw resolverError(400, "EXECUTION_CONTRACT_ACTION_REQUIRED", "parent_action_key is required when intent_key is not resolved.");
  if (!request.endpoint_key) throw resolverError(400, "EXECUTION_CONTRACT_ENDPOINT_REQUIRED", "endpoint_key is required when intent_key is not resolved.");
  if (!request.capability_key) throw resolverError(400, "EXECUTION_CONTRACT_CAPABILITY_REQUIRED", "capability_key is required when intent_key is not resolved.");
}

async function loadActionRows(pool, actionKey) {
  return rowsOf(await pool.query(
    `SELECT action_key, status, module_binding, connector_family,
            runtime_capability_class, runtime_callable, primary_executor,
            route_target, execution_layer, review_required,
            allowed_actor_roles, allowed_governance_levels, admin_only,
            writeback_scope, updated_at
       FROM actions
      WHERE action_key = ?
      ORDER BY updated_at DESC
      LIMIT 3`,
    [actionKey],
  ));
}

function selectAction(rows, actionKey) {
  const active = rows.filter((row) => lower(row.status) === "active");
  if (active.length > 1) {
    throw resolverError(409, "EXECUTION_CONTRACT_AMBIGUOUS", "More than one active action binding exists.", {
      parent_action_key: actionKey,
      candidate_count: active.length,
    });
  }
  if (active.length === 1) return active[0];
  if (rows.length > 0) {
    throw resolverError(409, "EXECUTION_CONTRACT_STALE", "The action binding exists but is not active.", {
      parent_action_key: actionKey,
    });
  }
  throw resolverError(404, "EXECUTION_CONTRACT_ACTION_NOT_FOUND", "The parent action is not registered.", {
    parent_action_key: actionKey,
  });
}

async function loadEndpointRows(pool, actionKey, endpointKey) {
  return rowsOf(await pool.query(
    `SELECT endpoint_id, parent_action_key, endpoint_key, endpoint_operation,
            provider_domain, method, endpoint_path_or_function, route_target,
            module_binding, connector_family, status, spec_validation_status,
            auth_validation_status, privacy_validation_status,
            execution_readiness, endpoint_role, execution_mode,
            transport_required, fallback_allowed, inventory_role,
            transport_action_key, runtime_binding_profile, admin_only,
            writeback_scope, updated_at
       FROM endpoints
      WHERE parent_action_key = ? AND endpoint_key = ?
      ORDER BY updated_at DESC, id DESC
      LIMIT 5`,
    [actionKey, endpointKey],
  ));
}

function validationReady(value) {
  return READY_VALIDATION_STATES.has(lower(value));
}

function endpointReady(row) {
  return lower(row.status) === "active"
    && lower(row.execution_readiness) === "ready"
    && validationReady(row.spec_validation_status)
    && validationReady(row.auth_validation_status)
    && validationReady(row.privacy_validation_status);
}

function selectEndpoint(rows, actionKey, endpointKey) {
  const ready = rows.filter(endpointReady);
  if (ready.length > 1) {
    throw resolverError(409, "EXECUTION_CONTRACT_AMBIGUOUS", "More than one ready endpoint binding exists.", {
      parent_action_key: actionKey,
      endpoint_key: endpointKey,
      candidate_count: ready.length,
    });
  }
  if (ready.length === 1) return ready[0];
  if (rows.length > 0) {
    throw resolverError(409, "EXECUTION_CONTRACT_STALE", "The endpoint binding exists but is not fully ready.", {
      parent_action_key: actionKey,
      endpoint_key: endpointKey,
      candidate_count: rows.length,
    });
  }
  throw resolverError(404, "EXECUTION_CONTRACT_ENDPOINT_NOT_FOUND", "The endpoint binding is not registered.", {
    parent_action_key: actionKey,
    endpoint_key: endpointKey,
  });
}

function enforcePrincipalScope(request, action, endpoint) {
  if (request.principal_scope !== "admin" && (bool(action.admin_only) || bool(endpoint.admin_only))) {
    throw resolverError(403, "EXECUTION_CONTRACT_PRINCIPAL_SCOPE_CONFLICT", "The selected execution contract is restricted to admin principals.", {
      intent_key: request.intent_key,
      principal_scope: request.principal_scope,
      parent_action_key: request.parent_action_key,
      endpoint_key: request.endpoint_key,
    });
  }
}

function deriveBindings(request, action, endpoint) {
  const conflicts = [];
  if (action.module_binding && endpoint.module_binding && action.module_binding !== endpoint.module_binding) conflicts.push("MODULE_BINDING_CONFLICT");
  if (action.connector_family && endpoint.connector_family && action.connector_family !== endpoint.connector_family) conflicts.push("CONNECTOR_FAMILY_CONFLICT");
  if (action.route_target && endpoint.route_target && action.route_target !== endpoint.route_target) conflicts.push("ROUTE_TARGET_CONFLICT");
  if (conflicts.length > 0) {
    throw resolverError(409, "EXECUTION_CONTRACT_AMBIGUOUS", "Action and endpoint bindings conflict.", {
      parent_action_key: request.parent_action_key,
      endpoint_key: request.endpoint_key,
      conflicts,
    });
  }
  const runtimeSurface = request.runtime_surface
    || compact(endpoint.transport_action_key)
    || compact(endpoint.endpoint_key)
    || compact(action.primary_executor)
    || compact(endpoint.route_target)
    || compact(action.route_target);
  if (!runtimeSurface) {
    throw resolverError(409, "EXECUTION_CONTRACT_STALE", "No runtime surface can be resolved for the endpoint.", {
      parent_action_key: request.parent_action_key,
      endpoint_key: request.endpoint_key,
    });
  }
  return {
    runtime_surface: runtimeSurface,
    runtime_surface_source: request.runtime_surface
      ? "request"
      : endpoint.transport_action_key
        ? "endpoint.transport_action_key"
        : endpoint.endpoint_key
          ? "endpoint.endpoint_key"
          : action.primary_executor
            ? "action.primary_executor"
            : endpoint.route_target
              ? "endpoint.route_target"
              : "action.route_target",
    route_target: compact(endpoint.route_target || action.route_target) || null,
    module_binding: compact(endpoint.module_binding || action.module_binding) || null,
    connector_family: compact(endpoint.connector_family || action.connector_family) || null,
    executor: compact(action.primary_executor) || null,
  };
}

function placeholders(values) {
  return values.map(() => "?").join(", ");
}

async function loadCertificationRows(pool, keys) {
  const unique = [...new Set(keys.map((item) => compact(item)).filter(Boolean))];
  if (!unique.length) return [];
  const marks = placeholders(unique);
  return rowsOf(await pool.query(
    `SELECT certification_key, surface_key, surface_family, tool_or_action_key,
            risk_class, certification_status, dispatch_allowed, apply_allowed,
            requires_resource_authority, requires_dry_run,
            requires_audit_evidence, requires_readback,
            last_evidence_ref, last_certified_at, expires_at
       FROM runtime_dispatch_certification_registry
      WHERE certification_key IN (${marks})
         OR surface_key IN (${marks})
         OR tool_or_action_key IN (${marks})
      ORDER BY last_certified_at DESC, certification_key ASC
      LIMIT 20`,
    [...unique, ...unique, ...unique],
  ));
}

function expired(value, nowMs) {
  if (!value) return false;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) && parsed <= nowMs;
}

function certificationScore(row, keys) {
  let score = 0;
  if (row.tool_or_action_key === keys.runtime_surface) score += 120;
  if (row.surface_key === keys.runtime_surface) score += 110;
  if (row.tool_or_action_key === keys.endpoint_key) score += 100;
  if (row.surface_key === keys.endpoint_key) score += 90;
  if (row.certification_key === keys.capability_key) score += 80;
  if (row.tool_or_action_key === keys.capability_key) score += 70;
  if (row.surface_key === keys.capability_key) score += 60;
  if (row.tool_or_action_key === keys.parent_action_key) score += 50;
  return score;
}

function selectCertification(rows, keys, requestedMode, nowMs) {
  const ranked = rows
    .map((row) => ({ row, score: certificationScore(row, keys) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score
      || String(b.row.last_certified_at || "").localeCompare(String(a.row.last_certified_at || ""))
      || String(a.row.certification_key).localeCompare(String(b.row.certification_key)));
  const current = ranked.filter(({ row }) => bool(row.dispatch_allowed)
    && (requestedMode !== "apply" || bool(row.apply_allowed))
    && !expired(row.expires_at, nowMs));
  if (current.length > 1 && current[0].score === current[1].score) {
    throw resolverError(409, "EXECUTION_CONTRACT_AMBIGUOUS", "More than one equally ranked runtime certification exists.", {
      runtime_surface: keys.runtime_surface,
      candidate_count: current.length,
    });
  }
  if (current.length > 0) return { state: "pass", row: current[0].row, candidate_count: current.length };
  const stale = ranked.find(({ row }) => bool(row.dispatch_allowed) && expired(row.expires_at, nowMs));
  if (stale) return { state: "stale", row: stale.row, candidate_count: ranked.length };
  return { state: "missing", row: null, candidate_count: ranked.length };
}

async function loadResourceOperationRows(pool, endpoint, runtimeSurface) {
  const method = compact(endpoint.method, 16).toUpperCase();
  const path = compact(endpoint.endpoint_path_or_function, 512);
  return rowsOf(await pool.query(
    `SELECT operation_id, resource_key, actor_scope, operation_key,
            http_method, http_path, implementation_status, route_file,
            tool_key, readback_required, permissions_required, status
       FROM platform_resource_operation_registry
      WHERE status = 'active' AND implementation_status = 'active'
        AND (tool_key IN (?, ?) OR (http_method = ? AND http_path = ?))
      ORDER BY updated_at DESC, operation_id ASC
      LIMIT 10`,
    [runtimeSurface, endpoint.endpoint_key, method, path],
  ));
}

function resourceOperationScore(row, endpoint, runtimeSurface) {
  let score = 0;
  if (row.tool_key === runtimeSurface) score += 120;
  if (row.tool_key === endpoint.endpoint_key) score += 100;
  if (compact(row.http_method, 16).toUpperCase() === compact(endpoint.method, 16).toUpperCase()
    && row.http_path === endpoint.endpoint_path_or_function) score += 80;
  return score;
}

function actorScopeCompatible(actorScope, principalScope) {
  const scope = lower(actorScope);
  if (["shared", "global", "any"].includes(scope)) return true;
  const aliases = {
    admin: new Set(["admin", "platform_admin"]),
    tenant: new Set(["tenant", "tenant_user"]),
    internal: new Set(["internal", "system"]),
  };
  return aliases[principalScope]?.has(scope) || false;
}

function selectResourceOperation(rows, endpoint, runtimeSurface, principalScope, strictScope = false) {
  const ranked = rows
    .map((row) => ({ row, score: resourceOperationScore(row, endpoint, runtimeSurface) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || String(a.row.operation_id).localeCompare(String(b.row.operation_id)));
  const scoped = ranked.filter(({ row }) => actorScopeCompatible(row.actor_scope, principalScope));
  if (ranked.length > 0 && scoped.length === 0 && strictScope) {
    throw resolverError(403, "EXECUTION_CONTRACT_PRINCIPAL_SCOPE_CONFLICT", "Resource-operation bindings exist only for a different principal scope.", {
      principal_scope: principalScope,
      runtime_surface: runtimeSurface,
      endpoint_key: endpoint.endpoint_key,
      available_scopes: [...new Set(ranked.map(({ row }) => lower(row.actor_scope)).filter(Boolean))].sort(),
    });
  }
  const candidates = scoped.length > 0 ? scoped : strictScope ? [] : ranked;
  const [selected, runnerUp] = candidates;
  if (selected && runnerUp && selected.score === runnerUp.score) {
    throw resolverError(409, "EXECUTION_CONTRACT_AMBIGUOUS", "More than one equally ranked resource operation exists.", {
      runtime_surface: runtimeSurface,
      endpoint_key: endpoint.endpoint_key,
      principal_scope: principalScope,
      candidate_count: candidates.length,
    });
  }
  return selected?.row || null;
}

async function loadReadbackRows(pool, capabilityKey) {
  return rowsOf(await pool.query(
    `SELECT contract_id, contract_key, contract_version, capability_key,
            adapter_key, verification_type, acknowledgement_required,
            verification_required, expected_effect_class,
            certification_status, status, is_current, expires_at,
            source_registry, source_key, secrets_included
       FROM platform_capability_readback_contracts
      WHERE capability_key = ?
        AND is_current = 1
        AND status IN ('shadow', 'certified')
        AND certification_status IN ('certified', 'not_required')
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY contract_version DESC, contract_key ASC
      LIMIT 10`,
    [capabilityKey],
  ));
}

function readbackScore(row, runtimeSurface, endpointKey) {
  if (row.adapter_key === runtimeSurface) return 120;
  if (row.adapter_key === endpointKey) return 100;
  if (!row.adapter_key) return 50;
  return 10;
}

function selectReadback(rows, runtimeSurface, endpointKey) {
  const ranked = rows
    .map((row) => ({ row, score: readbackScore(row, runtimeSurface, endpointKey) }))
    .sort((a, b) => b.score - a.score || Number(b.row.contract_version || 0) - Number(a.row.contract_version || 0));
  if (ranked.length > 1 && ranked[0].score === ranked[1].score
    && Number(ranked[0].row.contract_version || 0) === Number(ranked[1].row.contract_version || 0)) {
    throw resolverError(409, "EXECUTION_CONTRACT_AMBIGUOUS", "More than one equally ranked readback contract exists.", {
      runtime_surface: runtimeSurface,
      endpoint_key: endpointKey,
      candidate_count: ranked.length,
    });
  }
  return ranked[0]?.row || null;
}

function safeAction(row) {
  return {
    action_key: row.action_key,
    status: row.status,
    runtime_callable: bool(row.runtime_callable),
    runtime_capability_class: row.runtime_capability_class || null,
    primary_executor: row.primary_executor || null,
    execution_layer: row.execution_layer || null,
    review_required: bool(row.review_required),
    admin_only: bool(row.admin_only),
    writeback_scope: row.writeback_scope || null,
  };
}

function safeEndpoint(row) {
  return {
    endpoint_id: row.endpoint_id,
    parent_action_key: row.parent_action_key,
    endpoint_key: row.endpoint_key,
    operation: row.endpoint_operation || null,
    method: compact(row.method, 16).toUpperCase(),
    path_or_function: row.endpoint_path_or_function || null,
    role: row.endpoint_role || null,
    execution_mode: row.execution_mode || null,
    execution_readiness: row.execution_readiness,
    transport_required: bool(row.transport_required),
    fallback_allowed: bool(row.fallback_allowed),
    admin_only: bool(row.admin_only),
    writeback_scope: row.writeback_scope || null,
  };
}

function safeCertification(selection) {
  const row = selection?.row;
  if (!row) return { state: selection?.state || "missing", candidate_count: Number(selection?.candidate_count || 0), certification: null };
  return {
    state: selection.state,
    candidate_count: Number(selection.candidate_count || 0),
    certification: {
      certification_key: row.certification_key,
      surface_key: row.surface_key,
      surface_family: row.surface_family,
      tool_or_action_key: row.tool_or_action_key || null,
      risk_class: row.risk_class,
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
  };
}

function safeResourceOperation(row) {
  if (!row) return null;
  return {
    operation_id: row.operation_id,
    resource_key: row.resource_key,
    actor_scope: row.actor_scope,
    operation_key: row.operation_key,
    http_method: row.http_method,
    http_path: row.http_path,
    route_file: row.route_file,
    tool_key: row.tool_key || null,
    readback_required: bool(row.readback_required),
    permissions_required: bool(row.permissions_required),
  };
}

function safeReadback(row) {
  if (!row) return null;
  return {
    contract_id: row.contract_id,
    contract_key: row.contract_key,
    contract_version: Number(row.contract_version || 0),
    capability_key: row.capability_key,
    adapter_key: row.adapter_key || null,
    verification_type: row.verification_type,
    acknowledgement_required: bool(row.acknowledgement_required),
    verification_required: bool(row.verification_required),
    expected_effect_class: row.expected_effect_class || null,
    certification_status: row.certification_status,
    status: row.status,
    source_registry: row.source_registry || null,
    source_key: row.source_key || null,
    secrets_included: false,
  };
}

function nextActionFor(blocker) {
  const actions = {
    CERTIFICATION_REQUIRED: "certify_runtime_surface",
    CERTIFICATION_STALE: "recertify_runtime_surface",
    RESOURCE_OPERATION_BINDING_REQUIRED: "register_resource_operation",
    READBACK_CONTRACT_REQUIRED: "register_readback_contract",
    IDEMPOTENCY_KEY_REQUIRED: "provide_idempotency_key",
    CAPABILITY_PREVIEW_NOT_ALLOWED: "resolve_capability_preview_blockers",
    CAPABILITY_DISPATCH_NOT_READY: "resolve_capability_dispatch_blockers",
  };
  return actions[blocker] || "review_execution_contract_gap";
}

export async function resolveCanonicalExecutionContract(input = {}, deps = {}) {
  const initialRequest = normalizeInput(input);
  const pool = deps.pool || getPool();
  const observedAt = typeof deps.now === "function" ? deps.now() : new Date().toISOString();
  const nowMs = new Date(observedAt).getTime();
  const intentBinding = await resolveExecutionIntentBinding(initialRequest, { pool, now: () => observedAt });
  const request = mergeIntentBinding(initialRequest, intentBinding);
  requireExactBindings(request);
  const action = selectAction(await loadActionRows(pool, request.parent_action_key), request.parent_action_key);
  const endpoint = selectEndpoint(await loadEndpointRows(pool, request.parent_action_key, request.endpoint_key), request.parent_action_key, request.endpoint_key);
  enforcePrincipalScope(request, action, endpoint);
  const bindings = deriveBindings(request, action, endpoint);
  const [resourceRows, certificationRows, readbackRows] = await Promise.all([
    loadResourceOperationRows(pool, endpoint, bindings.runtime_surface),
    loadCertificationRows(pool, [bindings.runtime_surface, request.endpoint_key, request.parent_action_key, request.capability_key]),
    loadReadbackRows(pool, request.capability_key),
  ]);
  const resourceOperation = selectResourceOperation(resourceRows, endpoint, bindings.runtime_surface, request.principal_scope, Boolean(request.intent_binding) || request.principal_scope === "tenant");
  const certification = selectCertification(certificationRows, {
    runtime_surface: bindings.runtime_surface,
    endpoint_key: request.endpoint_key,
    parent_action_key: request.parent_action_key,
    capability_key: request.capability_key,
  }, request.requested_mode, nowMs);
  const readback = selectReadback(readbackRows, bindings.runtime_surface, request.endpoint_key);
  const capabilityEvaluator = deps.capabilityEvaluator || buildDynamicCapabilityEnforcementShadow;
  const capabilityDecision = await capabilityEvaluator({
    capability_key: request.capability_key,
    requested_mode: request.requested_mode,
    principal_scope: request.principal_scope,
    tenant_ref: request.tenant_ref,
    workspace_ref: request.workspace_ref,
    resource_ref: request.resource_ref,
    runtime_surface: bindings.runtime_surface,
    capability_envelope_id: request.capability_envelope_id,
    context_revision: request.context_revision,
    input_sha256: request.input_sha256,
    legacy_decision: "not_evaluated",
    evidence: request.evidence,
  }, { pool, now: deps.now });
  const applyMode = request.requested_mode === "apply";
  const method = compact(endpoint.method, 16).toUpperCase();
  const unsafeMethod = UNSAFE_METHODS.has(method);
  const certificationRow = certification.row;
  const resourceAuthorityRequired = applyMode && (bool(certificationRow?.requires_resource_authority) || bool(resourceOperation?.permissions_required));
  const readbackRequired = applyMode && (unsafeMethod || bool(certificationRow?.requires_readback) || bool(resourceOperation?.readback_required));
  const auditRequired = applyMode && (unsafeMethod || bool(certificationRow?.requires_audit_evidence));
  const dryRunRequired = applyMode && bool(certificationRow?.requires_dry_run);
  const approvalRequired = applyMode && (unsafeMethod || bool(action.review_required) || bool(endpoint.admin_only));
  const idempotencyRequired = applyMode && unsafeMethod;
  const blockers = [];
  if (applyMode && certification.state === "stale") blockers.push("CERTIFICATION_STALE");
  else if (applyMode && certification.state !== "pass") blockers.push("CERTIFICATION_REQUIRED");
  if (resourceAuthorityRequired && !resourceOperation) blockers.push("RESOURCE_OPERATION_BINDING_REQUIRED");
  if (readbackRequired && !readback) blockers.push("READBACK_CONTRACT_REQUIRED");
  if (idempotencyRequired && !request.idempotency_key) blockers.push("IDEMPOTENCY_KEY_REQUIRED");
  const capabilityEligible = request.requested_mode === "preview"
    ? capabilityDecision?.adaptive_decision === "allow_preview"
    : capabilityDecision?.adaptive_decision === "ready_for_dispatch";
  if (!capabilityEligible) blockers.push(request.requested_mode === "preview" ? "CAPABILITY_PREVIEW_NOT_ALLOWED" : "CAPABILITY_DISPATCH_NOT_READY");
  for (const blocker of capabilityDecision?.blockers || []) blockers.push(compact(blocker, 128));
  const uniqueBlockers = [...new Set(blockers.filter(Boolean))].slice(0, 30);
  const policy = {
    approval: { required: approvalRequired, mode: approvalRequired ? "user_approval_only" : "none" },
    retry: { mode: applyMode ? "read_before_retry" : "none", unknown_outcome_reconciliation_required: applyMode },
    idempotency: { required: idempotencyRequired, provided: Boolean(request.idempotency_key) },
    resource_authority: { required: resourceAuthorityRequired, binding_present: Boolean(resourceOperation) },
    dry_run: { required: dryRunRequired },
    audit: { required: auditRequired },
    readback: { required: readbackRequired, contract_present: Boolean(readback) },
    evidence: { runtime_certification_required: applyMode, capability_manifest_required: true, no_secret_payloads: true },
  };
  const contractDescriptor = {
    resolver_version: CANONICAL_EXECUTION_CONTRACT_RESOLVER_VERSION,
    intent_key: request.intent_key,
    intent_binding_revision: request.intent_binding?.binding_revision || null,
    intent_binding_source_registry: request.intent_binding?.source_registry || null,
    action_key: request.parent_action_key,
    endpoint_key: request.endpoint_key,
    capability_key: request.capability_key,
    requested_mode: request.requested_mode,
    principal_scope: request.principal_scope,
    runtime_surface: bindings.runtime_surface,
    route_target: bindings.route_target,
    module_binding: bindings.module_binding,
    connector_family: bindings.connector_family,
    method,
    path_or_function: endpoint.endpoint_path_or_function || null,
    certification_key: certificationRow?.certification_key || null,
    resource_operation_id: resourceOperation?.operation_id || null,
    readback_contract_key: readback?.contract_key || null,
    policy,
  };
  const contractHash = sha256(contractDescriptor);
  if (request.expected_contract_hash && request.expected_contract_hash !== contractHash) {
    throw resolverError(409, "EXECUTION_CONTRACT_STALE", "The resolved execution contract does not match expected_contract_hash.", {
      expected_contract_hash: request.expected_contract_hash,
      observed_contract_hash: contractHash,
    });
  }
  const resolved = uniqueBlockers.length === 0;
  const decision = resolved ? request.requested_mode === "apply" ? "resolved_apply_candidate" : "resolved_preview" : "blocked";
  return {
    ok: true,
    report_type: "canonical_execution_contract_resolution",
    resolver_version: CANONICAL_EXECUTION_CONTRACT_RESOLVER_VERSION,
    mode: "shadow",
    observed_at: observedAt,
    decision,
    contract_hash: contractHash,
    request: {
      intent_key: request.intent_key,
      parent_action_key: request.parent_action_key,
      endpoint_key: request.endpoint_key,
      capability_key: request.capability_key,
      requested_mode: request.requested_mode,
      principal_scope: request.principal_scope,
      tenant_ref: request.tenant_ref,
      workspace_ref: request.workspace_ref,
      resource_ref: request.resource_ref,
      runtime_surface: request.runtime_surface,
      input_sha256: request.input_sha256,
    },
    selection: {
      intent_binding: request.intent_binding,
      action: safeAction(action),
      endpoint: safeEndpoint(endpoint),
      bindings,
      capability: {
        adaptive_decision: capabilityDecision?.adaptive_decision || "not_evaluated",
        decision_hash: capabilityDecision?.decision_hash || null,
        manifest_hash: capabilityDecision?.manifest?.manifest_hash || null,
        source_revision_hash: capabilityDecision?.manifest?.source_revision_hash || null,
        blockers: Array.isArray(capabilityDecision?.blockers) ? capabilityDecision.blockers.slice(0, 20) : [],
      },
      certification: safeCertification(certification),
      resource_operation: safeResourceOperation(resourceOperation),
      readback_contract: safeReadback(readback),
    },
    policy,
    blockers: uniqueBlockers,
    next_action: resolved ? { action: "none", reason_code: "EXECUTION_CONTRACT_RESOLVED" } : { action: nextActionFor(uniqueBlockers[0]), reason_code: uniqueBlockers[0] || "EXECUTION_CONTRACT_BLOCKED" },
    execution_performed: false,
    guarantees: {
      intent_first_resolution: Boolean(request.intent_binding),
      explicit_binding_compatibility_checked: Boolean(request.intent_binding),
      tenant_scope_enforced: request.principal_scope !== "tenant" || Boolean(request.tenant_ref),
      no_secret_intent_columns_selected: true,
      registry_authority: "mysql_primary",
      exact_action_endpoint_pair: true,
      capability_shadow_reused: true,
      runtime_authority_changed: false,
      public_route_added: false,
      mutations_performed: false,
      provider_calls_performed: false,
      external_writes_performed: false,
      credential_payloads_read: false,
      raw_schema_payloads_returned: false,
      fail_closed: true,
      secrets_included: false,
    },
    secrets_included: false,
  };
}

export const _testingCanonicalExecutionContractResolver = { normalizeInput, selectAction, selectEndpoint, deriveBindings, selectCertification, selectResourceOperation, selectReadback };
