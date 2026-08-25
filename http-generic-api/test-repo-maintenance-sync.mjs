import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertOwnerCanWrite,
  classifyGeneratedArtifact,
  loadGeneratedArtifactRegistry,
} from "../.github/ops/generated-artifact-governance.mjs";

const syncScript = readFileSync("scripts/repo-maintenance-sync.mjs", "utf8");
const docsScript = readFileSync("scripts/update-repo-planning-docs.mjs", "utf8");
const autofillTest = readFileSync("test-openapi-autofill-missing-routes.mjs", "utf8");
const workflow = readFileSync("../.github/workflows/openapi-auto-sync.yml", "utf8");
const docsFollowupWorkflow = readFileSync("../.github/workflows/docs-agent-main-followup.yml", "utf8");
const permissionRunbook = readFileSync("../docs/repo-autosync-permissions.md", "utf8");
const registry = loadGeneratedArtifactRegistry();

assert(syncScript.includes("openapi-autofill-missing-routes.mjs"), "maintenance sync must run OpenAPI autofill");
assert(syncScript.includes("split-openapi.mjs"), "maintenance sync must know how to regenerate split OpenAPI schemas");
assert(syncScript.includes("writeSplitSchemas"), "split schema writes must be guarded behind an explicit flag");
assert(syncScript.includes("--write-split-schemas"), "maintenance sync must expose explicit split schema write mode");
assert(syncScript.includes("skipWorkMaps"), "Work Map generation must support explicit scope exclusion");
assert(syncScript.includes("--skip-work-maps"), "maintenance sync must expose explicit Work Map exclusion");
assert(syncScript.includes("platform-work-map-generator-skipped-explicit-scope"), "Work Map scope exclusion must be represented in maintenance evidence");
assert(syncScript.includes("update-repo-planning-docs.mjs"), "maintenance sync must update planning docs");
assert(syncScript.includes("surface-contract-discovery.mjs"), "maintenance sync must run SQL-backed surface contract discovery");
assert(syncScript.includes("--report-file"), "maintenance sync must write report files only when explicitly requested");
assert(!syncScript.includes('path.join(REPO_ROOT, "repo-maintenance-sync-result.json")'), "maintenance sync must not create a root report file by default");
assert(syncScript.includes("--write|--check"), "maintenance sync must expose explicit write/check modes");

assert(docsScript.includes("repo-maintenance-status.md"), "planning docs updater must write generated repo maintenance status doc");
assert(docsScript.includes("Deterministic repository-state snapshot"), "planning docs updater must avoid timestamp churn");
assert(!docsScript.includes("new Date().toISOString()"), "planning docs updater must not use current time in committed output");
assert(docsScript.includes("OpenAPI Source"), "planning docs updater must summarize OpenAPI source");
assert(docsScript.includes("Generated / Scoped OpenAPI Schemas"), "planning docs updater must summarize generated schemas");
assert(docsScript.includes("Route Coverage Allowlist"), "planning docs updater must summarize route coverage allowlist");
assert(docsScript.includes("Maintenance Contract"), "planning docs updater must include maintenance contract notes");

assert(workflow.includes("repo-maintenance-sync.mjs --write --skip-work-maps"), "OpenAPI auto-sync must call maintenance with Work Maps explicitly excluded");
assert(!workflow.includes("repo-maintenance-sync.mjs --write --write-split-schemas"), "maintenance orchestration must not opt into split schema writes by default");
assert(workflow.includes("--report-file"), "workflow must request an out-of-repo maintenance report file");
assert(workflow.includes("$RUNNER_TEMP/repo-maintenance-sync-result.json"), "workflow must keep maintenance reports out of the repository diff");
assert(!workflow.includes("repo-maintenance-sync-result.json; then"), "workflow must not include root report file in generated diff check");
assert(workflow.includes("Refuse Work Map mutation outside the governed writer"), "OpenAPI auto-sync must fail closed if maintenance mutates Work Maps");
assert(workflow.includes("git diff --quiet -- docs/work-maps"), "OpenAPI auto-sync must inspect the Work Map root directly");
assert(!workflow.includes("platform-work-map-generator.mjs --write"), "OpenAPI auto-sync must not invoke the Work Map writer directly");
assert(workflow.includes("git status --porcelain=v1 -z --untracked-files=all"), "auto-sync eligibility must classify the complete tracked and untracked mutation set");
assert(workflow.includes('changed_files+=("${entry:3}")'), "auto-sync classification must preserve generated paths containing spaces");
assert(workflow.includes("generated-artifact-governance.mjs"), "OpenAPI writer must delegate output authorization to the central registry verifier");
assert(workflow.includes("github-followup-automerge-readiness.mjs"), "OpenAPI auto-merge must verify server-side branch protection");
assert(workflow.includes('GH_TOKEN: ${{ secrets.REPO_AUTOSYNC_TOKEN }}'), "OpenAPI follow-up writes must use the trusted writer identity");
assert(workflow.includes('token: ${{ secrets.REPO_AUTOSYNC_TOKEN }}'), "OpenAPI PR creation must use the trusted writer identity");
assert(!workflow.includes("REPO_AUTOSYNC_TOKEN || github.token"), "OpenAPI follow-up writing must never fall back to GITHUB_TOKEN");
assert(!workflow.includes("continue-on-error: true"), "PR creation failure must remain a blocking writer failure");
assert(workflow.includes("--match-head-commit"), "auto-sync merge registration must remain bound to the exact reviewed head");
assert(!workflow.includes("docs/*.md|docs/**/*.md|canonicals/*.md|canonicals/**/*.md|*.md"), "auto-merge eligibility must not use the retired broad Markdown allowlist");

