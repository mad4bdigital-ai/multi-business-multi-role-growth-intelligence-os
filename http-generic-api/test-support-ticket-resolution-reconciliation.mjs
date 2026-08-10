import assert from "node:assert/strict";
import {
  SUPPORT_TICKET_RESOLUTION_RECONCILIATION_CONFIRMATION,
  assertSupportTicketResolutionReconciliationApplyAllowed,
  buildSupportTicketResolutionReconciliationPlan,
  supportTicketHasEscalationEvidence,
} from "./supportTicketResolutionReconciliation.js";

const baseTicket = {
  ticket_id: "ticket-a",
  tenant_id: "tenant-a",
  user_id: "user-a",
  status: "open",
  lifecycle_state: "triage_pending",
  category: "support",
  metadata_json: {},
};

assert.equal(supportTicketHasEscalationEvidence(baseTicket), false);
assert.equal(supportTicketHasEscalationEvidence({ ...baseTicket, metadata_json: { case_status: "escalated", current_step: "diagnostic_escalated" } }), true);

{
  const plan = buildSupportTicketResolutionReconciliationPlan({ tickets: [baseTicket], cases: [], alerts: [] });
  assert.equal(plan.candidate_count, 1);
  assert.equal(plan.candidates[0].reason, "resolution_case_missing");
  assert.equal(plan.candidates[0].operation, "ensure_support_ticket_resolution_case");
  assert.equal(plan.safety.uses_canonical_resolution_service, true);
}

{
  const plan = buildSupportTicketResolutionReconciliationPlan({
    tickets: [baseTicket],
    cases: [{ case_id: "case-a", resource_ref: "ticket://ticket-a" }],
    alerts: [],
  });
  assert.equal(plan.candidate_count, 0, "ordinary open ticket with a real Resolution Case needs no reconciliation");
}

{
  const escalated = { ...baseTicket, metadata_json: { resolution: { case_status: "escalated" } } };
  const plan = buildSupportTicketResolutionReconciliationPlan({
    tickets: [escalated],
    cases: [{ case_id: "case-a", resource_ref: "ticket://ticket-a" }],
    alerts: [],
  });
  assert.equal(plan.candidate_count, 1);
  assert.equal(plan.candidates[0].reason, "escalation_alert_missing");
  assert.equal(plan.candidates[0].case_missing, false);
  assert.equal(plan.candidates[0].alert_missing, true);
}

{
  const escalated = { ...baseTicket, metadata_json: { case_status: "escalated" } };
  const plan = buildSupportTicketResolutionReconciliationPlan({
    tickets: [escalated],
    cases: [{ case_id: "case-a", resource_ref: "ticket://ticket-a" }],
    alerts: [{ source_type: "support_ticket", source_record_id: "ticket-a" }],
  });
  assert.equal(plan.candidate_count, 0, "existing case + existing support alert must be an idempotent no-op");
}

{
  const plan = buildSupportTicketResolutionReconciliationPlan({
    tickets: [{ ...baseTicket, status: "closed" }],
    cases: [],
    alerts: [],
  });
  assert.equal(plan.candidate_count, 0, "closed tickets must not be reopened by reconciliation");
}

const dryRun = assertSupportTicketResolutionReconciliationApplyAllowed({ apply: false });
assert.equal(dryRun.allowed, false);
assert.equal(dryRun.required_confirmation, SUPPORT_TICKET_RESOLUTION_RECONCILIATION_CONFIRMATION);
assert.throws(
  () => assertSupportTicketResolutionReconciliationApplyAllowed({ apply: true, confirm: "WRONG" }),
  /APPLY_SUPPORT_TICKET_RESOLUTION_RECONCILIATION/,
);
assert.equal(
  assertSupportTicketResolutionReconciliationApplyAllowed({
    apply: true,
    confirm: SUPPORT_TICKET_RESOLUTION_RECONCILIATION_CONFIRMATION,
  }).allowed,
  true,
);

console.log("support ticket resolution reconciliation tests passed");
