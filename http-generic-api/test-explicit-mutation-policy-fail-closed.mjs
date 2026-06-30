import assert from "node:assert/strict";
import { evaluateGptToolDispatchPreflight } from "./governedExecutionPreflight.js";

const noPoliciesDeps = {
  pool: {
    query: async () => [[]],
  },
};

const missingClassification = await evaluateGptToolDispatchPreflight({
  callerType: "admin",
  toolKey: "legacy_tool_without_descriptor",
}, noPoliciesDeps);

assert.equal(missingClassification.ok, false);
assert.equal(missingClassification.classification, "blocked");
assert.deepEqual(missingClassification.errors, ["mutation_classification_missing"]);

const readOnlyTool = await evaluateGptToolDispatchPreflight({
  callerType: "admin",
  toolKey: "repo_inspect",
  method: "GET",
  tags: ["repo", "read_only"],
}, noPoliciesDeps);

assert.equal(readOnlyTool.ok, true);
assert.equal(readOnlyTool.classification, "allow");
assert.equal(readOnlyTool.evidence.reason, "read_only_tool_without_execution_policy");

const mutatingWithoutPolicy = await evaluateGptToolDispatchPreflight({
  callerType: "admin",
  toolKey: "repo_patch_apply",
  method: "POST",
  tags: ["repo", "mutation"],
}, noPoliciesDeps);

assert.equal(mutatingWithoutPolicy.ok, false);
assert.equal(mutatingWithoutPolicy.classification, "blocked");
assert.deepEqual(mutatingWithoutPolicy.errors, ["explicit_mutation_policy_not_configured"]);

console.log("test-explicit-mutation-policy-fail-closed passed");
