# Runtime Boundary Map
**Purpose:** Describe the current runtime structure by authority boundary, not by incidental file grouping.

## 1. Canonical authority layer

These files define the intended architecture and enforcement model:

- `system_bootstrap.md`
- `memory_schema.json` (root; domain sub-schemas in `schemas/`)
- `direct_instructions_registry_patch.md`
- `module_loader.md`
- `prompt_router.md`

These documents outrank runtime summaries and root documentation.

## 2. Root runtime boundary

### Current top-level service subtree

Primary implementation subtree:
- [`http-generic-api`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api>)

### Current orchestration boundary

- [`http-generic-api/server.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/server.js>)

Current role:
- Express route surface
- top-level request normalization and guardrails
- local dispatch and route selection
- registry-backed execution orchestration
- async job route coordination
- WordPress migration entrypoint coordination
- engine evidence auto-derivation for writeback wrappers: local copies of `getWorkflowRowByKey`, `getActiveEngineRegistryRows`, and `buildEngineEvidenceFromWorkflow` resolve workflow rows from the cached registry when callers pass `target_workflow` but not `selectedWorkflowRow`

Current risk:
- too many authority boundaries remain concentrated here

## 3. Shared runtime support boundaries

### Configuration boundary

- [`http-generic-api/config.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/config.js>)

Owns:
- environment-derived constants
- spreadsheet IDs
- sheet names
- service version
- queue and retry defaults
- GitHub connector configuration

### General utility boundary

- [`http-generic-api/utils.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/utils.js>)

Owns:
- request/path/method normalization
- URL building
- trace ID creation
- safe basic conversions
- low-level request hygiene helpers

### Normalization boundary

- [`http-generic-api/normalization.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/normalization.js>)

Owns:
- `/http-execute` payload normalization helpers
- top-level routing field normalization
- delegated wrapper payload promotion
- payload integrity comparison
- top-level routing validation contract
- asset-home payload validation contract
- Hostinger target-tier normalization guard

### Registry resolution boundary

- [`http-generic-api/registryResolution.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/registryResolution.js>)

Owns:
- registry-backed policy value/list resolution
- brand, parent-action, and endpoint resolution helpers
- delegated-transport classification and endpoint execution snapshots
- execution eligibility and transport boundary enforcement helpers
- provider-domain resolution contract for delegated and brand-bound execution

### Registry Sheets read-model boundary

- [`http-generic-api/registrySheets.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/registrySheets.js>)

Owns:
- registry Sheets row loading for brand, hosting-account, action, endpoint, and execution-policy surfaces
- registry surface catalog lookup by `surface_id`
- live execution-policy registry read-model helpers
- execution-policy row shaping and row-number resolution helpers
- Sheets access policy: classify/probe first, read headers separately, load bounded row/column chunks with pacing, cache stable metadata, and write only exact cells or bounded rows. Full-sheet reads are audit-only and must stay segmented with bounded retries.

### Registry mutation boundary

- [`http-generic-api/registryMutations.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/registryMutations.js>)

Owns:
- governed CRUD flow wrappers for registry surfaces
- live-read plus row-build plus row-locate orchestration for registry mutations
- task-route, workflow, registry-surface, validation-repair, action, and execution-policy registry mutation entrypoints
- canonical row shaping and record identity matching for governed registry writes

### Governed sheet-write primitive boundary

- [`http-generic-api/governedSheetWrites.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/governedSheetWrites.js>)

Owns:
- governed write safety-plan construction from live headers and row-2 formulas
- full-row and slice-row shaping for governed writes
- append, update, and delete primitives for governed sheet mutations
- `Execution Log Unified` append/writeback special handling
- shared mutation dispatch after governance preflight succeeds

### Governed change-control helper boundary

- [`http-generic-api/governedChangeControl.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/governedChangeControl.js>)

Owns:
- governed change-control policy loading from `Execution Policy Registry`
- governed policy value/enabled resolution helpers
- existing-row window reads for duplicate detection
- semantic normalization and duplicate-candidate discovery used by governed mutation preflight

### Surface metadata and header-validation boundary

- [`http-generic-api/surfaceMetadata.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/surfaceMetadata.js>)

