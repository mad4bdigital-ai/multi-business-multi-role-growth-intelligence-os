# Requirements Checklist: Tenant GPT Activation Lifecycle

**Status**: Ready for clarification review  
**Spec**: `specs/012-tenant-activation-lifecycle/spec.md`

## Problem, scope, and authority

- [x] The brownfield problem and verified operational lesson are stated.
- [x] Objective is user-visible and evidence-driven.
- [x] Included and excluded scope are explicit.
- [x] Specification is explicitly non-runtime and creates no mutation authority.
- [x] SQL/registry and canonical source authority are preserved.
- [x] Actors, principal modes, responsibilities, and forbidden overrides are documented.

## User journeys

- [x] First successful activation is covered.
- [x] Returning user/session reuse is covered.
- [x] Expired/revoked authorization is covered.
- [x] Incomplete membership/workspace/connection/bootstrap is covered.
- [x] Transient dependency failure and unknown outcome are covered.
- [x] Operator diagnosis/recovery is covered.
- [x] Deployment transition/stale runtime is covered.

## Functional requirements

- [x] OAuth client/callback/resource/code/token requirements are testable.
- [x] Gateway/principal/tenant isolation requirements are testable.
- [x] Session and Managed/Dedicated/mixed activation requirements are testable.
- [x] Provider-bootstrap and classification requirements are testable.
- [x] Tool discovery/dispatch readiness requirements are testable.
- [x] Operation/evidence/retry/delivery/ack requirements are testable.
- [x] Deployment/operational/rollback/closeout requirements are testable.
- [x] Reconnect guidance is explicitly stage-specific.

## Non-functional requirements

- [x] Security and no-secret behavior are explicit.
- [x] Availability and partial-degradation behavior are explicit.
- [x] Summary-first bounded response behavior is explicit.
- [x] Observability/audit requirements are explicit.
- [x] Compatibility and maintainability requirements are explicit.
- [ ] Production SLO thresholds are numerically approved. Blocked by Q-004.

## Operation paths

- [x] OP-001..OP-018 define actors, entry points, preconditions, authority, normal sequence, failures, retry/idempotency, evidence/readback, and recovery.
- [x] OAuth authorize/code/token paths are complete.
- [x] First protected request and OAuth-to-gateway gap are complete.
- [x] Session/bootstrap/mode/provider/tool paths are complete.
- [x] Dispatch, delivery, acknowledgement, retry, unknown outcome, and reconciliation are complete.
- [x] Membership remediation, deployment diagnosis, operator recovery, and rollback are complete.

## Errors and status

- [x] Stable error taxonomy separates auth, authorization, tenant, dependency, contract, deployment, and unknown outcome.
- [x] Retryability and next action are defined.
- [x] Validation, execution, evidence, delivery, acknowledgement, and rollback states remain distinct.
- [x] Success requires authoritative readback.

## Contracts and data

- [x] Draft OpenAPI is 3.1.
- [x] Draft JSON Schema is 2020-12.
- [x] Public operations include operation IDs, security, inputs, success, and error responses.
- [x] Logical data model, states, transitions, indexes, concurrency, retention, and migration questions are documented.
- [x] Logical ownership is finalized by ADR-001: one general operation identity with an Activation-specific projection.
- [ ] Existing versus additive physical SQL table mapping is finalized. Pending T001-T003/T014.
- [x] Tenant Resolution resource and scope architecture is finalized by ADR-004: one Activation resource, five stable coarse scopes, and dynamic versioned operation policies.
- [ ] Every existing Resolution route/action is inventoried and mapped to the accepted dynamic policy model before canonical contract enforcement.

## Plan and tasks

- [x] Constitution check is recorded.
- [x] Workstreams and dependency order are defined.
- [x] Additive migration, rollout, rollback, observability, tests, and closeout plans are defined.
- [x] Tasks use stable IDs and trace requirements/paths.
- [x] Multi-PR delivery sequence is defined.

## Requirement review outcome

The specification is complete enough to enter Clarify. Implementation remains blocked until Q-001, Q-002, Q-003, and all security/data contract gates are resolved. Q-004 and Q-005 must be resolved before observability and public contract finalization respectively.
