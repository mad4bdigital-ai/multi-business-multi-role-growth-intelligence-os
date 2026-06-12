import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runtime = readFileSync("platformResourceRecipeCapability.js", "utf8");
const migration = readFileSync("migrations/959_sprint68_github_file_patch_plan_diff_only_runtime.sql", "utf8");
const manifest = readFileSync("scripts/test-manifest.mjs", "utf8");

function includesAll(text, needles, label) {
  for (const needle of needles) {
    assert.ok(text.includes(needle), `${label} missing ${needle}`);
  }
}

includesAll(runtime, [
  'const GITHUB_FILE_PATCH_PLAN_RECIPE_KEY = "github.file.patch_plan"',
  "resource_type: \"github_file\"",
  "function buildGithubFilePatchPlan",
  "isBlockedGithubFilePath",
  "github_file_patch_plan_ready_v1",
  "github_file_patch_plan_is_diff_only",
  "provider_calls_made: 0",
  "write_performed: false",
  "commit_performed: false",
  "push_performed: false",
  "branch_mutation_performed: false",
  "file_content_returned: false",
  "secrets_included: false",
], "GitHub file patch plan runtime");

includesAll(migration, [
  "959_sprint68_github_file_patch_plan_diff_only_runtime.sql",
  "adapter_kind = 'db_adapter'",
  "WHERE adapter_key = 'github.file.content_read.adapter'",
  "WHERE adapter_key = 'github.file.patch_plan.adapter'",
  "WHERE recipe_key = 'github.file.patch_plan'",
  "diff_only_runtime_certified",
  "dispatch_allowed = 1",
  "apply_allowed = 0",
  "CREATE OR REPLACE VIEW v_github_file_patch_plan_runtime_readiness",
  "file_content_returned",
  "secrets_included",
], "GitHub file patch plan runtime migration");

assert.ok(!runtime.includes("raw_secret_response_allowed: true"), "runtime must not allow raw secret responses");
assert.ok(!migration.includes("apply_allowed = 1"), "patch plan migration must not enable apply");
assert.ok(manifest.includes("node test-github-file-patch-plan-runtime.mjs"), "test manifest must include GitHub file patch plan runtime test");

console.log("GitHub file patch plan diff-only runtime contract OK");
