import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createActivityBindingLifecycleService } from "./src/application/growthControlPlane/activityBindingLifecycleService.js";
import { createActivityBindingLifecycleRepository } from "./src/infrastructure/growthControlPlane/activityBindingLifecycleRepository.js";

const BINDING_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const BRAND_KEY = "example.brand";
const NOW = new Date("2026-07-27T03:00:00.000Z");

let binding = {
  activity_binding_id: BINDING_ID,
  tenant_id: TENANT_ID,
  workspace_id: WORKSPACE_ID,
  brand_key: BRAND_KEY,
  activity_type_key: "organic_growth",
  activity_pack_key: "travel.organic_growth",
  activity_pack_version: 1,
  markets_json: "[]",
  locales_json: "[]",
  channels_json: "[]",
  objectives_json: "[]",
  allowed_capabilities_json: JSON.stringify(["intent_map_generate", "content_brief_generate"]),
  status: "validating",
  revision: 3,
  approved_by: null,
  effective_from: null,
  effective_to: null,
  created_by: "admin",
  created_at: NOW,
  updated_at: NOW
};
let evidence = null;
const calls = [];
const transactionEvents = [];

async function execute(statement, params = []) {
  calls.push({ statement, params });
  if (statement.includes("FROM growth_control_brand_activity_bindings") && statement.includes("SELECT *")) {
    return [[{ ...binding }]];
  }
  if (statement.includes("FROM brand_core")) {
    return [[{
      brand_key: BRAND_KEY,
      status: "active",
      validation_status: "active",
      active_status: "active",
      authoritative_home: "registry",
      asset_class: "brand_core",
      registry_role: "authoritative",
      updated_at: NOW
    }]];
  }
  if (statement.includes("FROM growth_control_activity_pack_versions")) {
    return [[{
      manifest_json: JSON.stringify({ capabilities: ["intent_map_generate", "content_brief_generate"] }),
      lifecycle: "active",
      activity_type_key: "organic_growth"
    }]];
  }
  if (statement.includes("FROM platform_semantic_capabilities")) {
    return [[
      { capability_key: "intent_map_generate", status: "active" },
      { capability_key: "content_brief_generate", status: "active" }
    ]];
  }
  if (statement.includes("SET status=?,revision=?,updated_at=CURRENT_TIMESTAMP")) {
    binding = { ...binding, status: params[0], revision: params[1] };
    return [{ affectedRows: 1 }];
  }
  if (statement.includes("INSERT INTO growth_control_activity_binding_readiness_evidence")) {
    evidence = {
      evidence_id: params[0],
      activity_binding_id: params[1],
      binding_revision: params[2],
      target_status: params[3],
      evidence_sha256: params[4],
      checks_json: params[5],
      assessed_by: params[6],
      assessed_at: params[9]
    };
    return [{ affectedRows: 1 }];
  }
  if (statement.includes("SELECT e.*")) {
    return [evidence && evidence.binding_revision === binding.revision ? [{ ...evidence }] : []];
  }
  if (statement.includes("SELECT target_status,binding_revision")) {
    return [evidence ? [{ target_status: evidence.target_status, binding_revision: evidence.binding_revision }] : []];
  }
  if (statement.includes("SET status='deprecated'")) {
    return [{ affectedRows: 1 }];
  }
  if (statement.includes("approved_by=CASE WHEN")) {
    binding = {
      ...binding,
      status: params[0],
      revision: params[1],
      approved_by: params[3],
      effective_from: params[5] || binding.effective_from,
      effective_to: params[7] || binding.effective_to
    };
    return [{ affectedRows: 1 }];
  }
  throw new Error(`Unexpected SQL in lifecycle integration test: ${statement}`);
}

const connection = {
  execute,
  async beginTransaction() { transactionEvents.push("begin"); },
  async commit() { transactionEvents.push("commit"); },
  async rollback() { transactionEvents.push("rollback"); },
  release() { transactionEvents.push("release"); }
};
const pool = {
  execute,
  async getConnection() { return connection; }
};
const repository = createActivityBindingLifecycleRepository({ resolvePool: async () => pool });
const service = createActivityBindingLifecycleService({
  repository,
  uuid: () => "44444444-4444-4444-8444-444444444444",
  now: () => new Date(NOW)
});
const scope = {
  tenantId: TENANT_ID,
  workspaceId: WORKSPACE_ID,
  brandKey: BRAND_KEY,
  actorId: "admin-user",
  requestId: "request-1",
  correlationId: "correlation-1"
};

const readiness = await service.assessReadiness(BINDING_ID, { expectedRevision: 3 }, scope);
assert.equal(readiness.ready, true);
assert.equal(readiness.status, "ready");
assert.equal(readiness.bindingRevision, 4);
assert.equal(binding.status, "ready");
assert.equal(binding.revision, 4);
assert.equal(evidence.binding_revision, 4);
assert.equal(evidence.target_status, "ready");
assert.deepEqual(transactionEvents.slice(0, 3), ["begin", "commit", "release"]);
assert(calls.some(({ statement }) => /FOR UPDATE/.test(statement)));
assert(calls.some(({ statement }) => statement.includes("growth_control_activity_binding_readiness_evidence")));

