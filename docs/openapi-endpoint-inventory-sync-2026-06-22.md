# OpenAPI Endpoint Inventory Synchronization

## Status

Implemented as an inventory-only synchronization path. Callable promotion remains separate and governed.

## Purpose

Keep committed OpenAPI operations represented in the SQL `endpoints` registry without turning discovery metadata into runtime authority.

## Runtime flow

1. Read `http-generic-api/openapi.yaml`.
2. Resolve local YAML references inside the OpenAPI root.
3. Reject remote references, path traversal, malformed paths, missing operation IDs, and duplicate operation IDs.
4. Build a stable operation contract, SHA-256, and source fingerprint.
5. Compare desired inventory rows with existing rows owned by `openapi_endpoint_inventory_sync`.
6. In dry-run mode, return inserts, updates, unchanged rows, and deprecations without writing.
7. In apply mode, require typed confirmation and a ready `platform_orchestration` capability envelope for manual execution.
8. Acquire a MySQL advisory lock, apply only changed inventory metadata in one transaction, perform same-cycle readback, and record run evidence.
9. Deprecate operations removed from OpenAPI instead of deleting registry history.

## Safety boundaries

Inventory rows are written with:

- `status=inventory_only`
- `execution_readiness=pending_governance_review`
- `runtime_binding_profile=inventory_only_no_dispatch`
- `runtime_callable=false` on the parent action
- `client_allowed=false`
- `team_allowed=false`

The synchronization does not write:

- `admin_platform_endpoint_tools`
- `tenant_platform_endpoint_tools`
- `platform_endpoint_tool_exports`
- provider systems
- credential payloads
- external destinations

OpenAPI extensions such as `x-registry-exposure` and `x-registry-tool-key` are evidence for a later curated promotion process only.

## Admin surfaces

- `GET /admin/openapi-registry-sync/status`
- `POST /admin/openapi-registry-sync`

Manual apply requires:

- `mode=apply`
- `confirm=SYNC_OPENAPI_ENDPOINT_INVENTORY`
- a ready capability envelope for app key `platform_orchestration`

Startup synchronization is controlled by `platform_runtime_config.config_key=openapi_endpoint_inventory_sync` and may be stopped with `OPENAPI_ENDPOINT_INVENTORY_SYNC_DISABLED=true`.

## Dynamic Container curated tools

Migration `1021_sprint69_openapi_endpoint_inventory_sync.sql` registers only the approved Admin tools:

- `openapi_endpoint_inventory_status`
- `openapi_endpoint_inventory_sync`
- `dynamic_container_resolution_preview`
- `dynamic_container_projection_dry_run`
- `dynamic_container_shadow_summary`
- `dynamic_container_rollout_readiness`

Resolution preview forces `mode=preview`. Projection preview uses a dedicated route that cannot apply projection changes.

## Rollback and recovery

- Set `OPENAPI_ENDPOINT_INVENTORY_SYNC_DISABLED=true` for an immediate process-level stop.
- Set runtime config `enabled=false` or `startup_apply=false` through governed configuration change.
- Disable individual Admin tool rows without removing inventory history.
- Inventory rows remain non-callable; rollback does not require deleting endpoint records.
- Do not delete synchronization run evidence.

## Validation

Required gates include:

- focused unit and regression test through `test-manifest.mjs`
- OpenAPI split governance and regeneration parity
- migration preflight with zero risk findings
- syntax, architecture, canonical generation, and full CI
- post-deployment readback proving inventory count parity and zero callable inventory rows
