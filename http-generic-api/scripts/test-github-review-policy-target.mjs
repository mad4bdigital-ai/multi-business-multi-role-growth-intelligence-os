import assert from "node:assert/strict";
import {
  REGISTERED_POLICY_BRANCHES,
  activationRequester,
  branchConfirmation,
  branchKey,
  capabilityBindingKey,
  readinessConfirmation,
  readinessMarkerPrefix,
  resolveTargetBranch,
  verifyConfirmation,
} from "./github-review-policy-target.mjs";

assert.deepEqual(REGISTERED_POLICY_BRANCHES, ["main", "Production"]);
assert.equal(resolveTargetBranch(), "main");
assert.equal(resolveTargetBranch("Production"), "Production");
assert.equal(branchKey("Production"), "production");
assert.equal(branchConfirmation("main"), "APPLY_GITHUB_MAIN_REVIEW_POLICY");
assert.equal(branchConfirmation("Production"), "APPLY_GITHUB_PRODUCTION_POLICY");
assert.equal(readinessConfirmation("main"), "AUTHORIZE_GITHUB_MAIN_REVIEW_POLICY_READINESS");
assert.equal(readinessConfirmation("Production"), "AUTHORIZE_GITHUB_PRODUCTION_POLICY_READINESS");
assert.equal(verifyConfirmation("main"), "VERIFY_GITHUB_MAIN_REVIEW_POLICY");
assert.equal(verifyConfirmation("Production"), "VERIFY_GITHUB_PRODUCTION_POLICY");
assert.equal(readinessMarkerPrefix("main"), "GITHUB_MAIN_REVIEW_POLICY_READINESS result=pass ");
assert.equal(readinessMarkerPrefix("Production"), "GITHUB_PRODUCTION_POLICY_READINESS result=pass ");
assert.equal(capabilityBindingKey("main"), "growth_intelligence_platform.github.primary.production");
assert.equal(capabilityBindingKey("Production"), "growth_intelligence_platform.github.primary.production");
assert.equal(activationRequester("Production"), "github_actions_github_production_review_policy_apply");
assert.throws(() => resolveTargetBranch("staging"), /TARGET_BRANCH/);

console.log(JSON.stringify({
  ok: true,
  contract: "github_review_policy_target.v1",
  registered_branches: REGISTERED_POLICY_BRANCHES,
  independent_confirmations: true,
  secrets_included: false,
}));
