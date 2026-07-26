import { Router } from "express";
import {
  TENANT_GPT_ACTIVATION_RESOURCE,
  TENANT_GPT_AUTHORIZATION_SERVER,
} from "../tenantGptOAuthResourceProfile.js";
import { TENANT_GPT_SCOPE_LINKS } from "../tenantGptOAuthPreset.js";

export function buildTenantGptOAuthMetadataRoutes() {
  const router = Router();

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

  router.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.status(200).json({
      resource: TENANT_GPT_ACTIVATION_RESOURCE,
      authorization_servers: [TENANT_GPT_AUTHORIZATION_SERVER],
      scopes_supported: TENANT_GPT_SCOPE_LINKS,
      bearer_methods_supported: ["header"],
      resource_documentation: "https://activation.mad4b.com/tenant-gpt/activation-openapi",
    });
  });

  return router;
}
