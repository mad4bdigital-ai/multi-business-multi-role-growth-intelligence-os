import { randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { verifyUserJwtAuthorization } from "./userJwtAuth.js";

export const CHATGPT_MCP_PROTOCOL_VERSION = "2025-06-18";
export const CHATGPT_MCP_SUPPORTED_PROTOCOL_VERSIONS = Object.freeze([
  CHATGPT_MCP_PROTOCOL_VERSION,
  "2025-03-26",
]);

const DEFAULT_RESOURCE = "https://mcp.mad4b.com";
const DEFAULT_AUTHORIZATION_SERVER = "https://auth.mad4b.com";
const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  "https://chatgpt.com",
  "https://www.chatgpt.com",
]);
const OWNER_ROLES = new Set(["owner", "admin"]);
const MAX_WORKSPACES = 50;
const MAX_BRANDS = 100;

const READ_SCOPES = Object.freeze([
  "workspaces.read",
  "brands.read",
]);

function envFlag(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function boundedInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function normalizedString(value, maximum = 256) {
  return String(value || "").trim().slice(0, maximum);
}

function headerValue(headers, name) {
  if (!headers || typeof headers !== "object") return "";
  const direct = headers[name];
  if (direct != null) return String(direct);
  const lowered = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === lowered) return String(value ?? "");
  }
  return "";
}

function jsonRpcSuccess(id, result) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function jsonRpcError(id, code, message, data = undefined) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  };
}

function toolErrorResult({ code, message, retryable = false, requestId, meta = {} }) {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: {
      ok: false,
      error: { code, message, retryable },
      request_id: requestId,
      secrets_included: false,
    },
    isError: true,
    _meta: {
      "mad4b/request_id": requestId,
      "mad4b/error_code": code,
      ...meta,
    },
  };
}

function toolSuccessResult({ summary, structuredContent, requestId, evidenceSource }) {
  return {
    content: [{ type: "text", text: summary }],
    structuredContent: {
      ok: true,
      ...structuredContent,
      request_id: requestId,
      secrets_included: false,
    },
    _meta: {
      "mad4b/request_id": requestId,
      "mad4b/evidence_source": evidenceSource,
    },
  };
}

export function chatGptMcpEnabled(env = process.env) {
  return envFlag(env.CHATGPT_MCP_ENABLED);
}

export function chatGptMcpLegacyUserJwtEnabled(env = process.env) {
  return envFlag(env.CHATGPT_MCP_LEGACY_USER_JWT_ENABLED);
}

export function resolveChatGptMcpResource(env = process.env) {
  return normalizedString(env.CHATGPT_MCP_RESOURCE_URL || DEFAULT_RESOURCE, 2048)
    .replace(/\/+$/u, "");
}

export function resolveChatGptMcpEndpoint(env = process.env) {
  return `${resolveChatGptMcpResource(env)}/mcp`;
}

export function resolveChatGptMcpAuthorizationServer(env = process.env) {
  return normalizedString(
    env.CHATGPT_MCP_AUTHORIZATION_SERVER_URL || DEFAULT_AUTHORIZATION_SERVER,
    2048,
  ).replace(/\/+$/u, "");
}

export function buildChatGptProtectedResourceMetadata(env = process.env) {
  return {
    resource: resolveChatGptMcpResource(env),
    authorization_servers: [resolveChatGptMcpAuthorizationServer(env)],
    scopes_supported: [...READ_SCOPES],
    resource_documentation: normalizedString(
      env.CHATGPT_MCP_RESOURCE_DOCUMENTATION_URL
        || `${resolveChatGptMcpResource(env)}/docs`,
      2048,
    ),
    bearer_methods_supported: ["header"],
  };
}

