import { Router } from "express";
import {
  TENANT_GPT_ACTIVATION_AUTHORIZATION_SERVER,
  TENANT_GPT_ACTIVATION_OAUTH_CLIENT_ID,
  TENANT_GPT_ACTIVATION_RESOURCE,
  TENANT_GPT_AUTHORIZATION_SERVER,
  TENANT_GPT_CORE_RESOURCE,
} from "../tenantGptOAuthResourceProfile.js";
import {
  TENANT_GPT_IS_STAGING_RUNTIME,
  TENANT_GPT_OAUTH_CLIENT_ID,
  TENANT_GPT_SCOPE_LINKS,
} from "../tenantGptOAuthPreset.js";
import {
  buildRemoteMcpProtectedResourceMetadata,
  remoteMcpEnabled,
} from "../remoteMcpConnectorRuntime.js";
import {
  REMOTE_MCP_SUPPORTED_SCOPES,
  remoteMcpDynamicClientRegistrationAdvertised,
  remoteMcpOAuthEnabled,
  resolveRemoteMcpAuthorizationIssuer,
} from "../remoteMcpOAuthProfile.js";
import {
  resolveRemoteMcpConfiguredHost,
  resolveRemoteMcpEffectiveRequestHost,
} from "../remoteMcpRequestHost.js";
import {
  buildTenantGptOAuthTokenExchangeDeps,
  buildTenantGptOAuthTokenRequestBindingGuard,
} from "../tenantGptOAuthTokenExchangeBindingGuard.js";
import { buildTenantGptOAuthTokenExchangeRoutes } from "./tenantGptOAuthTokenExchangeRoutes.js";
import { tenantGptRefreshReady } from "../tenantGptOAuthGrantStore.js";
import { assertTrustedIngressReadyForProduction } from "../trustedIngressContract.js";
import { buildTenantGptOperationalReadiness } from "../tenantGptOperationalReadiness.js";

