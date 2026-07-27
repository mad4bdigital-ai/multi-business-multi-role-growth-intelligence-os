# D4 T402 Implementation — Bounded Ordered Fallback

## Purpose

Implement Spec 011 task T402 as a focused, deterministic fallback-planning module after T400 eligibility and T401 scoring.

## Ordering

The planner preserves the compiler's existing rank-vector ordering. Rank values are compared descending in vector order, with `binding_key` as the deterministic final tie-breaker. The full ordered eligible ID list remains available to the compiler for ambiguity checks.

## Bounds

The default maximum number of fallback bindings is 25. Callers may request between 0 and 100. The primary binding is not counted against this limit. Eligible candidates beyond the configured limit are not silently discarded; they receive a typed `fallback_limit` exclusion with reason code `fallback_limit_exceeded`.

## Typed exclusions

The plan emits two exclusion classes:

- `hard_constraint` for candidates rejected by T400, preserving their deterministic reason codes;
- `fallback_limit` for otherwise eligible candidates outside the bounded fallback list.

Typed exclusions contain only binding IDs, binding keys, exclusion type, and reason codes. They contain no raw scope, metrics, credentials, provider payloads, or execution arguments.

## Authority boundary

The planner orders evidence only. It explicitly reports:

- `primary_selected_by_plan=false`;
- `selection_authorized=false`;
- `fallback_executed=false`;
- `dispatch_authorized=false`;
- `authority_created=false`.

The compiler remains responsible for ambiguity rejection and primary binding compilation. Runtime fallback execution is not introduced by this task.

## Scope boundaries

T402 does not implement T403 kill switches, T404 explain expansion, or T405 preference-authority negatives. It adds no migration, route, OpenAPI change, provider call, credential read, external write, runtime activation, deployment, or merge.