export function buildChatGptMcpWwwAuthenticate(
  env = process.env,
  {
    scope = READ_SCOPES.join(" "),
    error = "invalid_token",
    description = "A valid linked platform account is required.",
  } = {},
) {
  const metadataUrl = `${resolveChatGptMcpResource(env)}/.well-known/oauth-protected-resource`;
  const safeDescription = String(description || "Authentication required.")
    .replace(/["\r\n]/gu, " ")
    .slice(0, 240);
  return `Bearer resource_metadata="${metadataUrl}", scope="${scope}", error="${error}", error_description="${safeDescription}"`;
}

function allowedOrigins(env = process.env) {
  const configured = String(env.CHATGPT_MCP_ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set(configured.length ? configured : DEFAULT_ALLOWED_ORIGINS);
}

export function validateChatGptMcpOrigin(headers, env = process.env) {
  const origin = headerValue(headers, "origin").trim();
  if (!origin) return { ok: true, origin: null };
  if (allowedOrigins(env).has(origin)) return { ok: true, origin };
  return { ok: false, origin };
}

function validateTransportHeaders(headers, method, env) {
  const originResult = validateChatGptMcpOrigin(headers, env);
  if (!originResult.ok) {
    return {
      ok: false,
      status: 403,
      error: jsonRpcError(null, -32001, "Origin is not allowed."),
    };
  }

  if (method !== "POST") return { ok: true };

  const contentType = headerValue(headers, "content-type").toLowerCase();
  if (!contentType.includes("application/json")) {
    return {
      ok: false,
      status: 415,
      error: jsonRpcError(null, -32600, "Content-Type must be application/json."),
    };
  }

  const accept = headerValue(headers, "accept").toLowerCase();
  if (!accept.includes("application/json") || !accept.includes("text/event-stream")) {
    return {
      ok: false,
      status: 406,
      error: jsonRpcError(
        null,
        -32600,
        "Accept must include application/json and text/event-stream.",
      ),
    };
  }

  return { ok: true };
}

function validateProtocolHeader(headers, body) {
  if (body?.method === "initialize") return { ok: true };
  const supplied = headerValue(headers, "mcp-protocol-version").trim();
  if (!supplied) return { ok: true, assumed: "2025-03-26" };
  if (CHATGPT_MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(supplied)) {
    return { ok: true, protocolVersion: supplied };
  }
  return {
    ok: false,
    status: 400,
    error: jsonRpcError(
      body?.id,
      -32600,
      `Unsupported MCP protocol version: ${supplied}`,
      { supported: [...CHATGPT_MCP_SUPPORTED_PROTOCOL_VERSIONS] },
    ),
  };
}

const TOOL_DEFINITIONS = Object.freeze([
  Object.freeze({
    name: "list_accessible_workspaces",
    title: "List accessible workspaces",
    description: "List the active platform workspaces the signed-in user can access. Use this before selecting a workspace for Brand-level queries.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_WORKSPACES,
          description: "Maximum number of workspaces to return.",
        },
      },
    },
    outputSchema: {
      type: "object",
      required: ["ok", "workspaces", "count", "request_id", "secrets_included"],
      properties: {
        ok: { type: "boolean" },
        workspaces: { type: "array" },
        count: { type: "integer" },
        request_id: { type: "string" },
        secrets_included: { const: false },
      },
    },
    securitySchemes: [{ type: "oauth2", scopes: ["workspaces.read"] }],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  }),
  Object.freeze({
    name: "list_accessible_brands",
    title: "List accessible Brands",
    description: "List Brands the signed-in user can access inside one authorized workspace. Call list_accessible_workspaces first when the workspace ID is unknown.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["workspace_id"],
      properties: {
        workspace_id: {
          type: "string",
          minLength: 1,
          maxLength: 128,
          description: "Workspace identifier returned by list_accessible_workspaces.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_BRANDS,
          description: "Maximum number of Brands to return.",
        },
      },
    },
    outputSchema: {
      type: "object",
      required: ["ok", "workspace_id", "brands", "count", "request_id", "secrets_included"],
      properties: {
        ok: { type: "boolean" },
        workspace_id: { type: "string" },
        brands: { type: "array" },
        count: { type: "integer" },
        request_id: { type: "string" },
        secrets_included: { const: false },
      },
    },
    securitySchemes: [{ type: "oauth2", scopes: ["brands.read"] }],
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  }),
]);

export function listChatGptMcpTools() {
  return TOOL_DEFINITIONS.map((tool) => structuredClone(tool));
}

