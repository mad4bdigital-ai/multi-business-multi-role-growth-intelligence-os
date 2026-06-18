# Tenant Containment Readiness - 2026-06-18

## Source

This note records the first containment treatment for the June 18 auth control-plane readiness log.
It is aligned with the current `origin/main` spec kit at `docs/specs/001-dynamic-container-authority`,
especially these invariants from `threat-model.md` and `spec.md`:

- No provider client before authorization.
- Preview has zero secret, token, provider-call, or external-write side effects.
- Secret-like fields are rejected before they can leave platform validation.
- Provider-write authority must be exact, approved, and reconstructable.

## Treated in this patch

- `runtime_endpoint_call` is now admin-only in `SYSTEM_LAYER_TOOLS`.
- Tenant `/system/tools` discovery hides `runtime_endpoint_call` and known direct GitHub write/delete exports.
- Tenant `/system/tools/call` rejects blocked registry exports by tool name before building runtime facade payloads.
- Tenant `/gpt/tools` discovery hides the same state-changing tool names.
- Tenant `/gpt/tools/call` rejects those blocked names even if a stale registry row remains enabled.
- `connect_integration_policy_update` now uses a transaction-capable policy writer and pre-reads required connection context before mutation.
- Post-write hybrid readiness failures are returned as degraded readback (`readiness_unavailable`) instead of turning a successful mutation into an error response.
- `connect_device_install` / `/local-connector/install` now returns metadata only: no `connector_secret`, local API key, Cloudflare token, `.env`, generated installer body, or tunnel install command.
- Existing connector configs are reused unless `reprovision` is explicitly requested; the response records `existing_config_reused`, `reprovisioned`, and `reprovision_requires_explicit_flag`.
- Installer material is routed through the governed `/local-connector/install/download-link` flow, and the install response marks `secrets_included: false`.
- `/local-connector/uninstall` now disables the device and clears stored connector credentials (`cf_token`, `connector_secret`, `connector_local_api_key`) in the same update. This makes the governed remediation path suitable for disabling or rotating the reported active `ab` device without leaving reusable connector secrets behind.
- `scripts/local-connector-device-disable-rotate.mjs` provides a record-specific governed dry-run/apply path for disabling or rotating a local connector device such as `ab`. Apply requires typed confirmation `DISABLE_ROTATE_LOCAL_CONNECTOR_DEVICE`, performs readback with credential-presence booleans only, and attempts bounded `execution_log` evidence with trace id `local-connector-disable-rotate:<tenant>:<user>:<device>:<timestamp>`.
- `tenant_repository_intelligence_report` and `tenant_repository_action_planner_dry_run` now each have one canonical tenant-scoped descriptor instead of conflicting admin-only and tenant-scoped descriptors.
- Support ticket SLA reconciliation no longer preserves stale stored `breached`/`warning` state for open tickets that have no due dates; it recomputes those as `on_track` with reason `no_due_dates`.
- `scripts/database-lifecycle-report-snapshot.mjs` now attempts bounded `execution_log` evidence after a successful apply snapshot write. Snapshot refresh remains no-drop/no-delete/no-archive-execution/no-compaction-execution/no-secret, and an `execution_log` failure is returned separately from the snapshot write result.
- `runtime_endpoint_preview` now rejects non-object envelopes, provider-target query overrides, metadata targets, and GitHub content/delete previews missing required body fields.
- Tenant-visible safe tools are rebound through migration `1014_sprint69_tenant_safe_tool_route_rebinding.sql` to non-admin paths:
  - `local_gateway_tools_list` -> `/local/tools`
  - `local_connector_devices` -> `/local-connector/devices`
  - `local_connector_health` -> `/local-connector/health`
  - `me_scope_grants_list` -> `/me/scope-grants`
- The same migration disables those rows if they drift to `/admin/*` or `/connector/*` paths.
- Regression coverage was added to `test-tenant-tool-surface-guard.mjs`.
- Connector install containment coverage was added to `test-connect-device-install-containment.mjs`.
- Local connector uninstall rotation coverage was added to `test-local-connector-uninstall-rotates-secrets.mjs`.
- Local connector record-specific disable/rotate script coverage was added to `test-local-connector-device-disable-rotate-script.mjs`.
- Support ticket stale SLA coverage was added to `test-support-ticket-sla-stale-status-guard.mjs`.
- Database lifecycle snapshot execution-log coverage was added to `test-database-lifecycle-report-snapshot-execution-log.mjs`.

