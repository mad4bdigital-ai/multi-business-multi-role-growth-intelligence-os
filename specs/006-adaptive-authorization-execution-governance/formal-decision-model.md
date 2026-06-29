# Formal Decision Model

## Purpose

Define one canonical, side-effect-free authorization decision that all routes, tools, workers, workflows, and connectors can consume.

## Decision function

```text
D = Evaluate(S, C, A, R, X, Rel, G, P, B, V)
```

Where:

- `S` is the authenticated subject.
- `C` is the canonical capability and version.
- `A` is the requested action.
- `R` is the target resource and authority scope.
- `X` is bounded runtime context.
- `Rel` is relationship authority evidence.
- `G` is explicit grant evidence.
- `P` is the effective typed policy bundle.
- `B` is the eligible adapter binding set.
- `V` is the authority revision vector.

`Evaluate` MUST NOT perform provider calls, decrypt credentials, mutate resources, create approvals, or dispatch work.

## Canonical input

```json
{
  "subject": {
    "type": "user | agent | service",
    "id": "stable-id",
    "tenantId": "resolved-from-authentication",
    "workspaceId": "resolved-or-null"
  },
  "capability": {
    "key": "content.wordpress.publish",
    "version": 3
  },
  "action": {
    "name": "publish"
  },
  "resource": {
    "type": "wordpress_post",
    "id": "post-or-draft-id",
    "tenantId": "authority-derived",
    "workspaceId": "authority-derived",
    "brandId": "authority-derived",
    "revision": "etag-or-null"
  },
  "context": {
    "environment": "production",
    "operationClass": "external_mutation",
    "riskScore": 80,
    "requestedAt": "ISO-8601",
    "requestHash": "sha256"
  }
}
```

Tenant, workspace, brand, and resource authority MUST NOT be widened by caller-supplied values.

## Decision output

```json
{
  "decisionId": "decision-id",
  "effect": "allow | deny | conditional",
  "states": {
    "availability": "active",
    "binding": "resolved",
    "relationship": "satisfied",
    "grant": "active",
    "authorization": "conditional",
    "approval": "required",
    "freshness": "current"
  },
  "obligations": [
    "require_approval",
    "require_idempotency_key",
    "require_resource_readback"
  ],
  "blockingGaps": [],
  "revisionVector": {
    "capabilityVersion": 3,
    "policyBundleVersion": "pb-81",
    "relationshipRevision": "rel-1902",
    "grantRevision": "grant-482",
    "adapterVersion": "wordpress-rest@5.2.0",
    "resourceRevision": "etag-992"
  },
  "issuedAt": "ISO-8601",
  "expiresAt": "ISO-8601",
  "sensitiveValuesIncluded": false
}
```

## Evaluation order

The evaluator MUST use deterministic order:

1. Verify authenticated principal and actor type.
2. Resolve tenant and workspace scope from authority.
3. Resolve canonical capability and version.
4. Resolve resource identity and tenant ownership.
5. Apply hard tenant-isolation denies.
6. Resolve relationship path and revision.
7. Resolve grant lifecycle and constraints.
8. Evaluate contextual policy and hard denies.
9. Derive obligations.
10. Resolve eligible adapter candidates.
11. Detect missing, stale, or ambiguous bindings.
12. Calculate approval requirement.
13. produce bounded explanation and revision vector.

Hard deny always wins. Missing mandatory authority fails closed.

## Effect semantics

### Allow

All mandatory authority is current and no additional approval obligation remains.

### Conditional

The subject is authorized in principle, but execution requires explicit obligations such as approval, stronger readback, typed confirmation, or a current connection validation.

### Deny

Authority is absent, expired, revoked, cross-tenant, explicitly denied by policy, unsupported, stale beyond policy, or ambiguous.

`conditional` MUST NOT be treated as executable until every obligation is satisfied.

## Relationship and grant composition

A relationship proves structural authority. A grant proves enabled capability authority. Neither automatically substitutes for the other unless a typed policy explicitly marks one as `not_required`.

Example:

```text
relationship = satisfied
grant = active
policy = approval required
result = conditional
```

## Revision vector

A decision is current only while all execution-relevant revisions match. A changed capability, policy, relationship, grant, adapter, resource, connection readiness result, or normalized request hash makes the decision stale.

Read-only low-risk decisions may use bounded cached revision evidence when policy permits. State-changing execution requires same-cycle freshness validation at the enforcement point.

## Explanation policy

Internal evidence may contain matched rule IDs, relationship paths, grant IDs, and adapter candidates. External responses MUST expose only stable reason codes and bounded details. They MUST NOT expose credentials, tokens, raw policy source, unrestricted context, or cross-tenant identifiers.

## Determinism

Given the same normalized input and identical revision vector, the decision effect, obligations, reason codes, and selected adapter candidate set MUST be identical.

Any data source whose ordering may affect evaluation MUST use explicit stable ordering.
