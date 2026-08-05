import { Router } from "express";
import {
  TENANT_GPT_ACTIVATION_RESOURCE,
  TENANT_GPT_AUTHORIZATION_SERVER,
  normalizeTenantGptRequestHost,
} from "../tenantGptOAuthResourceProfile.js";
import { TENANT_GPT_SCOPE_LINKS } from "../tenantGptOAuthPreset.js";
import {
  buildRemoteMcpProtectedResourceMetadata,
  remoteMcpEnabled,
  resolveRemoteMcpResource,
} from "../remoteMcpConnectorRuntime.js";
import {
  REMOTE_MCP_SCOPES,
  envFlag,
  remoteMcpDynamicClientRegistrationEnabled,
  remoteMcpOAuthEnabled,
  resolveRemoteMcpAllowedRedirectOrigins,
  resolveRemoteMcpAuthorizationIssuer,
} from "../remoteMcpOAuthProfile.js";
import {
  buildTenantGptOAuthTokenExchangeDeps,
  buildTenantGptOAuthTokenRequestBindingGuard,
} from "../tenantGptOAuthTokenExchangeBindingGuard.js";
import { buildTenantGptOAuthTokenExchangeRoutes } from "./tenantGptOAuthTokenExchangeRoutes.js";

function requestHost(req) {
  return normalizeTenantGptRequestHost(
    req.headers?.["x-original-host"]
      || req.headers?.["x-forwarded-host"]
      || req.headers?.host,
  );
}

function configuredMcpHost(env) {
  try {
    return new URL(resolveRemoteMcpResource(env)).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function remoteMcpDcrAdvertised(env) {
  if (!remoteMcpDynamicClientRegistrationEnabled(env)) return false;
  return resolveRemoteMcpAllowedRedirectOrigins(env).size > 0
    || envFlag(env.REMOTE_MCP_OAUTH_ALLOW_LOOPBACK);
}

function remoteMcpAuthorizationServerMetadata(env) {
  const issuer = resolveRemoteMcpAuthorizationIssuer(env);
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    ...(remoteMcpDcrAdvertised(env)
      ? { registration_endpoint: `${issuer}/oauth/register` }
      : {}),
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [...REMOTE_MCP_SCOPES],
    resource_parameter_supported: true,
  };
}

export function buildTenantGptOAuthMetadataRoutes(deps = {}) {
  const router = Router();
  const env = deps.env || process.env;
  const tokenDeps = buildTenantGptOAuthTokenExchangeDeps(deps, env);

  // The request guard and governed Tenant GPT token exchange must mount before
  // the legacy /auth router. They own only POST /auth/oauth/token and leave
  // every other auth route to the existing implementation.
  router.use(buildTenantGptOAuthTokenRequestBindingGuard(deps));
  router.use(buildTenantGptOAuthTokenExchangeRoutes(tokenDeps));

  // RFC 8414 path-scoped metadata is a child of the existing governed public
  // discovery family. Using the prefix middleware preserves one explicit public
  // authority decision while still serving the exact issuer-derived URL.
  router.use("/.well-known/oauth-authorization-server", (req, res, next) => {
    if (req.method !== "GET" || req.path !== "/auth/mcp") return next();
    if (!remoteMcpOAuthEnabled(env)) {
      return res.status(404).json({
        ok: false,
        error: { code: "MCP_OAUTH_DISABLED", message: "Not found." },
        secrets_included: false,
      });
    }
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).json(remoteMcpAuthorizationServerMetadata(env));
  });

  // Existing Tenant GPT/Activation authorization-server metadata remains
  // unchanged for backwards compatibility.
  router.get("/.well-known/oauth-authorization-server", (_req, res) => {
    res.status(200).json({
      issuer: TENANT_GPT_AUTHORIZATION_SERVER,
      authorization_endpoint: "https://auth.mad4b.com/auth/oauth/authorize",
      token_endpoint: "https://auth.mad4b.com/auth/oauth/token",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      scopes_supported: TENANT_GPT_SCOPE_LINKS,
      resource_parameter_supported: true,
    });
  });

  router.get("/.well-known/oauth-protected-resource", (req, res) => {
    const mcpHost = configuredMcpHost(env);
    if (mcpHost && requestHost(req) === mcpHost) {
      if (!remoteMcpEnabled(env)) {
        return res.status(404).json({
          ok: false,
          error: { code: "MCP_DISABLED", message: "Not found." },
          secrets_included: false,
        });
      }
      res.setHeader("Cache-Control", "public, max-age=300");
      return res.status(200).json(buildRemoteMcpProtectedResourceMetadata(env));
    }

    return res.status(200).json({
      resource: TENANT_GPT_ACTIVATION_RESOURCE,
      authorization_servers: [TENANT_GPT_AUTHORIZATION_SERVER],
      scopes_supported: TENANT_GPT_SCOPE_LINKS,
      bearer_methods_supported: ["header"],
      resource_documentation: "https://activation.mad4b.com/tenant-gpt/activation-openapi",
    });
  });

  return router;
}
