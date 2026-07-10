import assert from "node:assert/strict";
import { analyzeRepoConflict, buildRepoConflictPlan, buildTenantConflictSummary, previewSemanticPatches } from "./repoConflictIntelligenceService.js";

const generated = analyzeRepoConflict({
  base: "main",
  head: "feature",
  compare: { mergeable: false, mergeable_state: "dirty" },
  commits: [{ sha: "abc", author: { login: "docs-agent[bot]" }, message: "generated work map" }],
  files: [
    { filename: "docs/auto-docs-agent/pr-2470.md", status: "modified" },
    { filename: "docs/work-maps/generated.json", status: "modified" }
  ]
});
assert.equal(generated.classification, "dirty_generated_docs_conflict");
assert.equal(generated.recommended_path, "clean_branch_replay");
assert.equal(generated.safe_to_auto_resolve, true);
assert.equal(generated.secrets_included, false);

const manual = analyzeRepoConflict({ compare: { mergeable: false, mergeable_state: "dirty" }, files: [{ filename: "src/auth/session.js", status: "conflicting", patch: "<<<<<<< ours" }] });
assert.equal(manual.classification, "manual_review_required");
assert.equal(manual.recommended_path, "manual_required");
assert.equal(manual.safe_to_auto_resolve, false);

const plan = buildRepoConflictPlan(generated);
assert.equal(plan.recommended_path, "clean_branch_replay");
assert.ok(plan.steps.includes("exclude_bot_generated_artifacts"));
assert.ok(plan.acceptance_gates.includes("ci_required"));

const source = 'import { a } from "./a.js";\n\nexport function registerRoutes(app, deps) {\n  app.use(buildRepositoryAutomationRoutes({ ...deps, requireAdminPrincipal }));\n}\n';
const preview = previewSemanticPatches({ operations: [
  { type: "insert_import_if_missing", path: "http-generic-api/routes/index.js", content: source, named_import: "buildRepoConflictIntelligenceRoutes", from: "./repoConflictIntelligenceRoutes.js" },
  { type: "insert_route_mount_if_missing", path: "http-generic-api/routes/index.js", content: source, anchor: "  app.use(buildRepositoryAutomationRoutes({ ...deps, requireAdminPrincipal }));", insertion: "  app.use(buildRepoConflictIntelligenceRoutes({ ...deps, requireAdminPrincipal }));" }
] });
assert.equal(preview.preview_count, 2);
assert.equal(preview.previews[0].changed, true);
assert.equal(preview.previews[1].changed, true);

const tenant = buildTenantConflictSummary(generated);
assert.equal(tenant.scope, "tenant");
assert.equal(tenant.recommended_path, "request_admin_resolution");
assert.equal(tenant.secrets_included, false);

console.log("repo conflict intelligence service tests passed");
