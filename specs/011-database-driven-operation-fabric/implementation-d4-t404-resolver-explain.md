# D4 T404 Implementation — Resolver Explain Output

## Purpose

Implement Spec 011 task T404 as a deterministic, bounded explanation layer over the already-resolved operation-binding manifest. The explain module does not rerun eligibility, scoring, ranking, selection, fallback, or kill-switch evaluation.

## Candidate evidence

Each candidate is classified as one of:

- `selected`;
- `fallback`;
- `overflow`;
- `excluded`.

Evidence contains only binding ID, binding key, scope type, provider family, disposition, eligibility, selected state, fallback position, typed exclusion type, decision reason codes, labeled rank dimensions, score, and revision hash. It never includes raw scope references, metrics, credentials, provider payloads, or execution arguments.

Rank vectors are labeled as:

- scope specificity;
- provider match;
- capability match;
- priority;
- inverse fallback rank;
- score.

## Decision explanation

The report states the selected binding, bounded fallback IDs, overflow IDs, deterministic decision stages, policy hashes, candidate evidence, counts, and a stable explain hash. Selected candidates report `hard_constraints_satisfied` and `highest_effective_rank`. Fallback candidates report `eligible_ordered_fallback`. Overflow and hard-excluded candidates preserve their typed reason codes.

## Authority boundary

Explain output is evidence only. It explicitly reports:

- `explanation_only=true`;
- `candidate_recomputed=false`;
- `scoring_recomputed=false`;
- `selection_authorized=false`;
- `dispatch_authorized=false`;
- `fallback_executed=false`;
- `authority_created=false`.

## Scope boundaries

T404 adds an application explain module, compiler integration, focused tests, and documentation only. It adds no migration, route, OpenAPI change, database write, provider call, credential read, external write, runtime activation, deployment, or merge.
