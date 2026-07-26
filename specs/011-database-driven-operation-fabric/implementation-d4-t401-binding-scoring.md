# D4 T401 Implementation — Binding Scoring

## Purpose

Implement Spec 011 task T401 as a focused application module for health, capacity, cost, reliability, and preference scoring after T400 hard-constraint eligibility.

## Compatibility

The scoring module preserves the existing compiler formula and six-decimal score. Existing dimensions remain supported for backward compatibility:

- health from normalized `quality`;
- reliability from `reliability`;
- privacy from `privacy`;
- preference from `preference_match`;
- context reuse from `context_reuse`;
- cost from `1 - estimated_cost`;
- latency from `1 - expected_latency`;
- capacity from `1 - saturation`.

The compiler's existing normalized weights remain authoritative. This phase does not introduce a second policy source or change default weights.

## Eligibility boundary

Only candidates that already passed T400 hard constraints may be scored. Direct scoring of an ineligible candidate fails with a conflict. A preference value may alter the score of an eligible candidate, but it cannot add a candidate, remove an exclusion, grant authority, select a candidate, or authorize dispatch.

## Evidence

Each score result includes bounded per-dimension evidence: source metric, raw metric, normalized value, weight, contribution, total score, and a deterministic evidence hash. Reports explicitly state:

- `candidate_selected=false`;
- `selection_authorized=false`;
- `fallback_performed=false`;
- `authority_created=false`;
- no provider calls, credential payload reads, external writes, or runtime activation changes.

## Scope boundaries

T401 does not implement T402 fallback, T403 kill switches, T404 resolver explain output, or T405 preference-authority negative integration tests. It adds no migration, route, OpenAPI change, provider call, credential read, external write, runtime activation, deployment, or merge.
