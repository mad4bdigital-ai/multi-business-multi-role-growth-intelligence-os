# Formal Decision Model

## 1. Decision tuple

```text
D = F(P, S, C, O, R, X, V)
```

- `P`: authenticated principal and actor identity
- `S`: normalized subject scope
- `C`: semantic capability
- `O`: operation
- `R`: resource or resource set
- `X`: runtime context, risk, environment, delegation, and source tier
- `V`: revision/version vector

## 2. Layer readiness vector

```text
L = {
  identity,
  scope,
  membership,
  capability,
  resource,
  policy,
  grant,
  binding,
  connection,
  endpoint,
  certification,
  approval,
  freshness
}
```

Each layer is one of `ready`, `blocked`, `authorization_gated`, `ambiguous`, `stale`, `not_applicable`, or `unknown`.

## 3. Final decision precedence

1. Invalid identity or immutable-scope violation -> `authorization_gated`.
2. Equal-ranked unresolved choices -> `ambiguous`.
3. Required revision no longer current -> `stale`.
4. Explicit policy or grant denial -> `blocked`.
5. Required evidence unavailable -> `degraded` for safe reads and blocked for writes.
6. Shadow rollout -> `shadow_ready`.
7. Canary rollout -> `canary_ready`.
8. All required layers ready -> `ready`.

`degraded` describes incomplete evidence, not a known setup requirement. Missing installation or approval is `blocked` with a typed reason.

## 4. Set invariants

For a fixed snapshot and subject scope:

```text
Executable ⊆ Projected ⊆ Authorized ⊆ Registered
```

For platform-global visibility:

```text
Visible = Registered - ExplicitlyPolicyHidden
```

For Tenant scope:

```text
Visible = Registered ∩ ReachableByApprovedRelations ∩ AllowedByPolicy
```

## 5. Determinism

Identical normalized inputs and version vectors produce the same decision and reason-code set.

Connection selection uses explicit ranking. If candidates remain equal after all deterministic tie-breakers, the decision is `ambiguous`; the first database row MUST NOT be selected.

## 6. Monotonic safety

Removing a grant, relationship, certification, or active connection cannot increase authority. Adding a UI projection, alias, label, or tool export cannot increase execution authority. Expanding Admin visibility cannot increase mutation authority without an independent operation grant and policy decision.

## 7. Manifest binding

State-changing manifests bind to actor, subject scope, capability, operation, resource, normalized request hash, selected provider/connection/endpoint, version vector, approval reference, expiry, and single-use state.

A manifest cannot be reused for a different resource, tenant, operation, payload, or approval.

## 8. Final revalidation

```text
not_expired
AND not_consumed
AND actor_still_valid
AND subject_scope_still_valid
AND grant_still_active
AND resource_not_revoked
AND connection_still_active
AND certification_current
AND approval_current
AND idempotency_safe
```

## 9. Reason-code domains

- `IDENTITY_*`
- `SCOPE_*`
- `MEMBERSHIP_*`
- `CAPABILITY_*`
- `RESOURCE_*`
- `POLICY_*`
- `GRANT_*`
- `CONNECTION_*`
- `ENDPOINT_*`
- `CERTIFICATION_*`
- `APPROVAL_*`
- `FRESHNESS_*`
- `PROJECTION_*`
- `SYSTEM_*`

Clients depend on stable codes, not human messages.
