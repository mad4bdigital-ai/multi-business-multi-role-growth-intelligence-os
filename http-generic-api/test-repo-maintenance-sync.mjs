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
assert(syncScript.includes("update-repo-planning-docs.mjs"), "maintenance sync must update planning docs");
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

assert(workflow.includes("repo-maintenance-sync.mjs --write"), "OpenAPI auto-sync workflow must call maintenance sync orchestrator");
assert(workflow.includes("--report-file"), "workflow must request an out-of-repo maintenance report file");
assert(workflow.includes("$RUNNER_TEMP/repo-maintenance-sync-result.json"), "workflow must keep maintenance reports out of the repository diff");
assert(!workflow.includes("repo-maintenance-sync-result.json; then"), "workflow must not include root report file in generated diff check");
assert(!/git diff --quiet --[\s\S]*http-generic-api\/openapi\.\*\.yaml[\s\S]*then/.test(workflow), "workflow must not auto-commit split schemas by default");
assert(workflow.includes("docs/**/*.md"), "workflow must react to docs markdown maintenance files");
assert(workflow.includes("REPO_AUTOSYNC_TOKEN"), "workflow must support an optional stronger PR creation token");
assert(workflow.includes("continue-on-error: true"), "workflow must not fail when repository settings block Actions-created PRs");
assert(workflow.includes("create-pull-request"), "workflow must open reviewable PRs instead of pushing directly to main");
assert(workflow.includes("Do not merge this PR as-is"), "workflow must preserve review warning for generated stubs");

assert(autofillTest.includes("repo-maintenance-sync.mjs --write"), "legacy OpenAPI autofill test must accept orchestration path");

console.log("repo maintenance sync tests passed");
