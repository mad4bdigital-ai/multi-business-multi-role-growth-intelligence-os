# Spec 012 T007A/T029D — Activation SLO Baseline Readiness

## Status

`measurement_contract_ready_production_baseline_required`

This record defines the evidence contract required to measure Activation production behavior and later publish the `fast`, `balanced`, `complete`, and `high_reliability` starter profiles. It does not measure Production, publish profile values, implement the T029D adapter, seed policy rows, or close either task.

## Why the tasks remain open

ADR-005 requires exact production thresholds to be measured and versioned rather than hardcoded. The repository currently contains the generic governed questionnaire engine plus deployment-exposure and operational-attention adapters, but no approved Activation stage SLO baseline or starter-profile values.

Publishing profile numbers without observed Production evidence would create unsupported timeout, retry, freshness, degradation, and response-mode behavior. Therefore:

- T007A remains open until a production baseline is registered and read back;
- T029D remains open until approved profiles, immutable bounds, compiler version, impact model, rollout, and rollback evidence exist.

## Measurement identity

Every baseline must be immutable and reproducible. Required identity includes:

- baseline ID;
- UTC window start and end;
- GitHub `main` SHA;
- deployed release identity;
- contract version;
- candidate compiler version;
- measurement-query version.

A baseline that cannot identify the exact deployed release or query version cannot support a starter profile.

## Required segmentation

Metrics must be segmented by:

- lifecycle stage;
- operation profile;
- Managed/Dedicated/mixed activation mode;
- dependency class;
- risk tier;
- tenant tier;
- synchronous/asynchronous response mode.

This prevents one fast internal read path from being used to set unsafe thresholds for external providers, mutation-sensitive stages, or dedicated infrastructure.

## Required metrics

The baseline must include counts for success, degradation, failure, timeout, rate limit, unknown outcome, reconciliation, and retries. Latency must include p50, p90, p95, and p99, with freshness lag, queue wait, and payload-size evidence where applicable.

No raw tenant/user identifiers, secrets, request bodies, response bodies, tokens, codes, credentials, or conversation content may be collected. Evidence must be tenant-safe aggregate data with completeness, missing-stage, clock-skew, deployment-transition, outlier, reproducibility, and same-window release-parity checks.

## Minimum sample policy

The repository does not invent a minimum sample count or observation duration. Both remain `null` until Operations/Product/Security approve the sampling policy. A small or mixed-release sample must not be promoted into an authoritative profile.

## Starter profiles

The four profile keys are reserved but deliberately unpublished:

- `fast`;
- `balanced`;
- `complete`;
- `high_reliability`.

For every profile:

- `profile_version` is null;
- `source_baseline_id` is null;
- `policy_values` are null;
- safety bounds are not approved;
- impact model is not validated;
- rollout and rollback are not approved.

This is a fail-closed state, not a placeholder profile release.

## T029D adapter gate

The Activation stage SLO questionnaire adapter may be implemented only after all of the following are available:

1. registered Production baseline and readback;
2. approved sampling policy;
3. approved profile values and versions;
4. approved immutable domain safety bounds;
5. registered compiler version;
6. validated impact model;
7. approved rollout and rollback plans;
8. exact-version SQL registry contract.

The questionnaire remains intake and compilation infrastructure; SQL registry rows remain runtime authority.

## Remaining approvals

Completion requires registered Operations, Product, and Security approval with identities and timestamps. Profile publication requires a baseline ID, profile versions/values, immutable bounds, compiler version, impact model, rollout plan, and rollback plan.

## Non-effects

This readiness package performs no Production query or read, publishes no profile, writes no policy seed, implements no runtime adapter, applies no SQL or migration, performs no deployment, accesses no credentials, and includes no secrets.
