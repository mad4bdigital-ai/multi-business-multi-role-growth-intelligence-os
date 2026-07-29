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

function safeTransportCode(error) {
  const code = String(error?.code || "").trim();
  return /^[A-Z0-9_]{2,64}$/.test(code) ? code : undefined;
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
} = {}) {
  const normalizedStatus = TRANSIENT_EDGE_STATUSES.has(Number(status)) ? Number(status) : 503;
  const details = {
    source: "cloudflare_worker",
    upstream_status: normalizedStatus,
    retryable: true,
    readback_required_before_retry: true,
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
        code: "EDGE_ORIGIN_UNAVAILABLE",
        message: "The upstream service is temporarily unavailable.",
        details,
        requestId,
      },
      secrets_included: false,
    }),
    {
      status: normalizedStatus,
      headers,
    },
  );
}

export function createAuthProxyHandler({
  fetchImpl = fetch,
  randomUUID = () => crypto.randomUUID(),
  originHost = "auth.mad4b.com",
  originIp = "147.93.49.130",
} = {}) {
  return async function handleAuthProxyRequest(request) {
    const requestId = resolveRequestId(request, randomUUID);
    const headers = new Headers(request.headers);
    headers.delete("cf-connecting-ip");
    headers.delete("x-forwarded-for");
    headers.delete("x-real-ip");
    headers.set("host", originHost);
    headers.set("x-request-id", requestId);

    const init = {
      method: request.method,
      headers,
      redirect: "follow",
      cf: {
        resolveOverride: originIp,
      },
    };
    if (!new Set(["GET", "HEAD"]).has(request.method)) {
      init.body = request.body;
    }

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

    if (!TRANSIENT_EDGE_STATUSES.has(response.status)) {
      return response;
    }
    if (await isStructuredErrorResponse(response)) {
      return response;
    }

    return createEdgeErrorResponse({
      status: response.status,
      requestId,
      retryAfter: response.headers.get("retry-after"),
    });
  };
}
