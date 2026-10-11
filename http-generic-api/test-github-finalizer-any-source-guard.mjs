import assert from "node:assert/strict";
import { isAuthorizedMainAnySource, allowedCheckSource, latestSameCycleAttestorStatus, evaluateRequiredHeadChecks } from "../.github/ops/github-finalizer-check-source.mjs";

const attestorPolicy = {
  required_check_source_mode: "any_source_with_independent_finalizer_readback",
  required_check_producer: "trusted_github_app_attestor",
  any_source_governed_merge_requires: "same_cycle_trusted_attestor_status_creator_and_exact_candidate",
  native_auto_merge_forbidden: true,
};
assert.equal(isAuthorizedMainAnySource(attestorPolicy), true);
for (const modification of [
  { native_auto_merge_forbidden: false },
  { required_check_producer: "any_workflow" },
  { any_source_governed_merge_requires: "unverified_success" },
  { required_check_source_mode: "app_bound" },
]) assert.equal(isAuthorizedMainAnySource({ ...attestorPolicy, ...modification }), false);

const trusted = { context: "Derived State Closure", integration_id: 799 };
const anySource = { context: "Derived State Closure", integration_id: null };
const unrelated = { context: "Not Derived State Closure", integration_id: null };
const config = { context: "Derived State Closure", appId: 799, anySourceOptIn: true };
assert.equal(allowedCheckSource(trusted, { ...config, anySourceOptIn: false }), true);
assert.equal(allowedCheckSource(anySource, config), true);
assert.equal(allowedCheckSource(anySource, { ...config, anySourceOptIn: false }), false);
assert.equal(allowedCheckSource({ ...trusted, integration_id: 800 }, config), false);
assert.equal(allowedCheckSource(unrelated, config), false);
assert.equal(allowedCheckSource(anySource, { ...config, appId: 0 }), false);

const candidate = { context: "Derived State Closure", statusId: 9012, creatorId: 7331 };
const good = { context: candidate.context, state: "success", id: 9012, creator: { id: 7331 } };
const foreign = { context: candidate.context, state: "success", id: 9013, creator: { id: 9999 } };
const newerSameCreator = { context: candidate.context, state: "success", id: 9014, creator: { id: 7331 } };
const unrelatedStatus = { context: "Other", state: "failure", id: 8888, creator: { id: 17 } };
assert.equal(latestSameCycleAttestorStatus([good], candidate), true);
assert.equal(latestSameCycleAttestorStatus([unrelatedStatus, good], candidate), true);
assert.equal(latestSameCycleAttestorStatus([foreign, good], candidate), false, "newer spoof wins under GitHub Any source; deny merge");
assert.equal(latestSameCycleAttestorStatus([newerSameCreator, good], candidate), false, "even trusted App must match the same-cycle status ID");
assert.equal(latestSameCycleAttestorStatus([{ ...good, state: "failure" }], candidate), false);
assert.equal(latestSameCycleAttestorStatus([{ ...good, creator: { id: 100 } }], candidate), false);
assert.equal(latestSameCycleAttestorStatus([{ ...good, id: 9011 }], candidate), false);
assert.equal(latestSameCycleAttestorStatus([], candidate), false);
assert.equal(latestSameCycleAttestorStatus(null, candidate), false);
assert.equal(latestSameCycleAttestorStatus([good], { ...candidate, statusId: 0 }), false);
const bindings = ["Syntax Check", "Unit & Integration Tests", "Policy Objection Gate", "Derived State Closure"].map(context => ({ context, integration_id: null }));
const passingRuns = bindings.slice(0, 3).map((b, i) => ({ name: b.context, status: "completed", conclusion: "success", started_at: "2026-10-11T10:0" + i + ":00Z", app: { slug: "github-actions", id: 15368 } }));
const attestedStatus = { context: "Derived State Closure", state: "success", creator: { id: 7331 }, id: 9012 };
const evaluate = (runs, statuses) => evaluateRequiredHeadChecks(bindings, { checkRuns: runs, statuses });
assert.equal(evaluate(passingRuns, [attestedStatus]).ok, true);
assert.deepEqual(evaluate(passingRuns.slice(1), [attestedStatus]).missing, ["Syntax Check"]);
assert.equal(evaluate([{ ...passingRuns[0], conclusion: "failure" }, ...passingRuns.slice(1)], [attestedStatus]).ok, false);
assert.equal(evaluate([{ ...passingRuns[0], status: "queued" }, ...passingRuns.slice(1)], [attestedStatus]).ok, false);
assert.equal(evaluate(passingRuns, [{ ...attestedStatus, state: "failure" }]).ok, false);
assert.equal(evaluate(passingRuns, [attestedStatus, { context: "Syntax Check", state: "failure" }]).ok, false);
assert.equal(evaluate(passingRuns.map(run => ({ ...run, app: { slug: "untrusted", id: 99 } })), [attestedStatus]).ok, false);
console.log("GITHUB_ANY_SOURCE_GUARD_NATIVE_PASS");
