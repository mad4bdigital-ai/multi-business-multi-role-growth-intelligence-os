import { Router } from "express";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { requireActivationTenantGptAccessToken } from "../tenantGptAccessTokenVerifier.js";
import { resolveActivationGatewayHostProfile } from "../activationGatewayHostProfile.js";
import { resolveTrustedRequestHost } from "../trustedRequestHost.js";
import { verifyRecoveryGatewayIngress } from "../trustedIngressContract.js";
import stagingPolicy from "../activation-gateway-runtime/generated/route-policy.staging.json" with { type: "json" };
const DEFAULT_HOST_PROFILE = resolveActivationGatewayHostProfile(process.env);
export const ACTIVATION_HOST_GATEWAY_HOST = String(
  DEFAULT_HOST_PROFILE.profile?.public_host
    || process.env.ACTIVATION_HOST_GATEWAY_HOST
    || "activation.mad4b.com",
).trim().toLowerCase();

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_ROOT_DIR = resolve(__dirname, "..");
const SCHEMA_ARTIFACT_DIR = resolve(SCHEMA_ROOT_DIR, "openapi");

function buildGatewayConfig(env = process.env, activationHostOverride = null) {
  const hostProfile = resolveActivationGatewayHostProfile(env);
  const runtime = hostProfile.runtime;
  const profile = hostProfile.profile;
  const staging = runtime?.environment_key === "staging";
  const productionLike = ["production", "test", "ci"].includes(runtime?.environment_key);
  const activationHost = String(
    activationHostOverride || profile?.public_host || env.ACTIVATION_HOST_GATEWAY_HOST || "",
  ).trim().toLowerCase();
  const hostOverrideAllowed = !activationHostOverride || ["test", "ci"].includes(runtime?.environment_key);
  const activationHostMatchesProfile = Boolean(profile?.public_host) && activationHost === profile.public_host;
  const authHost = String(profile?.oauth_issuer_host || "").trim().toLowerCase();
  const upstreamHost = String(profile?.upstream_host || "").trim().toLowerCase();
  const supported = hostProfile.ok && hostOverrideAllowed && activationHostMatchesProfile && (staging || productionLike);
  const schemaFilesByPath = new Map(staging ? [
    ["/openapi.tenant-gpt.activation.staging.yaml", "openapi.tenant-gpt.activation.staging.yaml"],
    ["/tenant-gpt/activation-openapi", "openapi.tenant-gpt.activation.staging.yaml"],
    ["/openapi.custom-gpt.activation-admin.staging.yaml", "openapi.custom-gpt.activation-admin.staging.yaml"],
    ["/admin-gpt/activation-openapi", "openapi.custom-gpt.activation-admin.staging.yaml"],
  ] : productionLike ? [
    ["/openapi.tenant-gpt.activation.yaml", "openapi.tenant-gpt.activation.yaml"],
    ["/tenant-gpt/activation-openapi", "openapi.tenant-gpt.activation.yaml"],
    ["/openapi.custom-gpt.activation-admin.yaml", "openapi.custom-gpt.activation-admin.yaml"],
    ["/admin-gpt/activation-openapi", "openapi.custom-gpt.activation-admin.yaml"],
  ] : []);
  return Object.freeze({
    runtime,
    hostProfile,
    profile,
    supported,
    staging,
    activationHost,
    authHost,
    upstreamHost,
    schemaFilesByPath,
    schemaHosts: supported ? (staging ? [activationHost] : [activationHost, authHost]) : [],
    allowedExactPaths: supported ? new Set([
      "/",
      "/health",
      "/privacy-policy",
      "/status",
      "/tenant-gpt/oauth-preset",
      "/terms-of-use",
      ...schemaFilesByPath.keys(),
    ]) : new Set(),
    allowedPrefixes: supported ? [
      "/activation/",
      "/tenant/activation/",
      ...(staging
        ? ["/admin/recovery/staging/"]
        : productionLike ? ["/admin/recovery/kernel/"] : []),
    ] : [],
  });
}

const DEFAULT_GATEWAY_CONFIG = buildGatewayConfig(process.env);
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

function requestHost(req, preferredHost = "", env = process.env) {
  const trusted = resolveTrustedRequestHost(req, env);
  const preferred = normalizedRequestHost(preferredHost);
  return preferred && trusted === preferred ? preferred : trusted;
}

