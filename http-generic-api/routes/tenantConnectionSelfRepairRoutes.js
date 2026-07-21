import { Router } from "express";
import { TENANT_CONNECTION_SELF_REPAIR_ROUTE_CONTRACTS } from "../tenantConnectionSelfRepairService.js";

function expressPath(contractPath = "") {
  return String(contractPath).replace("{connection_id}", ":connection_id");
}

function disabledEnvelope(toolKey) {
  return {
    ok: false,
    error: {
      code: "tenant_connection_self_repair_capability_disabled",
      message: "This tenant connection self-repair capability is not enabled.",
      details: { tool_key: toolKey, rollout_mode: "catalog_disabled", retryable: false },
    },
    secrets_included: false,
  };
}

export function buildTenantConnectionSelfRepairRoutes(deps = {}) {
  const router = Router();
  const pool = deps.pool;
  if (!pool || typeof pool.query !== "function") {
    throw new Error("tenant_connection_self_repair_pool_required");
  }

  for (const contract of TENANT_CONNECTION_SELF_REPAIR_ROUTE_CONTRACTS) {
    const method = String(contract.method || "GET").toLowerCase();
    const path = expressPath(contract.path);
    if (typeof router[method] !== "function") {
      throw new Error(`tenant_connection_self_repair_method_unsupported:${contract.method}`);
    }

    router[method](path, async (req, res, next) => {
      try {
        const [toolRows] = await pool.query(
          `SELECT tool_key, is_enabled
             FROM \`tenant_platform_endpoint_tools\`
            WHERE tool_key = ?
            LIMIT 1`,
          [contract.tool_key]
        );
        const tool = toolRows?.[0] || null;

        if (!tool || Number(tool.is_enabled || 0) !== 1) {
          return res.status(503).json(disabledEnvelope(contract.tool_key));
        }

        const [connectionRows] = await pool.query(
          `SELECT connection_id, app_key, auth_type, status, validation_status
             FROM \`user_app_connections\`
            WHERE connection_id = ?
              AND user_id = ?
              AND tenant_id = ?
              AND status <> 'revoked'
            LIMIT 1`,
          [req.params.connection_id, req.auth?.user_id, req.auth?.tenant_id]
        );
        const connection = connectionRows?.[0] || null;
        if (!connection) {
          return res.status(404).json({
            ok: false,
            error: {
              code: "tenant_connection_not_found",
              message: "Connection was not found for the authenticated tenant user.",
            },
            secrets_included: false,
          });
        }

        return res.status(501).json({
          ok: false,
          error: {
            code: "tenant_connection_self_repair_handler_not_implemented",
            message: "The capability route is registered but its governed handler is not activated.",
            details: {
              tool_key: contract.tool_key,
              connection_id: connection.connection_id,
              provider_write_performed: false,
            },
          },
          secrets_included: false,
        });
      } catch (err) {
        next(err);
      }
    });
  }

  router.use("/me/connections", (err, _req, res, _next) => {
    const status = Number(err?.status || err?.statusCode || 500);
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      ok: false,
      error: {
        code: err?.code || "tenant_connection_self_repair_route_failed",
        message: err?.message || "Tenant connection self-repair route failed.",
      },
      secrets_included: false,
    });
  });

  return router;
}
