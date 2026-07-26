# Authority and Policy Resolution

## Separation of concepts

- **Authentication** proves the caller.
- **Principal** identifies the actor.
- **Authority** decides whether the actor may perform an operation on a resource.
- **Execution class** describes scheduling; it grants nothing.
- **Containment** identifies organizational ownership.
- **Configuration inheritance** resolves settings; it grants nothing.
- **Credential ownership** controls which secret reference may be resolved.
- **Runtime certification** proves an adapter/endpoint is allowed and compatible.

## Authority decision envelope

Every protected operation resolves and persists:

```json
{
  "principal": {"id": "...", "type": "tenant_member"},
  "resource": {"type": "workflow_version", "id": "...", "ownerContainerId": "..."},
  "operation": {"capabilityKey": "...", "mode": "apply"},
  "authentication": {"mode": "user_jwt", "assurance": "..."},
  "grants": [],
  "denies": [],
  "constraints": {},
  "tenantIsolation": {"status": "passed"},
  "resourceBinding": {"status": "active"},
  "runtimeCertification": {"status": "active"},
  "credentialResolution": {"status": "reference_resolved"},
  "approval": {"status": "not_required"},
  "readback": {"required": true, "contractKey": "..."},
  "decision": "allow",
  "decisionHash": "..."
}
```

## Evaluation order

1. Authenticate and normalize the principal.
2. Resolve exact target resource and owning container.
3. Verify tenant/workspace boundary for tenant-owned resources.
4. Load explicit deny and allow grants.
5. Apply platform policy constraints.
6. Validate resource authority binding.
7. Validate endpoint/action identity from registry authority.
8. Validate adapter/runtime certification and freshness.
9. Resolve credential reference under owner scope and least privilege.
10. Validate approval hold, typed confirmation, and plan hash when required.
11. Validate required readback capability.
12. Produce deterministic allow/deny/block decision and hash.

## Deny precedence

The following always block:

- explicit deny;
- inactive or suspended principal, container, grant, binding, credential, or certification;
- missing tenant/workspace for tenant-owned resources;
- cross-tenant target without a specific platform-admin grant;
- stale or mismatched approval;
- unresolved or ambiguous resource;
- unsupported adapter capability;
- absent mandatory readback;
- attempt to use execution class or preference as authority.

## Platform principal

A platform-admin principal may act on a platform-owned resource without a fake tenant/workspace only when the exact platform resource binding, capability, risk approval, certification, and readback are valid.

Acting on tenant-owned resources requires an explicit audited authority edge targeting that tenant/resource. Platform-admin status alone is not a wildcard data bypass.

## Delegation

Delegation must be explicit, capability- and resource-bounded, time-bounded, non-transitive by default, revocable, and visible in the decision envelope.

An AI agent principal receives only permissions needed for the current plan. It cannot delegate further unless an explicit policy allows it.

## Approval binding

Approval holds bind to:

- operation and mode;
- exact resource/version;
- compiled plan hash;
- settings snapshot hash;
- authority decision hash;
- adapter decision;
- risk class;
- expiry and approving principal.

Any material change invalidates the hold.

## Readback as authority condition

For high-risk operations, authorization is incomplete unless the platform can verify the resulting state. A successful provider response without readback leaves the run in `verifying` or `blocked`, never `completed`.
