# Multi-Business Multi-Role Growth Intelligence OS

This repository is a governed, registry-driven execution system. It is not primarily a generic web application stack, even though it contains application runtime code.

The architecture is centered on canonical authority documents, registry-backed execution control, validation-first runtime behavior, and governed logging/writeback.

## Canonical authority order

When understanding or changing this repository, use the following authority order:

1. `system_bootstrap.md`
2. `memory_schema.json`
3. `direct_instructions_registry_patch.md`
4. `module_loader.md`
5. `prompt_router.md`

Supporting but secondary:
- runtime implementation files
- `http-generic-api/*`
- this `README.md`

If this README conflicts with canonicals, the canonicals win.

## Core execution model

The intended execution chain is:

1. `prompt_router`
2. `module_loader`
3. `system_bootstrap`
4. `governanceValidationEngine` (new, implicitly part of system_bootstrap)
4. runtime tool or connector execution
5. governed logging and writeback
6. durable memory persistence through `memory_schema.json`

Execution is expected to be:
- governed
- registry-centered
- validation-first
- evidence-preserving

Execution without validation evidence is not considered complete.

## Activation alignment rule

Conversation or Custom GPT activation must follow the provider bootstrap chain, not just health diagnostics:

1. health may prove transport reachability only
2. Drive probe: `google_drive_api:listDriveFiles`
3. Sheets probe: `google_sheets_api:getSheetValues` with `path_params.spreadsheetId=<activation_bootstrap_spreadsheet_id>`
4. bootstrap row: `query.range=Activation Bootstrap Config!A2:J2`
5. GitHub validation using bootstrap/registry-resolved action and endpoint keys

Health, `/status`, release-readiness, tenant listing, brand counts, and action counts are diagnostics only. They must not replace Drive, Sheets bootstrap, or GitHub probes. If Drive or Sheets is skipped while activation tooling is available, classify activation as degraded with `missing_required_provider_bootstrap_attempt`.

`hard_activation_wrapper` is a routing label only. It must never be sent as a provider `parent_action_key`.

Google auth ownership:
- platform-owned registry/bootstrap Drive and Sheets files use managed service account ADC
- user-owned Drive/Sheets files or user-connected input sources use refresh-token auth, for example `GOOGLE_AUTH_MODE=refresh_token`

## Architecture overview

### Canonical governance layer

The root canonical files define:
- routing expectations
- loading and readiness expectations
- activation and bootstrap rules
- hard enforcement constraints
- durable memory structure

These documents are the real architecture spine of the project.

### Memory schema layer

`memory_schema.json` is the persistent state contract root. Decomposed into 12 domain sub-schemas under `schemas/`, each referenced via JSON Schema `$ref`:

| Sub-schema | Domain |
|---|---|
| `shared` | Primitive types shared across domains |
| `business_identity` | Company, catalog, destinations, modules |
| `brand` | Brand context, identity, writing engine |
| `execution` | Runtime validation, activation, Google Workspace |
| `analytics` | Measurement, revenue signals, tracking bindings |
| `governance` | Schema state, drift detection, variable contracts |
| `logic_knowledge` | Logic pointers, logic knowledge, business-type knowledge |
| `repair_audit` | Repair memory, audit state, anomaly clusters |
| `routing_transport` | Routing context, HTTP transport, surface roles |
| `graph_addition` | Graph intelligence, governed addition pipeline |
| `operations` | System context, monitoring, writeback rules |
| `wordpress_api` | WordPress state, API inventory, credential resolution |

The root schema enforces `additionalProperties: false` and all 99 required fields (~41 KB). Validate with `node validate-memory-schema.mjs`.

### Registry-centered authority layer

Important governed surfaces (all SQL-primary, `DATA_SOURCE=sql`):

| Surface | Role |
|---|---|
| `task_routes` | intent_key â†’ workflow_key â†’ target_module routing authority |
| `workflows` | Workflow registry: execution_class, review_required, target_module |
| `agent_skills` | Skill capability definitions (skill_key, scope, capability_json) |
| `agent_skill_grants` | Per-agent skill grant bindings with status |
| `agent_workflow_bindings` | Agent â†” workflow binding, trigger_condition |
| `agent_supervision_policy` | Auto-approve class thresholds per agent+tenant |
| `actions` | Action keys, auth mode, schema binding |
| `endpoints` | Endpoint keys, method, path, domain |
| `output_artifacts` | Canonical store for agent-generated outputs |
| `sink_dispatch_log` | Audit trail for output routing decisions |
| `agent_chain_events` | Event bus for inter-agent chaining |
| `local_connector_user_configs` | Per-user device tunnel config, connector_secret |
| `local_connector_shell_allowlists` | Per-device shell alias allowlists |
| `local_connector_file_access_rules` | Per-device file path access rules |
| `Execution Log Unified` | Append-only governed execution sink |
| `JSON Asset Registry` | Governed artifact store |

