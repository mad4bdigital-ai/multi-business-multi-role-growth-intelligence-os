import assert from "node:assert/strict";
import fs from "node:fs";

const convergence = fs.readFileSync("../.github/workflows/spec-kit-work-map-main-convergence.yml", "utf8");
const writer = fs.readFileSync("../.github/workflows/governed-generated-artifact-refresh.yml", "utf8");
const writerTool = fs.readFileSync("scripts/maintenance-tools/generated-artifact-refresh.mjs", "utf8");
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
assert.match(convergence, /manual_failed_source_run_not_found/u);
assert.match(convergence, /actions\/workflows\/spec-kit-work-map-integration\.yml\/runs/u);

// The dispatcher is deliberately not a Work Map producer. It consumes the
// bounded exact-head artifact emitted by the read-only Integration Gate and
// delegates all generation/mutation to the sole registered writer.
assert.doesNotMatch(convergence, /platform-work-map-generator\.mjs\s+--write/u);
assert.doesNotMatch(convergence, /platform-work-map-generator\.mjs\s+--check/u);
assert.match(convergence, /work-map-repair-candidate-main-\$\{SOURCE_MAIN_SHA\}/u);
assert.match(convergence, /mad4b\.work-map-repair-candidate\.v1/u);
assert.match(convergence, /gh run download/u);
assert.match(convergence, /\.path.*spec-kit-work-map-integration\.yml/u);
assert.match(convergence, /\.run_attempt \| tostring/u);
assert.match(convergence, /generated_from_exact_checked_out_head/u);
assert.match(convergence, /remote_write_executed/u);
assert.match(convergence, /secrets_included/u);
assert.match(convergence, /repair_changed_file_manifest_mismatch/u);
assert.match(convergence, /repair_changed_set_exceeds_work_maps/u);
assert.match(convergence, /repair_changed_output_missing/u);
assert.match(convergence, /find "\$artifact_root" -type l/u);

assert.match(convergence, /chore\/work-map-main-sync-\$\{SOURCE_HEAD_SHA:0:12\}/u);
assert.match(convergence, /target_branch_collision/u);
assert.match(convergence, /existing_target_exceeds_generated_work_map_scope/u);
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
assert.match(convergence, /Direct repository mutation by dispatcher: false/u);
assert.match(convergence, /Protected branch mutation: false/u);
assert.match(convergence, /Force push: false/u);

assert.match(writer, /create_from_main:/u);
assert.match(writer, /work_map_self_hosting_bootstrap/u);
assert.match(writer, /repository_inventory_refresh/u);
assert.match(writer, /\[\[ "\$RECIPE" == "repository_inventory_refresh" \|\| "\$RECIPE" == "work_map_self_hosting_bootstrap" \]\]/u);
assert.match(writer, /chore\/work-map-main-sync-\[0-9a-f\]\{12\}/u);
assert.match(writer, /source_main_sha/u);
assert.match(writer, /current_main_sha/u);
assert.match(writer, /test "\$current_main_sha" = "\$SOURCE_MAIN_SHA"/u);
assert.match(writer, /Protected branch mutation is forbidden/u);
assert.match(writer, /pr-generated-artifact-refresh\.yml/u);
assert.doesNotMatch(writer, /gh\s+pr\s+merge/u);
assert.doesNotMatch(writer, /git\s+push[^\n]*(?:--force|-f)(?:\s|$)/u);

// Deterministic generation remains inside the sole registered writer tool.
assert.match(writerTool, /work_map_self_hosting_bootstrap/u);
assert.match(writerTool, /capture_first_work_map_bootstrap_diff/u);
assert.match(writerTool, /capture_second_work_map_bootstrap_diff/u);
assert.match(writerTool, /work_map_self_hosting_not_idempotent/u);
assert.match(writerTool, /verify_work_maps_current/u);
assert.match(writerTool, /generated_artifact_write_set_violation/u);
assert.match(writerTool, /postpush_exact_head_readback/u);
assert.match(writerTool, /protected_branch_mutation_forbidden/u);

assert.match(integration, /push:\s*\n\s*branches: \[main\]/u);
assert.match(integration, /Generate exact-head Work Map repair candidate/u);
assert.match(integration, /work-map-repair-candidate-/u);
assert.match(integration, /mad4b\.work-map-repair-candidate\.v1/u);
assert.match(integration, /generated_from_exact_checked_out_head/u);
assert.match(integration, /remote_write_executed: false/u);
assert.match(integration, /secrets_included: false/u);
assert.match(integration, /Fail closed on stale generated Work Maps/u);
assert.doesNotMatch(integration, /contents:\s*write/u);
assert.doesNotMatch(integration, /git\s+push/u);

console.log(JSON.stringify({
  contract: "mad4b.work-map-main-self-convergence-test.v1",
  ok: true,
  source_identity: "exact_current_main",
  trigger: "failed_push_work_map_integration",
  repair_evidence: "exact_head_integration_artifact",
  dispatcher_work_map_generation: false,
  writer_deterministic_double_pass: true,
  classifier_repository_mutation: false,
  writer_target: "sha_specific_non_protected_branch",
  direct_main_mutation: false,
  production_mutation: false,
  force_push: false,
  secrets_included: false,
}));