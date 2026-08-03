import { randomUUID } from "node:crypto";
import {
  CHATGPT_MCP_PROTOCOL_VERSION,
  CHATGPT_MCP_SUPPORTED_PROTOCOL_VERSIONS,
  buildChatGptMcpWwwAuthenticate,
  buildChatGptProtectedResourceMetadata,
  chatGptMcpEnabled,
  chatGptMcpLegacyUserJwtEnabled,
  handleChatGptMcpRequest,
  listChatGptMcpTools,
  resolveChatGptMcpAuthorizationServer,
  resolveChatGptMcpEndpoint,
  resolveChatGptMcpResource,
} from "./chatgptMcpRuntime.js";
import { verifyRemoteMcpBearerAuthorization } from "./remoteMcpAccessTokenVerifier.js";
import {
  remoteMcpOAuthEnabled,
  resolveRemoteMcpAuthorizationIssuer,
} from "./remoteMcpOAuthProfile.js";

export const REMOTE_MCP_PROTOCOL_VERSION = CHATGPT_MCP_PROTOCOL_VERSION;
export const REMOTE_MCP_SUPPORTED_PROTOCOL_VERSIONS = CHATGPT_MCP_SUPPORTED_PROTOCOL_VERSIONS;

const DEFAULT_CLIENT_PROFILES = Object.freeze([
  Object.freeze({
    key: "openai_chatgpt",
    title: "OpenAI ChatGPT and Codex",
    origins: Object.freeze([
      "https://chatgpt.com",
      "https://www.chatgpt.com",
    ]),
    transports: Object.freeze(["streamable_http"]),
    authentication: Object.freeze(["oauth_2_1"]),
  }),
  Object.freeze({
    key: "anthropic_claude",
    title: "Anthropic Claude",
    origins: Object.freeze([
      "https://claude.ai",
      "https://www.claude.ai",
    ]),
    transports: Object.freeze(["streamable_http"]),
    authentication: Object.freeze(["oauth_2_1"]),
  }),
  Object.freeze({
    key: "generic_remote_mcp_client",
    title: "Generic standards-compliant remote MCP client",
    origins: Object.freeze([]),
    transports: Object.freeze(["streamable_http"]),
    authentication: Object.freeze(["oauth_2_1"]),
  }),
]);

function normalizedString(value, maximum = 2048) {
  return String(value || "").trim().slice(0, maximum);
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
}

function headerValue(headers, name) {
  if (!headers || typeof headers !== "object") return "";
  const lowered = String(name || "").toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === lowered) return String(value ?? "");
  }
  return "";
}

function defaultAllowedOrigins() {
  return DEFAULT_CLIENT_PROFILES.flatMap((profile) => profile.origins);
}

function effectiveRemoteMcpEnv(env = process.env) {
  const remoteAllowedOrigins = firstDefined(
    env.REMOTE_MCP_ALLOWED_ORIGINS,
    env.CHATGPT_MCP_ALLOWED_ORIGINS,
    defaultAllowedOrigins().join(","),
  );
  const oauthEnabled = remoteMcpOAuthEnabled(env);

  return {
    ...env,
    CHATGPT_MCP_ENABLED: firstDefined(
      env.REMOTE_MCP_ENABLED,
      env.CHATGPT_MCP_ENABLED,
    ),
    CHATGPT_MCP_LEGACY_USER_JWT_ENABLED: oauthEnabled
      ? "true"
      : firstDefined(
        env.REMOTE_MCP_LEGACY_USER_JWT_ENABLED,
        env.CHATGPT_MCP_LEGACY_USER_JWT_ENABLED,
      ),
    CHATGPT_MCP_RESOURCE_URL: firstDefined(
      env.REMOTE_MCP_RESOURCE_URL,
      env.CHATGPT_MCP_RESOURCE_URL,
    ),
    CHATGPT_MCP_AUTHORIZATION_SERVER_URL: firstDefined(
      env.REMOTE_MCP_AUTHORIZATION_SERVER_URL,
      env.CHATGPT_MCP_AUTHORIZATION_SERVER_URL,
      resolveRemoteMcpAuthorizationIssuer(env),
    ),
    CHATGPT_MCP_RESOURCE_DOCUMENTATION_URL: firstDefined(
      env.REMOTE_MCP_RESOURCE_DOCUMENTATION_URL,
      env.CHATGPT_MCP_RESOURCE_DOCUMENTATION_URL,
    ),
    CHATGPT_MCP_ALLOWED_ORIGINS: remoteAllowedOrigins,
  };
}

function requiredScopesForTool(toolName) {
  if (toolName === "list_accessible_workspaces") return ["workspaces.read"];
  if (toolName === "list_accessible_brands") return ["brands.read"];
  return [];
}

function oauthFailureResponse({ body, headers, env, verification, requiredScopes }) {
  const requestId = normalizedString(headerValue(headers, "x-request-id"), 128) || randomUUID();
  const challenge = verification.status === 401
    ? [buildRemoteMcpWwwAuthenticate(env, {
      scope: requiredScopes.join(" "),
      error: verification.code === "MCP_SCOPE_INSUFFICIENT" ? "insufficient_scope" : "invalid_token",
      description: verification.message,
    })]
    : undefined;
  return {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId,
    },
    body: {
      jsonrpc: "2.0",
      id: body?.id ?? null,
      result: {
        content: [{ type: "text", text: verification.message }],
        structuredContent: {
          ok: false,
          error: {
            code: verification.code,
            message: verification.message,
            retryable: verification.status >= 500,
          },
          request_id: requestId,
          secrets_included: false,
        },
        isError: true,
        _meta: {
          "mad4b/request_id": requestId,
          "mad4b/error_code": verification.code,
          ...(challenge ? { "mcp/www_authenticate": challenge } : {}),
        },
      },
    },
  };
}

