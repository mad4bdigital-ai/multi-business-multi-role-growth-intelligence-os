import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import {
  OPENAPI_ENDPOINT_INVENTORY_CONSTANTS,
  buildEndpointInventoryRow,
  buildOpenApiEndpointInventoryPlan,
  collectOpenApiEndpointInventory,
  startOpenApiEndpointInventorySync,
  syncOpenApiEndpointInventory,
} from "./openApiEndpointInventorySync.js";

async function expectCode(run, code) {
  await assert.rejects(run, (error) => {
    assert.equal(error?.code, code);
    assert.equal(error?.details?.secrets_included, false);
    return true;
  });
}

function yaml(value) {
  return YAML.stringify(value, { lineWidth: -1 });
}

function makeRoot(paths) {
  return {
    openapi: "3.1.0",
    info: { title: "Inventory fixture", version: "1.0.0" },
    paths,
  };
}

function makeOperation(operationId, extras = {}) {
  return {
    tags: ["fixture"],
    operationId,
    summary: `Fixture ${operationId}`,
    security: [{ backendBearerAuth: [] }],
    responses: { "200": { description: "OK" } },
    ...extras,
  };
}

function createFakePool({ expectedReadbackCount, existingRows = [], lockAcquired = 1 } = {}) {
  const calls = [];
  let committed = false;
  let rolledBack = false;
  let released = false;
  const connection = {
    async beginTransaction() { calls.push({ scope: "connection", sql: "BEGIN" }); },
    async commit() { committed = true; calls.push({ scope: "connection", sql: "COMMIT" }); },
    async rollback() { rolledBack = true; calls.push({ scope: "connection", sql: "ROLLBACK" }); },
    release() { released = true; calls.push({ scope: "connection", sql: "RELEASE_CONNECTION" }); },
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ scope: "connection", sql: text, params });
      if (text.includes("GET_LOCK")) return [[{ lock_acquired: lockAcquired }], []];
      if (text.includes("RELEASE_LOCK")) return [[{ released: 1 }], []];
      if (text.includes("SELECT COUNT(*) AS row_count")) {
        return [[{ row_count: expectedReadbackCount }], []];
      }
      return [{ affectedRows: 1 }, []];
    },
  };
  const pool = {
    calls,
    get committed() { return committed; },
    get rolledBack() { return rolledBack; },
    get released() { return released; },
    async getConnection() { calls.push({ scope: "pool", sql: "GET_CONNECTION" }); return connection; },
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ scope: "pool", sql: text, params });
      if (text.includes("FROM endpoints WHERE parent_action_key")) return [existingRows, []];
      return [{ affectedRows: 1 }, []];
    },
  };
  return pool;
}

const registrySyncContract = YAML.parse(
  await readFile(new URL("./openapi/openapi-registry-sync.yaml", import.meta.url), "utf8"),
);
const inventoryEvidenceSchema = registrySyncContract.schemas.InventoryEvidence;
const inventorySyncResponseSchema = registrySyncContract.schemas.InventorySyncResponse;
assert(inventoryEvidenceSchema, "InventoryEvidence schema must be declared");
assert.equal(inventoryEvidenceSchema.additionalProperties, false);
assert.deepEqual(
  [...inventoryEvidenceSchema.required].sort(),
  [
    "secrets_included",
    "source_document_count",
    "suppressed_route_conflict_count",
    "suppressed_route_conflicts",
    "suppressed_route_duplicate_count",
  ].sort(),
);
assert.equal(inventoryEvidenceSchema.properties.source_document_count.minimum, 0);
assert.equal(inventoryEvidenceSchema.properties.suppressed_route_duplicate_count.minimum, 0);
assert.equal(inventoryEvidenceSchema.properties.suppressed_route_conflict_count.minimum, 0);
assert.equal(inventoryEvidenceSchema.properties.secrets_included.const, false);
assert.deepEqual(
  [...inventoryEvidenceSchema.properties.suppressed_route_conflicts.items.required].sort(),
  [
    "authoritative_operation_id",
    "route",
    "source_file",
    "suppressed_operation_id",
  ].sort(),
);
assert.equal(
  inventorySyncResponseSchema.properties.inventory_evidence.$ref,
  "#/schemas/InventoryEvidence",
);
assert.equal(
  inventorySyncResponseSchema.required.includes("inventory_evidence"),
  false,
  "inventory_evidence must remain an additive optional response field",
);