## Governed live follow-up commands

Dry-run the reported active `ab` device without changing DB state:

```bash
node scripts/local-connector-device-disable-rotate.mjs \
  --dry-run \
  --user-id <user_id> \
  --tenant-id <tenant_id> \
  --device-id ab
```

Apply disable+credential rotation after confirming the dry-run target:

```bash
node scripts/local-connector-device-disable-rotate.mjs \
  --apply \
  --confirm DISABLE_ROTATE_LOCAL_CONNECTOR_DEVICE \
  --user-id <user_id> \
  --tenant-id <tenant_id> \
  --device-id ab
```

Expected apply readback:

- `readback.disabled: true`
- `readback.cf_token_cleared: true`
- `readback.connector_secret_cleared: true`
- `readback.connector_local_api_key_cleared: true`
- `execution_log.recorded: true` or an explicit `execution_log.error` if the evidence surface is unavailable.
- `secrets_included: false`

Dry-run database lifecycle snapshot refresh:

```bash
node scripts/database-lifecycle-report-snapshot.mjs \
  --report-type retention_plan \
  --limit 80 \
  --actor-id codex_governed_operator
```

Apply database lifecycle snapshot refresh:

```bash
node scripts/database-lifecycle-report-snapshot.mjs \
  --apply \
  --confirm APPLY_DATABASE_LIFECYCLE_REPORT_SNAPSHOT \
  --report-type retention_plan \
  --limit 80 \
  --actor-id codex_governed_operator \
  --trace-id database-lifecycle-refresh-2026-06-18 \
  --notes tenant-containment-readiness-refresh
```

Expected snapshot apply readback:

- `write_result.snapshot_id` and `write_result.snapshot_key` are present.
- `snapshot.will_execute: false`
- `snapshot.no_drop: true`
- `snapshot.no_delete: true`
- `snapshot.no_archive_execution: true`
- `snapshot.no_compaction_execution: true`
- `execution_log.recorded: true` or an explicit `execution_log.error`.
- `secrets_included: false`

Blocked tenant tool names:

- `runtime_endpoint_call`
- `github_api_mcp__create_or_update_file_contents`
- `github_api_mcp__github_create_or_update_file`
- `github_api_mcp__github_put_contents`
- `github_api_mcp__github_delete_file`

## Existing guards confirmed

- `tenant_database_query_readonly` rejects `SELECT *`, DDL/DML/admin tokens, multiple statements, and secret-like SQL references.
- Selected secret-like columns such as `user_pass` are rejected before result serialization.
- Tenant infrastructure readiness blocks schema/query runtime tools when the connection is not ready.

## Remaining readiness work

- Execute the governed live disable/rotate for the still-active `ab` local connector device against the production/control-plane database. The code path is now hardened locally, but this record-specific action was not executed in this worktree.
- Replace the conservative `runtime_endpoint_preview` checks with registry-schema-aware validation when endpoint request schemas become canonical.
- Execute the database lifecycle snapshot refresh against the live database once runtime dependencies and DB access are available. The script now has bounded `execution_log` evidence on apply.

## Validation

Targeted tests run on this worktree:

- `node test-tenant-tool-surface-guard.mjs`
- `node test-connect-integration-policy-atomicity.mjs`
- `node test-connect-device-install-containment.mjs`
- `node test-local-connector-device-disable-rotate-script.mjs`
- `node test-local-connector-uninstall-rotates-secrets.mjs`
- `node test-runtime-endpoint-preview-strictness.mjs`
- `node test-tenant-safe-tool-route-rebinding.mjs`
- `node test-system-layer-repository-intelligence-v3-v4-dispatch.mjs`
- `node test-support-ticket-sla-stale-status-guard.mjs`
- `node test-database-lifecycle-report-snapshot-execution-log.mjs`
- `node test-tenant-database-query-readonly.mjs`
- `node test-tenant-infrastructure-readiness-tools.mjs`

Validation gap:

- `node test-platform-plugin-policy.mjs` did not run in this worktree because `mysql2` is not installed locally; Node failed during module resolution before exercising the changed code.
- `node test-connect-routes.mjs` did not run in this worktree because `express` is not installed locally; Node failed during module resolution before exercising route assertions.
- `node test-ticket-lifecycle-runtime-links.mjs` did not run in this worktree because `mysql2` is not installed locally; Node failed during module resolution before reaching the SLA assertions. The dependency-free stale-SLA guard above covers the patched branch.
