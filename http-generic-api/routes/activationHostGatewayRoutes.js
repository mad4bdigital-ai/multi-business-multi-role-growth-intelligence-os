import { Router } from "express";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  "/auth/oauth",
  "/auth/google",
  "/auth/login",
  "/auth/register",
  ...ACTIVATION_SCHEMA_FILES_BY_PATH.keys(),
]);

const ALLOWED_PREFIXES = [
  "/activation/",
  "/tenant/activation/",
  "/auth/oauth/",
];

function requestHost(req) {
  return String(
    req.headers?.["x-forwarded-host"]
    || req.headers?.["x-original-host"]
    || req.headers?.["x-host"]
    || req.headers?.[":authority"]
    || req.headers?.host
    || "",
  )
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
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

function isActivationHostAllowedPath(pathname) {
  return ALLOWED_EXACT_PATHS.has(pathname)
    || ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isOAuthPath(pathname) {
  return pathname === "/auth/oauth" || pathname.startsWith("/auth/oauth/");
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

    const host = requestHost(req);
    if (!isActivationSchemaHost(host, activationHost)) return next();

    await serveActivationSchema(req, res, schemaFile);
    return undefined;
  });

  router.use((req, res, next) => {
    if (!enabled) return next();

    const host = requestHost(req);
    if (host !== activationHost) return next();

    const pathname = requestPath(req);

    // Activation transport must be bearer-token based and stateless. OAuth
    // authorization and token exchange stay exclusively on auth.mad4b.com.
    delete req.headers.cookie;

    if (isOAuthPath(pathname)) {
      req.activationHostGateway = {
        host,
        enforced: true,
        oauth_handoff: true,
        secrets_included: false,
      };
      return next();
    }

    if (!isActivationHostAllowedPath(pathname)) {
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
    return next();
  });

  return router;
}

export function activationHostGatewayAllowedPaths() {
  return {
    host: ACTIVATION_HOST_GATEWAY_HOST,
    exact_paths: [...ALLOWED_EXACT_PATHS],
    path_prefixes: [...ALLOWED_PREFIXES],
    schema_hosts: [ACTIVATION_HOST_GATEWAY_HOST, AUTH_HOST],
    oauth_host: AUTH_HOST,
    secrets_included: false,
  };
}
