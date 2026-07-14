import assert from "node:assert/strict";
import express from "express";
import fs from "node:fs";
import YAML from "yaml";
import { buildTenantActivationOverlayRoutes } from "./routes/tenantActivationOverlayRoutes.js";

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function requireBackendApiKey(req, _res, next) {
  const mode = req.headers["x-test-auth-mode"];
  if (mode === "tenant") {
    req.auth = {
      mode: "user_jwt",
      is_admin: false,
      tenant_id: "tenant-test-001",
      user_id: "user-test-001",
    };
  } else if (mode === "admin") {
    req.auth = {
      mode: "user_jwt",
      is_admin: true,
      tenant_id: "platform",
      user_id: "admin-test-001",
    };
  }
  next();
}

function workflowEscape(value) {
  return String(value)
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

async function stage(name, callback) {
  try {
    const result = await callback();
    console.log(`tenant activation alias stage passed: ${name}`);
    return result;
  } catch (error) {
    const detail = error?.stack || error?.message || String(error);
    console.error(`::error title=tenant activation alias ${name}::${workflowEscape(detail)}`);
    throw error;
  }
}

await stage("runtime_overlay", async () => {
  const app = express();
  app.use(buildTenantActivationOverlayRoutes({ requireBackendApiKey }));
  const server = await listen(app);
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    {
      const response = await fetch(`${base}/tenant/activation/session-context`);
      assert.equal(response.status, 401);
      const body = await response.json();
      assert.equal(body.error.code, "tenant_activation_subject_required");
      assert.equal(body.secrets_included, false);
    }

    {
      const response = await fetch(`${base}/tenant/activation/session-context`, {
        headers: { "x-test-auth-mode": "admin" },
      });
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error.code, "tenant_activation_subject_required");
    }

    {
      const response = await fetch(`${base}/tenant/activation/session-context?tenant_id=forbidden`, {
        headers: { "x-test-auth-mode": "tenant" },
      });
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.equal(body.error.code, "tenant_activation_query_parameter_not_allowed");
      assert.deepEqual(body.error.details, [{ field: "tenant_id", issue: "unsupported" }]);
      assert.equal(body.secrets_included, false);
    }

    {
      const response = await fetch(`${base}/activation/session-context`);
      assert.equal(response.status, 404, "legacy shared path must fall through for non-tenant principals");
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

const sourceDoc = await stage("canonical_openapi_parse", async () =>
  YAML.parse(fs.readFileSync("openapi.yaml", "utf8"))
);

await stage("canonical_openapi_contract", async () => {
  const tenantOp = sourceDoc.paths?.["/tenant/activation/session-context"]?.get;
  assert.equal(tenantOp?.["x-tenant-gpt-operationId"], "activateSession");
  assert.equal(sourceDoc.paths?.["/activation/session-context"]?.get?.["x-tenant-gpt-operationId"], undefined);
});

const tenantActivation = await stage("tenant_split_parse", async () =>
  YAML.parse(fs.readFileSync("openapi/openapi.tenant-gpt.activation.yaml", "utf8"))
);

await stage("tenant_split_contract", async () => {
  assert.equal(tenantActivation.paths?.["/tenant/activation/session-context"]?.get?.operationId, "activateSession");
  assert.equal(tenantActivation.paths?.["/activation/session-context"], undefined);
});

const adminActivation = await stage("admin_split_parse", async () =>
  YAML.parse(fs.readFileSync("openapi/openapi.custom-gpt.activation-admin.yaml", "utf8"))
);

await stage("admin_split_contract", async () => {
  assert.equal(adminActivation.paths?.["/activation/session-context"]?.get?.operationId, "getActivationSessionContext");
  assert.equal(adminActivation.paths?.["/tenant/activation/session-context"], undefined);
});

const policy = await stage("route_policy_parse", async () =>
  JSON.parse(fs.readFileSync("../edge/activation-gateway/generated/route-policy.json", "utf8"))
);

await stage("route_policy_contract", async () => {
  const tenantPolicyRoute = policy.routes.find((route) => route.path === "/tenant/activation/session-context");
  const adminPolicyRoute = policy.routes.find((route) => route.path === "/activation/session-context");
  assert.deepEqual(tenantPolicyRoute?.auth_profiles, ["tenant_oauth"]);
  assert.deepEqual(adminPolicyRoute?.auth_profiles, ["admin_service"]);
  assert.equal(tenantPolicyRoute.allowed_query_parameters.includes("tenant_id"), false);
  assert.equal(tenantPolicyRoute.allowed_query_parameters.includes("user_id"), false);
  assert.equal(adminPolicyRoute.allowed_query_parameters.includes("tenant_id"), true);
  assert.equal(adminPolicyRoute.allowed_query_parameters.includes("user_id"), true);
});

console.log("Tenant Activation session alias tests passed.");
