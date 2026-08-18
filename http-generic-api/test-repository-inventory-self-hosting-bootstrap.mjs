import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync("../.github/workflows/repository-inventory.yml", "utf8");
const ci = fs.readFileSync("../.github/workflows/ci.yml", "utf8");
const dispatcher = fs.readFileSync("../.github/workflows/repository-inventory-autofix-dispatch.yml", "utf8");
const gate = fs.readFileSync("../scripts/repository-inventory-verification-gate.mjs", "utf8");
const registry = JSON.parse(fs.readFileSync("../.github/derived-state-governance.json", "utf8"));
const contract = JSON.parse(fs.readFileSync("../.changes/e2e/repository-inventory-governed-regeneration.json", "utf8"));

const inventory = registry.artifacts.find((entry) => entry.artifact_id === "repository_inventory");
const evaluation = registry.artifacts.find((entry) => entry.artifact_id === "repository_evaluation");

assert.equal(registry.policy?.pull_request_candidate, "github_merge_candidate");
assert.equal(registry.policy?.detection_mode, "read_only");
assert.equal(registry.policy?.observability_artifacts_publish_post_merge_only, true);
assert.equal(registry.policy?.observability_premerge_mutation_forbidden, true);
assert.equal(registry.policy?.protected_branch_mutation_forbidden, true);
assert.equal(registry.policy?.force_push_forbidden, true);

assert.equal(inventory?.artifact_class, "observability");
assert.equal(inventory?.merge_blocking, false);
assert.equal(inventory?.recipe, "repository_inventory_refresh");
assert.equal(evaluation?.artifact_class, "observability");
assert.equal(evaluation?.merge_blocking, false);
assert.equal(evaluation?.recipe, "repository_inventory_refresh");

assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/u);
assert.doesNotMatch(workflow, /contents:\s*write/u);
assert.match(workflow, /persist-credentials:\s*false/u);
assert.doesNotMatch(workflow, /git\s+push/u);
assert.match(workflow, /scripts\/repository-inventory-verification-gate\.mjs/u);
assert.match(ci, /Verify dynamic repository inventory/u);
assert.match(ci, /scripts\/repository-inventory-verification-gate\.mjs/u);

assert.match(dispatcher, /observability_artifacts_publish_post_merge_only/u);
assert.match(dispatcher, /observability_premerge_mutation_forbidden/u);
assert.match(dispatcher, /Repository Inventory drift is advisory before merge; feature-PR mutation intentionally suppressed/u);
assert.match(dispatcher, /Pre-merge Repository Inventory mutation is forbidden by policy/u);
assert.match(dispatcher, /SOURCE_EVENT.*pull_request/u);
assert.match(dispatcher, /SOURCE_EVENT.*push/u);
assert.match(dispatcher, /SOURCE_HEAD_BRANCH.*main/u);
assert.match(dispatcher, /create_from_main/u);
assert.match(dispatcher, /source_main_sha/u);
assert.match(dispatcher, /chore\/repository-inventory-main-sync-/u);
assert.doesNotMatch(dispatcher, /contents:\s*write/u);
assert.doesNotMatch(dispatcher, /git\s+push/u);

assert.match(gate, /mad4b\.repository-inventory-verification-gate\.v2/u);
assert.match(gate, /exact_head_mismatch/u);
assert.match(gate, /scripts\/repository-inventory\.mjs/u);
assert.match(gate, /inventory:check/u);
assert.match(gate, /inventory:test/u);
assert.match(gate, /sameHashes\(first, second\)/u);
assert.match(gate, /nondeterministic_generation/u);
assert.match(gate, /stale_observability/u);
assert.match(gate, /post_merge_observability_publish/u);
assert.match(gate, /merge_blocking:\s*artifact\.merge_blocking/u);
assert.match(gate, /artifact_class:\s*artifact\.artifact_class/u);
assert.match(gate, /pre-merge feature-branch mutation is forbidden/u);
assert.doesNotMatch(gate, /bootstrap_pending/u);
assert.doesNotMatch(gate, /trusted_authority_on_main/u);
assert.doesNotMatch(gate, /remote_head_sha_mismatch/u);

for (const output of [
  "docs/repository-inventory.json",
  "docs/repository-inventory-summary.json",
  "docs/repository-inventory.md"
]) {
  assert.ok(gate.includes(output), `expected bounded output ${output}`);
}

assert.equal(contract.feature_key, "repository-inventory-governed-regeneration");
assert.equal(contract.merge_contract?.minimum_phase, "mvp");
assert.ok(contract.scope?.include?.includes(".github/workflows/ci.yml"));
assert.ok(contract.scope?.include?.includes("scripts/repository-inventory-verification-gate.mjs"));
const assertions = contract.phases?.find((phase) => phase.id === "mvp")?.e2e_journeys?.[0]?.assertions || [];
assert.ok(assertions.some((value) => String(value).includes("merge_blocking=false")));
assert.ok(assertions.some((value) => String(value).includes("post-merge")));
assert.ok(assertions.some((value) => String(value).includes("feature-branch mutation")));

console.log(JSON.stringify({
  contract: "mad4b.repository-inventory-observability-v2-test.v1",
  ok: true,
  exact_candidate_verification: true,
  deterministic_double_pass: true,
  artifact_class: inventory.artifact_class,
  merge_blocking: inventory.merge_blocking,
  premerge_mutation: false,
  post_merge_publication: true,
  protected_branch_mutation: false,
  force_push: false,
  secrets_included: false
}));
