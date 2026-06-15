import assert from "node:assert/strict";
import {
  evaluateAgentDelegationOptIn,
  requireAgentDelegationOptIn,
} from "./agentDelegationOptIn.js";

const defaultDecision = evaluateAgentDelegationOptIn();
assert.equal(defaultDecision.ok, false);
assert.equal(defaultDecision.automatic_delegation_allowed, false);
assert.equal(defaultDecision.agent_api_dispatch_required, true);
assert(defaultDecision.blockers.includes("delegation_approval_required"));
assert(defaultDecision.blockers.includes("manual_api_delegation_mode_required"));

assert.throws(
  () => requireAgentDelegationOptIn({
    delegation_approved: true,
    delegation_mode: "automatic",
    delegation_reason: "Automatically delegate linked work.",
  }),
  (error) => error.code === "agent_delegation_opt_in_required"
    && error.details.blockers.includes("manual_api_delegation_mode_required")
);

const approved = requireAgentDelegationOptIn({
  delegation_approved: true,
  delegation_mode: "manual_api",
  delegation_reason: "Run one explicitly selected sub-agent through the API.",
});
assert.equal(approved.ok, true);
assert.equal(approved.delegation_mode, "manual_api");
assert.equal(approved.automatic_delegation_allowed, false);
assert.equal(approved.fallback_agent_allowed, false);

const approvedWithFallback = requireAgentDelegationOptIn({
  delegation_approved: true,
  delegation_mode: "manual_api",
  delegation_reason: "Run one selected sub-agent and permit one fallback agent.",
  allow_fallback_agent: true,
});
assert.equal(approvedWithFallback.fallback_agent_allowed, true);

console.log("agent delegation opt-in contracts passed");
