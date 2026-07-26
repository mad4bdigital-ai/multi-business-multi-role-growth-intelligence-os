import { createHash } from "node:crypto";

const TARGET_MODES = new Set([
  "read_only",
  "diagnostic",
  "comment",
  "label",
  "close",
  "patch",
  "merge",
  "apply",
  "admin",
]);

const PERMISSION_RANK = new Map([
  ["read_only", 1],
  ["diagnostic", 1],
  ["comment", 2],
  ["label", 2],
  ["close", 3],
  ["patch", 4],
  ["merge", 5],
  ["admin", 6],
]);

function text(value) {
  return String(value ?? "").trim();
}

function parseModes(value) {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { parsed = []; }
  }
  return Array.isArray(parsed)
    ? parsed.map((entry) => text(entry).toLowerCase()).filter((entry) => TARGET_MODES.has(entry))
    : [];
}

function targetHash(resourceType, resourceUri) {
  return createHash("sha256")
    .update(`${text(resourceType).toLowerCase()}:${text(resourceUri)}`)
    .digest("hex");
}

function permissionAllowsMode(permissionLevel, mode) {
  const permission = text(permissionLevel).toLowerCase();
  if (mode === "apply") return ["patch", "merge", "admin"].includes(permission);
  const permissionRank = PERMISSION_RANK.get(permission) || 0;
  const modeRank = PERMISSION_RANK.get(mode) || 0;
  return permissionRank >= modeRank;
}

function decision({ ok, required, reason, denialCode = null, targetType = null, targetRefHash = null, mode = null, binding = null, lookupAttempted = false }) {
  return {
    ok,
    required,
    state: required ? (ok ? "pass" : "deny") : "not_applicable",
    reason,
    denial_code: denialCode,
    target_resource_type: targetType,
    target_reference_hash: targetRefHash,
    requested_mode: mode,
    authority_binding_present: Boolean(binding),
    lookup_attempted: lookupAttempted,
    authority_source: binding?.authority_source || null,
    permission_level: binding?.permission_level || null,
    secrets_included: false,
  };
}

export async function resolvePlatformManagedTargetAuthority({
  pool,
  credentialSource,
  principalClass = "admin",
  tenantId = null,
  workspaceId = null,
  userId = null,
  targetResourceType = null,
  targetResourceUri = null,
  targetMode = "read_only",
} = {}) {
  if (text(credentialSource).toLowerCase() !== "platform_managed") {
    return decision({
      ok: true,
      required: false,
      reason: "platform_managed_target_authority_not_applicable",
    });
  }

  const principal = text(principalClass).toLowerCase() || "admin";
  const resourceType = text(targetResourceType).toLowerCase();
  const resourceUri = text(targetResourceUri);
  const mode = text(targetMode).toLowerCase() || "read_only";
  const scopedPrincipal = Boolean(tenantId || workspaceId || userId);

  if (!TARGET_MODES.has(mode)) {
    return decision({
      ok: false,
      required: true,
      reason: "credential_target_mode_invalid",
      denialCode: "CREDENTIAL_TARGET_MODE_INVALID",
      targetType: resourceType || null,
      targetRefHash: resourceType && resourceUri ? targetHash(resourceType, resourceUri) : null,
      mode,
    });
  }

  if (!resourceType || !resourceUri) {
    if (principal === "admin" && !scopedPrincipal && ["read_only", "diagnostic"].includes(mode)) {
      return decision({
        ok: true,
        required: false,
        reason: "platform_admin_unscoped_read_only_target_not_required",
        mode,
      });
    }
    return decision({
      ok: false,
      required: true,
      reason: "credential_target_authority_required",
      denialCode: "CREDENTIAL_TARGET_AUTHORITY_REQUIRED",
      targetType: resourceType || null,
      targetRefHash: resourceType && resourceUri ? targetHash(resourceType, resourceUri) : null,
      mode,
    });
  }

  if (!pool || typeof pool.query !== "function") {
    return decision({
      ok: false,
      required: true,
      reason: "credential_target_authority_unavailable",
      denialCode: "CREDENTIAL_TARGET_AUTHORITY_UNAVAILABLE",
      targetType: resourceType,
      targetRefHash: targetHash(resourceType, resourceUri),
      mode,
    });
  }

  const clauses = [
    "resource_type = ?",
    "resource_uri = ?",
    "status = 'active'",
    "(expires_at IS NULL OR expires_at > NOW())",
  ];
  const params = [resourceType, resourceUri];

  if (tenantId) {
    clauses.push("tenant_id = ?");
    params.push(tenantId);
  } else {
    clauses.push("tenant_id IS NULL");
  }
  if (workspaceId) {
    clauses.push("(workspace_id IS NULL OR workspace_id = ?)");
    params.push(workspaceId);
  } else {
    clauses.push("workspace_id IS NULL");
  }
  if (userId) {
    clauses.push("(user_id IS NULL OR user_id = ?)");
    params.push(userId);
  } else {
    clauses.push("user_id IS NULL");
  }

  let rows;
  try {
    [rows] = await pool.query(
      `SELECT permission_level, allowed_modes_json, authority_source,
              tenant_id, workspace_id, user_id
         FROM platform_resource_authority_bindings
        WHERE ${clauses.join(" AND ")}
        ORDER BY user_id IS NOT NULL DESC,
                 workspace_id IS NOT NULL DESC,
                 updated_at DESC
        LIMIT 1`,
      params,
    );
  } catch {
    return decision({
      ok: false,
      required: true,
      reason: "credential_target_authority_unavailable",
      denialCode: "CREDENTIAL_TARGET_AUTHORITY_UNAVAILABLE",
      targetType: resourceType,
      targetRefHash: targetHash(resourceType, resourceUri),
      mode,
      lookupAttempted: true,
    });
  }

  const binding = rows?.[0] || null;
  if (!binding) {
    return decision({
      ok: false,
      required: true,
      reason: "credential_target_not_authorized",
      denialCode: "CREDENTIAL_TARGET_NOT_AUTHORIZED",
      targetType: resourceType,
      targetRefHash: targetHash(resourceType, resourceUri),
      mode,
      lookupAttempted: true,
    });
  }

  const allowedModes = parseModes(binding.allowed_modes_json);
  if (!allowedModes.includes(mode) || !permissionAllowsMode(binding.permission_level, mode)) {
    return decision({
      ok: false,
      required: true,
      reason: "credential_target_mode_not_allowed",
      denialCode: "CREDENTIAL_TARGET_MODE_NOT_ALLOWED",
      targetType: resourceType,
      targetRefHash: targetHash(resourceType, resourceUri),
      mode,
      binding,
      lookupAttempted: true,
    });
  }

  return decision({
    ok: true,
    required: true,
    reason: "credential_target_authorized",
    targetType: resourceType,
    targetRefHash: targetHash(resourceType, resourceUri),
    mode,
    binding,
    lookupAttempted: true,
  });
}
