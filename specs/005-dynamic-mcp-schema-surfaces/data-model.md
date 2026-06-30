# Data Model

## Existing authority tables to reuse

| Concern | Existing table/surface | Role |
|---|---|---|
| Admin projection | `admin_platform_endpoint_tools` | Admin catalog |
| Tenant projection | `tenant_platform_endpoint_tools` | Tenant catalog |
| Endpoint exports | `platform_endpoint_tool_exports` | Endpoint-to-tool projection |
| Dispatch | `platform_tool_dispatch_bindings` | Callable binding authority |
| Contract surfaces | `platform_contract_surfaces` | Topology/version metadata |
| Aliases | `platform_contract_aliases` | Compatibility |
| Relationships | `platform_contract_relationships` | Lineage |
| Registry discovery | `registry_surfaces_catalog` | Surface catalog |
| Descriptor sources | `system_layer_tool_descriptor_source_registry` | System MCP sources |
| Actions/endpoints | `actions`, `endpoints` | Runtime identity/schema |
| Policies | `execution_policies` | Execution constraints |
| Connections | `user_app_connections` | Connection metadata |
| Credential pointers | `credential_bindings` | Scoped secret refs |
| Intake | `credential_intake_sessions` | Secure intake state |

Extend these before creating parallel registries.

## Required logical records

### Tool contract version

`tool_key`, `schema_version`, `input_schema_json`, `output_schema_json`, `schema_hash_sha256`, `compatibility_class`, `status`, timestamps. Versions are append-only.

### Dynamic surface binding

`tool_key`, `surface_key`, `principal_type`, `tenant_scope_mode`, `visibility_policy_key`, status/effective dates.

### Availability projection

`tool_key`, `surface_key`, `lifecycle_state`, `dispatch_allowed`, blocking reasons, certification ID, observed/expiry timestamps.

### Signed surface snapshot

Add only if existing contract/deployment tables cannot satisfy: snapshot ID, surface key, registry version, canonical SHA, manifest JSON, hash, signing key ID/signature, status, generated/expiry/published timestamps.

### Deployment ledger

Prefer existing runtime verification/parity tables; otherwise add deployment ID, snapshot ID, environment, gateway version, schema hashes, status, smoke/readback, deployed timestamp.

## Canonical Git registry

`canonicals/openapi/custom-gpt-surfaces.yaml` defines stable topology. Fixed operations declare `x-mad4b-surfaces` in `openapi.yaml`.

## Consistency

- Discovery: bounded cache with registry version/ETag.
- Execution: current SQL authority check.
- Edge: signed snapshot consistency.
- Mutation on stale snapshot: blocked.
- Read-only stale grace: optional and observable.

## Migration constraints

Additive first, bounded backfill, checksum/ledger/readback, no destructive changes.