Owns:
- sheet-cell normalization for governed write surfaces
- live sheet shape reads and header-map derivation
- canonical surface metadata fallback and registry-backed resolution
- header signature, expected-column, and exact-header validation helpers
- reusable header hashing helpers for drift and repair workflows

### Route/Workflow governance boundary

- [`http-generic-api/routeWorkflowGovernance.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/routeWorkflowGovernance.js>)

Owns:
- canonical Task Routes and Workflow Registry header-order enforcement
- legacy route/workflow write blocking and migration-scaffolding guardrails
- governed addition-state normalization and review result shaping
- sheet bootstrapping and append-if-missing helpers for canonical route/workflow surfaces
- site-migration registry-surface and route/workflow readiness validation

### Route/Workflow registry read-model boundary

- [`http-generic-api/routeWorkflowRegistryModels.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/routeWorkflowRegistryModels.js>)

Owns:
- Task Routes registry row shaping into governed runtime records
- Workflow Registry row shaping into governed runtime records
- executable-authority evaluation for route/workflow records
- candidate-inspection versus executable-only filtering for route/workflow loaders
- chunked default reads for route/workflow authority surfaces; broad `A1:*2000` style sweeps are reserved for explicit audits and still use paced chunks

### Governed record-resolution boundary

- [`http-generic-api/governedRecordResolution.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/governedRecordResolution.js>)

Owns:
- generic governed-sheet record loading by surface name
- loose hostname normalization and identity matching across governed registries
- Brand Registry binding resolution from governed records
- Hostinger SSH runtime lookup from Hosting Account Registry

### Schema validation boundary

- [`http-generic-api/schemaValidation.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/schemaValidation.js>)

Owns:
- authoritative OpenAPI operation resolution by method and path template
- request parameter and request-body schema validation
- JSON-schema-style structural validation helpers
- response schema drift classification for schema-bound executions

### Auth injection boundary

- [`http-generic-api/authInjection.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/authInjection.js>)

Owns:
- OAuth-configured action detection
- auth-mode inference from action and brand records
- auth header construction for basic, bearer, and custom-header modes
- query/header auth injection helpers for execution and schema validation

### External endpoint credential strategy boundary

- [`http-generic-api/authCredentialResolution.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/authCredentialResolution.js>)
- [`http-generic-api/userAppConnectionCredentials.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/userAppConnectionCredentials.js>)
- [`http-generic-api/executionPreparation.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/executionPreparation.js>)
- [`http-generic-api/routes/systemLayerRoutes.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/routes/systemLayerRoutes.js>)

Owns:
- parent action credential policy from `actions.runtime_binding_profile.auth_strategy`
- optional endpoint override from `endpoints.runtime_binding_profile.auth_strategy_override`
- runtime selector forwarding for `credential_scope`, `user_id`, `tenant_id`, `connection_id`, `app_key`, `scopes`, `auth_type`, `allow_platform_fallback`, and `auth_context`
- scoped credential resolution from `user_app_connections.encrypted_credentials`
- enforcement that user/tenant/connection scoped calls with `allow_platform_fallback=false` never silently use platform credentials

Must not:
- duplicate parent auth policy into every endpoint row
- copy user secrets into `actions`, `endpoints`, or tool export rows
- use platform credentials when the caller explicitly requested scoped credentials and disabled fallback

### Async job infrastructure boundary

- [`http-generic-api/queue.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/queue.js>)
- [`http-generic-api/jobRunner.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/jobRunner.js>)

Owns:
- Redis and BullMQ setup
- job persistence and idempotency
- worker entrypoints
- webhook delivery
- retry decisions
- site-migration job record creation

## 4. Registry and governed-write boundaries

### Activation evidence boundary

Activation readiness spans transport, provider bootstrap, registry authority, and canonical guidance. Health and status routes are diagnostics only.

Required provider bootstrap evidence:
- Drive probe through `http_generic_api` with `parent_action_key=google_drive_api`
- Sheets probe through `http_generic_api` with `parent_action_key=google_sheets_api`, `endpoint_key=getSheetValues`, and `path_params.spreadsheetId=<activation_bootstrap_spreadsheet_id>`
- readback of `query.range=Activation Bootstrap Config!A2:J2`
- GitHub validation only after bootstrap row resolution, using bootstrap/registry-resolved action and endpoint keys

Boundary rules:
- `hard_activation_wrapper` and `system_auto_bootstrap` are routing labels, not provider action keys
- `/health`, `/status`, release readiness, tenant listing, brand counts, and action counts must not replace provider bootstrap evidence
- if Drive or Sheets is skipped while activation tooling is available, activation remains degraded with `missing_required_provider_bootstrap_attempt`
- platform-owned bootstrap files use managed service account ADC; user-owned Drive/Sheets input sources use refresh-token auth

### Google client boundary

- [`http-generic-api/googleSheets.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/googleSheets.js>)

