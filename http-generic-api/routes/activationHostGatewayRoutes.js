import { Router } from "express";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requireActivationTenantGptAccessToken } from "../tenantGptAccessTokenVerifier.js";

export const ACTIVATION_HOST_GATEWAY_HOST = "activation.mad4b.com";
const AUTH_HOST = "auth.mad4b.com";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_ROOT_DIR = resolve(__dirname, "..");
const SCHEMA_ARTIFACT_DIR = resolve(SCHEMA_ROOT_DIR, "openapi");

const ACTIVATION_SCHEMA_FILES_BY_PATH = new Map([
  ["/openapi.tenant-gpt.activation.yaml", "openapi.tenant-gpt.activation.yaml"],
  ["/tenant-gpt/activation-openapi", "openapi.tenant-gpt.activation.yaml"],
  ["/openapi.custom-gpt.activation-admin.yaml", "openapi.custom-gpt.activation-admin.yaml"],
  ["/admin-gpt/activation-openapi", "openapi.custom-gpt.activation-admin.yaml"],
]);

const ALLOWED_EXACT_PATHS = new Set([
  "/",
  "/health",
  "/privacy-policy",
  "/status",
  "/tenant-gpt/oauth-preset",
  "/terms-of-use",
  ...ACTIVATION_SCHEMA_FILES_BY_PATH.keys(),
]);

const ALLOWED_PREFIXES = [
  "/activation/",
  "/tenant/activation/",
];

const ALLOWED_TENANT_RESOLUTION_ROUTES = [
  { methods: new Set(["GET"]), pattern: /^\/tenant\/resolution\/problem-cards$/ },
  { methods: new Set(["GET", "POST"]), pattern: /^\/tenant\/resolution\/cases$/ },
  { methods: new Set(["GET"]), pattern: /^\/tenant\/resolution\/cases\/[^/]+$/ },
  { methods: new Set(["POST"]), pattern: /^\/tenant\/resolution\/cases\/[^/]+\/(?:transitions|diagnostics)$/ },
  { methods: new Set(["POST"]), pattern: /^\/tenant\/resolution\/cases\/[^/]+\/task-source-repair\/(?:preview|apply|verify)$/ },
];

const TENANT_GPT_OAUTH_HANDOFF_ROUTES = new Map([
  ["GET /auth/oauth/authorize", { operation_id: "tenantGptOAuthAuthorize" }],
  ["POST /auth/oauth/code", { operation_id: "tenantGptOAuthCode" }],
  ["POST /auth/oauth/token", { operation_id: "tenantGptOAuthToken" }],
]);

function normalizedRequestHost(value) {
  return String(value || "")
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
}

function requestHost(req, preferredHost = "") {
  const candidates = [
    req.headers?.["x-forwarded-host"],
    req.headers?.["x-original-host"],
    req.headers?.["x-host"],
    req.headers?.[":authority"],
    req.headers?.host,
  ].map(normalizedRequestHost).filter(Boolean);
  const preferred = normalizedRequestHost(preferredHost);
  return (preferred && candidates.includes(preferred)) ? preferred : (candidates[0] || "");
}

function requestPath(req) {
  const rawPath = String(req.path || req.url || "/").split("?")[0].trim() || "/";
  return rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
}

function requestId(req) {
  return String(req.headers?.["x-request-id"] || req.headers?.["cf-ray"] || "")
    .split(",")[0]
    .trim()
    .slice(0, 128) || null;
}

