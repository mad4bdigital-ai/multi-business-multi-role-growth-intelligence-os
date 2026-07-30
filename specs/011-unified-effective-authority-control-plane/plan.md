# Implementation Plan

## Strategy

Deliver UEACP through additive, reviewable PRs. Initial implementation changes no provider behavior and removes no legacy authority paths.

## Workstreams

### A. Canonical model

- glossary and decision states
- actor/subject/scope types
- readiness dimensions
- reason-code taxonomy
- code-level safety invariants

### B. Authority data

- live census of existing tables
- additive resource graph and delegation storage where gaps exist
- revisions and version vectors
- decision ledger and drift findings
- no-secret schema enforcement

### C. Resolver

- principal and scope normalization
- semantic capability integration
- resource authority
- policy/grant evaluation
- deterministic connection, endpoint, and certification resolution
- shadow manifest generation

### D. Projections

- connector readiness
- Admin diagnostics
- Dynamic Tabs
- Dashboard
- Tool Catalog
- agents and skills

### E. Enforcement

- shared PEP library
- final revalidation
- approval/delegation binding
- execution evidence and readback

### F. Operations

- invalidation events
- reconciliation
- synthetic principals
- dashboards and alerts
- rollout and rollback controls

## Technical boundaries

- `src/domain` owns semantics and invariants.
- `src/application` owns orchestration.
- `src/infrastructure` owns SQL, cache, graph, and event adapters.
- `src/api` owns validation and response mapping.
- Provider adapters remain behind application interfaces.

## Validation sequence

1. Static contract and OpenAPI checks
2. Unit and property tests
3. SQL migration dry-run and rollback review
4. Shadow parity
5. Cross-tenant integration suite
6. Admin diagnostics verification
7. Canary read-only execution
8. Production verification
9. Post-merge audit

## Required design reviews

- identity and delegation
- data model and migration
- security and threat model
- performance and graph behavior
- API compatibility
- operational readiness

## Deferred decisions

- policy-engine vendor
- graph database adoption
- final numeric SLO thresholds
- legacy route removal dates
- high-risk rollout cohorts
