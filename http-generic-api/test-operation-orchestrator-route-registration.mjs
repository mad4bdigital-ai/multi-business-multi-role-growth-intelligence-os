// frontend-surface-operation: POST /admin/operations/context
// frontend-read-action-proof: POST /admin/operations/context
// frontend-surface-operation: POST /tenant/operations/context
// frontend-read-action-proof: POST /tenant/operations/context
// frontend-surface-operation: POST /admin/operations/preview
// frontend-read-action-proof: POST /admin/operations/preview
// frontend-surface-operation: POST /tenant/operations/preview
// frontend-read-action-proof: POST /tenant/operations/preview
// frontend-surface-operation: POST /admin/operations/status
// frontend-read-action-proof: POST /admin/operations/status
// frontend-surface-operation: POST /tenant/operations/status
// frontend-read-action-proof: POST /tenant/operations/status

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildOperationContext } from "./operationContextService.js";
import {
  getOperationStatus,
  previewOperation,
} from "./operationOrchestrator.js";
import {
  buildOperationOrchestratorRoutes,
  _testingOperationOrchestratorRoutes,
} from "./routes/operationOrchestratorRoutes.js";

const routesIndex = await readFile(new URL("./routes/index.js", import.meta.url), "utf8");

assert.match(
  routesIndex,
  /import \{ buildOperationOrchestratorRoutes \} from "\.\/operationOrchestratorRoutes\.js";/,
  "the operation orchestrator route builder must be imported by the route registry",
);
assert.match(
  routesIndex,
  /app\.use\(buildOperationOrchestratorRoutes\(\{ \.\.\.deps, requireAdminPrincipal \}\)\);/,
  "the operation orchestrator routes must be mounted by registerRoutes",
);

assert.throws(
  () => buildOperationOrchestratorRoutes(),
  (error) => error?.code === "OPERATION_ROUTE_SECURITY_MIDDLEWARE_REQUIRED",
  "operation routes must fail closed when security middleware is absent",
);

const passThrough = (_req, _res, next) => next();
const router = buildOperationOrchestratorRoutes({
  requireBackendApiKey: passThrough,
  requireAdminPrincipal: passThrough,
});
assert.equal(typeof router, "function");

const { operationLifecycleNeedsAttention } = _testingOperationOrchestratorRoutes;
assert.equal(operationLifecycleNeedsAttention({ workerResult: { status: "cleanup_failed" } }), true);
assert.equal(operationLifecycleNeedsAttention({ lifecycleResult: { status: "consume_failed" } }), true);
assert.equal(operationLifecycleNeedsAttention({ ownership: { status: "unavailable" } }), true);
assert.equal(operationLifecycleNeedsAttention({ artifactRegistry: { status: "unavailable" } }), true);
assert.equal(
  operationLifecycleNeedsAttention({
    workerResult: { status: "released" },
    lifecycleResult: { status: "consumed" },
    ownership: { recorded: true },
    artifactRegistry: { recorded: true },
  }),
  false,
);

const adminAuth = {
  mode: "backend_api",
  is_admin: true,
  admin_id: "admin-test",
};
const tenantAuth = {
  mode: "user_jwt",
  is_admin: false,
  user_id: "user-test",
  tenant_id: "tenant-test",
};

function buildReadOnlyPool() {
  const queries = [];
  return {
    queries,
    async query(sql) {
      queries.push(sql);
      if (sql.includes("FROM memberships")) {
        return [[{
          tenant_id: "tenant-test",
          role: "owner",
          status: "active",
          tenant_status: "active",
        }]];
      }
      if (sql.includes("FROM platform_resource_authority_bindings")) {
        return [[{
          binding_id: "binding-test",
          tenant_id: "tenant-test",
          workspace_id: null,
          user_id: "user-test",
          resource_type: "repository",
          resource_uri: "github://mad4bdigital-ai/test-repo",
          recipe_key: null,
          permission_level: "read",
          allowed_modes_json: ["read"],
          authority_source: "test_fixture",
          expires_at: null,
        }]];
      }
      if (sql.includes("FROM repository_automation_runs")) {
        return [[{
          run_id: "run-test",
          status: "completed",
          plan_json: "{\"mode\":\"dry_run\"}",
          summary_json: "{\"completed\":true}",
        }]];
      }
      if (sql.includes("FROM repository_automation_step_runs")) {
        return [[{
          run_id: "run-test",
          step_key: "readback",
          output_json: "{\"ok\":true}",
        }]];
      }
      if (sql.includes("FROM repository_automation_receipts")) {
        return [[]];
      }
      throw new Error(`Unexpected operation-orchestrator read query: ${sql}`);
    },
  };
}

const adminContextPool = buildReadOnlyPool();
const adminContext = await buildOperationContext({
  auth: adminAuth,
  input: {
    operation_key: "platform.surface.inspect",
    response_mode: "relevant",
  },
  pool: adminContextPool,
});
assert.equal(adminContext.principal.principal_class, "admin");
assert.equal(adminContext.secrets_included, false);
assert.equal(adminContextPool.queries.length, 0);

const tenantContextPool = buildReadOnlyPool();
const tenantContext = await buildOperationContext({
  auth: tenantAuth,
  input: {
    operation_key: "repo.change.preview",
    owner: "mad4bdigital-ai",
    repo: "test-repo",
    response_mode: "relevant",
  },
  pool: tenantContextPool,
});
assert.equal(tenantContext.principal.principal_class, "tenant");
assert.equal(tenantContext.authority.binding_id, "binding-test");
assert.equal(tenantContext.secrets_included, false);
assert.equal(tenantContextPool.queries.length, 2);

const adminPreview = await previewOperation(
  {
    operation_key: "repo.change.preview",
    owner: "mad4bdigital-ai",
    repo: "test-repo",
  },
  { auth: adminAuth, pool: buildReadOnlyPool() },
);
assert.equal(adminPreview.preview, undefined);
assert.equal(adminPreview.mutations_executed, false);
assert.equal(adminPreview.secrets_included, false);

const tenantPreview = await previewOperation(
  {
    operation_key: "repo.change.preview",
    owner: "mad4bdigital-ai",
    repo: "test-repo",
  },
  { auth: tenantAuth, pool: buildReadOnlyPool() },
);
assert.equal(tenantPreview.context.principal.principal_class, "tenant");
assert.equal(tenantPreview.mutations_executed, false);
assert.equal(tenantPreview.secrets_included, false);

const adminStatusPool = buildReadOnlyPool();
const adminStatus = await getOperationStatus(
  { operation_key: "operation.status.get", run_id: "run-test" },
  { auth: adminAuth, pool: adminStatusPool },
);
assert.equal(adminStatus.operation_key, "operation.status.get");
assert.equal(adminStatus.run.status, "completed");
assert.equal(adminStatus.steps[0].output_json.ok, true);
assert.equal(adminStatus.secrets_included, false);
assert.equal(adminStatusPool.queries.length, 3);

const tenantStatusPool = buildReadOnlyPool();
const tenantStatus = await getOperationStatus(
  { operation_key: "operation.status.get", run_id: "run-test" },
  { auth: tenantAuth, pool: tenantStatusPool },
);
assert.equal(tenantStatus.operation_key, "operation.status.get");
assert.equal(tenantStatus.run.status, "completed");
assert.equal(tenantStatus.secrets_included, false);
assert.equal(tenantStatusPool.queries.length, 4);

console.log("operation orchestrator route registration tests passed");
