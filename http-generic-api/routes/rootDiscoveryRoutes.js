import { Router } from "express";

const DEFAULT_SCOPE = {
  scope: "runtime",
  schema_file: "openapi.custom-gpt.runtime.yaml",
  primary_paths: [
    "/activation/session-context",
    "/activation/platform-access",
    "/http-execute",
    "/health",
    "/status"
  ]
};

const SCOPES_BY_HOST = {
  "api.mad4b.com": DEFAULT_SCOPE,
  "identity.mad4b.com": {
    scope: "identity",
    schema_file: "openapi.custom-gpt.identity.yaml",
    primary_paths: ["/users", "/plans", "/access/resolve", "/access/envelopes"]
  },
  "customers.mad4b.com": {
    scope: "customers",
    schema_file: "openapi.custom-gpt.customers.yaml",
    primary_paths: ["/customers", "/contacts", "/tickets", "/threads"]
  },
  "systems.mad4b.com": {
    scope: "systems",
    schema_file: "openapi.custom-gpt.systems.yaml",
    primary_paths: ["/connected-systems", "/workspaces", "/planner/resolve-intent", "/bootstrap/onboarding"]
  },
  "logic.mad4b.com": {
    scope: "logic",
    schema_file: "openapi.custom-gpt.logic.yaml",
    primary_paths: ["/logic-definitions", "/logic-packs", "/workflow-runs", "/approval-holds"]
  },
  "observability.mad4b.com": {
    scope: "observability",
    schema_file: "openapi.custom-gpt.observability.yaml",
    primary_paths: ["/telemetry/spans", "/usage/record", "/audit-log", "/incidents"]
  },
  "developer.mad4b.com": {
    scope: "developer",
    schema_file: "openapi.custom-gpt.developer.yaml",
    primary_paths: ["/developer-apps", "/webhooks", "/rate-limit-rules"]
  },
  "admin.mad4b.com": {
    scope: "admin-cli",
    schema_file: "openapi.custom-gpt.admin-cli.yaml",
    primary_paths: ["/admin/control"]
  },
  "auth.mad4b.com": {
    scope: "auth-dispatcher",
    schema_file: "openapi.custom-gpt.auth-dispatcher.yaml",
    primary_paths: ["/admin/control", "/admin/session-continuity/link-user"]
  },
  "ops.mad4b.com": {
    scope: "ops",
    schema_file: "openapi.custom-gpt.ops.yaml",
    primary_paths: ["/release/readiness", "/release/readiness-history", "/release/entity-classification"]
  },
  "status.mad4b.com": {
    scope: "status",
    schema_file: "openapi.custom-gpt.runtime.yaml",
    primary_paths: ["/status.html", "/status", "/status/incidents"]
  },
  "connector.mad4b.com": {
    scope: "connector",
    schema_file: "openapi.custom-gpt.connector.yaml",
    primary_paths: ["/health", "/github", "/gcloud", "/shell", "/files"]
  }
};

function requestHost(req) {
  return String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
}

export function buildRootDiscoveryRoutes() {
  const router = Router();

  router.all("/", (req, res) => {
    const host = requestHost(req);
    const scope = SCOPES_BY_HOST[host] || DEFAULT_SCOPE;

    return res.status(200).json({
      ok: true,
      service: "http_generic_api_connector",
      message: "Growth Intelligence Platform API root. Use a scoped OpenAPI path, not the root path, for actions.",
      host: host || null,
      scope: scope.scope,
      schema_file: scope.schema_file,
      primary_paths: scope.primary_paths,
      diagnostics: ["/health", "/status", "/privacy-policy"]
    });
  });

  return router;
}

export { SCOPES_BY_HOST };
