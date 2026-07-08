# Asset Publication, Installation, and Tenant Customization

## Objective

Platform administrators create agents, workflows, skills, and templates once, publish them deliberately, and allow tenants to adopt and specialize them without losing platform governance or upgrade safety.

## Publication states

| State | Tenant visibility | Tenant action |
|---|---|---|
| `private` | none | none |
| `platform_internal` | none | none |
| `tenant_available` | selected audience | discover and install |
| `tenant_default` | selected audience | auto-provision binding according to policy |
| `mandatory_policy` | applicable tenants | enforced constraint; not forkable as an escape |
| `deprecated` | existing installations only | migrate or remain pinned until deadline |
| `retired` | historical/reference only | no new install or execution |

Publication is a policy edge, not containment inheritance.

## Tenant lifecycle

```text
discover
  -> evaluate compatibility
  -> install
  -> bind to workspace/activity/brand
  -> configure bounded overrides
  -> optionally extend
  -> optionally fork
  -> activate approved version
  -> upgrade, pin, deprecate, or uninstall
```

## Customization modes

### Install

The installation references an exact platform version. Canonical payload stays platform-owned.

### Override

Sparse changes to declared settings or JSON pointers. Every override must pass:

1. customization policy allowlist;
2. value schema;
3. platform/tenant bounds;
4. authority check;
5. compatibility validation.

Overrides can restrict behavior but cannot widen authority.

### Extend

The tenant adds steps only at declared extension points. Extension validation checks step type, capabilities, approval/verification preservation, data contracts, compensation, and adapter compatibility.

### Governed fork

A fork creates a tenant-owned definition/version with immutable lineage:

- origin asset/version and content hash;
- fork creator and reason;
- compatibility baseline;
- inherited mandatory constraints.

The fork receives no credentials, grants, approval holds, or runtime certification automatically.

### Tenant-authored asset

Tenants may create agents/workflows from scratch when tenant policy permits. They use the same compile, validation, approval, certification, activation, audit, and readback pipeline.

## Upgrade policies

### `auto_upgrade`

Allowed only when semantic compatibility passes, no permission/credential/approval expansion appears, migration is non-destructive, tenant policy allows it, and a rollback target remains available.

### `approval_required`

The proposal shows definition diff, settings/extension impact, new capabilities/providers, policy changes, migration requirements, and compatibility blockers. Approval binds to proposal and version hashes.

### `version_pinned`

No automatic movement. A security retirement deadline may block future execution but never silently rewrites tenant content.

## Fork synchronization

Forks never auto-upgrade. The platform produces a three-way report comparing:

```text
origin version at fork
vs latest platform version
vs current tenant fork
```

Results include:

- `clean_rebase_candidate`
- `manual_merge_required`
- `policy_conflict`
- `capability_conflict`
- `schema_conflict`
- `security_upgrade_required`
- `no_longer_supported`

## Publication audience

Audience selectors may target all eligible tenants, tenant allowlists, plan/capability tier, region/data-residency class, business activity type, workspace type, brand maturity, and connector readiness.

Audience evaluation never discloses another tenant's identity or configuration.

## Uninstall and retirement

Uninstall removes future bindings but preserves historical runs, audit/readback evidence, fork lineage, and retention-required snapshots. A version referenced by retained runs cannot be deleted.
