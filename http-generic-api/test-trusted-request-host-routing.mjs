import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import express from "express";
import { buildRootDiscoveryRoutes } from "./routes/rootDiscoveryRoutes.js";
import {
  normalizeTrustedRequestHost,
  resolveTrustedRequestHost,
} from "./trustedRequestHost.js";

function startServer(env) {
  return new Promise((resolve) => {
    const app = express();
    app.use(buildRootDiscoveryRoutes({ env }));
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

function getJson(port, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port,
      path: "/",
      method: "GET",
      headers,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        try {
          resolve({
            status: response.statusCode,
            body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
          });
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
    request.end();
  });
}

const routesIndexSource = fs.readFileSync(new URL("./routes/index.js", import.meta.url), "utf8");
assert.match(routesIndexSource, /buildRootDiscoveryRoutes\(deps\)/, "registerRoutes must forward deps to root discovery");

assert.equal(normalizeTrustedRequestHost("Auth.MAD4B.com:443"), "auth.mad4b.com");
assert.equal(normalizeTrustedRequestHost("auth.mad4b.com,activation.mad4b.com"), "");
assert.equal(normalizeTrustedRequestHost("user@auth.mad4b.com"), "");
assert.equal(resolveTrustedRequestHost({ host: "auth.mad4b.com:443" }, {}), "auth.mad4b.com");
assert.equal(resolveTrustedRequestHost({
  host: "auth.mad4b.com",
  "x-forwarded-host": "activation.mad4b.com",
}, { REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "false" }), "auth.mad4b.com");
assert.equal(resolveTrustedRequestHost({
  host: "internal.example.test",
  "x-forwarded-host": "activation.mad4b.com",
}, { REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "true" }), "activation.mad4b.com");
assert.equal(resolveTrustedRequestHost({
  host: "internal.example.test",
  "x-original-host": "auth.mad4b.com",
  "x-forwarded-host": "activation.mad4b.com",
}, { REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "true" }), "");
assert.equal(resolveTrustedRequestHost({
  host: "internal.example.test",
  "x-original-host": "activation.mad4b.com",
  "x-forwarded-host": "activation.mad4b.com",
}, { REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "true" }), "activation.mad4b.com");
assert.equal(resolveTrustedRequestHost({
  host: "auth.mad4b.com",
  "x-forwarded-host": "activation.mad4b.com,evil.example.test",
}, { REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "true" }), "");

{
  const { server, port } = await startServer({ REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "false" });
  try {
    const response = await getJson(port, {
      host: "auth.mad4b.com",
      "x-forwarded-host": "activation.mad4b.com",
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.host, "auth.mad4b.com");
    assert.equal(response.body.scope, "auth-tenant");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

{
  const { server, port } = await startServer({ REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "true" });
  try {
    const response = await getJson(port, {
      host: "internal.example.test",
      "x-forwarded-host": "activation.mad4b.com",
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.host, "activation.mad4b.com");
    assert.equal(response.body.scope, "activation");

    const malformed = await getJson(port, {
      host: "auth.mad4b.com",
      "x-forwarded-host": "activation.mad4b.com,evil.example.test",
    });
    assert.equal(malformed.status, 404);
    assert.equal(malformed.body.error?.code, "unmatched_hostname");

    const unknown = await getJson(port, {
      host: "unknown.example.test",
    });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.error?.code, "unmatched_hostname");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

console.log(JSON.stringify({
  ok: true,
  gate: "trusted_request_host_routing",
  forwarded_headers_fail_closed: true,
  unmatched_hosts_fail_closed: true,
  root_discovery_uses_shared_authority: true,
  root_discovery_deps_forwarded: true,
  secrets_included: false,
}));
