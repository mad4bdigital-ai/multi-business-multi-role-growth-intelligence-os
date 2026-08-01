import { Router } from "express";
import { buildMcpHandlers } from "../mcpRuntime.js";
import { buildRemoteMcpConnectorRoutes } from "./remoteMcpConnectorRoutes.js";
import { buildRemoteMcpOAuthRoutes } from "./remoteMcpOAuthRoutes.js";

export function buildMcpRoutes(deps) {
  const {
    requireMcpToken,
    requireMcpAcceptHeader,
  } = deps;

  // Build live handlers with deps (callModel, getCallModelForClass, getPool, etc.)
  const { mcpInitialize, mcpToolsList, mcpToolsCall } = buildMcpHandlers(deps);

  const router = Router();

  // OAuth 2.1 authorization, dynamic client registration, refresh, and
  // revocation endpoints for the shared remote MCP resource. All endpoints
  // remain disabled until REMOTE_MCP_OAUTH_ENABLED is explicitly set.
  router.use(buildRemoteMcpOAuthRoutes(deps));

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
