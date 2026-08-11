#!/usr/bin/env node
import assert from "node:assert/strict";
import express from "express";
import { buildRemoteMcpConnectorRoutes } from "./routes/remoteMcpConnectorRoutes.js";
import {
  normalizeRemoteMcpRequestHost,
  resolveRemoteMcpConfiguredHost,
  resolveRemoteMcpEffectiveRequestHost,
} from "./remoteMcpRequestHost.js";

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function buildNoDbPool() {
  return {
    query() {
      throw new Error("remote MCP host isolation test must not query the database");
    },
  };
}

async function postInitialize(baseUrl, forwardedHost, envHeaders = {}) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      origin: "https://chatgpt.com",
      "x-forwarded-host": forwardedHost,
      ...envHeaders,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        clientInfo: { name: "host-isolation-test", version: "1.0.0" },
      },
    }),
  });
  return { status: response.status, body: await response.json() };
}

assert.equal(normalizeRemoteMcpRequestHost("MCP.Example.Test:443"), "mcp.example.test");
assert.equal(normalizeRemoteMcpRequestHost("mcp.example.test,evil.example.test"), "");
assert.equal(normalizeRemoteMcpRequestHost("user@mcp.example.test"), "");
assert.equal(resolveRemoteMcpConfiguredHost({ REMOTE_MCP_RESOURCE_URL: "https://mcp.example.test" }), "mcp.example.test");

{
  const env = {
    REMOTE_MCP_ENABLED: "true",
    REMOTE_MCP_RESOURCE_URL: "https://mcp.example.test",
    REMOTE_MCP_AUTHORIZATION_SERVER_URL: "https://auth.example.test/auth/mcp",
    REMOTE_MCP_ALLOWED_ORIGINS: "https://chatgpt.com",
    REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "true",
  };
  assert.equal(resolveRemoteMcpEffectiveRequestHost({ "x-forwarded-host": "mcp.example.test" }, env), "mcp.example.test");

  const app = express();
  app.use(express.json());
  app.use(buildRemoteMcpConnectorRoutes({ env, pool: buildNoDbPool() }));
  const { server, baseUrl } = await startServer(app);
  try {
    const canonical = await postInitialize(baseUrl, "mcp.example.test");
    assert.equal(canonical.status, 200);
    assert.equal(canonical.body.result.protocolVersion, "2025-06-18");

    for (const wrongHost of [
      "auth.mad4b.com",
      "activation.mad4b.com",
      "unknown.example.test",
      "mcp.example.test,auth.mad4b.com",
    ]) {
      const denied = await postInitialize(baseUrl, wrongHost);
      assert.equal(denied.status, 404, `${wrongHost} must fail closed`);
      assert.equal(denied.body.error.code, "MCP_RESOURCE_NOT_FOUND");
      assert.equal(denied.body.secrets_included, false);
    }
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

{
  const env = {
    REMOTE_MCP_ENABLED: "true",
    REMOTE_MCP_RESOURCE_URL: "https://mcp.example.test",
    REMOTE_MCP_ALLOWED_ORIGINS: "https://chatgpt.com",
    REMOTE_MCP_TRUST_PROXY_HOST_HEADERS: "false",
  };
  const app = express();
  app.use(express.json());
  app.use(buildRemoteMcpConnectorRoutes({ env, pool: buildNoDbPool() }));
  const { server, baseUrl } = await startServer(app);
  try {
    const spoofedForwardedHost = await postInitialize(baseUrl, "mcp.example.test");
    assert.equal(spoofedForwardedHost.status, 404, "forwarded host must not be trusted by default");
    assert.equal(spoofedForwardedHost.body.error.code, "MCP_RESOURCE_NOT_FOUND");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

console.log(JSON.stringify({
  ok: true,
  gate: "remote_mcp_host_isolation",
  canonical_host_positive: true,
  wrong_host_negative_cases: 4,
  forwarded_host_default_trust: false,
  secrets_included: false,
}));
