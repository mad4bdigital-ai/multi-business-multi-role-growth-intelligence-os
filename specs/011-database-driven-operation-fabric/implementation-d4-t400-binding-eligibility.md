# D4 T400 Implementation — Binding Eligibility and Hard Constraints

## Purpose

Implement Spec 011 task T400 by extracting operation-binding eligibility and hard constraints from the monolithic compiler into a focused application module. The existing compiler delegates to the new module while preserving its manifest, scoring, ranking, selection, ambiguity, and fallback behavior.

## Eligibility authority

`operationBindingEligibility.js` evaluates only normalized compiled binding candidates. It does not discover candidates, query a provider, read credentials, score preferences, select an adapter, or authorize dispatch.

The hard constraints cover policy denial, lifecycle status, validity, exact scope, provider context, capability, effect class, dispatch permission, endpoint export readiness, capability availability, resource authority, credential readiness, adapter health, capacity, effect permission, approval readiness, and readback readiness. Reason codes are deterministic, deduplicated, and lexically sorted.

## Bounded report

`filterOperationBindingEligibility` returns eligible and excluded binding IDs, safe candidate evidence, counts, a scope fingerprint, and a deterministic report hash. It never returns raw scope references or candidate metrics. It explicitly reports `candidate_selected=false`, `selection_authorized=false`, `scoring_performed=false`, `fallback_performed=false`, and `preferences_applied=false`.

An empty eligible set remains a valid filter result. The existing compiler remains responsible for failing closed when no candidate is eligible.

## Compiler compatibility

`operationBindingCompiler.js` retains candidate normalization, scoring, ranking, ambiguity rejection, selection, fallback ordering, and manifest hashing. It now obtains exclusion reasons from the extracted hard-constraint report. Existing compiler tests remain unchanged and protect manifest compatibility.

## Scope boundaries

T400 does not implement T401 scoring, T402 fallback behavior, T403 kill switches, T404 explain output, or T405 preference-authority negatives beyond proving metrics do not affect eligibility. It adds no migration, route, OpenAPI change, provider call, credential read, external write, runtime activation, deployment, or merge.
