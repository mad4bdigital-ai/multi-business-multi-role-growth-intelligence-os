import { buildTenantGptEffectiveCapabilitySurface } from "./tenantGptEffectiveCapabilitySurface.js";

const READ_ONLY_TOOLS = new Set([
  "list_accessible_workspaces",
  "list_accessible_brands",
]);

const SECRET_KEY = /(?:^|_)(?:authorization|cookie|password|passwd|secret|client_secret|api_key|access_key|private_key|token|access_token|refresh_token|id_token|credential|credentials|raw_row|raw_rows)(?:_|$)/i;

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value, maximum = 256) {
  return String(value || "").trim().slice(0, maximum);
}

function sanitize(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (["boolean", "number"].includes(typeof value)) return value;
  if (typeof value === "string") return value.slice(0, 4096);
  if (typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => sanitize(entry, seen)).filter((entry) => entry !== undefined);
  }
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) continue;
    const projected = sanitize(entry, seen);
    if (projected !== undefined) output[key] = projected;
  }
  return output;
}

function pick(source, keys) {
  const output = {};
  if (!plainObject(source)) return output;
  for (const key of keys) {
    if (source[key] !== undefined) output[key] = sanitize(source[key]);
  }
  return output;
}

function projectToolResult(toolName, result) {
  if (!plainObject(result)) return null;
  if (toolName === "list_accessible_workspaces") {
    const workspaces = Array.isArray(result.workspaces)
      ? result.workspaces.map((workspace) => pick(workspace, [
          "workspace_id",
          "display_name",
          "role",
          "membership_status",
          "workspace_status",
        ]))
      : [];
    return {
      workspaces,
      count: workspaces.length,
    };
  }
  if (toolName === "list_accessible_brands") {
    const brands = Array.isArray(result.brands)
      ? result.brands.map((brand) => pick(brand, [
          "brand_ref",
          "permission",
          "permission_source",
          "display_name",
          "target_key",
          "brand_domain",
          "base_url",
          "status",
          "brand_core_ready",
        ]))
      : [];
    return {
      workspace_id: text(result.workspace_id, 128),
      membership_role: result.membership_role == null ? null : text(result.membership_role, 64),
      brands,
      count: brands.length,
    };
  }
  return null;
}

function failure(code, message, blockers = []) {
  return {
    ok: false,
    code,
    message,
    blockers: sanitize(blockers) || [],
    retryable: false,
    secrets_included: false,
  };
}

export function buildRemoteMcpGovernedSurfaceRequest({ toolName, toolArguments, authentication } = {}) {
  return {
    surface: "remote_mcp",
    operation: "tools/call",
    tool_name: text(toolName, 128),
    tool_arguments: sanitize(toolArguments || {}),
    authenticated_subject: pick(authentication, ["subject", "user_id", "client_id", "issuer", "audience"]),
    requested_effect: "read_only",
    authority_requested_from_surface: false,
    provider_execution_requested_from_surface: false,
  };
}

export async function consumeRemoteMcpGovernedSurface({
  toolName,
  toolArguments = {},
  authentication = {},
  resolveGovernedSurface,
} = {}) {
  const normalizedTool = text(toolName, 128);
  if (!READ_ONLY_TOOLS.has(normalizedTool)) {
    return failure("MCP_WRITE_SURFACE_NOT_ENABLED", "This Remote MCP surface exposes governed read-only tools only.");
  }
  if (typeof resolveGovernedSurface !== "function") {
    return failure(
      "MCP_GOVERNED_SURFACE_CONTRACT_REQUIRED",
      "The authoritative runtime surface contract is not available.",
    );
  }

  const request = buildRemoteMcpGovernedSurfaceRequest({
    toolName: normalizedTool,
    toolArguments,
    authentication,
  });
  const resolved = await resolveGovernedSurface(request);
  if (!plainObject(resolved)) {
    return failure("MCP_GOVERNED_SURFACE_INVALID", "The authoritative runtime surface contract is invalid.");
  }

  const envelope = buildTenantGptEffectiveCapabilitySurface({
    context: resolved.context,
    capability_manifest: resolved.capability_manifest,
    authority_preflight: resolved.authority_preflight,
    plan: resolved.plan,
    approval_or_delegation: resolved.approval_or_delegation,
    final_authority: resolved.final_authority,
    durable_execution: resolved.durable_execution,
    adapter: resolved.adapter,
    readback: resolved.readback,
    readiness: resolved.readiness,
    questionnaire_schema: resolved.questionnaire_schema,
  });

  if (envelope.surface_ready !== true || envelope.final_authority?.allowed !== true) {
    return failure(
      "MCP_GOVERNED_SURFACE_DENIED",
      "The authoritative runtime contract does not permit this surface projection.",
      envelope.blockers,
    );
  }

  const projection = resolved.surface_projection;
  if (!plainObject(projection) || text(projection.tool_name, 128) !== normalizedTool) {
    return failure("MCP_SURFACE_PROJECTION_MISMATCH", "The authoritative projection does not match the requested tool.");
  }

  const result = projectToolResult(normalizedTool, projection.result);
  if (!result) {
    return failure("MCP_SURFACE_PROJECTION_INVALID", "The authoritative projection result is invalid.");
  }

  if (normalizedTool === "list_accessible_brands") {
    const requestedWorkspace = text(toolArguments?.workspace_id, 128);
    if (!requestedWorkspace || result.workspace_id !== requestedWorkspace) {
      return failure("MCP_SURFACE_BINDING_MISMATCH", "The authoritative projection is not bound to the requested workspace.");
    }
  }

  return {
    ok: true,
    tool_name: normalizedTool,
    result,
    envelope,
    authority_source: "track_a_runtime_contract",
    readiness_source: "track_b_evidence_contract",
    authority_created_by_surface: false,
    connection_selected_by_surface: false,
    provider_executed_by_surface: false,
    secrets_included: false,
  };
}
