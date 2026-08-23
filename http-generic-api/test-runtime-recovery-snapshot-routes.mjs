import assert from "node:assert/strict";
import test from "node:test";

process.env.RUNTIME_RECOVERY_SOURCE_MODE = "repository_snapshot";

const { buildGptToolsRoutes } = await import("./routes/gptToolsRoutes.js");
const { buildActivationRoutes } = await import("./routes/activationRoutes.js");

function passAuth(_req, _res, next) { next(); }

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

function routeHandler(router, method, routePath) {
  const layer = router.stack.find((entry) => entry.route?.path === routePath && entry.route.methods?.[method]);
  assert.ok(layer, `route ${method} ${routePath} must exist`);
  return layer.route.stack.at(-1).handle;
}

test("snapshot routes serve read-only evidence without database access", async () => {
  const gptRouter = buildGptToolsRoutes({ requireBackendApiKey: passAuth });
  const toolsResponse = response();
  await routeHandler(gptRouter, "get", "/gpt/tools")({ query: {}, auth: { mode: "backend_api_key", is_admin: true } }, toolsResponse, () => {});
  assert.equal(toolsResponse.statusCode, 200);
  assert.equal(toolsResponse.body.tools.length, 1);
  assert.equal(toolsResponse.body.tools[0].name, "runtime_recovery_status_read_only");

  const statusResponse = response();
  await routeHandler(gptRouter, "post", "/gpt/tools/call")({
    body: { name: "runtime_recovery_status_read_only", tool_args: {} },
    auth: { mode: "backend_api_key", is_admin: true },
    headers: {},
  }, statusResponse, () => {});
  assert.equal(statusResponse.statusCode, 200);
  assert.equal(statusResponse.body.result.database_connection_performed, false);
  assert.equal(statusResponse.body.result.persistence, "unavailable");

  const blockedResponse = response();
  await routeHandler(gptRouter, "post", "/gpt/tools/call")({
    body: { name: "grant_apply", tool_args: {} },
    auth: { mode: "backend_api_key", is_admin: true },
    headers: {},
  }, blockedResponse, () => {});
  assert.equal(blockedResponse.statusCode, 503);
  assert.equal(blockedResponse.body.error.code, "RUNTIME_RECOVERY_SNAPSHOT_READ_ONLY");

  const activationRouter = buildActivationRoutes({ requireBackendApiKey: passAuth });
  const sessionResponse = response();
  await routeHandler(activationRouter, "get", "/activation/session-context/read-only")({
    query: { read_only: "true" },
    auth: { mode: "backend_api_key", is_admin: true },
    headers: {},
  }, sessionResponse, () => {});
  assert.equal(sessionResponse.statusCode, 200);
  assert.equal(sessionResponse.body.ok, true);
  assert.equal(sessionResponse.body.read_only, true);
  assert.equal(sessionResponse.body.session_id, null);
  assert.equal(sessionResponse.body.session_management.persistent, false);
  assert.equal(sessionResponse.body.conversation_memory.status, "snapshot");
  assert.equal(sessionResponse.body.runtime_recovery_source.database_connection_performed, false);

  const openResponse = response();
  await routeHandler(activationRouter, "get", "/activation/session-context")({
    query: {},
    auth: { mode: "backend_api_key", is_admin: true },
    headers: {},
  }, openResponse, () => {});
  assert.equal(openResponse.statusCode, 503);
  assert.equal(openResponse.body.error.code, "RUNTIME_RECOVERY_SNAPSHOT_READ_ONLY");
});

console.log("runtime recovery snapshot routes contract tests loaded");
