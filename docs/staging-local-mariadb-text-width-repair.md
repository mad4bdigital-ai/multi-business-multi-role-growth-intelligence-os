# Staging-local MariaDB text-width repair declaration

## Scope and safety boundary

This declaration covers the Staging-local Windows replay path only: Node.js 22.23.2, disposable Docker MariaDB 11.4, the `main` migration chain, and the fail-closed schema-bundle builder. It does not authorize or perform Production database access, Hostinger access, Cloudflare/provider calls, deployment, credential access, data export/import, AutoPilot, importer, or readback. The SQL bridges in this repair are additive DDL only and carry `secrets_included=false`.

The repair is intentionally source-only at this stage. Work Maps, migration inventories, manifests, and other generated outputs must be refreshed only by their registered governed writers after a fresh exact-head authorization.

## Root cause

The merged Staging repair widened the upstream `runtime_dispatch_certification_registry.certification_status` domain to `VARCHAR(256)`. The historical view `v_platform_capabilities_current` projects that value into the `runtime_status` union position, while migration 314 had a downstream `platform_plugin_capabilities.runtime_status VARCHAR(64)`. Historical certification values longer than 64 characters therefore reached the migration-314 backfill and caused MariaDB error 1406 during the confirmed Windows replay.

The same review found a broader class of declared source-domain mismatches. The old INSERT...SELECT guard skipped bounded source domains whenever it could not mark the expression as `known_exact`, which allowed a bounded `VARCHAR(256)` source to flow into a bounded `VARCHAR(64)` target. The guard now fails closed on every provable bounded source maximum greater than the target maximum, resolves alternative expressions by maximum rather than sum, and narrows simple equality/`IN` predicates to their literal domain. Unresolvable expressions remain unapproved rather than being silently treated as safe.

## Class-level repairs

| Ordered location | Compatibility repair | Reason | Safety note |
| --- | --- | --- | --- |
| `097` before `098` | `local_connector_device_routes.endpoint_url` is preserved as `TEXT`, with a generated SHA-256 uniqueness key | The source combines a 1024-character tunnel URL with a route contract that was only 512 characters | Avoids an oversized utf8mb4 unique index while preserving exact URL values |
| `149` before `150` | `remote_runtime_targets.host_label` is `VARCHAR(255)` | The source `connected_systems.display_name` is `VARCHAR(255)` | No index width change is required by this column |
| `264` before `265` | External delivery policy tables are established with `policy_key VARCHAR(255)` | Policy keys append a mode suffix to adapter keys | Parent tables and foreign-key shape are preserved; no provider dispatch is enabled |
| `310` before `311` | `platform_endpoint_tool_exports.export_key` and `tool_name` are `VARCHAR(271)` | The governed export prefix is concatenated with a 255-character endpoint key | Index byte lengths remain within MariaDB utf8mb4 limits |
| `311` after the historical binding creation | `platform_tool_dispatch_bindings.export_key` is `VARCHAR(271)` | Later endpoint dispatch writers reuse the same complete export-key domain | `binding_id` remains governed separately |
| `313` before `314` | Capability graph keys and evidence identifiers are widened to their complete 255/256-character source domains; `runtime_status` is `VARCHAR(256)` | Migration 314 projects registry/view values and prefixed identifiers into these tables | Primary and secondary index widths remain below MariaDB limits |
| `1039` after `1038` | `platform_tool_dispatch_bindings.binding_id` is `VARCHAR(293)` | The later cleanup prefix plus endpoint key requires the full declared domain | Unique binding identity is retained |
| `20260701` before the readback writer | `platform_capability_readback_contracts.capability_key` is `VARCHAR(255)` | Later virtual-tool/readback writers reuse the wider capability-key domain | Existing generated current-key contract is preserved |

The guard also recognizes bounded source domains constrained by literal `WHERE` and `IN` predicates. This removes false positives for known short endpoint-key catalogs while retaining blockers for unconstrained bounded overflows such as the runtime-status lineage.

## Static evidence target

The source-only plan is expected to report 810 migration files, 3,097 migration statements, 811 ordered files, and 3,124 ordered statements. The ordered checks must remain fail-closed with zero unresolved pre-use table/column/unique gaps, zero INSERT arity mismatches, zero missing UPDATE targets, zero collation findings, zero enum findings, zero text-width findings, and zero INSERT...SELECT source-domain overflows. The current plan records 933 source-domain checks and zero source-domain overflows, with all database/provider/credential/data-export/runtime mutation flags false.

The exact Windows preflight and confirmed replay scripts must be generated only after this repair is merged and a clean detached post-merge verification records the actual merge SHA and actual counters. A confirmed replay failure must halt before AutoPilot, importer, and readback; those steps remain prohibited until a separate review authorizes them after a successful replay.
