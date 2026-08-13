const REQUEST_HEADER_ALLOWLIST = new Set([
  "accept",
  "authorization",
  "content-type",
  "idempotency-key",
  "traceparent",
  "tracestate",
  "user-agent",
  "x-api-key",
  "x-request-id",
]);

const RESPONSE_HEADER_ALLOWLIST = new Set([
  "cache-control",
  "content-language",
  "content-type",
  "etag",
  "retry-after",
  "x-request-id",
]);

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

export function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}

function utf8(value) {
  return new TextEncoder().encode(value);
}

function base64UrlDecode(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function policyPayload(policy) {
  return {
    manifest_version: policy.manifest_version,
    surface_registry_version: policy.surface_registry_version,
    policy_key: policy.policy_key,
    public_host: policy.public_host,
    upstream_origin: policy.upstream_origin,
    mutation_stale_policy: policy.mutation_stale_policy,
    read_stale_grace_seconds: policy.read_stale_grace_seconds,
    source_registry: policy.source_registry,
    source_surfaces: policy.source_surfaces,
    oauth_handoff_routes: policy.oauth_handoff_routes,
    routes: policy.routes,
  };
}

export async function policyHash(policy, cryptoImpl = crypto) {
  const digest = await cryptoImpl.subtle.digest("SHA-256", utf8(stableJson(policyPayload(policy))));
  return hex(digest);
}

export async function verifyDeploymentAttestation(policy, env, { cryptoImpl = crypto, now = () => Date.now() } = {}) {
  const calculatedHash = await policyHash(policy, cryptoImpl);
  if (calculatedHash !== policy.content_hash_sha256) {
    return { ok: false, code: "GATEWAY_POLICY_HASH_MISMATCH", stale: true };
  }

  const rawAttestation = env?.ACTIVATION_GATEWAY_DEPLOYMENT_ATTESTATION_JSON;
  const rawPublicKey = env?.ACTIVATION_GATEWAY_POLICY_PUBLIC_KEY_JWK;
  if (!rawAttestation || !rawPublicKey) {
    return { ok: false, code: "GATEWAY_POLICY_ATTESTATION_MISSING", stale: true };
  }

  let attestation;
  let publicKeyJwk;
  try {
    attestation = JSON.parse(rawAttestation);
    publicKeyJwk = JSON.parse(rawPublicKey);
  } catch {
    return { ok: false, code: "GATEWAY_POLICY_ATTESTATION_INVALID", stale: true };
  }

  if (attestation.content_hash_sha256 !== policy.content_hash_sha256) {
    return { ok: false, code: "GATEWAY_POLICY_ATTESTATION_HASH_MISMATCH", stale: true };
  }
  if (!attestation.deployment_id || !attestation.source_commit || !attestation.expires_at || !attestation.signature_b64url) {
    return { ok: false, code: "GATEWAY_POLICY_ATTESTATION_INCOMPLETE", stale: true };
  }
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(String(attestation.source_commit))) {
    return { ok: false, code: "GATEWAY_POLICY_SOURCE_COMMIT_INVALID", stale: true };
  }
  if (Number(attestation.surface_registry_version) !== Number(policy.surface_registry_version)) {
    return { ok: false, code: "GATEWAY_POLICY_REGISTRY_VERSION_MISMATCH", stale: true };
  }

  try {
    const publicKey = await cryptoImpl.subtle.importKey(
      "jwk",
      publicKeyJwk,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const signedPayload = stableJson({
      content_hash_sha256: attestation.content_hash_sha256,
      deployment_id: attestation.deployment_id,
      expires_at: attestation.expires_at,
      source_commit: attestation.source_commit,
      surface_registry_version: Number(attestation.surface_registry_version),
    });
    const verified = await cryptoImpl.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      base64UrlDecode(attestation.signature_b64url),
      utf8(signedPayload),
    );
    if (!verified) return { ok: false, code: "GATEWAY_POLICY_SIGNATURE_INVALID", stale: true };
  } catch {
    return { ok: false, code: "GATEWAY_POLICY_SIGNATURE_INVALID", stale: true };
  }

  const expiresAtMs = Date.parse(attestation.expires_at);
  if (!Number.isFinite(expiresAtMs)) return { ok: false, code: "GATEWAY_POLICY_EXPIRY_INVALID", stale: true };
  const nowMs = now();
  const stale = nowMs >= expiresAtMs;
  return {
    ok: true,
    stale,
    expiresAtMs,
    deploymentId: attestation.deployment_id,
    sourceCommit: attestation.source_commit,
    surfaceRegistryVersion: Number(attestation.surface_registry_version),
    attestation,
    code: stale ? "GATEWAY_POLICY_STALE" : null,
  };
}

