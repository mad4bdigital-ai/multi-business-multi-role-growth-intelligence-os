import { Router } from "express";

export function buildPlatformSmokeRoutes() {
  const router = Router();

  router.get("/platform/mock-crm/contacts", (_req, res) => {
    return res.status(200).json({
      ok: true,
      provider: "platform_mock_crm",
      resource: "contacts",
      mode: "smoke_read_only",
      contacts: [
        {
          id: "contact_smoke_001",
          name: "Smoke Test Contact",
          email_present: true,
          phone_present: false,
          lifecycle_stage: "test",
        },
      ],
      count: 1,
      will_mutate: false,
      secrets_included: false,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
