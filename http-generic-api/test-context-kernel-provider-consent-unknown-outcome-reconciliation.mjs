import assert from "node:assert/strict";

import {
  createProviderConsentUnknownOutcomeReconciliationService,
} from "./contextKernel/application/providerConsentUnknownOutcomeReconciliationService.js";

function repository(state) {
  return {
    async findAuthorizationState() { return state; },
  };
}

async function reconcile(handoff, state) {
  return createProviderConsentUnknownOutcomeReconciliationService({
    handoffReadPort: async () => handoff,
    authorizationStateRepository: repository(state),
    clock: () => new Date("2026-07-31T13:40:00.000Z"),
  }).reconcile({
    tenantRef: "tenant-1",
    stateRef: "state-1",
    handoffRef: "handoff-1",
  });
}

{
  const result = await reconcile(
    {
      status: "completed",
      providerCheckpointPresent: true,
      completionCheckpointPresent: true,
    },
    { tenantRef: "tenant-1", stateRef: "state-1", status: "consumed" },
  );
  assert.equal(result.outcome, "confirmed_applied");
  assert.equal(result.nextAction, "return_safe_completion_readback");
  assert.equal(result.automaticRetryPerformed, false);
}

{
  const result = await reconcile(
    {
      status: "retryable",
      providerCheckpointPresent: true,
      completionCheckpointPresent: false,
    },
    { tenantRef: "tenant-1", stateRef: "state-1", status: "claimed" },
  );
  assert.equal(result.outcome, "still_unknown");
  assert.equal(result.nextAction, "manual_persistence_readback");
  assert.equal(result.providerCallRepeated, false);
}

{
  const result = await reconcile(
    {
      status: "retryable",
      providerCheckpointPresent: false,
      completionCheckpointPresent: false,
    },
    { tenantRef: "tenant-1", stateRef: "state-1", status: "claimed" },
  );
  assert.equal(result.outcome, "confirmed_not_applied");
  assert.equal(result.nextAction, "prepare_governed_resume_or_new_claim");
}

{
  const result = await reconcile(
    {
      status: "completed",
      providerCheckpointPresent: true,
      completionCheckpointPresent: true,
    },
    { tenantRef: "tenant-1", stateRef: "state-1", status: "claimed" },
  );
  assert.equal(result.outcome, "conflict");
  assert.equal(result.nextAction, "manual_state_handoff_conflict_review");
}

{
  const result = await reconcile(
    {
      status: "failed",
      providerCheckpointPresent: false,
      completionCheckpointPresent: false,
    },
    { tenantRef: "tenant-1", stateRef: "state-1", status: "expired" },
  );
  assert.equal(result.outcome, "confirmed_not_applied");
  assert.equal(result.nextAction, "do_not_resume_terminal_state");
}

await assert.rejects(
  createProviderConsentUnknownOutcomeReconciliationService({
    handoffReadPort: async () => ({ status: "mystery" }),
    authorizationStateRepository: repository({
      tenantRef: "tenant-1",
      stateRef: "state-1",
      status: "claimed",
    }),
  }).reconcile({
    tenantRef: "tenant-1",
    stateRef: "state-1",
    handoffRef: "handoff-1",
  }),
  (error) => error.code === "provider_consent_handoff_status_unsupported",
);

console.log("context kernel provider consent unknown-outcome reconciliation tests passed");
