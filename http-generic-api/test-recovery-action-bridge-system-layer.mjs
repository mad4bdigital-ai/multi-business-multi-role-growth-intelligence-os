import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import { buildSystemLayerRoutes } from "./routes/systemLayerRoutes.js";

const TOOL_NAME = "recovery_kernel_execute_approved_step";
const APPROVAL_TOOL_NAME = "recovery_kernel_create_approval_challenge";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(buildSystemLayerRoutes({
    requireBackendApiKey: (req, _res, next) => {
      req.auth = { is_admin: req.headers["x-admin"] === "true", tenant_id: "tenant:test" };
      next();
    },
    requireAdminPrincipal: (req, _res, next) => {
      req.auth = { ...(req.auth || {}), is_admin: true, tenant_id: null };
      next();
    },
    env: { NODE_ENV: "production" },
    recoveryKernelEnv: { NODE_ENV: "production" },
  }));
  return app;
}

async function start(app) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  return { status: response.status, body: await response.json() };
}

test("private recovery bridge descriptor is admin-visible and tenant-hidden", async () => {
  const { server, baseUrl } = await start(buildApp());
  try {
    const admin = await request(baseUrl, `/system/tools/${TOOL_NAME}`, { headers: { "x-admin": "true" } });
    assert.equal(admin.status, 200);
    assert.equal(admin.body.tool.name, TOOL_NAME);
    assert.equal(admin.body.tool.requires_admin, true);
    assert.equal(admin.body.tool.catalog_level, "private_recovery");
    assert.equal(Object.hasOwn(admin.body.tool.inputSchema.properties, "execution_ticket_id"), false);
    assert.equal(Object.hasOwn(admin.body.tool.inputSchema.properties, "execution_ticket_hash"), false);
    assert.equal(Object.hasOwn(admin.body.tool.inputSchema.properties, "signature"), false);

    const tenant = await request(baseUrl, `/system/tools/${TOOL_NAME}`, { headers: { "x-admin": "false" } });
    assert.equal(tenant.status, 404);
    assert.equal(tenant.body.error.code, "SYSTEM_TOOL_NOT_FOUND");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("approval challenge tool is admin-visible, tenant-hidden, and excludes token/ticket fields", async () => {
  const { server, baseUrl } = await start(buildApp());
  try {
    const admin = await request(baseUrl, `/system/tools/${APPROVAL_TOOL_NAME}`, { headers: { "x-admin": "true" } });
    assert.equal(admin.status, 200);
    assert.equal(admin.body.tool.name, APPROVAL_TOOL_NAME);
    assert.equal(admin.body.tool.requires_admin, true);
    assert.equal(admin.body.tool.catalog_level, "private_recovery");
    assert.deepEqual(admin.body.tool.inputSchema.required, ["plan_id", "plan_hash", "step_id"]);
    assert.equal(Object.hasOwn(admin.body.tool.inputSchema.properties, "approval_token"), false);
    assert.equal(Object.hasOwn(admin.body.tool.inputSchema.properties, "execution_ticket_id"), false);
    assert.equal(Object.hasOwn(admin.body.tool.inputSchema.properties, "signature"), false);

    const tenant = await request(baseUrl, `/system/tools/${APPROVAL_TOOL_NAME}`, { headers: { "x-admin": "false" } });
    assert.equal(tenant.status, 404);
    assert.equal(tenant.body.error.code, "SYSTEM_TOOL_NOT_FOUND");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("approval challenge tool rejects caller-supplied approval and ticket controls", async () => {
  const { server, baseUrl } = await start(buildApp());
  try {
    const response = await request(baseUrl, "/admin/system/tools/call", {
      method: "POST",
      headers: { "x-admin": "true" },
      body: JSON.stringify({
        name: APPROVAL_TOOL_NAME,
        tool_args: {
          plan_id: "plan:1234567890abcdef",
          plan_hash: "a".repeat(64),
          step_id: "step:1234567890abcdef",
          approval_token: "caller-must-not-supply",
        },
      }),
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "recovery_kernel_create_approval_challenge_field_forbidden");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("non-admin cannot call the private bridge and admin default composition fails closed", async () => {
  const { server, baseUrl } = await start(buildApp());
  const args = {
    plan_id: "plan:1234567890abcdef",
    plan_hash: "a".repeat(64),
    step_id: "step:1234567890abcdef",
    approval_token: "bound-approval-token-system-layer",
    idempotency_key: "idempotency:system-layer-001",
  };
  try {
    const tenant = await request(baseUrl, "/system/tools/call", {
      method: "POST",
      headers: { "x-admin": "false" },
      body: JSON.stringify({ name: TOOL_NAME, tool_args: args }),
    });
    assert.equal(tenant.status, 403);
    assert.equal(tenant.body.error.code, "admin_system_tool_required");

    const admin = await request(baseUrl, "/admin/system/tools/call", {
      method: "POST",
      headers: { "x-admin": "true" },
      body: JSON.stringify({ name: TOOL_NAME, tool_args: args }),
    });
    assert.equal(admin.status, 503);
    assert.equal(admin.body.error.code, "recovery_action_bridge_authority_unavailable");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

console.log("recovery action bridge system-layer tests loaded");
