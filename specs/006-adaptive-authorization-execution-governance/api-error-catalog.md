# API Error Catalog

## Purpose

Define stable machine-readable errors for authorization, approval, execution, adapter, readback, and reconciliation APIs.

## Envelope

```json
{
  "error": {
    "code": "APPROVAL_REQUIRED",
    "message": "This operation requires a current approval decision.",
    "details": [
      {
        "field": "executionEnvelopeId",
        "issue": "approval_required"
      }
    ],
    "requestId": "request-id"
  }
}
```

Rules:

- `code` is stable and uppercase snake case.
- `message` is safe for clients and does not expose internal policy source.
- `details` is bounded and optional.
- `requestId` is returned when available.
- raw stack traces, SQL, credentials, tokens, policy source, and cross-tenant identifiers are forbidden.

## Authentication and scope

| Code | HTTP | Meaning |
|---|---:|---|
| `AUTHENTICATION_REQUIRED` | 401 | No valid authenticated principal |
| `AUTHENTICATION_INVALID` | 401 | Credential or token is invalid |
| `AUTHORIZATION_DENIED` | 403 | Authenticated but not permitted |
| `TENANT_SCOPE_MISMATCH` | 403 | Requested object conflicts with authenticated tenant authority |
| `WORKSPACE_SCOPE_DENIED` | 403 | Workspace authority is absent |
| `RESOURCE_AUTHORITY_DENIED` | 403 | Subject lacks object-level authority |
| `SELF_APPROVAL_NOT_ALLOWED` | 403 | Effective policy denies self-approval |

## Capability and alias resolution

| Code | HTTP | Meaning |
|---|---:|---|
| `CAPABILITY_NOT_FOUND` | 404 | Canonical capability key/version does not exist |
| `CAPABILITY_INACTIVE` | 409 | Capability is unavailable or deprecated for new execution |
| `CAPABILITY_VERSION_UNSUPPORTED` | 422 | Requested version is not supported |
| `CAPABILITY_ALIAS_NOT_FOUND` | 404 | Legacy/action/tool/route alias has no canonical mapping |
| `CAPABILITY_ALIAS_AMBIGUOUS` | 409 | Alias resolves to multiple highest-priority capabilities |
| `CAPABILITY_INPUT_INVALID` | 422 | Request fails the canonical input contract |

## Relationship and grant authority

| Code | HTTP | Meaning |
|---|---:|---|
| `RELATIONSHIP_AUTHORITY_DENIED` | 403 | Required relationship path is absent |
| `RELATIONSHIP_AUTHORITY_STALE` | 409 | Relationship revision changed after decision |
| `RELATIONSHIP_GRAPH_AMBIGUOUS` | 409 | Authority cannot be resolved deterministically |
| `RELATIONSHIP_TRAVERSAL_LIMIT` | 422 | Graph traversal exceeds approved depth or result bound |
| `GRANT_NOT_FOUND` | 403 | Required capability grant is absent |
| `GRANT_SUSPENDED` | 403 | Grant is temporarily suspended |
| `GRANT_EXPIRED` | 403 | Grant expiry has passed |
| `GRANT_REVOKED` | 403 | Grant is terminally revoked |
| `GRANT_CONSTRAINT_MISMATCH` | 403 | Resource or context violates grant constraints |
| `GRANT_AUTHORITY_STALE` | 409 | Grant revision changed after decision |

## Policy decision

| Code | HTTP | Meaning |
|---|---:|---|
| `POLICY_DENIED` | 403 | Effective typed policy denies the request |
| `POLICY_INPUT_INVALID` | 422 | Required typed policy attributes are invalid |
| `POLICY_ATTRIBUTE_MISSING` | 422 | Mandatory policy input is absent |
| `POLICY_VERSION_STALE` | 409 | Decision uses a retired or changed policy version |
| `POLICY_EVALUATION_UNAVAILABLE` | 503 | Decision dependency is temporarily unavailable |
| `DECISION_CONDITIONAL` | 409 | Required obligations remain unsatisfied |
| `DECISION_EXPIRED` | 409 | Authorization decision TTL has elapsed |
| `DECISION_STALE` | 409 | One or more authority revisions no longer match |

## Approval

| Code | HTTP | Meaning |
|---|---:|---|
| `APPROVAL_REQUIRED` | 409 | Current operation requires approval |
| `APPROVAL_NOT_FOUND` | 404 | Approval request or decision does not exist |
| `APPROVAL_REJECTED` | 403 | Approval was explicitly rejected |
| `APPROVAL_EXPIRED` | 409 | Approval TTL elapsed |
| `APPROVAL_STALE` | 409 | Bound request or authority evidence changed |
| `APPROVAL_REVOKED` | 409 | Approval was revoked |
| `APPROVAL_ALREADY_DECIDED` | 409 | Append-only request already has a terminal decision |
| `APPROVAL_CONFIRMATION_INVALID` | 422 | Typed confirmation does not match policy |
| `APPROVAL_POLICY_UNSATISFIED` | 409 | Required roles or approval count are incomplete |

## Execution envelope and idempotency

