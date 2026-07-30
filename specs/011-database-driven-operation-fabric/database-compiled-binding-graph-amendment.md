# Normative Amendment: Database-Compiled Binding Graph

## Status and precedence

This document is a normative design amendment for Spec 011. It refines the architecture, data model, dynamic binding resolution, tool projection, managed Git worker, migration and rollout, acceptance matrix, and risk register. Where an earlier Spec 011 statement can be interpreted as creating a second execution authority, this amendment takes precedence.

The amendment is design-only. It authorizes no migration, runtime cutover, provider call, credential read, deployment, protected-branch write, or merge.

## Decision

The operation fabric SHALL use a **Database-Compiled Binding Graph**.

- MySQL remains the control-plane authority for operation definitions, lifecycle, scope, policy, bindings, projections, and evidence.
- A versioned immutable compiled manifest is the runtime data-plane input.
- Runtime execution is pinned to one manifest revision and SHALL NOT re-resolve mutable bindings between steps.
- Existing capability, endpoint-export, dispatch-binding, resource-authority, approval, credential-scope, and readback authorities SHALL be reused.
- The operation registry is an orchestration authority only. It SHALL NOT become a parallel transport or capability authority.

## Authority boundaries

The effective authority chain is:

```text
operation contract
  -> operation step graph
  -> capability requirement
  -> platform_tool_dispatch_bindings
  -> platform_endpoint_tool_exports
  -> canonical endpoint and tool
  -> resource authority
  -> credential scope resolution
  -> approval and budget gates
  -> governed dispatch
  -> same-cycle readback
```

The following invariants are mandatory:

1. An operation key does not grant execution authority.
2. A tool projection does not grant Tenant visibility or mutation authority.
3. Endpoint presence does not imply execution readiness.
4. Binding priority never bypasses capability, resource, approval, health, or readback policy.
5. Ambiguous highest-priority bindings fail closed.
6. Generated projections are non-canonical and traceable to source revision and compiler version.
7. Operation success requires the configured readback contract, not transport acknowledgement alone.

## Reuse of existing registries

The design SHALL extend, not replace, the current platform authorities, including:

- `platform_tool_dispatch_bindings`
- `platform_endpoint_tool_exports`
- `platform_capability_compiled_manifests`
- resource-authority binding registries
- approval and capability-envelope ledgers
- runtime dispatch certification and readback contract registries
- repository automation run and step evidence

New operation tables may reference these authorities by stable keys and revision identifiers. They SHALL NOT duplicate provider URLs, credential payloads, active endpoint definitions, or tool-export schemas as independent canonical values.

## Logical data model

### Operation definition

An operation definition identifies the workflow contract:

```text
operation_key
operation_version
effect_class
risk_class
scope_class
execution_mode
validation_status
rollout_mode
certification_status
compiler_version
created_at
superseded_at
```

### Operation step graph

Each operation version contains an ordered DAG of steps:

```text
operation_key
operation_version
step_key
step_order
depends_on
capability_key
binding_selector_json
mutation_required
approval_policy_key
budget_policy_key
retry_policy_key
timeout_policy_key
readback_policy_key
compensation_policy_key
```

A stored `tool_key` is only a selector or expected projection. The effective executable tool SHALL still resolve through the canonical dispatch-binding authority.

### Compiled manifest

The compiler emits an immutable manifest:

```text
manifest_id
operation_key
operation_version
manifest_version
scope_fingerprint
source_revision_hash
manifest_hash
compiler_version
validation_status
rollout_mode
certification_status
manifest_json
is_current
created_at
superseded_at
```

There SHALL be at most one current manifest for the same operation version and scope fingerprint. Current-manifest uniqueness must be enforced transactionally.

### Operation run pinning

Every operation run records at minimum:

```text
run_id
operation_key
operation_version
manifest_id
manifest_hash
source_revision_hash
resolved_binding_ids
resource_fingerprint
input_sha256
idempotency_key
requested_by
status
created_at
completed_at
```

A resumed run SHALL revalidate resource fingerprint, authority, envelope validity, health, and idempotency receipt. It SHALL continue with the pinned manifest unless an explicit governed migration creates a replacement run.

## Deterministic binding resolution

Resolution precedence is fixed and explainable:

```text
resource-specific
  -> workspace
  -> tenant
  -> platform
```

Within each scope level:

```text
exact operation version
  -> exact capability
  -> exact provider family
  -> explicit fallback binding
```

The resolver SHALL:

1. Load only active, non-expired candidates.
2. Verify endpoint export and dispatch certification.
3. Verify resource authority and credential-scope compatibility.
4. Apply deny-wins policy before preference ranking.
5. Rank by the documented precedence tuple.
6. Reject ties at the highest effective rank with `blocked_ambiguous_binding`.
7. Emit selected binding IDs and rejected-candidate reason codes.
8. Hash the complete resolved graph into the manifest.

No implementation may select the first SQL row without a deterministic order and ambiguity check.

## Control plane and data plane

### Control plane

The control plane supports validated registry writes, compilation, certification, rollout transitions, audit, and rollback metadata. Writes are additive by default and require explicit lifecycle state.

### Data plane

The runtime reads a compiled manifest by exact identity or current certified revision. It SHALL verify:

- manifest hash
- source revision hash
- compiler compatibility
- validation status
- rollout mode
- certification status
- scope fingerprint
- expiry and revocation state

The runtime SHALL fail closed if the manifest is missing, ambiguous, invalid, revoked, incompatible, or stale beyond policy.

