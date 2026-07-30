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
- `WORKSPACE_OWNERSHIP_TYPE_MISSING`: workspace personal/company ownership classification is absent or unclassified.
- `WORKSPACE_OWNERSHIP_TYPE_CONFLICT`: workspace ownership classification conflicts with owner or membership evidence.
- `BRAND_CONTEXT_STALE`: brand ownership or binding changed.
- `CONTEXT_REVISION_CONFLICT`: supplied revision does not match current registry state.
- `CONTEXT_PIN_EXPIRED`: pinned context is no longer reusable.
- `CROSS_TENANT_CONTEXT_REJECTED`: candidate or resource falls outside the selected tenant.

## Resource and connection

- `RESOURCE_BINDING_MISSING`: no exact governed resource binding exists.
- `RESOURCE_CONTEXT_MISMATCH`: resource conflicts with tenant or workspace context.
- `CONNECTION_AMBIGUOUS`: more than one equal-ranked eligible connection remains.
- `CONNECTION_CONTEXT_MISMATCH`: connection belongs to a different context.
- `CONNECTION_OWNER_MISMATCH`: connection owner does not match the resolved owner scope.
- `CONNECTION_SCOPE_FORBIDDEN`: connection owner scope is not permitted for the operation.
- `CONNECTION_INHERITANCE_FORBIDDEN`: policy does not permit inheritance from the candidate scope.
- `PERSONAL_CONNECTION_REQUIRED`: an eligible effective-user personal connection is required.
- `WORKSPACE_CONNECTION_REQUIRED`: an eligible exact workspace connection is required.
- `BRAND_CONNECTION_REQUIRED`: an eligible exact brand connection is required.
- `CONNECTION_REAUTH_REQUIRED`: provider authorization is expired, revoked, or requires renewed consent.
- `CONNECTION_PROVIDER_SCOPE_INSUFFICIENT`: granted provider scopes do not satisfy the capability.
- `CREDENTIAL_SCOPE_MISMATCH`: credential scope does not authorize the exact resource.
- `CROSS_USER_CONNECTION_REJECTED`: a personal connection belongs to another user.
- `CROSS_BRAND_CONNECTION_REJECTED`: a brand connection belongs to another brand.
- `BRAND_WORKSPACE_MISMATCH`: brand does not belong to the resolved workspace.
- `SILENT_CONNECTION_FALLBACK_FORBIDDEN`: a consequential write attempted to widen from an invalid explicit or more-specific connection.

## Provider consent and OAuth state

- `PROVIDER_CONSENT_REQUIRED`: platform identity is valid but no eligible provider API consent exists.
- `OAUTH_STATE_INVALID`: provider authorization state is malformed or signature validation failed.
- `OAUTH_STATE_EXPIRED`: provider authorization state is past its expiry.
- `OAUTH_STATE_CLAIM_CONFLICT`: another callback atomically claimed the authorization state first; no code exchange or credential mutation occurred.
- `OAUTH_STATE_REPLAYED`: single-use authorization state has already been consumed or reached a terminal state.
- `OAUTH_STATE_CONTEXT_MISMATCH`: signed state conflicts with live principal, tenant, workspace, brand, membership, owner scope, target connection, or expected revision.
- `OAUTH_REDIRECT_NOT_ALLOWED`: redirect target is not allowlisted or does not match signed state.
- `PROVIDER_ACCOUNT_MISMATCH`: returned provider identity conflicts with the approved authorization context.

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

Raw provider errors are logged internally after redaction and mapped to these stable codes. Credential material, refresh tokens, authorization codes, raw state values, claim tokens, and provider secrets never appear in public errors.