function resolveLegacyPrincipal(headers, env, verifyAuthorization) {
  if (!chatGptMcpLegacyUserJwtEnabled(env)) {
    return {
      ok: false,
      status: 401,
      code: "MCP_AUTH_REQUIRED",
      message: "OAuth account linking is required for this tool.",
    };
  }

  const result = verifyAuthorization(headerValue(headers, "authorization"), { env });
  if (!result.ok) {
    return {
      ok: false,
      status: result.status,
      code: "MCP_AUTH_REQUIRED",
      message: result.message || "Sign in required.",
    };
  }

  return {
    ok: true,
    principal: {
      user_id: result.claims.user_id,
      tenant_id: result.claims.tenant_id || null,
      claims: result.claims,
      auth_mode: "legacy_user_jwt_read_only_bridge",
    },
  };
}

async function listAccessibleWorkspaces({ pool, userId, limit }) {
  const [rows] = await pool.query(
    `SELECT m.tenant_id AS workspace_id,
            t.display_name,
            m.role,
            m.status AS membership_status,
            t.status AS workspace_status,
            m.granted_at
       FROM memberships m
       JOIN tenants t ON t.tenant_id = m.tenant_id
      WHERE m.user_id = ?
        AND m.status = 'active'
        AND t.status = 'active'
      ORDER BY m.granted_at ASC
      LIMIT ?`,
    [userId, limit],
  );

  return rows.map((row) => ({
    workspace_id: row.workspace_id,
    display_name: row.display_name || row.workspace_id,
    role: row.role || null,
    membership_status: row.membership_status,
    workspace_status: row.workspace_status,
  }));
}

async function activeWorkspaceMembership({ pool, userId, workspaceId }) {
  const [rows] = await pool.query(
    `SELECT m.tenant_id AS workspace_id, m.role, m.status, t.status AS workspace_status
       FROM memberships m
       JOIN tenants t ON t.tenant_id = m.tenant_id
      WHERE m.user_id = ?
        AND m.tenant_id = ?
        AND m.status = 'active'
        AND t.status = 'active'
      LIMIT 1`,
    [userId, workspaceId],
  );
  return rows[0] || null;
}

function brandLookupKeys(value) {
  const raw = normalizedString(value, 256);
  if (!raw) return [];
  const withoutPrefix = raw.replace(/^brand:/iu, "").trim();
  return [...new Set([raw, withoutPrefix].filter(Boolean))];
}

async function listAccessibleBrands({ pool, userId, workspaceId, limit }) {
  const membership = await activeWorkspaceMembership({ pool, userId, workspaceId });
  if (!membership) {
    const error = new Error("The selected workspace is not accessible to the signed-in user.");
    error.code = "MCP_CONTEXT_DENIED";
    error.retryable = false;
    throw error;
  }

  const ownerScoped = OWNER_ROLES.has(String(membership.role || "").toLowerCase());
  const params = [workspaceId];
  const userClause = ownerScoped ? "" : " AND grantee_user_id = ?";
  if (!ownerScoped) params.push(userId);
  params.push(Math.min(limit * 4, 400));

  const [grantRows] = await pool.query(
    `SELECT resource_ref, permission, source, granted_at
       FROM v_workspace_resource_grant_effective
      WHERE tenant_id = ?
        AND resource_type = 'brand'
        ${userClause}
      ORDER BY resource_ref, granted_at DESC
      LIMIT ?`,
    params,
  );

  const grantsByRef = new Map();
  for (const row of grantRows) {
    const ref = normalizedString(row.resource_ref, 256);
    if (!ref || grantsByRef.has(ref.toLowerCase())) continue;
    grantsByRef.set(ref.toLowerCase(), {
      brand_ref: ref,
      permission: row.permission || "view",
      permission_source: row.source || "workspace_resource_grant",
    });
    if (grantsByRef.size >= limit) break;
  }

  const grants = [...grantsByRef.values()];
  const lookupValues = [...new Set(grants.flatMap((row) => brandLookupKeys(row.brand_ref)))];
  let brandRows = [];
  if (lookupValues.length) {
    [brandRows] = await pool.query(
      `SELECT brand_name, normalized_brand_name, brand_domain, target_key,
              base_url, status, brand_core_ready
         FROM brands
        WHERE target_key IN (?)
           OR normalized_brand_name IN (?)
           OR brand_name IN (?)
        LIMIT ?`,
      [lookupValues, lookupValues, lookupValues, Math.min(lookupValues.length * 3, 300)],
    );
  }

  const metadataByKey = new Map();
  for (const row of brandRows) {
    for (const value of [row.target_key, row.normalized_brand_name, row.brand_name]) {
      for (const key of brandLookupKeys(value)) metadataByKey.set(key.toLowerCase(), row);
    }
  }

  return {
    membership_role: membership.role || null,
    brands: grants.map((grant) => {
      const metadata = brandLookupKeys(grant.brand_ref)
        .map((key) => metadataByKey.get(key.toLowerCase()))
        .find(Boolean);
      return {
        ...grant,
        display_name: metadata?.brand_name || grant.brand_ref.replace(/^brand:/iu, ""),
        target_key: metadata?.target_key || null,
        brand_domain: metadata?.brand_domain || null,
        base_url: metadata?.base_url || null,
        status: metadata?.status || null,
        brand_core_ready: metadata?.brand_core_ready ?? null,
      };
    }),
  };
}

