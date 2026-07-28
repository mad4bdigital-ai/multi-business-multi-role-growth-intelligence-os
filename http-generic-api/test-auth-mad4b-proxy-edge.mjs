import assert from "node:assert/strict";
import {
  createAuthProxyHandler,
  createEdgeErrorResponse,
  isStructuredErrorResponse,
} from "../edge/auth-mad4b-proxy/src/proxy.mjs";

{
  const success = new Response("ok", {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
  let captured;
  const handler = createAuthProxyHandler({
    fetchImpl: async (_url, init) => {
      captured = init;
      return success;
    },
    randomUUID: () => "req_generated",
  });
  const request = new Request("https://auth.mad4b.com/health", {
    headers: {
      "cf-connecting-ip": "203.0.113.10",
      "x-forwarded-for": "203.0.113.10",
      "x-real-ip": "203.0.113.10",
      "x-correlation-id": "req_existing",
    },
  });

  const response = await handler(request);
  assert.equal(response, success);
  assert.equal(captured.headers.get("cf-connecting-ip"), null);
  assert.equal(captured.headers.get("x-forwarded-for"), null);
  assert.equal(captured.headers.get("x-real-ip"), null);
  assert.equal(captured.headers.get("host"), "auth.mad4b.com");
  assert.equal(captured.headers.get("x-request-id"), "req_existing");
  assert.deepEqual(captured.cf, { resolveOverride: "147.93.49.130" });
  assert.equal("body" in captured, false);
}

{
  const structured = new Response(
    JSON.stringify({
      ok: false,
      error: {
        code: "OPERATION_DEPENDENCY_UNAVAILABLE",
        message: "Dependency unavailable.",
        requestId: "req_structured",
      },
      secrets_included: false,
    }),
    {
      status: 503,
      headers: { "content-type": "application/json" },
    },
  );
  assert.equal(await isStructuredErrorResponse(structured), true);
  const handler = createAuthProxyHandler({
    fetchImpl: async () => structured,
    randomUUID: () => "req_unused",
  });
  assert.equal(await handler(new Request("https://auth.mad4b.com/test")), structured);
}

{
  const upstreamHtml = "<html>origin secret token=do-not-return</html>";
  const handler = createAuthProxyHandler({
    fetchImpl: async () =>
      new Response(upstreamHtml, {
        status: 502,
        headers: {
          "content-type": "text/html",
          "retry-after": "30",
        },
      }),
    randomUUID: () => "req_html_502",
  });
  const response = await handler(
    new Request("https://auth.mad4b.com/test", {
      headers: { "x-request-id": "req_from_client" },
    }),
  );
  const bodyText = await response.text();
  const payload = JSON.parse(bodyText);

  assert.equal(response.status, 502);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("retry-after"), "30");
  assert.equal(response.headers.get("x-request-id"), "req_from_client");
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "EDGE_ORIGIN_UNAVAILABLE");
  assert.equal(payload.error.requestId, "req_from_client");
  assert.equal(payload.error.details.source, "cloudflare_worker");
  assert.equal(payload.error.details.upstream_status, 502);
  assert.equal(payload.error.details.retryable, true);
  assert.equal(payload.error.details.readback_required_before_retry, true);
  assert.equal(payload.secrets_included, false);
  assert.equal(bodyText.includes("origin secret"), false);
  assert.equal(bodyText.includes("<html>"), false);
}

{
  const timeout = new Error("upstream timeout with internal details");
  timeout.code = "ETIMEDOUT";
  const handler = createAuthProxyHandler({
    fetchImpl: async () => {
      throw timeout;
    },
    randomUUID: () => "req_timeout",
  });
  const response = await handler(new Request("https://auth.mad4b.com/test"));
  const bodyText = await response.text();
  const payload = JSON.parse(bodyText);

  assert.equal(response.status, 503);
  assert.equal(payload.error.details.transport_code, "ETIMEDOUT");
  assert.equal(payload.error.requestId, "req_timeout");
  assert.equal(bodyText.includes("internal details"), false);
}

{
  const nonTransient = new Response("ordinary failure", { status: 500 });
  const handler = createAuthProxyHandler({
    fetchImpl: async () => nonTransient,
    randomUUID: () => "req_500",
  });
  assert.equal(await handler(new Request("https://auth.mad4b.com/test")), nonTransient);
}

{
  const response = createEdgeErrorResponse({
    status: 530,
    requestId: "req_direct",
  });
  const payload = await response.json();
  assert.equal(response.status, 530);
  assert.equal(payload.error.code, "EDGE_ORIGIN_UNAVAILABLE");
  assert.equal(payload.error.requestId, "req_direct");
}

console.log("auth mad4b edge proxy tests passed");
