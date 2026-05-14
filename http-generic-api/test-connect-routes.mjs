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
import { buildOnboardingRoutes } from "./routes/onboardingRoutes.js";

const TENANT_SCOPE_LINKS = [
  "https://auth.mad4b.com/scopes/tenant.links",
  "https://auth.mad4b.com/scopes/tenant.status",
  "https://auth.mad4b.com/scopes/tenant.activation",
  "https://auth.mad4b.com/scopes/tenant.install",
  "https://auth.mad4b.com/scopes/tenant.system-tools",
];

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

// Regression guard: legacy onboarding is mounted first to prove it cannot shadow /connect.
app.use(buildOnboardingRoutes({}));
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
    assert("connect shell is not legacy onboarding page", !html.includes("Mad4B Connector Setup"));
    assert("connect shell links privacy policy", html.includes('href="/privacy-policy"'));
    assert("connect shell links terms of use", html.includes('href="/terms-of-use"'));
  }

  section("auth openapi contract");

  {
    // MCP-style tenant schema: five meta-operations replace all explicit paths.
    // Connect/system operations are now accessed via callTool (discovered through listTools).
    const doc = yaml.load(readFileSync("openapi.tenant-gpt.auth.yaml", "utf8"));
    const exposedPaths = Object.keys(doc.paths || {});
    const securityScheme = doc.components?.securitySchemes?.userBearerAuth;
    const callToolSchema = doc.paths?.["/gpt/tools/call"]?.post?.requestBody?.content?.["application/json"]?.schema;
    const allOperations = exposedPaths.flatMap((pathKey) => {
      const pathItem = doc.paths[pathKey] || {};
      return Object.entries(pathItem)
        .filter(([method]) => ["get", "post", "put", "delete", "patch"].includes(method))
        .map(([method, operation]) => ({ pathKey, method, operation }));
    });
    const postOps = allOperations.filter(({ method }) => method === "post");

    assert("tenant GPT schema uses OAuth action auth", securityScheme?.type === "oauth2", JSON.stringify(securityScheme));
    assert("tenant GPT schema declares authorization code flow", Boolean(securityScheme?.flows?.authorizationCode), JSON.stringify(securityScheme));

    const scopeKeys = Object.keys(securityScheme?.flows?.authorizationCode?.scopes || {});
    assert("tenant GPT schema declares linked tenant scopes", TENANT_SCOPE_LINKS.every((scope) => scopeKeys.includes(scope)), JSON.stringify(scopeKeys));

    // MCP schema: scopes are declared in the flows object; individual operations use userBearerAuth: []
    // (no per-operation scope arrays — authentication is enforced, scope grant is in the OAuth consent)
    assert("tenant GPT schema root security uses userBearerAuth", "userBearerAuth" in (doc.security?.[0] ?? {}), JSON.stringify(doc.security));
    assert("tenant GPT schema all operations require userBearerAuth",
      allOperations.every(({ operation }) => "userBearerAuth" in (operation.security?.[0] ?? {})),
      allOperations.filter(({ operation }) => !("userBearerAuth" in (operation.security?.[0] ?? {}))).map(({ pathKey }) => pathKey).join(", "));

    assert("tenant GPT schema carries action auth preset", doc["x-gpt-action-auth-preset"]?.client_id === "mad4b-tenant-gpt", JSON.stringify(securityScheme));
    assert("tenant GPT schema preset carries scope links", TENANT_SCOPE_LINKS.every((scope) => doc["x-gpt-action-auth-preset"]?.scope_links?.includes(scope)), JSON.stringify(doc["x-gpt-action-auth-preset"]));
    assert("tenant GPT schema hides OAuth plumbing operations", !exposedPaths.some((path) => path.startsWith("/auth/")), exposedPaths.join(", "));

    // MCP meta-operations (connect/system tools are now accessible via callTool)
    assert("tenant GPT schema exposes activateSession", exposedPaths.includes("/activation/session-context"), exposedPaths.join(", "));
    assert("tenant GPT schema exposes listTools", exposedPaths.includes("/gpt/tools"), exposedPaths.join(", "));
    assert("tenant GPT schema exposes callTool", exposedPaths.includes("/gpt/tools/call"), exposedPaths.join(", "));
    assert("tenant GPT schema exposes writeSessionTurn", exposedPaths.includes("/gpt/sessions/{id}/turn"), exposedPaths.join(", "));
    assert("tenant GPT schema exposes endSession", exposedPaths.includes("/gpt/sessions/{id}/end"), exposedPaths.join(", "));

    assert("tenant GPT callTool body requires name", Array.isArray(callToolSchema?.required) && callToolSchema.required.includes("name"));
    assert("tenant GPT all POST operations are non-consequential",
      postOps.every(({ operation }) => operation["x-openai-isConsequential"] === false),
      postOps.filter(({ operation }) => operation["x-openai-isConsequential"] !== false).map(({ pathKey }) => pathKey).join(", "));
    assert("tenant GPT schema does not expose admin provider-bootstrap paths", !exposedPaths.some((p) => p.startsWith("/admin/")), exposedPaths.join(", "));
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

  section("local connector GPT action schema");

  {
    const doc = yaml.load(readFileSync("openapi.gpt-action.local-connector.yaml", "utf8"));
    const exposedPaths = Object.keys(doc.paths || {});
    const allOperations = exposedPaths.flatMap((pathKey) => {
      const pathItem = doc.paths[pathKey] || {};
      return Object.entries(pathItem)
        .filter(([method]) => ["get", "post", "put", "delete", "patch"].includes(method))
        .map(([method, operation]) => ({ pathKey, method, operation }));
    });
    const postOps = allOperations.filter(({ method }) => method === "post");
    const securityScheme = doc.components?.securitySchemes?.backendBearerAuth;

    assert("local connector schema uses OpenAPI 3.1", doc.openapi === "3.1.0", doc.openapi);
    assert("local connector schema has connector.mad4b.com server", doc.servers?.[0]?.url === "https://connector.mad4b.com", doc.servers?.[0]?.url);
    assert("local connector schema uses backendBearerAuth", securityScheme?.type === "http" && securityScheme?.scheme === "bearer");
    assert("local connector schema has root security", "backendBearerAuth" in (doc.security?.[0] ?? {}));

    assert("local connector schema exposes /health", exposedPaths.includes("/health"));
    assert("local connector schema exposes /github", exposedPaths.includes("/github"));
    assert("local connector schema exposes /gcloud", exposedPaths.includes("/gcloud"));
    assert("local connector schema exposes /shell", exposedPaths.includes("/shell"));
    assert("local connector schema exposes /files", exposedPaths.includes("/files"));
    assert("local connector schema exposes /fetch-upload", exposedPaths.includes("/fetch-upload"));
    assert("local connector schema exposes /shell-fetch-upload", exposedPaths.includes("/shell-fetch-upload"));

    assert("local connector /health has no auth (security: [])",
      Array.isArray(doc.paths["/health"]?.get?.security) && doc.paths["/health"].get.security.length === 0);

    assert("local connector all POST operations are non-consequential",
      postOps.every(({ operation }) => operation["x-openai-isConsequential"] === false),
      postOps.filter(({ operation }) => operation["x-openai-isConsequential"] !== false).map(({ pathKey }) => pathKey).join(", "));

    const MAX_DESC = 300;
    function collectLongDescs(node, path = "$") {
      if (!node || typeof node !== "object") return [];
      const out = [];
      if (typeof node.description === "string" && node.description.length > MAX_DESC)
        out.push(`${path}:${node.description.length}`);
      for (const [k, v] of Object.entries(node)) out.push(...collectLongDescs(v, `${path}.${k}`));
      return out;
    }
    const longDescs = collectLongDescs(doc);
    assert("local connector all descriptions are <= 300 chars", longDescs.length === 0, longDescs.join(", "));

    const shellCallSchema = doc.paths?.["/shell"]?.post?.requestBody?.content?.["application/json"]?.schema;
    assert("local connector /shell requires action field",
      Array.isArray(shellCallSchema?.required) && shellCallSchema.required.includes("action"));

    const uploadPaths = ["/fetch-upload", "/shell-fetch-upload"];
    for (const p of uploadPaths) {
      const s = doc.paths?.[p]?.post?.requestBody?.content?.["application/json"]?.schema;
      assert(`local connector ${p} requires url and upload_type`,
        Array.isArray(s?.required) && s.required.includes("url") && s.required.includes("upload_type"));
    }
  }

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
console.log("ALL CONNECT ROUTE TESTS PASS");
