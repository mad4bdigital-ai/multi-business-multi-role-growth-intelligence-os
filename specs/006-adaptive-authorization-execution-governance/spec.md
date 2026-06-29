# Feature Specification: Adaptive Authorization and Execution Governance

**Branch**: `006-adaptive-authorization-execution-governance`  
**Status**: Draft

## Problem statement

Authorization, skill availability, approval, dispatch, and operational presentation can become coupled to route names, tab keys, provider implementations, and Boolean approval flags. This produces incomplete coverage, inconsistent status reporting, duplicated enforcement, and high maintenance cost when capabilities or providers change.

The platform needs one adaptable decision model without creating a central god service that owns policy, approval, execution, and reconciliation together.

## User scenarios

### Scenario 1 — Active skill with runtime approval

Given an agent has an active grant for a capability whose selected operation requires approval, when readiness is resolved, then the capability is available and the operation is `ready_requires_approval`; the grant is not pending or blocked.

### Scenario 2 — Provider-independent execution

Given a canonical capability has multiple provider adapters, when one adapter becomes unavailable, then the resolver selects an eligible certified fallback according to policy without changing the public capability contract.

### Scenario 3 — Relationship and context authorization

Given a user supervises an agent within one workspace and the target resource belongs to another workspace, when authorization is requested, then relationship authority and contextual policy are evaluated together and cross-workspace execution is denied unless an explicit relationship or grant permits it.

### Scenario 4 — Approval cannot be replayed

Given a high-impact request was approved, when the subject, resource, payload, adapter, policy version, operation, or authority revision changes, then the approval and execution envelope become stale.

### Scenario 5 — Continuous reconciliation

Given a grant, connection, certification, policy, or external resource changes after a decision, when a reconciler observes the change, then affected readiness and envelopes are invalidated or refreshed and the platform records evidence without silently claiming recovery.

## Goals

- Provider-independent canonical capability identity.
- Hybrid relationship, contextual attribute, and explicit grant authorization.
- Explicit separation of policy decision, enforcement, execution, and reconciliation.
- Scoped, expiring, request-bound approvals.
- Registry-driven adapters with shadow, canary, active, fallback, and disabled modes.
- Revision-bound execution envelopes, idempotency, readback, and evidence.
- Backward-compatible migration through aliases and wrappers.

## Non-goals

- Replacing all existing routes in one release.
- Creating an unrestricted policy programming language.
- Enabling provider writes during specification or shadow phases.
- Treating discovery, UI exposure, or adapter registration as execution authority.
- Returning credentials, tokens, unrestricted payloads, or raw policy internals.

## Functional requirements

- **FR-001**: Every governed operation MUST resolve to exactly one immutable `canonical_capability_id` and version before authorization.
- **FR-002**: Route, action, tool, intent, UI, skill, and provider keys MUST be aliases or bindings, not independent authorization identities.
- **FR-003**: Authorization MUST evaluate authenticated subject, action, resource, and context.
- **FR-004**: Relationship authority, contextual attributes, and explicit grants MUST be distinct decision inputs.
- **FR-005**: Missing, conflicting, stale, unsupported, or ambiguous required input MUST fail closed.
- **FR-006**: Availability, binding, grant, authorization, approval, execution, and verification states MUST be represented independently.
- **FR-007**: `grant_state=active` MUST remain active when runtime approval is required.
- **FR-008**: Approval policy MUST be versioned and support `not_required`, `per_request`, `per_session`, `per_resource`, and `bounded_automatic` modes.
- **FR-009**: High-impact approval MUST bind subject, action, resource identity, normalized request hash, policy version, relationship revision, adapter version, expiry, nonce, and idempotency key.
- **FR-010**: A mutating execution envelope MUST be short-lived, no-secret, replay-resistant, and single-use unless policy explicitly permits bounded idempotent reuse.
- **FR-011**: Policy decision points MUST NOT call providers or mutate target resources.
- **FR-012**: Every route, worker, connector, and adapter capable of execution MUST act as a policy enforcement point or invoke a shared enforcement kernel immediately before execution.
- **FR-013**: Adapter selection MUST be registry-driven and deterministic.
- **FR-014**: Equal highest-ranked eligible adapters MUST produce `blocked_ambiguous_binding`.
- **FR-015**: Mutating execution MUST require idempotency, audit evidence, and a capability-specific readback contract.
- **FR-016**: Readback MUST distinguish acknowledgement, resource observation, state verification, effect verification, compensation, incomplete evidence, and mismatch.
- **FR-017**: Narrow reconcilers MUST detect relationship, grant, policy, connection, certification, adapter, approval, and readback drift.
- **FR-018**: Existing routes MUST remain compatibility aliases until measured migration and deprecation gates pass.
- **FR-019**: Dynamic tabs and dashboards MUST consume registered resource projections; display identifiers MUST NOT create authority.
- **FR-020**: Initial implementation MUST run in shadow mode and compare legacy and adaptive decisions before enforcement cutover.
- **FR-021**: The pilot MUST cover one read capability, one internal write capability, and one external high-impact capability.
- **FR-022**: Public contracts MUST use OpenAPI 3.1, strict input schemas, cursor pagination for mutable collections, and stable structured errors.
- **FR-023**: Tenant and workspace identity MUST be resolved from authenticated authority rather than caller overrides.
- **FR-024**: Decisions and evidence MUST exclude credentials, tokens, prompts, and unrestricted payloads.
- **FR-025**: Policy, relationship, capability, resource, and adapter revisions used by a decision MUST remain traceable.

## Pilot capabilities

| Capability | Class | Initial mode | Approval | Readback |
|---|---|---|---|---|
| `activation.skills.read` | read | shadow | not required | response contract verified |
| `platform.output-artifact.write` | internal write | shadow then canary | policy-dependent | row and hash readback |
| `content.wordpress.publish` | external high impact | shadow only initially | per execution | provider resource state verified |

## State model

```text
availability: active | unavailable | deprecated
binding: resolved | ambiguous | missing | stale
grant: active | revoked | expired | suspended | not_required
authorization: allowed | denied | conditional | not_evaluated
approval: not_required | required | approved | rejected | expired | stale
execution: not_started | queued | running | succeeded | failed | compensated
verification: not_applicable | acknowledged | observed | verified | incomplete | mismatched
```

## Success criteria

- **SC-001**: Active approval-gated grants are counted as active and separately counted as runtime-approval-required.
- **SC-002**: The three pilots produce deterministic shadow decisions with no provider mutation.
- **SC-003**: Legacy/adaptive parity reaches an approved threshold and every mismatch is classified.
- **SC-004**: Cross-tenant, replay, stale-policy, stale-relationship, and ambiguous-adapter tests fail closed.
- **SC-005**: Every mutating pilot has idempotency and readback evidence.
- **SC-006**: OpenAPI, resource descriptors, tests, canonicals, and runtime registries remain synchronized.
