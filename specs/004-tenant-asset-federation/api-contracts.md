# Planned API Contracts

All interfaces use OpenAPI 3.1, resource-oriented paths, stable structured errors, signed-principal tenant scope, cursor pagination, bounded payloads, and object-level authorization.

## 1. Shared asset catalog

- `GET /tenant/shared-assets`
- `GET /tenant/shared-assets/{assetRef}`
- `GET /tenant/shared-assets/{assetRef}/readiness`
- `GET /tenant/shared-assets/{assetRef}/changes`
- `GET /tenant/shared-assets/{assetRef}/revisions`

Filters may include asset type, readiness state, business activity, required connection, risk class, and customization capability. Unsupported filters are rejected.

Catalog reads create no asset copy and read no credential payload.

## 2. Effective runtime preview

- `POST /tenant/effective-runtime-manifests/preview`
- `GET /tenant/effective-runtime-manifests/{manifestId}`
- `GET /tenant/effective-runtime-manifests/{manifestId}/explanation`

Preview input includes intent, target context, requested dimensions, operation, and optional composition-profile selections. It returns:

- context paths;
- effective authority;
- shared candidates;
- typed policy results;
- selected variants and preferences;
- readiness vector;
- blocking codes;
- up to three recovery actions;
- immutable checksum and expiry.

Preview performs no provider call, secret read, or external write.

## 3. Composition profiles

- `GET /tenant/context-composition-profiles`
- `POST /tenant/context-composition-profiles`
- `GET /tenant/context-composition-profiles/{profileId}`
- `PATCH /tenant/context-composition-profiles/{profileId}`
- `POST /tenant/context-composition-profiles/{profileId}/publish`
- `POST /tenant/context-composition-profiles/{profileId}/preview-impact`
- `POST /tenant/context-composition-profile-selections`
- `DELETE /tenant/context-composition-profile-selections/{selectionId}`

Mutations require idempotency keys, version preconditions, operator validation, lifecycle evidence, audit, and same-cycle readback.

## 4. User runtime preferences

- `GET /tenant/users/me/runtime-preferences`
- `PATCH /tenant/users/me/runtime-preferences`
- `POST /tenant/users/me/runtime-preferences/reset`
- `GET /tenant/users/me/runtime-preferences/changes`
- `GET /tenant/users/me/runtime-preferences/revisions`

The schema is allowlisted. Preference mutations cannot add authority, raise quotas, lower risk/approval, select cross-tenant resources, or store secret-like values.

## 5. Optional variants

- `GET /tenant/asset-variants`
- `POST /tenant/asset-variants`
- `GET /tenant/asset-variants/{variantId}`
- `PATCH /tenant/asset-variants/{variantId}`
- `POST /tenant/asset-variants/{variantId}/patches`
- `POST /tenant/asset-variants/{variantId}/publish`
- `POST /tenant/asset-variants/{variantId}/disable`
- `POST /tenant/asset-variants/{variantId}/upgrade-preview`
- `POST /tenant/asset-variants/{variantId}/upgrade-apply`
- `POST /tenant/asset-variants/{variantId}/reset-to-shared`
- `GET /tenant/asset-variants/{variantId}/changes`
- `GET /tenant/asset-variants/{variantId}/revisions`

Variant creation is explicit. There is no bulk adoption endpoint that creates one copy per tenant.

## 6. Connections and readiness

Existing governed OAuth and credential-intake routes remain the only secret-input surfaces.

Asset-related routes expose only references and readiness:

- `GET /tenant/shared-assets/{assetRef}/eligible-connections`
- `POST /tenant/asset-connection-bindings`
- `DELETE /tenant/asset-connection-bindings/{bindingId}`
- `POST /tenant/asset-connection-bindings/{bindingId}/validate`
- `GET /tenant/asset-connection-bindings/{bindingId}/readiness`

No endpoint returns a credential value.

## 7. Adaptive proposals and experiments

