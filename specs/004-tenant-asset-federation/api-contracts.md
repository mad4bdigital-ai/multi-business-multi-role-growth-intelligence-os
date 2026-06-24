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

## 9. Business-Type Blueprints and Brand inheritance

- `GET /tenant/business-types/{businessTypeKey}/layer-blueprints`
- `GET /tenant/layer-blueprints/{blueprintId}`
- `GET /tenant/layer-blueprints/{blueprintId}/relationships`
- `GET /tenant/layer-blueprints/{blueprintId}/resource-bindings`
- `GET /tenant/brands/{brandKey}/business-type-bindings`
- `POST /tenant/brands/{brandKey}/business-type-bindings`
- `PATCH /tenant/brands/{brandKey}/business-type-bindings/{bindingId}`
- `DELETE /tenant/brands/{brandKey}/business-type-bindings/{bindingId}`
- `GET /tenant/brands/{brandKey}/inheritance-profiles`
- `POST /tenant/brands/{brandKey}/inheritance-profiles`
- `PATCH /tenant/brands/{brandKey}/inheritance-profiles/{profileId}`
- `POST /tenant/brands/{brandKey}/inheritance-profiles/{profileId}/preview-impact`
- `POST /tenant/brands/{brandKey}/inheritance-profiles/{profileId}/apply`
- `POST /tenant/brands/{brandKey}/inheritance-profiles/{profileId}/disable`
- `GET /tenant/brands/{brandKey}/inheritance-runs/{runId}`
- `GET /tenant/brands/{brandKey}/inheritance-conflicts`
- `POST /tenant/brands/{brandKey}/inheritance-conflicts/{conflictId}/resolve`
- `GET /tenant/brands/{brandKey}/layer-instances`
- `GET /tenant/brands/{brandKey}/layer-instances/{layerInstanceId}`
- `GET /tenant/brands/{brandKey}/layer-instances/{layerInstanceId}/provenance`
- `GET /tenant/brands/{brandKey}/layer-instances/{layerInstanceId}/effective-resources`
- `POST /tenant/brands/{brandKey}/layer-upgrade-runs/preview`
- `POST /tenant/brands/{brandKey}/layer-upgrade-runs/{runId}/apply`
- `POST /tenant/brands/{brandKey}/layer-upgrade-runs/{runId}/reject`

Preview returns the proposed Brand-scoped Department, Group, Role, member-profile, AI-Agent-profile, knowledge, and asset graph; shared resource references; conflicts; exclusions; replacements; local patches; disposition requirements; expected authority-epoch changes; and no-secret checksums. It performs no hidden instance mutation, membership creation, credential read, provider call, or execution grant.

Apply requires a current preview checksum, profile/version precondition, exact publisher authority, required approvals, idempotency, transaction/readback evidence, and a disposition plan for destructive removals. Business-Type bindings grant Blueprint eligibility only.

## 10. Identity, invitation onboarding, active context, and tenant lifecycle

### Invitation and identity surfaces

- `POST /tenant/invitations`
- `GET /tenant/invitations/{invitationId}`
- `GET /tenant/invitations/{invitationId}/scope`
- `POST /tenant/invitations/{invitationId}/deliveries`
- `POST /tenant/invitations/{invitationId}/revoke`
- `POST /tenant/invitations/{invitationId}/revisions`
- `GET /invitations/{token}/preview`
- `POST /invitations/{token}/accept`
- `POST /invitations/{token}/decline`
- `GET /me/identities`
- `POST /me/identities/google/link`
- `POST /me/identities/{identityId}/unlink`
- `GET /me/memberships`
- `GET /me/contexts`
- `POST /me/active-context`
- `DELETE /me/active-context`
- `GET /me/personal-account`
- `POST /me/personal-account`
- `GET /me/personal-workspaces`
- `POST /me/personal-workspaces`

Invitation creation requires an exact immutable scope, inviter authority/version, expiry, idempotency key, and approved delivery channel. Public preview exposes only safe Tenant/Brand/Workspace/Department/Group/Role labels and scope summaries.

Acceptance verifies the invitation token hash, expiry/status, Google issuer/audience/nonce/state, verified invited-email match, inviter authority ceiling, and scope checksum. One transaction creates or reactivates the minimal Tenant membership plus exact scoped grants and organizational assignments, marks the invitation accepted, persists readback evidence, and issues a revalidated target context.

Scoped invitations do not create broad default workspace grants, new Tenants, or personal workspaces. Personal-account creation is an explicit separate operation. Context switching never trusts the first membership implicitly and returns stable structured errors for unavailable, revoked, expired, or ambiguous contexts.

### Organization and lifecycle surfaces

Planned resource surfaces:

- `GET /tenant/principals`
- `GET /tenant/principals/{principalId}`
- `GET /tenant/groups`
- `POST /tenant/groups`
- `POST /tenant/groups/{groupId}/memberships`
- `DELETE /tenant/groups/{groupId}/memberships/{membershipId}`
- `GET /tenant/delegations`
- `POST /tenant/delegations`
- `POST /tenant/delegations/{delegationId}/revoke`
- `GET /tenant/relationships`
- `POST /tenant/lifecycle-runs`
- `GET /tenant/lifecycle-runs/{runId}`
- `POST /tenant/lifecycle-runs/{runId}/approve`
- `POST /tenant/lifecycle-runs/{runId}/cancel`

