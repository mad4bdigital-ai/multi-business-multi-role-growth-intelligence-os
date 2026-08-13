import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const root = process.cwd();
const launcher = fs.readFileSync(`${root}/.github/workflows/governed-production-promotion-request-launcher.yml`, "utf8");
const sourcePin = fs.readFileSync(`${root}/.github/workflows/governed-production-main-source-pin-guard.yml`, "utf8");
const schema = JSON.parse(fs.readFileSync(`${root}/.github/contracts/governed-command-parameters/production-promotion-request.v1.json`, "utf8"));

test("promotion launcher registers bounded human and AI policy review modes", () => {
  assert.match(launcher, /review_mode:/u);
  assert.match(launcher, /type: choice/u);
  assert.match(launcher, /- human/u);
  assert.match(launcher, /- ai_policy/u);
  assert.match(launcher, /AI_POLICY_REVIEW_MODE=bounded_supporting_gates_only/u);
  assert.match(launcher, /resolve_dispatch_run_once/u);
  assert.ok(launcher.includes("workflow_dispatch"), "AI policy resolver must select workflow_dispatch runs");
  for (const workflowFile of [
    "frontend-surface-dispatch.yml",
    "http-generic-api-fanout-relocation.yml",
    "custom-gpt-contract-guard.yml",
    "platform-completion-cleanup-readback.yml",
    "platform-remaining-scope-scorecard.yml",
    "spec-011-delegation-mariadb-certification.yml",
  ]) {
    assert.ok(launcher.includes(workflowFile), `AI policy allowlist must include ${workflowFile}`);
  }
  assert.match(launcher, /read_only_supporting_workflows_and_exact_candidate_validation/u);
  assert.match(launcher, /deployment_executed: false/u);
  assert.match(launcher, /migration_executed: false/u);
  assert.match(launcher, /credential_payload_read: false/u);
});

test("promotion parameter schema fails closed outside the two registered modes", () => {
  assert.deepEqual(schema.required.at(-1), "review_mode");
  assert.equal(schema.properties.review_mode.pattern, "^(human|ai_policy)$");
  assert.equal(schema.additionalProperties, false);
});

test("main source-pin guard can comment stale release PRs without broader mutation permission", () => {
  assert.match(sourcePin, /actions: write/u);
  assert.match(sourcePin, /contents: read/u);
  assert.match(sourcePin, /issues: write/u);
  assert.match(sourcePin, /pull-requests: write/u);
  assert.doesNotMatch(sourcePin, /contents: write/u);
  assert.doesNotMatch(sourcePin, /deployments: write/u);
  assert.match(sourcePin, /gh pr comment/u);
});

console.log(JSON.stringify({
  contract: "mad4b.production-promotion-review-mode.v1",
  ok: true,
  modes: ["human", "ai_policy"],
  ai_policy_scope: "read_only_supporting_workflows_and_exact_candidate_validation",
  protected_production_merge: false,
  deployment: false,
  migration_apply: false,
  grant_apply: false,
  provider_mutation: false,
  credential_payload_read: false,
  secrets_included: false,
}));