MySQL is the sole authoritative read source for runtime execution.

Runtime behavior must prefer live registry truth via the `stateManager.js` data layer over local assumptions, stale memory, or narrative summaries.

### Runtime implementation layer

The main runtime subtree currently visible is [`http-generic-api`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/http-generic-api>).

That subtree currently contains:
- the main route/orchestration runtime, highly modularized into isolated route definition files
- specialized execution services (`stateManager.js`, `executionResolution.js`, `routeWorkflowGovernance.js`)
- connector support modules
- governed registry, writeback helpers, and legal endpoints (`/privacy-policy`, `/terms-of-use`)
- async job orchestration
- `resolveLogicPointerContext.js` â€” canonical logic pointer resolution and governed legacy rollback guard
- a modularized WordPress migration subsystem
- a strictly MySQL-backed primary data layer

### Sheets to MySQL data layer

The `http-generic-api/` subtree includes a production MySQL-backed data layer alongside Google Sheets. The runtime remains Sheets-first by default (`DATA_SOURCE=sheets`); switch to `dual` or `sql` to route reads through MySQL.

**Environment variables required:**
| Variable | Purpose | Default |
|---|---|---|
| `DB_HOST` | MySQL host | (required) |
| `DB_PORT` | MySQL port | `3306` |
| `DB_NAME` | MySQL database name | (required) |
| `DB_USER` | MySQL username | (required) |
| `DB_PASSWORD` | MySQL password | (required) |
| `DATA_SOURCE` | Routing mode: `sheets` / `dual` / `sql` | `sheets` |
| `REGISTRY_SPREADSHEET_ID` | Primary Google Sheets workbook ID | (required for CLI scripts) |
| `ACTIVITY_SPREADSHEET_ID` | Activity log workbook ID | defaults to `REGISTRY_SPREADSHEET_ID` |

**Migration scripts (run from `http-generic-api/`):**

```powershell
# 1. Verify schema is up to date (dry-run â€” no writes)
node expand-schema.mjs

# 2. Apply any missing columns
node expand-schema.mjs --apply

# 3. Dry-run migration: shows row counts per table, no SQL writes
node migrate-sheets-to-sql.mjs --dry-run

# 4. Merge mode dry-run: shows per-table insert/update/unchanged diff
node migrate-sheets-to-sql.mjs --merge

# 5. Merge mode apply: write inserts and updates
node migrate-sheets-to-sql.mjs --merge --apply

# 6. Tighten the DB: dedup natural keys, add UNIQUE constraints + indexes, TEXT->VARCHAR (dry-run)
node tighten-db.mjs

# 7. Apply DB tightening
node tighten-db.mjs --apply

# 8. Smoke test data flow
node smoke-test-data-flow.mjs
```

Migration sequence for a fresh database: run `expand-schema.mjs --apply` first, then `migrate-sheets-to-sql.mjs --merge --apply`, then `tighten-db.mjs --apply`. For subsequent incremental syncs use `--merge --apply`; the migrator skips unchanged rows. For the execution log (append-only, no natural key) use seed mode without `--merge`. Run `smoke-test-data-flow.mjs` after any DB change to verify table integrity.

Migration to SQL is complete. The platform runs SQL-primary for registry lookups.

### Connector and subsystem layer

`http-generic-api` is the clearest connector-style boundary in the repo today. It demonstrates:
- policy-enforced transport execution
- explicit connector-oriented boundaries
- registry-backed execution decisions
- governed logging and sink handling

Its WordPress subsystem is split into:
- shared helpers
- a top-level orchestrator in `wordpress/phaseA.js`
- phase modules `B` through `P` for governed migration domains

## Current repository status

Completed sprints: WordPress extraction (S2), http-generic-api decomposition (S3), memory schema decomposition (S4), output sink router (S21), session/upload system (S29â€“S29b), schema import pipeline (S28), local connector (S35), tunnel auto-provisioning (S36), workflow pipeline (S37), unified dispatch / 2-connector GPT (S38).

### Platform layer â€” local connector pipeline (Sprints 35â€“38)

