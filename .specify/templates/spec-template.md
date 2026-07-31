# Feature Specification: [FEATURE NAME]

**Branch**: `[NNN-feature-name]`  
**Created**: [YYYY-MM-DD]  
**Status**: Draft  
**Delivery**: [single_pr|multi_pr]  
**Spec owner**: [owner]

## Problem and verified baseline

Describe the problem, current verified production behavior, evidence date, affected actors, and why the existing behavior is insufficient. Separate observed facts from inference and proposed behavior.

## Objective

Define the outcome in user and operational terms.

## Scope

### Included

- [scope item]

### Excluded

- [non-goal]

## Work Map integration and dimension discovery

Generate `work-map-integration.json` using:

```text
node http-generic-api/scripts/spec-kit-work-map-governance-gate.mjs --scaffold [NNN-feature-name] --owner [owner]
```

Review every generated Work Map, schema domain, cross-map dependency, and remaining taxonomy gap. Each dimension must resolve to `integrate`, `reuse`, `extend`, `not_applicable`, `deferred_with_risk`, or `blocked` with evidence and delivery references. Reuse or extend existing maps before proposing a new map. No schema object may remain unclassified unless an owned, expiring intentional exception exists in the canonical classification registry.

## Actors and authority

| Actor | Principal/auth mode | Allowed responsibilities | Forbidden overrides |
|---|---|---|---|
| [actor] | [JWT/admin/service] | [responsibilities] | [tenant/user/resource override] |

## User journeys

### US1 — [journey] (P1)

**Given** [precondition]  
**When** [action]  
**Then** [evidence-backed outcome]

## Operation paths

Reference `operation-paths.md`. Every path must define entry point, preconditions, authority, states, success readback, errors, retry/idempotency, observability, and rollback/recovery.

## Cross-cutting concerns

Reference `concerns.md`. At minimum cover security, tenant isolation, privacy, replay, idempotency, availability, performance, observability, compatibility, deployment, rollback, documentation, and all relevant Work Map dimensions.

## Functional requirements

- **FR-001**: [testable requirement]

## Non-functional requirements

- **NFR-001 Security**: [requirement]
- **NFR-002 Availability**: [requirement]
- **NFR-003 Performance**: [requirement]
- **NFR-004 Observability**: [requirement]
- **NFR-005 Compatibility**: [requirement]

## State and data requirements

Reference `data-model.md`; identify existing and proposed entities, ownership, retention, indexes, transitions, classification, existing Work Map coverage, and no-secret rules.

## Contracts

Reference `contracts/`; use OpenAPI 3.1 for HTTP surfaces and JSON Schema 2020-12 for structured evidence/state.

## Error taxonomy

| Code | HTTP/status | Stage | Retryable | User action | Readback |
|---|---:|---|---|---|---|
| [CODE] | [status] | [stage] | [yes/no] | [action] | [authority] |

## Security and privacy

Define authentication, authorization, object-level authority, resource/audience binding, replay protection, logging redaction, data minimization, cross-tenant isolation, and abuse cases.

## Observability and evidence

Define request/operation identifiers, logs, metrics, traces, lifecycle states, alerting, evidence sources, completeness, and no-secret guarantees.

## Rollout, rollback, and compatibility

Define feature flags, compatibility windows, migration/backfill, canary/dark deployment, health/readback, rollback triggers, and cleanup.

## Success criteria

- **SC-001**: [measurable outcome]

## Open questions

- **Q-001**: [unresolved ambiguity, owner, due gate]

## Delivery state

State what this specification branch does and does not authorize. Implementation may not start until `work-map-integration.json` is `ready_for_implementation` with no unresolved or accidental unclassified dimensions.