export function listRemoteMcpClientProfiles() {
  return DEFAULT_CLIENT_PROFILES.map((profile) => structuredClone(profile));
}

export function resolveRemoteMcpClientProfile(headers = {}) {
  const origin = normalizedString(headerValue(headers, "origin")).toLowerCase();
  if (origin) {
    const matched = DEFAULT_CLIENT_PROFILES.find((profile) => (
      profile.origins.some((candidate) => candidate.toLowerCase() === origin)
    ));
    if (matched) return structuredClone(matched);
  }

  const userAgent = normalizedString(headerValue(headers, "user-agent")).toLowerCase();
  if (userAgent.includes("claude") || userAgent.includes("anthropic")) {
    return structuredClone(DEFAULT_CLIENT_PROFILES[1]);
  }
  if (userAgent.includes("chatgpt") || userAgent.includes("openai") || userAgent.includes("codex")) {
    return structuredClone(DEFAULT_CLIENT_PROFILES[0]);
  }

  return structuredClone(DEFAULT_CLIENT_PROFILES[2]);
}

export function remoteMcpEnabled(env = process.env) {
  return chatGptMcpEnabled(effectiveRemoteMcpEnv(env));
}

export function remoteMcpLegacyUserJwtEnabled(env = process.env) {
  return chatGptMcpLegacyUserJwtEnabled(effectiveRemoteMcpEnv(env));
}

export function resolveRemoteMcpResource(env = process.env) {
  return resolveChatGptMcpResource(effectiveRemoteMcpEnv(env));
}

export function resolveRemoteMcpEndpoint(env = process.env) {
  return resolveChatGptMcpEndpoint(effectiveRemoteMcpEnv(env));
}

export function resolveRemoteMcpAuthorizationServer(env = process.env) {
  return resolveChatGptMcpAuthorizationServer(effectiveRemoteMcpEnv(env));
}

export function buildRemoteMcpProtectedResourceMetadata(env = process.env) {
  return buildChatGptProtectedResourceMetadata(effectiveRemoteMcpEnv(env));
}

export function buildRemoteMcpWwwAuthenticate(env = process.env, options = {}) {
  return buildChatGptMcpWwwAuthenticate(effectiveRemoteMcpEnv(env), options);
}

export function listRemoteMcpTools() {
  return listChatGptMcpTools();
}

export async function handleRemoteMcpConnectorRequest(options = {}) {
  const sourceEnv = options.env || process.env;
  const env = effectiveRemoteMcpEnv(sourceEnv);
  const clientProfile = resolveRemoteMcpClientProfile(options.headers || {});
  let verifyAuthorization = options.verifyAuthorization;

  if (remoteMcpOAuthEnabled(sourceEnv) && options.body?.method === "tools/call") {
    const toolName = normalizedString(options.body?.params?.name, 128);
    const requiredScopes = requiredScopesForTool(toolName);
    const verification = await verifyRemoteMcpBearerAuthorization(
      headerValue(options.headers || {}, "authorization"),
      {
        env: sourceEnv,
        pool: options.pool,
        requiredScopes,
      },
    );
    if (!verification.ok) {
      const failure = oauthFailureResponse({
        body: options.body,
        headers: options.headers || {},
        env,
        verification,
        requiredScopes,
      });
      return {
        ...failure,
        headers: {
          ...(failure.headers || {}),
          "x-mad4b-mcp-client-profile": clientProfile.key,
        },
      };
    }
    verifyAuthorization = () => ({ ok: true, claims: verification.claims });
  }

  const response = await handleChatGptMcpRequest({
    ...options,
    env,
    verifyAuthorization,
  });

  return {
    ...response,
    headers: {
      ...(response.headers || {}),
      "x-mad4b-mcp-client-profile": clientProfile.key,
    },
  };
}

export function getRemoteMcpRuntimeConfiguration(env = process.env) {
  const effectiveEnv = effectiveRemoteMcpEnv(env);
  return {
    enabled: remoteMcpEnabled(env),
    oauth_enabled: remoteMcpOAuthEnabled(env),
    legacy_user_jwt_enabled: remoteMcpLegacyUserJwtEnabled(env),
    resource: resolveChatGptMcpResource(effectiveEnv),
    endpoint: resolveChatGptMcpEndpoint(effectiveEnv),
    authorization_server: resolveChatGptMcpAuthorizationServer(effectiveEnv),
    allowed_origins: String(effectiveEnv.CHATGPT_MCP_ALLOWED_ORIGINS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    supported_client_profiles: listRemoteMcpClientProfiles().map((profile) => profile.key),
    supported_protocol_versions: [...REMOTE_MCP_SUPPORTED_PROTOCOL_VERSIONS],
    transport: "streamable_http",
    secrets_included: false,
  };
}