function safeRequestId(request) {
  const candidate = String(request.headers.get("x-request-id") || "").trim();
  return /^[A-Za-z0-9._:-]{8,128}$/.test(candidate) ? candidate : crypto.randomUUID();
}

function errorBody(code, message, requestId, details = undefined) {
  return {
    error: {
      code,
      message,
      ...(details ? { details } : {}),
      requestId,
    },
    secretsIncluded: false,
  };
}

function jsonResponse(status, payload, requestId, extraHeaders = {}) {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "x-request-id": requestId,
    ...extraHeaders,
  });
  return new Response(JSON.stringify(payload), { status, headers });
}

function unsafePath(pathname) {
  const lower = pathname.toLowerCase();
  return pathname.includes("\\")
    || pathname.includes("//")
    || lower.includes("%2f")
    || lower.includes("%5c")
    || lower.includes("%2e")
    || pathname.split("/").some((part) => part === "." || part === "..");
}

function routeKey(method, pathname) {
  return `${method.toUpperCase()} ${pathname}`;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function routeTemplateRegex(template) {
  const pattern = String(template)
    .split("/")
    .map((segment) => /^\{[A-Za-z0-9_]+\}$/.test(segment) ? "[^/]+" : escapeRegex(segment))
    .join("/");
  return new RegExp(`^${pattern}$`);
}

function buildRouteIndexes(policy) {
  const exact = new Map();
  const templates = [];
  for (const route of policy.routes || []) {
    if (route.path.includes("{")) templates.push({ route, regex: routeTemplateRegex(route.path) });
    else exact.set(routeKey(route.method, route.path), route);
  }
  return { exact, templates };
}

function resolveRoute(indexes, method, pathname) {
  const normalizedMethod = method.toUpperCase();
  const exact = indexes.exact.get(routeKey(normalizedMethod, pathname));
  if (exact) return { route: exact, allowedMethods: new Set([exact.method]) };
  const matches = indexes.templates.filter((entry) => entry.regex.test(pathname));
  const route = matches.find((entry) => entry.route.method === normalizedMethod)?.route || null;
  return { route, allowedMethods: new Set(matches.map((entry) => entry.route.method)) };
}

function buildOAuthHandoffIndex(policy) {
  return new Map((policy.oauth_handoff_routes || []).map((route) => [routeKey(route.method, route.path), route]));
}

function resolveOAuthHandoff(index, method, pathname) {
  return index.get(routeKey(method, pathname)) || null;
}

function forwardedRequestHeaders(request, policy, requestId, { allowOauthSessionCookie = false } = {}) {
  const headers = new Headers();
  for (const [name, value] of request.headers.entries()) {
    const lower = name.toLowerCase();
    if (REQUEST_HEADER_ALLOWLIST.has(lower) || (allowOauthSessionCookie && lower === "cookie")) headers.set(lower, value);
  }
  headers.set("x-request-id", requestId);
  headers.set("x-forwarded-host", policy.public_host);
  headers.set("x-forwarded-proto", "https");
  headers.set("x-activation-gateway-policy-hash", policy.content_hash_sha256);
  return headers;
}

function filteredResponseHeaders(response, requestId, policy, { allowOauthSessionCookie = false } = {}) {
  const headers = new Headers();
  for (const [name, value] of response.headers.entries()) {
    const lower = name.toLowerCase();
    if (RESPONSE_HEADER_ALLOWLIST.has(lower) || (allowOauthSessionCookie && lower === "set-cookie")) headers.set(name, value);
  }
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-request-id", requestId);
  headers.set("x-activation-gateway-policy-hash", policy.content_hash_sha256);
  return headers;
}

async function boundedBody(request, limit) {
  const declared = Number.parseInt(request.headers.get("content-length") || "0", 10);
  if (Number.isFinite(declared) && declared > limit) throw Object.assign(new Error("request too large"), { code: "REQUEST_TOO_LARGE" });
  if (!request.body) return undefined;
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > limit) throw Object.assign(new Error("request too large"), { code: "REQUEST_TOO_LARGE" });
  return buffer.byteLength ? buffer : undefined;
}

async function boundedResponseBody(response, limit) {
  const declared = Number.parseInt(response.headers.get("content-length") || "0", 10);
  if (Number.isFinite(declared) && declared > limit) throw Object.assign(new Error("response too large"), { code: "RESPONSE_TOO_LARGE" });
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > limit) throw Object.assign(new Error("response too large"), { code: "RESPONSE_TOO_LARGE" });
  return buffer;
}

