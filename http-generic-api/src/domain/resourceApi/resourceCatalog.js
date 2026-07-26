import { readFileSync } from "node:fs";

export const MAX_PAGE_SIZE = 200;
export const OWNER_ROLES = new Set(["owner", "admin"]);
export const RESOURCE_MANIFEST = JSON.parse(
  readFileSync(new URL("../../../resource-api-coverage.manifest.json", import.meta.url), "utf8")
);

export const RESOURCE_DESCRIPTORS = Object.freeze({
  sessions: {
    table: "customer_sessions",
    id: "session_id",
    tenant: "tenant_id",
    user: "user_id",
    time: "COALESCE(r.archive_last_written_at,r.ended_at,r.started_at,r.created_at)",
    fields: `r.session_id,r.tenant_id,r.user_id,r.originator,r.brand_key,r.workspace_key,
      r.session_status,r.archive_status,r.turn_count,r.drive_doc_part_count,
      r.archive_last_written_at,r.started_at,r.ended_at,r.created_at`,
    search: ["r.session_id", "r.originator", "r.brand_key", "r.workspace_key", "r.session_status", "r.archive_status"],
    filters: {
      status: "r.session_status",
      archive_status: "r.archive_status",
      brand_key: "r.brand_key",
      user_id: "r.user_id",
    },
    order: "COALESCE(r.archive_last_written_at,r.ended_at,r.started_at,r.created_at) DESC,r.id DESC",
    memberOwnOnly: true,
  },
  executions: {
    table: "execution_log",
    id: "id",
    tenant: "tenant_id",
    user: "user_id",
    time: "r.created_at",
    fields: `r.id,r.run_date,r.start_time,r.end_time,r.duration_seconds,r.entry_type,r.execution_class,
      r.source_layer,r.execution_mode,r.execution_status,LEFT(r.failure_reason,1000) AS failure_reason,
      r.recovery_status,r.tenant_id,r.workspace_id,r.workspace_key,r.user_id,r.brand_key,r.request_id,
      r.session_id,r.parent_action_key,r.endpoint_key,r.tool_key,r.app_key,r.agent_id,r.workflow_key,
      r.engine_key,r.resource_type,r.resource_id,r.correlation_id,r.created_at`,
    search: [
      "CAST(r.id AS CHAR)", "r.execution_status", "r.parent_action_key", "r.endpoint_key",
      "r.tool_key", "r.workflow_key", "r.app_key", "r.correlation_id", "r.failure_reason",
    ],
    filters: {
      status: "r.execution_status",
      app_key: "r.app_key",
      workflow_key: "r.workflow_key",
      parent_action_key: "r.parent_action_key",
      session_id: "r.session_id",
    },
    order: "r.created_at DESC,r.id DESC",
  },
  assets: {
    table: "workspace_assets",
    id: "asset_id",
    tenant: "tenant_id",
    user: "created_by",
    time: "r.updated_at",
    fields: `r.asset_id,r.tenant_id,r.vault_id,r.asset_type,r.asset_ref,r.display_name,r.brand_ref,
      r.site_ref,r.workflow_ref,r.session_ref,r.visibility,r.lifecycle_status,r.created_by,r.created_at,r.updated_at`,
    search: ["r.asset_id", "r.asset_ref", "r.display_name", "r.brand_ref", "r.site_ref", "r.workflow_ref", "r.session_ref"],
    filters: {
      status: "r.lifecycle_status",
      asset_type: "r.asset_type",
      brand_ref: "r.brand_ref",
      visibility: "r.visibility",
    },
    order: "r.updated_at DESC,r.asset_id DESC",
    mutable: true,
  },
  approvals: {
    table: "approval_holds",
    id: "hold_id",
    tenant: "tenant_id",
    user: "user_id",
    time: "COALESCE(r.decided_at,r.created_at)",
    fields: `r.hold_id,r.run_id,r.step_run_id,r.tenant_id,r.workspace_id,r.workspace_key,r.hold_type,
      r.requested_by,r.user_id,r.actor_id,r.actor_type,r.brand_key,r.request_id,r.session_id,r.correlation_id,
      r.assigned_to,r.required_role,r.status,r.decision_by,r.decision_note,r.expires_at,r.decided_at,r.created_at`,
    search: [
      "r.hold_id", "r.run_id", "r.hold_type", "r.requested_by", "r.assigned_to",
      "r.required_role", "r.status", "r.session_id", "r.correlation_id",
    ],
    filters: {
      status: "r.status",
      hold_type: "r.hold_type",
      assigned_to: "r.assigned_to",
      session_id: "r.session_id",
    },
    order: "COALESCE(r.decided_at,r.created_at) DESC,r.id DESC",
  },
});

export class ResourceApiError extends Error {
  constructor(code, message, status = 500, details = undefined) {
    super(message);
    this.name = "ResourceApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function resourceError(code, message, status = 500, details = undefined) {
  return new ResourceApiError(code, message, status, details);
}

export function descriptor(resourceKey) {
  return RESOURCE_DESCRIPTORS[String(resourceKey || "").trim()] || null;
}

export function parsePageSize(value, fallback = 50) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Math.min(Number.isFinite(parsed) && parsed > 0 ? parsed : fallback, MAX_PAGE_SIZE);
}

export function resourceTimestamp(item) {
  return item?.updated_at || item?.created_at || item?.archive_last_written_at || item?.decided_at || item?.started_at || null;
}

export function encodePageToken(row, resourceDescriptor) {
  return Buffer.from(JSON.stringify({
    id: String(row[resourceDescriptor.id]),
    time: resourceTimestamp(row),
  })).toString("base64url");
}

export function decodePageToken(value) {
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
  } catch {
    throw resourceError("invalid_page_token", "Invalid pageToken.", 400);
  }
}

export function isOwnerRole(role) {
  return OWNER_ROLES.has(String(role || "").toLowerCase());
}

export function resourceCapabilities(resourceKey, { admin = false, member = null, item = null, auth = null } = {}) {
  if (admin) {
    return {
      canRead: true,
      canSearch: true,
      canCreate: resourceKey === "assets",
      canUpdate: resourceKey === "assets",
      canArchive: resourceKey === "assets",
      canRestore: resourceKey === "assets",
      canManagePermissions: true,
      canPurge: false,
    };
  }
  const owner = isOwnerRole(member?.role);
  const assetOwner = resourceKey === "assets" && item?.created_by === auth?.user_id;
  return {
    canRead: true,
    canSearch: true,
    canCreate: resourceKey === "assets",
    canUpdate: resourceKey === "assets" && (owner || assetOwner),
    canArchive: resourceKey === "assets" && (owner || assetOwner),
    canRestore: resourceKey === "assets" && owner,
    canManagePermissions: owner,
    canPurge: false,
  };
}

export function wrapResource(resourceKey, item, capabilities) {
  const resourceDescriptor = descriptor(resourceKey);
  if (!resourceDescriptor) throw resourceError("resource_type_not_found", "Resource type not found.", 404);
  return {
    id: String(item[resourceDescriptor.id]),
    resourceKey,
    data: item,
    capabilities,
    version: resourceTimestamp(item),
  };
}

export function isAdminPrincipal(auth) {
  return Boolean(auth?.is_admin || auth?.mode === "backend_api_key");
}