async function readActivationSchemaFile(schemaFile) {
  try {
    return await readFile(resolve(SCHEMA_ARTIFACT_DIR, schemaFile), "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return readFile(resolve(SCHEMA_ROOT_DIR, schemaFile), "utf8");
  }
}

function errorResponse(code, message, req) {
  return {
    ok: false,
    error: {
      code,
      message,
      requestId: requestId(req),
    },
    secrets_included: false,
  };
}

function isActivationSchemaHost(host, activationHost) {
  return host === activationHost || host === AUTH_HOST;
}

function isActivationHostAllowedPath(pathname, method) {
  return ALLOWED_EXACT_PATHS.has(pathname)
    || ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
    || ALLOWED_TENANT_RESOLUTION_ROUTES.some((route) =>
      route.methods.has(String(method || "").toUpperCase()) && route.pattern.test(pathname));
}

function isTenantGptProtectedPath(pathname, method) {
  return pathname.startsWith("/tenant/activation/")
    || ALLOWED_TENANT_RESOLUTION_ROUTES.some((route) =>
      route.methods.has(String(method || "").toUpperCase()) && route.pattern.test(pathname));
}

export function activationHostGatewayAllowsOperation(method, pathname) {
  return isActivationHostAllowedPath(pathname, method);
}

function routeKey(method, pathname) {
  return `${String(method || "").toUpperCase()} ${pathname}`;
}

function tenantGptOAuthHandoff(method, pathname) {
  return TENANT_GPT_OAUTH_HANDOFF_ROUTES.get(routeKey(method, pathname)) || null;
}

function isAuthPath(pathname) {
  return pathname === "/auth" || pathname.startsWith("/auth/");
}

export function buildActivationHostGatewayRoutes({
  activationHost = ACTIVATION_HOST_GATEWAY_HOST,
  enabled = true,
} = {}) {
  const router = Router();

  async function serveActivationSchema(req, res, schemaFile) {
    delete req.headers.cookie;

    try {
      const schema = await readActivationSchemaFile(schemaFile);
      res
        .status(200)
        .type("application/yaml")
        .set("Cache-Control", "public, max-age=300")
        .send(schema);
    } catch {
      res.status(404).json(errorResponse(
        "schema_file_missing",
        "The advertised Activation OpenAPI schema file is not available.",
        req,
      ));
    }
  }

  router.use(async (req, res, next) => {
    if (!enabled || !["GET", "HEAD"].includes(req.method)) return next();

    const pathname = requestPath(req);
    const schemaFile = ACTIVATION_SCHEMA_FILES_BY_PATH.get(pathname);
    if (!schemaFile) return next();

    const host = requestHost(req, activationHost);
    if (!isActivationSchemaHost(host, activationHost)) return next();

    await serveActivationSchema(req, res, schemaFile);
    return undefined;
  });

  router.use((req, res, next) => {
    if (!enabled) return next();

    const host = requestHost(req, activationHost);
    if (host !== activationHost) return next();

    const pathname = requestPath(req);

    // Activation transport remains bearer-token based and stateless. Only the
    // three Tenant GPT OAuth handoff operations may enter the shared authRoutes
    // router on this host. Login, registration, admin, and every other auth
    // route remain unavailable through activation.mad4b.com.
    const oauthHandoff = tenantGptOAuthHandoff(req.method, pathname);
    if (oauthHandoff) {
      // Cookie forwarding is limited to the browser-facing authorize/code handoff.
      // The token endpoint and every non-handoff route remain cookie-free.
      if (routeKey(req.method, pathname) === "POST /auth/oauth/token") delete req.headers.cookie;
      req.activationHostGateway = {
        host,
        enforced: true,
        tenant_gpt_oauth_handoff: true,
        operation_id: oauthHandoff.operation_id,
        secrets_included: false,
      };
      return next();
    }

    delete req.headers.cookie;

    if (isAuthPath(pathname) || !isActivationHostAllowedPath(pathname, req.method)) {
      return res.status(404).json(errorResponse(
        "ACTIVATION_HOST_ROUTE_NOT_ALLOWED",
        "This host only serves Activation transport routes and Activation OpenAPI schemas.",
        req,
      ));
    }

    req.activationHostGateway = {
      host,
      enforced: true,
      secrets_included: false,
    };

    if (isTenantGptProtectedPath(pathname, req.method)) {
      return requireActivationTenantGptAccessToken(req, res, next);
    }

    return next();
  });

  return router;
}

export function activationHostGatewayAllowedPaths() {
  return {
    host: ACTIVATION_HOST_GATEWAY_HOST,
    exact_paths: [...ALLOWED_EXACT_PATHS],
    path_prefixes: [...ALLOWED_PREFIXES],
    tenant_gpt_oauth_routes: [...TENANT_GPT_OAUTH_HANDOFF_ROUTES.entries()].map(([key, value]) => {
      const splitAt = key.indexOf(" ");
      return {
        method: key.slice(0, splitAt),
        path: key.slice(splitAt + 1),
        operation_id: value.operation_id,
      };
    }),
    schema_hosts: [ACTIVATION_HOST_GATEWAY_HOST, AUTH_HOST],
    oauth_host: ACTIVATION_HOST_GATEWAY_HOST,
    oauth_upstream_host: AUTH_HOST,
    secrets_included: false,
  };
}