Owns:
- Google Sheets and Drive client creation
- range reads
- sheet creation/header assurance
- live sheet shape inspection

### Google auth token boundary

- [`http-generic-api/googleAuthTokenResolver.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/googleAuthTokenResolver.js>)

Owns:
- managed service account ADC token resolution for platform-owned registry/bootstrap files
- refresh-token token resolution for user-owned Drive/Sheets files and connected input sources
- token caching and refresh behavior used by governed Google Workspace actions

Must not:
- treat refresh-token OAuth as the universal Google path
- repair platform-owned activation by generating a user refresh token
- accept caller-supplied Authorization headers for governed Google activation

### Registry read-model boundary

- [`http-generic-api/registry.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/registry.js>)

Owns:
- registry surface metadata reads
- governed sink existence checks
- sheet-range helpers
- registry row loading and normalization
- canonical surface metadata lookup

### Governed writeback boundary

- [`http-generic-api/governed.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/governed.js>)

Owns:
- header validation
- governed write-plan construction
- formula/protected column safety checks
- sink row spill-safety rules

### Mutation governance boundary

- [`http-generic-api/mutationGovernance.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/mutationGovernance.js>)

Owns:
- governed mutation intent classification
- governed target-row resolution
- governed mutation preflight enforcement contract
- duplicate-candidate summary shaping

### Registry cache boundary

- [`http-generic-api/registryCache.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/registryCache.js>)

Owns:
- Redis-backed registry cache keyed by sheet name (`registry:<sheetName>`)
- configurable TTL via `REGISTRY_CACHE_TTL_SECONDS` (default 600 s)
- graceful degradation when Redis is unavailable (warn and fall through to live read)
- `cacheGet`, `cacheSet`, `cacheInvalidate` primitives consumed by `registrySheets.js` and `governedSheetWrites.js`

Note: `readExecutionPolicyRegistryLive` always bypasses the cache (`skipCache: true`) — policy enforcement on the write path must see fresh data. Every successful governed sheet mutation triggers `cacheInvalidate` for the affected sheet.

### Execution result and sink-shaping boundary

- [`http-generic-api/execution.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/execution.js>)

Owns:
- execution-result classification, output summary shaping, oversized artifact handling
- `Execution Log Unified` row shaping — 56 columns (A:BD), including logic evidence (AL:AS) and engine evidence (AT:AX)
- `JSON Asset Registry` row shaping
- three normalizer helpers: `normalizeAssociationStatus`, `normalizeResolvedLogicMode`, `normalizeEvidenceList`
- engine evidence derivation: `buildEngineEvidenceFromWorkflow` — derives `used_engine_names`, `used_engine_registry_refs`, `used_engine_file_ids`, `engine_resolution_status`, and `engine_association_status` from a workflow row and engine registry rows; explicit caller-supplied values always take priority
- workflow/engine lookup helpers: `getWorkflowRowByKey`, `getActiveEngineRegistryRows`
- writeback wrappers (exported): `logValidationRunWriteback`, `logPartialHarvestWriteback`, `logRetryWriteback` — each self-heals by looking up `selectedWorkflowRow` from the cached registry via `target_workflow` when not explicitly provided