async function executeTool({ name, args, principal, pool, requestId }) {
  if (name === "list_accessible_workspaces") {
    const limit = boundedInteger(args?.limit, 25, MAX_WORKSPACES);
    const workspaces = await listAccessibleWorkspaces({
      pool,
      userId: principal.user_id,
      limit,
    });
    return toolSuccessResult({
      summary: `Found ${workspaces.length} accessible workspace${workspaces.length === 1 ? "" : "s"}.`,
      structuredContent: { workspaces, count: workspaces.length },
      requestId,
      evidenceSource: "memberships_join_tenants_active_projection",
    });
  }

  if (name === "list_accessible_brands") {
    const workspaceId = normalizedString(args?.workspace_id, 128);
    if (!workspaceId) {
      return toolErrorResult({
        code: "MCP_INPUT_INVALID",
        message: "workspace_id is required.",
        requestId,
      });
    }
    const limit = boundedInteger(args?.limit, 50, MAX_BRANDS);
    const result = await listAccessibleBrands({
      pool,
      userId: principal.user_id,
      workspaceId,
      limit,
    });
    return toolSuccessResult({
      summary: `Found ${result.brands.length} accessible Brand${result.brands.length === 1 ? "" : "s"} in the selected workspace.`,
      structuredContent: {
        workspace_id: workspaceId,
        membership_role: result.membership_role,
        brands: result.brands,
        count: result.brands.length,
      },
      requestId,
      evidenceSource: "v_workspace_resource_grant_effective_plus_brands",
    });
  }

  return toolErrorResult({
    code: "MCP_TOOL_NOT_AVAILABLE",
    message: `Unknown or unavailable tool: ${normalizedString(name, 128) || "missing"}`,
    requestId,
  });
}

function chooseProtocolVersion(requested) {
  const normalized = normalizedString(requested, 32);
  return CHATGPT_MCP_SUPPORTED_PROTOCOL_VERSIONS.includes(normalized)
    ? normalized
    : CHATGPT_MCP_PROTOCOL_VERSION;
}

