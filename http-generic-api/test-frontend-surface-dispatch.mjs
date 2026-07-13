import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildDispatchPlan, isDirectExecution, parseMountedRouteFiles, parseOpenApiOperations, syncDispatchPlan } from "./scripts/frontend-surface-dispatch.mjs";

function write(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

const apiRoot = fs.mkdtempSync(path.join(os.tmpdir(), "frontend-dispatch-"));
write(apiRoot, "routes/index.js", `
import { buildTenantRoutes } from "./tenantRoutes.js";
import { buildAdminRoutes } from "./adminRoutes.js";
import { buildMixedRoutes } from "./mixedRoutes.js";
export function registerRoutes(app) {
  app.use(buildTenantRoutes());
  app.use(buildAdminRoutes());
  app.use(buildMixedRoutes());
}
`);
write(apiRoot, "routes/tenantRoutes.js", `
export function buildTenantRoutes() {
  const router = Router();
  router.get("/me/workspaces/:tenant_id/dashboard", handler);
  router.post("/me/workspaces/:tenant_id/dashboard/preview", handler);
  return router;
}
`);
write(apiRoot, "routes/adminRoutes.js", `
export function buildAdminRoutes({ requireAdminPrincipal }) {
  const router = Router();
  router.get("/admin/runtime/verification", requireAdminPrincipal, handler);
  router.post("/admin/runtime/verification/run", requireAdminPrincipal, handler);
  router.get("/admin/runtime/verification/readback", requireAdminPrincipal, handler);
  return router;
}
`);
write(apiRoot, "routes/mixedRoutes.js", `
export function buildMixedRoutes({ requireAdminPrincipal }) {
  const router = Router();
  router.get("/me/support/tickets", handler);
  router.get("/admin/support/tickets", requireAdminPrincipal, handler);
  return router;
}
`);
write(apiRoot, "openapi.yaml", `
openapi: 3.1.0
paths:
  /me/workspaces/{tenant_id}/dashboard:
    get:
      responses: {}
  /me/workspaces/{tenant_id}/dashboard/preview:
    post:
      responses: {}
  /admin/runtime/verification:
    get:
      responses: {}
  /admin/runtime/verification/run:
    post:
      responses: {}
  /admin/runtime/verification/readback:
    get:
      responses: {}
  /me/support/tickets:
    get:
      responses: {}
  /admin/support/tickets:
    get:
      responses: {}
`);
write(apiRoot, "resource-api-coverage.manifest.json", JSON.stringify({ resources: [] }));
write(apiRoot, "scripts/test-manifest.mjs", `export const tests = ["node test-tenant-dashboard.mjs", "node test-admin-runtime-verification.mjs", "node test-mixed-support-routes.mjs"];`);
write(apiRoot, "frontend-surface-policy.json", JSON.stringify({
  policy_key: "fixture",
  default_decision: "requires_review",
  rules: [
    { source_file: "routes/tenantRoutes.js", decision: "unified_ui", owner: "tenant-ui", rationale: "fixture" },
    { source_file: "routes/adminRoutes.js", decision: "unified_ui", owner: "admin-ui", rationale: "fixture" }
    ,{ source_file: "routes/mixedRoutes.js", decision: "unified_ui", owner: "support-ui", rationale: "fixture" }
  ]
}));

assert.equal(isDirectExecution(new URL("./scripts/frontend-surface-dispatch.mjs", import.meta.url).href, process.argv[1]), false);
assert.equal(parseOpenApiOperations(fs.readFileSync(path.join(apiRoot, "openapi.yaml"), "utf8")).size, 7);
assert.equal(parseMountedRouteFiles(fs.readFileSync(path.join(apiRoot, "routes/index.js"), "utf8")).length, 3);

const plan = buildDispatchPlan({ apiRoot, baselineRef: "fixture-sha" });
assert.equal(plan.schema_version, "frontend-surface-dispatch-v1");
assert.equal(plan.baseline.ref, "fixture-sha");
assert.equal(plan.coverage.mounted_route_file_count, 3);
assert.equal(plan.coverage.mounted_family_count, 4);
assert.equal(plan.coverage.mixed_scope_route_file_count, 1);
assert.equal(plan.coverage.operation_count, 7);
assert.equal(plan.coverage.openapi_gap_count, 0);
assert.equal(plan.coverage.unresolved_surface_decision_count, 0);
assert.equal(plan.families.find((family) => family.scope === "admin").wave, "F3-admin-workspaces");
assert.equal(plan.families.filter((family) => family.source_file === "routes/mixedRoutes.js").length, 2);
assert.deepEqual(plan.families.filter((family) => family.source_file === "routes/mixedRoutes.js").map((family) => family.scope).sort(), ["admin", "tenant"]);
assert.equal(new Set(plan.tasks.map((task) => task.task_key)).size, plan.tasks.length, "split-scope dispatch tasks must keep unique keys");
assert(plan.tasks.find((task) => task.wave === "F3-admin-workspaces").dependencies.includes("F2-admin-bff-session"));
assert(plan.tasks.filter((task) => task.state === "ready").length >= 1);
assert.equal(plan.safety.secrets_included, false);
assert.equal(JSON.stringify(plan).includes("BACKEND_API_KEY"), false);

const writeResult = syncDispatchPlan({ apiRoot, mode: "write", baselineRef: "fixture-sha" });
assert.equal(writeResult.ok, true);
assert.equal(fs.existsSync(path.join(apiRoot, "frontend-surface-dispatch.generated.json")), true);
const checkResult = syncDispatchPlan({ apiRoot, mode: "check", baselineRef: "fixture-sha" });
assert.equal(checkResult.ok, true);
assert.equal(checkResult.drift, false);

fs.appendFileSync(path.join(apiRoot, "routes/tenantRoutes.js"), "\nrouter.get('/me/new-surface', handler);\n");
const driftResult = syncDispatchPlan({ apiRoot, mode: "check", baselineRef: "fixture-sha" });
assert.equal(driftResult.ok, false);
assert.equal(driftResult.drift, true);

console.log("frontend surface discovery and dynamic dispatch tests passed");