export function createActivationGateway({
  policy,
  fetchImpl = fetch,
  verifyAttestation = verifyDeploymentAttestation,
  cryptoImpl = crypto,
  now = () => Date.now(),
  logger = console,
} = {}) {
  if (!policy || typeof policy !== "object") throw new Error("Activation gateway policy is required");
  const indexes = buildRouteIndexes(policy);
  const oauthHandoffIndex = buildOAuthHandoffIndex(policy);
  let verificationCacheKey = "";
  let verificationCache = null;

  async function currentVerification(env) {
    const cacheKey = `${env?.ACTIVATION_GATEWAY_DEPLOYMENT_ATTESTATION_JSON || ""}|${env?.ACTIVATION_GATEWAY_POLICY_PUBLIC_KEY_JWK || ""}`;
    if (verificationCache && cacheKey === verificationCacheKey) {
      if (!verificationCache.ok || !Number.isFinite(verificationCache.expiresAtMs)) return verificationCache;
      const stale = now() >= verificationCache.expiresAtMs;
      return { ...verificationCache, stale, code: stale ? "GATEWAY_POLICY_STALE" : null };
    }
    verificationCacheKey = cacheKey;
    verificationCache = await verifyAttestation(policy, env, { cryptoImpl, now });
    return verificationCache;
  }

  return async function handle(request, env = {}, context = {}) {
    const started = now();
    const requestId = safeRequestId(request);
    const url = new URL(request.url);
    let status = 500;
    let upstreamStatus = null;
    let operationIds = [];
    try {
      const verification = await currentVerification(env);
      if (!verification.ok) {
        status = 503;
        return jsonResponse(status, errorBody(verification.code, "Activation Gateway policy attestation is not valid.", requestId), requestId);
      }

      if (String(env.ACTIVATION_GATEWAY_ENFORCE_HOST ?? "true").toLowerCase() !== "false" && url.hostname.toLowerCase() !== policy.public_host.toLowerCase()) {
        status = 421;
        return jsonResponse(status, errorBody("GATEWAY_HOST_MISMATCH", "The request host is not allowed.", requestId), requestId);
      }
      if (url.pathname === "/health" && request.method === "GET") {
        status = verification.stale ? 503 : 200;
        return jsonResponse(status, {
          ok: !verification.stale,
          service: "activation-gateway",
          policyKey: policy.policy_key,
          policyHash: policy.content_hash_sha256,
          deploymentId: verification.deploymentId,
          sourceCommit: verification.sourceCommit,
          surfaceRegistryVersion: verification.surfaceRegistryVersion,
          stale: verification.stale,
          routeCount: policy.routes.length,
          secretsIncluded: false,
        }, requestId);
      }

      if (url.pathname === "/ready" && request.method === "GET") {
        if (verification.stale) {
          status = 503;
          return jsonResponse(status, errorBody("GATEWAY_POLICY_STALE", "Activation Gateway policy is stale.", requestId), requestId);
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        try {
          const upstream = await fetchImpl(new URL("/health", policy.upstream_origin), {
            method: "GET",
            headers: { "x-request-id": requestId },
            redirect: "manual",
            signal: controller.signal,
          });
          upstreamStatus = upstream.status;
          status = upstream.ok ? 200 : 503;
          return jsonResponse(status, {
            ok: upstream.ok,
            service: "activation-gateway",
            upstreamReady: upstream.ok,
            policyHash: policy.content_hash_sha256,
            secretsIncluded: false,
          }, requestId);
        } finally {
          clearTimeout(timer);
        }
      }


      if (unsafePath(url.pathname)) {
        status = 400;
        return jsonResponse(status, errorBody("GATEWAY_PATH_INVALID", "The request path is not canonical.", requestId), requestId);
      }

      const oauthHandoff = resolveOAuthHandoff(oauthHandoffIndex, request.method, url.pathname);
      if (oauthHandoff) {
        operationIds = oauthHandoff.operation_ids || [];
        if (verification.stale) {
          status = 503;
          return jsonResponse(status, errorBody("GATEWAY_POLICY_STALE", "The Activation Gateway policy is stale.", requestId), requestId);
        }
        const allowedQuery = new Set(oauthHandoff.allowed_query_parameters || []);
        const unsupported = [...new Set([...url.searchParams.keys()].filter((key) => !allowedQuery.has(key)))];
        if (unsupported.length > 0) {
          status = 400;
          return jsonResponse(status, errorBody("GATEWAY_QUERY_PARAMETER_NOT_ALLOWED", "One or more query parameters are not documented for this route.", requestId, unsupported.map((field) => ({ field, issue: "unsupported" }))), requestId);
        }
        const body = ["GET", "HEAD"].includes(request.method.toUpperCase())
          ? undefined
          : await boundedBody(request.clone(), Number(oauthHandoff.request_body_limit_bytes));
        const target = new URL(`${url.pathname}${url.search}`, policy.upstream_origin);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Number(oauthHandoff.timeout_ms));
        let upstream;
        try {
          upstream = await fetchImpl(target, {
            method: request.method,
            headers: forwardedRequestHeaders(request, policy, requestId, { allowOauthSessionCookie: true }),
            body,
            redirect: "manual",
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        upstreamStatus = upstream.status;
        if (upstream.status >= 300 && upstream.status < 400) {
          status = 502;
          return jsonResponse(status, errorBody("GATEWAY_UPSTREAM_REDIRECT_BLOCKED", "The upstream returned a redirect, which is blocked.", requestId), requestId);
        }
        const responseBody = await boundedResponseBody(upstream, Number(oauthHandoff.response_body_limit_bytes));
        status = upstream.status;
        return new Response(responseBody, { status, headers: filteredResponseHeaders(upstream, requestId, policy, { allowOauthSessionCookie: true }) });
      }
      const { route, allowedMethods } = resolveRoute(indexes, request.method, url.pathname);

      if (!route) {
        if (allowedMethods.size > 0) {
          status = 405;
          return jsonResponse(status, errorBody("GATEWAY_METHOD_NOT_ALLOWED", "The request method is not allowed for this path.", requestId), requestId, { allow: [...allowedMethods].sort().join(", ") });
        }
        status = 404;
        return jsonResponse(status, errorBody("GATEWAY_ROUTE_NOT_ALLOWED", "The requested route is not exposed by the Activation Gateway.", requestId), requestId);
      }
      operationIds = route.operation_ids || [];

      if (verification.stale) {
        const graceMs = Number(policy.read_stale_grace_seconds || 0) * 1000;
        const withinReadGrace = !route.mutation && now() < verification.expiresAtMs + graceMs;
        if (!withinReadGrace) {
          status = 503;
          return jsonResponse(status, errorBody("GATEWAY_POLICY_STALE", "The Activation Gateway policy is stale.", requestId), requestId);
        }
      }

      const allowedQuery = new Set(route.allowed_query_parameters || []);
      const unsupported = [...new Set([...url.searchParams.keys()].filter((key) => !allowedQuery.has(key)))];
      if (unsupported.length > 0) {
        status = 400;
        return jsonResponse(status, errorBody("GATEWAY_QUERY_PARAMETER_NOT_ALLOWED", "One or more query parameters are not documented for this route.", requestId, unsupported.map((field) => ({ field, issue: "unsupported" }))), requestId);
      }

      const body = ["GET", "HEAD"].includes(request.method.toUpperCase())
        ? undefined
        : await boundedBody(request.clone(), Number(route.request_body_limit_bytes));
      const target = new URL(`${url.pathname}${url.search}`, policy.upstream_origin);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Number(route.timeout_ms));
      let upstream;
      try {
        upstream = await fetchImpl(target, {
          method: request.method,
          headers: forwardedRequestHeaders(request, policy, requestId),
          body,
          redirect: "manual",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      upstreamStatus = upstream.status;
      if (upstream.status >= 300 && upstream.status < 400) {
        status = 502;
        return jsonResponse(status, errorBody("GATEWAY_UPSTREAM_REDIRECT_BLOCKED", "The upstream returned a redirect, which is blocked.", requestId), requestId);
      }
      const responseBody = await boundedResponseBody(upstream, Number(route.response_body_limit_bytes));
      status = upstream.status;
      return new Response(responseBody, { status, headers: filteredResponseHeaders(upstream, requestId, policy) });
    } catch (error) {
      if (error?.name === "AbortError") {
        status = 504;
        return jsonResponse(status, errorBody("GATEWAY_UPSTREAM_TIMEOUT", "The upstream request timed out.", requestId), requestId);
      }
      if (error?.code === "REQUEST_TOO_LARGE") {
        status = 413;
        return jsonResponse(status, errorBody("GATEWAY_REQUEST_TOO_LARGE", "The request body exceeds the route limit.", requestId), requestId);
      }
      if (error?.code === "RESPONSE_TOO_LARGE") {
        status = 502;
        return jsonResponse(status, errorBody("GATEWAY_UPSTREAM_RESPONSE_TOO_LARGE", "The upstream response exceeds the route limit.", requestId), requestId);
      }
      status = 502;
      return jsonResponse(status, errorBody("GATEWAY_UPSTREAM_FAILURE", "The Activation Gateway could not complete the request.", requestId), requestId);
    } finally {
      const event = {
        event: "activation_gateway.request_completed",
        method: request.method,
        path: url.pathname,
        operation_ids: operationIds,
        status,
        upstream_status: upstreamStatus,
        duration_ms: Math.max(0, now() - started),
        request_id: requestId,
        policy_hash: policy.content_hash_sha256,
        secrets_included: false,
      };
      context?.waitUntil?.(Promise.resolve());
      logger?.info?.(JSON.stringify(event));
    }
  };
}
