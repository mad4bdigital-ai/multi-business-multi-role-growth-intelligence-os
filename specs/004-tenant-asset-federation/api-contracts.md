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

## 10A. Tenant creation and Workspace operations

### Tenant creation

- `GET /me/tenant-creation-capability`
- `GET /me/owned-tenants`
- `POST /me/tenant-provisioning-runs`
- `GET /me/tenant-provisioning-runs/{runId}`
- `POST /me/tenant-provisioning-runs/{runId}/cancel`
- `GET /tenant/owner-assignments`
- `POST /tenant/ownership-transfer-runs`

Tenant provisioning accepts requested Tenant type, display name, region, plan, optional setup template, and idempotency key. It returns `202 Accepted` with a status resource. It does not silently create Brands, Workspaces, connections, or Business-Type bindings unless explicitly included in an approved setup request.

`GET /me/tenant-creation-capability` explains verification, plan, owned-Tenant count, allowed types, regions, limits, and recoverable commercial/policy blockers. Commercial blockers are identified separately from security or authorization errors.

### Workspace resources

- `GET /tenant/workspaces`
- `POST /tenant/workspaces`
- `GET /tenant/workspaces/{workspaceId}`
- `PATCH /tenant/workspaces/{workspaceId}`
- `GET /tenant/workspaces/{workspaceId}/bindings`
- `POST /tenant/workspaces/{workspaceId}/brand-bindings`
- `DELETE /tenant/workspaces/{workspaceId}/brand-bindings/{bindingId}`
- `POST /tenant/workspaces/{workspaceId}/department-bindings`
- `POST /tenant/workspaces/{workspaceId}/group-bindings`
- `POST /tenant/workspaces/{workspaceId}/activity-bindings`
- `POST /tenant/workspaces/{workspaceId}/resource-grants`
- `POST /tenant/workspaces/{workspaceId}/archive`
- `POST /tenant/workspaces/{workspaceId}/deletion-runs/preview`
- `POST /tenant/workspaces/{workspaceId}/deletion-runs`
- `GET /tenant/workspaces/{workspaceId}/changes`
- `GET /tenant/workspaces/{workspaceId}/revisions`

Every Workspace request is scoped to one owning Tenant. Brand/Department/Group/Activity bindings validate same-Tenant ownership, registered relationship type, parent policy, version, and conflict rules. Bindings do not grant access by themselves.

Multi-Brand Workspace creation requires explicit Tenant policy and exact Brand bindings. Sandbox Workspaces cannot authorize production execution. Workspace deletion is asynchronous and requires dependency-disposition preview, approval where applicable, idempotency, audit, and same-cycle readback.

## 10. Data governance and portability

### Classification, purpose, residency, and retention

- `GET /tenant/data-governance/classifications`
- `POST /tenant/data-governance/classification-assignments`
- `GET /tenant/data-governance/purposes`
- `POST /tenant/data-governance/purpose-policies`
- `GET /tenant/data-governance/residency-policies`
- `POST /tenant/data-governance/residency-policies`
- `GET /tenant/data-governance/retention-profiles`
- `POST /tenant/data-governance/retention-profiles`
- `GET /tenant/users/me/data-use-preferences`
- `PATCH /tenant/users/me/data-use-preferences`

Classification-assignment and policy mutations require object-level authority, version preconditions, bounded schemas, idempotency where retryable, audit, governance-epoch invalidation, and same-cycle readback. A preference can narrow or disclose a choice but cannot authorize a prohibited use.

### Legal hold and privacy requests

- `POST /tenant/legal-holds`
- `GET /tenant/legal-holds/{holdId}`
- `POST /tenant/legal-holds/{holdId}/release`
- `POST /tenant/data-subject-requests`
- `GET /tenant/data-subject-requests/{requestId}`
- `GET /tenant/data-subject-requests/{requestId}/items`

Legal-hold creation/release requires exact scoped authority, reason, version, audit, and readback. A hold prevents specified deletion or mutation but never grants read authority. Data-subject requests support access, export, correction, restriction, erasure, objection, and consent withdrawal with verified identity and per-item disposition evidence.

### Data-use decisions, model policy, and derived-data disposition

- `POST /tenant/data-use-decisions/preview`
- `GET /tenant/data-use-decisions/{decisionId}`
- `POST /tenant/derived-data-disposition-runs/preview`
- `POST /tenant/derived-data-disposition-runs`
- `GET /tenant/derived-data-disposition-runs/{runId}`
- `GET /tenant/model-data-use-policies`
- `POST /tenant/model-data-use-policies`
- `GET /tenant/cross-tenant-learning-policy`
- `PATCH /tenant/cross-tenant-learning-policy`

