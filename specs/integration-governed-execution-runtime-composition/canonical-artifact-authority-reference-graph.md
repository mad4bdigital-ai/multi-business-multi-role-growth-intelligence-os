# Canonical Runtime Artifact Authority and Reference Graph

## Status

This document extends the cross-Spec runtime composition kit. It defines ownership and reference boundaries between immutable and durable execution artifacts. It creates no runtime authority and performs no mutation.

```json
{
  "artifact_type": "runtime_artifact_reference_contract",
  "runtime_authority": false,
  "functional_authority": false,
  "specification_only": true,
  "secrets_included": false
}
```

## 1. Problem

The platform already has or proposes multiple correct artifacts: installation revisions, context hashes, Execution Capsules, governance decisions, compiled plans/policies, approvals, capability envelopes, receipts, readbacks, evidence, model-selection decisions, commercial decisions, and Effective Runtime Manifests.

The architectural risk is not absence of evidence; it is **evidence duplication**. If every artifact embeds its own copy of tenant, resource, provider, policy, model, approval, and revision state, immutable documents can still disagree with each other after authority changes.

The platform therefore adopts a reference-first artifact graph:

> Each artifact owns only its semantic decision and references other authoritative artifacts by immutable identity/hash/revision. An artifact does not become authoritative for data owned by another artifact merely because it contains a safe projection of that data.

## 2. Canonical artifact chain

```text
Package / Installation Revision
            |
            v
Execution Capsule                       Model Selection Decision
            |                                      |
            +-------------------+------------------+
                                |
                                v
                      Governance Decision
                                |
                                v
                        Compiled Plan Snapshot
                                |
                                v
                           Approval Grant
                                |
                                v
                      Capability Envelope
                                |
                                v
                         Pending Receipt
                                |
                                v
                         Provider Dispatch
                                |
                                v
                            Readback
                                |
                                v
                         Final Receipt
                                |
                                v
                    Evidence + Transactional Outbox
                                |
                                v
                  Search / Drive / Analytics / MCP / UI projections
```

The Effective Runtime Manifest composes immutable **references** to the applicable decision artifacts; it does not replace them.

## 3. Artifact ownership matrix

| Artifact | Canonical question answered | Owner family | Grants execution authority? |
|---|---|---|---|
| Package Version | what reusable product definition exists? | Spec 015 | no |
| Installation Revision | what exact package/configuration is installed for this scope? | Spec 015 | no |
| Execution Capsule | who/where/which exact resource and connection context? | Spec 012 | no |
| Governance Decision | what policy/grant/effect/readback constraints apply? | Spec 011 | no effect by itself |
| Compiled Policy Snapshot | which versioned policy inputs/outputs contributed? | policy authority / Spec 011 integration | no |
| Compiled Plan Snapshot | what exact operation graph will run? | Spec 011 | no effect by itself |
| Model Selection Decision | which exact eligible model candidate/fallback set is approved for reasoning? | model-governance authority | no provider call by itself |
| Commercial Decision / Reservation | what cost/quota capacity is reserved? | commercial authority | no provider effect by itself |
| Approval Grant | who approved which exact bounded frontier? | approval authority | no direct dispatch |
| Capability Envelope | is this exact operation permitted at the current mutation frontier for a short lifetime? | Spec 011 execution authority | yes, bounded execution permit when all gates pass |
| Pending Receipt | what mutation may already be in flight and must not be blindly replayed? | Spec 011 execution ledger | records possible effect, no new permission |
| Readback | what external/internal state was actually observed after dispatch? | Spec 011/provider readback authority | no |
| Final Receipt | what confirmed/failed/unknown outcome is canonical for this operation? | Spec 011 execution ledger | terminal/continuation evidence |
| Evidence Event | what happened and which decisions/versions prove it? | evidence authority | no |
| Projection | how is canonical state represented to a client/index/report? | destination-specific | no |
| Effective Runtime Manifest | which immutable decisions compose this execution candidate? | cross-plane composition evidence | no independent authority |

## 4. Reference-not-copy rule

