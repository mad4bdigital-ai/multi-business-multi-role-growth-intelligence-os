import { Router } from "express";
import {
  buildChatGptProtectedResourceMetadata,
  chatGptMcpEnabled,
  handleChatGptMcpRequest,
} from "../chatgptMcpRuntime.js";

function applyResponseHeaders(res, headers = {}) {
  for (const [name, value] of Object.entries(headers)) {
    if (value == null) continue;
    res.setHeader(name, String(value));
  }
}

export function buildChatGptMcpRoutes(deps = {}) {
  const router = Router();
  const env = deps.env || process.env;

  router.get("/.well-known/oauth-protected-resource", (req, res) => {
    if (!chatGptMcpEnabled(env)) {
      return res.status(404).json({
        ok: false,
        error: { code: "MCP_DISABLED", message: "Not found." },
        secrets_included: false,
      });
    }

    res.setHeader("Cache-Control", "public, max-age=300");
    return res.json(buildChatGptProtectedResourceMetadata(env));
  });

  router.get("/mcp", async (req, res) => {
    const result = await handleChatGptMcpRequest({
      method: "GET",
      headers: req.headers,
      env,
      pool: deps.pool || deps.getPool?.(),
      verifyAuthorization: deps.verifyUserJwtAuthorization,
    });
    applyResponseHeaders(res, result.headers);
    if (result.body == null) return res.status(result.status).end();
    return res.status(result.status).json(result.body);
  });

  router.post("/mcp", async (req, res) => {
    const result = await handleChatGptMcpRequest({
      body: req.body,
      method: "POST",
      headers: req.headers,
      env,
      pool: deps.pool || deps.getPool?.(),
      verifyAuthorization: deps.verifyUserJwtAuthorization,
    });
    applyResponseHeaders(res, result.headers);
    if (result.body == null) return res.status(result.status).end();
    return res.status(result.status).json(result.body);
  });

  return router;
}
