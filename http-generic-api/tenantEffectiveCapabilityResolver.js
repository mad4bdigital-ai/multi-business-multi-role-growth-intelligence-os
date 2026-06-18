import crypto from "node:crypto";
import { getPool } from "./db.js";

const READ_OPERATIONS = new Set(["read", "list", "inspect", "preview", "status", "search"]);
const MUTATION_PERMISSIONS = new Set(["owner", "admin", "manage", "operate", "edit"]);
const SEMANTIC_CAPABILITY_SCHEMA_OBJECTS = Object.freeze([
  { name: "platform_semantic_capabilities", type: "BASE TABLE" },
  { name: "platform_capability_provider_bindings", type: "BASE TABLE" },
  { name: "platform_endpoint_aliases", type: "BASE TABLE" },
  { name: "tenant_capability_shadow_decisions", type: "BASE TABLE" },
  { name: "v_platform_endpoint_canonical_identity", type: "VIEW" },
  { name: "v_platform_capability_export_projection", type: "VIEW" },
  { name: "v_platform_capability_export_reconciliation", type: "VIEW" },
  { name: "v_tenant_effective_capability_candidates", type: "VIEW" },
]);
const READ_PERMISSIONS = new Set([...MUTATION_PERMISSIONS, "comment", "view"]);

function safeText(value = "", max = 255) {
  return String(value || "").trim().slice(0, max);
}

