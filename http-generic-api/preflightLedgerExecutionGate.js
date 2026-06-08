import { validatePreflightLedger } from "./scripts/preflight-ledger-validate.mjs";

function clean(value = "", max = 191) {
  return String(value || "").trim().slice(0, max);
}

export function preflightExecutionGateError(result = {}, message = "Preflight ledger validation failed.") {
  const err = new Error(message);
  err.status = 409;
  err.code = result?.error?.code || result?.decision || "preflight_ledger_execution_gate_failed";
  err.details = {
    valid: false,
    decision: result?.decision || null,
    error: result?.error || null,
    family_key: result?.family_key || null,
    preflight_id: result?.preflight_id || null,
    secrets_included: false,
  };
  return err;
}

export async function requireValidatedPreflightForExecution({
  familyKey,
  preflightId,
  expectedEnvelopeId = "",
  expectedDecision = "ready_for_dispatch",
  executionRef = "future_execution_adapter",
} = {}) {
  const family = clean(familyKey, 128);
  const id = clean(preflightId, 64);
  if (!family || !id) {
    const err = new Error("familyKey and preflightId are required before execution.");
    err.status = 400;
    err.code = "preflight_execution_gate_required_fields_missing";
    err.details = { family_key: family || null, preflight_id: id || null, secrets_included: false };
    throw err;
  }
  const validation = await validatePreflightLedger({
    familyKey: family,
    preflightId: id,
    expectedEnvelopeId: clean(expectedEnvelopeId, 64),
    expectedDecision: clean(expectedDecision, 128),
    requireReady: true,
    allowBlockedReadback: false,
  });
  if (!validation.valid || !validation.ready_for_dispatch || validation.preflight_decision !== expectedDecision) {
    throw preflightExecutionGateError(validation, "Execution requires a valid ready preflight ledger row.");
  }
  return {
    ok: true,
    execution_gate: "preflight_ledger_validated",
    execution_ref: clean(executionRef, 191),
    family_key: validation.family_key,
    preflight_id: validation.preflight_id,
    capability_envelope_id: validation.capability_envelope_id,
    budget_authority_id: validation.budget_authority_id || null,
    preflight_decision: validation.preflight_decision,
    ready_for_dispatch: true,
    requested_amount_minor: validation.requested_amount_minor,
    currency: validation.currency,
    meter_key: validation.meter_key,
    preflight_sha256: validation.preflight_sha256,
    hash_verified: true,
    no_provider_call: validation.no_provider_call === true,
    no_spend_change: validation.no_spend_change === true,
    secrets_included: false,
  };
}
