# Decision Model

## Decision input

```json
{
  "principal": { "type": "tenant_user", "subjectRef": "user" },
  "tenantRef": "tenant",
  "workspaceRef": "workspace",
  "requestedSelector": { "toolKey": "alias" },
  "resourceRef": "resource",
  "requestedMode": "preview | apply",
  "input": {},
  "idempotencyKey": "optional",
  "capabilityEnvelopeId": "optional",
  "approvalRef": "optional",
  "contextRevision": "revision"
}
```

Tenant and user identity come from authentication, not the body.

## Classification model

### Effect classes

| Effect | Meaning |
|---|---|
| `read_only` | Reads governed state without side effects. |
| `preview_only` | Computes plan/decision/evidence without mutation. |
| `internal_write` | Mutates platform-owned internal state only. |
| `workspace_write` | Mutates workspace/brand scoped internal or owned resources. |
| `external_write` | Changes a provider or externally visible resource. |
| `credential_touching` | Creates, promotes, revokes, or uses sensitive credential lifecycle state. |
| `deployment_affecting` | Changes executable runtime or deployment state. |
| `destructive` | Deletes, purges, irreversibly revokes, or causes equivalent high-impact effect. |

### Risk classes

- `A`: bounded read/preview.
- `B`: internal reversible write.
- `C`: scoped workspace or external draft/write with readback.
- `D`: publish, send, spend, deploy, credential, or privileged external mutation.
- `E`: destructive, break-glass, cross-system, or potentially irreversible operation.

Risk does not grant execution; it selects minimum obligations.

## Minimum requirement matrix

| Class | Envelope | Approval | Idempotency | Certification | Readback | Rollback/compensation |
|---|---|---|---|---|---|---|
| read/preview A | optional evidence | none unless policy | no | diagnostic/current binding | optional | no |
| internal write B | required | bounded policy or typed confirmation | yes | internal contract | same-cycle row/hash | rollback metadata |
| scoped write C | required | per request or bounded automatic policy | yes | current adapter | capability readback | compensation classification |
| privileged write D | required single-use | explicit scoped approval | yes | current versioned certification | mandatory | rehearsal/rollback plan |
| destructive E | required single-use | platform-admin/break-glass | yes | current + security review | mandatory before retry | explicit compensation or manual intervention |

## Evaluation algorithm

1. Authenticate principal and derive tenant/user scope.
2. Reject multiple or conflicting selectors.
3. Normalize selector and resolve one canonical capability.
4. Load current manifest and verify revision/freshness.
5. Validate requested mode against allowed modes and user choice evidence.
6. Evaluate surface exposure and Tenant/Admin separation.
7. Resolve resource identity and capability-specific authority.
8. Resolve effective grants and entitlements.
9. Resolve required connection and credential reference; validate lifecycle and scope.
10. Evaluate quota/budget and policy obligations.
11. Validate approval and typed confirmation bindings.
12. Validate current certification and deterministic adapter selection.
13. Validate readback contract and rollback/compensation classification.
14. For preview, return decision without reservation or provider call.
15. For apply, validate/create/consume the invocation envelope.
16. Reserve idempotency and execution attempt atomically.
17. Revalidate at adapter boundary.
18. Dispatch and record acknowledgement.
19. Perform readback and record verified/mismatch/unknown effect.
20. Reconcile debt and operational attention.

## Gate states

Each gate is one of:

```text
pass
deny
not_applicable
not_evaluated
stale
ambiguous
```

A required gate that is not `pass` denies dispatch.

## Decision effects

```text
allow_preview
deny
ready_requires_approval
ready_for_envelope
ready_for_dispatch
acknowledged_pending_readback
verified_success
verified_mismatch
unknown_provider_effect
manual_intervention_required
```

## Stable reason codes

### Identity and exposure

- `CAPABILITY_NOT_REGISTERED`
- `CAPABILITY_SELECTOR_AMBIGUOUS`
- `CAPABILITY_ALIAS_CONFLICT`
- `SURFACE_NOT_EXPOSED_TO_PRINCIPAL`
- `TENANT_TO_ADMIN_SURFACE_BLOCKED`

### Authority and readiness

- `TENANT_MEMBERSHIP_REQUIRED`
- `WORKSPACE_NOT_READY`
- `RESOURCE_AUTHORITY_MISSING`
- `CAPABILITY_GRANT_MISSING`
- `CONNECTION_MISSING`
- `CONNECTION_NOT_VALIDATED`
- `CREDENTIAL_SCOPE_MISMATCH`
- `QUOTA_AUTHORITY_MISSING`

### Governance

- `MUTATION_CLASSIFICATION_REQUIRED`
- `MUTATION_POLICY_REQUIRED`
- `APPROVAL_REQUIRED`
- `TYPED_CONFIRMATION_MISMATCH`
- `CAPABILITY_ENVELOPE_REQUIRED`
- `CAPABILITY_ENVELOPE_STALE`
- `IDEMPOTENCY_CONFLICT`
- `CERTIFICATION_REQUIRED`
- `CERTIFICATION_STALE`
- `ADAPTER_BINDING_AMBIGUOUS`
- `READBACK_CONTRACT_REQUIRED`

### Outcome

- `PROVIDER_ACKNOWLEDGED_PENDING_READBACK`
- `READBACK_VERIFIED`
- `READBACK_MISMATCH`
- `UNKNOWN_PROVIDER_EFFECT`
- `COMPENSATION_AUTHORITY_REQUIRED`

## Decision output

Responses include bounded manifest and gate evidence, no raw policies, secrets, credentials, or unrestricted provider data. Admin diagnostics may include source keys and typed gaps; Tenant responses include business-readable blockers and safe next actions only.
