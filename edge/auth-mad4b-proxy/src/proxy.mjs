export const TRANSIENT_EDGE_STATUSES = new Set([
  502,
  503,
  504,
  522,
  523,
  524,
  525,
  526,
  530,
]);

const REQUEST_ID_HEADERS = ["x-request-id", "x-correlation-id", "cf-ray"];
const INGRESS_ATTESTATION_HEADER = "x-mad4b-ingress-attestation";
const PRODUCTION_PUBLIC_HOSTS = new Set([
  "auth.mad4b.com",
  "mcp.mad4b.com",
  "activation.mad4b.com",
]);

function safeTransportCode(error) {
  const code = String(error?.code || "").trim();
  return /^[A-Z0-9_]{2,64}$/.test(code) ? code : undefined;
}

function compact(value, max = 512) {
  return String(value ?? "").trim().slice(0, max);
}

function base64Url(bytes) {
  const chars = Array.from(new Uint8Array(bytes), (byte) => String.fromCharCode(byte)).join("");
  return btoa(chars).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function signingConfig(env = {}) {
  const privateKeyJwk = compact(env.AUTH_MAD4B_PROXY_INGRESS_PRIVATE_KEY_JWK, 16384);
  const keyId = compact(env.AUTH_MAD4B_PROXY_INGRESS_KEY_ID, 128);
  const issuer = compact(env.AUTH_MAD4B_PROXY_INGRESS_ISSUER, 256);
  const audience = compact(env.AUTH_MAD4B_PROXY_INGRESS_AUDIENCE, 256);
  const deploymentSha = compact(env.AUTH_MAD4B_PROXY_ORIGIN_DEPLOYMENT_SHA, 64).toLowerCase();
  const values = [privateKeyJwk, keyId, issuer, audience, deploymentSha];
  const any = values.some(Boolean);
  const complete = values.every(Boolean) && /^[a-f0-9]{40}$/u.test(deploymentSha);
  return { any, complete, privateKeyJwk, keyId, issuer, audience, deploymentSha };
}

function publicRequestHost(request) {
  try {
    return new URL(request.url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

async function signIngressAttestation({ request, env, requestId, randomUUID, now }) {
  const config = signingConfig(env);
  if (!config.any) return { configured: false, header: null };
  if (!config.complete) {
    const error = new Error("Production ingress signing configuration is incomplete.");
    error.code = "EDGE_INGRESS_SIGNING_CONFIG_INCOMPLETE";
    throw error;
  }

  const host = publicRequestHost(request);
  if (!PRODUCTION_PUBLIC_HOSTS.has(host)) {
    const error = new Error("The request host is outside the governed Production ingress allowlist.");
    error.code = "EDGE_INGRESS_HOST_NOT_ALLOWED";
    throw error;
  }

  let privateJwk;
  try {
    privateJwk = JSON.parse(config.privateKeyJwk);
  } catch {
    const error = new Error("The Production ingress private key is not valid JSON.");
    error.code = "EDGE_INGRESS_PRIVATE_KEY_INVALID";
    throw error;
  }

  let key;
  try {
    key = await crypto.subtle.importKey("jwk", privateJwk, { name: "Ed25519" }, false, ["sign"]);
  } catch {
    const error = new Error("The Production ingress private key cannot be imported as Ed25519.");
    error.code = "EDGE_INGRESS_PRIVATE_KEY_INVALID";
    throw error;
  }

  const nowSeconds = Math.floor(now() / 1000);
  const claims = {
    iss: config.issuer,
    aud: config.audience,
    iat: nowSeconds - 1,
    exp: nowSeconds + 30,
    host,
    deployment_sha: config.deploymentSha,
    request_id: requestId,
    jti: randomUUID(),
    key_id: config.keyId,
  };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(claims));
  const signature = await crypto.subtle.sign("Ed25519", key, payloadBytes);
  return {
    configured: true,
    header: `${base64Url(payloadBytes)}.${base64Url(signature)}`,
    host,
    keyId: config.keyId,
  };
}

export function resolveRequestId(request, randomUUID = () => crypto.randomUUID()) {
  for (const headerName of REQUEST_ID_HEADERS) {
    const value = String(request.headers.get(headerName) || "").trim();
    if (value) return value;
  }
  return randomUUID();
}

export async function isStructuredErrorResponse(response) {
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("json")) return false;

  try {
    const payload = await response.clone().json();
    return Boolean(
      payload &&
        typeof payload === "object" &&
        payload.error &&
        typeof payload.error === "object" &&
        typeof payload.error.code === "string" &&
        typeof payload.error.message === "string",
    );
  } catch {
    return false;
  }
}

export function createEdgeErrorResponse({
  status = 503,
  requestId,
  retryAfter,
  transportCode,
  code = "EDGE_ORIGIN_UNAVAILABLE",
  message = "The upstream service is temporarily unavailable.",
  extraDetails = {},
} = {}) {
  const normalizedStatus = TRANSIENT_EDGE_STATUSES.has(Number(status)) ? Number(status) : 503;
  const details = {
    source: "cloudflare_worker",
    upstream_status: normalizedStatus,
    retryable: true,
    readback_required_before_retry: true,
    ...extraDetails,
  };
  if (transportCode) details.transport_code = transportCode;

  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-request-id": requestId,
  });
  if (retryAfter) headers.set("retry-after", retryAfter);

  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        code,
        message,
        details,
        requestId,
      },
      secrets_included: false,
    }),
    { status: normalizedStatus, headers },
  );
}

