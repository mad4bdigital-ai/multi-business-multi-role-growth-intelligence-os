import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.join(__dirname, "migrations", "20260711_repo_conflict_intelligence_readonly_tags.sql");
const sql = fs.readFileSync(migrationPath, "utf8");

for (const toolKey of [
  "repo_conflict_intelligence_plan",
  "repo_conflict_intelligence_resolve_dry_run",
  "repo_conflict_intelligence_pr_automation_preview",
  "tenant_repo_conflict_intelligence_plan",
  "tenant_repo_conflict_intelligence_resolve_dry_run",
]) {
  assert.match(sql, new RegExp(toolKey));
}

assert.match(sql, /read_only/);
assert.match(sql, /preview_only/);
assert.doesNotMatch(sql, /approval_required/);
assert.match(sql, /no_provider_write/);
assert.match(sql, /no_git_mutation/);

console.log("repo conflict intelligence registry contract tests passed");