- `http-generic-api/services/localConnectorOrchestrator.js` â€” factory-pattern orchestrator that executes governed shell/file/health ops on user devices via Cloudflare tunnel. Token from `local_connector_user_configs.connector_secret`.
- `http-generic-api/routes/localConnectorRoutes.js` â€” `POST /local-connector/shell`, `POST /local-connector/file/read`, `POST /local-connector/file/write`, `GET /local-connector/health`.
- `http-generic-api/routes/localConnectorInstallRoutes.js` â€” `POST /local-connector/install` auto-provisions a Cloudflare tunnel per user/device (CF API + Hostinger DNS), seeds shell allowlist, returns `install.bat`. Idempotent. `GET /local-connector/install/status`, `DELETE /local-connector/uninstall`.
- `http-generic-api/routes/dispatchRoutes.js` â€” `POST /dispatch` universal intent dispatcher: resolves `intent_key â†’ task_routes â†’ target_module â†’ MODULE_EXECUTORS`, validates agent skill grants, executes or returns routing advice. `GET /dispatch/routes` lists all active routes with `directly_dispatched` flag.
- `http-generic-api/openapi.custom-gpt.auth.yaml` â€” consolidated 16-operation OpenAPI spec for `auth.mad4b.com`, replacing 8+ separate scoped connectors in the GPT and centralizing activation, dispatch, GCloud, DNS, schema, admin, and device provisioning.
- `local-connector/` â€” Node.js break-glass connector running on `mohammedlap` at port 7070, exposed via Cloudflare Tunnel to `connector.mad4b.com`. Also routes `n8n.mad4b.com â†’ localhost:5678`.

### Migrations (032â€“034)

| File | Sprint | Content |
|---|---|---|
| `032_sprint35_local_connector_seed.sql` | S35 | `connector_secret` column, mohammedlap device seed, shell allowlist |
| `033_sprint36_tunnel_provisioning.sql` | S36 | `cf_tunnel_id`, `cf_tunnel_name`, `cf_token` columns |
| `034_sprint37_local_connector_workflow_routes.sql` | S37 | workflows, task_routes, agent_skills (skl-loc-con-001/002/003), agent_skill_grants, agent_workflow_bindings, agent_supervision_policy |

### Custom GPT â€” 2-connector architecture (Sprint 38)

The GPT uses exactly two action connectors:
- **Platform** (`openapi.custom-gpt.auth.yaml` â†’ `auth.mad4b.com`): 16 ops including `/activation/env-bootstrap`, `/dispatch`, `/admin/cli/gcloud`, `/admin/cli/dns`, schema import, release readiness, and governed device provisioning
- **Local** (`openapi.custom-gpt.connector.yaml` â†’ `connector.mad4b.com`): 7 ops for direct break-glass access to mohammedlap

Intent routing via `POST /dispatch` validates `agent_skill_grants` at runtime and executes directly for local connector modules or returns `suggested_endpoint` for other modules.

### Core runtime state

- `http-generic-api/server.js` decomposed from ~29,000 â†’ ~4,636 lines
- `http-generic-api/wordpress/` â€” 16 phase modules (A-P), 545 exports
- `http-generic-api/normalization.js` â€” canonical normalization for 8 domains (A-H)
- `memory_schema.json` â†’ 12 domain sub-schemas in `schemas/` (~41 KB root)
- governed sinks: `Execution Log Unified`, `JSON Asset Registry`, `output_artifacts`, `sink_dispatch_log`, `agent_chain_events`, `local_connector_user_configs`
- 150 tests passing (up from 46+ test files / 800+ assertions baseline)
- `/health` reports degraded dependency truth for Redis/BullMQ
- async job submission returns `503` when queue backend cannot accept work
- `googleAuthTokenResolver.js` â€” platform bootstrap uses managed service account ADC; user-owned Drive/Sheets uses refresh-token auth
- MCP connector branch added: `makecom_mcp` dispatches via JSON-RPC 2.0 to Make MCP stateless endpoint

## Upgrade direction

All 9 upgrade phases are complete. The project is in a production-ready, fully governed state.

Ongoing priorities:
- maintain canonical/runtime alignment on every change
- keep test coverage and architecture checks green
- treat deployment parity as a required verification step, not optional

## Documentation map

Primary documents:
- [`system_bootstrap.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/system_bootstrap.md>)
- [`memory_schema.json`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/memory_schema.json>) - root schema; domain sub-schemas in [`schemas/`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/schemas/>)
- [`direct_instructions_registry_patch.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/direct_instructions_registry_patch.md>)
- [`module_loader.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/module_loader.md>)
- [`prompt_router.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/prompt_router.md>)

