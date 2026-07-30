import { getPool } from "./db.js";

const PRINCIPAL_SCOPES = new Set(["admin", "tenant", "internal"]);
const TENANT_BINDING_MODES = new Set(["none", "tenant_required", "admin_only", "internal_only"]);
const INTENT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/;

function compact(value, maxLength = 191) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function lower(value) {
  return compact(value).toLowerCase();
}

function rowsOf(result) {
  return Array.isArray(result?.[0]) ? result[0] : [];
}

function intentError(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function timestamp(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function bindingCurrent(row, nowMs) {
  if (lower(row.status) !== "active") return false;
  const validFrom = timestamp(row.valid_from);
  const expiresAt = timestamp(row.expires_at);
  if (validFrom !== null && validFrom > nowMs) return false;
  if (expiresAt !== null && expiresAt <= nowMs) return false;
  return true;
}

function priorityOf(row) {
  const parsed = Number(row.priority ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function revisionOf(row) {
  const parsed = Number(row.binding_revision ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareBindings(left, right) {
  return priorityOf(right) - priorityOf(left)
    || revisionOf(right) - revisionOf(left)
    || String(right.updated_at || "").localeCompare(String(left.updated_at || ""))
    || String(left.binding_id || "").localeCompare(String(right.binding_id || ""));
}

function validateBindingMode(row, request) {
  const mode = lower(row.tenant_binding_mode || "none");
  if (!TENANT_BINDING_MODES.has(mode)) {
    throw intentError(409, "EXECUTION_INTENT_BINDING_STALE", "The intent binding has an unsupported tenant binding mode.", {
      intent_key: request.intent_key,
      tenant_binding_mode: mode,
    });
  }
  if (request.principal_scope === "tenant" && !request.tenant_ref) {
    throw intentError(400, "EXECUTION_INTENT_TENANT_REQUIRED", "tenant_ref is required for tenant intent resolution.", {
      intent_key: request.intent_key,
      principal_scope: request.principal_scope,
    });
  }
  if (mode === "tenant_required" && request.principal_scope !== "tenant") {
    throw intentError(403, "EXECUTION_INTENT_SCOPE_CONFLICT", "The intent binding is restricted to tenant principals.", {
      intent_key: request.intent_key,
      requested_scope: request.principal_scope,
    });
  }
  if (mode === "admin_only" && request.principal_scope !== "admin") {
    throw intentError(403, "EXECUTION_INTENT_SCOPE_CONFLICT", "The intent binding is restricted to admin principals.", {
      intent_key: request.intent_key,
      requested_scope: request.principal_scope,
    });
  }
  if (mode === "internal_only" && request.principal_scope !== "internal") {
    throw intentError(403, "EXECUTION_INTENT_SCOPE_CONFLICT", "The intent binding is restricted to internal principals.", {
      intent_key: request.intent_key,
      requested_scope: request.principal_scope,
    });
  }
  return mode;
}

function safeBinding(row, request) {
  const parentActionKey = compact(row.parent_action_key);
  const endpointKey = compact(row.endpoint_key);
  const capabilityKey = compact(row.capability_key);
  if (!parentActionKey || !endpointKey || !capabilityKey) {
    throw intentError(409, "EXECUTION_INTENT_BINDING_STALE", "The intent binding is missing an exact action, endpoint, or capability key.", {
      intent_key: request.intent_key,
      binding_id: row.binding_id || null,
    });
  }
  return {
    binding_id: row.binding_id || null,
    intent_key: request.intent_key,
    principal_scope: request.principal_scope,
    tenant_binding_mode: validateBindingMode(row, request),
    parent_action_key: parentActionKey,
    endpoint_key: endpointKey,
    capability_key: capabilityKey,
    runtime_surface: compact(row.runtime_surface) || null,
    priority: priorityOf(row),
    binding_revision: revisionOf(row),
    source_registry: compact(row.source_registry) || null,
    source_key: compact(row.source_key) || null,
    valid_from: row.valid_from || null,
    expires_at: row.expires_at || null,
    secrets_included: false,
  };
}

export function normalizeIntentKey(value) {
  const intentKey = compact(value);
  if (!intentKey) return null;
  if (!INTENT_KEY_PATTERN.test(intentKey)) {
    throw intentError(400, "EXECUTION_INTENT_KEY_INVALID", "intent_key must use a stable alphanumeric dotted key.", {
      field: "intent_key",
    });
  }
  return intentKey;
}

export function mergeIntentBinding(request, binding) {
  if (!binding) return { ...request, intent_binding: null };
  const conflicts = [];
  for (const field of ["parent_action_key", "endpoint_key", "capability_key"]) {
    if (request[field] && request[field] !== binding[field]) conflicts.push(field);
  }
  if (request.runtime_surface && binding.runtime_surface && request.runtime_surface !== binding.runtime_surface) {
    conflicts.push("runtime_surface");
  }
  if (conflicts.length > 0) {
    throw intentError(409, "EXECUTION_INTENT_EXPLICIT_BINDING_CONFLICT", "Explicit execution keys conflict with the authoritative intent binding.", {
      intent_key: binding.intent_key,
      conflicts,
    });
  }
  return {
    ...request,
    parent_action_key: binding.parent_action_key,
    endpoint_key: binding.endpoint_key,
    capability_key: binding.capability_key,
    runtime_surface: request.runtime_surface || binding.runtime_surface,
    intent_binding: binding,
  };
}

export async function resolveExecutionIntentBinding(input = {}, deps = {}) {
  const intentKey = normalizeIntentKey(input.intent_key);
  if (!intentKey) return null;
  const principalScope = lower(input.principal_scope || "admin");
  if (!PRINCIPAL_SCOPES.has(principalScope)) {
    throw intentError(400, "EXECUTION_CONTRACT_PRINCIPAL_SCOPE_INVALID", "principal_scope must be admin, tenant, or internal.");
  }
  const request = {
    intent_key: intentKey,
    principal_scope: principalScope,
    tenant_ref: compact(input.tenant_ref) || null,
  };
  if (principalScope === "tenant" && !request.tenant_ref) {
    throw intentError(400, "EXECUTION_INTENT_TENANT_REQUIRED", "tenant_ref is required for tenant intent resolution.", {
      intent_key: intentKey,
      principal_scope: principalScope,
    });
  }
  const pool = deps.pool || getPool();
  const observedAt = typeof deps.now === "function" ? deps.now() : new Date().toISOString();
  const nowMs = new Date(observedAt).getTime();
  const rows = rowsOf(await pool.query(
    `SELECT binding_id, intent_key, principal_scope, tenant_binding_mode,
            parent_action_key, endpoint_key, capability_key, runtime_surface,
            status, priority, binding_revision, source_registry, source_key,
            valid_from, expires_at, updated_at
       FROM execution_intent_contract_bindings
      WHERE intent_key = ?
      ORDER BY priority DESC, binding_revision DESC, updated_at DESC, binding_id ASC
      LIMIT 20`,
    [intentKey],
  ));
  const current = rows.filter((row) => bindingCurrent(row, nowMs));
  const scoped = current.filter((row) => lower(row.principal_scope) === principalScope).sort(compareBindings);
  if (scoped.length === 0) {
    if (current.length > 0) {
      throw intentError(403, "EXECUTION_INTENT_SCOPE_CONFLICT", "The intent exists but is not available to the requested principal scope.", {
        intent_key: intentKey,
        requested_scope: principalScope,
        available_scopes: [...new Set(current.map((row) => lower(row.principal_scope)).filter(Boolean))].sort(),
      });
    }
    if (rows.length > 0) {
      throw intentError(409, "EXECUTION_INTENT_BINDING_STALE", "The intent binding exists but is inactive, not yet valid, or expired.", {
        intent_key: intentKey,
        candidate_count: rows.length,
      });
    }
    throw intentError(404, "EXECUTION_INTENT_BINDING_NOT_FOUND", "No execution contract binding is registered for intent_key.", {
      intent_key: intentKey,
    });
  }
  const [selected, runnerUp] = scoped;
  if (runnerUp && priorityOf(selected) === priorityOf(runnerUp) && revisionOf(selected) === revisionOf(runnerUp)) {
    throw intentError(409, "EXECUTION_INTENT_BINDING_AMBIGUOUS", "More than one equally authoritative intent binding exists.", {
      intent_key: intentKey,
      principal_scope: principalScope,
      candidate_count: scoped.length,
    });
  }
  return safeBinding(selected, request);
}
