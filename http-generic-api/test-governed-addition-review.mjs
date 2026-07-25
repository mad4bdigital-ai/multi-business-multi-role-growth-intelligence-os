import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildGovernedAdditionReviewResult } from "./routeWorkflowGovernance.js";

// frontend-surface-operation: POST /governed-addition/review
// frontend-read-action-proof: POST /governed-addition/review

const deps = {
  GOVERNED_ADDITION_OUTCOMES: new Set(["accepted", "rejected", "pending_validation"]),
  GOVERNED_ADDITION_STATES: new Set(["active", "blocked", "candidate", "degraded", "inactive", "pending_validation"]),
};

const review = buildGovernedAdditionReviewResult({
  outcome: "pending_validation",
  addition_state: "candidate",
  route_overlap_detected: true,
  graph_update_required: true,
}, deps);

assert.deepEqual(review, {
  outcome: "pending_validation",
  addition_state: "candidate",
  route_overlap_detected: true,
  workflow_overlap_detected: false,
  chain_needed: false,
  graph_update_required: true,
  bindings_update_required: false,
  policy_update_required: false,
  starter_update_required: false,
  reconciliation_required: false,
  validation_required: true,
});
assert.throws(
  () => buildGovernedAdditionReviewResult({ outcome: "apply_now" }, deps),
  /Invalid governed addition outcome/,
);

const routes = readFileSync("routes/governanceRoutes.js", "utf8");
assert(routes.includes('router.post("/governed-addition/review"'));
assert(routes.includes("buildGovernedAdditionReviewResult"));

console.log("governed addition review tests passed");