## Lifecycle dimensions

Health, rollout, and certification SHALL be represented independently:

```text
validation_status:
  valid | invalid | blocked | superseded | revoked

rollout_mode:
  disabled | shadow | canary | active | fallback

certification_status:
  uncertified | certified | expired | revoked
```

A manifest is executable only when all required dimensions allow execution. For example, `valid + shadow + certified` is observable but not authoritative for live execution.

## Tool projection contract

Admin and Tenant tools are projections compiled from the certified binding graph.

Projection requirements:

- stable operation and tool keys
- OpenAPI 3.1 compatible schemas
- explicit auth and scope metadata
- structured error envelopes
- idempotency requirements for unsafe retryable operations
- readback contract reference
- source revision and compiler version
- no credential payloads or secret-bearing fields

Tenant projection SHALL require an explicit Tenant-safe export and effective resource authority. Admin visibility SHALL NOT be inferred from global inventory counts alone.

Projection reconciliation follows:

```text
route implementation
  -> OpenAPI contract
  -> endpoint inventory
  -> execution readiness
  -> endpoint export
  -> dispatch binding
  -> compiled tool projection
  -> catalog smoke
```

A route that is not exported and certified is not considered available to GPT runtime.

## Managed Git worker correction

The current lease and readback component SHALL be described as a **Managed Git Worker Lease Ledger** until an executor performs real Git operations.

A true Managed Ephemeral Git Worker requires a certified adapter that can:

```text
allocate isolated workspace
  -> fetch pinned refs
  -> checkout expected head
  -> reconcile reviewed base
  -> apply registered change manifest
  -> regenerate governed artifacts
  -> validate tree
  -> create commit without force
  -> update non-protected ref
  -> perform exact SHA and tree readback
  -> destroy workspace
```

A virtual tree lease, branch-head read, or dry-run reconciliation plan MUST NOT be reported as a completed checkout, merge, rebase, commit, or push.

## Branch reconciliation

`repo.branch.reconcile` and aliases using an execute suffix SHALL report their actual execution level.

- A plan-only adapter returns `planned` or `dry_run_complete`.
- An executor may return `applied` only after ref mutation and same-cycle readback.
- Generated-artifact conflicts require registered reconciliation rules or explicit human review.
- Force push is forbidden.
- Protected-branch mutation is outside this contract.

## Migration and rollout

The rollout sequence is:

```text
inventory existing authorities
  -> define operation references
  -> compile immutable manifests
  -> shadow resolution
  -> compare legacy and compiled decisions
  -> dual-read with legacy authority
  -> canary selected operations
  -> certify readback and rollback
  -> activate per operation and scope
  -> retire duplicate code-side authority
```

Mandatory gates before canary or active rollout:

- zero unresolved ambiguous bindings
- source-to-manifest hash parity
- endpoint export and tool projection parity
- capability and resource-authority coverage
- credential-scope compatibility
- readback and compensation readiness
- bounded cache invalidation evidence
- rollback to the prior manifest revision

Rollback selects the previous certified manifest and records the transition. It does not mutate historical manifests or operation runs.

## Acceptance criteria

The implementation is acceptable only when tests prove:

1. Exact scope precedence and deny-wins behavior.
2. Ambiguous top-ranked candidates fail closed.
3. One current manifest per operation version and scope.
4. Manifest hash changes for every authority-affecting source change.
5. A run remains pinned when a newer manifest is published.
6. Resume rejects changed resource fingerprints or invalid authority.
7. Shadow comparison reports legacy and compiled decision parity.
8. Tenant projection never exposes Admin-only or unbound capabilities.
9. Tool catalog smoke confirms exported operation tools call the intended routes.
10. Cache invalidation cannot serve a revoked or superseded manifest beyond policy.
11. Readback failure prevents successful operation completion.
12. Lease-only Git behavior cannot claim checkout, merge, commit, or push.
13. Real Git execution performs no-force update and exact SHA/tree readback.
14. Rollback restores the prior certified manifest without deleting evidence.
15. No secrets appear in manifests, logs, projections, errors, or run evidence.

## Risk register additions

| Risk | Required mitigation |
|---|---|
| Parallel canonical registries | Foreign-key or stable-key references to existing authorities; prohibit duplicated endpoint and credential truth. |
| Registry/manifest split brain | Source revision hash, manifest hash, transactional current pointer, parity monitoring. |
| Stale cache execution | Revision-keyed cache, revocation check, bounded TTL, event-driven invalidation, fail closed. |
| Binding ambiguity | Deterministic precedence and explicit top-rank tie rejection. |
| Mid-run behavior drift | Pin manifest and binding IDs to the run. |
| Over-broad Tenant projection | Explicit Tenant-safe export and resource-authority checks. |
| False Git-worker capability claims | Separate Lease Ledger from certified Git Executor and use exact status names. |
| Partial mutation without verification | Idempotency, compensation policy, readback-required completion gate. |
| Rollout state conflated with validity | Independent validation, rollout, and certification dimensions. |
| Generated artifact drift | Registered generator ownership, regeneration rule, hash comparison, and reconciliation evidence. |

## Explicit exclusions for this specification branch

This amendment does not include:

- database migrations or writes
- runtime implementation
- provider calls
- credential reads
- deployment
- production cutover
- merge to `main`
- direct protected-branch mutation

Implementation work requires separate plan-bound approval, additive migrations, generated contract synchronization, tests, security review, CI, deployment parity verification, and same-cycle runtime readback.
