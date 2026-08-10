import { Router } from "express";
import { handleRemoteMcpConnectorRequest } from "../remoteMcpConnectorRuntime.js";
import {
  remoteMcpRequestUsesCanonicalHost,
} from "../remoteMcpRequestHost.js";

function applyResponseHeaders(res, headers = {}) {
  for (const [name, value] of Object.entries(headers)) {
    if (value == null) continue;
    res.setHeader(name, String(value));
  }
}

function enforceCanonicalRemoteMcpHost(req, res, env) {
  if (remoteMcpRequestUsesCanonicalHost(req, env)) return true;
  res.status(404).json({
    ok: false,
    error: {
      code: "MCP_RESOURCE_NOT_FOUND",
      message: "Not found.",
    },
    secrets_included: false,
  });
  return false;
}

export function buildRemoteMcpConnectorRoutes(deps = {}) {
  const router = Router();
  const env = deps.env || process.env;

  // Protected-resource metadata is served by the host-aware public metadata
  // router mounted before this router. Keeping one metadata owner prevents the
  // existing Activation resource contract from shadowing the remote MCP resource.
  // The MCP transport itself independently enforces the exact configured
  // resource host so another virtual host cannot accidentally expose /mcp.
  router.get("/mcp", async (req, res) => {
    if (!enforceCanonicalRemoteMcpHost(req, res, env)) return;
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
    if (!enforceCanonicalRemoteMcpHost(req, res, env)) return;
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
