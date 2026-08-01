import { Router } from "express";
import {
  TENANT_GPT_ACTIVATION_RESOURCE,
  TENANT_GPT_AUTHORIZATION_SERVER,
  normalizeTenantGptRequestHost,
} from "../tenantGptOAuthResourceProfile.js";
import { TENANT_GPT_SCOPE_LINKS } from "../tenantGptOAuthPreset.js";
import {
  buildChatGptProtectedResourceMetadata,
  chatGptMcpEnabled,
  resolveChatGptMcpResource,
} from "../chatgptMcpRuntime.js";

function requestHost(req) {
  return normalizeTenantGptRequestHost(
    req.headers?.["x-original-host"]
      || req.headers?.["x-forwarded-host"]
      || req.headers?.host,
  );
}

function configuredMcpHost(env) {
  try {
    return new URL(resolveChatGptMcpResource(env)).host.toLowerCase();
  } catch {
    return "";
  }
}

export function buildTenantGptOAuthMetadataRoutes(deps = {}) {
  const router = Router();
  const env = deps.env || process.env;

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
      if (!chatGptMcpEnabled(env)) {
        return res.status(404).json({
          ok: false,
          error: { code: "MCP_DISABLED", message: "Not found." },
          secrets_included: false,
        });
      }
      res.setHeader("Cache-Control", "public, max-age=300");
      return res.status(200).json(buildChatGptProtectedResourceMetadata(env));
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