const fullInventory = await collectOpenApiEndpointInventory();
assert(fullInventory.operation_count >= 500);
assert.match(fullInventory.source_fingerprint, /^[a-f0-9]{64}$/);
for (const expected of [
  ["syncOpenApiEndpointInventory", "/admin/openapi-registry-sync", "openapi_endpoint_inventory_sync"],
  ["getOpenApiEndpointInventorySyncStatus", "/admin/openapi-registry-sync/status", "openapi_endpoint_inventory_status"],
  ["previewAdminContainerAuthorityResolution", "/admin/container-authority/resolution-preview", "dynamic_container_resolution_preview"],
  ["previewAdminContainerAuthorityProjection", "/admin/container-authority/projection-preview", "dynamic_container_projection_dry_run"],
]) {
  const row = fullInventory.operations.find((item) => item.endpoint_key === expected[0]);
  assert(row, `Missing inventory operation ${expected[0]}`);
  assert.equal(row.endpoint_path_or_function, expected[1]);
  assert.equal(row.registry_tool_key, expected[2]);
  assert.equal(row.registry_exposure, "admin_tool");
}

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "openapi-inventory-sync-"));
try {
  const childPath = path.join(tempRoot, "child.yaml");
  const rootPath = path.join(tempRoot, "openapi.yaml");
  await writeFile(childPath, yaml({
    firstPath: { get: makeOperation("fixtureList", { "x-registry-exposure": "admin_tool", "x-registry-tool-key": "fixture_list" }) },
    secondPath: { post: makeOperation("fixtureCreate", { "x-openai-isConsequential": true }) },
  }), "utf8");
  await writeFile(rootPath, yaml(makeRoot({
    "/fixtures": { $ref: "./child.yaml#/firstPath" },
    "/fixtures/create": { $ref: "./child.yaml#/secondPath" },
  })), "utf8");

  const fixtureInventory = await collectOpenApiEndpointInventory({ openApiPath: rootPath });
  assert.equal(fixtureInventory.operation_count, 2);
  assert.deepEqual(fixtureInventory.operations.map((item) => item.endpoint_key), ["fixtureCreate", "fixtureList"]);
  assert.equal(fixtureInventory.operations.find((item) => item.endpoint_key === "fixtureList").source_file, "child.yaml");
  assert.equal(fixtureInventory.operations.find((item) => item.endpoint_key === "fixtureList").registry_tool_key, "fixture_list");
  assert.equal(fixtureInventory.operations.find((item) => item.endpoint_key === "fixtureCreate").consequential, true);

  const firstDesired = buildEndpointInventoryRow(fixtureInventory.operations[0], fixtureInventory.source_fingerprint);
  const secondDesired = buildEndpointInventoryRow(fixtureInventory.operations[1], fixtureInventory.source_fingerprint);
  const plan = buildOpenApiEndpointInventoryPlan({
    inventory: fixtureInventory,
    existingRows: [
      firstDesired,
      { ...secondDesired, schema_json: "{}" },
      {
        ...firstDesired,
        endpoint_id: "openapi_inventory::removedFixture",
        endpoint_key: "removedFixture",
        inventory_role: OPENAPI_ENDPOINT_INVENTORY_CONSTANTS.INVENTORY_ROLE,
        status: "inventory_only",
      },
    ],
  });
  assert.equal(plan.insert_count, 0);
  assert.equal(plan.update_count, 1);
  assert.equal(plan.unchanged_count, 1);
  assert.equal(plan.deprecate_count, 1);
  assert.equal(plan.callable_rows_created, 0);
  assert.equal(plan.tool_exports_created, 0);
  for (const desired of plan.desired_rows) {
    assert.equal(desired.status, "inventory_only");
    assert.equal(desired.execution_readiness, "pending_governance_review");
    assert.equal(desired.runtime_binding_profile, "inventory_only_no_dispatch");
    assert.equal(desired.client_allowed, "false");
    assert.equal(desired.team_allowed, "false");
  }

  const dryRunPool = createFakePool({ expectedReadbackCount: 2 });
  const dryRun = await syncOpenApiEndpointInventory({ mode: "dry_run" }, { pool: dryRunPool, openApiPath: rootPath });
  assert.equal(dryRun.applied, false);
  assert.equal(dryRun.plan.insert_count, 2);
  assert.equal(dryRun.plan.callable_rows_created, 0);
  assert.equal(dryRun.plan.tool_exports_created, 0);
  assert.equal(dryRun.inventory_evidence.source_document_count, 2);
  assert.equal(dryRun.inventory_evidence.suppressed_route_duplicate_count, 0);
  assert.equal(dryRun.inventory_evidence.suppressed_route_conflict_count, 0);
  assert.deepEqual(dryRun.inventory_evidence.suppressed_route_conflicts, []);
  assert.equal(dryRun.inventory_evidence.secrets_included, false);
  assert.equal(dryRun.required_confirmation, OPENAPI_ENDPOINT_INVENTORY_CONSTANTS.APPLY_CONFIRMATION);
  assert.equal(dryRunPool.calls.some((call) => /INSERT|UPDATE/i.test(call.sql)), false);

  await expectCode(
    () => syncOpenApiEndpointInventory({ mode: "apply" }, { pool: dryRunPool, openApiPath: rootPath }),
    "openapi_inventory_confirmation_required",
  );
  await expectCode(
    () => syncOpenApiEndpointInventory({
      mode: "apply",
      confirm: OPENAPI_ENDPOINT_INVENTORY_CONSTANTS.APPLY_CONFIRMATION,
      capability_envelope_id: "missing",
    }, {
      pool: dryRunPool,
      openApiPath: rootPath,
      resolveEnvelope: async () => ({ ok: false, status: "capability_resolution_envelope_not_found", secrets_included: false }),
    }),
    "capability_resolution_envelope_not_found",
  );
  await expectCode(
    () => syncOpenApiEndpointInventory({
      mode: "apply",
      confirm: OPENAPI_ENDPOINT_INVENTORY_CONSTANTS.APPLY_CONFIRMATION,
      capability_envelope_id: "preview-only",
    }, {
      pool: dryRunPool,
      openApiPath: rootPath,
      resolveEnvelope: async () => ({ ok: true, envelope_id: "preview-only", apply_allowed: false, secrets_included: false }),
    }),
    "capability_resolution_envelope_apply_not_allowed",
  );

  const applyPool = createFakePool({ expectedReadbackCount: 2 });
  const references = [];
  const apply = await syncOpenApiEndpointInventory({
    mode: "apply",
    confirm: OPENAPI_ENDPOINT_INVENTORY_CONSTANTS.APPLY_CONFIRMATION,
    capability_envelope_id: "envelope-1",
  }, {
    pool: applyPool,
    openApiPath: rootPath,
    auth: { tenant_id: "00000000-0000-0000-0000-000000000000", user_id: "user-1" },
    resolveEnvelope: async (input) => {
      assert.deepEqual(input.acceptedAppKeys, ["platform_orchestration"]);
      assert(input.acceptedIntents.includes("openapi_endpoint_inventory_sync"));
      return { ok: true, envelope_id: "envelope-1", apply_allowed: true, secrets_included: false };
    },
    markReferenced: async (input) => { references.push(input); return { ok: true }; },
  });
  assert.equal(apply.applied, true);
  assert.equal(apply.readback_count, 2);
  assert.equal(apply.capability_envelope_id, "envelope-1");
  assert.equal(applyPool.committed, true);
  assert.equal(applyPool.rolledBack, false);
  assert.equal(applyPool.released, true);
  assert.equal(references.length, 1);
  assert.equal(references[0].envelopeId, "envelope-1");
  assert(applyPool.calls.some((call) => call.sql.includes("GET_LOCK")));
  assert(applyPool.calls.some((call) => call.sql.includes("RELEASE_LOCK")));
  assert.equal(applyPool.calls.some((call) => /platform_endpoint_tool_exports/i.test(call.sql)), false);
  assert.equal(applyPool.calls.some((call) => /admin_platform_endpoint_tools/i.test(call.sql)), false);
  const completedRunInsert = applyPool.calls.find(
    (call) => call.sql.includes("INSERT INTO openapi_endpoint_inventory_sync_runs"),
  );
  assert(completedRunInsert);
  const completedRunSummary = JSON.parse(completedRunInsert.params[12]);
  assert.equal(completedRunSummary.plan.insert_count, 2);
  assert.equal(completedRunSummary.inventory_evidence.source_document_count, 2);
  assert.equal(completedRunSummary.inventory_evidence.suppressed_route_duplicate_count, 0);
  assert.equal(completedRunSummary.inventory_evidence.suppressed_route_conflict_count, 0);
  assert.deepEqual(completedRunSummary.inventory_evidence.suppressed_route_conflicts, []);

  const lockedPool = createFakePool({ expectedReadbackCount: 2, lockAcquired: 0 });
  await expectCode(
    () => syncOpenApiEndpointInventory({
      mode: "apply",
      confirm: OPENAPI_ENDPOINT_INVENTORY_CONSTANTS.APPLY_CONFIRMATION,
      capability_envelope_id: "envelope-2",
    }, {
      pool: lockedPool,
      openApiPath: rootPath,
      resolveEnvelope: async () => ({ ok: true, envelope_id: "envelope-2", apply_allowed: true, secrets_included: false }),
    }),
    "openapi_inventory_sync_locked",
  );
  assert.equal(lockedPool.committed, false);
  assert.equal(lockedPool.rolledBack, true);
  assert.equal(lockedPool.released, true);
  const failedRunInsert = lockedPool.calls.find(
    (call) => call.sql.includes("INSERT INTO openapi_endpoint_inventory_sync_runs"),
  );
  assert(failedRunInsert);
  const failedRunSummary = JSON.parse(failedRunInsert.params[12]);
  assert.equal(failedRunSummary.plan.insert_count, 2);
  assert.equal(failedRunSummary.inventory_evidence.source_document_count, 2);
  assert.equal(failedRunSummary.inventory_evidence.suppressed_route_duplicate_count, 0);
  assert.equal(failedRunSummary.inventory_evidence.suppressed_route_conflict_count, 0);
  assert.deepEqual(failedRunSummary.inventory_evidence.suppressed_route_conflicts, []);
  assert.equal(failedRunInsert.params[13], "openapi_inventory_sync_locked");

  const duplicatePath = path.join(tempRoot, "duplicate.yaml");
  await writeFile(duplicatePath, yaml(makeRoot({
    "/one": { get: makeOperation("duplicateOperation") },
    "/two": { post: makeOperation("duplicateOperation") },
  })), "utf8");
  await expectCode(
    () => collectOpenApiEndpointInventory({ openApiPath: duplicatePath }),
    "openapi_inventory_duplicate_operation_id",
  );

  const remotePath = path.join(tempRoot, "remote.yaml");
  await writeFile(remotePath, yaml(makeRoot({ "/remote": { $ref: "https://example.com/openapi.yaml#/remote" } })), "utf8");
  await expectCode(
    () => collectOpenApiEndpointInventory({ openApiPath: remotePath }),
    "openapi_inventory_remote_ref_blocked",
  );

  const outsideFile = path.join(path.dirname(tempRoot), `${path.basename(tempRoot)}-outside.yaml`);
  await writeFile(outsideFile, yaml({ outside: { get: makeOperation("outsideOperation") } }), "utf8");
  try {
    const outsideRootPath = path.join(tempRoot, "outside-root.yaml");
    await writeFile(outsideRootPath, yaml(makeRoot({
      "/outside": { $ref: `../${path.basename(outsideFile)}#/outside` },
    })), "utf8");
    await expectCode(
      () => collectOpenApiEndpointInventory({ openApiPath: outsideRootPath }),
      "openapi_inventory_ref_outside_root",
    );
  } finally {
    await rm(outsideFile, { force: true });
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

const previousKillSwitch = process.env.OPENAPI_ENDPOINT_INVENTORY_SYNC_DISABLED;
process.env.OPENAPI_ENDPOINT_INVENTORY_SYNC_DISABLED = "true";
try {
  const disabled = await startOpenApiEndpointInventorySync({
    pool: { query: async () => { throw new Error("database must not be touched when kill switch is enabled"); } },
  });
  assert.equal(disabled.started, false);
  assert.equal(disabled.status, "disabled_by_environment_kill_switch");
} finally {
  if (previousKillSwitch === undefined) delete process.env.OPENAPI_ENDPOINT_INVENTORY_SYNC_DISABLED;
  else process.env.OPENAPI_ENDPOINT_INVENTORY_SYNC_DISABLED = previousKillSwitch;
}

const routeSource = await readFile(new URL("./routes/dynamicContainerAuthorityRoutes.js", import.meta.url), "utf8");
assert.match(routeSource, /router\.post\("\/admin\/container-authority\/resolution-preview"/);
assert.match(routeSource, /mode:"preview"/);
assert.match(routeSource, /router\.post\("\/admin\/container-authority\/projection-preview"/);
assert.match(routeSource, /mode:"dry_run"/);
assert.doesNotMatch(
  routeSource.match(/router\.post\("\/admin\/container-authority\/projection-preview"[\s\S]*?router\.post\("\/container-authority\/projections"/)?.[0] || "",
  /applyLegacyContainerProjection/,
);

const migration = await readFile(new URL("./migrations/1024_sprint69_openapi_endpoint_inventory_sync.sql", import.meta.url), "utf8");
for (const toolKey of [
  "openapi_endpoint_inventory_status",
  "openapi_endpoint_inventory_sync",
  "dynamic_container_resolution_preview",
  "dynamic_container_projection_dry_run",
  "dynamic_container_shadow_summary",
  "dynamic_container_rollout_readiness",
]) assert.match(migration, new RegExp(`'${toolKey}'`));
assert.match(migration, /'auto_promote', false/);
assert.match(migration, /runtime_callable\s*=\s*'false'/);
assert.match(migration, /'inventory_only'/);
assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i);

console.log("OpenAPI endpoint inventory sync tests passed");
