export const MANUAL_AGENT_DELEGATION_MODE = "manual_api";

export function evaluateAgentDelegationOptIn(input = {}) {
  const delegationApproved = input.delegation_approved === true;
  const delegationMode = String(input.delegation_mode || "").trim().toLowerCase();
  const delegationReason = String(input.delegation_reason || "").trim();
  const blockers = [];

  if (!delegationApproved) blockers.push("delegation_approval_required");
  if (delegationMode !== MANUAL_AGENT_DELEGATION_MODE) blockers.push("manual_api_delegation_mode_required");
  if (delegationReason.length < 10) blockers.push("delegation_reason_required");

  return {
    ok: blockers.length === 0,
    delegation_allowed: blockers.length === 0,
    delegation_mode: delegationMode || "disabled",
    delegation_reason: delegationReason || null,
    blockers,
    automatic_delegation_allowed: false,
    fallback_agent_allowed: input.allow_fallback_agent === true,
    agent_api_dispatch_required: true,
    secrets_included: false,
  };
}

export function requireAgentDelegationOptIn(input = {}) {
  const decision = evaluateAgentDelegationOptIn(input);
  if (decision.ok) return decision;
  const error = new Error("Agent delegation requires explicit manual API opt-in.");
  error.code = "agent_delegation_opt_in_required";
  error.status = 403;
  error.details = decision;
  throw error;
}