const maintenanceArtifact = classifyGeneratedArtifact("docs/repo-maintenance-status.md", registry);
assert.equal(maintenanceArtifact?.id, "repository-maintenance-status");
assert(maintenanceArtifact.owners.includes("openapi_auto_sync"));
assert.equal(maintenanceArtifact.auto_merge.allowed, true);
const surfaceArtifact = assertOwnerCanWrite(
  "openapi_auto_sync",
  "docs/surface-contract-governance-dashboard.json",
  registry,
);
assert.equal(surfaceArtifact.id, "surface-contract-documents");
assert.throws(
  () => assertOwnerCanWrite("openapi_auto_sync", "UNREGISTERED_ROOT_REPORT.md", registry),
  /unknown|unregistered/i,
  "unregistered root Markdown must fail closed",
);
assert.throws(
  () => assertOwnerCanWrite("openapi_auto_sync", "canonicals/example/generated.md", registry),
  /unknown|unregistered/i,
  "unclassified canonical Markdown must not regain generic auto-merge authority",
);

assert(docsFollowupWorkflow.includes('token: ${{ secrets.REPO_AUTOSYNC_TOKEN }}'), "Docs Agent checkout and PR creation must use REPO_AUTOSYNC_TOKEN");
assert(!docsFollowupWorkflow.includes('token: ${{ secrets.GITHUB_TOKEN }}'), "Docs Agent writer must not use GITHUB_TOKEN");
assert(docsFollowupWorkflow.includes("--untracked-files=all"), "Docs Agent scope guard must include untracked outputs");
assert(docsFollowupWorkflow.includes("generated-artifact-governance.mjs"), "Docs Agent must prove owner authorization for every generated path");
assert(docsFollowupWorkflow.includes("github-followup-automerge-readiness.mjs"), "Docs Agent safe auto-merge must require server-side readiness");
assert(docsFollowupWorkflow.includes("--match-head-commit"), "Docs Agent auto-merge must be exact-head bound");
assert(docsFollowupWorkflow.includes("docs-agent-followup-source:"), "Docs Agent follow-ups must retain a source-SHA marker for reconciliation");
assert(docsFollowupWorkflow.includes("steps.agent.outputs.should_write == 'true'"), "Docs Agent must not open empty follow-up PRs");
assert(!docsFollowupWorkflow.includes("--admin"));
assert(!docsFollowupWorkflow.includes("--force"));

assert(permissionRunbook.includes("Allow GitHub Actions to create and approve pull requests"), "permission runbook must document the required GitHub setting");
assert(permissionRunbook.includes("REPO_AUTOSYNC_TOKEN"), "permission runbook must document the dedicated auto-merge credential");
assert(permissionRunbook.includes("required for automated merge"), "permission runbook must explain why GITHUB_TOKEN cannot perform auto-merge");
assert(permissionRunbook.includes("Allow auto-merge"), "permission runbook must document the independent repository auto-merge setting");
assert(permissionRunbook.includes("action_required"), "permission runbook must classify blocked follow-up checks separately from test failures");
assert(
  permissionRunbook.includes("Actions: Read and write")
    && permissionRunbook.includes("Contents: Read and write")
    && permissionRunbook.includes("Pull requests: Read and write"),
  "permission runbook must document minimum fine-grained token permissions",
);
assert(permissionRunbook.includes("403 Resource not accessible by personal access token"), "permission runbook must document verifier dispatch rejection without Actions write permission");
assert(workflow.includes("create-pull-request"), "workflow must open reviewable PRs instead of pushing directly to main");

assert(autofillTest.includes("repo-maintenance-sync.mjs --write"), "legacy OpenAPI autofill test must accept orchestration path");

console.log("repo maintenance sync tests passed");
