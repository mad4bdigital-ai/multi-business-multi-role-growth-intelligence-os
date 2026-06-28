# Logical Data Model

Physical tables may reuse existing authorities where compatible. Additive migrations must avoid duplicating canonical sources.

## CanonicalCapability

Fields: canonical ID, key, version, operation class, risk profile, approval policy, input/output schema references, readback contract, and lifecycle status.

Invariant: one active canonical identity per capability key and version.

## CapabilityAlias

Maps action, tool, route, intent, skill, UI, and legacy keys to a canonical capability. Aliases never grant authority.

## RelationshipTuple

Stores subject, relation, resource, tenant/workspace/brand scope, validity window, source authority, revision, and lifecycle status.

## CapabilityGrant

Stores subject and capability references, resource constraints, bounded constraints, lifecycle status, expiry, and audit fields. Grant state is independent from approval state.

## ApprovalPolicy

Stores policy key/version, mode, approver requirements, TTL, reuse, typed confirmation, invalidation fields, risk thresholds, and lifecycle status.

## CapabilityAdapterBinding

Stores capability and adapter versions, provider family, rollout mode, precedence, bounded selection conditions, certification, connection requirements, and status.

## AuthorizationDecision

Stores request identity hashes, capability identity, relationship and policy revisions, grant and adapter results, obligations, blocking gaps, expiry, and a bounded no-secret trace.

## ExecutionEnvelope

Stores the decision reference, request hash, adapter version, approval reference, nonce, idempotency key, single-use state, expiry, and envelope hash.

## ApprovalRequest and ApprovalDecision

Approvals are append-only and bound to immutable envelope evidence. Rejection, expiry, revocation, or staleness cannot be overwritten as approval.

## CapabilityExecution and ExecutionEvidence

Execution records attempts, adapter, state, timestamps, bounded external references, and compensation state. Evidence types are `acknowledged`, `resource_observed`, `state_verified`, `effect_verified`, `compensated`, `incomplete`, and `mismatched`.

## ReconciliationCheckpoint

Tracks bounded controller cursors, observed revisions, outcomes, and retry state.

## Compatibility projections

Existing `agent_skills` and `agent_skill_grants` remain authorities during transition. Projections expose active grant count, runtime approval required count, effective readiness, and adaptive decision reference. No projection may convert `requires_approval=1` into a dormant grant state.
