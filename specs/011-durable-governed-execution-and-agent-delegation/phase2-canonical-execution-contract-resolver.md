# Phase 2 Slice A — Canonical Execution Contract Resolver

## Purpose

Add a read-only, fail-closed resolver that projects the existing MySQL authority into one canonical execution contract before dispatch. The resolver does not create a parallel registry. It reuses the current action, endpoint, capability, certification, resource-operation, and readback authorities.

## Reused authorities

| Contract field | Current authority |
|---|---|
| Parent action | `actions` |
| Endpoint | `endpoints` |
| Capability decision | `platform_capability_compiled_manifests` through `dynamicCapabilityEnforcementShadow.js` |
| Runtime certification | `runtime_dispatch_certification_registry` |
| Resource operation | `platform_resource_operation_registry` |
| Readback policy | `platform_capability_readback_contracts` |
| Capability envelope | `capability_resolution_envelope_ledger` through the reused shadow evaluator |

No new SQL table or migration is introduced.

## Exact resolution input

The resolver requires `parent_action_key`, `endpoint_key`, `capability_key`, `requested_mode`, and `principal_scope`. Optional context includes Tenant, workspace, resource, runtime surface, capability envelope, idempotency key, input hash, and expected contract hash.

The capability key is explicit in this slice. Intent-first capability selection remains a later task.

## Resolution rules

1. Resolve exactly one active parent action.
2. Resolve exactly one active, ready, and validated endpoint for the action.
3. Reject conflicting module, connector, or route bindings.
4. Resolve a deterministic runtime surface.
5. Rank current runtime certifications using exact runtime, endpoint, capability, and action keys.
6. Resolve one current resource operation when authority is required.
7. Resolve one current certified readback contract when readback is required.
8. Reuse the dynamic capability enforcement shadow for capability manifest, envelope, approval, and scope gates.
9. Compute a stable contract hash.
10. Reject an `expected_contract_hash` mismatch as stale.

Missing, stale, ambiguous, or conflicting bindings fail closed before dispatch.

## Canonical policy projection

The resolved contract includes approval, retry, unknown-outcome reconciliation, idempotency, resource-authority, dry-run, audit, readback, and evidence requirements. Unsafe apply methods default to `user_approval_only`, `read_before_retry`, required idempotency, required readback, and unknown-outcome reconciliation.

## Decisions

- `resolved_preview`
- `resolved_apply_candidate`
- `blocked`

`resolved_apply_candidate` is not execution authority. The service never calls a provider, consumes an envelope, reserves idempotency, or dispatches a tool.

## Security and isolation

The service selects only bounded registry fields. It does not select action API keys, endpoint schemas, credential payloads, raw manifests, or provider responses. Tenant and workspace context is forwarded to the reused capability evaluator. Public route and Tenant API isolation remain out of scope until a later slice.

## Boundaries

- Shadow-only application service.
- No public route or OpenAPI promotion.
- No database write or migration.
- No provider call or external send.
- No capability-envelope mutation.
- No delegation activation.
- No runtime authority change.
- No deployment.

## Follow-up

1. Convert selected operations to intent-first resolver input.
2. Add route-level Admin and Tenant isolation.
3. Add canonical status and explain endpoints.
4. Promote OpenAPI only after route, handler, registry, and error-contract parity.
