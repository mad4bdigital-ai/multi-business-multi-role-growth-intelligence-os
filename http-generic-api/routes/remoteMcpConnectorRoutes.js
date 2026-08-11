import { Router } from "express";
import { handleRemoteMcpConnectorRequest } from "../remoteMcpConnectorRuntime.js";

function applyResponseHeaders(res, headers = {}) {
  for (const [name, value] of Object.entries(headers)) {
    if (value == null) continue;
    res.setHeader(name, String(value));
  }
}

export function buildRemoteMcpConnectorRoutes(deps = {}) {
  const router = Router();
  const env = deps.env || process.env;

  // Protected-resource metadata is served by the host-aware public metadata
  // router mounted before this router. Keeping one metadata owner prevents the
  // existing Activation resource contract from shadowing the remote MCP resource.
  router.get("/mcp", async (req, res) => {
    const result = await handleRemoteMcpConnectorRequest({
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
    const result = await handleRemoteMcpConnectorRequest({
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
