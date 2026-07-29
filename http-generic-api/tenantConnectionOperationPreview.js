import crypto from "node:crypto";

import { getPool } from "./db.js";
import { buildDynamicCapabilityCertificationReadbackPreview } from "./dynamicCapabilityCertificationReadback.js";
import {
  findTenantConnectionSelfRepairRoute,
  redactTenantConnection,
} from "./tenantConnectionSelfRepairService.js";

const DEFAULT_CAPABILITY_KEY = "tenant_tool.tenant_connection_effective_credential_plan_view";
const SAFE_CONNECTION_COLUMNS = Object.freeze([
  "connection_id",
  "tenant_id",
  "user_id",
  "app_key",
  "auth_type",
  "status",
  "validation_status",
  "last_validated_at",
  "last_used_at",
  "is_primary",
]);

function compactString(value = "", max = 191) {
  return String(value ?? "").trim().slice(0, max);
}

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function previewError(code, message, status = 400, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = { ...details, secrets_included: false };
  return error;
}

function normalizeRequest(input = {}) {
  const tenantId = compactString(input.tenant_id, 64);
  const userId = compactString(input.user_id, 64) || null;
  const connectionId = compactString(input.connection_id, 191);
  const toolKey = compactString(input.tool_key, 191);
  const adapterKey = compactString(input.adapter_key || input.app_key, 128) || null;
  const capabilityKey = compactString(input.capability_key || DEFAULT_CAPABILITY_KEY, 191);
  const environment = compactString(input.environment || "production", 64);

  if (!tenantId) {
    throw previewError(
      "tenant_connection_operation_preview_tenant_required",
      "tenant_id is required.",
      400,
      { field: "tenant_id" }
    );
  }
  if (!connectionId) {
    throw previewError(
      "tenant_connection_operation_preview_connection_required",
      "connection_id is required.",
      400,
      { field: "connection_id" }
    );
  }
  if (!toolKey) {
    throw previewError(
      "tenant_connection_operation_preview_tool_required",
      "tool_key is required.",
      400,
      { field: "tool_key" }
    );
  }

  return {
    tenant_id: tenantId,
    user_id: userId,
    connection_id: connectionId,
    tool_key: toolKey,
    adapter_key: adapterKey,
    capability_key: capabilityKey,
    environment,
  };
}

async function loadConnectionMetadata(pool, request) {
  const parameters = [request.connection_id, request.tenant_id];
  let userClause = "";
  if (request.user_id) {
    userClause = " AND user_id = ?";
    parameters.push(request.user_id);
  }
  const [rows] = await pool.query(
    `SELECT connection_id, tenant_id, user_id, app_key, auth_type, status,
            validation_status, last_validated_at, last_used_at, is_primary
       FROM user_app_connections
      WHERE connection_id = ?
        AND tenant_id = ?${userClause}
      LIMIT 1`,
    parameters
  );
  return rows?.[0] || null;
}

async function loadTenantToolContract(pool, toolKey) {
  const [rows] = await pool.query(
    `SELECT tool_key, http_method, http_path, is_enabled, input_schema, tags
       FROM tenant_platform_endpoint_tools
      WHERE tool_key = ?
      LIMIT 1`,
    [toolKey]
  );
  return rows?.[0] || null;
}

function classifyOperationBlockers(route, connection, contract, request) {
  const blockers = [];
  if (!contract) blockers.push("TENANT_TOOL_CONTRACT_MISSING");
  if (!connection) blockers.push("TENANT_CONNECTION_NOT_FOUND");
  if (contract && String(contract.http_method || "").toUpperCase() !== route.method) {
    blockers.push("TENANT_TOOL_METHOD_MISMATCH");
  }
  if (contract && String(contract.http_path || "") !== route.path) {
    blockers.push("TENANT_TOOL_PATH_MISMATCH");
  }
  const resolvedAdapter = request.adapter_key || connection?.app_key || null;
  if (route.requires_adapter_overlay && !resolvedAdapter) {
    blockers.push("ADAPTER_OVERLAY_REQUIRED");
  }
  if (request.adapter_key && connection?.app_key && request.adapter_key !== connection.app_key) {
    blockers.push("CONNECTION_ADAPTER_MISMATCH");
  }
  if (route.provider_write_allowed === true) {
    blockers.push("PROVIDER_WRITE_PREVIEW_ONLY");
  } else if (route.operation_class === "internal_write") {
    blockers.push("INTERNAL_WRITE_PREVIEW_ONLY");
  }
  return blockers;
}