Data-use preview evaluates access authority plus classification, registered purpose, lawful basis/consent, residency/transfer, retention/legal hold, provider/model compatibility, audience, destination, and the most restrictive applicable rule. It performs no provider call, model execution, transfer, deletion, or external write.

Derived-data preview returns discovered primary/derived objects and proposed delete, rebuild, invalidate, retract, anonymize, aggregate, hold, or minimal-tombstone actions. Apply requires a current preview checksum, exact authority, idempotency key, legal-hold revalidation, approvals where applicable, transaction/compensation evidence, and same-cycle readback.

Raw cross-Tenant content learning is forbidden. Cross-Tenant aggregate-learning policy may only narrow participation within Platform privacy, cohort, contribution, residency, re-identification, provenance, quality, and fairness bounds.

### Export and import

- `POST /tenant/export-runs`
- `GET /tenant/export-runs/{runId}`
- `POST /tenant/import-runs/preview`
- `POST /tenant/import-runs`

Export and import payloads are checksummed, versioned, bounded, and no-secret. Export eligibility is purpose, audience, destination, residency/transfer, retention, legal-hold, and object-authority constrained. Erasure and retention execution require exact scope, legal-hold evaluation, approval, lineage propagation, and same-cycle readback.

## 11. Commercial and FinOps

### Billing models, collection modes, and user-configurable profiles

- `GET /tenant/billing/models`
- `GET /tenant/billing/collection-modes`
- `GET /tenant/billing/profile-templates`
- `GET /tenant/billing/profile-templates/{templateId}`
- `GET /tenant/billing/profiles`
- `POST /tenant/billing/profiles`
- `GET /tenant/billing/profiles/{profileId}`
- `PATCH /tenant/billing/profiles/{profileId}`
- `POST /tenant/billing/profiles/{profileId}/preview`
- `POST /tenant/billing/profiles/{profileId}/publish`
- `POST /tenant/billing/profile-selections`
- `DELETE /tenant/billing/profile-selections/{selectionId}`
- `GET /tenant/billing/profile-selections/effective`

Profile discovery returns only models, modes, currencies/credit units, meter bundles, limits, fields, and options permitted by the signed principal's billing account, contract, subscription, Tenant policy, delegated scope, standing, and template version.

Profile preview returns the effective billing model, collection mode, meters, units, included quantities, budgets, quotas, overage, price/rating references, alerts, approvals, conflicts, commercial-epoch impact, and up to three recovery actions. It performs no reservation, charge, invoice, payment collection, provider call, credential read, or external write.

Profile mutation requires a current template/version, field-level customization allowlist, typed bounded values, exact object authority, idempotency, approval where required, audit, commercial-epoch invalidation, and same-cycle readback. Users cannot edit price, tax, FX, ledger, billable owner, credit limit, or non-customizable contract fields.

### Meter and unit catalog

- `GET /tenant/usage/meters`
- `GET /tenant/usage/meters/{meterKey}`
- `GET /tenant/usage/meters/{meterKey}/versions`
- `GET /tenant/usage/units`
- `GET /tenant/usage/aggregation-modes`
- `GET /tenant/usage/summary`
- `GET /tenant/usage/events`
- `GET /tenant/usage/billable-records`
- `GET /tenant/usage/composite-meters/{meterKey}/components`

Catalog responses expose registered definitions, versions, canonical units, aggregation, reservability, billability, verification, late-event/correction, pricing eligibility, and safe examples. They do not expose another Tenant's usage or customer-specific hidden price terms.

Usage-event writes are governed internal ingestion surfaces, not arbitrary tenant-client endpoints. Events require an authorized source, deduplication key, registered meter/version/unit, scaled integer quantity, evidence checksum, and exact Tenant/account/operation/manifest context.

### Entitlement, estimate, and reservation

- `GET /tenant/commercial-entitlements`
- `POST /tenant/commercial-entitlement-decisions/preview`
- `POST /tenant/runtime-cost-estimates`
- `GET /tenant/runtime-cost-estimates/{estimateId}`
- `POST /tenant/runtime-cost-reservations`
- `GET /tenant/runtime-cost-reservations/{reservationId}`
- `POST /tenant/runtime-cost-reservations/{reservationId}/extend`
- `POST /tenant/runtime-cost-reservations/{reservationId}/release`

Estimate returns raw, normalized, included, and billable quantities; expected and maximum customer charge; expected internal/provider cost; tax/discount; billing model; collection mode; currency or credit unit; meter/unit/rating/price versions; confidence; checksum; and expiry.