const latest = await repository.getLatestActivityBindingReadiness({ activityBindingId: BINDING_ID });
assert.equal(latest.ready, true);
assert.equal(latest.bindingRevision, 4);

const transitioned = await service.transitionActivityBinding(BINDING_ID, {
  targetStatus: "active",
  expectedRevision: 4,
  reason: "Readiness evidence reviewed"
}, scope);
assert.equal(transitioned.status, "active");
assert.equal(transitioned.revision, 5);
assert.equal(binding.status, "active");
assert.equal(binding.revision, 5);
assert.equal(binding.approved_by, "admin-user");
assert(calls.some(({ statement }) => statement.includes("status='deprecated'")));
assert(calls.some(({ statement }) => statement.includes("target_status,binding_revision")));
assert.equal(transactionEvents.filter((event) => event === "commit").length, 2);
assert.equal(transactionEvents.includes("rollback"), false);

for (const { statement, params } of calls) {
  if (statement.includes("activity_binding_id=?")) assert(params.includes(BINDING_ID));
}

const migration = readFileSync("migrations/20260726_activity_binding_readiness_evidence.sql", "utf8");
assert(migration.includes("growth_control_activity_binding_readiness_evidence"));
assert(migration.includes("FOREIGN KEY (activity_binding_id)"));
assert(migration.includes("provider_calls TINYINT(1) NOT NULL DEFAULT 0"));
assert(migration.includes("external_writes TINYINT(1) NOT NULL DEFAULT 0"));
assert(migration.includes("secrets_included TINYINT(1) NOT NULL DEFAULT 0"));
assert.equal(/\bDROP\s+(TABLE|VIEW)\b/i.test(migration), false);
assert.equal(/\bALTER\s+TABLE\b/i.test(migration), false);

const routeSource = readFileSync("routes/activityBindingLifecycleRoutes.js", "utf8");
const indexSource = readFileSync("routes/index.js", "utf8");
assert(routeSource.includes("requireBackendApiKey"));
assert(routeSource.includes("requireAdminPrincipal"));
assert(routeSource.includes("/:activityBindingId/readiness"));
assert(routeSource.includes("/:activityBindingId/transitions"));
assert(routeSource.includes("tenantId, workspaceId, and brandKey are required"));
assert(indexSource.includes("buildActivityBindingLifecycleRoutes"));
assert(indexSource.includes("app.use(buildActivityBindingLifecycleRoutes({ ...deps, requireAdminPrincipal }))"));

const openapi = readFileSync("openapi/activity-binding-lifecycle.openapi.yaml", "utf8");
assert.match(openapi, /^openapi: 3\.1\.0/m);
assert(openapi.includes("operationId: assessBrandActivityBindingReadiness"));
assert(openapi.includes("operationId: transitionBrandActivityBinding"));
assert(openapi.includes("BackendApiKey"));
assert(openapi.includes("BackendBearer"));
for (const status of ["'400'", "'401'", "'403'", "'404'", "'409'", "'422'", "'500'"]) {
  assert(openapi.includes(status));
}
assert(openapi.includes("providerCalls: { type: boolean, const: false }"));
assert(openapi.includes("externalWrites: { type: boolean, const: false }"));
assert(openapi.includes("secretsIncluded: { type: boolean, const: false }"));

const repositorySource = readFileSync("src/infrastructure/growthControlPlane/activityBindingLifecycleRepository.js", "utf8");
assert(repositorySource.includes("FOR UPDATE"));
assert(repositorySource.includes("beginTransaction"));
assert(repositorySource.includes("rollback"));
assert(repositorySource.includes("activity_binding_id=?"));
assert.equal(repositorySource.includes("provider_calls,external_writes,secrets_included)\n         VALUES (?,?,?,?,?,?,?,?,?,?,1"), false);

const activationSurface = JSON.parse(readFileSync(
  "activation-surfaces/growth_control_activity_binding_readiness_evidence.json",
  "utf8"
));
assert.equal(activationSurface.surface_key, "growth_control_activity_binding_readiness_evidence");
assert.equal(activationSurface.source_table, "growth_control_activity_binding_readiness_evidence");
assert.equal(activationSurface.include_for_admin, true);
assert.equal(activationSurface.include_for_tenant, false);
assert.equal(activationSurface.tenant_column, null);
assert.equal(activationSurface.max_rows, 50);
for (const excluded of [
  "checks_json",
  "assessed_by",
  "request_id",
  "correlation_id",
  "provider_calls",
  "external_writes",
  "secrets_included"
]) {
  assert.equal(activationSurface.result_columns.includes(excluded), false);
}
assert.deepEqual(activationSurface.active_status_values, ["ready", "blocked"]);

console.log("activity binding lifecycle integration tests passed");
