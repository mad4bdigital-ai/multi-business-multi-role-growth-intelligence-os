import assert from "node:assert/strict";
import {
  SPEC011_T141_CANARY_CONTRACT_VERSION,
  SPEC011_T141_CANARY_MUTATIONS,
  SPEC011_T141_CANARY_STEPS,
  buildT141CanaryContract,
  evaluateT141CanaryOutcome,
  evaluateT141CanaryReadiness,
} from "./spec011T141ReadinessCanaryContract.js";

const UUIDS = Object.freeze({
  tenant: "00000000-0000-4000-8000-000000000001",
  primaryGrant: "00000000-0000-4000-8000-000000000002",
  expiryGrant: "00000000-0000-4000-8000-000000000003",
  envelope1: "00000000-0000-4000-8000-000000000011",
  envelope2: "00000000-0000-4000-8000-000000000012",
  envelope3: "00000000-0000-4000-8000-000000000013",
  envelope4: "00000000-0000-4000-8000-000000000014",
  hold1: "00000000-0000-4000-8000-000000000021",
  hold2: "00000000-0000-4000-8000-000000000022",
  hold3: "00000000-0000-4000-8000-000000000023",
  hold4: "00000000-0000-4000-8000-000000000024",
});

const NOW = "2026-08-03T11:00:00.000Z";
const EXPIRES = "2026-08-03T12:00:00.000Z";
const DEPLOYED_SHA = "1".repeat(40);
const MIGRATION_SHA = "2".repeat(64);
const SCHEMA_FINGERPRINT = "3".repeat(64);

function makePlan({ key, action, grantId, expectedStatus, proposedStatus, seed }) {
  const requestFingerprint = String(seed).repeat(64).slice(0, 64);
  const suffix = String(seed).padStart(2, "0").slice(-2);
  return {
    ok: true,
    report_type: "delegation_grant_lifecycle_shadow_plan",
    lifecycle_version: "spec011-delegation-grant-lifecycle-shadow-v1",
    action,
    decision: "eligible_shadow",
    command_preview: {
      action,
      expected_status: expectedStatus,
      proposed_status: proposedStatus,
      ...(action === "create"
        ? {
            grant: {
              grant_id: grantId,
              status: "active",
              secrets_included: false,
            },
          }
        : { grant_id: grantId }),
    },
    request_fingerprint: requestFingerprint,
    receipt: {
      schema_version: "spec011-mutation-receipt-v1",
      receipt_id: `10000000-0000-4000-8000-0000000000${suffix}`,
      operation_id: `20000000-0000-4000-8000-0000000000${suffix}`,
      step_id: `30000000-0000-4000-8000-0000000000${suffix}`,
      idempotency_key: `t141-${key}-${suffix}`,
      request_fingerprint: requestFingerprint,
      state: "pending",
      outcome_classification: "pending",
      retry_allowed: false,
      readback_complete: false,
      secrets_included: false,
    },
    blockers: [],
    execution_performed: false,
    secrets_included: false,
  };
}

function makePlans() {
  return {
    primary_create: makePlan({
      key: "primary-create",
      action: "create",
      grantId: UUIDS.primaryGrant,
      expectedStatus: "preview",
      proposedStatus: "active",
      seed: "a",
    }),
    primary_revoke: makePlan({
      key: "primary-revoke",
      action: "revoke",
      grantId: UUIDS.primaryGrant,
      expectedStatus: "active",
      proposedStatus: "revoked",
      seed: "b",
    }),
    expiry_create: makePlan({
      key: "expiry-create",
      action: "create",
      grantId: UUIDS.expiryGrant,
      expectedStatus: "preview",
      proposedStatus: "active",
      seed: "c",
    }),
    expiry_expire: makePlan({
      key: "expiry-expire",
      action: "expire",
      grantId: UUIDS.expiryGrant,
      expectedStatus: "active",
      proposedStatus: "expired",
      seed: "d",
    }),
  };
}

