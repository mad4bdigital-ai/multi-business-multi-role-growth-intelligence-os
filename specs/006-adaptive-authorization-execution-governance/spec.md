# Feature Specification: Adaptive Authorization and Execution Governance

**Branch**: `006-adaptive-authorization-execution-governance`  
**Status**: Draft

## Problem statement

Authorization, skill availability, approval, dispatch, and operational presentation risk becoming coupled to route names, tab keys, provider implementations, and Boolean approval flags. This produces incomplete coverage, inconsistent status reporting, duplicated enforcement, and high maintenance cost when capabilities or providers change.

The platform needs one adaptable decision model without creating one central service that owns every concern.

## User scenarios

### Scenario 1 — Active skill with runtime approval

Given an agent has an active grant for a capability whose selected operation requires approval, when readiness is resolved, then the capability is reported as available and the operation is reported as `ready_requires_approval`; the grant is not reported as pending or blocked.

### Scenario 2 — Provider-independent execution

Given a canonical capability has multiple provider adapters, when one adapter becomes unavailable, then the resolver selects an eligible certified fallback according to policy without changing the public capability contract.

### Scenario 3 — Relationship and context authorization

Given a user supervises an agent within one workspace and the target resource belongs to another workspace, when authorization is requested, then relationship authority and contextual policy are evaluated together and cross-workspace execution is denied unless an explicit relationship or grant permits it.

### Scenario 4 — Approval cannot be replayed

Given a high-impact request was approved, when the subject, resource, payload, adapter, policy version, or operation changes, then the prior approval and execution envelope become stale and cannot authorize the modified request.

### Scenario 5 — Continuous reconciliation

Given a grant, connection, certification, policy, or external resource changes after a decision, when a reconciler observes the change, then affected readiness and envelopes are invalidated or refreshed and the platform records evidence without silently claiming recovery.

## Goals

- Provide a provider-independent canonical capability identity.
- Combine relationship authority, contextual policy, and explicit grants.
- Separate policy decisions from enforcement and execution.
- Represent approvals as scoped, expiring, auditable decisions.
- Support shadow, canary, active, fallback, and disabled adapters.
- Bind execution envelopes to immutable request evidence.
- Provide same-cycle readback and continuous reconciliation.
- Preserve backward compatibility through aliases and wrappers.
- Eliminate hardcoded presentation keys as security or routing authority.

## Non-goals

- Replacing every existing route in one release.
- Introducing a general-purpose arbitrary policy programming language.
- Enabling provider writes during the specification or shadow phases.
- Treating capability discovery, tool exposure, or adapter registration as execution authority.
- Storing or returning secret values in decision, approval, or evidence records.

## Functional requirements

- **FR-001**: Every governed operation MUST resolve to exactly one immutable `canonical_capability_id` and version before authorization.
- **FR-002**: Route, action, tool, intent, UI, skill, and provider keys MUST be aliases or bindings, not independent authorization identities.
- **FR-003**: Authorization MUST evaluate authenticated subject, action, resource, and context.
- **FR-004**: Relationship authority, contextual attributes, and explicit grants MUST be distinct inputs to the decision.
- **FR-005**: A missing, conflicting, stale, or ambiguous required input MUST fail closed.
- **FR-006**: Capability availability, grant state, authorization state, approval state, execution state, and verification state MUST be represented independently.
- **FR-007**: `grant_state=active` MUST remain active when runtime approval is required.
- **FR-008**: Approval policy MUST be versioned and MUST support per-request, per-session, per-resource, and bounded automatic modes.
- **FR-009**: High-impact approvals MUST bind subject, action, resource identity, normalized request hash, policy version, relationship revision, adapter version, expiry, nonce, and idempotency key.
- **FR-010**: An execution envelope MUST be short-lived, no-secret, replay-resistant, and single-use for state-changing execution unless policy explicitly permits idempotent reuse.
- **FR-011**: Policy decision points MUST NOT call providers or mutate target resources.
- **FR-012**: Every route, worker, connector, and adapter capable of execution MUST act as a policy enforcement point or call a shared enforcement kernel immediately before execution.
- **FR-013**: Adapter selection MUST be registry-driven and support `shadow`, `canary`, `active`, `fallback`, and `disabled` rollout modes.
- **FR-014**: Equal highest-ranked adapters MUST produce `blocked_ambiguous_binding` rather than nondeterministic selection.
- **FR-015**: Mutating execution MUST require idempotency, audit evidence, and a capability-specific readback contract.
- **FR-016**: Readback MUST distinguish acknowledgement, resource observation, state verification, effect verification, compensation, and incomplete evidence.
- **FR-017**: Reconcilers MUST detect grant, relationship, policy, connection, certification, adapter, approval, and readback drift.
- **FR-018**: Existing routes MUST remain available as compatibility aliases until measured migration and deprecation gates pass.
- **FR-019**: Dynamic tabs and dashboards MUST consume registered resource projections; display identifiers MUST NOT create authority.
- **FR-020**: The initial implementation MUST run in shadow mode and compare legacy and adaptive decisions before any production enforcement cutover.
- **FR-021**: The pilot MUST cover one read capability, one internal write capability, and one external high-impact capability.
- **FR-022**: Public contracts MUST use OpenAPI 3.1, strict input schemas, cursor pagination for mutable collections, and stable structured errors.
- **FR-023**: Tenant and workspace identity MUST be resolved from authenticated authority rather than trusted caller overrides.
- **FR-024**: Decisions and evidence MUST exclude credentials, tokens, prompts, and unrestricted payloads.
- **FR-025**: Policy and relationship revisions used by a decision MUST remain traceable.

## Pilot capabilities

| Capability | Class | Initial mode | Approval | Readback |
|---|---|---|---|---|
| `activation.skills.read` | read | shadow | not required | response contract verified |
| `platform.output-artifact.write` | internal write | shadow then canary | policy-dependent | SQL row and hash readback |
| `content.wordpress.publish` | external high impact | shadow only initially | per execution | provider resource state verified |

## State model

```text
availability: active | unavailable | deprecated
binding: resolved | ambiguous | missing | stale
grant: active | revoked | expired | suspended
authorization: allowed | denied | conditional | not_evaluated
approval: not_required | required | approved | rejected | expired | stale
execution: not_started | queued | running | succeeded | failed | compensated
verification: not_applicable | acknowledged | observed | verified | incomplete | mismatched
```

## Success criteria

- **SC-001**: Active grants requiring runtime approval are counted as active and separately counted as approval-gated.
- **SC-002**: The three pilot capabilities produce deterministic shadow decisions with no provider mutation.
- **SC-003**: Legacy and adaptive decision parity reaches an approved threshold with every mismatch classified.
- **SC-004**: Cross-tenant, replay, stale-policy, stale-relationship, and ambiguous-adapter tests fail closed.
- **SC-005**: Every mutating pilot has idempotency and readback evidence.
- **SC-006**: OpenAPI, resource descriptors, tests, canonicals, and runtime registries remain synchronized.