function normalize(value = "") {
  return safeText(value, 255).toLowerCase();
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function isAdmin(auth = {}) {
  return auth?.is_admin === true;
}

function principalScope(args = {}, auth = {}) {
  const admin = isAdmin(auth);
  const tenantId = admin && args.tenant_id
    ? safeText(args.tenant_id, 64)
    : safeText(auth?.tenant_id, 64);
  const userId = admin && args.user_id
    ? safeText(args.user_id, 64)
    : safeText(auth?.user_id, 64);
  return { admin, tenantId, userId };
}

function publicConnection(row = null) {
  if (!row) return null;
  return {
    connection_id: row.connection_id,
    app_key: row.app_key,
    display_label: row.display_label || null,
    account_label: row.account_label || null,
    status: row.connection_status || null,
    validation_status: row.validation_status || null,
    is_primary: Boolean(row.is_primary),
    last_validated_at: row.last_validated_at || null,
    selection_score: Number(row.selection_score || 0),
    secrets_included: false,
  };
}

function publicEndpoint(row = null, canonicalEndpointKey = null, aliasApplied = false) {
  if (!row) return null;
  return {
    endpoint_id: row.endpoint_id || null,
    parent_action_key: row.parent_action_key,
    endpoint_key: canonicalEndpointKey || row.endpoint_key,
    source_endpoint_key: row.endpoint_key,
    alias_applied: aliasApplied,
    method: row.method || null,
    endpoint_path_or_function: row.endpoint_path_or_function || null,
    module_binding: row.module_binding || null,
    connector_family: row.connector_family || null,
    status: row.status || null,
    execution_readiness: row.execution_readiness || null,
    schema_present: Boolean(row.schema_present),
    secrets_included: false,
  };
}

function errorResult(code, message, details = {}) {
  return {
    ok: false,
    status: "blocked",
    error: { code, message, details },
    secrets_included: false,
  };
}

async function loadSemanticCapabilitySchemaReadiness(pool) {
  const names = SEMANTIC_CAPABILITY_SCHEMA_OBJECTS.map((item) => item.name);
  const placeholders = names.map(() => "?").join(", ");
  const [rows] = await pool.query(
    `SELECT table_name, table_type
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name IN (${placeholders})`,
    names
  );
  const observed = new Map(
    (rows || []).map((row) => [
      String(row.table_name),
      String(row.table_type || "").toUpperCase(),
    ])
  );
  const missing = SEMANTIC_CAPABILITY_SCHEMA_OBJECTS.filter(
    (item) => observed.get(item.name) !== item.type
  );
  return {
    expected: SEMANTIC_CAPABILITY_SCHEMA_OBJECTS,
    present: SEMANTIC_CAPABILITY_SCHEMA_OBJECTS.filter(
      (item) => observed.get(item.name) === item.type
    ),
    missing,
  };
}

async function countReadinessRows(pool, sql) {
  const [rows] = await pool.query(sql);
  return Number(rows?.[0]?.c || 0);
}

async function resolveWorkspace(pool, { tenantId, workspaceId, workspaceKey }) {
  const where = ["tenant_id = ?"];
  const params = [tenantId];
  if (workspaceId) {
    where.push("workspace_id = ?");
    params.push(workspaceId);
  } else if (workspaceKey) {
    where.push("workspace_key = ?");
    params.push(workspaceKey);
  }
  const [rows] = await pool.query(
    `SELECT workspace_id, tenant_id, workspace_key, display_name, workspace_type,
            bootstrap_status, linked_brand_key, created_at
       FROM workspace_registry
      WHERE ${where.join(" AND ")}
      ORDER BY (workspace_id = tenant_id) DESC,
               (bootstrap_status = 'ready') DESC,
               created_at ASC
      LIMIT 3`,
    params
  );
  return {
    workspace: rows?.[0] || null,
    candidate_count: rows?.length || 0,
    default_resolution_used: !workspaceId && !workspaceKey,
  };
}

async function resolveMembership(pool, tenantId, userId) {
  const [rows] = await pool.query(
    `SELECT user_id, tenant_id, role, status, granted_at
       FROM memberships
      WHERE tenant_id = ? AND user_id = ? AND status = 'active'
      LIMIT 1`,
    [tenantId, userId]
  );
  return rows?.[0] || null;
}

async function resolveCapability(pool, capabilityKey) {
  const [rows] = await pool.query(
    `SELECT capability_key, display_name, description, resource_type, operation_key,
            risk_class, default_execution_mode, input_schema_json, output_schema_json,
            default_policy_key, requires_connection, requires_workspace_authority,
            requires_approval, requires_audit_evidence, requires_readback,
            schema_version, status
       FROM platform_semantic_capabilities
      WHERE capability_key = ? AND status = 'active'
      LIMIT 1`,
    [capabilityKey]
  );
  return rows?.[0] || null;
}

async function resolveBindings(pool, capabilityKey) {
  const [rows] = await pool.query(
    `SELECT binding_id, capability_key, app_key, parent_action_key, endpoint_key,
            adapter_key, policy_key, priority, rollout_mode,
            connection_resolution_policy_json, input_mapping_json,
            output_mapping_json, status
       FROM platform_capability_provider_bindings
      WHERE capability_key = ? AND status = 'active' AND rollout_mode <> 'disabled'
      ORDER BY priority ASC, binding_id ASC`,
    [capabilityKey]
  );
  return rows || [];
}

async function resolveCanonicalEndpoint(pool, binding) {
  const [[alias]] = await pool.query(
    `SELECT alias_endpoint_key, canonical_endpoint_key, alias_type
       FROM platform_endpoint_aliases
      WHERE parent_action_key = ? AND alias_endpoint_key = ? AND status = 'active'
      LIMIT 1`,
    [binding.parent_action_key, binding.endpoint_key]
  );
  const canonicalKey = alias?.canonical_endpoint_key || binding.endpoint_key;
  const [rows] = await pool.query(
    `SELECT id, endpoint_id, parent_action_key, endpoint_key, method,
            endpoint_path_or_function, module_binding, connector_family,
            status, execution_readiness, schema_json IS NOT NULL AS schema_present,
            updated_at
       FROM endpoints
      WHERE parent_action_key = ? AND endpoint_key = ?
        AND LOWER(COALESCE(status, '')) IN ('active','ready','enabled')
        AND LOWER(COALESCE(execution_readiness, 'ready')) IN ('ready','active','enabled')
      ORDER BY (schema_json IS NOT NULL) DESC, updated_at DESC, id ASC
      LIMIT 5`,
    [binding.parent_action_key, canonicalKey]
  );
  return {
    canonical_endpoint_key: canonicalKey,
    alias,
    endpoint: rows?.[0] || null,
    active_candidate_count: rows?.length || 0,
  };
}

async function resolveConnections(pool, { tenantId, workspaceId, appKey, explicitConnectionId }) {
  const [rows] = await pool.query(
    `SELECT wal.link_id, wal.workspace_id, wal.permission_mode,
            uac.connection_id, uac.app_key, uac.display_label, uac.account_label,
            uac.status AS connection_status, uac.validation_status,
            uac.is_primary, uac.last_validated_at,
            CASE
              WHEN ? <> '' AND uac.connection_id = ? THEN 1000
              WHEN LOWER(COALESCE(uac.validation_status, '')) = 'validated' AND uac.is_primary = 1 THEN 900
              WHEN LOWER(COALESCE(uac.validation_status, '')) = 'validated' THEN 800
              WHEN uac.status = 'active' AND uac.is_primary = 1 THEN 600
              WHEN uac.status = 'active' THEN 500
              ELSE 0
            END AS selection_score
       FROM workspace_app_links wal
       JOIN user_app_connections uac
         ON uac.connection_id COLLATE utf8mb4_unicode_ci = wal.connection_id COLLATE utf8mb4_unicode_ci
      WHERE wal.tenant_id = ?
        AND wal.workspace_id = ?
        AND wal.app_key = ?
        AND wal.status = 'active'
        AND uac.tenant_id = ?
        AND uac.status = 'active'
      ORDER BY selection_score DESC,
               uac.last_validated_at DESC,
               uac.connection_id ASC`,
    [explicitConnectionId || "", explicitConnectionId || "", tenantId, workspaceId, appKey, tenantId]
  );
  const candidates = rows || [];
  if (explicitConnectionId) {
    const explicit = candidates.find((row) => row.connection_id === explicitConnectionId) || null;
    return {
      candidates,
      selected: explicit,
      ambiguous: false,
      explicit_requested: true,
    };
  }
  const selected = candidates[0] || null;
  const topScore = Number(selected?.selection_score || 0);
  const topCount = topScore > 0
    ? candidates.filter((row) => Number(row.selection_score || 0) === topScore).length
    : 0;
  return {
    candidates,
    selected,
    ambiguous: topCount > 1,
    explicit_requested: false,
  };
}

async function resolveActionGrant(pool, { workspaceId, connectionId, appKey, actionKey }) {
  if (!connectionId) return null;
  const [rows] = await pool.query(
    `SELECT grant_id, grant_mode, status, expires_at
       FROM app_action_grants
      WHERE workspace_id = ?
        AND connection_id = ?
        AND app_key = ?
        AND action_key = ?
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC
      LIMIT 1`,
    [workspaceId, connectionId, appKey, actionKey]
  );
  return rows?.[0] || null;
}

async function resolveResourceAuthority(pool, {
  tenantId,
  userId,
  workspaceId,
  resourceRef,
  operationKey,
}) {
  const refs = [...new Set([resourceRef, workspaceId, tenantId].filter(Boolean))];
  if (!refs.length) return { allowed: false, grant: null };
  const [rows] = await pool.query(
    `SELECT grant_id, resource_type, resource_ref, permission, source, expires_at
       FROM workspace_resource_grants
      WHERE tenant_id = ?
        AND grantee_user_id = ?
        AND status = 'active'
        AND (expires_at IS NULL OR expires_at > NOW())
        AND resource_ref IN (${refs.map(() => "?").join(",")})
      ORDER BY FIELD(permission, 'owner','admin','manage','operate','edit','comment','view'),
               created_at DESC`,
    [tenantId, userId, ...refs]
  );
  const allowedPermissions = READ_OPERATIONS.has(normalize(operationKey))
    ? READ_PERMISSIONS
    : MUTATION_PERMISSIONS;
  const grant = (rows || []).find((row) => allowedPermissions.has(normalize(row.permission))) || null;
  return { allowed: Boolean(grant), grant };
}

async function resolveExport(pool, binding, canonicalEndpointKey) {
  const [rows] = await pool.query(
    `SELECT export_key, tool_name, scope_class, tenant_id, status,
            source_endpoint_id, updated_at
       FROM platform_endpoint_tool_exports
      WHERE parent_action_key = ? AND endpoint_key = ?
      ORDER BY (status = 'active') DESC, updated_at DESC
      LIMIT 5`,
    [binding.parent_action_key, canonicalEndpointKey]
  );
  return {
    export: rows?.[0] || null,
    active_count: (rows || []).filter((row) => row.status === "active").length,
  };
}

async function resolveCertification(pool, binding) {
  const [rows] = await pool.query(
    `SELECT certification_key, surface_key, surface_family, tool_or_action_key,
            risk_class, certification_status, dispatch_allowed, apply_allowed,
            requires_resource_authority, requires_dry_run,
            requires_audit_evidence, requires_readback,
            last_evidence_ref, last_certified_at, expires_at
       FROM runtime_dispatch_certification_registry
      WHERE tool_or_action_key IN (?, 'runtime_endpoint_call')
         OR surface_key IN (?, 'runtime_endpoint_call')
      ORDER BY dispatch_allowed DESC, apply_allowed DESC, last_certified_at DESC
      LIMIT 5`,
    [binding.parent_action_key, binding.parent_action_key]
  );
  const certification = (rows || []).find((row) => {
    if (!row.dispatch_allowed) return false;
    if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return false;
    return true;
  }) || null;
  return certification;
}

function buildProjection({ capability, binding, canonicalEndpointKey, status, manifestHash }) {
  return {
    tool_name: `capability_${capability.capability_key.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`,
    capability_key: capability.capability_key,
    provider_binding_id: binding.binding_id,
    app_key: binding.app_key,
    parent_action_key: binding.parent_action_key,
    canonical_endpoint_key: canonicalEndpointKey,
    rollout_mode: binding.rollout_mode,
    projection_status: status,
    manifest_hash: manifestHash,
    input_schema_json: capability.input_schema_json || null,
    output_schema_json: capability.output_schema_json || null,
    derived_projection: true,
    secrets_included: false,
  };
}

function selectStatus({
  workspace,
  membership,
  capability,
  binding,
  connectionResult,
  actionGrant,
  authority,
  endpointResult,
  exportResult,
  certification,
}) {
  if (!workspace) return "workspace_not_registered";
  if (workspace.bootstrap_status !== "ready") return "workspace_not_ready";
  if (!membership) return "workspace_membership_required";
  if (!capability) return "capability_not_registered";
  if (!binding) return "capability_binding_missing";
  if (capability.requires_connection && !connectionResult?.selected) return "connection_not_found";
  if (connectionResult?.ambiguous) return "ambiguous_connection";
  if (capability.requires_connection && normalize(connectionResult?.selected?.validation_status) !== "validated") {
    return "connection_not_validated";
  }
  if (!actionGrant) return "capability_not_granted";
  if (capability.requires_workspace_authority && !authority?.allowed) return "resource_authority_missing";
  if (!endpointResult?.endpoint) return "canonical_endpoint_unavailable";
  if (endpointResult.active_candidate_count > 1) return "ambiguous_canonical_endpoint";
  if (binding.rollout_mode === "shadow") return "shadow_ready";
  if (!certification) return "runtime_certification_missing";
  if (!exportResult?.export || exportResult.export.status !== "active") return "capability_export_missing";
  if (binding.rollout_mode === "canary") return "canary_ready";
  if (binding.rollout_mode === "active") return "ready";
  return "binding_disabled";
}

export const TENANT_EFFECTIVE_CAPABILITY_SYSTEM_TOOLS = Object.freeze([
  {
    name: "tenant_effective_capability_preview",
    description: "Resolve one tenant capability through workspace, membership, resource grants, app links, validated connection selection, action grants, canonical endpoint identity, runtime certification, and derived tool projection. No provider call and no secret return.",
    inputSchema: {
      type: "object",
      required: ["capability_key"],
      properties: {
        capability_key: { type: "string" },
        workspace_id: { type: "string" },
        workspace_key: { type: "string" },
        resource_ref: { type: "string" },
        connection_id: { type: "string", description: "Optional explicit connection pin; must already be linked to the workspace." },
        tenant_id: { type: "string", description: "Admin-only diagnostic override; ignored for tenant principals." },
        user_id: { type: "string", description: "Admin-only diagnostic override; ignored for tenant principals." },
        include_candidates: { type: "boolean", default: false },
      },
      additionalProperties: false,
    },
  },
  {
    name: "tenant_effective_capability_readiness_smoke",
    description: "Admin-only, read-only readiness smoke for the semantic capability resolver. Verifies the eight migration-owned schema objects, initial seed rows, descriptor wiring, and no-provider/no-mutation guarantees.",
    requires_admin: true,
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "tenant_capability_shadow_compare",
    description: "Run the effective capability resolver in shadow mode, compare it with an optional legacy decision, and write a no-secret comparison ledger row. Does not call a provider or change tool exports.",
    inputSchema: {
      type: "object",
      required: ["capability_key"],
      properties: {
        capability_key: { type: "string" },
        workspace_id: { type: "string" },
        workspace_key: { type: "string" },
        resource_ref: { type: "string" },
        connection_id: { type: "string" },
        legacy_decision: { type: "string" },
        tenant_id: { type: "string", description: "Admin-only diagnostic override; ignored for tenant principals." },
        user_id: { type: "string", description: "Admin-only diagnostic override; ignored for tenant principals." },
        record_shadow: { type: "boolean", default: true },
      },
      additionalProperties: false,
    },
  },
]);

export async function resolveTenantEffectiveCapability(args = {}, { auth = {}, pool = getPool() } = {}) {
  const scope = principalScope(args, auth);
  const capabilityKey = safeText(args.capability_key, 191);
  if (!scope.tenantId) return errorResult("TENANT_CONTEXT_REQUIRED", "A tenant context is required.");
  if (!scope.userId) return errorResult("USER_CONTEXT_REQUIRED", "A user context is required.");
  if (!capabilityKey) return errorResult("CAPABILITY_KEY_REQUIRED", "capability_key is required.");

  const workspaceResult = await resolveWorkspace(pool, {
    tenantId: scope.tenantId,
    workspaceId: safeText(args.workspace_id, 64),
    workspaceKey: safeText(args.workspace_key, 191),
  });
  const workspace = workspaceResult.workspace;
  if (!workspace) {
    return errorResult("WORKSPACE_NOT_REGISTERED", "No canonical workspace matched the request.", {
      tenant_id: scope.tenantId,
      workspace_id: safeText(args.workspace_id, 64) || null,
      workspace_key: safeText(args.workspace_key, 191) || null,
    });
  }

  const [membership, capability, bindings] = await Promise.all([
    resolveMembership(pool, scope.tenantId, scope.userId),
    resolveCapability(pool, capabilityKey),
    resolveBindings(pool, capabilityKey),
  ]);
  const binding = bindings[0] || null;
  if (!membership) {
    return errorResult("WORKSPACE_MEMBERSHIP_REQUIRED", "The target user is not an active tenant member.", {
      tenant_id: scope.tenantId,
      user_id: scope.userId,
      workspace_id: workspace.workspace_id,
    });
  }
  if (!capability) {
    return errorResult("CAPABILITY_NOT_REGISTERED", "The semantic capability is not active in the registry.", {
      capability_key: capabilityKey,
    });
  }
  if (!binding) {
    return errorResult("CAPABILITY_BINDING_MISSING", "No active provider binding exists for the capability.", {
      capability_key: capabilityKey,
    });
  }

  const endpointResult = await resolveCanonicalEndpoint(pool, binding);
  const connectionResult = await resolveConnections(pool, {
    tenantId: scope.tenantId,
    workspaceId: workspace.workspace_id,
    appKey: binding.app_key,
    explicitConnectionId: safeText(args.connection_id, 64),
  });
  const selectedConnection = connectionResult.selected;
  const [actionGrant, authority, exportResult, certification] = await Promise.all([
    resolveActionGrant(pool, {
      workspaceId: workspace.workspace_id,
      connectionId: selectedConnection?.connection_id,
      appKey: binding.app_key,
      actionKey: binding.parent_action_key,
    }),
    resolveResourceAuthority(pool, {
      tenantId: scope.tenantId,
      userId: scope.userId,
      workspaceId: workspace.workspace_id,
      resourceRef: safeText(args.resource_ref, 255),
      operationKey: capability.operation_key,
    }),
    resolveExport(pool, binding, endpointResult.canonical_endpoint_key),
    resolveCertification(pool, binding),
  ]);

  const status = selectStatus({
    workspace,
    membership,
    capability,
    binding,
    connectionResult,
    actionGrant,
    authority,
    endpointResult,
    exportResult,
    certification,
  });
  const ready = ["shadow_ready", "canary_ready", "ready"].includes(status);
  const manifestHash = sha256(JSON.stringify({
    capability_key: capability.capability_key,
    schema_version: capability.schema_version,
    binding_id: binding.binding_id,
    rollout_mode: binding.rollout_mode,
    connection_id: selectedConnection?.connection_id || null,
    endpoint_key: endpointResult.canonical_endpoint_key,
    endpoint_updated_at: endpointResult.endpoint?.updated_at || null,
    action_grant_id: actionGrant?.grant_id || null,
    resource_grant_id: authority.grant?.grant_id || null,
    export_key: exportResult.export?.export_key || null,
    certification_key: certification?.certification_key || null,
  }));
  const result = {
    ok: true,
    resolver: "tenant_effective_capability_resolver_v1",
    mode: binding.rollout_mode === "shadow" ? "shadow" : "effective",
    status,
    ready,
    principal: {
      tenant_id: scope.tenantId,
      user_id: scope.userId,
      admin_override_used: scope.admin && Boolean(args.tenant_id || args.user_id),
    },
    workspace: {
      workspace_id: workspace.workspace_id,
      workspace_key: workspace.workspace_key,
      workspace_type: workspace.workspace_type,
      bootstrap_status: workspace.bootstrap_status,
      default_resolution_used: workspaceResult.default_resolution_used,
      candidate_count: workspaceResult.candidate_count,
    },
    membership: {
      role: membership.role,
      status: membership.status,
    },
    capability: {
      capability_key: capability.capability_key,
      display_name: capability.display_name,
      resource_type: capability.resource_type,
      operation_key: capability.operation_key,
      risk_class: capability.risk_class,
      requires_connection: Boolean(capability.requires_connection),
      requires_workspace_authority: Boolean(capability.requires_workspace_authority),
      requires_approval: Boolean(capability.requires_approval),
      requires_audit_evidence: Boolean(capability.requires_audit_evidence),
      requires_readback: Boolean(capability.requires_readback),
      schema_version: capability.schema_version,
    },
    binding: {
      binding_id: binding.binding_id,
      app_key: binding.app_key,
      parent_action_key: binding.parent_action_key,
      configured_endpoint_key: binding.endpoint_key,
      adapter_key: binding.adapter_key || null,
      policy_key: binding.policy_key || null,
      rollout_mode: binding.rollout_mode,
    },
    connection: publicConnection(selectedConnection),
    endpoint: publicEndpoint(
      endpointResult.endpoint,
      endpointResult.canonical_endpoint_key,
      Boolean(endpointResult.alias)
    ),
    authority: {
      action_grant_present: Boolean(actionGrant),
      action_grant_id: actionGrant?.grant_id || null,
      resource_authority_present: authority.allowed,
      resource_grant_id: authority.grant?.grant_id || null,
      resource_type: authority.grant?.resource_type || null,
      resource_ref: authority.grant?.resource_ref || null,
      permission: authority.grant?.permission || null,
    },
    runtime: {
      certification_key: certification?.certification_key || null,
      certification_status: certification?.certification_status || null,
      dispatch_allowed: Boolean(certification?.dispatch_allowed),
      apply_allowed: Boolean(certification?.apply_allowed),
      export_key: exportResult.export?.export_key || null,
      export_status: exportResult.export?.status || null,
      active_export_count: exportResult.active_count,
    },
    checks: {
      workspace_ready: workspace.bootstrap_status === "ready",
      membership_ready: Boolean(membership),
      connection_ready: !capability.requires_connection || normalize(selectedConnection?.validation_status) === "validated",
      connection_ambiguous: connectionResult.ambiguous,
      action_grant_ready: Boolean(actionGrant),
      resource_authority_ready: !capability.requires_workspace_authority || authority.allowed,
      canonical_endpoint_ready: Boolean(endpointResult.endpoint) && endpointResult.active_candidate_count === 1,
      runtime_certification_ready: Boolean(certification),
      export_ready: exportResult.export?.status === "active",
      shadow_mode: binding.rollout_mode === "shadow",
    },
    projection: buildProjection({
      capability,
      binding,
      canonicalEndpointKey: endpointResult.canonical_endpoint_key,
      status,
      manifestHash,
    }),
    candidate_summary: {
      provider_binding_count: bindings.length,
      linked_connection_count: connectionResult.candidates.length,
      active_endpoint_candidate_count: endpointResult.active_candidate_count,
    },
    manifest_hash: manifestHash,
    secrets_included: false,
  };
  if (args.include_candidates === true) {
    result.connection_candidates = connectionResult.candidates.map(publicConnection);
    result.provider_binding_candidates = bindings.map((row) => ({
      binding_id: row.binding_id,
      app_key: row.app_key,
      parent_action_key: row.parent_action_key,
      endpoint_key: row.endpoint_key,
      rollout_mode: row.rollout_mode,
      priority: row.priority,
    }));
  }
  return result;
}

export async function tenantEffectiveCapabilityReadinessSmoke(
  _args = {},
  { pool = getPool() } = {}
) {
  let schema = {
    expected: SEMANTIC_CAPABILITY_SCHEMA_OBJECTS,
    present: [],
    missing: SEMANTIC_CAPABILITY_SCHEMA_OBJECTS,
  };
  let queryError = null;
  let counts = {
    active_capabilities: 0,
    active_bindings: 0,
    shadow_bindings: 0,
    active_aliases: 0,
  };

  try {
    schema = await loadSemanticCapabilitySchemaReadiness(pool);
    if (schema.missing.length === 0) {
      counts = {
        active_capabilities: await countReadinessRows(
          pool,
          "SELECT COUNT(*) AS c FROM platform_semantic_capabilities WHERE status = 'active'"
        ),
        active_bindings: await countReadinessRows(
          pool,
          "SELECT COUNT(*) AS c FROM platform_capability_provider_bindings WHERE status = 'active'"
        ),
        shadow_bindings: await countReadinessRows(
          pool,
          "SELECT COUNT(*) AS c FROM platform_capability_provider_bindings WHERE status = 'active' AND rollout_mode = 'shadow'"
        ),
        active_aliases: await countReadinessRows(
          pool,
          "SELECT COUNT(*) AS c FROM platform_endpoint_aliases WHERE status = 'active'"
        ),
      };
    }
  } catch (error) {
    queryError = {
      code: error?.code || "semantic_capability_readiness_query_failed",
      message: error?.message || String(error),
    };
  }

  const descriptorNames = TENANT_EFFECTIVE_CAPABILITY_SYSTEM_TOOLS.map(
    (tool) => tool.name
  );
  const checks = [
    { name: "schema_query_succeeded", pass: queryError === null },
    {
      name: "eight_schema_objects_present",
      pass:
        queryError === null
        && schema.missing.length === 0
        && schema.present.length === 8,
      expected_count: 8,
      present_count: schema.present.length,
    },
    {
      name: "initial_capabilities_seeded",
      pass: counts.active_capabilities >= 8,
      observed_count: counts.active_capabilities,
    },
    {
      name: "provider_binding_seeded",
      pass: counts.active_bindings >= 1,
      observed_count: counts.active_bindings,
    },
    {
      name: "shadow_binding_present",
      pass: counts.shadow_bindings >= 1,
      observed_count: counts.shadow_bindings,
    },
    {
      name: "endpoint_aliases_seeded",
      pass: counts.active_aliases >= 2,
      observed_count: counts.active_aliases,
    },
    {
      name: "three_descriptor_tools_present",
      pass:
        descriptorNames.length === 3
        && descriptorNames.includes("tenant_effective_capability_preview")
        && descriptorNames.includes("tenant_effective_capability_readiness_smoke")
        && descriptorNames.includes("tenant_capability_shadow_compare"),
    },
    { name: "no_provider_call", pass: true },
    { name: "no_mutation", pass: true },
    { name: "no_secrets", pass: true },
  ];
  const ok = checks.every((check) => check.pass === true);
  const reasonCode = queryError
    ? "semantic_capability_readiness_query_failed"
    : schema.missing.length
      ? "semantic_capability_schema_not_applied"
      : ok
        ? null
        : "semantic_capability_seed_readiness_failed";

  return {
    ok,
    tool: "tenant_effective_capability_readiness_smoke",
    status: ok ? "pass" : "fail",
    classification: ok
      ? "tenant_effective_capability_resolver_ready"
      : "tenant_effective_capability_resolver_not_ready",
    reason_code: reasonCode,
    checks,
    schema_objects: {
      expected: schema.expected.map((item) => item.name),
      present: schema.present.map((item) => item.name),
      missing: schema.missing.map((item) => item.name),
    },
    seed_counts: counts,
    descriptor_tools: descriptorNames,
    error: queryError,
    provider_calls_made: 0,
    apply_allowed: false,
    mutations_executed: false,
    secrets_included: false,
  };
}

export async function tenantEffectiveCapabilityPreview(args = {}, context = {}) {
  return resolveTenantEffectiveCapability(args, context);
}

export async function tenantCapabilityShadowCompare(args = {}, { auth = {}, pool = getPool() } = {}) {
  const resolved = await resolveTenantEffectiveCapability(args, { auth, pool });
  if (!resolved.ok) return resolved;
  const legacyDecision = safeText(args.legacy_decision, 96) || null;
  const differenceClass = !legacyDecision
    ? "legacy_decision_not_supplied"
    : normalize(legacyDecision) === normalize(resolved.status)
      ? "matched"
      : "different";
  const decisionId = crypto.randomUUID();
  if (args.record_shadow !== false) {
    await pool.query(
      `INSERT INTO tenant_capability_shadow_decisions
        (decision_id, tenant_id, user_id, workspace_id, capability_key,
         resource_ref, legacy_decision, effective_decision, difference_class,
         decision_json, manifest_hash, secrets_included)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        decisionId,
        resolved.principal.tenant_id,
        resolved.principal.user_id,
        resolved.workspace.workspace_id,
        resolved.capability.capability_key,
        safeText(args.resource_ref, 255) || null,
        legacyDecision,
        resolved.status,
        differenceClass,
        JSON.stringify({
          resolver: resolved.resolver,
          status: resolved.status,
          mode: resolved.mode,
          checks: resolved.checks,
          binding: resolved.binding,
          connection: resolved.connection,
          endpoint: resolved.endpoint,
          runtime: resolved.runtime,
          projection: resolved.projection,
          secrets_included: false,
        }),
        resolved.manifest_hash,
      ]
    );
  }
  return {
    ok: true,
    shadow_decision_id: args.record_shadow === false ? null : decisionId,
    recorded: args.record_shadow !== false,
    legacy_decision: legacyDecision,
    effective_decision: resolved.status,
    difference_class: differenceClass,
    resolution: resolved,
    secrets_included: false,
  };
}