export async function handleChatGptMcpRequest({
  body,
  headers = {},
  method = "POST",
  env = process.env,
  pool = getPool(),
  verifyAuthorization = verifyUserJwtAuthorization,
  requestId = normalizedString(headerValue(headers, "x-request-id"), 128) || randomUUID(),
} = {}) {
  if (!chatGptMcpEnabled(env)) {
    return {
      status: 404,
      headers: { "x-request-id": requestId },
      body: { ok: false, error: { code: "MCP_DISABLED", message: "Not found." }, secrets_included: false },
    };
  }

  const transport = validateTransportHeaders(headers, method, env);
  if (!transport.ok) {
    return {
      status: transport.status,
      headers: { "x-request-id": requestId },
      body: transport.error,
    };
  }

  if (method !== "POST") {
    return {
      status: 405,
      headers: { allow: "POST", "x-request-id": requestId },
      body: { ok: false, error: { code: "MCP_METHOD_NOT_ALLOWED", message: "Use POST for this stateless MCP endpoint." }, secrets_included: false },
    };
  }

  if (!body || typeof body !== "object" || Array.isArray(body) || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return {
      status: 400,
      headers: { "x-request-id": requestId },
      body: jsonRpcError(body?.id, -32600, "Invalid JSON-RPC request."),
    };
  }

  const protocol = validateProtocolHeader(headers, body);
  if (!protocol.ok) {
    return {
      status: protocol.status,
      headers: { "x-request-id": requestId },
      body: protocol.error,
    };
  }

  const id = body.id;
  const params = body.params && typeof body.params === "object" && !Array.isArray(body.params)
    ? body.params
    : {};

  if (body.method.startsWith("notifications/")) {
    return {
      status: 202,
      headers: { "x-request-id": requestId },
      body: null,
    };
  }

  if (body.method === "initialize") {
    return {
      status: 200,
      headers: {
        "content-type": "application/json",
        "mcp-protocol-version": chooseProtocolVersion(params.protocolVersion),
        "x-request-id": requestId,
      },
      body: jsonRpcSuccess(id, {
        protocolVersion: chooseProtocolVersion(params.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: "mad4b-growth-intelligence-os",
          title: "MAD4B Growth Intelligence OS",
          version: "0.1.0-readonly",
        },
        instructions: "Use list_accessible_workspaces before Brand queries. This release is read-only. User-supplied workspace and Brand identifiers are selectors and never grant authority.",
      }),
    };
  }

  if (body.method === "ping") {
    return {
      status: 200,
      headers: { "content-type": "application/json", "x-request-id": requestId },
      body: jsonRpcSuccess(id, {}),
    };
  }

  if (body.method === "tools/list") {
    return {
      status: 200,
      headers: { "content-type": "application/json", "x-request-id": requestId },
      body: jsonRpcSuccess(id, { tools: listChatGptMcpTools() }),
    };
  }

  if (body.method === "tools/call") {
    const toolName = normalizedString(params.name, 128);
    const toolArgs = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
      ? params.arguments
      : {};
    if (!toolName) {
      return {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": requestId },
        body: jsonRpcSuccess(id, toolErrorResult({
          code: "MCP_INPUT_INVALID",
          message: "Tool name is required.",
          requestId,
        })),
      };
    }

    const principalResult = resolveLegacyPrincipal(headers, env, verifyAuthorization);
    if (!principalResult.ok) {
      const challenge = buildChatGptMcpWwwAuthenticate(env, {
        scope: toolName === "list_accessible_workspaces" ? "workspaces.read" : "brands.read",
        error: "invalid_token",
        description: principalResult.message,
      });
      return {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": requestId },
        body: jsonRpcSuccess(id, toolErrorResult({
          code: principalResult.code,
          message: principalResult.message,
          requestId,
          meta: { "mcp/www_authenticate": [challenge] },
        })),
      };
    }

    try {
      const result = await executeTool({
        name: toolName,
        args: toolArgs,
        principal: principalResult.principal,
        pool,
        requestId,
      });
      return {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": requestId },
        body: jsonRpcSuccess(id, result),
      };
    } catch (error) {
      const code = normalizedString(error?.code, 128) || "MCP_DEPENDENCY_UNAVAILABLE";
      const retryable = error?.retryable ?? code === "MCP_DEPENDENCY_UNAVAILABLE";
      const message = code === "MCP_CONTEXT_DENIED"
        ? "The selected resource is not accessible to the signed-in user."
        : "The platform could not complete the read-only tool call.";
      return {
        status: 200,
        headers: { "content-type": "application/json", "x-request-id": requestId },
        body: jsonRpcSuccess(id, toolErrorResult({
          code,
          message,
          retryable,
          requestId,
        })),
      };
    }
  }

  return {
    status: 200,
    headers: { "content-type": "application/json", "x-request-id": requestId },
    body: jsonRpcError(id, -32601, `Method not found: ${body.method}`),
  };
}
