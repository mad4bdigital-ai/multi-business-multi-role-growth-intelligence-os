import assert from "node:assert/strict";
import {
  classifyLocalConnectorHttpFailure,
  readLocalConnectorResponse,
} from "./services/localConnectorOrchestrator.js";

function fakeResponse({ status, body, contentType = "application/json", headers = {} }) {
  const normalizedHeaders = new Map(
    Object.entries({ "content-type": contentType, ...headers })
      .map(([key, value]) => [String(key).toLowerCase(), String(value)]),
  );
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        return normalizedHeaders.get(String(name || "").toLowerCase()) || null;
      },
    },
    async text() {
      return String(body ?? "");
    },
  };
}

assert.deepEqual(classifyLocalConnectorHttpFailure(401), {
  code: "connector_credential_invalid",
  message: "The local connector rejected the supplied credential.",
  http_status: 401,
  reason: "credential_invalid",
  retryable: false,
});
assert.equal(classifyLocalConnectorHttpFailure(403).code, "connector_scope_denied");
assert.equal(classifyLocalConnectorHttpFailure(504).code, "connector_timeout");
assert.equal(classifyLocalConnectorHttpFailure(502).retryable, true);
assert.equal(classifyLocalConnectorHttpFailure(429).retryable, true);

await assert.rejects(
  () => readLocalConnectorResponse(fakeResponse({
    status: 502,
    contentType: "text/html",
    headers: { "cf-ray": "transport-ray-1" },
    body: "<html><body>502 Bad Gateway token=super-secret-value</body></html>",
  }), { operation: "connectorGithub" }),
  (error) => {
    assert.equal(error.code, "connector_transport_unavailable");
    assert.equal(error.http_status, 502);
    assert.equal(error.retryable, true);
    assert.equal(error.details.request_id, "transport-ray-1");
    assert.equal(error.details.operation, "connectorGithub");
    assert.equal(error.details.secrets_included, false);
    assert.doesNotMatch(error.details.response_excerpt, /super-secret-value/);
    return true;
  },
);

await assert.rejects(
  () => readLocalConnectorResponse(fakeResponse({
    status: 401,
    body: JSON.stringify({
      ok: false,
      error: { message: "Missing or invalid connector credential" },
    }),
  }), { operation: "connectorBrowser" }),
  (error) => {
    assert.equal(error.code, "connector_credential_invalid");
    assert.equal(error.http_status, 401);
    assert.equal(error.retryable, false);
    assert.equal(error.details.reason, "credential_invalid");
    return true;
  },
);

await assert.rejects(
  () => readLocalConnectorResponse(fakeResponse({
    status: 200,
    contentType: "text/plain",
    body: "not-json",
  })),
  (error) => {
    assert.equal(error.code, "connector_response_invalid");
    assert.equal(error.http_status, 502);
    assert.equal(error.retryable, true);
    return true;
  },
);

const success = await readLocalConnectorResponse(fakeResponse({
  status: 200,
  body: JSON.stringify({ ok: true, result: "connected" }),
}));
assert.deepEqual(success, { ok: true, result: "connected" });

console.log("PASS local connector transport errors");
