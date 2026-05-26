import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const syncScript = readFileSync("scripts/repo-maintenance-sync.mjs", "utf8");
const docsScript = readFileSync("scripts/update-repo-planning-docs.mjs", "utf8");
const autofillTest = readFileSync("test-openapi-autofill-missing-routes.mjs", "utf8");
const workflow = readFileSync("../.github/workflows/openapi-auto-sync.yml", "utf8");

assert(syncScript.includes("openapi-autofill-missing-routes.mjs"), "maintenance sync must run OpenAPI autofill");
assert(syncScript.includes("split-openapi.mjs"), "maintenance sync must regenerate split OpenAPI schemas");
assert(syncScript.includes("update-repo-planning-docs.mjs"), "maintenance sync must update planning docs");
assert(syncScript.includes("repo-maintenance-sync-result.json"), "maintenance sync must emit a JSON result");
assert(syncScript.includes("--write|--check"), "maintenance sync must expose explicit write/check modes");

assert(docsScript.includes("repo-maintenance-status.md"), "planning docs updater must write generated repo maintenance status doc");
assert(docsScript.includes("OpenAPI Source"), "planning docs updater must summarize OpenAPI source");
assert(docsScript.includes("Generated / Scoped OpenAPI Schemas"), "planning docs updater must summarize generated schemas");
assert(docsScript.includes("Route Coverage Allowlist"), "planning docs updater must summarize route coverage allowlist");
assert(docsScript.includes("Maintenance Contract"), "planning docs updater must include maintenance contract notes");

assert(workflow.includes("repo-maintenance-sync.mjs --write"), "OpenAPI auto-sync workflow must call maintenance sync orchestrator");
assert(workflow.includes("docs/**/*.md"), "workflow must react to docs markdown maintenance files");
assert(workflow.includes("repo-maintenance-sync-result.json"), "workflow PR body must include/mention maintenance sync result");
assert(workflow.includes("create-pull-request"), "workflow must open reviewable PRs instead of pushing directly to main");
assert(workflow.includes("Do not merge this PR as-is"), "workflow must preserve review warning for generated stubs");

assert(autofillTest.includes("repo-maintenance-sync.mjs --write"), "legacy OpenAPI autofill test must accept orchestration path");

console.log("repo maintenance sync tests passed");
