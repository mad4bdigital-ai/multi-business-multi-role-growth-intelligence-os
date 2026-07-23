# Error Catalog

All public errors use the platform structured error envelope and include a request identifier when available.

## Authentication and subject

- `AUTHENTICATION_REQUIRED`: no valid principal evidence.
- `EFFECTIVE_SUBJECT_REQUIRED`: tenant-scoped operation lacks a resolved subject.
- `SERVICE_BINDING_REQUIRED`: service principal lacks an explicit service binding.
- `IMPLICIT_IMPERSONATION_FORBIDDEN`: caller attempted an unapproved subject switch.

## Context resolution

- `CONTEXT_AMBIGUOUS`: more than one valid context candidate remains.
- `INTERPRETATION_REQUIRED`: user selection is required before planning.
- `TENANT_CONTEXT_STALE`: tenant authority revision changed.
- `WORKSPACE_CONTEXT_STALE`: workspace membership or binding changed.
- `CONTEXT_REVISION_CONFLICT`: supplied revision does not match current registry state.
- `CONTEXT_PIN_EXPIRED`: pinned context is no longer reusable.
- `CROSS_TENANT_CONTEXT_REJECTED`: candidate or resource falls outside the selected tenant.

## Resource and connection

- `RESOURCE_BINDING_MISSING`: no exact governed resource binding exists.
- `RESOURCE_CONTEXT_MISMATCH`: resource conflicts with tenant or workspace context.
- `CONNECTION_AMBIGUOUS`: more than one eligible connection remains.
- `CONNECTION_CONTEXT_MISMATCH`: connection belongs to a different scope.
- `CREDENTIAL_SCOPE_MISMATCH`: credential scope does not authorize the exact resource.

## Capability and authority

- `CAPABILITY_NOT_CONFIGURED`
- `CAPABILITY_RUNTIME_MISMATCH`
- `RESOURCE_AUTHORITY_MISSING`
- `RESOURCE_AUTHORITY_EXPIRED`
- `ELEVATED_APPROVAL_REQUIRED`
- `FALLBACK_SELECTION_FORBIDDEN`
- `OPERATION_NOT_READY`

## Planning and execution

- `PLAN_CONTEXT_MISMATCH`
- `APPROVAL_CONTEXT_MISMATCH`
- `IDEMPOTENCY_KEY_REQUIRED`
- `IDEMPOTENCY_CONFLICT`
- `RESOURCE_REVISION_CONFLICT`
- `BASE_MOVED_BEFORE_WRITE`
- `BRANCH_HEAD_MOVED`
- `DEFAULT_BRANCH_OVERLAP_CONFLICT`

## Outcome and support

- `OUTCOME_UNKNOWN`
- `OUTCOME_UNRESOLVED`
- `READBACK_UNAVAILABLE`
- `READBACK_CONTRACT_FAILED`
- `RECONCILIATION_REQUIRED`
- `DEPENDENCY_TEMPORARILY_UNAVAILABLE`

Raw provider errors are logged internally after redaction and mapped to these stable codes.
