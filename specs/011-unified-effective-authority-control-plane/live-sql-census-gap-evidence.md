# Live SQL Census Coverage and Gap Evidence

## Purpose

This record captures the governed live SQL census evidence available for task T002, "Map authority-owning tables and views from live SQL census."

The evidence is intentionally bounded. It records what the governed census returned and what it did not return. Absence from this census is not evidence that a physical table or view is absent from the live database.

## Observation

- Observation date: 2026-07-29
- Governed source: `getPlatformDataSourceCensus`
- Runtime authority: `sql`
- Census mode: `sql`
- Sheets role: `async_mirror_and_recovery`
- Sheets mirror configured: `true`
- Tables returned: 18
- Seeded tables: 18
- Empty tables: 0
- Views returned: 0

The census surface reports registry-mapped tables, row counts, last-write timestamps where available, and mirror names. It does not report `information_schema` table types, columns, keys, view definitions, dependencies, ownership classifications, or revision semantics.

## Tables returned by the governed census

| SQL table | Rows | Last write observed | Registry surface |
|---|---:|---|---|
| `brands` | 9 | 2026-07-05 06:58:43 | Brand Registry |
| `brand_core` | 149 | 2026-07-06 23:34:40 | Brand Core Registry |
| `actions` | 39 | 2026-07-28 19:08:47 | Actions Registry |
| `endpoints` | 4,695 | 2026-07-28 10:32:46 | API Actions Endpoint Registry |
| `execution_policies` | 1,258 | 2026-07-24 03:54:16 | Execution Policy Registry |
| `hosting_accounts` | 6 | 2026-05-13 08:24:10 | Hosting Account Registry |
| `site_runtime_inventory` | 45 | 2026-05-09 04:20:43 | Site Runtime Inventory Registry |
| `site_settings_inventory` | 8 | 2026-05-04 09:34:02 | Site Settings Inventory Registry |
| `plugins` | 5 | 2026-05-04 17:02:26 | Plugin Inventory Registry |
| `business_activity_types` | 217 | 2026-07-11 04:40:36 | Business Activity Type Registry |
| `business_type_profiles` | 25 | 2026-05-16 04:22:45 | Business Type Knowledge Profiles |
| `brand_paths` | 8 | 2026-06-08 17:03:07 | Brand Path Resolver |
| `task_routes` | 215 | 2026-06-08 23:30:21 | Task Routes |
| `workflows` | 257 | 2026-06-10 22:04:52 | Workflow Registry |
| `registry_surfaces_catalog` | 22 | 2026-06-15 01:13:22 | Registry Surfaces Catalog |
| `validation_repair` | 42 | 2026-05-16 04:25:31 | Validation & Repair Registry |
| `json_assets` | 16,009 | 2026-07-29 06:57:51 | JSON Asset Registry |
| `execution_log` | 40,890 | not reported | Execution Log Unified |

## Authority relevance of returned tables

The returned census confirms live SQL-backed registries that can contribute inputs to authority decisions, including actions, endpoints, execution policies, business activity types, routes, workflows, runtime inventory, validation records, and execution evidence.

The census does not establish that any returned table is the sole owner of actor, subject, tenant, workspace, resource, capability, connection, endpoint, certification, approval, delegation, or decision authority. Ownership must be established from schema, constraints, registered runtime resolution paths, and current code-level invariants.

## UEACP logical entities not covered by this census output

The UEACP logical data model identifies the following authority-relevant entities. They were not returned by this governed census surface:

### Principals and subject scope

- `principals`
- `principal_role_assignments`
- `principal_authentication_evidence`
- `scope_grants`
- `delegation_contexts`
- `agency_tenant_assignments`
- existing authoritative user, service-principal, membership, and workspace-role registries

### Resource graph

- `resource_nodes`
- `resource_edges`
- `resource_access_grants`
- `resource_restrictions`

### Capability and policy

- semantic capability registries
- capability/provider bindings
- `capability_operation_policies`
- `capability_risk_classes`
- `authority_policy_versions`

### Connections and runtime evidence

- user/app connections
- workspace/app links
- action grants
- endpoint aliases
- runtime certification registry
- `connector_readiness_snapshots`

### Decisions, projections, invalidation, and drift

- `effective_authority_decisions`
- `authority_decision_evidence`
- `authority_projection_snapshots`
- `authority_projection_items`
- `authority_drift_findings`
- `authority_invalidation_events`

This list represents expected logical ownership surfaces. It does not assert that each logical entity requires a new physical table or that the physical names match the logical names.

## Views expected by the UEACP logical model

The logical model identifies these authority aggregation views:

- `v_effective_authority_inputs`
- `v_authorized_resource_candidates`
- `v_connector_readiness_dimensions`
- `v_authority_projection_consistency`

No views were returned by the governed census surface. This means view coverage is unknown, not absent.

## Gaps preventing T002 closure

T002 cannot be closed from the current census because the evidence does not include:

1. A governed read-only `information_schema.tables` census for the live schema, including `TABLE_SCHEMA`, `TABLE_NAME`, and `TABLE_TYPE`.
2. A governed read-only `information_schema.views` census, including view names and normalized definition hashes or bounded definitions.
3. Column, key, index, foreign-key, and revision/version evidence for authority-owning tables.
4. A classification of each table and view as authoritative source, derived projection, compatibility surface, evidence ledger, mirror, or deprecated path.
5. Dependency mapping from views to source tables.
6. Mapping from runtime resolvers and registered actions to the owning SQL tables or views.
7. Confirmation that credential payloads, tokens, keys, and raw provider authentication bodies are excluded from authority evidence surfaces.
8. Same-cycle readback proving the census was taken from the live runtime schema rather than a stale clone or registry-only subset.

## Closure criteria

T002 may be marked complete only when a governed, read-only live SQL catalog census provides:

- all relevant base tables and views;
- table/view type and schema identity;
- authority ownership classification;
- source-to-projection dependencies;
- revision/version support status;
- reuse-versus-additive-migration decisions;
- no-secret evidence boundaries;
- observation timestamp and source identity;
- explicit unresolved gaps, if any.

Until that evidence exists, T002 remains open and its completion evidence remains partial.

## Safety statement

This census review performed no SQL mutation, migration execution, provider call, credential read, scheduler activation, evidence-persistence activation, runtime enforcement, deployment, merge, production verification, or audit execution.