An artifact MAY carry bounded denormalized fields for explainability or verification, but MUST reference the owner artifact for authority.

Example:

```json
{
  "plan_id": "plan_...",
  "plan_hash": "sha256:...",
  "execution_capsule_ref": "capsule_...",
  "execution_capsule_hash": "sha256:...",
  "policy_snapshot_ref": "policy_snapshot_...",
  "model_selection_ref": "model_decision_..."
}
```

A copied `tenant_id`, `brand_id`, risk label, or provider name inside a later artifact is explanatory evidence and cannot override the referenced owner decision.

## 5. Effective Runtime Manifest contract

The Effective Runtime Manifest SHOULD be a compact immutable composition record, not a giant duplicated document.

Illustrative logical shape:

```json
{
  "manifest_id": "erm_...",
  "installation_revision_ref": "installrev_...",
  "execution_capsule_ref": "capsule_...",
  "governance_decision_ref": "gov_...",
  "plan_snapshot_ref": "plan_...",
  "model_selection_ref": "model_...",
  "commercial_decision_ref": "cost_...",
  "knowledge_snapshot_ref": "knowledge_...",
  "revision_vector": {},
  "governance_epochs": {},
  "expires_at": "...",
  "manifest_hash": "sha256:...",
  "secrets_included": false
}
```

The manifest MUST NOT:

- carry credentials or tokens;
- silently widen any referenced authority;
- replace fresh mutation-frontier validation;
- duplicate complete policy/resource/provider records when immutable references suffice;
- become a generic session permission token.

## 6. Static, semi-dynamic, and dynamic evidence

### Revision-bound static evidence

Eligible for exact-revision reuse:

```text
package definition/version
activity pack definition/version
skill definition/version
workflow definition/version
capability/operation schema
policy structure/compiler version
model capability profile
component schemas
```

### Semi-dynamic evidence

Reusable only under explicit revision/freshness constraints:

```text
installation revision
resolved configuration
knowledge snapshot
resource revision
provider certification
model evaluation scorecard
context candidate set
```

### Dynamic mutation-frontier evidence

MUST be refreshed immediately before a state-changing effect when declared relevant:

```text
principal active/revoked state
delegation/grant state
approval validity
resource version / expected SHA
connection and authorization revision
credential readiness without credential disclosure
provider readiness/incident state
budget reservation/quota
policy or model-governance epoch
capability envelope state/expiry/consumption
idempotency receipt state
resource lock/fencing token
environment and rollout eligibility
```

## 7. Revision vectors and epochs

TTL alone is never sufficient authority freshness.

Artifacts SHOULD bind exact revisions/epochs such as:

```text
principal_authority_epoch
tenant/workspace/brand revision
resource revision
connection revision
authorization revision
capability registry revision
policy epoch
model governance epoch
commercial entitlement epoch
package/installation revision
knowledge snapshot revision
```

A material change advances the applicable revision/epoch and invalidates dependent artifacts according to the invalidation graph.

## 8. Invalidation graph

Minimum rules:

```text
principal change -> context, grants, plans, approvals, envelopes
Tenant change -> all descendant scope artifacts
Workspace change -> Brand/resource/connection/context/plan/approval/envelope
resource revision -> exact plan/frontier approval/envelope where write-sensitive
connection/authorization revision -> provider readiness/envelope
capability/policy epoch -> governance decision/plan/envelope
plan hash change -> approval/envelope/idempotency binding
model-governance epoch -> model decision and dependent manifest
commercial reservation expiry -> mutation frontier block
knowledge snapshot change -> content/reasoning plans when knowledge-pinned
```

Emergency revocation MUST override an otherwise valid pinned artifact.

## 9. Mutation frontier

No unsafe external mutation may rely solely on an old compiled decision.

Immediately before mutation the runtime revalidates the declared volatile facts and verifies:

```text
exact operation
exact principal/effective subject
exact Tenant/Workspace/Brand
exact resource
exact connection/provider binding
current capability/policy/grant state
approval binding when required
budget/quota reservation
resource revision or expected SHA
idempotency status
lock/fencing token
readback contract
rollout/environment eligibility
no secret leakage
```

