import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync("../.github/workflows/repository-inventory.yml", "utf8");
const ci = fs.readFileSync("../.github/workflows/ci.yml", "utf8");
const dispatcher = fs.readFileSync("../.github/workflows/repository-inventory-autofix-dispatch.yml", "utf8");
const writer = fs.readFileSync("../.github/workflows/governed-generated-artifact-refresh.yml", "utf8");
const gate = fs.readFileSync("../scripts/repository-inventory-verification-gate.mjs", "utf8");
const workMapIntegration = fs.readFileSync("../.github/workflows/spec-kit-work-map-integration.yml", "utf8");
const contract = JSON.parse(
  fs.readFileSync("../.changes/e2e/repository-inventory-governed-regeneration.json", "utf8"),
);

assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/u);
assert.doesNotMatch(workflow, /contents:\s*write/u);
assert.doesNotMatch(workflow, /git\s+push/u);
assert.match(workflow, /scripts\/repository-inventory-verification-gate\.mjs/u);
assert.match(ci, /Verify dynamic repository inventory/u);
assert.match(ci, /scripts\/repository-inventory-verification-gate\.mjs/u);
assert.match(dispatcher, /SOURCE_EVENT.*workflow_run/u);
assert.match(dispatcher, /SOURCE_HEAD_BRANCH/u);
assert.match(dispatcher, /MANUAL_MODE/u);
assert.match(dispatcher, /MANUAL_SOURCE_MAIN_SHA/u);
assert.match(dispatcher, /manual_mode_not_supported/u);
assert.match(dispatcher, /source_main_sha_mismatch/u);
assert.match(dispatcher, /SOURCE_EVENT.*push/u);
assert.match(dispatcher, /source_push_not_main/u);
assert.match(dispatcher, /source_main_head_is_stale/u);
assert.match(dispatcher, /mode="?\$\{?mode\}?|mode=\$\{mode\}/u);
assert.match(dispatcher, /chore\/repository-inventory-main-sync-\$\{SOURCE_HEAD_SHA:0:12\}/u);
assert.match(dispatcher, /main_convergence_exact_head_not_trusted/u);
assert.match(dispatcher, /PR publication remains a separate governed/u);
assert.doesNotMatch(dispatcher, /contents:\s*write/u);
assert.doesNotMatch(workMapIntegration, /^\s*-\s*"\.github\/workflows\/\*\*"/mu);
for (const workflow of [
  ".github/workflows/spec-kit-work-map-integration.yml",
  ".github/workflows/spec-kit-work-map-autofix.yml",
  ".github/workflows/spec-kit-work-map-autofix-recovery-dispatch.yml",
  ".github/workflows/spec-kit-work-map-recovery-bootstrap.yml",
]) {
  assert.match(workMapIntegration, new RegExp(workflow.replaceAll("/", "\\/"), "u"));
}
assert.match(writer, /create_from_main/u);
assert.match(writer, /source_main_sha/u);
assert.match(writer, /git\/refs/u);
assert.match(writer, /repository_inventory_refresh/u);
assert.match(writer, /Protected branch mutation is forbidden/u);
assert.doesNotMatch(writer, /gh\s+pr\s+merge/u);
assert.match(gate, /mad4b\.repository-inventory-verification-gate\.v1/u);
assert.match(gate, /ALLOWED_BOOTSTRAP_EVENTS = new Set\(\["pull_request", "workflow_dispatch"\]\)/u);
assert.match(gate, /governedWorkPush/u);
assert.match(gate, /same-repository governed work-branch push/u);
assert.match(gate, /scripts\/repository-inventory\.mjs/u);
assert.match(gate, /firstHashes = outputHashes\(\)/u);
assert.match(gate, /secondHashes = outputHashes\(\)/u);
assert.match(gate, /sameHashes\(firstHashes, secondHashes\)/u);
assert.match(gate, /repository_inventory_not_deterministic/u);
assert.match(gate, /remote_head_sha_mismatch/u);
assert.match(gate, /branch_requires_reconciliation/u);
assert.match(gate, /trusted_generator_or_package_changed/u);
assert.match(gate, /self_hosting_authority_installation_not_proven/u);
assert.match(gate, /trustedAuthorityOnMain/u);
assert.match(gate, /trusted_authority_on_main/u);
assert.match(gate, /dirty_set_exceeds_inventory_outputs/u);
assert.match(gate, /worktree_dirty_set_exceeds_inventory_outputs/u);
assert.match(gate, /bootstrap_pending/u);
assert.match(gate, /self_hosting_bootstrap_pending/u);
assert.match(gate, /trusted_generator_unchanged/u);
assert.match(gate, /behind_by_zero/u);
assert.match(gate, /trusted_post_merge_work_branch/u);
assert.match(gate, /repository_mutation:\s*false/u);
assert.match(gate, /protected_branch_mutation:\s*false/u);
assert.match(gate, /force_push:\s*false/u);
for (const output of [
  "docs/repository-inventory.json",
  "docs/repository-inventory-summary.json",
  "docs/repository-inventory.md",
]) {
  assert.ok(gate.includes(output), `expected bounded output ${output}`);
}
for (const authority of [
  ".github/workflows/governed-generated-artifact-refresh.yml",
  ".github/workflows/repository-inventory-autofix-dispatch.yml",
  ".github/workflows/repository-inventory.yml",
  "http-generic-api/scripts/maintenance-tools/generated-artifact-refresh.mjs",
]) {
  assert.ok(gate.includes(authority), `expected required authority ${authority}`);
}
assert.equal(contract.feature_key, "repository-inventory-governed-regeneration");
assert.equal(contract.merge_contract?.minimum_phase, "mvp");
assert.ok(contract.scope?.include?.includes(".github/workflows/ci.yml"));
assert.ok(contract.scope?.include?.includes("scripts/repository-inventory-verification-gate.mjs"));
assert.ok(
  contract.phases?.[0]?.e2e_journeys?.[0]?.assertions?.some((value) =>
    String(value).includes("Candidate-modified generated-artifact mutation authority is never executed before it is trusted on main"),
  ),
);

console.log(JSON.stringify({
  contract: "mad4b.repository-inventory-self-hosting-bootstrap-test.v2",
  ok: true,
  shared_gate: true,
  deterministic_double_pass: true,
  permissions: "read_only",
  bootstrap_pending: true,
  main_push_and_workflow_dispatch_recovery: true,
  manual_main_convergence_mode: true,
  trusted_authority_on_main_readback: true,
  governed_work_branch_push_recovery: true,
  work_map_trigger_scope_bounded: true,
  candidate_mutation_before_main_trust: false,
  protected_branch_mutation: false,
  force_push: false,
  secrets_included: false,
}));