### Sink orchestration boundary

- [`http-generic-api/sinkOrchestration.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/sinkOrchestration.js>)

Owns:
- oversized artifact persistence orchestration
- shared writeback orchestration for authoritative sink flows
- coordination of `Execution Log Unified` and `JSON Asset Registry` writes
- governed sink state aggregation for runtime writeback results

### Sink verification boundary

- [`http-generic-api/sinkVerification.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/sinkVerification.js>)

Owns:
- execution-log spill-safety checks
- sink append readback verification
- authoritative sink write helper wrappers for `Execution Log Unified` and `JSON Asset Registry`
- sink-specific live header and write verification logic

## 4b. SQL data layer boundaries

The following modules define the MySQL-backed primary data layer. The Google Sheets workbooks act as a fallback sync mirror. All SQL boundaries are controlled by the `DATA_SOURCE` environment variable (`sql` is primary).

### MySQL connection pool boundary

- [`http-generic-api/db.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/db.js>)

Owns:
- singleton `mysql2/promise` pool creation from `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`
- `getPool()` — returns the shared pool (creates on first call)
- `testConnection()` — ping-test helper for startup diagnostics
- `pool.end()` must only be called in CLI scripts (migrate, expand-schema); never in Express request handlers

### SQL adapter boundary

- [`http-generic-api/sqlAdapter.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/sqlAdapter.js>)

Owns:
- `TABLE_MAP` — canonical 15-entry mapping from sheet name to SQL table name
- `SHEET_COLUMNS` — per-table canonical column lists (used for write ordering and reverse-mapping reads back to sheet-style column names)
- `toSqlCol()` — normalisation function: lowercase, `(s)` → `s`, non-alphanum → `_`, deduplicate underscores, strip leading/trailing underscores
- CRUD primitives: `readTable`, `appendRow`, `updateRow`, `deleteRow`, `findRows`
- Migration helpers: `bulkInsertRows` (chunked 100-row INSERT), `clearTable`, `readTableRaw`, `updateRowById`

### Data source router boundary

