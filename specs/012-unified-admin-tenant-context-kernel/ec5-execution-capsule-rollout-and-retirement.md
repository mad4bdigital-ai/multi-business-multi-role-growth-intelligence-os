# Spec 012 — EC5 Execution Capsule Rollout and Legacy Retirement

## Status

`in_progress`

EC5 adds a default-off rollout and legacy-resolver retirement gate. Readiness evaluation is separate from retirement application, and readiness never changes runtime behavior by itself.

## Mandatory rollout gates

Legacy resolver retirement is blocked unless all of the following hold:

- median repeated-resolution improvement is at least 40 percent;
- candidate enumeration reduction is at least 60 percent;
- parity and covered-operation rates are 100 percent;
- ambiguity suppression, cross-tenant access, connection substitution, and stale-authority acceptance regressions are all zero;
- read and mutation pilots passed;
- rollback drill passed;
- exact-head CI passed;
- Human Architecture/Security Review passed.

## Retirement evidence and authorization

Even when every rollout gate passes, the result is only `ready_for_legacy_retirement`. Applying a retirement plan additionally requires:

1. the rollout gate to be explicitly enabled;
2. `applyRetirement=true`;
3. a bounded retirement plan naming the canonical replacement, exact legacy resolver keys, rollback reference, metrics evidence reference and revision, and a SHA-256 metrics digest;
4. an independent approval bound to the same plan reference, the internally computed SHA-256 digest of the complete normalized plan, and the exact metrics evidence reference, revision, and digest;
5. an injected retirement executor.

The gate normalizes the complete metrics object into the versioned `execution-capsule-runtime-metrics-v1` representation, computes its SHA-256 digest internally, and requires exact equality with the plan metrics digest before readiness evaluation. Therefore measurement values cannot be changed while reusing an approval-bound digest. A public digest helper produces the same canonical metrics digest for governed plan construction.

The normalized retirement plan is separately serialized as `execution-capsule-runtime-retirement-plan-v1` and hashed internally. Its digest covers the plan reference, canonical replacement resolver, rollback reference, metrics evidence binding, metrics digest, and sorted legacy resolver set. The approval must carry that exact digest, preventing reuse against changed resolver scope or rollback contents even when the same plan reference is presented.

Duplicate legacy resolver keys are rejected, and the canonical replacement resolver cannot appear in the retirement set. The executor receives the normalized plan, computed plan digest, and bounded approval. Its result must read back the exact retired resolver set, replacement resolver, and rollback reference. Raw executor output is not returned; only the bounded retirement projection is exposed.

The gate does not discover, delete, mount, deploy, or synchronize runtime code automatically. The current delivery remains default-off and records no Production activation.

## Rollback and safety

`rollback()` restores shadow-only evaluation. Telemetry is bounded and non-authoritative. No credentials, provider payloads, raw governance evidence, or secrets are accepted by the rollout contract.

## Completion gates

EC5 completes after regression registration, generated evidence refresh, exact-head CI and side workflows, Human Architecture/Security Review, merge, and post-merge main readback. Actual Production activation or deployment remains a separately authorized lifecycle.
