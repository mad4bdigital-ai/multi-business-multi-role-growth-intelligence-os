import { Router } from "express";

const MOCK_PROVIDER_REGISTRY = Object.freeze({
  crm: Object.freeze({
    provider: "platform_mock_crm",
    display_name: "Platform Mock CRM",
    resources: Object.freeze({
      contacts: Object.freeze({
        resource: "contacts",
        method: "GET",
        mode: "smoke_read_only",
        description: "Deterministic non-sensitive CRM contacts list for guarded provider smoke tests.",
        sample: Object.freeze({
          contacts: [
            Object.freeze({
              id: "contact_smoke_001",
              name: "Smoke Test Contact",
              email_present: true,
              phone_present: false,
              lifecycle_stage: "test",
            }),
          ],
          count: 1,
        }),
      }),
    }),
  }),
  analytics: Object.freeze({
    provider: "platform_mock_analytics",
    display_name: "Platform Mock Analytics",
    resources: Object.freeze({
      summary: Object.freeze({
        resource: "summary",
        method: "GET",
        mode: "smoke_read_only",
        description: "Deterministic non-sensitive analytics summary for guarded provider smoke tests.",
        sample: Object.freeze({
          metrics: {
            sessions: 123,
            conversions: 4,
            conversion_rate_percent: 3.25,
          },
          count: 3,
        }),
      }),
    }),
  }),
});

function timestamp() {
  return new Date().toISOString();
}

function registrySummary() {
  return Object.entries(MOCK_PROVIDER_REGISTRY).map(([provider_key, provider]) => ({
    provider_key,
    provider: provider.provider,
    display_name: provider.display_name,
    resources: Object.entries(provider.resources).map(([resource_key, resource]) => ({
      resource_key,
      resource: resource.resource,
      method: resource.method,
      mode: resource.mode,
      description: resource.description,
      path: `/platform/mock-providers/${provider_key}/${resource_key}`,
      will_mutate: false,
      secrets_included: false,
    })),
    will_mutate: false,
    secrets_included: false,
  }));
}

function buildSmokePayload(providerKey, resourceKey) {
  const provider = MOCK_PROVIDER_REGISTRY[providerKey];
  const resource = provider?.resources?.[resourceKey];
  if (!provider || !resource) return null;
  return {
    ok: true,
    provider: provider.provider,
    provider_key: providerKey,
    resource: resource.resource,
    resource_key: resourceKey,
    mode: resource.mode,
    ...resource.sample,
    will_mutate: false,
    secrets_included: false,
    timestamp: timestamp(),
  };
}

export function buildPlatformSmokeRoutes() {
  const router = Router();

  router.get("/platform/mock-providers", (_req, res) => {
    return res.status(200).json({
      ok: true,
      mode: "smoke_provider_registry",
      providers: registrySummary(),
      count: Object.keys(MOCK_PROVIDER_REGISTRY).length,
      will_mutate: false,
      secrets_included: false,
      timestamp: timestamp(),
    });
  });

  router.get("/platform/mock-providers/:provider/:resource", (req, res) => {
    const providerKey = String(req.params.provider || "").trim().toLowerCase();
    const resourceKey = String(req.params.resource || "").trim().toLowerCase();
    const payload = buildSmokePayload(providerKey, resourceKey);
    if (!payload) {
      return res.status(404).json({
        ok: false,
        error: {
          code: "mock_provider_resource_not_found",
          message: "Requested mock provider resource is not registered.",
          provider_key: providerKey || null,
          resource_key: resourceKey || null,
        },
        available: registrySummary(),
        will_mutate: false,
        secrets_included: false,
        timestamp: timestamp(),
      });
    }
    return res.status(200).json(payload);
  });

  router.get("/platform/mock-crm/contacts", (_req, res) => {
    return res.status(200).json(buildSmokePayload("crm", "contacts"));
  });

  return router;
}
