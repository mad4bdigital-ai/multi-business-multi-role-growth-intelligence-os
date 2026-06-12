import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/961_sprint68_f5_f6_positive_smoke_certification.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");
const manifest = readFileSync("scripts/test-manifest.mjs", "utf8");

for (const expected of [
  "961_sprint68_f5_f6_positive_smoke_certification.sql",
  "github_file_patch_apply_after_review",
  "github_pull_request_create_after_review",
  "positive_smoke_passed_after_review_gate_certified",
  "dispatch_allowed = 1",
  "apply_allowed = 1",
  "repo_patch_apply:branch=gpt/smoke-f5-f6-completion-20260612",
  "github_pr_create:pr=1476",
  "draft=true",
  "direct_main_write=false",
  "merged=false",
  "CREATE OR REPLACE VIEW v_f5_f6_positive_smoke_certification_readback",
  "secrets=false",
]) {
  assert.ok(migration.includes(expected), `migration missing ${expected}`);
}

assert.ok(!migration.includes("merge_performed,\n  1"), "certification must not claim a merge occurred");
assert.ok(!migration.includes("direct_main_write_performed,\n  1"), "certification must not claim direct main write");
assert.ok(runner.includes("961_sprint68_f5_f6_positive_smoke_certification.sql"), "runner must allowlist 961");
assert.ok(manifest.includes("node test-f5-f6-positive-smoke-certification.mjs"), "manifest must include F5/F6 certification test");

console.log("F5/F6 positive smoke certification contract OK");
