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

const TENANT_GPT_SSO_COOKIE_NAME = "mad4b_tenant_gpt_sso";

function filterOauthSsoCookieHeader(value) {
  const pair = String(value || "").split(";").map((part) => part.trim()).find((part) => part.startsWith(`${TENANT_GPT_SSO_COOKIE_NAME}=`));
  return pair && pair.includes("=") ? pair : "";
}

function filterOauthSsoSetCookieHeader(value) {
  const candidates = String(value || "").split(/,\s*(?=[A-Za-z0-9!#$%&'*+.^_`|~-]+=)/u).map((item) => item.trim());
  const approved = candidates.find((item) =>
    item.startsWith(`${TENANT_GPT_SSO_COOKIE_NAME}=`)
    && /(?:^|;\s*)Domain=\.mad4b\.com(?:;|$)/iu.test(item)
    && /(?:^|;\s*)Path=\/(?:;|$)/iu.test(item)
    && /(?:^|;\s*)HttpOnly(?:;|$)/iu.test(item)
    && /(?:^|;\s*)Secure(?:;|$)/iu.test(item)
    && /(?:^|;\s*)SameSite=Lax(?:;|$)/iu.test(item),
  );
  return approved || "";
}

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
    source_openapi_sha256: policy.source_openapi_sha256,
    surface_registry_sha256: policy.surface_registry_sha256,
    warning_budget: policy.warning_budget,
    policy_key: policy.policy_key,
    public_host: policy.public_host,
    upstream_origin: policy.upstream_origin,
    mutation_stale_policy: policy.mutation_stale_policy,
    read_stale_grace_seconds: policy.read_stale_grace_seconds,
    ready_provenance: policy.ready_provenance,
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

export async function verifyDeploymentAttestation(policy, env, { cryptoImpl = crypto, now = () => Date.now(), workerBuildIdentity = null } = {}) {
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
  const requireBuild = policy.policy_key === "activation_gateway_staging";
  if (requireBuild && (!/^[a-f0-9]{40}$/.test(workerBuildIdentity?.source_sha || "")
    || !/^[a-f0-9]{64}$/.test(workerBuildIdentity?.bundle_sha256 || "")
    || workerBuildIdentity.source_sha !== attestation.source_commit
    || attestation.worker_build_sha !== workerBuildIdentity.source_sha
    || attestation.worker_bundle_sha256 !== workerBuildIdentity.bundle_sha256)) {
    return { ok: false, code: "GATEWAY_WORKER_BUILD_MISMATCH", stale: true };
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
      ...(requireBuild ? {
        worker_build_sha: attestation.worker_build_sha,
        worker_bundle_sha256: attestation.worker_bundle_sha256,
      } : {}),
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

export async function signedRecoveryIngressHeaders(request, policy, requestId, verification, env, workerBuildIdentity, cryptoImpl = crypto, now = () => Date.now()) {
  if (!env.ACTIVATION_GATEWAY_INGRESS_PRIVATE_KEY_JWK || !env.ACTIVATION_GATEWAY_INGRESS_KEY_ID
    || workerBuildIdentity?.source_sha !== verification.sourceCommit
    || !/^[a-f0-9]{64}$/.test(workerBuildIdentity?.bundle_sha256 || "")) {
    throw Object.assign(new Error("Gateway ingress signing authority unavailable"), { code: "GATEWAY_INGRESS_AUTHORITY_MISSING" });
  }
  const headers = forwardedRequestHeaders(request, policy, requestId);
  const iat = Math.floor(now() / 1000);
  const digest = async (value) => hex(await cryptoImpl.subtle.digest("SHA-256", utf8(value)));
  const payload = {
    iss: `https://${policy.public_host}`,
    aud: policy.upstream_origin,
    host: policy.public_host,
    deployment_sha: verification.sourceCommit,
    worker_build_sha: workerBuildIdentity.source_sha,
    worker_bundle_sha256: workerBuildIdentity.bundle_sha256,
    policy_hash: policy.content_hash_sha256,
    method: request.method,
    path: new URL(request.url).pathname + new URL(request.url).search,
    request_id: requestId,
    auth_digest: await digest(JSON.stringify([headers.get("authorization") || "", headers.get("x-api-key") || ""])),
    body_digest: await digest(""),
    iat, exp: Math.min(iat + 30, Math.floor(verification.expiresAtMs / 1000)),
    jti: cryptoImpl.randomUUID(),
    key_id: env.ACTIVATION_GATEWAY_INGRESS_KEY_ID,
  };
  if (!Number.isInteger(payload.exp) || payload.exp <= iat) throw new Error("Gateway policy expires before ingress proof");
  const key = await cryptoImpl.subtle.importKey("jwk", JSON.parse(env.ACTIVATION_GATEWAY_INGRESS_PRIVATE_KEY_JWK), { name: "Ed25519" }, false, ["sign"]);
  const bytes = utf8(JSON.stringify(payload));
  const signature = new Uint8Array(await cryptoImpl.subtle.sign("Ed25519", key, bytes));
  const b64 = (v) => btoa(String.fromCharCode(...v)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  headers.set("x-mad4b-ingress-attestation", `${b64(bytes)}.${b64(signature)}`);
  return headers;
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
    if (allowOauthSessionCookie && lower === "cookie") {
      const filtered = filterOauthSsoCookieHeader(value);
      if (filtered) headers.set(lower, filtered);
      continue;
    }
    if (REQUEST_HEADER_ALLOWLIST.has(lower)) headers.set(lower, value);
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
    if (allowOauthSessionCookie && lower === "set-cookie") {
      const filtered = filterOauthSsoSetCookieHeader(value);
      if (filtered) headers.set(name, filtered);
      continue;
    }
    if (RESPONSE_HEADER_ALLOWLIST.has(lower)) headers.set(name, value);
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

async function verifyUpstreamReadinessEvidence(response, policy, verification) {
  if (!response.ok) return { ok: false, upstreamReady: false, nonReady: true };
  const required = policy.ready_provenance?.required !== false;
  const body = await boundedResponseBody(response, 64 * 1024);
  let evidence;
  try {
    evidence = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return { ok: false, code: "GATEWAY_UPSTREAM_DEPLOYMENT_EVIDENCE_MISSING" };
  }
  const policyHash = evidence?.policyHash || evidence?.policy_hash_sha256 || response.headers.get("x-activation-gateway-policy-hash");
  const sourceCommit = evidence?.sourceCommit || evidence?.source_commit || response.headers.get("x-mad4b-deployment-sha");
  const policyHashRequired = policy.ready_provenance?.require_policy_hash !== false;
  const sourceCommitRequired = policy.ready_provenance?.require_source_commit !== false;
  const policyHashMatches = !policyHashRequired || policyHash === policy.content_hash_sha256;
  const sourceCommitMatches = !sourceCommitRequired || sourceCommit === verification.sourceCommit;
  if (required && ((policyHashRequired && !policyHash) || (sourceCommitRequired && !sourceCommit))) {
    return { ok: false, code: "GATEWAY_UPSTREAM_DEPLOYMENT_EVIDENCE_MISSING" };
  }
  if (required && (!policyHashMatches || !sourceCommitMatches)) {
    return {
      ok: false,
      code: "GATEWAY_UPSTREAM_DEPLOYMENT_EVIDENCE_MISMATCH",
      details: { policy_hash_matches: policyHashMatches, source_commit_matches: sourceCommitMatches },
    };
  }
  return {
    ok: true,
    upstreamReady: true,
    policyHash,
    sourceCommit,
    deploymentId: evidence?.deploymentId || evidence?.deployment_id || null,
  };
}

export function createActivationGateway({
  policy,
  fetchImpl = fetch,
  verifyAttestation = verifyDeploymentAttestation,
  cryptoImpl = crypto,
  now = () => Date.now(),
  logger = console,
  workerBuildIdentity = null,
} = {}) {
  if (!policy || typeof policy !== "object") throw new Error("Activation gateway policy is required");
  const indexes = buildRouteIndexes(policy);
  const oauthHandoffIndex = buildOAuthHandoffIndex(policy);
  const verificationState = {};

  async function currentVerification(env) {
    const _attestKey = `${env?.ACTIVATION_GATEWAY_DEPLOYMENT_ATTESTATION_JSON || ""}|${env?.ACTIVATION_GATEWAY_POLICY_PUBLIC_KEY_JWK || ""}`;
    if (verificationState.value && _attestKey === verificationState.key) {
      if (!verificationState.value.ok || !Number.isFinite(verificationState.value.expiresAtMs)) return verificationState.value;
      const stale = now() >= verificationState.value.expiresAtMs;
      return { ...verificationState.value, stale, code: stale ? "GATEWAY_POLICY_STALE" : null };
    }
    verificationState.key = _attestKey;
    verificationState.value = await verifyAttestation(policy, env, { cryptoImpl, now, workerBuildIdentity });
    return verificationState.value;
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
          workerBuildSha: workerBuildIdentity?.source_sha || null,
          workerBundleSha256: workerBuildIdentity?.bundle_sha256 || null,
          surfaceRegistryVersion: verification.surfaceRegistryVersion,
          sourceOpenapiSha256: policy.source_openapi_sha256,
          surfaceRegistrySha256: policy.surface_registry_sha256,
          warningBudget: policy.warning_budget,
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
          const upstream = await fetchImpl(new URL(policy.ready_provenance?.health_path || "/health", policy.upstream_origin), {
            method: "GET",
            headers: policy.policy_key === "activation_gateway_staging"
              ? forwardedRequestHeaders(request, policy, requestId) : { "x-request-id": requestId },
            redirect: "manual",
            signal: controller.signal,
          });
          upstreamStatus = upstream.status;
          const evidence = await verifyUpstreamReadinessEvidence(upstream, policy, verification);
          if (!evidence.ok) {
            status = evidence.nonReady ? 503 : 503;
            return jsonResponse(status, evidence.nonReady
              ? {
                ok: false,
                service: "activation-gateway",
                upstreamReady: false,
                upstreamEvidenceVerified: false,
                policyHash: policy.content_hash_sha256,
                secretsIncluded: false,
              }
              : errorBody(evidence.code, "The upstream deployment evidence could not be verified.", requestId, evidence.details), requestId);
          }
          status = 200;
          return jsonResponse(status, {
            ok: true,
            service: "activation-gateway",
            upstreamReady: true,
            upstreamEvidenceVerified: true,
            policyHash: policy.content_hash_sha256,
            upstreamPolicyHash: evidence.policyHash,
            upstreamSourceCommit: evidence.sourceCommit,
            upstreamDeploymentId: evidence.deploymentId,
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
            headers: forwardedRequestHeaders(request, policy, requestId, { allowOauthSessionCookie: oauthHandoff.allow_session_cookie === true }),
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
        return new Response(responseBody, { status, headers: filteredResponseHeaders(upstream, requestId, policy, { allowOauthSessionCookie: oauthHandoff.allow_session_cookie === true }) });
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
        status = 503;
        return jsonResponse(status, errorBody("GATEWAY_POLICY_STALE", "The Activation Gateway policy is stale; no route is served during the stale interval.", requestId, {
          freshness_class: route.freshness_class || (route.mutation ? "mutation_strict" : "read_strict"),
        }), requestId);
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
          headers: policy.policy_key === "activation_gateway_staging" && url.pathname.startsWith("/admin/recovery/staging/")
            ? await signedRecoveryIngressHeaders(request, policy, requestId, verification, env, workerBuildIdentity, cryptoImpl, now)
            : forwardedRequestHeaders(request, policy, requestId),
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