function hasTrustedProxyHostClaim(req, env = process.env) {
  if (String(env?.REMOTE_MCP_TRUST_PROXY_HOST_HEADERS || "").trim().toLowerCase() !== "true") return false;
  return ["x-original-host", "x-forwarded-host", "x-host"].some((name) => Object.hasOwn(req?.headers || {}, name));
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

function isActivationSchemaHost(host, config) {
  return config.schemaHosts.includes(host);
}

function isActivationHostAllowedPath(pathname, method, config = DEFAULT_GATEWAY_CONFIG) {
  if (!config.supported) return false;
  return config.allowedExactPaths.has(pathname)
    || config.allowedPrefixes.some((prefix) => pathname.startsWith(prefix))
    || ALLOWED_TENANT_RESOLUTION_ROUTES.some((route) =>
      route.methods.has(String(method || "").toUpperCase()) && route.pattern.test(pathname));
}

function isTenantGptProtectedPath(pathname, method, config = DEFAULT_GATEWAY_CONFIG) {
  return pathname.startsWith("/tenant/activation/")
    || ALLOWED_TENANT_RESOLUTION_ROUTES.some((route) =>
      route.methods.has(String(method || "").toUpperCase()) && route.pattern.test(pathname));
}

export function activationHostGatewayAllowsOperation(method, pathname, { env = process.env, activationHost = null } = {}) {
  return isActivationHostAllowedPath(pathname, method, buildGatewayConfig(env, activationHost));
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
  activationHost = null,
  enabled = undefined,
  env = process.env,
  ingressReplayStore = null,
  deploymentAttestationReader = null,
} = {}) {
  const config = buildGatewayConfig(env, activationHost);
  const gatewayEnabled = config.supported && (enabled === undefined
    ? !config.staging || String(env.ACTIVATION_STAGING_GATEWAY_ENABLED || "").trim().toLowerCase() === "true"
    : enabled === true);
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
    if (!gatewayEnabled || !["GET", "HEAD"].includes(req.method)) return next();

    const pathname = requestPath(req);
    const schemaFile = config.schemaFilesByPath.get(pathname);
    if (!schemaFile) return next();

    const host = requestHost(req, config.activationHost, env);
    if (!host && hasTrustedProxyHostClaim(req, env)) {
      return res.status(404).json(errorResponse(
        "ACTIVATION_HOST_ROUTE_NOT_ALLOWED",
        "Conflicting or malformed trusted host claims are not accepted.",
        req,
      ));
    }
    if (!isActivationSchemaHost(host, config)) return next();

    await serveActivationSchema(req, res, schemaFile);
    return undefined;
  });

  router.use(async (req, res, next) => {
    if (!gatewayEnabled) return next();

    const host = requestHost(req, config.activationHost, env);
    if (!host && hasTrustedProxyHostClaim(req, env)) {
      return res.status(404).json(errorResponse(
        "ACTIVATION_HOST_ROUTE_NOT_ALLOWED",
        "Conflicting or malformed trusted host claims are not accepted.",
        req,
      ));
    }
    if (host !== config.activationHost) return next();

    const pathname = requestPath(req);
    let recoveryIngress = null;
    if (config.staging && pathname === "/health" && req.method === "GET") {
      try {
        const attestation = typeof deploymentAttestationReader === "function" ? await deploymentAttestationReader() : null;
        if (attestation?.environment !== "staging" || attestation?.branch !== "main"
          || !/^[a-f0-9]{40}$/.test(attestation?.sha || "") || attestation?.manifest_bound !== true
          || attestation?.read_only !== true || attestation?.secrets_included !== false) throw new Error("attestation unavailable");
        return res.status(200).set("Cache-Control", "no-store").json({ ok: true,
          policyHash: stagingPolicy.content_hash_sha256, sourceCommit: attestation.sha,
          service: "activation-origin", secretsIncluded: false });
      } catch { return res.status(503).json(errorResponse("GATEWAY_ORIGIN_ATTESTATION_UNAVAILABLE", "Server deployment evidence is unavailable.", req)); }
    }
    if (config.staging && pathname.startsWith("/admin/recovery/staging/")) {
      recoveryIngress = await verifyRecoveryGatewayIngress({ env, request: req, policy: stagingPolicy, replayStore: ingressReplayStore });
      if (!recoveryIngress.ok) return res.status(403).json(errorResponse(
        "RECOVERY_TRUSTED_INGRESS_REQUIRED", "A fresh signed Gateway request and durable replay claim are required.", req,
      ));
    }

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
        via_trusted_gateway: false,
        gateway_key: config.profile?.gateway_key || null,
        environment: config.runtime?.environment_key || null,
        public_host: config.profile?.public_host || null,
        upstream_origin: config.profile?.upstream_origin || null,
        tenant_gpt_oauth_handoff: true,
        operation_id: oauthHandoff.operation_id,
        secrets_included: false,
      };
      return next();
    }

    delete req.headers.cookie;

    if (isAuthPath(pathname) || !isActivationHostAllowedPath(pathname, req.method, config)) {
      return res.status(404).json(errorResponse(
        "ACTIVATION_HOST_ROUTE_NOT_ALLOWED",
        "This host only serves the environment-bound Activation transport routes and Activation OpenAPI schemas.",
        req,
      ));
    }

    req.activationHostGateway = {
      host,
      enforced: true,
      via_trusted_gateway: recoveryIngress?.ok === true,
      ingress_signature_verified: recoveryIngress?.ok === true,
      ingress_replay_protection: recoveryIngress?.replay_protection || null,
      ingress_build_identity: recoveryIngress?.build_identity || null,
      gateway_key: config.profile?.gateway_key || null,
      environment: config.runtime?.environment_key || null,
      public_host: config.profile?.public_host || null,
      upstream_origin: config.profile?.upstream_origin || null,
      secrets_included: false,
    };

    if (isTenantGptProtectedPath(pathname, req.method, config)) {
      return requireActivationTenantGptAccessToken(req, res, next);
    }

    return next();
  });

  return router;
}

export function activationHostGatewayAllowedPaths({ env = process.env, activationHost = null } = {}) {
  const config = buildGatewayConfig(env, activationHost);
  return {
    host: config.activationHost,
    environment_key: config.runtime?.environment_key || null,
    runtime_variant: config.runtime?.runtime_variant || null,
    runtime_class: config.runtime?.runtime_class || null,
    gateway_key: config.profile?.gateway_key || null,
    authority_mode: config.runtime?.authority_mode || null,
    exact_paths: [...config.allowedExactPaths],
    path_prefixes: [...config.allowedPrefixes],
    tenant_gpt_oauth_routes: [...TENANT_GPT_OAUTH_HANDOFF_ROUTES.entries()].map(([key, value]) => {
      const splitAt = key.indexOf(" ");
      return {
        method: key.slice(0, splitAt),
        path: key.slice(splitAt + 1),
        operation_id: value.operation_id,
      };
    }),
    schema_hosts: [...config.schemaHosts],
    oauth_host: config.activationHost,
    oauth_upstream_host: config.upstreamHost,
    secrets_included: false,
  };
}