Lifecycle run types include ownership transfer, offboarding, export, legal hold, and erasure. No lifecycle endpoint directly returns credential material or performs unapproved destructive work.

## 10. Data governance and portability

- `GET /tenant/data-governance/classifications`
- `GET /tenant/data-governance/purposes`
- `GET /tenant/data-governance/residency-policies`
- `GET /tenant/users/me/data-use-preferences`
- `PATCH /tenant/users/me/data-use-preferences`
- `POST /tenant/data-subject-requests`
- `GET /tenant/data-subject-requests/{requestId}`
- `POST /tenant/legal-holds`
- `POST /tenant/retention-execution-runs/preview`
- `POST /tenant/export-runs`
- `GET /tenant/export-runs/{runId}`
- `POST /tenant/import-runs/preview`
- `POST /tenant/import-runs`

Export and import payloads are checksummed, versioned, bounded, and no-secret. Erasure and retention execution require exact scope, legal-hold evaluation, approval, and same-cycle readback.

## 11. Commercial and FinOps

- `GET /tenant/commercial-entitlements`
- `POST /tenant/runtime-cost-estimates`
- `POST /tenant/runtime-cost-reservations`
- `GET /tenant/runtime-cost-reservations/{reservationId}`
- `POST /tenant/runtime-cost-reservations/{reservationId}/release`
- `GET /tenant/cost-attribution`

A cost reservation binds the exact manifest, operation, currency, unit, amount, expiry, and idempotency key. Settlement/refund is performed by governed internal execution, not arbitrary clients.

## 12. Model governance and evaluation

- `GET /tenant/model-candidates`
- `POST /tenant/model-selections/preview`
- `GET /admin/model-capability-profiles`
- `GET /admin/model-context-policies`
- `GET /admin/model-evaluation-suites`
- `POST /admin/model-evaluation-runs`
- `GET /admin/model-quality-scorecards`
- `POST /admin/model-deprecation-runs`

Model preview returns eligibility and evidence without credentials. It explains exclusions for policy, region, entitlement, capability, quality, cost, latency, evaluation, or provider readiness.

## 13. Runtime operations and consistency

- `POST /tenant/runtime-operations`
- `GET /tenant/runtime-operations/{operationId}`
- `POST /tenant/runtime-operations/{operationId}/cancel`
- `POST /tenant/runtime-operations/{operationId}/resume`
- `GET /tenant/runtime-operations/{operationId}/events`
- `GET /admin/runtime-dead-letters`
- `POST /admin/runtime-dead-letters/{deadLetterId}/replay`
- `GET /admin/runtime-sagas/{sagaId}`

Creation requires an idempotency key and declares deadline, delivery semantics, retry class, cancellation policy, and compensation profile where applicable. `202 Accepted` is used for queued operations with a status resource.

## 14. Artifacts, knowledge, and provenance

- `GET /tenant/artifacts`
- `GET /tenant/artifacts/{artifactId}`
- `GET /tenant/artifacts/{artifactId}/provenance`
- `GET /tenant/artifacts/{artifactId}/verification`
- `GET /tenant/artifacts/{artifactId}/changes`
- `GET /tenant/artifacts/{artifactId}/revisions`
- `POST /tenant/artifacts/{artifactId}/corrections`
- `POST /tenant/artifacts/{artifactId}/retractions`
- `GET /tenant/knowledge-index-versions`

Content responses apply audience, sensitivity, purpose, residency, and object-level authorization. Provenance routes return safe source identifiers and evidence, not another tenant's private content.

## 15. Environment, supply chain, compatibility, and resilience

- `GET /tenant/environments`
- `GET /tenant/regions-jurisdictions`
- `GET /tenant/packages/{packageId}/supply-chain`
- `GET /tenant/packages/{packageId}/compatibility`
- `GET /admin/publishers`
- `GET /admin/contract-schemas`
- `GET /admin/contract-compatibility`
- `GET /admin/disaster-readiness`
- `POST /admin/disaster-mode-runs/preview`

Code-bearing package publication/install requires trusted publisher, digest/signature, dependency/license/security evidence, requested capabilities, compatibility, certification, and rollback.

## 16. Human operations, capability ontology, and quality

- `GET /tenant/human-work-items`
- `GET /tenant/human-work-queues`
- `GET /tenant/capabilities`
- `GET /tenant/capabilities/{capabilityKey}/implementations`
- `GET /admin/quality-evaluation-suites`
- `POST /admin/quality-evaluation-runs`
- `GET /admin/recommendation-exposure-health`
- `GET /admin/cross-tenant-learning-health`

Human work surfaces disclose SLA/escalation and exact scope without exposing other tenants. Capability implementation lists distinguish equivalence, compatibility, readiness, quality, risk, cost, locale, and deprecation.

## 17. Standard response shapes

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
