# Platform Recomposition Current-State Checkpoint - 2026-06-06

## Decision

Platform recomposition is no longer an unpromoted clean-room exercise. The SQL-primary authority transition and schema cleanup phases S1-S5 are complete. This directory now serves as a governed evidence register, historical review archive, and follow-up tracker.

## Promoted and verified

| Area | Current state | Evidence |
|---|---|---|
| Memory/state contract | Root `memory_schema.json` is valid and SQL-first. | `validate-memory-schema.mjs`; promoted S1 history. |
| Governance and execution schemas | Runtime binding/write-proof contracts use SQL registry/table identity. | S2 schema cleanup and tests. |
| Operations and repair schemas | Runtime contracts use SQL logs/registries; mirror imports are explicit recovery behavior. | S3 schema cleanup and tests. |
| Analytics, WordPress, and assets | SQL/source connector/asset keys are primary. | S4 schema cleanup and tests. |
| Governed registry reads | Google Sheets fallback and runtime mirror evidence are removed. | S5 runtime alignment and registry tests. |
| Activation bootstrap | DB-native bootstrap config is authority; Sheets alias is compatibility-only and must not call Sheets. | Active canonicals, guides, and activation tests. |
| Execution evidence | `execution_log` has context dimensions and governed backfill evidence. | Migration 203 and live readback. |
| Core runtime context | Additive context-dimension migration is registered across core activity/runtime tables; live coverage readback remains a follow-up. | Migration 204 and contract test. |
| Runtime workflow selection | Runtime loaders resolve explicit `workflow_id` first, accept only unique active `workflow_key` matches, and block ambiguous keys. Migrations 206 and 209 were applied live on 2026-06-06. Governed post-apply readback confirmed 10 of 13 plans now carry explicit `workflow_id`, zero uniquely resolvable fallback plans remain, zero executable plans lack `workflow_id`, and the remaining 2 unresolved drafts plus 1 identityless plan are isolated for manual review. | `runtimeWorkflowResolver.js`; migrations 206/209; governed `workflow_execution_identity_readback`; `scripts/workflow-execution-identity-readback.mjs`; `test-runtime-workflow-resolver.mjs`; PRs #705 and #720 evidence. |

## Reference overlays

The `*.clean-v1.md` files remain useful consolidated design references. They are not direct runtime authority because promotion occurred as smaller changes across active canonicals, schemas, migrations, and runtime modules.

When an overlay statement conflicts with current code or an active canonical:

1. Treat the active implementation and canonical source as current evidence.
2. Classify the mismatch as a follow-up or historical statement.
3. Promote a repair through code, canonical source, schema, migration, tests, and readback together.

## Remaining architecture work

| Priority | Follow-up | Reason |
|---|---|---|
| High | Migrate `tenant_gpt.oauth.client` away from inline `client_secret` storage to `client_secret_ref`. | The current compatibility path still resolves an inline DB-backed secret. |
| Medium | Classify and remove dead Sheets-era compatibility helpers and historical surface IDs only after alias/replacement migrations exist. | Names are not runtime authority, but blind renames can break registry identity. |
| Medium | Continue live readback for migrations 203/204 and lifecycle governance reports. | Schema presence is not enough; context coverage and retention need operational evidence. |
| Medium | Manually classify or retire the remaining 2 unresolved `wordpress_connector_readiness` draft plans and the 1 identityless plan. | Governed post-backfill readback confirms they are not executable and cannot be safely assigned an identity by deterministic backfill. |
| Medium | Review the remaining unique remote branches before deletion or promotion. | Unique patches may contain architecture-aligned work not yet integrated. |
| Low | Re-read historical Drive workbook inventory only when a recovery, parity, or archive decision requires it. | Workbook inventory is not runtime authority. |

## Validation contract

Run these checks after changing this directory:

```text
node validate-memory-schema.mjs
node http-generic-api/test-platform-recomposition-docs.mjs
node http-generic-api/validate-architecture.mjs
node http-generic-api/scripts/workflow-execution-identity-readback.mjs
git diff --check
```

The platform-recomposition docs test must verify:

- every file in this directory is classified in `README.md`;
- S1-S5 remain marked completed;
- the staged memory schema remains semantically equal to the promoted root schema after `$ref` path normalization;
- resolved stale follow-ups do not return as active claims.