function resourceHost(resource) {
  try {
    return new URL(resource).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function tenantProtectedResourceMetadata(resource) {
  const authorizationServer = resource === TENANT_GPT_ACTIVATION_RESOURCE
    ? TENANT_GPT_ACTIVATION_AUTHORIZATION_SERVER
    : TENANT_GPT_AUTHORIZATION_SERVER;
  return {
    resource,
    authorization_servers: authorizationServer ? [authorizationServer] : [],
    scopes_supported: TENANT_GPT_SCOPE_LINKS,
    bearer_methods_supported: ["header"],
    ...(resource === TENANT_GPT_ACTIVATION_RESOURCE
      ? { resource_documentation: `${TENANT_GPT_ACTIVATION_RESOURCE}/tenant-gpt/activation-openapi` }
      : {}),
  };
}

function tenantAuthorizationServerMetadata(resource, { refreshReady, operationalReadiness, trustedIngress } = {}) {
  const isActivation = resource === TENANT_GPT_ACTIVATION_RESOURCE;
  const issuer = isActivation ? TENANT_GPT_ACTIVATION_AUTHORIZATION_SERVER : TENANT_GPT_AUTHORIZATION_SERVER;
  return {
    issuer,
    authorization_endpoint: `${issuer}/auth/oauth/authorize`,
    token_endpoint: `${issuer}/auth/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", ...(refreshReady?.ready ? ["refresh_token"] : [])],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
    scopes_supported: TENANT_GPT_SCOPE_LINKS,
    code_challenge_methods_supported: ["S256"],
    resource_parameter_supported: true,
    "x-mad4b-oauth-compatibility": {
      environment: TENANT_GPT_IS_STAGING_RUNTIME ? "staging" : "production",
      profile: isActivation ? "tenant_activation" : "tenant_core",
      resource,
      confidential_client_id: isActivation ? TENANT_GPT_ACTIVATION_OAUTH_CLIENT_ID : TENANT_GPT_OAUTH_CLIENT_ID,
      pkce_optional_only_for_confidential_client: true,
      client_secret_required_without_pkce: true,
      state_required: true,
      redirect_uri_exact_match_required: true,
    },
    refresh_ready: refreshReady?.ready === true,
    trusted_ingress: trustedIngress || null,
    operational_readiness: operationalReadiness || null,
    refresh_readiness: {
      enabled: refreshReady?.enabled === true,
      migration_present: refreshReady?.migration_present === true,
      indexes_present: refreshReady?.indexes_present === true,
      secret_ready: refreshReady?.secret_ready === true,
      transaction_probe_ready: refreshReady?.transaction_probe_ready === true,
      reason: refreshReady?.reason || null,
      secrets_included: false,
    },
  };
}

function remoteMcpAuthorizationServerMetadata(env) {
  const issuer = resolveRemoteMcpAuthorizationIssuer(env);
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    ...(remoteMcpDynamicClientRegistrationAdvertised(env)
      ? { registration_endpoint: `${issuer}/oauth/register` }
      : {}),
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [...REMOTE_MCP_SUPPORTED_SCOPES],
    resource_parameter_supported: true,
  };
}

function notFound(res, code) {
  return res.status(404).json({
    ok: false,
    error: { code, message: "Not found." },
    secrets_included: false,
  });
}

function trustedIngressOrError(res, env, req) {
  try {
    return { ok: true, readiness: assertTrustedIngressReadyForProduction(env, req) };
  } catch (error) {
    res.status(error.status || 503).json({
      ok: false,
      error: {
        code: error.code || "TRUSTED_INGRESS_ATTESTATION_REQUIRED",
        message: error.message,
      },
      trusted_ingress: error.details || null,
      secrets_included: false,
    });
    return { ok: false, readiness: error.details || null };
  }
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
  // discovery family. In Production it is served only through the explicitly
  // attested ingress and only on the canonical authorization-server host.
  router.use("/.well-known/oauth-authorization-server", (req, res, next) => {
    if (req.method !== "GET" || req.path !== "/auth/mcp") return next();
    if (!remoteMcpOAuthEnabled(env)) return notFound(res, "MCP_OAUTH_DISABLED");

    const trustedIngress = trustedIngressOrError(res, env, req);
    if (!trustedIngress.ok) return undefined;
    if (trustedIngress.readiness.production_like) {
      const requestHost = resolveRemoteMcpEffectiveRequestHost(req, env);
      const issuerHost = resourceHost(resolveRemoteMcpAuthorizationIssuer(env));
      if (!requestHost || !issuerHost || requestHost !== issuerHost) {
        return notFound(res, "MCP_AUTHORIZATION_SERVER_NOT_FOUND");
      }
    }

    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).json({
      ...remoteMcpAuthorizationServerMetadata(env),
      trusted_ingress: trustedIngress.readiness,
    });
  });

  // Authorization-server metadata is selected by the canonical request host.
  // It must never return the Tenant Core issuer for an Activation request.
  router.get("/.well-known/oauth-authorization-server", async (req, res) => {
    const trustedIngress = trustedIngressOrError(res, env, req);
    if (!trustedIngress.ok) return undefined;
    const requestHost = resolveRemoteMcpEffectiveRequestHost(req, env);
    const coreHost = resourceHost(TENANT_GPT_CORE_RESOURCE);
    const activationHost = resourceHost(TENANT_GPT_ACTIVATION_RESOURCE);
    const resource = requestHost === activationHost && TENANT_GPT_ACTIVATION_RESOURCE
      ? TENANT_GPT_ACTIVATION_RESOURCE
      : requestHost === coreHost
        ? TENANT_GPT_CORE_RESOURCE
        : "";
    if (!resource) return notFound(res, "TENANT_GPT_AUTHORIZATION_SERVER_NOT_FOUND");
    const pool = typeof deps.getPool === "function" ? deps.getPool() : null;
    const refreshReady = await tenantGptRefreshReady(env, pool);
    const operationalReadiness = await buildTenantGptOperationalReadiness({ env, pool });
    return res.status(200).json(tenantAuthorizationServerMetadata(resource, {
      refreshReady,
      operationalReadiness,
      trustedIngress: trustedIngress.readiness,
    }));
  });

  router.get("/.well-known/oauth-protected-resource", (req, res) => {
    const trustedIngress = trustedIngressOrError(res, env, req);
    if (!trustedIngress.ok) return undefined;
    const requestHost = resolveRemoteMcpEffectiveRequestHost(req, env);
    if (!requestHost) return notFound(res, "OAUTH_RESOURCE_NOT_FOUND");

    const mcpHost = resolveRemoteMcpConfiguredHost(env);
    if (mcpHost && requestHost === mcpHost) {
      if (!remoteMcpEnabled(env) && !remoteMcpOAuthEnabled(env)) return notFound(res, "MCP_DISABLED");
      res.setHeader("Cache-Control", "public, max-age=300");
      return res.status(200).json({
        ...buildRemoteMcpProtectedResourceMetadata(env),
        trusted_ingress: trustedIngress.readiness,
      });
    }

    if (requestHost === resourceHost(TENANT_GPT_CORE_RESOURCE)) {
      return res.status(200).json({
        ...tenantProtectedResourceMetadata(TENANT_GPT_CORE_RESOURCE),
        trusted_ingress: trustedIngress.readiness,
      });
    }

    if (requestHost === resourceHost(TENANT_GPT_ACTIVATION_RESOURCE)) {
      return res.status(200).json({
        ...tenantProtectedResourceMetadata(TENANT_GPT_ACTIVATION_RESOURCE),
        trusted_ingress: trustedIngress.readiness,
      });
    }

    return notFound(res, "OAUTH_RESOURCE_NOT_FOUND");
  });

  return router;
}
