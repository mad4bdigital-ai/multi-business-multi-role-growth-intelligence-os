import assert from "node:assert/strict";
// frontend-surface-operation: GET /tenant/activation/session-context
// frontend-surface-operation: GET /tenant/activation/sessions
// frontend-surface-operation: POST /tenant/activation/sessions/{id}/turns
import express from "express";
import fs from "node:fs";
import YAML from "yaml";
import { buildTenantActivationOverlayRoutes } from "./routes/tenantActivationOverlayRoutes.js";
import { buildGptSessionRoutes } from "./routes/gptSessionRoutes.js";
import { resolveSessionContextSubject } from "./routes/activationRoutes.js";

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function eventually(assertion, attempts = 20) {
  let lastError;
  for (let index = 0; index < attempts; index += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw lastError;
}

const tenantProfiles = {
  tenant: {
    tenant_id: "tenant-test-001",
    user_id: "user-test-001",
    workspace_id: "workspace-id-test-001",
    workspace_key: "workspace-test-001",
    brand_key: "brand-test-001",
  },
  "tenant-a": {
    tenant_id: "tenant-a",
    user_id: "user-a",
    workspace_id: "workspace-id-a",
    workspace_key: "workspace-a",
    brand_key: "brand-a",
  },
  "tenant-b": {
    tenant_id: "tenant-b",
    user_id: "user-b",
    workspace_id: "workspace-id-b",
    workspace_key: "workspace-b",
    brand_key: "brand-b",
  },
};

function requireBackendApiKey(req, _res, next) {
  const profile = tenantProfiles[req.headers["x-test-auth-mode"]];
  if (profile) {
    req.auth = {
      mode: "user_jwt",
      is_admin: false,
      ...profile,
    };
  } else if (req.headers["x-test-auth-mode"] === "admin") {
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

await stage("shared_subject_isolation", async () => {
  const subject = resolveSessionContextSubject({
    query: {},
    auth: {
      mode: "user_jwt",
      is_admin: false,
      ...tenantProfiles["tenant-a"],
    },
  });

  assert.equal(subject.tenant_id, "tenant-a");
  assert.equal(subject.user_id, "user-a");
  assert.equal(subject.workspace_id, "workspace-id-a");
  assert.equal(subject.workspace_key, "workspace-a");
  assert.equal(subject.brand_key, "brand-a");
  assert.equal(subject.context_source, "request_or_auth_context");

  assert.throws(
    () => resolveSessionContextSubject({
      query: { user_id: "user-b" },
      auth: { mode: "user_jwt", is_admin: false, ...tenantProfiles["tenant-a"] },
    }),
    (error) => error.code === "session_context_user_scope_forbidden" && error.status === 403,
  );

  assert.throws(
    () => resolveSessionContextSubject({
      query: { tenant_id: "tenant-b" },
      auth: { mode: "user_jwt", is_admin: false, ...tenantProfiles["tenant-a"] },
    }),
    (error) => error.code === "session_context_tenant_scope_forbidden" && error.status === 403,
  );
});

await stage("runtime_overlay_isolation", async () => {
  const observedContexts = [];
  const dashboardCalls = [];
  const preparedRuns = [];
  const deliveredRuns = [];
  const sessionListQueries = [];
  const chunkCalls = [];
  const runtimePool = {
    source: "tenant-activation-test-pool",
    async query(sql, params) {
      assert.match(sql, /SELECT session_id, originator, session_status, brand_key, workspace_key/);
      assert.match(sql, /WHERE tenant_id = \?\s+AND user_id = \?/);
      assert.match(sql, /AND originator = 'gpt_action'/);
      assert.doesNotMatch(sql, /SELECT\s+\*|cs\.\*|base_instructions|git_|metadata_json|email/i);
      sessionListQueries.push({ sql, params: [...params] });
      const [tenantId, userId] = params;
      return [[{
        session_id: `session-${tenantId}`,
        originator: "gpt_action",
        session_status: "active",
        brand_key: `brand-${tenantId}`,
        workspace_key: `workspace-${tenantId}`,
        turn_count: 2,
        started_at: "2026-07-18T00:00:00.000Z",
        ended_at: null,
        created_at: "2026-07-18T00:00:00.000Z",
        tenant_id: tenantId,
        user_id: userId,
        base_instructions_text: `secret-${tenantId}`,
        metadata_json: JSON.stringify({ token: `secret-${tenantId}` }),
      }]];
    },
  };

  const app = express();
  app.use(buildTenantActivationOverlayRoutes({
    requireBackendApiKey,
    getRuntimePool: () => runtimePool,
    buildSessionContext: async (req) => {
      const subject = {
        tenant_id: req.auth.tenant_id,
        user_id: req.auth.user_id,
        workspace_id: req.auth.workspace_id,
        workspace_key: req.auth.workspace_key,
        brand_key: req.auth.brand_key,
        context_source: "request_or_auth_context",
        is_admin: false,
      };
      observedContexts.push({ subject, query: { ...req.query } });
      return {
        run_id: `run-${subject.tenant_id}`,
        subject,
        status: {
          session_context_reachable: true,
          stored_turns_available: true,
          turn_content_loaded: false,
        },
        turn_availability: {
          stored_turn_count: 2,
          stored_session_count: 1,
          include_turns: false,
          turns_limit: 0,
        },
        recent_session_summaries: [{
          summary_id: `summary-${subject.tenant_id}`,
          session_id: `session-${subject.tenant_id}`,
          tenant_id: subject.tenant_id,
          user_id: subject.user_id,
          workspace_key: subject.workspace_key,
          brand_key: subject.brand_key,
          turn_count: 2,
        }],
        stored_turn_previews: [],
        graph_memory: {
          requested: true,
          resolved: true,
          asset_count: 1,
          asset_keys: [`asset:${subject.tenant_id}:${subject.workspace_key}:${subject.brand_key}`],
          secrets_included: false,
        },
        transport_chunk_fixture: "x".repeat(6000),
        secrets_included: false,
      };
    },
    buildGrowthDashboard: async ({ tenantId, userId, containerKey, tabKey }) => {
      dashboardCalls.push({ tenantId, userId, containerKey, tabKey });
      return {
        ok: true,
        tenant_id: tenantId,
        user_id: userId,
        active_container: { container_key: containerKey || "tenant_growth" },
        navigation: { active_tab: tabKey || "tenant_today" },
        secrets_included: false,
      };
    },
    markRunPrepared: async (pool, payload) => {
      assert.equal(pool, runtimePool);
      preparedRuns.push(payload);
    },
    markRunDelivered: async (pool, payload) => {
      assert.equal(pool, runtimePool);
      deliveredRuns.push(payload);
    },
    chunkResponse: async (body, options) => {
      chunkCalls.push({ body, options });
      return body;
    },
  }));

  const server = await listen(app);
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const unauthenticated = await fetch(`${base}/tenant/activation/session-context`);
    assert.equal(unauthenticated.status, 401);
    assert.equal((await unauthenticated.json()).error.code, "tenant_activation_subject_required");

    const admin = await fetch(`${base}/tenant/activation/session-context`, {
      headers: { "x-test-auth-mode": "admin" },
    });
    assert.equal(admin.status, 401);
    assert.equal((await admin.json()).error.code, "tenant_activation_subject_required");

    const forbiddenParameters = [
      "tenant_id",
      "user_id",
      "workspace_id",
      "workspace_key",
      "brand_key",
      "include_turns",
      "context_scope",
    ];

    for (const field of forbiddenParameters) {
      const response = await fetch(`${base}/tenant/activation/session-context?${field}=forbidden`, {
        headers: { "x-test-auth-mode": "tenant" },
      });
      assert.equal(response.status, 400, `${field} must be rejected on the Tenant activation surface`);
      const body = await response.json();
      assert.equal(body.error.code, "tenant_activation_query_parameter_not_allowed");
      assert.deepEqual(body.error.details, [{ field, issue: "unsupported" }]);
      assert.equal(body.secrets_included, false);
    }

    const unauthenticatedList = await fetch(`${base}/tenant/activation/sessions`);
    assert.equal(unauthenticatedList.status, 401);
    assert.equal((await unauthenticatedList.json()).error.code, "tenant_activation_subject_required");

    const adminList = await fetch(`${base}/tenant/activation/sessions`, {
      headers: { "x-test-auth-mode": "admin" },
    });
    assert.equal(adminList.status, 401);

    for (const field of ["tenant_id", "user_id", "workspace_key", "brand_key", "context_scope"]) {
      const rejected = await fetch(`${base}/tenant/activation/sessions?${field}=forbidden`, {
        headers: { "x-test-auth-mode": "tenant-a" },
      });
      assert.equal(rejected.status, 400, `${field} must be rejected on the Tenant Activation session list`);
      assert.equal((await rejected.json()).error.code, "tenant_activation_query_parameter_not_allowed");
    }

    const invalidStatus = await fetch(`${base}/tenant/activation/sessions?session_status=closed`, {
      headers: { "x-test-auth-mode": "tenant-a" },
    });
    assert.equal(invalidStatus.status, 400);
    assert.equal((await invalidStatus.json()).error.code, "tenant_activation_session_status_invalid");

    const listA = await fetch(`${base}/tenant/activation/sessions?session_status=active&limit=5`, {
      headers: { "x-test-auth-mode": "tenant-a" },
    });
    assert.equal(listA.status, 200);
    const listBodyA = await listA.json();
    assert.deepEqual(listBodyA.subject, { tenant_id: "tenant-a", user_id: "user-a", is_admin: false });
    assert.equal(listBodyA.sessions[0].session_id, "session-tenant-a");
    assert.deepEqual(Object.keys(listBodyA.sessions[0]).sort(), [
      "brand_key", "created_at", "ended_at", "originator", "session_id", "session_status",
      "started_at", "turn_count", "workspace_key",
    ].sort());
    assert.equal(JSON.stringify(listBodyA).includes("secret-tenant-a"), false);
    assert.equal(listBodyA.secrets_included, false);

    const listB = await fetch(`${base}/tenant/activation/sessions?limit=1`, {
      headers: { "x-test-auth-mode": "tenant-b" },
    });
    assert.equal(listB.status, 200);
    const listBodyB = await listB.json();
    assert.equal(listBodyB.sessions[0].session_id, "session-tenant-b");
    assert.equal(JSON.stringify(listBodyB).includes("tenant-a"), false);
    assert.deepEqual(sessionListQueries.map((entry) => entry.params), [
      ["tenant-a", "user-a", "active", 5],
      ["tenant-b", "user-b", 1],
    ]);

    const responseA = await fetch(`${base}/tenant/activation/session-context?response_profile=full&max_response_chars=5000`, {
      headers: { "x-test-auth-mode": "tenant-a" },
    });
    assert.equal(responseA.status, 200);
    const bodyA = await responseA.json();
    assert.equal(bodyA.subject.tenant_id, "tenant-a");
    assert.equal(bodyA.subject.user_id, "user-a");
    assert.equal(bodyA.subject.workspace_key, "workspace-a");
    assert.equal(bodyA.subject.brand_key, "brand-a");
    assert.equal(bodyA.status.turn_content_loaded, false);
    assert.equal(bodyA.turn_availability.include_turns, false);
    assert.equal(bodyA.turn_availability.turns_limit, 0);
    assert.deepEqual(bodyA.stored_turn_previews, []);
    assert.equal(bodyA.recent_session_summaries[0].tenant_id, "tenant-a");
    assert.equal(bodyA.product_guidance.tenant_id, "tenant-a");
    assert.equal(bodyA.secrets_included, false);

    const responseB = await fetch(`${base}/tenant/activation/session-context?response_profile=full&max_response_chars=5000`, {
      headers: { "x-test-auth-mode": "tenant-b" },
    });
    assert.equal(responseB.status, 200);
    const bodyB = await responseB.json();
    assert.equal(bodyB.subject.tenant_id, "tenant-b");
    assert.equal(bodyB.subject.user_id, "user-b");
    assert.equal(bodyB.subject.workspace_key, "workspace-b");
    assert.equal(bodyB.subject.brand_key, "brand-b");
    assert.equal(bodyB.recent_session_summaries[0].tenant_id, "tenant-b");

    const tenantBJson = JSON.stringify(bodyB);
    assert.equal(tenantBJson.includes("tenant-a"), false);
    assert.equal(tenantBJson.includes("workspace-a"), false);
    assert.equal(tenantBJson.includes("brand-a"), false);

    assert.deepEqual(observedContexts.map((entry) => entry.subject.tenant_id), ["tenant-a", "tenant-b"]);
    assert.equal(observedContexts.every((entry) => entry.query.include_turns === undefined), true);
    assert.equal(observedContexts.every((entry) => entry.query.context_scope === undefined), true);
    assert.deepEqual(dashboardCalls.map((entry) => entry.tenantId), ["tenant-a", "tenant-b"]);
    assert.equal(preparedRuns.length, 2);
    assert.deepEqual(chunkCalls.map((entry) => entry.options.auth.tenant_id), ["tenant-a", "tenant-b"]);
    assert.deepEqual(chunkCalls.map((entry) => entry.options.auth.user_id), ["user-a", "user-b"]);
    assert.equal(chunkCalls.every((entry) => entry.options.auth.mode === "user_jwt"), true);
    assert.equal(chunkCalls.every((entry) => entry.options.source_surface === "tenant_activation_session_context"), true);
    assert.equal(chunkCalls.every((entry) => entry.options.auth !== entry.options.response_options), true);

    const legacy = await fetch(`${base}/activation/session-context`);
    assert.equal(legacy.status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  await eventually(() => assert.equal(deliveredRuns.length, 2));
  assert.deepEqual(deliveredRuns.map((entry) => entry.deliveryState), ["delivered", "delivered"]);
});

await stage("runtime_turn_batch_alias_isolation", async () => {
  const authorizationCalls = [];
  const recordedTurns = [];
  const pool = {
    async query(sql) {
      if (String(sql).includes("FROM `customer_sessions`")) {
        return [[{
          session_id: "session-tenant-a",
          tenant_id: "tenant-a",
          user_id: "user-a",
          originator: "gpt_action",
          session_status: "active",
        }]];
      }
      if (String(sql).includes("MAX(turn_index)")) return [[{ max_idx: 3 }]];
      throw new Error(`Unexpected SQL in tenant Activation batch alias test: ${String(sql).slice(0, 120)}`);
    },
  };

  const app = express();
  app.use(express.json());
  app.use(buildGptSessionRoutes({
    requireBackendApiKey,
    getRuntimePool: () => pool,
    authorizeCapabilityFamily: async (input) => {
      authorizationCalls.push(input);
      return input.principal.tenant_id === "tenant-a"
        ? { ok: true, operation: "append_turns" }
        : { ok: false, reason_code: "session_archive_tenant_scope_mismatch" };
    },
    recordSessionTurn: async (input) => {
      recordedTurns.push(input);
      return {
        turn_id: `turn-${input.turnIndex}`,
        drive_doc_id: "drive-doc-1",
        drive_doc_part: 1,
        drive_anchor: `turn-${input.turnIndex}`,
        archive_status: "ready",
      };
    },
  }));

  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  const requestBody = {
    turns: [
      { role: "user", content: "تابع" },
      { role: "assistant", content: "تم" },
    ],
  };
  try {
    const unauthenticated = await fetch(`${base}/tenant/activation/sessions/session-tenant-a/turns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    assert.equal(unauthenticated.status, 401);

    const admin = await fetch(`${base}/tenant/activation/sessions/session-tenant-a/turns`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-auth-mode": "admin" },
      body: JSON.stringify(requestBody),
    });
    assert.equal(admin.status, 401);

    const invalidRole = await fetch(`${base}/tenant/activation/sessions/session-tenant-a/turns`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-auth-mode": "tenant-a" },
      body: JSON.stringify({ turns: [{ role: "system", content: "forbidden" }] }),
    });
    assert.equal(invalidRole.status, 400);
    assert.equal((await invalidRole.json()).error.code, "invalid_role");

    const denied = await fetch(`${base}/tenant/activation/sessions/session-tenant-a/turns`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-auth-mode": "tenant-b" },
      body: JSON.stringify(requestBody),
    });
    assert.equal(denied.status, 403);

    const accepted = await fetch(`${base}/tenant/activation/sessions/session-tenant-a/turns`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-auth-mode": "tenant-a" },
      body: JSON.stringify(requestBody),
    });
    assert.equal(accepted.status, 200);
    const body = await accepted.json();
    assert.equal(body.session_id, "session-tenant-a");
    assert.equal(body.turn_count, 2);
    assert.deepEqual(body.turns.map((turn) => turn.turn_index), [4, 5]);
    assert.equal(body.secrets_included, false);
    assert.equal(recordedTurns.length, 2);
    assert.equal(authorizationCalls.at(-1).expectedFamily, "session_archive_write");
    assert.deepEqual(authorizationCalls.at(-1).principal, { tenant_id: "tenant-a", user_id: "user-a" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

const sourceDoc = await stage("canonical_openapi_parse", async () =>
  YAML.parse(fs.readFileSync("openapi.yaml", "utf8"))
);

await stage("canonical_openapi_contract", async () => {
  const tenantOperation = sourceDoc.paths?.["/tenant/activation/session-context"]?.get;
  assert.equal(tenantOperation?.["x-tenant-gpt-operationId"], "activateSession");
  assert.equal(sourceDoc.paths?.["/tenant/activation/sessions"]?.get?.["x-tenant-gpt-operationId"], "listSessions");
  assert.equal(sourceDoc.paths?.["/tenant/activation/sessions/{id}/turns"]?.post?.["x-tenant-gpt-operationId"], "writeGptSessionTurns");
  assert.deepEqual(
    sourceDoc.paths?.["/tenant/activation/sessions/{id}/turns"]?.post?.requestBody?.content?.["application/json"]?.schema?.properties?.turns?.items?.properties?.role?.enum,
    ["user", "assistant", "tool"],
  );
  assert.equal(sourceDoc.paths?.["/activation/session-context"]?.get?.["x-tenant-gpt-operationId"], undefined);
});

const tenantActivation = await stage("tenant_split_parse", async () =>
  YAML.parse(fs.readFileSync("openapi/openapi.tenant-gpt.activation.yaml", "utf8"))
);

await stage("tenant_split_contract", async () => {
  const operation = tenantActivation.paths?.["/tenant/activation/session-context"]?.get;
  assert.equal(operation?.operationId, "activateSession");
  assert.equal(tenantActivation.paths?.["/activation/session-context"], undefined);
  assert.equal(tenantActivation.paths?.["/tenant/activation/sessions"]?.get?.operationId, "listSessions");
  assert.equal(tenantActivation.paths?.["/tenant/activation/sessions/{id}/turns"]?.post?.operationId, "writeGptSessionTurns");
  assert.equal(tenantActivation.paths?.["/sessions"], undefined);
  assert.equal(tenantActivation.paths?.["/gpt/sessions/{id}/turns"], undefined);

  const parameterNames = (operation?.parameters || []).map((parameter) => parameter.name);
  for (const forbidden of [
    "tenant_id",
    "user_id",
    "workspace_id",
    "workspace_key",
    "brand_key",
    "include_turns",
    "context_scope",
  ]) {
    assert.equal(parameterNames.includes(forbidden), false, `${forbidden} must not be exposed by Tenant OpenAPI`);
  }

  const listParameterNames = (tenantActivation.paths?.["/tenant/activation/sessions"]?.get?.parameters || [])
    .map((parameter) => parameter.name);
  assert.deepEqual(listParameterNames.sort(), ["limit", "session_status"]);
  const batchSchema = tenantActivation.paths?.["/tenant/activation/sessions/{id}/turns"]?.post
    ?.requestBody?.content?.["application/json"]?.schema;
  assert.equal(batchSchema?.additionalProperties, false);
  assert.equal(batchSchema?.properties?.turns?.maxItems, 20);
  assert.deepEqual(batchSchema?.properties?.turns?.items?.properties?.role?.enum, ["user", "assistant", "tool"]);
});

const tenantCore = await stage("tenant_core_split_parse", async () =>
  YAML.parse(fs.readFileSync("openapi/openapi.tenant-gpt.auth.yaml", "utf8"))
);

const customGptSurfaceRegistry = await stage("custom_gpt_surface_registry_parse", async () =>
  YAML.parse(fs.readFileSync("../canonicals/openapi/custom-gpt-surfaces.yaml", "utf8"))
);

await stage("tenant_surface_operation_budgets", async () => {
  const countOperations = (document) => Object.values(document.paths || {})
    .flatMap((pathItem) => Object.keys(pathItem || {}))
    .filter((method) => ["get", "post", "put", "patch", "delete"].includes(method)).length;

  const expectedOperationCount = (surfaceKey) => {
    const operationIds = customGptSurfaceRegistry.surfaces?.[surfaceKey]?.selector?.tenant_operation_ids;
    assert.ok(
      Array.isArray(operationIds),
      `${surfaceKey} must declare selector.tenant_operation_ids in the canonical surface registry`,
    );
    assert.equal(
      new Set(operationIds).size,
      operationIds.length,
      `${surfaceKey} selector.tenant_operation_ids must not contain duplicates`,
    );
    return operationIds.length;
  };

  assert.equal(countOperations(tenantCore), expectedOperationCount("tenant_core"));
  assert.equal(countOperations(tenantActivation), expectedOperationCount("tenant_activation"));
  assert.equal(tenantCore.paths?.["/sessions"], undefined);
  assert.equal(tenantCore.paths?.["/gpt/sessions/{id}/turns"], undefined);
  assert.equal(tenantCore.paths?.["/tenant/activation/sessions"], undefined);
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
  const tenantRoute = policy.routes.find((route) => route.path === "/tenant/activation/session-context");
  const tenantSessionList = policy.routes.find((route) => route.path === "/tenant/activation/sessions" && route.method === "GET");
  const tenantSessionTurns = policy.routes.find((route) => route.path === "/tenant/activation/sessions/{id}/turns" && route.method === "POST");
  const adminRoute = policy.routes.find((route) => route.path === "/activation/session-context");
  assert.deepEqual(tenantRoute?.auth_profiles, ["tenant_oauth"]);
  assert.deepEqual(tenantSessionList?.auth_profiles, ["tenant_oauth"]);
  assert.deepEqual(tenantSessionTurns?.auth_profiles, ["tenant_oauth"]);
  assert.deepEqual(tenantSessionList?.allowed_query_parameters.sort(), ["limit", "session_status"]);
  assert.equal(tenantSessionTurns?.mutation, true);
  assert.equal(policy.routes.some((route) => route.path === "/sessions"), false);
  assert.equal(policy.routes.some((route) => route.path === "/gpt/sessions/{id}/turns"), false);
  assert.deepEqual(adminRoute?.auth_profiles, ["admin_service"]);

  for (const forbidden of [
    "tenant_id",
    "user_id",
    "workspace_id",
    "workspace_key",
    "brand_key",
    "include_turns",
    "context_scope",
  ]) {
    assert.equal(tenantRoute.allowed_query_parameters.includes(forbidden), false);
  }
  assert.equal(adminRoute.allowed_query_parameters.includes("tenant_id"), true);
  assert.equal(adminRoute.allowed_query_parameters.includes("user_id"), true);
});

console.log("Tenant Activation session alias tests passed.");