Operations and validation:
- [`canonical_validation_checklist.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/canonical_validation_checklist.md>)
- [`runtime_boundary_map.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/runtime_boundary_map.md>)
- [`governed_mutation_playbook.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/governed_mutation_playbook.md>)
- [`connector_contracts.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/connector_contracts.md>)
- [`deployment_parity_checklist.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/deployment_parity_checklist.md>)
- [`runtime_confirmation_procedure.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/runtime_confirmation_procedure.md>)

Agent-facing guide:
- [`AI_Agent_Knowledge_Guide.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/AI_Agent_Knowledge_Guide.md>)

## Canonical editing workflow

The four root canonical markdown files are lightweight generated indexes with a `Domain Index` at the top. Edit the source files under [`canonicals/`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/canonicals/>) and rebuild the roots:

```powershell
node build-canonicals.mjs
```

To verify generated roots are current without rewriting them:

```powershell
node build-canonicals.mjs --check
```

To validate the canonical source structure itself:

```powershell
node validate-canonical-sources.mjs
```

To find the right canonical source file by domain keyword:

```powershell
node find-canonical-domain.mjs repair
node find-canonical-domain.mjs prompt_router repair
```

Do not edit generated root canonical files directly. The authoritative canonical body lives in the matching source files under `canonicals/`.

## Documentation Integrity Architecture
This repository employs a strict cross-referencing documentation pattern to ensure AI Agents and future developers maintain context when the code changes:
1. **Central Canonical Enforcement:** Any behavioral change in the backend must be reflected in the relevant `canonicals/` source files, followed by `node build-canonicals.mjs`.
2. **Agent Knowledge Guide:** `AI_Agent_Knowledge_Guide.md` represents the runtime persona. If structural constraints change (e.g., placeholder auto-resolution for `<activation_bootstrap_spreadsheet_id>`), they must be updated there.
3. **Architectural Maps:** Files like `runtime_boundary_map.md` and `runtime_confirmation_procedure.md` outline execution topologies. 
**Rule:** When you update one layer (e.g., extracting `server.js` to `stateManager.js`), trace the update across the Canonical sources, the Agent Knowledge Guide, and the Architectural Maps to maintain absolute documentation parity.

## Working rules for contributors and agents

- Read canonicals before proposing major runtime changes.
- Do not treat README text as authority when canonicals disagree.
- Keep `Top Level Instructions.md`, canonical sources, README, and structure docs aligned when activation/auth behavior changes.
- Do not use health/status/readiness/count routes as proof of provider activation.
- Preserve governed terminology and explicit status classification.
- Treat logging and writeback as part of execution, not afterthoughts.
- Prefer validation evidence over narrative certainty.
- Keep module boundaries explicit.
- Avoid bypassing the canonical chain with route-local improvisation.

## Governed GitHub File Updates

The runtime exposes a backend-protected GitHub write helper for HTTP clients:

`POST /github/apply-file-updates`

For AI-agent workflows that should not write directly to `main`, prefer:

`POST /github/validated-apply-file-updates`

Required environment:
- `BACKEND_API_KEY`
- `GITHUB_TOKEN`

Example payload:

```json
{
  "owner": "mad4bdigital-ai",
  "repo": "multi-business-multi-role-growth-intelligence-os",
  "branch": "main",
  "message": "Apply governed file update",
  "files": [
    {
      "path": "README.md",
      "content": "new file contents"
    }
  ]
}
```

Files are applied in one commit through GitHub's Git Trees API. Use `content_base64` instead of `content` when sending pre-encoded content.

The validated route requires `base_branch` and a different `branch`. It creates the branch when missing, applies the file updates as one commit on that branch, opens a draft pull request by default, and lets GitHub Actions act as the validation gate before merge.

## Immediate next implementation focus

All 9 upgrade phases are complete. The project is in a production-ready, fully governed state.

For ongoing operations:
- from `http-generic-api/`, run `npm test` after every code change (46+ test files, 800+ assertions)
- from `http-generic-api/`, run `npm run validate` to check architecture invariants
- run `node validate-memory-schema.mjs` after memory schema changes
- from `http-generic-api/`, run `npm run verify` (with `RUNTIME_BASE_URL`) after every deployment - see [`runtime_confirmation_procedure.md`](</d:/Nagy/Multi-Business-Multi-Role-Growth-Intelligence-OS/runtime_confirmation_procedure.md>)
- CI runs automatically on every push/PR (canonical checks -> memory schema refs -> syntax -> tests -> architecture drift -> export floor)

This repository should be approached as a governed operating model with executable runtime modules, not as a conventional app-first project.