A reservation binds one exact manifest, operation, billable owner, billing account/profile/model, settlement asset type, meter lines, amount/units, budget/quota/standing policy versions, commercial epoch, expiry, and idempotency checksum. Reservation creation is atomic and fails when available budget, quota, balance, included units, or postpaid liability capacity is insufficient.

### Settlement, statements, invoices, disputes, and attribution

- `GET /tenant/runtime-cost-settlements/{settlementId}`
- `GET /tenant/commercial-statements`
- `GET /tenant/commercial-statements/{statementId}`
- `GET /tenant/invoices`
- `GET /tenant/invoices/{invoiceId}`
- `GET /tenant/cost-attribution`
- `POST /tenant/usage-disputes`
- `GET /tenant/usage-disputes/{disputeId}`
- `GET /tenant/refund-adjustment-runs/{runId}`

Settlement and ledger posting are governed internal execution, not arbitrary tenant-client writes. Refunds, adjustments, disputes, and chargebacks require exact source transactions, stable reason codes, object authority, approvals, evidence, idempotency, compensating entries, and readback.

Credits, money, and usage units remain separate assets. A credits reservation cannot be settled with money and a monetary reservation cannot be settled with credits without an explicit registered conversion contract and quote/version.

## 12. Model governance and evaluation

### Task, capability, candidate, and selection surfaces

- `GET /tenant/model-task-classes`
- `GET /tenant/model-task-classes/{taskClassKey}`
- `GET /tenant/model-capabilities`
- `GET /tenant/model-capability-profiles`
- `GET /tenant/model-candidates`
- `POST /tenant/model-selection-decisions/preview`
- `GET /tenant/model-selection-decisions/{decisionId}`
- `GET /tenant/model-selection-decisions/{decisionId}/explanation`
- `GET /tenant/model-selection-decisions/{decisionId}/candidates`
- `GET /tenant/model-selection-profiles`

Candidate discovery requires a registered task/capability contract and exact Tenant/context/operation. It returns only candidates visible and eligible for safe discovery; it never exposes credentials, hidden provider contract terms, another Tenant's preferences, or unrestricted internal evaluation payloads.

Model-selection preview evaluates lifecycle, capability/task, entitlement/authority, data use, provider retention/training/deletion, region/residency/transfer, risk/safety, tools, output contract, context/output limits, evaluation, readiness, incidents/deprecation, and provisional commercial eligibility before ranking.

Preview returns:

- exact candidate identities and versions;
- hard-gate allow/block results and policy sources;
- evaluation/scorecard/readiness versions, freshness, and confidence;
- optimization profile, metrics, weights, ranks, and tie-break evidence;
- selected candidate and independently eligible fallback set;
- provisional customer charge/provider cost and reservation requirement;
- exclusions with stable blocking codes;
- model-governance epoch, expiry, checksum, and up to three recovery actions.

Preview performs no provider/model call, credential read, evaluation execution, commercial reservation, invoice/payment action, lifecycle mutation, or external write.

### User and delegated preferences

- `GET /tenant/users/me/model-preferences`
- `PATCH /tenant/users/me/model-preferences`
- `POST /tenant/users/me/model-preferences/reset`
- `GET /tenant/users/me/model-preferences/changes`
- `GET /tenant/users/me/model-preferences/revisions`

The preference schema is template/field allowlisted. When permitted, it may select an eligible optimization profile, preferred eligible provider/model, local-only/privacy-first behavior, lower maximum cost/latency, fallback disabled, or a low-risk eligible model pin.

Preference mutation cannot submit raw unregistered model IDs/endpoints, lower quality/safety/data/region/evaluation/readiness floors, enable prohibited retention/training, change credentials, bypass commercial estimate/reservation, or create executable ranking formulas.

### Admin model and provider governance

- `GET /admin/model-providers`
- `GET /admin/model-provider-endpoints`
- `GET /admin/model-versions`
- `GET /admin/model-inference-profiles`
- `GET /admin/model-capability-profiles`
- `GET /admin/model-context-policies`
- `GET /admin/model-optimization-profiles`
- `GET /admin/model-compatibility-certifications`
- `GET /admin/model-evaluation-suites`
- `POST /admin/model-evaluation-runs`
- `GET /admin/model-evaluation-runs/{runId}`
- `GET /admin/model-evaluation-runs/{runId}/results`
- `GET /admin/model-quality-scorecards`
- `GET /admin/model-readiness`
- `GET /admin/model-drift-events`
- `POST /admin/model-deprecation-runs/preview`
- `POST /admin/model-deprecation-runs`
- `GET /admin/model-deprecation-runs/{runId}`
- `POST /admin/model-incident-restrictions`
- `POST /admin/model-incident-restrictions/{restrictionId}/release`

