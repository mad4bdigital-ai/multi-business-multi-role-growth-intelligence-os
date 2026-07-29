# Resource API coverage governance

Every user-visible platform feature must resolve to a logical resource descriptor before merge. A descriptor binds source tables, read models, identity, Admin/Tenant scope, safe fields, search policy, lifecycle behavior, permissions, changes, revisions, and readback.

The blocking gate is `platform_resource_api_coverage_policy_v1`. New tables, views, Express routes, or tool exports without descriptor and OpenAPI coverage are merge-blocking. Existing legacy debt remains visible through bounded findings but may not be expanded.

Tenant resource scope is derived from signed JWT, active membership, workspace authority, and applicable resource grants. Client-supplied tenant or user overrides are never trusted. Resource SQL is descriptor-owned; unrestricted table, field, projection, or ordering input is forbidden.

Required operation classes are `list`, `get`, `search`, `permissions`, `changes`, `revisions`, and `readback`. Mutations additionally require validation, authorization, lifecycle semantics, audit, and same-cycle readback. Hard purge is blocked unless separately authorized by retention and capability policy.

Initial governed resource adapters are Sessions, Executions, Workspace Assets, Approval Holds, and Resource API Governance. Session transcript reads return previews and archive pointers only; full content remains behind a future governed Drive transcript adapter.

## Enforced layer boundaries

Resource API requests flow through `routes -> api/controller -> application -> domain`, with persistence and existing runtime services supplied through infrastructure composition. Routes own registration and transport authentication only. Controllers map HTTP contracts. Application services coordinate membership, authorization, lifecycle, audit, and same-cycle readback. Domain modules own descriptors, capabilities, pagination, and typed policy errors. SQL is restricted to infrastructure repositories.

The blocking architecture test rejects SQL or database imports above infrastructure, direct route imports of audit/summary services, and framework dependencies in application/domain modules.

## Resource surface policy authority

`platform_resource_surface_policy_registry` is the explicit authority for deciding whether each table, view, and enabled tool is resource-facing or internal. A new relation or tool is merge-blocking unless the same change provides logical Resource API coverage or an active surface-policy decision with rationale.

Descriptor, operation, archive, and version requirements are evaluated from the declared policy. Internal registries, logs, ledgers, tools, and read models use explicit `not_applicable` requirement states; they are not converted into artificial public resources and are not hidden by broad exemptions. Resource-facing surfaces must resolve to matching resource descriptors or operation bindings. Migration 1025 backfills the current inventory and resolves lifecycle records classified as `runtime_unclassified` without mutating business data.

Recovery and repair snapshots classified through surface policy or lifecycle metadata are not runtime resources and are excluded only from the scoped-table primary-key finding. Migration 1026 aligns archive operation states with the resource manifest. A persisted audit resolves prior open coverage findings only after a new `complete` run with zero findings; any run that still reports debt or gaps preserves historical open findings.

## Surface callability evidence

Registry presence is not callability authority. Every registered Tenant or Admin tool family must declare a manifest-driven callability contract that resolves the contract source, unique operation keys, descriptor, callable handler, handler invocation, implementation export, required safety markers, and an explicit Admin preview fallback while Tenant execution remains disabled. Missing or duplicate contract keys, missing handlers, missing preview fallbacks, or missing no-provider/no-secret markers are blocking findings in Resource API coverage and Release Readiness.

The Admin-only `tenant_connection_operation_preview` is the reference pattern for disabled Tenant connection operations. It may read safe connection metadata, adapter certification, and readback authority, but it must not read credential payloads, call providers, perform writes, change Tenant authority, create exports, or return secrets. Provider and internal mutation operations remain preview-blocked until a separate execution contract is implemented and approved.

## Repository reconciliation authority

Repository reconciliation must run through `repo.pr.reconcile_and_finalize` and `repository_reconciliation_orchestrator`, with exact default-branch and work-branch SHAs, overlap classification, an exclusive repository operation lease, action-specific capability envelopes, typed confirmation, and same-cycle ref/tree/ancestry readback. The Admin orchestrator surface is dry-run only. Low-level multi-parent merge creation must fail before provider credential resolution unless the active orchestrator-held lease, matching operation/run identity, recipe key, and resource fingerprint are present. Force push and direct protected-branch writes remain forbidden.
