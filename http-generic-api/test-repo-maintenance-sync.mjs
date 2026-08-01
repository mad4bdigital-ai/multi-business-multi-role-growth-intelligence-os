import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const syncScript = readFileSync("scripts/repo-maintenance-sync.mjs", "utf8");
const docsScript = readFileSync("scripts/update-repo-planning-docs.mjs", "utf8");
const autofillTest = readFileSync("test-openapi-autofill-missing-routes.mjs", "utf8");
const workflow = readFileSync("../.github/workflows/openapi-auto-sync.yml", "utf8");
const permissionRunbook = readFileSync("../docs/repo-autosync-permissions.md", "utf8");

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
assert(workflow.includes("docs/**/*.md"), "workflow must react to docs markdown maintenance files");
assert(workflow.includes("REPO_AUTOSYNC_TOKEN"), "workflow must support an optional stronger PR creation token");
assert(workflow.includes("Auto-sync PR credential mode"), "workflow must report token-vs-default credential mode without exposing secrets");
assert(workflow.includes("continue-on-error: true"), "workflow must not fail when repository settings block Actions-created PRs");
assert(permissionRunbook.includes("Allow GitHub Actions to create and approve pull requests"), "permission runbook must document the required GitHub setting");
assert(permissionRunbook.includes("REPO_AUTOSYNC_TOKEN"), "permission runbook must document the optional secret fallback");
assert(permissionRunbook.includes("contents: write") && permissionRunbook.includes("pull requests: write"), "permission runbook must document minimum token permissions");
assert(workflow.includes("create-pull-request"), "workflow must open reviewable PRs instead of pushing directly to main");
assert(workflow.includes("Do not merge this PR as-is"), "workflow must preserve review warning for generated stubs");

assert(autofillTest.includes("repo-maintenance-sync.mjs --write"), "legacy OpenAPI autofill test must accept orchestration path");

console.log("repo maintenance sync tests passed");
