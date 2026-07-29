import { Router } from "express";
import {
  applyTargetAuthEmailDelivery,
  listAuthEmailDeliveryAttempts,
  previewTargetAuthEmailDelivery,
} from "../authEmailTargetedDeliveryWorker.js";

function sendError(res, error, fallbackCode) {
  const status = Number(error?.status || 500);
  return res.status(status).json({
    error: {
      code: error?.code || fallbackCode,
      message:
        status >= 500
          ? "The requested auth email delivery operation failed."
          : String(error?.message || "Request failed."),
      details: error?.details || null,
    },
    secrets_included: false,
  });
}

export function buildAuthEmailTargetedDeliveryRoutes(deps = {}) {
  const { requireBackendApiKey, requireAdminPrincipal } = deps;
  const router = Router();
  const adminGuards = [requireBackendApiKey, requireAdminPrincipal].filter(Boolean);

  router.get("/admin/support/tickets/auth-email-outbox/attempts", ...adminGuards, async (req, res) => {
    try {
      const result = await listAuthEmailDeliveryAttempts({
        emailId: req.query?.email_id || "",
        limit: req.query?.limit || 20,
      });
      return res.status(200).json({
        ...result,
        resource_authority: "auth_email_delivery_attempts",
        secrets_included: false,
      });
    } catch (error) {
      return sendError(res, error, "auth_email_delivery_attempts_read_failed");
    }
  });

  router.post(
    "/admin/support/tickets/auth-email-outbox/targeted-dry-run",
    ...adminGuards,
    async (req, res) => {
      try {
        const result = await previewTargetAuthEmailDelivery({ emailId: req.body?.email_id || "" });
        return res.status(200).json({
          ...result,
          resource_authority: "auth_email_outbox",
          secrets_included: false,
        });
      } catch (error) {
        return sendError(res, error, "auth_email_outbox_targeted_dry_run_failed");
      }
    },
  );

  router.post(
    "/admin/support/tickets/auth-email-outbox/targeted-apply",
    ...adminGuards,
    async (req, res) => {
      try {
        const result = await applyTargetAuthEmailDelivery({
          emailId: req.body?.email_id || "",
          confirm: req.body?.confirm || "",
          senderConnectionId: req.body?.sender_connection_id || "",
        });
        return res.status(result.ok ? 200 : 502).json({
          ...result,
          resource_authority: "auth_email_outbox",
          secrets_included: false,
        });
      } catch (error) {
        return sendError(res, error, "auth_email_outbox_targeted_apply_failed");
      }
    },
  );

  return router;
}
