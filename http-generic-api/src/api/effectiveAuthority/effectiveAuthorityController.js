import { randomUUID } from "node:crypto";
import { CONNECTOR_INVENTORY_CAPABILITY_KEY } from "../../domain/effectiveAuthority/effectiveAuthority.js";

function requestId(req) {
  return String(req?.requestId || req?.headers?.["x-request-id"] || "").trim() || randomUUID();
}

function detailsArray(details) {
  if (!details) return [];
  return Array.isArray(details) ? details : [details];
}

function sendError(res, req, error) {
  const status = Number(error?.status || 500);
  return res.status(status >= 400 && status <= 599 ? status : 500).json({
    ok: false,
    error: {
      code: String(error?.code || "EFFECTIVE_AUTHORITY_FAILED"),
      message:
        status >= 500
          ? "Effective authority resolution is temporarily unavailable."
          : String(error?.message || "Effective authority request failed."),
      details: detailsArray(error?.details),
      requestId: requestId(req),
    },
    secrets_included: false,
  });
}

function assertAllowedKeys(value, allowed, location) {
  for (const key of Object.keys(value || {})) {
    if (!allowed.has(key)) {
      const error = new Error(`Unsupported ${location} field: ${key}.`);
      error.code = "AUTHORITY_UNSUPPORTED_FIELD";
      error.status = 400;
      error.details = { field: key, location };
      throw error;
    }
  }
}

function clean(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export function createEffectiveAuthorityController({ service }) {
  if (
    !service ||
    typeof service.resolveDecision !== "function" ||
    typeof service.listConnectorProjection !== "function"
  ) {
    throw new TypeError("Effective authority controller requires a service.");
  }

  async function listAdminConnectors(req, res) {
    try {
      assertAllowedKeys(req.query, new Set(["tenantId", "limit", "cursor"]), "query");
      const result = await service.listConnectorProjection({
        auth: req.auth,
        tenantId: clean(req.query?.tenantId),
        limit: req.query?.limit,
        cursor: clean(req.query?.cursor),
      });
      return res.status(200).json({ ok: true, ...result, secrets_included: false });
    } catch (error) {
      return sendError(res, req, error);
    }
  }

  async function listTenantConnectors(req, res) {
    try {
      assertAllowedKeys(req.query, new Set(["limit", "cursor"]), "query");
      const result = await service.listConnectorProjection({
        auth: req.auth,
        tenantId: req.auth?.tenant_id,
        limit: req.query?.limit,
        cursor: clean(req.query?.cursor),
      });
      return res.status(200).json({ ok: true, ...result, secrets_included: false });
    } catch (error) {
      return sendError(res, req, error);
    }
  }

  async function resolveAdminDecision(req, res) {
    try {
      assertAllowedKeys(req.body, new Set(["capabilityKey", "tenantId"]), "body");
      const result = await service.resolveDecision({
        auth: req.auth,
        tenantId: clean(req.body?.tenantId),
        capabilityKey: clean(req.body?.capabilityKey) || CONNECTOR_INVENTORY_CAPABILITY_KEY,
      });
      return res.status(200).json({ ok: true, ...result, secrets_included: false });
    } catch (error) {
      return sendError(res, req, error);
    }
  }

  async function resolveTenantDecision(req, res) {
    try {
      assertAllowedKeys(req.body, new Set(["capabilityKey"]), "body");
      const result = await service.resolveDecision({
        auth: req.auth,
        tenantId: req.auth?.tenant_id,
        capabilityKey: clean(req.body?.capabilityKey) || CONNECTOR_INVENTORY_CAPABILITY_KEY,
      });
      return res.status(200).json({ ok: true, ...result, secrets_included: false });
    } catch (error) {
      return sendError(res, req, error);
    }
  }

  return Object.freeze({
    listAdminConnectors,
    listTenantConnectors,
    resolveAdminDecision,
    resolveTenantDecision,
  });
}