Only after this frontier may a bounded capability envelope permit dispatch.

## 10. Pending receipt before unsafe dispatch

For an operation that may mutate external state, the runtime MUST reserve canonical operation identity/idempotency and persist a pending receipt or equivalent durable marker before the unsafe dispatch boundary.

Required logical fields include:

```text
operation_id
plan_id / step_id
idempotency_key
resource_ref
provider_binding_ref
requested_effect
possible_mutation=true
dispatch_attempt
state=dispatching
created_at
```

This prevents a process/transport failure from causing blind duplicate mutation.

## 11. Outcome taxonomy

Canonical operation outcome states SHOULD distinguish at least:

```text
confirmed
pending
blocked
rejected
failed_known
unknown
partial_success
diverged
compensated
cancelled
```

`unknown` means mutation may have occurred and retry is prohibited until reconciliation determines safe next action.

## 12. Readback

Transport success is not business-effect confirmation.

Readback MUST validate the state required by the operation contract, for example:

```text
resource exists
expected revision/hash present
expected status applied
expected remote identifier bound
no unexpected target substitution
```

Same-cycle readback remains mandatory where the operation declares it. Async reconciliation may be used only when the contract explicitly permits it.

## 13. Partial success and compensation

Multi-step external workflows MUST record completed effects individually.

Compensation semantics are typed:

```text
reversible
compensatable
irreversible
manual_recovery
```

Compensation is a new governed effect, not a fictional transaction rollback.

## 14. Effect taxonomy

The runtime SHOULD converge state-changing operation metadata toward bounded effect families such as:

```text
read_only
internal_state_write
external_reversible_write
external_compensatable_write
external_irreversible_write
financial_effect
security_effect
deployment_effect
data_destructive_effect
```

Effect class drives approval, separation of duties, readback, compensation, evidence, and rollout requirements.

## 15. Resource conflict contract

Parallel DAG scheduling MUST operate on explicit conflict metadata rather than connector identity alone.

Operations SHOULD expose compatible metadata such as:

```text
read_set
write_set
lock_keys
conflict_domain
```

Conflicting mutations serialize through leases and fencing tokens. A stale worker holding an older fencing generation cannot mutate after a newer worker has claimed the resource.

## 16. Projection split

Authoritative execution state is committed before non-authoritative projections.

```text
provider/readback/receipt/result + transactional outbox
  -> Drive
  -> JSONL/archive
  -> search/vector index
  -> analytics
  -> notifications
  -> MCP/UI compact projections
```

Projection repair MUST NOT replay the provider mutation.

## 17. Evidence versus telemetry

Evidence answers governance questions:

```text
who
what
why
which scope/resource
which policy/approval/plan
which effect
what readback proved
```

Telemetry answers operational questions:

```text
latency
token/cost usage
queue time
retry count
provider duration
model/tool round trips
```

Telemetry may be sampled; required governance evidence may not be silently dropped.

## 18. Acceptance criteria

This artifact contract is ready for implementation when:

1. each runtime artifact has one semantic owner and one lifecycle definition;
2. no artifact is used as authority for facts owned by another artifact without fresh owner validation;
3. the Effective Runtime Manifest is reference-first and no-secret;
4. revision/epoch invalidation relationships are machine-testable;
5. every unsafe mutation reserves operation/idempotency state before dispatch;
6. unknown outcome blocks blind retry;
7. readback is operation-contract driven;
8. projection failure cannot rewrite confirmed execution state;
9. conflicting mutation workers are fenced;
10. shadow parity proves legacy and composed paths make equivalent authority decisions before cutover.

## 19. Content Intelligence fitness case

A Content Intelligence article run should be reconstructable from immutable references such as:

```text
Content Intelligence package installation revision
Brand/context Execution Capsule
Knowledge snapshot
Skill/model decisions
Governance decision
Article workflow plan hash
Approval grant for publish frontier
WordPress operation envelope
Pending/final receipt
WordPress readback
Evidence/outbox projection state
```

No article-specific requirement should force a parallel execution authority into the Product/Package layer.
