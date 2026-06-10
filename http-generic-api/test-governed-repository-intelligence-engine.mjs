import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveResourceRefInput } from "./platformResourceRecipeCapability.js";

const migration = readFileSync("migrations/267_sprint68_governed_repository_intelligence_engine.sql", "utf8");
const runtimeModule = readFileSync("platformResourceRecipeCapability.js", "utf8");
const releaseReadiness = readFileSync("releaseReadiness.js", "utf8");

function includesAll(source, values, label) {
  for (const value of values) {
    assert(source.includes(value), `${label} must include ${value}`);
  }
}

includesAll(migration, [
  "github_repo",
  "github_pull_request",
  "github_file",
  "github_migration",
  "repo.pr.reconciliation_sweep",
  "repo.pr.classify_staleness",
  "repo.pr.close_superseded",
  "repo.file.patch_apply",
  "repo.migration.detect_conflicts",
], "repository resource and recipe registry seeds");

includesAll(migration, [
  "governed_repository_intelligence_engine_policy_v1",
  "Resource + Recipe + Authority + Policy + Evidence",
  "capability_envelope_for_mutation",
  "same_cycle_validation",
  "dry_run_plan_only",
  "auto_merge",
  "force_push",
  "migration_apply",
  "secrets_included',false",
], "repository intelligence governance policy");

for (const forbidden of [
  "CREATE TABLE IF NOT EXISTS `repository_operation_runs`",
  "CREATE TABLE IF NOT EXISTS `repository_operation_evidence`",
  "CREATE TABLE IF NOT EXISTS `repository_recipe_registry`",
  "auto_merge_allowed',true",
  "force_push_allowed',true",
]) {
  assert(!migration.includes(forbidden), `migration must not introduce ${forbidden}`);
}

includesAll(runtimeModule, [
  "parseGithubRepoRef",
  "parseGithubPullRequestRef",
  "github_pull_request",
  "github_repo",
], "resource resolver must recognize repository and pull request resources");

const repoResolved = resolveResourceRefInput({ input: "https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os" });
assert.equal(repoResolved.resource_type, "github_repo");
assert.equal(repoResolved.resource_uri, "github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os");

const prResolved = resolveResourceRefInput({ input: "https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/pull/1061" });
assert.equal(prResolved.resource_type, "github_pull_request");
assert.equal(prResolved.resource_uri, "github://mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/pr/1061");
assert.equal(prResolved.resource_ref.pr_number, 1061);

includesAll(releaseReadiness, [
  "267_sprint68_governed_repository_intelligence_engine.sql",
  "governed_repository_intelligence_engine_policy_v1",
], "release readiness must enforce repository intelligence policy and migration");

console.log("governed repository intelligence engine foundation contract ok");