- [`http-generic-api/dataSource.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/dataSource.js>)

Owns:
- `DATA_SOURCE` mode routing (`sheets` / `dual` / `sql`): default is `sql` (MySQL primary)
- `init()` — called once by server.js to inject connection pools
- `readTable`, `findRows`, `appendRow`, `updateRow`, `deleteRow` — unified access layer consumed by registry and governed-write modules
- In `dual`/`sql` modes: SQL reads dominate, with Sheets acting strictly as a fallback or parity mirror on writes

### Migration CLI boundary

- [`http-generic-api/migrate-sheets-to-sql.mjs`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/migrate-sheets-to-sql.mjs>) — CLI only, never imported by Express server

Owns:
- seed mode: bulk insert all rows from Sheets into MySQL (optionally truncating first, or INSERT IGNORE)
- merge mode: row-level diff by natural key — insert missing, update changed, skip unchanged
- dry-run by default; `--apply` required to write
- calls `pool.end()` before exit

- [`http-generic-api/expand-schema.mjs`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/expand-schema.mjs>) — CLI only

Owns:
- idempotent ALTER TABLE runner — adds columns present in `SHEET_COLUMNS` that are missing from the live MySQL table
- all columns added as `TEXT NULL`; never modifies existing columns
- dry-run by default; `--apply` required to execute ALTER TABLE statements
- calls `pool.end()` before exit

- [`http-generic-api/reconcile-catalog.mjs`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/reconcile-catalog.mjs>) — CLI only, Sheets-only (no DB connection)

Owns:
- reads `Registry Surfaces Catalog` and live workbook tab structure across all referenced workbooks (cross-workbook resolution via `file_id` column)
- 7 CLI flags: `--fix-duplicates`, `--register-tabs`, `--refresh-columns`, `--fix-gids`, `--retire-deleted`, `--demote-required`, `--apply`
- `normalizeTabName()` — strips cell-range suffixes (`Sheet!A1:Z` → `Sheet`) before tab-existence checks
- `isRetired()` — excludes retired/deleted/inactive/archived/deprecated rows from required-missing checks
- reports and optionally fixes: duplicate `surface_id`, unregistered tabs, tabs referencing deleted worksheets, expected column count mismatches, GID mismatches, retired tabs, required-for-execution demotions
- does not connect to MySQL

- [`http-generic-api/tighten-db.mjs`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/tighten-db.mjs>) — CLI only

Owns:
- deduplication of natural keys (keeps MIN(id) per key, deletes duplicates) for brands, brand_core, actions, endpoints, task_routes
- adds UNIQUE constraints: `task_routes.route_id`, `workflows.workflow_id`, `endpoints.endpoint_id`, `execution_policies.(policy_group,policy_key)`, `brand_core.(brand_key,asset_key)`
- adds indexes: `intent_key`, `brand_scope`, `active`, `maturity`, `result_state`, `severity`, `active_status`
- promotes TEXT columns to VARCHAR where used as lookup keys: `registry_surfaces_catalog.file_id/source_surface_id/parent_surface_id`, `actions.action_id`, `validation_repair.validation_type/result_state/severity/rule_id`
- dry-run by default; `--apply` required to write; `tryAlter()` wrapper silently skips already-applied constraints
- calls `pool.end()` before exit

- [`http-generic-api/smoke-test-data-flow.mjs`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/smoke-test-data-flow.mjs>) — CLI only, read-mostly

Owns:
- end-to-end data-flow smoke test across all 15 SQL tables
- verifies: DB ping, all tables readable, route→workflow chain, execution policies, brand→SRI→SSI chain, hosting accounts, actions→endpoints linkage, RSC integrity (no duplicate surface_id), JSON assets, execution log, validation_repair, plugins, brand_core, UNIQUE constraint enforcement (ER_DUP_ENTRY), row count summary
- exit 0 on full pass; exit 1 on any failure
- run with: `node http-generic-api/smoke-test-data-flow.mjs`

## 5. Auth and connector boundaries

### Auth and policy resolution boundary

- [`http-generic-api/auth.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/auth.js>)

Owns:
- Google delegated token minting
- auth-mode and scope resolution
- required policy checks for execution readiness

### GitHub connector boundary

- [`http-generic-api/github.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/github.js>)

Owns:
- GitHub blob reads
- chunked payload fetch behavior
- GitHub token-gated helper behavior

Desired contract direction:
- narrow public entrypoints
- helper privacy by default

### Hostinger connector boundary

- [`http-generic-api/hostinger.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/hostinger.js>)

Owns:
- Hosting Account Registry lookup for Hostinger runtime/SSH context
- runtime-read endpoint support

### Logic pointer resolution boundary

- [`http-generic-api/resolveLogicPointerContext.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/resolveLogicPointerContext.js>)

Owns:
- canonical 6-step logic pointer resolution from `surface.logic_canonical_pointer_registry`
- rollback-first resolution ordering: governed rollback overrides `canonical_active`
- knowledge profile chaining (read after pointer resolution, not before)
- `guardDirectLegacyExecution` — blocks direct legacy execution when canonical pointer is active and no rollback is authorized

Public exports:
- `resolveLogicPointerContext(input, deps)` — returns `{ ok, state, blocked_reason?, knowledge? }`
- `guardDirectLegacyExecution(pointerRow, rollbackAuthorized)` — returns `{ blocked, reason? }`

## 6. WordPress migration subsystem boundary

### Barrel and shared boundary

- [`http-generic-api/wordpress/index.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/wordpress/index.js>)
- [`http-generic-api/wordpress/shared.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/wordpress/shared.js>)

### CPT preflight boundary

- [`http-generic-api/wordpress-cpt-preflight.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/wordpress-cpt-preflight.js>)

