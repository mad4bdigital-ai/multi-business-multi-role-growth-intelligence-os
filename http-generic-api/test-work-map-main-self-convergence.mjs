import assert from "node:assert/strict";
import fs from "node:fs";

const convergence = fs.readFileSync("../.github/workflows/spec-kit-work-map-main-convergence.yml", "utf8");
const writer = fs.readFileSync("../.github/workflows/governed-generated-artifact-refresh.yml", "utf8");
const integration = fs.readFileSync("../.github/workflows/spec-kit-work-map-integration.yml", "utf8");

assert.match(convergence, /name: Spec Kit Work Map Main Convergence/u);
assert.match(convergence, /workflow_run:/u);
assert.match(convergence, /Spec Kit Work Map Integration/u);
assert.match(convergence, /workflow_dispatch:/u);
assert.match(convergence, /REQUEST_WORK_MAP_MAIN_CONVERGENCE/u);
assert.match(convergence, /SOURCE_CONCLUSION.*workflow_run/u);
assert.match(convergence, /SOURCE_EVENT.*workflow_run/u);
assert.match(convergence, /SOURCE_HEAD_BRANCH.*workflow_run/u);
assert.match(convergence, /\[\[ "\$SOURCE_CONCLUSION" == "failure" \]\]/u);
assert.match(convergence, /\[\[ "\$SOURCE_EVENT" == "push" \]\]/u);
assert.match(convergence, /\[\[ "\$SOURCE_HEAD_BRANCH" == "main" \]\]/u);
assert.match(convergence, /source_main_head_is_stale/u);
assert.match(convergence, /git rev-parse origin\/main/u);
assert.match(convergence, /platform-work-map-generator\.mjs --check/u);
assert.equal((convergence.match(/platform-work-map-generator\.mjs --write/gu) || []).length, 2);
assert.match(convergence, /grep -Ev '\^docs\/work-maps\/'/u);
assert.match(convergence, /work_map_generation_not_deterministic/u);
assert.match(convergence, /chore\/work-map-main-sync-\$\{SOURCE_HEAD_SHA:0:12\}/u);
assert.match(convergence, /target_branch_collision/u);
assert.match(convergence, /already_converged_generated_target_exists/u);
assert.match(convergence, /governed-generated-artifact-refresh\.yml\/dispatches/u);
assert.match(convergence, /recipe:"work_map_self_hosting_bootstrap"/u);
assert.match(convergence, /create_from_main:"true"/u);
assert.match(convergence, /source_main_sha:\$source_main_sha/u);
assert.match(convergence, /actions:\s*write/u);
assert.match(convergence, /contents:\s*read/u);
assert.doesNotMatch(convergence, /contents:\s*write/u);
assert.doesNotMatch(convergence, /git\s+push/u);
assert.doesNotMatch(convergence, /git\s+commit/u);
assert.doesNotMatch(convergence, /gh\s+pr\s+merge/u);
assert.doesNotMatch(convergence, /--force(?:-with-lease)?/u);
assert.match(convergence, /Protected branch mutation: false/u);
assert.match(convergence, /Force push: false/u);

assert.match(writer, /create_from_main:/u);
assert.match(writer, /work_map_self_hosting_bootstrap/u);
assert.match(writer, /repository_inventory_refresh/u);
assert.match(writer, /\[\[ "\$RECIPE" == "repository_inventory_refresh" \|\| "\$RECIPE" == "work_map_self_hosting_bootstrap" \]\]/u);
assert.match(writer, /chore\/work-map-main-sync-\[0-9a-f\]\{12\}/u);
assert.match(writer, /source_main_sha/u);
assert.match(writer, /current_main_sha/u);
assert.match(writer, /Protected branch mutation is forbidden/u);
assert.match(writer, /pr-generated-artifact-refresh\.yml/u);
assert.doesNotMatch(writer, /gh\s+pr\s+merge/u);
assert.doesNotMatch(writer, /git\s+push[^\n]*(?:--force|-f)(?:\s|$)/u);

assert.match(integration, /push:\s*\n\s*branches: \[main\]/u);
assert.match(integration, /Generate exact-head Work Map repair candidate/u);
assert.match(integration, /generated_from_exact_checked_out_head/u);
assert.match(integration, /remote_write_executed: false/u);
assert.match(integration, /Fail closed on stale generated Work Maps/u);
assert.doesNotMatch(integration, /contents:\s*write/u);

console.log(JSON.stringify({
  contract: "mad4b.work-map-main-self-convergence-test.v1",
  ok: true,
  source_identity: "exact_current_main",
  trigger: "failed_push_work_map_integration",
  deterministic_double_pass: true,
  classifier_repository_mutation: false,
  writer_target: "sha_specific_non_protected_branch",
  direct_main_mutation: false,
  production_mutation: false,
  force_push: false,
  secrets_included: false,
}));