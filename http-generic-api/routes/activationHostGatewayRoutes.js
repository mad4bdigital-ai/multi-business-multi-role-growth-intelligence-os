import { Router } from "express";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ACTIVATION_HOST_GATEWAY_HOST = "activation.mad4b.com";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_ROOT_DIR = resolve(__dirname, "..");
const SCHEMA_ARTIFACT_DIR = resolve(SCHEMA_ROOT_DIR, "openapi");

const ALLOWED_EXACT_PATHS = new Set([
  "/",
  "/health",
  "/openapi.tenant-gpt.activation.yaml",
  "/openapi.custom-gpt.activation-admin.yaml",
]);

const ALLOWED_PREFIXES = [
  "/activation/",
  "/tenant/activation/",
];

function requestHost(req) {
  return String(req.headers?.["x-forwarded-host"] || req.headers?.host || "")
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
}

function requestPath(req) {
  const path = String(req.path || "/").trim() || "/";
  return path.startsWith("/") ? path : `/${path}`;
}

function requestId(req) {
  return String(req.headers?.["x-request-id"] || req.headers?.["cf-ray"] || "")
    .split(",")[0]
    .trim()
    .slice(0, 128) || null;
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

  router.use((req, res, next) => {
    if (!enabled) return next();

    const host = requestHost(req);
    if (host !== activationHost) return next();

    const pathname = requestPath(req);

    // Activation transport must be bearer-token based and stateless. OAuth
    // authorization and token exchange stay exclusively on auth.mad4b.com.
    delete req.headers.cookie;

    if (isOAuthPath(pathname)) {
      return res.status(404).json(errorResponse(
        "ACTIVATION_HOST_OAUTH_NOT_ALLOWED",
        "OAuth endpoints are only served from auth.mad4b.com.",
        req,
      ));
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
    oauth_host: "auth.mad4b.com",
    secrets_included: false,
  };
}
