import assert from "node:assert/strict";
import fs from "node:fs";

const workflow = fs.readFileSync("../.github/workflows/repository-inventory.yml", "utf8");
const contract = JSON.parse(
  fs.readFileSync("../.changes/e2e/repository-inventory-governed-regeneration.json", "utf8"),
);

assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/u);
assert.doesNotMatch(workflow, /contents:\s*write/u);
assert.doesNotMatch(workflow, /git\s+push/u);
assert.match(workflow, /bootstrap_pending/u);
assert.match(workflow, /self_hosting_bootstrap_pending/u);
assert.match(workflow, /trusted_generator_unchanged/u);
assert.match(workflow, /behind_by_zero/u);
assert.match(workflow, /trusted_post_merge_work_branch/u);
assert.match(workflow, /EVENT_NAME[^\n]*pull_request|EVENT_NAME.*pull_request/su);
assert.match(workflow, /git diff --quiet origin\/main\.\.\.HEAD --[\s\S]*scripts\/repository-inventory\.mjs[\s\S]*package\.json[\s\S]*package-lock\.json/u);
assert.match(workflow, /\.github\/workflows\/governed-generated-artifact-refresh\.yml/u);
assert.match(workflow, /\.github\/workflows\/repository-inventory-autofix-dispatch\.yml/u);
assert.match(workflow, /\.github\/workflows\/repository-inventory\.yml/u);
assert.match(workflow, /http-generic-api\/scripts\/maintenance-tools\/generated-artifact-refresh\.mjs/u);
for (const output of [
  "docs/repository-inventory.json",
  "docs/repository-inventory-summary.json",
  "docs/repository-inventory.md",
]) {
  assert.ok(workflow.includes(output), `expected bounded output ${output}`);
}
assert.match(workflow, /repository_mutation:false/u);
assert.match(workflow, /protected_branch_mutation:false/u);
assert.match(workflow, /force_push:false/u);
assert.equal(contract.feature_key, "repository-inventory-governed-regeneration");
assert.equal(contract.merge_contract?.minimum_phase, "mvp");
assert.ok(
  contract.phases?.[0]?.e2e_journeys?.[0]?.assertions?.some((value) =>
    String(value).includes("Candidate-modified generated-artifact mutation authority is never executed before it is trusted on main"),
  ),
);

console.log(JSON.stringify({
  contract: "mad4b.repository-inventory-self-hosting-bootstrap-test.v1",
  ok: true,
  permissions: "read_only",
  bootstrap_pending: true,
  candidate_mutation_before_main_trust: false,
  protected_branch_mutation: false,
  force_push: false,
  secrets_included: false,
}));
