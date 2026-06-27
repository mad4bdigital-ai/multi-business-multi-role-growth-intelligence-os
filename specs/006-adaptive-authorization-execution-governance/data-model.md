# Logical Data Model

This document defines logical resources. Physical tables may reuse existing authorities where compatible. Additive migrations must avoid duplicating canonical sources.

## CanonicalCapability

- `canonical_capability_id`
- `capability_key`
- `version`
- `operation_class`
- `risk_profile_key`
- `approval_policy_key`
- `input_schema_ref`
- `output_schema_ref`
- `readback_contract_key`
- `status`

Invariant: one active canonical identity per capability key and version.

## CapabilityAlias

Maps action, tool, route, intent, skill, UI, and legacy keys to a canonical capability. Aliases never grant authority.

## RelationshipTuple

- `subject_type`, `subject_id`
- `relation`
- `resource_type`, `resource_id`
- tenant, workspace, and brand scope
- `valid_from`, `valid_until`
- `source_authority`
- `revision`
- `status`

## CapabilityGrant

- `grant_id`
- subject reference
- capability reference
- tenant, workspace, brand, and resource constraints
- `constraints_json`
- `status`
- `expires_at`
- audit fields

Grant state is independent from approval state.

## ApprovalPolicy

- `policy_key`, `version`
- mode: `not_required`, `per_request`, `per_session`, `per_resource`, `bounded_automatic`
- required roles and counts
- TTL and reuse policy
- typed confirmation policy
- invalidation fields
- risk thresholds
- status

## CapabilityAdapterBinding

- `binding_id`
- capability and adapter versions
- provider family
- rollout mode
- precedence
- bounded selection conditions
- certification requirement
- connection and credential requirements
- status

## AuthorizationDecision

- `decision_id`
- subject, action, resource, and context hashes
- capability identity
- relationship revision
- policy version
- grant result
- adapter candidate result
- decision and obligations
- blocking gaps
- expiry
- no-secret trace

## ExecutionEnvelope

- `envelope_id`
- authorization decision reference
- normalized request hash
- selected adapter and version
- approval state and decision reference
- nonce
- idempotency key
- single-use state
- expiry
- envelope hash

## ApprovalRequest and ApprovalDecision

Approvals are append-only decisions bound to an envelope and immutable request evidence. Rejection, expiry, revocation, or staleness cannot be overwritten as approval.

## CapabilityExecution

- `execution_id`
- envelope reference
- attempt number
- adapter reference
- state
- timestamps
- external reference hashes only
- compensation state

## ExecutionEvidence

Evidence types: `acknowledged`, `resource_observed`, `state_verified`, `effect_verified`, `compensated`, `incomplete`, and `mismatched`.

## ReconciliationCheckpoint

Tracks bounded controller cursors, observed revisions, outcomes, and retry state for grants, relationships, policies, connections, certifications, approvals, executions, and readbacks.

## Compatibility projections

Existing `agent_skills` and `agent_skill_grants` remain authorities during transition. Projections expose active grant count, runtime approval required count, effective readiness, and adaptive decision reference. No projection may convert `requires_approval=1` into a dormant grant state.
