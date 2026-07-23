// frontend-surface-operation: POST /connect/activate

import assert from "node:assert/strict";
import express from "express";
import { buildConnectRoutes } from "./routes/connectRoutes.js";
import { sanitizeMetadataPayload } from "./requestSecretBoundary.js";

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

{
  const allowlist = new Set(["cms", "socials"]);
  const payload = JSON.parse('{"cms":{"site":"example.com","connection":{"api_key":"nested-secret"},"__proto__":{"polluted":true}},"socials":[{"name":"safe","refresh_token":"nested-token"}]}');
  const { sanitized, dropped } = sanitizeMetadataPayload(payload, allowlist);
  assert.equal(sanitized.cms.site, "example.com");
  assert.equal(sanitized.socials[0].name, "safe");
  assert.equal("api_key" in sanitized.cms.connection, false);
  assert.equal("refresh_token" in sanitized.socials[0], false);
  assert(dropped.includes("cms.connection.api_key"));
  assert(dropped.includes("socials[0].refresh_token"));
  assert(dropped.includes("cms.__proto__"));
  assert.equal(Object.prototype.polluted, undefined);
}

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.auth = { mode: "user_jwt", user_id: "user-test", tenant_id: "tenant-test" };
  next();
});
app.use(buildConnectRoutes());

const { server, baseUrl } = await startServer(app);
try {
  const response = await fetch(`${baseUrl}/connect/activate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mode: "dedicated",
      provider: { credentials: { cf_api_token: "must-not-enter-control-plane" } },
    }),
  });
  const body = await response.json();
  const serialized = JSON.stringify(body);
  assert.equal(response.status, 400);
  assert.equal(body?.error?.code, "raw_credentials_not_accepted");
  assert.equal(body?.error?.details?.credential_intake_endpoint, "/connect/api/credential-intake/sessions");
  assert.equal(body?.error?.details?.rejected_fields_redacted, true);
  assert.equal(serialized.includes("cf_api_token"), false);
  assert.equal(serialized.includes("must-not-enter-control-plane"), false);
} finally {
  server.close();
}

console.log("Connect secret-boundary tests passed");
