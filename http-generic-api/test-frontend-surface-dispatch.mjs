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
import { buildDynamicTeamRoutes } from "./dynamicTeamRoutes.js";
export function registerRoutes(app) {
  app.use(buildTenantRoutes());
  app.use(buildTenantRoutes());
  app.use(buildAdminRoutes());
  app.use(buildMixedRoutes());
  app.use(buildDynamicTeamRoutes());
  app.post("/admin/control", requireBackendApiKey, requireAdminPrincipal, handler);
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
  router.get("/credential-intake/:token", (_req, res) => res.type("html").send("<!doctype html>"));
  router.get("/credential-intake/:token/schema", (_req, res) => res.json({ fields: [] }));
  return router;
}
`);
write(apiRoot, "routes/dynamicTeamRoutes.js", `
function registerTeamRoutes(router, { prefix }) {
  router.get(\`${"${prefix}"}/team\`, requireUserJwt, handler);
  router.post(\`${"${prefix}"}/team/members\`, requireUserJwt, handler);
  router.patch(\`${"${prefix}"}/team/members/:userId\`, requireUserJwt, handler);
  router.delete(\`${"${prefix}"}/team/members/:userId\`, requireUserJwt, handler);
}
export function buildDynamicTeamRoutes() {
  const router = Router();
  registerTeamRoutes(router, { prefix: "/me/workspaces/:workspaceId" });
  registerTeamRoutes(router, { prefix: "/me/brands/:brandRef" });
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
  /credential-intake/{token}:
    get:
      responses: {}
  /credential-intake/{token}/schema:
    get:
      responses: {}
  /admin/control:
    post:
      responses: {}
  /me/workspaces/{workspaceId}/team:
    $ref: './openapi/team.yaml#/workspaceTeam'
  /me/workspaces/{workspaceId}/team/members:
    $ref: './openapi/team.yaml#/workspaceTeamMembers'
  /me/workspaces/{workspaceId}/team/members/{userId}:
    $ref: './openapi/team.yaml#/workspaceTeamMemberById'
  /me/brands/{brandRef}/team:
    $ref: './openapi/team.yaml#/brandTeam'
  /me/brands/{brandRef}/team/members:
    $ref: './openapi/team.yaml#/brandTeamMembers'
  /me/brands/{brandRef}/team/members/{userId}:
    $ref: './openapi/team.yaml#/brandTeamMemberById'
`);
write(apiRoot, "openapi/team.yaml", `
workspaceTeam:
  get:
    responses: {}
workspaceTeamMembers:
  post:
    responses: {}
workspaceTeamMemberById:
  patch:
    responses: {}
  delete:
    responses: {}
brandTeam:
  get:
    responses: {}
brandTeamMembers:
  post:
    responses: {}
brandTeamMemberById:
  patch:
    responses: {}
  delete:
    responses: {}
`);
write(apiRoot, "resource-api-coverage.manifest.json", JSON.stringify({ resources: [] }));
write(apiRoot, "scripts/test-manifest.mjs", `export const tests = ["node test-tenant-dashboard.mjs", "node test-admin-runtime-verification.mjs", "node test-mixed-support-routes.mjs", "node test-dynamic-team-routes.mjs"];`);
write(apiRoot, "test-tenant-dashboard.mjs", `
${"//"} frontend-surface-operation: GET /me/workspaces/{tenant_id}/dashboard
${"//"} frontend-surface-operation: POST /me/workspaces/{tenant_id}/dashboard/preview
`);
write(apiRoot, "test-admin-runtime-verification.mjs", `
${"//"} frontend-surface-operation: GET /admin/runtime/verification
${"//"} frontend-surface-operation: POST /admin/runtime/verification/run
${"//"} frontend-surface-operation: GET /admin/runtime/verification/readback
`);
write(apiRoot, "test-mixed-support-routes.mjs", `
${"//"} frontend-surface-operation: GET /me/support/tickets
${"//"} frontend-surface-operation: GET /admin/support/tickets
${"//"} frontend-surface-operation: GET /credential-intake/{token}
${"//"} frontend-surface-operation: GET /credential-intake/{token}/schema
`);
write(apiRoot, "test-dynamic-team-routes.mjs", `
${"//"} frontend-surface-operation: GET /me/workspaces/{workspaceId}/team
${"//"} frontend-surface-operation: GET /me/brands/{brandRef}/team
${"//"} frontend-surface-operation: POST /me/workspaces/{workspaceId}/team/members
${"//"} frontend-surface-operation: POST /me/brands/{brandRef}/team/members
${"//"} frontend-surface-operation: PATCH /me/workspaces/{workspaceId}/team/members/{userId}
${"//"} frontend-surface-operation: PATCH /me/brands/{brandRef}/team/members/{userId}
${"//"} frontend-surface-operation: DELETE /me/workspaces/{workspaceId}/team/members/{userId}
${"//"} frontend-surface-operation: DELETE /me/brands/{brandRef}/team/members/{userId}
`);
write(apiRoot, "frontend-surface-policy.json", JSON.stringify({
  policy_key: "fixture",
  default_decision: "requires_review",
  rules: [
    { source_file: "routes/tenantRoutes.js", decision: "unified_ui", owner: "tenant-ui", rationale: "fixture" },
    { source_file: "routes/adminRoutes.js", decision: "unified_ui", owner: "admin-ui", rationale: "fixture" }
    ,{ source_file: "routes/mixedRoutes.js", decision: "unified_ui", owner: "support-ui", rationale: "fixture" }
    ,{ source_file: "routes/dynamicTeamRoutes.js", decision: "unified_ui", owner: "tenant-ui", rationale: "fixture" }
    ,{ source_file: "routes/index.js", decision: "internal_only", owner: "admin-runtime", rationale: "fixture" }
  ]
}));

assert.equal(isDirectExecution(new URL("./scripts/frontend-surface-dispatch.mjs", import.meta.url).href, process.argv[1]), false);
assert.equal(parseOpenApiOperations(fs.readFileSync(path.join(apiRoot, "openapi.yaml"), "utf8")).size, 10);
assert.equal(parseOpenApiOperations(fs.readFileSync(path.join(apiRoot, "openapi.yaml"), "utf8"), {
  sourcePath: path.join(apiRoot, "openapi.yaml"),
  apiRoot,
}).size, 18);
assert.equal(parseMountedRouteFiles(fs.readFileSync(path.join(apiRoot, "routes/index.js"), "utf8")).length, 4);

const plan = buildDispatchPlan({ apiRoot, baselineRef: "fixture-sha" });
assert.equal(plan.schema_version, "frontend-surface-dispatch-v1");
assert.equal(plan.baseline.ref, "fixture-sha");
assert.equal(plan.coverage.mounted_route_file_count, 5);
assert.equal(plan.coverage.mounted_family_count, 7);
assert.equal(plan.coverage.mixed_scope_route_file_count, 1);
assert.equal(plan.coverage.operation_count, 18);
assert.equal(plan.coverage.openapi_gap_count, 0);
assert.equal(plan.coverage.unresolved_surface_decision_count, 0);
assert.equal(plan.families.find((family) => family.scope === "admin").wave, "F3-admin-workspaces");
assert.equal(plan.families.filter((family) => family.source_file === "routes/mixedRoutes.js").length, 3);
assert.deepEqual(plan.families.filter((family) => family.source_file === "routes/mixedRoutes.js").map((family) => family.scope).sort(), ["admin", "tenant", "unresolved"]);
assert.equal(plan.families.find((family) => family.source_file === "routes/mixedRoutes.js" && family.scope === "unresolved").embedded_ui, true);
assert.equal(plan.families.find((family) => family.source_file === "routes/mixedRoutes.js" && family.scope === "unresolved").operations.find((operation) => operation.path.endsWith("/schema")).embedded_ui, false);
assert.equal(new Set(plan.tasks.map((task) => task.task_key)).size, plan.tasks.length, "split-scope dispatch tasks must keep unique keys");
assert(plan.families.find((family) => family.source_file === "routes/index.js").operations.some((operation) => operation.signature === "POST /admin/control"));
assert.deepEqual(
  plan.families.find((family) => family.source_file === "routes/dynamicTeamRoutes.js").operations.map((operation) => operation.signature).sort(),
  [
    "DELETE /me/brands/{brandRef}/team/members/{userId}",
    "DELETE /me/workspaces/{workspaceId}/team/members/{userId}",
    "GET /me/brands/{brandRef}/team",
    "GET /me/workspaces/{workspaceId}/team",
    "PATCH /me/brands/{brandRef}/team/members/{userId}",
    "PATCH /me/workspaces/{workspaceId}/team/members/{userId}",
    "POST /me/brands/{brandRef}/team/members",
    "POST /me/workspaces/{workspaceId}/team/members",
  ].sort(),
);
assert(plan.baseline.authority.some((entry) => entry.file === "openapi/team.yaml"));
assert(plan.baseline.authority.some((entry) => entry.file.endsWith("/scripts/frontend-surface-dispatch.mjs") || entry.file === "scripts/frontend-surface-dispatch.mjs"));
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
const implicitBaselineCheck = syncDispatchPlan({ apiRoot, mode: "check" });
assert.equal(implicitBaselineCheck.ok, true);
assert.equal(implicitBaselineCheck.plan.baseline.ref, "fixture-sha");

fs.appendFileSync(path.join(apiRoot, "routes/tenantRoutes.js"), "\nrouter.get('/me/new-surface', handler);\n");
const driftResult = syncDispatchPlan({ apiRoot, mode: "check", baselineRef: "fixture-sha" });
assert.equal(driftResult.ok, false);
assert.equal(driftResult.drift, true);

console.log("frontend surface discovery and dynamic dispatch tests passed");
