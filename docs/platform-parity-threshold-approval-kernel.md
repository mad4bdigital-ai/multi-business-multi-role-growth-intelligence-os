# Platform Parity Threshold Approval Kernel

## Purpose

T042 approves a bounded parity-threshold policy before any canary evaluation. It does not activate a canary, dispatch an adapter, select credentials, execute a provider, write an external system, run a migration, or cut over enforcement.

The implementation lives in `http-generic-api/platformParityThresholdApprovalKernel.js`. Focused tests live in `http-generic-api/test-platform-parity-threshold-approval-kernel.mjs`.

## Approved minimum thresholds

The default T042 policy encodes the acceptance requirements from the testing and parity strategy:

| Requirement | Approved minimum |
|---|---:|
| Cross-tenant denial tests | 100% |
| Replay and stale-envelope tests | 100% |
| Unresolved critical legacy-deny/adaptive-allow mismatches | 0 |
| Deterministic decision repeatability | 99.9% |
| Credential leakage findings | 0 |
| State-changing pilots with idempotency and readback | 100% |
| Unresolved ambiguous adapter selections | 0 |
| Decision latency SLO | Must pass |
| Reconciliation lag policy | Must pass |
| Security review | Must be complete |
| Rollback/readback evidence | Must be approved |

A global parity percentage alone remains insufficient.

## Approval binding

An approved threshold policy is bound to:

- a stable policy version;
- an approval identifier;
- an approver identity;
- an approval and expiry window;
- a SHA-256 threshold-policy hash;
- a SHA-256 T041 classification-evidence hash;
- the exact typed confirmation `APPROVE_T042_PARITY_THRESHOLDS_ONLY_NO_CANARY`.

Invalid timestamps, hashes, confirmation, or expiry windows fail closed.

## Evaluation result

A passing threshold evaluation may set:

- `eligibleForCanaryEvaluation: true`

It must always preserve:

- `canaryActivationAllowed: false`
- `providerApplyAllowed: false`
- `externalWriteAllowed: false`
- `mutationAllowed: false`
- `enforcementCutover: false`
- `migrationExecutionAuthorized: false`
- `secretsIncluded: false`
- `rawPayloadIncluded: false`
- `promptIncluded: false`

Passing T042 therefore means only that the approved threshold package is eligible for later canary evaluation. A separate explicit canary authority, runtime binding validation, certification, rollback readiness, and fresh evidence are still required.

## Fail-closed conditions

Canary evaluation eligibility is false when any required threshold fails, the approval is absent or expired, evidence hashes are malformed, or required evidence is missing. Critical privilege expansion, credential leakage, adapter ambiguity, replay/stale-envelope failure, and missing rollback/readback evidence all block advancement.
