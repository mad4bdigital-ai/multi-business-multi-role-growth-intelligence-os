# Feature Specification: Platform Resource Identity, Relationships, and Brand Governance

**Feature key:** `020-platform-resource-identity-brand-governance`  
**Status:** implementation started; shadow-only; no migration or Production activation  
**Parent implementation dossier:** Issue #4447 Brand Core tenant operations  
**Related prerequisite:** Issue #7287 canonical operation governance for internal business mutations

## 1. Problem statement

The platform contains specialized identity, tenant, workspace, Brand, asset, connection, provider, profile, and relationship surfaces, but their identity scope and authority semantics are not yet represented through one explicit contract. Brand creation currently has tenant-derived compatibility keys, while Root Workspace topology and grants are separate layers. Without a platform identity contract, name matching can be mistaken for canonical identity, a relationship can be mistaken for ownership or authority, and identity changes can silently break projections, grants, credentials, profiles, or historical evidence.

## 2. Goals

1. Define registry-driven identity scopes for global resources, provider-native resources, tenant resources, workspace resources, content-addressed objects, and ephemeral records.
2. Keep domain-specific tables authoritative while sharing deterministic identity, identifier, alias, claim, relationship, evidence, revision, and privacy contracts.
3. Provide a Brand adapter with stable `brand_id`, identifiers, aliases, claims, verification evidence, and tenant-scoped relationships.
4. Separate identity, relationship, authority, operating profile, and workspace projection.
5. Resolve identity as `EXACT`, `PROBABLE`, `NONE`, `CONFLICT`, or `AMBIGUOUS`; fail closed on conflict and ambiguity.
6. Prevent cross-tenant enumeration and credential disclosure.
7. Provide an additive, dual-read, shadow-first migration path for existing `target_key` references.
8. Prepare a canonical operation contract consumed by REST, GPT, MCP, and other operation surfaces without changing Production authority.

## 3. Non-goals

- No God Table replacing `brands`, `workspace_registry`, `tenant_brand_links`, assets, connections, or authority registries.
- No migration apply, backfill, destructive merge, grant mutation, credential read, provider call, external send, deployment, or Production activation.
- No implementation or recommendation for Spec 015 or `014-gemini-evidence-intake-automation`.
- No automatic AI identity merge, ownership claim, or authority grant.
- No replacement of Spec 004 asset composition, Spec 006 workflow runtime, Spec 007 capability governance, or Spec 011 authority/context kernels.

## 4. Invariants

- A global identity has no tenant or workspace primary scope.
- A tenant relationship never implies authority.
- A workspace projection never becomes a canonical identity.
- Display names, routes, aliases, AI scores, and conversation context never grant authority.
- `EXACT` requires one unique fresh verified hard identifier and no conflict.
- `CONFLICT` and `AMBIGUOUS` block create, merge, claim, and dispatch.
- Authority requires principal, tenant/workspace context, grant, policy, operation descriptor, and readiness checks.
- Active resources are revision-bound; stale expected revision fails closed.
- Identity results reveal only identity-safe summaries and no owner tenant details.
- Every consequential mutation has idempotency and same-cycle readback requirements.

## 5. Functional requirements

### Identity registry

- **FR-001:** Every registered resource type declares an identity scope and canonical source authority.
- **FR-002:** Global identity uses an immutable canonical ID independent of tenant membership.
- **FR-003:** Provider-native identity is qualified by provider family and never contains credential material.
- **FR-004:** Identifiers record type, normalized value, verification state, exclusivity, freshness, and evidence reference.
- **FR-005:** Alias resolution is bounded, cycle-safe, versioned, and cannot silently change canonical ID.
- **FR-006:** Resource identity validation rejects `authority_implied=true`.

### Brand adapter

- **FR-007:** Brand identity uses immutable `brand_id`; existing `target_key` remains a compatibility alias during migration.
- **FR-008:** Brand identifiers support verified domain, provider-native ID, verified registration ID, legal ID, DNS token, name candidate, and external alias.
- **FR-009:** Brand resolver returns exactly one of `EXACT`, `PROBABLE`, `NONE`, `CONFLICT`, `AMBIGUOUS`.
- **FR-010:** Hard identifier collisions produce `CONFLICT` and never auto-merge.
- **FR-011:** Same non-hard match across multiple Brands produces `AMBIGUOUS`.
- **FR-012:** Tenant-scoped reads filter candidates before identity results are returned.

### Relationships and authority

- **FR-013:** Tenant-to-Brand relationships support typed relationship, validity window, source, claim reference, revision, and evidence reference.
- **FR-014:** `owns`, `operates`, `manages`, `represents`, `licenses`, `contains`, `delegates`, and `references` remain relationship types, not grants.
- **FR-015:** Grants and effective policy remain the only authority path; relationships may be inputs to policy but do not authorize themselves.
- **FR-016:** Root Workspace topology uses explicit `contains` relationship and closure readback without treating the operational Brand workspace as authority parent.
- **FR-017:** Agency, franchise, operator, and partner relationships cannot imply ownership or credential sharing.

### Lifecycle and operations

- **FR-018:** Create, update, archive, restore, merge, split, rebrand, alias, supersede, and identifier transfer are separate revision-bound operations.
- **FR-019:** Operation descriptors declare effect, risk, approval, idempotency, concurrency, identity-resolution, relationship-resolution, and readback contracts.
- **FR-020:** Registered operation semantics override textual risk inference; fallback inference remains conservative for unknown operations.
- **FR-021:** Known-intent `brand.create` calls the canonical Root topology service and does not require tool-catalog discovery.
- **FR-022:** Caller input cannot lower registered risk, approval, effect, or readback requirements.

### Profile, assets, and provider accounts

- **FR-023:** Global Brand Facts and scoped Operating Profiles are separate versioned resources.
- **FR-024:** Activity/profile inheritance records source versions, precedence, merge operator, conflict, and effective revision vector.
- **FR-025:** Content-addressed blob identity is separate from Asset Registration, usage rights, license, audience, and retention.
- **FR-026:** Provider-native account identity is separate from tenant connection binding, credential reference, grant, readiness, and purpose/region policy.

### Evidence and migration

- **FR-027:** Resolver decisions are immutable, no-secret, hashed, versioned, and reproducible.
- **FR-028:** Legacy `target_key` references use dual-read and alias mapping before any write cutover.
- **FR-029:** Reconciliation reports duplicate, collision, stale, ambiguous, and orphan states without destructive mutation.
- **FR-030:** Migration apply requires a separate authorization, same-cycle readback, rollback plan, and exact evidence.

## 6. Acceptance criteria

- The same verified Brand identifier submitted by two Tenants resolves to one global `brand_id` while returning tenant-scoped relationships only.
- Name-only matching returns `PROBABLE` or `AMBIGUOUS`, never `EXACT`.
- Two Brands sharing a hard identifier return `CONFLICT` and do not merge.
- A Tenant relationship can be created in shadow mode without creating a grant.
- A Root Workspace `contains` edge can be verified without changing authority semantics.
- A stale revision, invalid alias cycle, expired evidence, or ambiguous claim blocks mutation.
- A cross-tenant candidate is filtered before output and cannot be enumerated.
- The pure resolver and schema tests pass without DB, provider, credential, or external calls.
- The implementation remains additive and shadow-only until separately promoted.

## 7. Traceability

The adapter extends Spec 004 shared asset/context composition, Spec 011 dynamic multi-tenant context and deterministic resolution, Spec 011 Unified Effective Authority shadow slices, and the Brand Core dossier in Issue #4447. Operation execution remains subject to the canonical contract requested by Issue #7287.
