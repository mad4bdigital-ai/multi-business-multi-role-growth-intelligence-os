import { buildTenantGptEffectiveCapabilitySurface } from "./tenantGptEffectiveCapabilitySurface.js";

const READ_ONLY_EFFECTS = new Set(["read", "read_only", "readonly"]);
const BINDING_KEYS = Object.freeze(["tenant_id", "workspace_id", "brand_id"]);
const SECRET_KEY = /(?:^|_)(?:authorization|cookie|password|passwd|secret|client_secret|api_key|access_key|private_key|token|access_token|refresh_token|id_token|credential|credentials|raw_row|raw_rows)(?:_|$)/i;

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value, maximum = 256) {
  return String(value || "").trim().slice(0, maximum);
}

function sanitizeString(value) {
  const input = String(value).slice(0, 4096);
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(input)) return "[redacted]";
  if (/^\s*(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+\s*$/i.test(input)) return "[redacted]";
  try {
    const url = new URL(input);
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
    }
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_KEY.test(key)) url.searchParams.set(key, "[redacted]");
    }
    return url.toString().slice(0, 4096);
  } catch {
    return input;
  }
}

function sanitize(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (["boolean", "number"].includes(typeof value)) return value;
  if (typeof value === "string") return sanitizeString(value);
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

function resolvedEffect(resolved, projection) {
  return text(
    projection?.effect
      || resolved?.final_authority?.effect
      || resolved?.authority_preflight?.effect
      || resolved?.plan?.effect,
    64,
  ).toLowerCase();
}

function normalizeProjectionResult(value) {
  const result = sanitize(value);
  if (!plainObject(result)) return result;
  if (Array.isArray(result.workspaces) && result.count === undefined) result.count = result.workspaces.length;
  if (Array.isArray(result.brands) && result.count === undefined) result.count = result.brands.length;
  return result;
}

function bindingMismatch(toolArguments, context, result) {
  for (const key of BINDING_KEYS) {
    const authoritative = text(context?.[key], 256);
    const projected = text(plainObject(result) ? result[key] : "", 256);
    if (authoritative && projected && authoritative !== projected) return key;

    const requested = text(toolArguments?.[key], 256);
    if (!requested) continue;
    if (authoritative && requested !== authoritative) return key;
    if (projected && requested !== projected) return key;
  }
  return null;
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
  if (!normalizedTool) {
    return failure("MCP_TOOL_NAME_REQUIRED", "A governed Remote MCP tool name is required.");
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
  if (projection.secrets_included === true) {
    return failure("MCP_SURFACE_SECRET_PROJECTION_REJECTED", "The authoritative projection is not public-safe.");
  }

  const effect = resolvedEffect(resolved, projection);
  if (!READ_ONLY_EFFECTS.has(effect)) {
    return failure("MCP_WRITE_SURFACE_NOT_ENABLED", "This Remote MCP surface exposes governed read-only projections only.");
  }

  const result = normalizeProjectionResult(projection.result);
  if (result === undefined || result === null) {
    return failure("MCP_SURFACE_PROJECTION_INVALID", "The authoritative projection result is invalid.");
  }

  const mismatchedBinding = bindingMismatch(toolArguments, resolved.context, result);
  if (mismatchedBinding) {
    return failure(
      "MCP_SURFACE_BINDING_MISMATCH",
      `The authoritative projection is not bound to the requested ${mismatchedBinding}.`,
    );
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
