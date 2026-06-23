# Specification

## 1. Problem

The platform has separate grant and binding models for skills, workflows, app actions, resources, connections, and policies. These models do not provide one consistent mechanism for a tenant to:

1. discover platform-base assets;
2. adopt any tenant-safe asset;
3. create an isolated editable tenant version;
4. compose permissions and configuration across workspace, brand, business activity, and role;
5. choose union or intersection composition;
6. attach tenant-owned credentials to apps/plugins/actions;
7. upgrade from later platform-base versions without losing tenant edits.

## 2. Product intent

Every authorized tenant can use the platform catalog as a base library. Adopting an asset creates a tenant-owned instance using either an overlay or fork. A tenant editor may modify only the tenant-owned instance and never the platform original.

## 3. Asset classes

The model MUST be extensible and MUST initially support:

- `agent`
- `skill`
- `policy`
- `workflow`
- `app`
- `plugin`
- `action`
- `tool`
- `logic`
- `engine`
- `knowledge_profile`
- `dashboard_component`

New classes MUST be registered rather than introduced through ad hoc tables.

## 4. Scope dimensions

An asset instance, grant, composition profile, or credential binding MAY apply to:

- tenant root;
- workspace;
- brand;
- business activity type;
- role;
- any explicit composite of these dimensions.

Tenant identity MUST come from the signed principal. Client-supplied tenant overrides are forbidden.

## 5. Ownership modes

### 5.1 Overlay

An overlay stores only tenant changes against a platform-base version. It remains upgrade-linked and can be rebased onto a newer base version after conflict review.

### 5.2 Fork

A fork stores a complete tenant-owned snapshot. It is independently versioned and does not inherit later base changes unless the tenant explicitly imports them.

### 5.3 Copy-on-write

The first tenant edit to a referenced platform asset MUST create an overlay automatically. Platform rows remain immutable.

## 6. Composition modes

### 6.1 Union

An asset is included when at least one applicable scope allows it. Configuration collections are combined unless a mandatory deny or conflict rule blocks resolution.

### 6.2 Intersection

An asset is included only when every required applicable scope allows it. Missing required scope evidence is blocking rather than silently permissive.

### 6.3 Safety floor

Neither composition mode may bypass:

- platform mandatory policy;
- tenant isolation;
- credential readiness;
- capability and resource authority;
- approval requirements;
- runtime certification;
- quotas and commercial entitlement;
- same-cycle readback requirements.

Explicit mandatory deny always wins.

## 7. Functional requirements

- **FR-001:** All active tenant-safe platform assets are discoverable through one catalog.
- **FR-002:** Platform-control-plane-only and secret-bearing assets are never tenant-adoptable.
- **FR-003:** Tenant adoption creates an isolated tenant asset instance.
- **FR-004:** Tenant users with `edit` permission can create new tenant versions.
- **FR-005:** Tenant users with `grant` permission can bind instances to workspace, brand, activity type, role, agent, or user scopes.
- **FR-006:** Composition profiles support `union` and `intersection`.
- **FR-007:** Profiles can be selected per tenant context and per asset family.
- **FR-008:** Asset resolution is deterministic, explainable, and emits source/version evidence.
- **FR-009:** Credentials are referenced by opaque connection or vault identifiers and never copied into asset content.
- **FR-010:** Apps/plugins/actions remain non-executable until tenant connection, credential, grant, certification, and policy checks pass.
- **FR-011:** Sensitive skills/actions remain approval-gated even when broadly adopted.
- **FR-012:** Tenant policies may strengthen mandatory platform policy but cannot weaken it.
- **FR-013:** Upgrade, rebase, conflict, rollback, and detach operations are versioned and audited.
- **FR-014:** Existing specialized grant tables remain authoritative until bridge parity is proven.
- **FR-015:** The system distinguishes approval-sensitive active grants from actual pending approval requests.
- **FR-016:** Catalog registration is not operational installation evidence.

## 8. Non-functional requirements

- fail closed on ambiguity;
- no raw secrets in responses, logs, overlays, or version payloads;
- bounded JSON patches and snapshots;
- deterministic checksums;
- idempotent adoption and grant operations;
- same-cycle write readback;
- cross-tenant queries blocked at repository and service layers;
- OpenAPI 3.1 contracts with stable structured errors;
- compatibility with `src/api`, `src/application`, `src/domain`, and `src/infrastructure` boundaries.

## 9. Non-goals

This specification does not authorize automatic provider writes, automatic approval of sensitive operations, copying platform credentials into tenant scope, editing platform-base records, or replacing existing runtime authorities before shadow parity.