function makeBase(environment = "staging") {
  const production = environment === "production";
  return {
    environment,
    target: {
      environment,
      tenant_id: UUIDS.tenant,
      database_name: production ? "mad4b_production" : "mad4b_staging",
    },
    migration_readiness: {
      status: "verified_applied",
      migration_applied: true,
      readback_complete: true,
      checksum_pin_match: true,
      migration_checksum_sha256: MIGRATION_SHA,
      schema_readback_fingerprint: SCHEMA_FINGERPRINT,
      statement_count: 2,
      ledger_reference: `ledger://delegation/${environment}/20260725`,
      environment_authorized: true,
      production_authorized: production,
      secrets_included: false,
    },
    runtime_binding_status: {
      runtime_enabled: true,
      certified: true,
      checksum_pin_present: true,
      allowed_actions: ["create", "revoke", "expire"],
      public_route_added: false,
      runtime_policy_ready_promoted: false,
      secrets_included: false,
    },
    deployment_readback: {
      expected_deployed_sha: DEPLOYED_SHA,
      runtime_deployed_sha: DEPLOYED_SHA,
      same_cycle_readback: true,
      healthy: true,
      production_parity_verified: production,
      secrets_included: false,
    },
  };
}

function makeAuthorizations(plans, environment = "staging") {
  const envelopes = [UUIDS.envelope1, UUIDS.envelope2, UUIDS.envelope3, UUIDS.envelope4];
  const holds = [UUIDS.hold1, UUIDS.hold2, UUIDS.hold3, UUIDS.hold4];
  return Object.fromEntries(SPEC011_T141_CANARY_MUTATIONS.map((key, index) => [key, {
    approved: true,
    capability_envelope_id: envelopes[index],
    approval_hold_id: holds[index],
    resource_authority_ref: `authority://delegation/${environment}/${key}`,
    expected_request_fingerprint: plans[key].request_fingerprint,
    environment,
    expires_at: EXPIRES,
    secrets_included: false,
  }]));
}

function buildContract(environment = "staging") {
  const plans = makePlans();
  return buildT141CanaryContract({
    ...makeBase(environment),
    plans,
    authorization_bindings: makeAuthorizations(plans, environment),
    now: NOW,
  });
}

function makeObservations(contract, { production = false } = {}) {
  return {
    mutations: Object.fromEntries(SPEC011_T141_CANARY_MUTATIONS.map((key, index) => [key, {
      status: "verified_success",
      outcome_classification: "verified_success",
      request_fingerprint: contract.plans[key].request_fingerprint,
      grant_id: contract.plans[key].grant_id,
      grant_status: contract.plans[key].proposed_status,
      receipt_id: contract.plans[key].receipt_id,
      receipt_state: "reconciled",
      readback_complete: true,
      retry_allowed: false,
      readback_fingerprint: String(index + 4).repeat(64),
      runtime_policy_ready_promoted: false,
      secrets_included: false,
    }])),
    inspections: {
      primary_absent: { status: "absent", readback_complete: true },
      primary_active: { status: "active", readback_complete: true },
      primary_revoked: { status: "revoked", readback_complete: true },
      expiry_active: { status: "active", readback_complete: true },
      expiry_expired: { status: "expired", readback_complete: true },
    },
    receipts: {
      all_reconciled: true,
      retry_allowed: false,
      set_fingerprint_sha256: "9".repeat(64),
    },
    same_cycle: true,
    runtime_deployed_sha: contract.target.runtime_deployed_sha,
    production_parity_verified: production,
    production_runtime_readback_verified: production,
    secrets_included: false,
  };
}

const stagingReadiness = evaluateT141CanaryReadiness(makeBase("staging"));
assert.equal(stagingReadiness.version, SPEC011_T141_CANARY_CONTRACT_VERSION);
assert.equal(stagingReadiness.decision, "ready_for_governed_canary");
assert.equal(stagingReadiness.production_authorized, false);
assert.equal(stagingReadiness.execution_performed, false);

const blockedReadiness = evaluateT141CanaryReadiness({
  ...makeBase("staging"),
  migration_readiness: {
    ...makeBase("staging").migration_readiness,
    migration_applied: false,
    ledger_reference: "",
  },
});
assert.equal(blockedReadiness.decision, "blocked");
assert(blockedReadiness.blockers.includes("T141_MIGRATION_NOT_APPLIED"));
assert(blockedReadiness.blockers.includes("T141_MIGRATION_LEDGER_REFERENCE_REQUIRED"));

const stagingContract = buildContract("staging");
assert.equal(stagingContract.decision, "ready_for_governed_canary");
assert.equal(stagingContract.steps.length, SPEC011_T141_CANARY_STEPS.length);
assert.deepEqual(stagingContract.steps.map((step) => step.step), [...SPEC011_T141_CANARY_STEPS]);
assert(stagingContract.steps.filter((step) => step.mutation).every((step) => step.retry_allowed_after_unknown_outcome === false));
assert.equal(stagingContract.execution_performed, false);
assert.equal(stagingContract.delegation_mutated, false);
assert.match(stagingContract.contract_fingerprint_sha256, /^[0-9a-f]{64}$/);