export function createAuthProxyHandler({
  fetchImpl = fetch,
  randomUUID = () => crypto.randomUUID(),
  now = () => Date.now(),
  originHost = "auth.mad4b.com",
  originIp = "147.93.49.130",
} = {}) {
  return async function handleAuthProxyRequest(request, env = {}) {
    const requestId = resolveRequestId(request, randomUUID);
    const headers = new Headers(request.headers);
    const publicHost = publicRequestHost(request);

    headers.delete("cf-connecting-ip");
    headers.delete("x-forwarded-for");
    headers.delete("x-real-ip");
    headers.delete("forwarded");
    headers.delete("x-forwarded-host");
    headers.delete("x-original-host");
    headers.delete(INGRESS_ATTESTATION_HEADER);
    headers.set("host", originHost);
    headers.set("x-request-id", requestId);
    headers.set("x-forwarded-host", publicHost);
    headers.set("x-forwarded-proto", "https");

    try {
      const attestation = await signIngressAttestation({ request, env, requestId, randomUUID, now });
      if (attestation.configured) headers.set(INGRESS_ATTESTATION_HEADER, attestation.header);
    } catch (error) {
      return createEdgeErrorResponse({
        status: 503,
        requestId,
        code: "EDGE_INGRESS_ATTESTATION_UNAVAILABLE",
        message: "The Production trusted-ingress attestation could not be produced.",
        extraDetails: { reason_code: safeTransportCode(error) || compact(error?.code, 64) || "EDGE_INGRESS_SIGNING_FAILED" },
      });
    }

    const init = {
      method: request.method,
      headers,
      redirect: "follow",
      cf: { resolveOverride: originIp },
    };
    if (!new Set(["GET", "HEAD"]).has(request.method)) init.body = request.body;

    let response;
    try {
      response = await fetchImpl(request.url, init);
    } catch (error) {
      return createEdgeErrorResponse({
        status: 503,
        requestId,
        transportCode: safeTransportCode(error),
      });
    }

    if (!TRANSIENT_EDGE_STATUSES.has(response.status)) return response;
    if (await isStructuredErrorResponse(response)) return response;

    return createEdgeErrorResponse({
      status: response.status,
      requestId,
      retryAfter: response.headers.get("retry-after"),
    });
  };
}
