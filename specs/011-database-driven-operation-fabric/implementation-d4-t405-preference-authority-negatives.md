# D4 T405 Implementation — Preference Authority Negative Tests

## Purpose

Implement Spec 011 task T405 with integration-level negative tests proving that preference scoring can rank candidates that already passed hard constraints, but cannot create operation-binding authority.

## Proved boundaries

The test suite runs the complete compiler stack introduced by T400–T404 and proves that a maximum preference score cannot override:

- missing resource authority;
- dispatch denial;
- endpoint export unreadiness;
- credential unreadiness;
- required approval without approval readiness;
- required readback without readback readiness;
- explicit policy denial;
- adapter kill switches.

In every negative case, the lower-preference candidate that satisfies the hard constraints is selected, while the preferred candidate remains excluded with its original typed reason codes. Excluded preferred candidates do not enter the bounded fallback list or receive a selected/fallback explain disposition.

## Permitted preference influence

A preference-only weight policy is also tested with two fully eligible candidates. The higher-preference candidate receives the higher score and may become selected. The test then proves that every selected, fallback, overflow, candidate-evidence, and resolver-explain binding ID is a member of the original candidate set.

Preference influence therefore remains bounded to score and rank among already-authorized candidates. It cannot discover or synthesize a candidate, remove an exclusion, authorize selection, authorize dispatch, execute fallback, create authority, call a provider, read credential payloads, perform an external write, or change runtime activation.

## Scope boundaries

T405 adds tests and documentation only. It changes no production module, scoring formula, default weight, eligibility rule, fallback behavior, kill-switch policy, resolver explanation contract, migration, route, OpenAPI document, database state, provider state, deployment, merge state, or runtime activation.
