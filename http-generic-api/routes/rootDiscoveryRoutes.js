import { Router } from "express";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTenantGptOAuthPreset } from "../tenantGptOAuthPreset.js";
import { resolveTenantGptOAuthClientConfig } from "../tenantGptOAuthClientConfig.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = resolve(__dirname, "..");

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
  "dev.mad4b.com": {
    scope: "development",
    schema_file: "openapi.gpt-action.dev-diagnostics.yaml",
    primary_paths: ["/health", "/deployment-info", "/dev/db/status"]
  },
  "admin.mad4b.com": {
    scope: "admin-cli",
    schema_file: "openapi.custom-gpt.admin-cli.yaml",
    primary_paths: ["/admin/control"]
  },
  "auth.mad4b.com": {
    scope: "auth-tenant",
    schema_file: "openapi.tenant-gpt.auth.yaml",
    primary_paths: ["/connect/status", "/connect/activate", "/connect/device-install"],
    schema_variants: {
      tenant: "openapi.tenant-gpt.auth.yaml",
      admin: "openapi.custom-gpt.auth-dispatcher.yaml"
    }
  },
  "ops.mad4b.com": {
    scope: "ops",
    schema_file: "openapi.custom-gpt.ops.yaml",
    primary_paths: ["/release/readiness", "/release/session-archive-smoke", "/release/readiness-history", "/release/entity-classification"]
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

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function schemaFilesForScope(scope) {
  return unique([
    scope.schema_file,
    ...Object.values(scope.schema_variants || {})
  ]);
}

function requestHost(req) {
  return String(req.headers["x-forwarded-host"] || req.headers.host || "")
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
}

export function buildRootDiscoveryRoutes() {
  const router = Router();

  router.get("/:schemaFile(openapi.*.yaml)", async (req, res) => {
    const host = requestHost(req);
    const scope = SCOPES_BY_HOST[host] || DEFAULT_SCOPE;
    const requestedFile = String(req.params.schemaFile || "").trim();
    const allowedSchemaFiles = schemaFilesForScope(scope);

    if (!allowedSchemaFiles.includes(requestedFile)) {
      return res.status(404).json({
        ok: false,
        error: {
          code: "schema_not_found",
          message: "No public OpenAPI schema is available for this host and file."
        }
      });
    }

    try {
      const schema = await readFile(resolve(SCHEMA_DIR, requestedFile), "utf8");
      return res
        .status(200)
        .type("application/yaml")
        .set("Cache-Control", "public, max-age=300")
        .send(schema);
    } catch {
      return res.status(404).json({
        ok: false,
        error: {
          code: "schema_file_missing",
          message: "The advertised OpenAPI schema file is not available."
        }
      });
    }
  });

  router.get("/tenant-gpt/oauth-preset", async (req, res) => {
    const host = requestHost(req);
    if (host !== "auth.mad4b.com") {
      return res.status(404).json({
        ok: false,
        error: {
          code: "preset_not_found",
          message: "No tenant GPT OAuth preset is available for this host."
        }
      });
    }

    const clientConfig = await resolveTenantGptOAuthClientConfig();
    const callbackUrlsToAllow = Array.isArray(clientConfig.config?.callback_urls_to_allow)
      ? clientConfig.config.callback_urls_to_allow
      : undefined;

    return res.status(200).json({
      ok: true,
      source: clientConfig.source,
      preset: buildTenantGptOAuthPreset({ callbackUrlsToAllow }),
    });
  });

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
      schema_variants: scope.schema_variants || undefined,
      primary_paths: scope.primary_paths,
      diagnostics: ["/health", "/status", "/privacy-policy"]
    });
  });

  return router;
}

export { SCOPES_BY_HOST };
