import { Router } from "express";
import {
  createCapabilityEnvelopeFromTemplate,
  getCapabilityEnvelopeTemplate,
  listCapabilityEnvelopeTemplates,
  resolveCapabilityEnvelopeTemplate,
} from "../capabilityEnvelopeTemplateResolver.js";

function sendError(res, error) {
  return res.status(Number(error?.status) || 500).json({
    error: {
      code: error?.code || "capability_envelope_template_internal_error",
      message: error?.message || "Capability envelope template request failed.",
      details: error?.details || undefined,
      requestId: res.getHeader?.("x-request-id") || undefined,
    },
  });
}

export function buildCapabilityEnvelopeTemplateRoutes({
  requireBackendApiKey,
  requireAdminPrincipal,
  resolveRequestedBy,
}) {
  const router = Router();
  const guards = [requireBackendApiKey, requireAdminPrincipal].filter(Boolean);

  router.get("/admin/capability-envelope-templates", ...guards, async (req, res) => {
    try {
      return res.status(200).json(await listCapabilityEnvelopeTemplates({
        limit: req.query.limit,
        cursor: req.query.cursor,
      }));
    } catch (error) { return sendError(res, error); }
  });

  router.get("/admin/capability-envelope-templates/:templateKey", ...guards, async (req, res) => {
    try { return res.status(200).json(await getCapabilityEnvelopeTemplate(req.params.templateKey)); }
    catch (error) { return sendError(res, error); }
  });

  router.post("/admin/capability-envelope-templates/:templateKey/resolve", ...guards, async (req, res) => {
    try {
      return res.status(200).json(await resolveCapabilityEnvelopeTemplate({
        ...(req.body || {}),
        template_key: req.params.templateKey,
      }));
    } catch (error) { return sendError(res, error); }
  });

  router.post("/admin/capability-envelope-templates/:templateKey/envelopes", ...guards, async (req, res) => {
    try {
      const requestedBy = resolveRequestedBy?.(req) || "gpt_admin";
      return res.status(201).json(await createCapabilityEnvelopeFromTemplate({
        ...(req.body || {}),
        template_key: req.params.templateKey,
        requested_by: requestedBy,
      }));
    } catch (error) { return sendError(res, error); }
  });

  return router;
}