export async function buildTenantConnectionOperationPreview(input = {}, deps = {}) {
  const request = normalizeRequest(input);
  const route = findTenantConnectionSelfRepairRoute(request.tool_key);
  if (!route) {
    throw previewError(
      "tenant_connection_operation_preview_unknown_tool",
      "The requested Tenant connection operation is not registered in the self-repair contract.",
      404,
      { tool_key: request.tool_key }
    );
  }

  const pool = deps.pool || getPool();
  const [connectionRow, toolContract] = await Promise.all([
    (deps.loadConnectionMetadata || loadConnectionMetadata)(pool, request),
    (deps.loadTenantToolContract || loadTenantToolContract)(pool, request.tool_key),
  ]);
  const connection = connectionRow ? redactTenantConnection(connectionRow) : null;
  const blockers = classifyOperationBlockers(route, connectionRow, toolContract, request);
  const resolvedAdapterKey = request.adapter_key || connectionRow?.app_key || null;

  let assurance = null;
  if (connectionRow && toolContract) {
    try {
      assurance = await (deps.certificationPreview || buildDynamicCapabilityCertificationReadbackPreview)(
        {
          capability_key: request.capability_key,
          operation_mode: "preview",
          adapter_key: resolvedAdapterKey || undefined,
          resource_type: "tenant_connection",
          provider_key: connectionRow.app_key || undefined,
          runtime_surface: request.tool_key,
          contract_key: `${request.tool_key}_readback_v1`,
          environment: request.environment,
          evidence_limit: 25,
        },
        { pool }
      );
      for (const blocker of assurance?.blockers || []) {
        blockers.push(String(blocker?.code || blocker || "ASSURANCE_BLOCKER"));
      }
    } catch (error) {
      blockers.push(String(error?.code || "CERTIFICATION_READBACK_PREVIEW_FAILED"));
      assurance = {
        ok: false,
        error: {
          code: String(error?.code || "tenant_connection_operation_assurance_failed"),
          message: String(error?.message || "Certification and readback preview failed."),
        },
        secrets_included: false,
      };
    }
  }

  const uniqueBlockers = [...new Set(blockers)].sort();
  return {
    ok: true,
    mode: "admin_shadow_preview",
    status: uniqueBlockers.length ? "blocked" : "ready_for_read_only_preview",
    request_hash: stableHash(request),
    capability_key: request.capability_key,
    operation: {
      ...route,
      execution_allowed: false,
      provider_call_allowed: false,
      provider_write_allowed: false,
    },
    tenant_tool_contract: toolContract ? {
      tool_key: toolContract.tool_key,
      method: String(toolContract.http_method || "").toUpperCase(),
      path: toolContract.http_path || null,
      enabled: Number(toolContract.is_enabled || 0) === 1,
    } : null,
    connection,
    resolved_adapter_key: resolvedAdapterKey,
    assurance,
    blockers: uniqueBlockers,
    safe_connection_columns: SAFE_CONNECTION_COLUMNS,
    execution_performed: false,
    provider_call_performed: false,
    provider_write_performed: false,
    credential_payload_read: false,
    external_write_performed: false,
    tenant_authority_changed: false,
    secrets_included: false,
  };
}

export const TENANT_CONNECTION_OPERATION_PREVIEW_CONTRACT = Object.freeze({
  tool_key: "tenant_connection_operation_preview",
  capability_key: DEFAULT_CAPABILITY_KEY,
  runtime_surface: "admin_virtual_tool",
  supported_operation_count: 9,
  safe_connection_columns: SAFE_CONNECTION_COLUMNS,
  provider_call_allowed: false,
  provider_write_allowed: false,
  credential_payload_read_allowed: false,
  tenant_authority_change_allowed: false,
  secrets_included: false,
});