const stagingOutcome = evaluateT141CanaryOutcome({
  contract: stagingContract,
  observations: makeObservations(stagingContract),
  now: "2026-08-03T11:10:00.000Z",
});
assert.equal(stagingOutcome.status, "staging_canary_verified");
assert.equal(stagingOutcome.execution_verified, true);
assert.equal(stagingOutcome.t141_completion_eligible, false);
assert.equal(stagingOutcome.t261_completion_eligible, false);
assert.equal(stagingOutcome.t263_completion_eligible, false);

const productionContract = buildContract("production");
const productionOutcome = evaluateT141CanaryOutcome({
  contract: productionContract,
  observations: makeObservations(productionContract, { production: true }),
  now: "2026-08-03T11:10:00.000Z",
});
assert.equal(productionOutcome.status, "production_canary_verified");
assert.equal(productionOutcome.t141_completion_eligible, true);
assert.equal(productionOutcome.t261_completion_eligible, true);
assert.equal(productionOutcome.t263_completion_eligible, true);
assert.equal(productionOutcome.runtime_policy_ready_promoted, false);

const unknownObservations = makeObservations(stagingContract);
unknownObservations.mutations.primary_create = {
  ...unknownObservations.mutations.primary_create,
  outcome_classification: "timeout_after_dispatch",
};
const unknownOutcome = evaluateT141CanaryOutcome({
  contract: stagingContract,
  observations: unknownObservations,
  now: "2026-08-03T11:10:00.000Z",
});
assert.equal(unknownOutcome.status, "reconciliation_required");
assert.equal(unknownOutcome.automatic_mutation_retry_allowed, false);
assert.equal(unknownOutcome.t141_completion_eligible, false);
assert(unknownOutcome.blockers.includes("T141_PRIMARY_CREATE_RECONCILIATION_REQUIRED"));

const incompleteObservations = makeObservations(stagingContract);
delete incompleteObservations.same_cycle;
const incompleteOutcome = evaluateT141CanaryOutcome({
  contract: stagingContract,
  observations: incompleteObservations,
  now: "2026-08-03T11:10:00.000Z",
});
assert.equal(incompleteOutcome.status, "failed_closed");
assert(incompleteOutcome.blockers.includes("T141_CANARY_SAME_CYCLE_REQUIRED"));

const stalePlans = makePlans();
const staleAuthorizations = makeAuthorizations(stalePlans, "staging");
staleAuthorizations.primary_revoke.expected_request_fingerprint = "f".repeat(64);
assert.throws(
  () => buildT141CanaryContract({
    ...makeBase("staging"),
    plans: stalePlans,
    authorization_bindings: staleAuthorizations,
    now: NOW,
  }),
  (error) => error?.code === "T141_CANARY_AUTHORIZATION_STALE",
);

const duplicatePlans = makePlans();
duplicatePlans.primary_revoke.request_fingerprint = duplicatePlans.primary_create.request_fingerprint;
duplicatePlans.primary_revoke.receipt.request_fingerprint = duplicatePlans.primary_create.request_fingerprint;
assert.throws(
  () => buildT141CanaryContract({
    ...makeBase("staging"),
    plans: duplicatePlans,
    authorization_bindings: makeAuthorizations(duplicatePlans, "staging"),
    now: NOW,
  }),
  (error) => error?.code === "T141_CANARY_REQUEST_FINGERPRINT_REUSE",
);

assert.throws(
  () => evaluateT141CanaryReadiness({
    ...makeBase("staging"),
    target: {
      ...makeBase("staging").target,
      api_key: "forbidden",
    },
  }),
  (error) => error?.code === "T141_CANARY_SECRET_FIELD_REJECTED",
);

assert.throws(
  () => buildT141CanaryContract({
    ...makeBase("staging"),
    plans: makePlans(),
    authorization_bindings: {
      ...makeAuthorizations(makePlans(), "staging"),
      primary_create: {
        ...makeAuthorizations(makePlans(), "staging").primary_create,
        resource_authority_ref: "Bearer forbidden-value",
      },
    },
    now: NOW,
  }),
  (error) => error?.code === "T141_CANARY_SECRET_VALUE_REJECTED",
);

console.log("Spec 011 T141 readiness canary contract tests passed");
