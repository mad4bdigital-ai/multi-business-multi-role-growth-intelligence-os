import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const root = process.cwd();
const launcher = fs.readFileSync(`${root}/.github/workflows/governed-production-promotion-request-launcher.yml`, "utf8");
const mainSourcePin = fs.readFileSync(`${root}/.github/workflows/governed-production-main-source-pin-guard.yml`, "utf8");
const releaseSourcePin = fs.readFileSync(`${root}/.github/workflows/governed-production-release-source-pin-gate.yml`, "utf8");
const schema = JSON.parse(fs.readFileSync(`${root}/.github/contracts/governed-command-parameters/production-promotion-request.v1.json`, "utf8"));
const registry = JSON.parse(fs.readFileSync(`${root}/.github/contracts/production-promotion-supporting-gates.v1.json`, "utf8"));

test("promotion launcher keeps bounded human and AI policy review modes", () => {
  assert.match(launcher, /review_mode:/u);
  assert.match(launcher, /options: \[human, ai_policy\]/u);
  assert.match(launcher, /AI_POLICY_REVIEW_MODE=bounded_supporting_gates_only/u);
  assert.match(launcher, /declarative_read_only_supporting_gates_and_certified_release_cut_validation/u);
  assert.match(launcher, /AI_POLICY_REVIEW_FORBIDDEN=production_merge,deployment,migration,grant,provider_mutation,credential_payload_read/u);
  assert.match(launcher, /GATE_REGISTRY: \.github\/contracts\/production-promotion-supporting-gates\.v1\.json/u);
  assert.match(launcher, /production-promotion-supporting-gates\.mjs/u);
  assert.match(launcher, /production-certified-release-cut-validation\.yml/u);
  assert.doesNotMatch(launcher, /contents:\s*write/u);
  assert.doesNotMatch(launcher, /gh pr merge/u);
});

test("supporting-gate registry is the single read-only review-gate source", () => {
  assert.equal(registry.contract, "mad4b.production-promotion-supporting-gates.v1");
  assert.equal(registry.version, 1);
  assert.equal(registry.gates.length, 6);
  assert.equal(new Set(registry.gates.map((gate) => gate.id)).size, registry.gates.length);
  for (const gate of registry.gates) {
    assert.equal(gate.required, true);
    assert.equal(gate.effect, "read_only");
    assert.deepEqual(gate.modes, ["human", "ai_policy"]);
    assert.match(gate.workflow, /^[A-Za-z0-9][A-Za-z0-9._-]*\.ya?ml$/u);
  }
  for (const value of Object.values(registry.safety)) assert.equal(value, false);
});

test("promotion parameter schema fails closed outside registered review modes", () => {
  assert.deepEqual(schema.required.at(-1), "review_mode");
  assert.equal(schema.properties.review_mode.pattern, "^(human|ai_policy)$");
  assert.equal(schema.additionalProperties, false);
});

test("source-pin guards preserve immutable release cuts while forbidding protected writes", () => {
  assert.match(mainSourcePin, /actions:\s*write/u);
  assert.match(mainSourcePin, /contents:\s*read/u);
  assert.match(mainSourcePin, /guard_scope:"release_cut_ancestry"/u);
  assert.match(mainSourcePin, /main_tip_may_advance:true/u);
  assert.doesNotMatch(mainSourcePin, /git push/u);
  assert.doesNotMatch(mainSourcePin, /gh pr merge/u);

  assert.match(releaseSourcePin, /permissions:\s*\n\s*contents: read\s*\n\s*pull-requests: read/u);
  assert.match(releaseSourcePin, /certified release cut is not an ancestor of current main/u);
  assert.match(releaseSourcePin, /production_is_ancestor_of_release_cut:true/u);
  assert.match(releaseSourcePin, /main_tip_may_advance/u);
  assert.doesNotMatch(releaseSourcePin, /contents:\s*write/u);
  assert.doesNotMatch(releaseSourcePin, /gh pr (?:comment|close|merge)/u);
});

test("comment transport is observability only after canonical promotion evidence exists", () => {
  assert.match(launcher, /request evidence comment transport degraded/u);
  assert.match(launcher, /validation evidence comment transport degraded/u);
  assert.match(launcher, /Upload convergence evidence/u);
  assert.match(launcher, /if-no-files-found: error/u);
});

console.log(JSON.stringify({
  contract: "mad4b.production-promotion-review-mode.v2",
  ok: true,
  modes: ["human", "ai_policy"],
  support_gate_authority: "declarative_read_only_registry",
  release_mode: "certified_release_cut",
  main_tip_may_advance: true,
  protected_production_merge: false,
  deployment: false,
  migration_apply: false,
  grant_apply: false,
  provider_mutation: false,
  credential_payload_read: false,
  secrets_included: false,
}));