Owns:
- WordPress CPT preflight asset-type inference
- CPT-aware JSON asset context shaping
- delegation to shared CPT preflight asset-key and payload helpers

### Orchestrator boundary

- [`http-generic-api/wordpress/phaseA.js`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api/wordpress/phaseA.js>)

Current role:
- top-level WordPress migration orchestration
- phase sequencing
- phase result aggregation
- evidence assembly for later phases

Current risk:
- still large and still centralizes too much subsystem authority

### Domain phase boundaries

- `phaseB.js`: builder assets
- `phaseC.js`: site settings
- `phaseD.js`: forms and integrations
- `phaseE.js`: media assets
- `phaseF.js`: users, roles, auth surface
- `phaseG.js`: SEO surfaces
- `phaseH.js`: analytics and tracking
- `phaseI.js`: performance optimization
- `phaseJ.js`: security, headers, hardening
- `phaseK.js`: observability, logs, alerts, monitoring
- `phaseL.js`: backup and recovery
- `phaseM.js`: deployment, release, rollback
- `phaseN.js`: data integrity and reconciliation
- `phaseO.js`: QA, smoke tests, acceptance
- `phaseP.js`: production readiness and cutover

## 7. Governed sinks and authoritative surfaces

Current primary sink surfaces:
- `Execution Log Unified`
- `JSON Asset Registry`

Current important authority surfaces:
- `Registry Surfaces Catalog`
- `Validation & Repair Registry`
- `Task Routes`
- `Workflow Registry`
- `Actions Registry`
- `API Actions Endpoint Registry`
- `Execution Policy Registry`
- `Brand Registry`
- `Hosting Account Registry`
- `Brand Core Registry`

## 8. Schema boundary

`memory_schema.json` is the persistent state contract root. It is decomposed into 12 domain sub-schemas under `schemas/`, each containing the relevant `$defs`:

| File | Defs | Size |
|---|---|---|
| `schemas/shared.schema.json` | 3 | 1.5 KB |
| `schemas/business_identity.schema.json` | 2 | 4.1 KB |
| `schemas/brand.schema.json` | 8 | 19 KB |
| `schemas/execution.schema.json` | 12 | 39 KB |
| `schemas/analytics.schema.json` | 17 | 20 KB |
| `schemas/governance.schema.json` | 3 | 4.4 KB |
| `schemas/logic_knowledge.schema.json` | — | — |
| `schemas/repair_audit.schema.json` | 11 | 34 KB |
| `schemas/routing_transport.schema.json` | 2 | 7.7 KB |
| `schemas/graph_addition.schema.json` | 16 | 17 KB |
| `schemas/operations.schema.json` | 13 | 125 KB |
| `schemas/wordpress_api.schema.json` | 3 | 6 KB |

Root retains 130 properties and 99 required fields. All `$ref` values resolve.

## 9. Immediate decomposition opportunities

The next highest-value decomposition opportunities are:

1. reduce remaining route-local execution/auth policy assembly in `server.js`
2. reduce remaining auth-contract normalization and credential-resolution helpers in `server.js`
3. reduce `phaseA.js` orchestration weight where a stricter per-phase contract allows it
4. tighten connector public/private export boundaries
5. continue converting runtime helper clusters into explicit authority modules

## 9. Boundary rules for future changes

- Add code by authority boundary first, not by convenience.
- Keep sink-handling logic centralized when it governs multiple runtime paths.
- Keep connector entrypoints narrow and explicit.
- Do not move canonical authority into runtime helper files.
- Prefer shared normalization contracts over route-local literal handling.

---
**Documentation Integrity:** This architectural map must remain aligned with the [Canonical Sources](canonicals/) and the [Agent Knowledge Guide](AI_Agent_Knowledge_Guide.md). Any structural changes must be propagated across all three layers as defined in the [README Documentation Architecture](README.md#documentation-integrity-architecture).
