SQL Primary Data Source Authority Rule

Hostinger MySQL is the single runtime data source for the platform registry. Google Sheets is an async write mirror for human readability and an explicit recovery helper, never a runtime read path.

system_bootstrap must preserve:
- `data_source.runtime_authority = sql`
- `data_source.sheets_role = async_mirror_and_recovery`
- `data_source.mode` from `DATA_SOURCE` env var (default `sql`)

The following registry surfaces resolve from SQL tables (mapped 1:1 by `sqlAdapter.TABLE_MAP`):

| Surface name | SQL table |
|---|---|
| Brand Registry | `brands` |
| Brand Core Registry | `brand_core` |
| Actions Registry | `actions` |
| API Actions Endpoint Registry | `endpoints` |
| Execution Policy Registry | `execution_policies` |
| Hosting Account Registry | `hosting_accounts` |
| Site Runtime Inventory Registry | `site_runtime_inventory` |
| Site Settings Inventory Registry | `site_settings_inventory` |
| Plugin Inventory Registry | `plugins` |
| Business Activity Type Registry | `business_activity_types` |
| Business Type Knowledge Profiles | `business_type_profiles` |
| Brand Path Resolver | `brand_paths` |
| Task Routes | `task_routes` |
| Workflow Registry | `workflows` |
| Registry Surfaces Catalog | `registry_surfaces_catalog` |
| Validation & Repair Registry | `validation_repair` |
| JSON Asset Registry | `json_assets` |
| Execution Log Unified | `execution_log` |

References to these surfaces by their conceptual name (e.g. "Brand Registry", "Actions Registry") remain valid identifiers; resolution at runtime always targets the SQL table.

Execution Policy Transitional Authority

`execution_policies` remains the active runtime preflight authority for current governed execution paths. It is a transitional compatibility authority, not a target for new policy-to-logic mirroring.

The target policy representation is:
- `platform_engine_policy_registry`
- `platform_engine_policy_rules`

`policy_logic_bindings` is a traceability bridge between current runtime policies, target policy rules, and historical `logic_definitions` mirrors. It is not an enforcement surface.

`logic_definitions` must remain the logic/orchestration/engine behavior layer. New policy rows must not be mirrored into `logic_definitions` unless a separate orchestration logic is explicitly required.

Runtime Read Authority Rule

- runtime reads must resolve through `dataSource.js` or `sqlAdapter.js`
- Google Sheets reads must never appear in the runtime read path
- legacy Sheets readers (`googleSheets.js`, `registrySheets.js`) remain available only as explicit recovery helpers
- Sheets recovery is invoked through governed admin tools, not through runtime resolution

Async Mirror Behavior

- writes through `dataSource.appendRow`, `updateRow`, `deleteRow` write to SQL first, then mirror to Sheets in a non-blocking Promise chain
- mirror failure must not fail the originating request — mirror errors log a warning and otherwise drop
- mirror writes are best-effort and must not gate any classification, validation, or readiness check

Recovery and Parity Verification

Two governed admin tools support Sheets parity work:
- `governance_execution_log_sheets_recovery` (`GET /governance/execution-log-sheets-recovery`) — reads the latest Execution Log Unified primary row from the Sheets mirror; response includes an explicit recovery framing warning
- `platform_data_source_census` (`GET /admin/cli/data-source/census`) — returns per-table SQL row counts, last-write timestamps, and Sheets mirror configuration

Use these when:
- comparing SQL state against the Sheets mirror after a migration repair
- verifying Sheets mirror health
- confirming SQL tables are populated before a feature relies on them
- diagnosing a row that appears in Sheets but not in SQL (mirror drift)

Forbidden patterns:
- treating Sheets readback as runtime authority
- gating classification on a Sheets read result
- promoting a Sheets-only row to validated status without SQL parity
- adding new runtime code that calls `googleSheets.read*` directly

Activation Bootstrap Read Path

`GET /activation/bootstrap-config` is the authoritative runtime bootstrap row source. It returns `source: backend_runtime`, `sheets_required: false`, and live platform_state from SQL.

The DB-native bootstrap read (`activation_bootstrap_config_read`) and Drive probe (`activation_drive_probe`) are governed admin tools for same-cycle activation validation. `activation_sheets_bootstrap_read` remains only as a deprecated compatibility alias that delegates to DB runtime bootstrap and must not call Google Sheets. These tools are diagnostic helpers, not registry sources.

Native Google Workspace Action Governance

Google Sheets, Docs, and Drive remain legitimate **write targets** when the system writes user-facing artifacts (reports, dashboards, brand documents). Native action governance for write targets is unchanged: routes resolve through Registry Surfaces Catalog, validation flows through Validation & Repair Registry, and policy applies through Execution Policy Registry. These rules continue to govern write-target Google actions; they do not promote Google Workspace to a runtime read source.

Governed Migration Idempotency and Preflight

The governed migration runner may apply SQL only when authorization exists, the static preflight status is `pass`, typed confirmation matches, and same-cycle ledger/readback evidence is available. A `warn` or `fail` preflight must never be bypassed by direct DB execution.

Canonical identifier comparisons are a separate live preflight authority. UUID-like platform identifiers resolve through `canonical_identifier_contract_registry` and `canonical_identifier_column_binding_registry`. When compared identifier columns differ in SQL type, character set, or collation, the runner must fail before the first statement unless both operands use an explicit binary comparison. The transition contract is `CHAR(36) CHARACTER SET ascii COLLATE ascii_bin`; the target contract is `BINARY(16)`. Column conversion must be additive and phased rather than mixed into an unrelated readiness repair.

Interactive Admin execution must use the virtual tool `governed_migration_execute`, not freeform DB SQL or the generic `admin_control` surface. The tool validates the merged file checksum and statement count before spawning the fixed runner, defaults to `dry_run`, and requires a ready `platform_orchestration` Capability Resolution Envelope plus deterministic `APPLY_<MIGRATION>` confirmation for apply. Successful apply must confirm every approved statement, a migration-ledger row, and all declared schema objects in the same cycle.

Schema-alignment changes that require `ALTER TABLE ... MODIFY` must use `information_schema`-guarded dynamic SQL. An already-aligned rerun must resolve to a read-only `SELECT`; a missing or incompatible column must fail closed through the attempted governed alteration or an explicit signal. Raw top-level `ALTER TABLE ... MODIFY` statements that trigger manual-idempotency warnings are not production-applicable until rewritten and covered by regression tests.

Empowering GPT-Initiated Migration Repair

When an admin GPT detects data-source drift, empty SQL tables, or Sheets/SQL parity issues, it must:
1. Call `platform_data_source_census` to capture ground truth
2. Identify empty or stale tables from the census output
3. Use governed write tools to seed/repair the SQL tables — never write directly to Sheets first and rely on the mirror to backflow
4. Re-run the census to confirm repair
5. Optionally call `governance_execution_log_sheets_recovery` to confirm mirror parity

Automatic Governed Migration Reconciliation

`governedMigrationReconciliationRuntime.js` may run from the internal Dynamic Audit scheduler only when `platform_runtime_config.governed_migration_reconciliation_scheduler` is active. It must execute under the scheduler MySQL advisory lock and delegate to `governed-migration-reconciler.mjs`; it must never execute raw migration SQL directly.

Automatic mutation remains deny-by-default. Every migration requires an exact active `platform_engine_policy_rules` row, an authorized `governed_migration_authorization_registry` row, passing static preflight, runner typed confirmation, and same-cycle ledger/schema readback. Missing or disabled policy, authorization, config, or validation evidence must produce a skipped or blocked result. The scheduler may summarize results but must not store raw migration output or secrets.
