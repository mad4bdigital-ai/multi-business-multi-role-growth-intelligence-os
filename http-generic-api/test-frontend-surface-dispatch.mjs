import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { buildDispatchPlan, expandRoutePaths, isDirectExecution, normalizeRoutePath, parseMountedRouteFiles, parseOpenApiContracts, parseOpenApiOperations, parseRoutesFromFile, parseTestEvidenceClaims, syncDispatchPlan } from "./scripts/frontend-surface-dispatch.mjs";
import { serializedSecurity } from "./scripts/openapi-runtime-auth-sync.mjs";

function write(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "frontend-dispatch-"));
const apiRoot = path.join(fixtureRoot, "http-generic-api");
fs.mkdirSync(apiRoot, { recursive: true });
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
  router.get("/me/workspaces/:tenant_id/dashboard", requireUserJwt, handler);
  router.post("/me/workspaces/:tenant_id/dashboard/preview", requireUserJwt, handler);
  router.get("/me/workspaces/:tenant_id/insights/:view?", requireUserJwt, handler);
  return router;
}
`);
write(apiRoot, "routes/adminRoutes.js", `
function requireAdminGuard(deps, requireAdminPrincipal) {
  return [deps.requireBackendApiKey, requireAdminPrincipal];
}
export function buildAdminRoutes({ requireBackendApiKey, requireAdminPrincipal }) {
  const router = Router();
  const deps = { requireBackendApiKey };
  const requireAdmin = [requireBackendApiKey, requireAdminPrincipal].filter(Boolean);
  const requireBackend = requireBackendApiKey || passthrough;
  const requireAdminAlias = requireAdminPrincipal || passthrough;
  router.get("/admin/runtime/verification", ...requireAdmin, handler);
  router.post("/admin/runtime/verification/run", ...requireAdminGuard(deps, requireAdminPrincipal), handler);
  router.get("/admin/runtime/verification/readback", requireBackend, requireAdminAlias, handler);
  return router;
}
`);
write(apiRoot, "routes/mixedRoutes.js", `
export function buildMixedRoutes({ requireAdminPrincipal }) {
  const router = Router();
  router.get("/me/support/tickets", async (req, res) => {
    await requireUserJwt(req);
    return handler(req, res);
  });
  router.get("/admin/support/tickets", requireAdminPrincipal, handler);
  router.get("/credential-intake/:token", (_req, res) => res.type("html").send("<!doctype html>"));
  router.get("/credential-intake/:token/schema", (_req, res) => res.json({ fields: [] }));
  router.get(
    "/signed-download/:token",
    requireBackendApiKey,
    requireFreshLocalManagerDeviceForPrivilegedInstaller,
    async (req, res) => {
      verifyInstallerDownloadToken(req.query.token);
      return handler(req, res);
    },
  );
  /* router.delete("/disabled/commented-route", requireAdminPrincipal, handler); */
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
components:
  securitySchemes:
    userBearerAuth:
      type: oauth2
      flows:
        authorizationCode:
          authorizationUrl: https://example.test/authorize
          tokenUrl: https://example.test/token
          scopes: {}
    signedQueryTokenAuth:
      type: apiKey
      in: query
      name: token
paths:
  /me/workspaces/{tenant_id}/dashboard:
    get:
      security: [{ userBearerAuth: [] }]
      responses: {}
  /me/workspaces/{tenant_id}/dashboard/preview:
    post:
      security: [{ userBearerAuth: [] }]
      responses: {}
  /me/workspaces/{tenant_id}/insights:
    get:
      security: [{ userBearerAuth: [] }]
      responses: {}
  /me/workspaces/{tenant_id}/insights/{view}:
    get:
      security: [{ userBearerAuth: [] }]
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
      security: [{ userBearerAuth: [] }]
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
  /signed-download/{token}:
    get:
      security: [{ signedQueryTokenAuth: [] }]
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
write(apiRoot, "openapi/openapi.tenant-gpt.auth.yaml", `
openapi: 3.1.0
components:
  securitySchemes:
    backendBearerAuth: { type: http, scheme: bearer }
paths:
  /me/workspaces/{tenant_id}/dashboard:
    get:
      security: [{ backendBearerAuth: [] }]
      responses: {}
`);
write(fixtureRoot, "canonicals/openapi/custom-gpt-surfaces.yaml", `
version: 1
surfaces:
  tenant_core:
    mode: generated_from_openapi
    output_file: openapi/openapi.tenant-gpt.auth.yaml
`);
write(apiRoot, "resource-api-coverage.manifest.json", JSON.stringify({ resources: [] }));
write(apiRoot, "scripts/test-manifest.mjs", `export const tests = ["node test-tenant-dashboard.mjs", "node test-admin-runtime-verification.mjs", "node test-mixed-support-routes.mjs", "node test-dynamic-team-routes.mjs"];`);
write(apiRoot, "test-tenant-dashboard.mjs", `
${"//"} frontend-surface-operation: GET /me/workspaces/{tenant_id}/dashboard
${"//"} frontend-surface-operation: POST /me/workspaces/{tenant_id}/dashboard/preview
${"//"} frontend-surface-operation: GET /me/workspaces/{tenant_id}/insights
${"//"} frontend-surface-operation: GET /me/workspaces/{tenant_id}/insights/{view}
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
  ],
  auth_rules: [
    {
      rule_id: "tenant-dashboard-auth",
      operation: "GET /me/workspaces/{tenant_id}/dashboard",
      profile: "user_jwt",
      owner: "tenant-ui",
      rationale: "Fixture auth decision.",
      evidence_refs: ["fixture-auth-rule"]
    }
  ],
  operation_rules: [
    {
      rule_id: "tenant-preview-read-action",
      operation: "POST /me/workspaces/{tenant_id}/dashboard/preview",
      classification: "read_action",
      owner: "tenant-ui",
      rationale: "Preview calculates a response without persisting state."
    }
  ]
}));
write(apiRoot, "frontend-operation-governance.generated.json", JSON.stringify({
  schema_version: "frontend-operation-governance-v1",
  generator: { id: "fixture-generator", source_digest: "a".repeat(64), fail_closed: true },
  source_authority: [],
  coverage: { candidate_count: 1, generated_rule_count: 1, rejected_candidate_count: 0 },
  operation_rules: [{
    rule_id: "generated-admin-verification-run",
    operation: "POST /admin/runtime/verification/run",
    classification: "state_change",
    owner: "runtime-operations",
    rationale: "Verification runs are persisted and read back in the same governed flow.",
    preflight: { mode: "operation", operation: "GET /admin/runtime/verification" },
    approval: { mode: "runtime_authorization" },
    readback: { mode: "operation", operation: "GET /admin/runtime/verification/readback" },
    rollback: { mode: "transaction" },
    parameter_bindings: {},
    evidence_refs: ["test-admin-runtime-verification.mjs"],
    generated_evidence: { recipe_id: "fixture", source_digest: "b".repeat(64), fail_closed: true },
  }],
  rejected_candidates: [],
  safety: {
    writes_runtime_source: false,
    writes_database: false,
    executes_provider_calls: false,
    deploys: false,
    secrets_included: false,
  },
}));

const frontendDispatchWorkflow = fs.readFileSync(new URL("../.github/workflows/frontend-surface-dispatch.yml", import.meta.url), "utf8");
assert.match(frontendDispatchWorkflow, /github\.event\.pull_request\.base\.ref/);
assert.doesNotMatch(frontendDispatchWorkflow, /github\.event\.pull_request\.base\.sha/);
const boundedEvidenceFilter = frontendDispatchWorkflow.split("\n").find((line) => line.includes("UNEXPECTED=")) || "";
assert.ok(
  boundedEvidenceFilter.includes("(http-generic-api/)?"),
  "bounded evidence filter must accept repository-root relative paths",
);
assert.ok(
  boundedEvidenceFilter.includes("frontend-operation-governance\\.generated\\.json"),
  "bounded evidence filter must include the generated operation-governance file",
);
assert.ok(
  boundedEvidenceFilter.includes("frontend-surface-dispatch\\.generated\\.json"),
  "bounded evidence filter must include the dispatch evidence file",
);
assert.ok(
  boundedEvidenceFilter.includes("openapi/frontend-runtime-routes\\.generated\\.yaml"),
  "bounded evidence filter must include the generated OpenAPI index",
);
assert.ok(
  boundedEvidenceFilter.includes("yaml)" + "$" + "' || true)"),
  "manual evidence refresh must use a closed and end-anchored bounded-file filter",
);
if (process.env.GITHUB_EVENT_NAME !== "workflow_dispatch") {
  assert.match(frontendDispatchWorkflow, /permissions:\s*\n\s*contents:\s*read/);
  assert.doesNotMatch(frontendDispatchWorkflow, /Commit generated evidence on manual dispatch/);
  assert.doesNotMatch(frontendDispatchWorkflow, /baseline_ref:/);
}

const repositorySurfacePolicy = JSON.parse(fs.readFileSync(new URL("./frontend-surface-policy.json", import.meta.url), "utf8"));
const repositoryDispatchSource = fs.readFileSync(new URL("./scripts/frontend-surface-dispatch.mjs", import.meta.url), "utf8");
const repositoryWebhookOpenApi = YAML.parse(fs.readFileSync(new URL("./openapi/github-repository-main-moved-webhook.yaml", import.meta.url), "utf8"));
const repositoryWebhookAuthRule = repositorySurfacePolicy.auth_rules.find(
  (rule) => rule.operation === "POST /webhooks/github/repository-main-moved",
);
assert.equal(repositoryWebhookAuthRule?.profile, "github_webhook_hmac", "webhook auth policy must use the resolver profile");
assert.match(repositoryDispatchSource, /github_webhook_hmac:\s*\{[^}]*githubWebhookSignature/s);
assert.deepEqual(
  repositoryWebhookOpenApi.paths["/webhooks/github/repository-main-moved"].post.security,
  [{ githubWebhookSignature: [] }],
  "webhook OpenAPI security must match the runtime HMAC profile",
);

assert.equal(isDirectExecution(new URL("./scripts/frontend-surface-dispatch.mjs", import.meta.url).href, process.argv[1]), false);
assert.equal(normalizeRoutePath("/runtime/parity/:environmentKey?"), "/runtime/parity/{environmentKey}");
assert.deepEqual(expandRoutePaths("/runtime/parity/:environmentKey?"), ["/runtime/parity", "/runtime/parity/{environmentKey}"]);
assert.deepEqual(
  parseRoutesFromFile('router.all("/root", requireUserJwt, handler);', "routes/rootRoutes.js")
    .map((operation) => operation.signature),
  ["GET /root", "POST /root", "PUT /root", "PATCH /root", "DELETE /root"],
  "router.all registrations must expand into every governed HTTP method",
);
const nestedRouterOperations = parseRoutesFromFile(`
  function mountOperationRoutes(router, middleware = []) {
    router.get("/operations/contracts", ...middleware, handler);
    router.post("/operations/execute", ...middleware, handler);
  }
  export function buildOperationRoutes() {
    const router = Router();
    const backendGuard = requireBackendApiKey;
    const adminGuard = requireAdminPrincipal;
    const admin = Router();
    mountOperationRoutes(admin, [backendGuard, adminGuard]);
    router.use("/admin", admin);
    const tenant = Router();
    mountOperationRoutes(tenant, [requireTenantOperationPrincipal]);
    router.use("/tenant", tenant);
    return router;
  }
`, "routes/nestedOperationRoutes.js");
assert.deepEqual(
  nestedRouterOperations.map((operation) => operation.signature).sort(),
  [
    "GET /admin/operations/contracts",
    "GET /tenant/operations/contracts",
    "POST /admin/operations/execute",
    "POST /tenant/operations/execute",
  ].sort(),
  "nested child routers must inherit their mounted prefixes without emitting bare helper routes",
);
assert.deepEqual(
  nestedRouterOperations.find((operation) => operation.signature === "GET /admin/operations/contracts").route_guards,
  ["requireAdminPrincipal", "requireBackendApiKey"],
);
assert.deepEqual(
  nestedRouterOperations.find((operation) => operation.signature === "GET /tenant/operations/contracts").route_guards,
  ["requireTenantOperationPrincipal"],
);
assert.equal(
  nestedRouterOperations.some((operation) => operation.path.startsWith("/operations/")),
  false,
  "helper-local bare routes must not enter the runtime inventory",
);
assert.deepEqual(
  parseTestEvidenceClaims("// frontend-surface-operation: POST /\n// frontend-surface-operation: GET /nested\n"),
  ["GET /nested", "POST /"],
  "registered evidence must support the root path as well as nested paths",
);
assert.equal(parseOpenApiOperations(fs.readFileSync(path.join(apiRoot, "openapi.yaml"), "utf8")).size, 12);
assert.equal(parseOpenApiOperations(fs.readFileSync(path.join(apiRoot, "openapi.yaml"), "utf8"), {
  sourcePath: path.join(apiRoot, "openapi.yaml"),
  apiRoot,
}).size, 20);
const blockSecuritySource = "security:\n  - adminBearerAuth: []\n  - backendApiKeyAuth: []\n";
const blockSecurityDocument = YAML.parseDocument(blockSecuritySource, { keepSourceTokens: true });
const blockSecurityNode = blockSecurityDocument.getIn(["security"], true);
const blockSecurityReplacement = serializedSecurity(blockSecuritySource, blockSecurityNode, [["adminBearerAuth"], ["backendApiKeyAuth"]]);
assert.equal(blockSecurityReplacement, "- adminBearerAuth: []\n  - backendApiKeyAuth: []\n");
const blockSecurityOutput = `${blockSecuritySource.slice(0, blockSecurityNode.range[0])}${blockSecurityReplacement}${blockSecuritySource.slice(blockSecurityNode.range[2])}`;
assert.deepEqual(YAML.parse(blockSecurityOutput).security, [{ adminBearerAuth: [] }, { backendApiKeyAuth: [] }]);
const securityContracts = parseOpenApiContracts(`
openapi: 3.1.0
security: []
components:
  securitySchemes:
    A: { type: http, scheme: bearer }
    B: { type: apiKey, in: header, name: x-key }
paths:
  /or:
    get:
      security: [{ A: [] }, { B: [] }]
      responses: { default: { description: ok } }
  /and:
    get:
      security: [{ A: [], B: [] }]
      responses: { default: { description: ok } }
`);
assert.deepEqual(securityContracts.get("GET /or").security_alternatives, [["A"], ["B"]]);
assert.deepEqual(securityContracts.get("GET /and").security_alternatives, [["A", "B"]]);
assert.equal(parseMountedRouteFiles(fs.readFileSync(path.join(apiRoot, "routes/index.js"), "utf8")).length, 4);
assert.deepEqual(
  parseMountedRouteFiles(`
    function registerOptionalRoutes(app) {
      import("./optionalRoutes.js").then(({ buildOptionalRoutes }) => {
        app.use(buildOptionalRoutes());
      });
    }
  `).map(({ builder, file, mount_prefix }) => ({ builder, file, mount_prefix })),
  [{ builder: "buildOptionalRoutes", file: "routes/optionalRoutes.js", mount_prefix: "/" }],
);

const plan = buildDispatchPlan({ apiRoot, baselineRef: "fixture-sha" });
assert.equal(plan.schema_version, "frontend-surface-dispatch-v1");
assert.equal(plan.baseline.ref, "fixture-sha");
assert.equal(plan.coverage.mounted_route_file_count, 5);
assert.equal(plan.coverage.mounted_family_count, 7);
assert.equal(plan.coverage.mixed_scope_route_file_count, 1);
assert.equal(plan.coverage.operation_count, 20);
const tenantOperations = plan.families.find((family) => family.source_file === "routes/tenantRoutes.js").operations;
assert(tenantOperations.some((entry) => entry.signature === "GET /me/workspaces/{tenant_id}/insights"));
assert(tenantOperations.some((entry) => entry.signature === "GET /me/workspaces/{tenant_id}/insights/{view}"));
assert(!plan.families.some((family) => family.operations.some((entry) => entry.signature === "DELETE /disabled/commented-route")), "commented legacy routes must not enter the runtime inventory");
assert.equal(plan.coverage.openapi_gap_count, 0);
assert.equal(plan.coverage.unresolved_surface_decision_count, 0);
assert(
  plan.families
    .find((family) => family.source_file === "routes/tenantRoutes.js")
    .operations
    .every((entry) => entry.auth_parity.state === "equivalent"),
  "tenant OAuth scheme aliases must compare as the runtime user-JWT principal",
);
assert(
  plan.families
    .find((family) => family.source_file === "routes/tenantRoutes.js")
    .operations
    .find((entry) => entry.signature === "GET /me/workspaces/{tenant_id}/dashboard")
    .runtime_auth.evidence.includes("fixture-auth-rule"),
  "exact auth policy rules must add auditable evidence",
);
const inlineHandlerAuth = plan.families
  .find((family) => family.source_file === "routes/mixedRoutes.js" && family.scope === "tenant")
  .operations
  .find((entry) => entry.signature === "GET /me/support/tickets");
assert.equal(inlineHandlerAuth.runtime_auth.profile, "user_jwt", "handler-internal auth calls must be discovered");
assert.equal(inlineHandlerAuth.auth_parity.state, "equivalent");
assert(
  !plan.baseline.authority.some((entry) => entry.file === "openapi/openapi.tenant-gpt.auth.yaml"),
  "generated audience projections must not satisfy canonical OpenAPI coverage",
);
assert(
  plan.baseline.authority.some((entry) => entry.file === "../canonicals/openapi/custom-gpt-surfaces.yaml"),
  "projection authority must participate in deterministic drift detection",
);
assert.equal(plan.families.find((family) => family.scope === "admin").wave, "F3-admin-workspaces");
assert(
  plan.families
    .find((family) => family.source_file === "routes/adminRoutes.js")
    .operations
    .every((entry) => entry.runtime_auth.profile === "admin_backend"),
  "filtered admin guard arrays must retain both authenticator and authorizer evidence",
);
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
assert(plan.baseline.authority.some((entry) => entry.file === "routes/tenantRoutes.js"), "mounted route implementations must participate in the baseline digest");
assert(plan.baseline.authority.some((entry) => entry.file.endsWith("/scripts/frontend-surface-dispatch.mjs") || entry.file === "scripts/frontend-surface-dispatch.mjs"));
assert(plan.tasks.find((task) => task.wave === "F3-admin-workspaces").dependencies.includes("F2-admin-bff-session"));
assert.equal(plan.tasks.filter((task) => task.state === "ready").length, 2, "both fully governed tenant fixtures may become ready");
assert.equal(plan.coverage.non_get_candidate_count, 9);
assert.equal(plan.coverage.classified_mutation_count, 1);
assert.equal(plan.coverage.governed_mutation_operation_count, 1);
assert.equal(plan.coverage.unresolved_operation_class_count, 7);
assert.equal(
  plan.families
    .find((family) => family.source_file === "routes/adminRoutes.js")
    .operations
    .find((operation) => operation.signature === "POST /admin/runtime/verification/run")
    .governance.classification_source,
  "generated_operation_rule",
  "checksum-bound generated rules must be merged into operation governance"
);
assert(plan.baseline.authority.some((entry) => entry.file === "frontend-operation-governance.generated.json"));
assert(plan.families.find((family) => family.source_file === "routes/dynamicTeamRoutes.js").operation_blockers.every((entry) => entry.blockers.includes("operation_classification_gap")));
assert.equal(plan.safety.secrets_included, false);
assert.equal(JSON.stringify(plan).includes("configuration_dependencies"), true);

const policyPath = path.join(apiRoot, "frontend-surface-policy.json");
const validPolicySource = fs.readFileSync(policyPath, "utf8");
const conflictingAuthPolicy = JSON.parse(validPolicySource);
conflictingAuthPolicy.auth_rules[0].profile = "public";
fs.writeFileSync(policyPath, JSON.stringify(conflictingAuthPolicy));
const conflictingAuthPlan = buildDispatchPlan({ apiRoot, baselineRef: "fixture-sha" });
const conflictingAuthOperation = conflictingAuthPlan.families
  .find((family) => family.source_file === "routes/tenantRoutes.js")
  .operations
  .find((entry) => entry.signature === "GET /me/workspaces/{tenant_id}/dashboard");
assert.equal(conflictingAuthOperation.runtime_auth.state, "unresolved");
assert.equal(conflictingAuthOperation.runtime_auth.profile, "auth_policy_conflicts_with_runtime_guard", "manual auth policy must not weaken discovered runtime guards");
fs.writeFileSync(policyPath, validPolicySource);

const partitionPolicy = JSON.parse(validPolicySource);
partitionPolicy.rules = partitionPolicy.rules
  .filter((rule) => rule.source_file !== "routes/mixedRoutes.js")
  .concat([
    { source_file: "routes/mixedRoutes.js", scope: "tenant", decision: "unified_ui", owner: "tenant-ui", rationale: "fixture" },
    { source_file: "routes/mixedRoutes.js", scope: "admin", decision: "unified_ui", owner: "admin-ui", rationale: "fixture" },
    {
      source_file: "routes/mixedRoutes.js",
      scope: "unresolved",
      path_prefix: "/credential-intake/{token}/schema",
      decision: "api_only",
      owner: "support-ui",
      rationale: "Schema data is consumed by the unified credential UI.",
    },
  ]);
fs.writeFileSync(policyPath, JSON.stringify(partitionPolicy));
const partitionPlan = buildDispatchPlan({ apiRoot, baselineRef: "fixture-sha" });
const unresolvedMixedFamilies = partitionPlan.families.filter(
  (family) => family.source_file === "routes/mixedRoutes.js" && family.scope === "unresolved",
);
assert.equal(unresolvedMixedFamilies.length, 2);
assert.equal(
  unresolvedMixedFamilies.find((family) => family.operations.some((operation) => operation.path.endsWith("/schema"))).surface_decision.decision,
  "api_only",
);
assert.equal(
  unresolvedMixedFamilies.find((family) => family.operations.some((operation) => !operation.path.endsWith("/schema"))).surface_decision.decision,
  "requires_review",
);
fs.writeFileSync(policyPath, validPolicySource);

const invalidPolicy = JSON.parse(validPolicySource);
invalidPolicy.rules.find((rule) => rule.source_file === "routes/tenantRoutes.js").decision = "unrecognized_surface";
fs.writeFileSync(policyPath, JSON.stringify(invalidPolicy));
const invalidPolicyPlan = buildDispatchPlan({ apiRoot, baselineRef: "fixture-sha" });
const invalidPolicyFamily = invalidPolicyPlan.families.find((family) => family.source_file === "routes/tenantRoutes.js");
assert.equal(invalidPolicyFamily.surface_decision.decision, "requires_review");
assert.equal(invalidPolicyFamily.surface_decision.owner, null);
assert.equal(
  invalidPolicyPlan.tasks.find((task) => task.task_key === `frontend.${invalidPolicyFamily.family_key}`).state,
  "blocked",
);
fs.writeFileSync(policyPath, validPolicySource);

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
assert.notEqual(driftResult.plan.baseline.source_digest, checkResult.plan.baseline.source_digest, "mounted route drift must invalidate the shared baseline digest");

console.log("frontend surface discovery and dynamic dispatch tests passed");
