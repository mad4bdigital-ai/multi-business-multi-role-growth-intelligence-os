# ADR: Keep Authority, Container, Asset, Workflow, and Settings Graphs Independent

- Status: Accepted
- Date: 2026-07-24
- Scope: Spec 006 Platform Dynamic Workflow Runtime

## Context

Spec 006 combines five related but non-identical graph-shaped domains: Authority Scope, Container, Asset, Workflow, and Settings. The Dynamic Container projection creates tenant-owned platform-root anchors, while `authority_scope_registry` defines a tenant-null global `platform:root` scope. Treating these as the same graph would convert classification or containment evidence into authority.

## Decision

The five graphs remain independent and connect only through explicit typed references.

- Authority Scope never derives grants from display names, execution class, or rollout mode.
- Container relationships never imply authority without a separate assignment or binding.
- Asset publication or installation never implies container membership or runtime authority.
- Workflow compilation binds immutable asset versions and settings snapshots; it owns neither graph.
- Settings resolution records lineage and hashes but grants no access to inherited scopes.
- Platform Admin Workspace and Platform Brand topology require canonical markers and explicit relationships. Names are not evidence.
- Read-only verification reports gaps but never repairs, seeds, grants, promotes, or infers topology.

## Canonical platform topology contract

```text
authority scope: platform:root
admin workspace marker: platform_admin_workspace
platform brand target key: growth_intelligence_platform
```

Verified topology requires one active platform-owner tenant, one explicitly marked Platform Admin Workspace, one tenant-null platform container for `platform:root`, workspace and brand containers, explicit platform→workspace and workspace→brand relationships, and an active `platform_owner` assignment on the global platform container.

## Security and audit consequences

Platform-principal access to a tenant authority scope requires an explicit tenant target and writes `platform_admin_tenant_authority_scope_resolved`. Audit failure is fail-closed in the default bridge. Topology verification is admin-only, audited, rate limited, read-only, and returns no credential payloads or secrets.

## Alternatives rejected

- Inferring the admin workspace from its display name.
- Reusing tenant-owned platform-root anchors as the global platform container.
- Seeding missing topology during verification.

## Consequences

Production may report `topology_remediation_required` until canonical markers and relationships are added through a separate governed migration. Existing projection, shadow comparison, canary, and global enforcement state are unchanged.
