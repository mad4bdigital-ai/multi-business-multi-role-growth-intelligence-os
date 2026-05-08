/**
 * test-connect-routes.mjs
 *
 * Fast validation checks for tenant connection onboarding routes.
 * These tests stay before DB/provisioning work so they are deterministic.
 *
 * Run: node test-connect-routes.mjs
 */

import express from "express";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { buildConnectRoutes } from "./routes/connectRoutes.js";

let passed = 0;
let failed = 0;

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  [PASS] ${label}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${label}${detail ? ` - ${detail}` : ""}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n== ${name}`);
}

function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { parse_error: true, text };
  }
}

async function post(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await readJson(response) };
}

async function getRaw(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  const body = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    contentType: response.headers.get("content-type") || "",
    cacheControl: response.headers.get("cache-control") || "",
    body,
  };
}

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.auth = {
    mode: "user_jwt",
    user_id: "test-user",
    tenant_id: "test-tenant",
    is_admin: false,
  };
  next();
});
app.use(buildConnectRoutes({
  requireBackendApiKey: (_req, _res, next) => next(),
}));

const { server, baseUrl } = await startServer(app);

try {
  section("connect page public assets");

  {
    const result = await getRaw(baseUrl, "/connect/assets/mad4b-logo-1080.png");
    assert("serves raster MAD4B logo asset", result.status === 200, `${result.status}`);
    assert("logo asset is png", result.contentType === "image/png", result.contentType);
    assert("logo asset is cacheable", result.cacheControl.includes("max-age=86400"), result.cacheControl);
    assert("logo asset has png signature", result.body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
  }

  {
    const result = await getRaw(baseUrl, "/connect");
    assert("connect shell references app bundle", result.status === 200, `${result.status}`);
    const html = result.body.toString("utf8");
    assert("connect shell title matches OAuth app name", html.includes("<title>Growth Intelligence Platform · Connect</title>"));
    assert("connect shell includes exact OAuth app name", html.includes("Growth Intelligence Platform"));
    assert("connect shell links privacy policy", html.includes('href="/privacy-policy"'));
    assert("connect shell links terms of use", html.includes('href="/terms-of-use"'));
  }

  section("auth openapi contract");

  {
    const doc = yaml.load(readFileSync("openapi.tenant-gpt.auth.yaml", "utf8"));
    const exposedPaths = Object.keys(doc.paths || {});
    const activateSchema = doc.paths?.["/connect/activate"]?.post?.requestBody?.content?.["application/json"]?.schema;
    const statusConnection = doc.paths?.["/connect/status"]?.get?.responses?.["200"]?.content?.["application/json"]?.schema?.properties?.connection;
    const deviceResponse = doc.paths?.["/connect/device-install"]?.post?.responses?.["200"]?.content?.["application/json"]?.schema;
    assert("tenant GPT schema hides OAuth plumbing operations", !exposedPaths.some((path) => path.startsWith("/auth/")), exposedPaths.join(", "));
    assert("activate schema exposes n8n activation mode", Array.isArray(activateSchema?.properties?.n8n_activation_mode?.enum), JSON.stringify(activateSchema?.properties));
    assert("n8n activation enum supports managed main server", activateSchema.properties.n8n_activation_mode.enum.includes("managed_main_server"));
    assert("n8n activation enum supports self hosted local", activateSchema.properties.n8n_activation_mode.enum.includes("self_hosted_local"));
    assert("status schema returns n8n activation mode", Array.isArray(statusConnection?.properties?.n8n_activation_mode?.enum), JSON.stringify(statusConnection?.properties));
    assert("device install schema returns app routes", deviceResponse?.properties?.app_routes?.type === "array", JSON.stringify(deviceResponse?.properties));
    assert("device install schema returns installation bundle", deviceResponse?.properties?.installation?.type === "object", JSON.stringify(deviceResponse?.properties));
  }

  section("connect activation validation");

  {
    const result = await post(baseUrl, "/connect/activate", {
      mode: "unsupported",
      n8n_activation_mode: "managed_main_server",
    });
    assert("activate rejects invalid connection mode", result.status === 400, JSON.stringify(result.body));
    assert("invalid connection mode has stable code", result.body?.error?.code === "invalid_mode", JSON.stringify(result.body));
  }

  {
    const result = await post(baseUrl, "/connect/activate", {
      mode: "managed",
      n8n_activation_mode: "desktop",
    });
    assert("activate rejects invalid n8n activation mode", result.status === 400, JSON.stringify(result.body));
    assert("invalid n8n activation mode has stable code", result.body?.error?.code === "invalid_n8n_activation_mode", JSON.stringify(result.body));
  }

  section("device install validation");

  {
    const result = await post(baseUrl, "/connect/device-install", {});
    assert("device install rejects missing device_id", result.status === 400, JSON.stringify(result.body));
    assert("missing device_id has stable code", result.body?.error?.code === "invalid_device_id", JSON.stringify(result.body));
  }

  {
    const result = await post(baseUrl, "/connect/device-install", {
      device_id: "../bad",
    });
    assert("device install rejects unsafe device_id", result.status === 400, JSON.stringify(result.body));
    assert("unsafe device_id has stable code", result.body?.error?.code === "invalid_device_id", JSON.stringify(result.body));
  }
} finally {
  server.close();
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL CONNECT ROUTE TESTS PASS");
