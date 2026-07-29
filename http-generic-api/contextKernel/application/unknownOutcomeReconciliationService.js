import { assertExecutionLedgerRepository } from "./repositoryPorts.js";
import {
  ContextApplicationError,
  freezeApplicationValue,
  requireApplicationFunction,
  requireApplicationString,
  sanitizeApplicationValue,
} from "./applicationSupport.js";

const ALLOWED_OUTCOMES = new Set([
  "confirmed_applied",
  "confirmed_not_applied",
  "still_unknown",
  "conflict",
]);

const APPLIED_MARKERS = new Set([
  "applied",
  "succeeded",
  "completed",
  "committed",
  "confirmed_applied",
]);

const NOT_APPLIED_MARKERS = new Set([
  "not_applied",
  "failed_before_apply",
  "cancelled_before_apply",
  "confirmed_not_applied",
]);

function normalizedMarker(value) {
  return String(value || "").trim().toLowerCase();
}

function ledgerOutcome(plan, events) {
  const markers = [
    plan?.planStatus,
    plan?.runtimeStatus,
    ...events.flatMap((event) => [event.eventType, event.toStatus]),
  ].map(normalizedMarker).filter(Boolean);
  const hasAppliedMarker = markers.some((marker) => APPLIED_MARKERS.has(marker));
  const hasNotAppliedMarker = markers.some((marker) => NOT_APPLIED_MARKERS.has(marker));
  if (hasAppliedMarker && hasNotAppliedMarker) return "conflict";
  if (hasAppliedMarker) return "confirmed_applied";
  if (hasNotAppliedMarker) return "confirmed_not_applied";
  return null;
}

function nextAction(outcome) {
  switch (outcome) {
    case "confirmed_applied":
      return "return_readback";
    case "confirmed_not_applied":
      return "prepare_new_plan";
    case "conflict":
      return "manual_conflict_review";
    default:
      return "manual_outcome_review";
  }
}

export function createUnknownOutcomeReconciliationService({
  executionLedgerRepository,
  readbackPort,
  clock = () => new Date(),
}) {
  assertExecutionLedgerRepository(executionLedgerRepository);
  requireApplicationFunction(readbackPort, "readbackPort");
  requireApplicationFunction(clock, "clock");

  async function reconcile({ tenantRef, planRef, readbackInput = {} }) {
    const tenant = requireApplicationString(tenantRef, "tenantRef");
    const plan = requireApplicationString(planRef, "planRef");
    const executionPlan = await executionLedgerRepository.findExecutionPlan({
      tenantRef: tenant,
      planRef: plan,
    });
    if (!executionPlan) {
      throw new ContextApplicationError(
        "execution_plan_not_found",
        "The execution plan could not be found for reconciliation.",
        404,
        { tenant_ref: tenant, plan_ref: plan },
      );
    }
    const events = await executionLedgerRepository.listExecutionEvents({
      tenantRef: tenant,
      planRef: plan,
      limit: 500,
    });

    let outcome = ledgerOutcome(executionPlan, events);
    let evidence = { source: "execution_ledger" };
    let readbackPerformed = false;
    if (!outcome) {
      let readback;
      try {
        readback = await readbackPort({
          plan: executionPlan,
          events,
          input: sanitizeApplicationValue(readbackInput),
        });
      } catch (cause) {
        const error = new ContextApplicationError(
          "unknown_outcome_readback_failed",
          "Outcome reconciliation readback failed; automatic retry remains forbidden.",
          503,
          { tenant_ref: tenant, plan_ref: plan, automatic_retry_performed: false },
        );
        error.cause = cause;
        throw error;
      }
      outcome = typeof readback === "string" ? readback : readback?.outcome;
      evidence = typeof readback === "object" && readback ? readback.evidence || {} : {};
      readbackPerformed = true;
    }

    if (!ALLOWED_OUTCOMES.has(outcome)) {
      throw new ContextApplicationError(
        "unknown_outcome_readback_invalid",
        "Outcome reconciliation returned an unsupported result.",
        502,
        { outcome: outcome || null, automatic_retry_performed: false },
      );
    }

    return freezeApplicationValue({
      status: "reconciled",
      outcome,
      nextAction: nextAction(outcome),
      retryAllowed: false,
      automaticRetryPerformed: false,
      readbackPerformed,
      planRef: plan,
      tenantRef: tenant,
      ledgerEventCount: events.length,
      evidence,
      reconciledAt: clock().toISOString(),
      secretsIncluded: false,
    });
  }

  return Object.freeze({ reconcile });
}

export const _testingUnknownOutcomeReconciliationService = Object.freeze({
  ledgerOutcome,
  nextAction,
  normalizedMarker,
});