- `GET /tenant/adaptive-change-proposals`
- `GET /tenant/adaptive-change-proposals/{proposalId}`
- `POST /tenant/adaptive-change-proposals/{proposalId}/simulate`
- `POST /tenant/adaptive-change-proposals/{proposalId}/accept`
- `POST /tenant/adaptive-change-proposals/{proposalId}/dismiss`
- `POST /tenant/adaptive-change-proposals/{proposalId}/expire`
- `GET /tenant/adaptive-experiments`
- `GET /tenant/adaptive-experiments/{experimentId}`
- `POST /tenant/adaptive-experiments/{experimentId}/stop`

Only governed internal services create system-derived proposals. User-created proposals use a separate explicit create contract and cannot self-approve authority changes.

Simulation is no-provider-write and references a bounded, privacy-authorized corpus.

## 8. Platform/admin governance

- `GET /admin/shared-assets/catalog`
- `GET /admin/context-composition/coverage`
- `GET /admin/context-composition/parity`
- `GET /admin/adaptive-growth/health`
- `GET /admin/platform-asset-promotion-candidates`
- `POST /admin/platform-asset-promotion-candidates/{candidateId}/review`

Platform promotion uses existing release and certification governance. It is never a direct tenant endpoint.

## 9. Standard response shapes

### Resource response

```json
{
  "item": {},
  "meta": {
    "requestId": "req_...",
    "observedAt": "2026-06-23T00:00:00Z",
    "secretsIncluded": false
  }
}
```

### List response

```json
{
  "items": [],
  "page": {
    "nextCursor": null,
    "hasMore": false
  },
  "meta": {
    "requestId": "req_...",
    "secretsIncluded": false
  }
}
```

### Error envelope

```json
{
  "error": {
    "code": "COMPOSITION_SCOPE_MISSING",
    "message": "A required context layer did not provide eligible authority.",
    "details": [
      {
        "layer": "role",
        "dimension": "actions"
      }
    ],
    "requestId": "req_..."
  }
}
```

## 10. Status-code guidance

- `200` successful read, preview, or update;
- `201` created profile, variant, selection, or proposal;
- `204` successful deletion/reset where no body is needed;
- `400` invalid syntax or unsupported filters;
- `401` missing/invalid authentication;
- `403` principal lacks scoped permission;
- `404` tenant-scoped resource not found;
- `409` version, authority epoch, composition, or variant conflict;
- `422` semantically invalid operator, patch, or context;
- `429` rate or quota limit;
- `503` required authority/readiness dependency unavailable.

## 11. Stable error codes

```text
SHARED_ASSET_NOT_VISIBLE
SHARED_ASSET_NOT_ENTITLED
COMPOSITION_PROFILE_NOT_FOUND
COMPOSITION_PROFILE_AMBIGUOUS
COMPOSITION_OPERATOR_NOT_ALLOWED
COMPOSITION_SCOPE_MISSING
POLICY_FIELD_UNREGISTERED
POLICY_CONFLICT
MANDATORY_POLICY_DENIED
PREFERENCE_VALUE_NOT_ALLOWED
VARIANT_PATCH_FORBIDDEN
VARIANT_CONFLICT
VARIANT_BASE_STALE
CONNECTION_BINDING_REQUIRED
CONNECTION_BINDING_AMBIGUOUS
INSTALLATION_NOT_READY
CERTIFICATION_REQUIRED
APPROVAL_REQUIRED
QUOTA_EXCEEDED
AUTHORITY_EPOCH_CHANGED
CROSS_TENANT_REFERENCE_FORBIDDEN
ADAPTIVE_PROPOSAL_STALE
ADAPTIVE_SIMULATION_FAILED
EFFECTIVE_RUNTIME_BLOCKED
```

## 12. Contract compatibility

Implementation is additive. Existing policy, grant, activation, connection, and execution routes remain unchanged until family-by-family cutover. New response fields are optional until clients are certified. Deprecated bridge fields require a documented migration and removal window.
