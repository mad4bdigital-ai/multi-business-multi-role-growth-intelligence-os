# API Contracts

All proposed contracts are additive and MUST be represented in OpenAPI 3.1 before implementation.

## 1. Resolve authority

`POST /authority/decisions/resolve`

Purpose: return a no-secret Effective Authority Manifest. Tenant identity fields are derived from authentication and cannot be overridden.

```json
{
  "subject": {"scopeMode": "signed_membership", "workspaceId": "..."},
  "capabilityKey": "content.article.create_draft",
  "operation": "execute",
  "resource": {"type": "cms_site", "key": "site_123"},
  "context": {"entrySource": "tenant_gpt"}
}
```

Response includes decision state, readiness vector, projection eligibility, gaps, safe provider references, versions, timestamps, and `secretsIncluded:false`.

## 2. Read decision evidence

`GET /authority/decisions/{decisionId}`

Restricted to the actor, authorized subject administrators, or platform diagnostics. Sensitive cross-tenant evidence is redacted.

## 3. Projection diagnostics

`GET /authority/diagnostics/projections`

Admin-only cursor-paginated comparison of Registered, Authorized, Projected, Executable, and Observed sets. Supports safe filters by surface, tenant, capability, resource type, status, and snapshot.

## 4. Connector readiness

`GET /authority/projections/connectors`

Returns multi-dimensional readiness within the caller's effective scope and never returns credential values.

## 5. Delegation contexts

- `POST /authority/delegations`
- `GET /authority/delegations/{delegationId}`
- `DELETE /authority/delegations/{delegationId}`

Creation requires actor authority, subject binding, allowed operations, reason, expiry, and approval when policy requires it.

## 6. Projection reads

- `GET /authority/projections/tools`
- `GET /authority/projections/tabs`
- `GET /authority/projections/dashboard`

Responses include projection version, source authority version, freshness, completeness, and pagination metadata.

## 7. Structured errors

```json
{
  "error": {
    "code": "CONNECTION_SELECTION_AMBIGUOUS",
    "message": "More than one eligible connection has the same selection rank.",
    "details": [{"layer": "connection", "issue": "operator_selection_required"}],
    "requestId": "req_123"
  }
}
```

## 8. Status mapping

- `400` malformed request
- `401` missing/invalid authentication
- `403` authenticated but forbidden
- `404` visible resource or decision not found
- `409` ambiguity, revision conflict, stale/consumed manifest
- `422` invalid capability, scope, or relationship semantics
- `429` rate limited
- `503` required authority dependency unavailable

## 9. Compatibility

New response fields are optional during shadow. Legacy fields retain documented meaning until deprecation. `active` and `connected` gain explicit compatibility definitions. Clients migrate to readiness dimensions and typed reasons. Deprecation requires usage evidence, migration documentation, and rollback.

## 10. Security documentation

Every operation documents authentication, roles/scopes, object-level authorization, rate limits, examples, errors, idempotency behavior, and sensitive-field policy.
