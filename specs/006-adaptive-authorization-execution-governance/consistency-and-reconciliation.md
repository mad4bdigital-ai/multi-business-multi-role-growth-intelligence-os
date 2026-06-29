# Consistency and Reconciliation Model

## Purpose

Define how authority freshness, execution state, external effects, and operational projections remain correct when data changes asynchronously.

## Consistency classes

### Class A — hard authority

Includes authenticated tenant scope, resource ownership, active grants, hard-deny policy, approval validity, adapter certification, and credential-binding scope.

State-changing execution requires same-cycle validation of Class A authority.

### Class B — bounded contextual authority

Includes risk scores, connection validation age, service mode, feature flags, quotas, and operational readiness.

Policy defines maximum acceptable age and whether stale data blocks or adds an obligation.

### Class C — presentation projections

Includes dashboard counts, readiness summaries, dynamic tabs, and cached explanations.

Class C is never execution authority. Stale projections are marked and refreshed asynchronously.

## Revision vector

Each decision and envelope records execution-relevant revisions:

```json
{
  "capabilityVersion": 3,
  "aliasRegistryRevision": "alias-210",
  "relationshipRevision": "rel-1902",
  "grantRevision": "grant-482",
  "policyBundleVersion": "pb-81",
  "adapterRegistryRevision": "adapter-33",
  "adapterVersion": "wordpress-rest@5.2.0",
  "connectionRevision": "conn-119",
  "resourceRevision": "etag-992",
  "requestHash": "sha256"
}
```

The vector need not come from one global counter. It may combine authority-specific revisions if each component is immutable and comparable.

## Freshness rules

- Read-only low-risk decisions may use cached authority only when policy explicitly allows it and revision evidence is available.
- External mutation, spend change, credential promotion, publication, deployment, and destructive operations require fresh Class A authority.
- A missing revision is stale for state-changing execution.
- A revision mismatch invalidates the decision and envelope. The system must re-evaluate rather than patch the old decision.
- Clock time alone is insufficient freshness evidence.

## Invalidation sources

Decisions, approvals, envelopes, and projections may be invalidated by:

- capability version or status changes;
- alias mapping changes;
- relationship tuple changes;
- grant suspension, revocation, or expiry;
- policy bundle publication;
- approval policy change;
- adapter certification, version, priority, or rollout changes;
- connection or credential-binding changes;
- resource revision changes;
- request normalization changes;
- tenant or workspace lifecycle changes.

## Event and outbox model

Authority mutations should write the source change and an outbox event in one transaction.

Example events:

```text
relationship.changed
grant.changed
policy.published
approval.decided
approval.expired
adapter.certification.changed
connection.readiness.changed
execution.dispatched
execution.provider_acknowledged
execution.readback.completed
resource.drift.detected
```

Consumers MUST be idempotent. Events accelerate invalidation but are not the sole correctness mechanism.

## Reconciliation controllers

### RelationshipReconciler

Finds active decisions and envelopes whose relationship revision is no longer current.

### GrantLifecycleReconciler

Expires grants, propagates revocation, and marks dependent envelopes stale.

### PolicyRevisionReconciler

Detects decisions created against retired or incompatible policy versions.

### ApprovalExpiryReconciler

Expires approvals and dependent envelopes without rewriting the original approval decision.

### AdapterCertificationReconciler

Blocks dispatch through uncertified, disabled, drifted, or superseded adapters.

### ConnectionReadinessReconciler

Updates readiness after connection validation, credential-binding lifecycle, or provider-auth failures.

### ExecutionReadbackReconciler

Retries bounded readback, classifies incomplete or mismatched effects, and requests compensation or manual intervention.

### ProjectionReconciler

Rebuilds operational counts and readiness summaries from source authority.

## Controller contract

Every controller MUST be:

- tenant-scoped;
- idempotent;
- cursor or checkpoint based;
- bounded by batch size and execution time;
- retryable with exponential backoff and jitter;
- protected against duplicate concurrent ownership;
- observable by processed, changed, failed, and lag counts;
- auditable without credential or unrestricted payload output.

## Checkpoint model

A checkpoint records:

```json
{
  "controllerKey": "grant-lifecycle",
  "scopeKey": "tenant-or-shard",
  "cursor": "opaque-cursor",
  "lastObservedRevision": "grant-482",
  "lastSuccessAt": "ISO-8601",
  "lastErrorCode": null,
  "retryCount": 0,
  "leaseOwner": "worker-id",
  "leaseExpiresAt": "ISO-8601"
}
```

## Drift classes

```text
no_drift
projection_drift
stale_decision
stale_envelope
provider_state_drift
unverified_effect
readback_mismatch
compensation_required
manual_intervention_required
```

A drift class never silently becomes `recovered`. Recovery requires same-cycle readback evidence.

## Execution readback levels

1. `acknowledged` — provider accepted the request.
2. `resource_observed` — target resource can be read.
3. `state_verified` — requested fields or state match.
4. `effect_verified` — intended business-visible effect is confirmed.
5. `compensated` — partial or undesired effect was reversed.
6. `incomplete` — evidence is insufficient.
7. `mismatched` — observed state conflicts with expected state.

Capability policy defines the minimum level required for operational success.

## Provider timeout after possible mutation

The system MUST NOT immediately retry blindly.

Required sequence:

1. mark execution outcome uncertain;
2. run capability-specific readback;
3. if desired state exists, record verified success;
4. if no effect exists and retry is safe, retry with the same idempotency identity;
5. if partial effect exists, compensate or request manual intervention;
6. append new evidence without rewriting the original attempt.

## Projection correctness

Readiness projections contain source revisions and `observedAt`.

Example:

```json
{
  "activeGrantCount": 89,
  "approvalGatedActiveCount": 10,
  "immediatelyExecutableCount": 79,
  "sourceRevision": "grant-482/pb-81/rel-1902",
  "observedAt": "ISO-8601",
  "stale": false
}
```

A projection may lag, but it cannot authorize execution.

## Recovery evidence

A reconciler may report `recovered` only when:

- the original drift is identified;
- the corrective action is recorded;
- fresh source authority is read;
- required provider or resource readback passes;
- the recovery evidence references the corrected revision;
- no blocking gaps remain.

## Failure isolation

A controller failure for one tenant, adapter, or resource MUST NOT stop unrelated scopes. Poison items are isolated after bounded retries and surfaced for operator action.