Evaluation and readiness mutations require exact candidate/version/context, bounded schemas, dataset/provenance authority, idempotency, required approvals and separation of duties, audit, epoch invalidation, and same-cycle readback.

Provider adapters are allowlisted backend implementations. Governance endpoints may bind registered adapter keys and no-secret endpoint/deployment profiles but cannot store arbitrary executable code, URLs, headers, or credential values.

### Commercial and manifest integration

The selected candidate and every approved fallback candidate require candidate-specific cost estimate/reservation evidence under DFR-004. One candidate's reservation cannot be silently reused by another.

The Effective Runtime Manifest binds the model-selection decision, task/capability versions, exact provider endpoint/model/inference profile, data/region policy, evaluation/scorecard, readiness, optimization profile, exclusions, fallback set, commercial estimate/reservation, model-governance epoch, and expiry.

Before provider dispatch, runtime revalidates lifecycle, incident/revocation, evaluation freshness, readiness, data/region, entitlement, reservation, fallback eligibility, expiry, and governance epoch.

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
DATA_CLASSIFICATION_MISSING
PROCESSING_PURPOSE_MISSING
PROCESSING_PURPOSE_NOT_ALLOWED
LAWFUL_BASIS_MISSING
CONSENT_REQUIRED
CONSENT_REVOKED
RESIDENCY_NOT_ALLOWED
CROSS_BORDER_TRANSFER_NOT_ALLOWED
PROVIDER_DATA_USE_INCOMPATIBLE
MODEL_DATA_USE_NOT_ALLOWED
RETENTION_POLICY_MISSING
LEGAL_HOLD_CONFLICT
DATA_SUBJECT_RESTRICTION_ACTIVE
DERIVED_DATA_DISPOSITION_REQUIRED
CROSS_TENANT_RAW_DATA_FORBIDDEN
CROSS_TENANT_COHORT_TOO_SMALL
DATA_GOVERNANCE_VERSION_CHANGED
BILLING_MODEL_MISSING
BILLING_MODEL_AMBIGUOUS
BILLING_MODEL_NOT_ALLOWED
COLLECTION_MODE_NOT_ALLOWED
BILLING_PROFILE_MISSING
BILLING_PROFILE_AMBIGUOUS
BILLING_PROFILE_FIELD_NOT_CUSTOMIZABLE
BILLING_OWNER_MISSING
BILLING_OWNER_AMBIGUOUS
BILLING_ACCOUNT_NOT_ACTIVE
COMMERCIAL_ENTITLEMENT_MISSING
COMMERCIAL_ENTITLEMENT_DENIED
METER_NOT_REGISTERED
METER_VERSION_MISSING
UNIT_NOT_REGISTERED
UNIT_NOT_ALLOWED_FOR_METER
METER_QUANTITY_INVALID
METER_EVENT_DUPLICATE
METER_SOURCE_NOT_AUTHORIZED
METER_EVIDENCE_MISSING
METER_EVENT_TOO_LATE
COMPOSITE_METER_COMPONENT_MISSING
OUTCOME_NOT_VERIFIED
PRICE_BOOK_MISSING
PRICE_BOOK_VERSION_STALE
RATING_MODEL_NOT_ALLOWED
CURRENCY_NOT_SUPPORTED
FX_QUOTE_REQUIRED
FX_QUOTE_EXPIRED
CREDIT_CURRENCY_CONVERSION_NOT_ALLOWED
COST_ESTIMATE_EXPIRED
COST_ESTIMATE_STALE
RESERVATION_REQUIRED
RESERVATION_EXPIRED
RESERVATION_INSUFFICIENT
CREDIT_BALANCE_INSUFFICIENT
MONETARY_BALANCE_INSUFFICIENT
INVOICE_CREDIT_LIMIT_EXCEEDED
BUDGET_EXCEEDED
QUOTA_EXCEEDED
OVERAGE_NOT_ALLOWED
COMMERCIAL_APPROVAL_REQUIRED
COMMERCIAL_ACCOUNT_PAST_DUE
IDEMPOTENCY_CONFLICT
SETTLEMENT_ASSET_TYPE_MISMATCH
SETTLEMENT_EVIDENCE_MISSING
SETTLEMENT_EXCEEDS_AUTHORIZED_AMOUNT
REFUND_EXCEEDS_SETTLED_AMOUNT
COMMERCIAL_EPOCH_CHANGED
EFFECTIVE_RUNTIME_BLOCKED
```

## 12. Contract compatibility

Implementation is additive. Existing policy, grant, activation, connection, and execution routes remain unchanged until family-by-family cutover. New response fields are optional until clients are certified. Deprecated bridge fields require a documented migration and removal window.