| Code | HTTP | Meaning |
|---|---:|---|
| `ENVELOPE_NOT_FOUND` | 404 | Envelope does not exist in caller scope |
| `ENVELOPE_NOT_READY` | 409 | Envelope has unsatisfied obligations or blockers |
| `ENVELOPE_EXPIRED` | 409 | Envelope TTL elapsed |
| `ENVELOPE_STALE` | 409 | Revision vector or request evidence changed |
| `ENVELOPE_REVOKED` | 409 | Envelope was administratively revoked |
| `ENVELOPE_ALREADY_CONSUMED` | 409 | Single-use envelope has already dispatched |
| `ENVELOPE_RESERVATION_CONFLICT` | 409 | Another executor owns the dispatch reservation |
| `REQUEST_HASH_MISMATCH` | 409 | Supplied request does not match envelope evidence |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | Unsafe retryable operation lacks a key |
| `IDEMPOTENCY_KEY_CONFLICT` | 409 | Key was used with different normalized evidence |
| `IDEMPOTENCY_RESULT_PENDING` | 409 | Matching request is already executing |

## Adapter and connection

| Code | HTTP | Meaning |
|---|---:|---|
| `ADAPTER_BINDING_NOT_FOUND` | 409 | No eligible adapter exists |
| `ADAPTER_BINDING_AMBIGUOUS` | 409 | Multiple equal-ranked adapters remain |
| `ADAPTER_NOT_CERTIFIED` | 409 | Adapter version lacks current certification |
| `ADAPTER_DISABLED` | 409 | Adapter rollout status prevents execution |
| `ADAPTER_VERSION_STALE` | 409 | Envelope binds an obsolete adapter version |
| `ADAPTER_PREFLIGHT_FAILED` | 422 | Provider-specific preflight failed |
| `CONNECTION_NOT_READY` | 409 | Required connection is absent or invalid |
| `CONNECTION_VALIDATION_STALE` | 409 | Connection validation is older than policy allows |
| `CREDENTIAL_BINDING_DENIED` | 403 | Credential reference is outside execution scope |
| `CREDENTIAL_REFERENCE_NOT_FOUND` | 409 | Required credential reference is missing |

## Provider execution

| Code | HTTP | Meaning |
|---|---:|---|
| `PROVIDER_AUTHENTICATION_FAILED` | 502 | Provider rejected its credential |
| `PROVIDER_AUTHORIZATION_FAILED` | 502 | Provider credential lacks permission |
| `PROVIDER_VALIDATION_FAILED` | 422 | Provider rejected the normalized request |
| `PROVIDER_RESOURCE_NOT_FOUND` | 404 | Target provider resource is absent |
| `PROVIDER_RESOURCE_CONFLICT` | 409 | Provider resource revision or state conflicts |
| `PROVIDER_RATE_LIMITED` | 429 | Provider rate limit is active |
| `PROVIDER_QUOTA_EXCEEDED` | 429 | Provider quota prevents execution |
| `PROVIDER_UNAVAILABLE` | 503 | Provider or dependency is unavailable |
| `PROVIDER_TIMEOUT_UNKNOWN_EFFECT` | 503 | Timeout occurred after effect may have happened |
| `PROVIDER_OPERATION_UNSUPPORTED` | 422 | Adapter/provider cannot perform requested operation |

## Verification and reconciliation

| Code | HTTP | Meaning |
|---|---:|---|
| `READBACK_NOT_SUPPORTED` | 409 | Capability lacks an approved readback classification |
| `READBACK_INCOMPLETE` | 409 | Evidence is insufficient for required verification level |
| `READBACK_MISMATCH` | 409 | Observed state conflicts with expected state |
| `EFFECT_VERIFICATION_FAILED` | 409 | Business-visible effect was not verified |
| `COMPENSATION_REQUIRED` | 409 | Partial or undesired effect requires compensation |
| `MANUAL_INTERVENTION_REQUIRED` | 409 | Automated recovery is unsafe or unavailable |
| `RECONCILIATION_IN_PROGRESS` | 409 | Controller is evaluating drift |
| `RECONCILIATION_UNAVAILABLE` | 503 | Required reconciliation dependency is unavailable |
| `AUTHORITY_DRIFT_DETECTED` | 409 | Source authority changed after execution planning |

## Rate limiting

| Code | HTTP | Meaning |
|---|---:|---|
| `RATE_LIMIT_EXCEEDED` | 429 | Platform rate limit exceeded |
| `APPROVAL_RATE_LIMIT_EXCEEDED` | 429 | Approval requests are being throttled |
| `EXECUTION_RATE_LIMIT_EXCEEDED` | 429 | Capability execution is being throttled |

Rate-limited responses should include bounded retry guidance when available.

## Internal failures

| Code | HTTP | Meaning |
|---|---:|---|
| `DEPENDENCY_UNAVAILABLE` | 503 | Required internal dependency is temporarily unavailable |
| `CONTRACT_VIOLATION` | 500 | Internal component returned an invalid contract |
| `PERSISTENCE_CONFLICT` | 409 | Optimistic concurrency or unique constraint conflict |
| `UNEXPECTED_ERROR` | 500 | Unclassified internal failure |

## Retry classification

Responses may include a safe retry classification:

```text
not_retryable
retry_after_fresh_decision
retry_after_approval
retry_after_readback
retry_with_same_idempotency_key
retry_after_dependency_recovery
manual_intervention_required
```

The classification never overrides authorization or approval requirements.

## Compatibility

New error fields are additive. Existing stable codes are not repurposed. Deprecated codes retain a migration window and documented replacement.
