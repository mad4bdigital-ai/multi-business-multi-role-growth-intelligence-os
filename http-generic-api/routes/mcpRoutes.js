import { Router } from "express";
import { buildMcpHandlers } from "../mcpRuntime.js";
import { remoteMcpOAuthEnabled } from "../remoteMcpOAuthProfile.js";
import { wordpressStagingMcpOAuthConfigured } from "../wordpressStagingMcpOAuthProfile.js";
import { buildRemoteMcpConnectorRoutes } from "./remoteMcpConnectorRoutes.js";
import { buildRemoteMcpOAuthRoutes } from "./remoteMcpOAuthRoutes.js";
import { buildWordpressStagingMcpOAuthRoutes } from "./wordpressStagingMcpOAuthRoutes.js";

export function buildMcpRoutes(deps) {
  const {
    requireMcpToken,
    requireMcpAcceptHeader,
  } = deps;
  const env = deps.env || process.env;

  // Build live handlers with deps (callModel, getCallModelForClass, getPool, etc.)
  const { mcpInitialize, mcpToolsList, mcpToolsCall } = buildMcpHandlers(deps);

  const router = Router();

  // OAuth 2.1 authorization, dynamic client registration, refresh, and
  // revocation endpoints for the shared remote MCP resource. Do not construct
  // the database-backed router while OAuth is disabled: startup and /version
  // must remain available in dependency-light environments, and disabled
  // endpoints still fail closed through the platform 404 boundary.
  if (remoteMcpOAuthEnabled(env)) {
    router.use(buildRemoteMcpOAuthRoutes(deps));
  }

  // Staging-only WordPress federation is a separate path-scoped issuer on the
  // same authorization service. The dedicated router resolves its own DCR
  // authority from REMOTE_MCP_WORDPRESS_STAGING_DCR_ENABLED so the primary
  // Remote MCP issuer and WordPress issuer cannot inherit each other's switch.
  if (wordpressStagingMcpOAuthConfigured(env)) {
    router.use(buildWordpressStagingMcpOAuthRoutes({ ...deps, env }));
  }

  // Standards-oriented remote MCP surface for ChatGPT, Claude, Codex, and
  // other approved conforming clients. It is disabled by default and remains
  // isolated from the legacy query-token routes below.
  router.use(buildRemoteMcpConnectorRoutes(deps));

  // Legacy MCP-labelled compatibility routes. Their auth and transport
  // semantics are intentionally unchanged until consumer inventory and
  // deprecation evidence are complete.
  router.post("/mcp/initialize", requireMcpToken, requireMcpAcceptHeader, mcpInitialize);
  router.get("/mcp/tools/list", requireMcpToken, requireMcpAcceptHeader, mcpToolsList);
  router.post("/mcp/tools/call", requireMcpToken, requireMcpAcceptHeader, mcpToolsCall);

  return router;
}
