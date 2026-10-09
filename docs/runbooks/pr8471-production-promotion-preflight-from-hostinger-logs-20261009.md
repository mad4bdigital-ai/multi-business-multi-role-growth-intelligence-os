# PR #8471 — Hostinger Production release preflight and no-go evidence

**Source:** User-supplied Hostinger Production runtime logs on 9 October 2026; sanitized findings only. Raw production logs and secret/configuration values MUST NOT be committed to GitHub or CI artifacts.

**Governance:** `main` is the source, `Production` is the separate Hostinger auto-deployed branch. Promotion of the Production branch is a **Production deployment action**, not ordinary PR merge. This guide and the accompanying preflight implement read-only diagnosis; they never create DBs, change grants, upload credentials, update Node environment, or push to Production.

At inspection: `main=f9d80998ca3fce852d47465dbe990a8c08458462`, `Production=e0c07f6fba431650b87d7a6f3dde76a364be6223`, and the compare reported `main` **1,338 commits ahead** of `Production` (`Production` was an ancestor). This makes the forthcoming release a cumulative source/migration cut, **not merely PR #8471**. Recompute the comparison immediately before release, as these identities are observations, not evergreen pins.

## Concrete evidence from the user-supplied Production log

The raw file contains repeated runtime cycles: 22 `runtime_bootstrap_status` events; 22 MCP schema preflights; 22 each of dynamic audit, OpenAPI inventory, and Runtime Parity failure statuses. These counts do **not** prove 22 deployments or independent readbacks.

| Signal | Actual observed state | Required gate and remediation |
| --- | --- | --- |
| Process/health | Node service listens on port 8080; SQL routes enabled; GitHub GET returned HTTP 200 | Network availability is not readiness. Probe `/health`, `/version`, `/deployment-info`, authenticated canaries and committed event receipts independently. |
| Bootstrap source | `bootstrap_not_configured`, `hook.configured=false`, `exact_sha_configured=false`, `target_binding_configured=false`, `MYSQL_BOOTSTRAP_*.configured=false` | **NO-GO**. Configure a separate explicitly approved release hook and source/branch/target binding through the existing governed path; do not enable `auto_apply`, `startup_apply`, or normal-route bypass. |
| DB catalog | Valid same-session Runtime DB and principal identity; both `admin_platform_endpoint_tools` and `tenant_platform_endpoint_tools` lack `mcp_catalog_level` | **NO-GO**. Check exact `20260815_custom_gpt_mcp_catalog_levels.sql` SHA-256 `528143808adac23eb457058c4c34dd95c4c5d462bca9ac4b170b1f19b2006681`, source contract checksum and object inventory, then separately authorize DDL via migration principal. Require native replay plus same-cycle post-apply table/column readbacks. |
| Environment identity | MCP preflight `environment=unknown` despite branch `Production` in bootstrap logs | **NO-GO**. Bind and read back actual runtime environment/host/branch/source SHA; branch text alone is not identity. |
| Dynamic audit | `dynamic_audit_scheduler_runs` exists but runtime user has `ER_TABLEACCESS_DENIED_ERROR`; scheduler remains stopped | **NO-GO** if audit is required. Check effective grants on exact table to actual runtime principal; apply least-privilege roles through governed DB controller; verify insert/readback and scheduler startup. |
| OpenAPI inventory | `actions` write denied; `openapi_endpoint_inventory_sync_start` reports `started=false` with `ok=true` | **NO-GO**. A diagnostic `ok=true` does not certify the business operation. Prove exact INSERT/UPDATE grants and readback; restore successful catalog sync before enabling dependent routes. |
| Runtime Parity | `startup_reconciliation_failed`, `status=degraded`, SQL table access error | **NO-GO**. Resolve owner/tenant/schema permissions; check data identity and verify `status=healthy` with new same-cycle readback. |
| Execution journal | `execution_log` append denied, explicitly logged as `fail-open` | **NO-GO** for governed write actions. Any HTTP 200 is insufficient: require durable append receipt or fail-closed mutation enforcement, log correlation and authorized operation readback. |
| Asset persistence | `json_assets` append denied; durable response chunk persistence returns `response_chunk_schema_incomplete` | **NO-GO** where durable responses are required. Separate missing tables/columns from SQL privileges, certify schema and bounded chunk continuation; verify full reconstruction and retention. |
| OAuth | `tenant_gpt_oauth_token_exchange_v2_diagnostic_failed` with table access denied | **NO-GO** for token exchange journeys. Check exact principal/table grants and run authorized masked-token canaries; do not log secrets. |
| Queue | `REDIS_URL` absent and `QUEUE_WORKER_ENABLED` not true, BullMQ disabled | **Conditional**: only a blocking failure when queue features are in the **approved release's required capabilities**. Otherwise explicitly accept disabled services and verify callers fail predictably; do not silently enable the worker. |
| GitHub transport | GitHub GET returns HTTP 200 under `github_app` in current log | Positive transport only, **not** database logging success, Ruleset administration rights or Production promotion authority. Historical private-key comments are not evidence that current GET failed. |
| GitHub branch controls | API readbacks returned `protected=false` for both `main` and `Production`; exact branch-protection details may require separate admin permissions | **NO-GO** before Production promotion: obtain effective server Ruleset/protection snapshot and required checks, restriction of direct pushes, bypass audit, and a separately governed merge controller. A YAML policy is not server enforcement. |

## Ordered release readiness stages

1. **Source seal (GitHub):** only after PR #8471 exact HEAD has passed native tests, E2E journeys, Work Map, Tool Lifecycle, Policy and Derived State gates, is attested by owner, and is merged to `main`. The eventual `Production` release cut is a new SHA and must be attested independently. Inspect **all changes since current Production** for DB migrations, runtime config, OAuth scopes, external APIs, credentials, and schema changes.
2. **Production baseline capture (read only):** record current `Production` SHA and deployed source SHA from `/version` and `/deployment-info`; exact Runtime DB/principal, current schema inventory, grants (never passwords), HTTP/agent transport, logs, asset store status, approved Queue capabilities, and an encrypted private host snapshot. A read-only Hostinger API GET does not confer create privileges.
3. **DB migration plan (separately approved):** compare required Runtime/Governance/Recovery DB roles and object identities; verify catalog SHA above plus all migrations (including 225 and 1051 when applicable); assess privileges for `dynamic_audit_scheduler_runs`, `actions`, `execution_log`, `json_assets`, OAuth tables and chunk storage. Use a distinct controlled bootstrap/migration principal and a one-time target-bound execution ticket; no raw-SQL/SSH fallback. Define forward fix, replay and compensating rollback.
4. **Staging certification:** replay the full `Production..main` release diff on comparable MariaDB/MySQL grants with synthetic data, prove E2E Admin Tool Catalog, protected Local Connector command identity, multi-tenant isolation, OAuth token exchange, durable response chunks, OpenAPI sync and Runtime Parity; run fault injection for migration halfway, retry, connection loss and incomplete DB grants; prove rollback receipt.
5. **Provider configuration reconciliation:** snapshot **all unmasked original Node environment variables** through a trusted vault. Hostinger Node environment PUT is full replacement/restart; do **not** PUT masked/partial values, and do not assume a CAS/rollback guarantee unless the provider explicitly certifies it. Lock write slot, compare exact diff, preserve original values. Configure only approved explicit release-hook bindings and role-specific credentials, never automatic schema changes during normal startup.
6. **GitHub server policy:** require effective readback on `main` and `Production` from an account with policy-admin authority; pin canonical policy producers and check names and prohibit ungoverned bypass/direct push. GitHub `mergeable=true` alone cannot satisfy this.
7. **Governed Production candidate:** create a unique, immutable release manifest bound to target site/account/environment/database role, target `Production` SHA, source `main` SHA, policy digest, exact schema plan, valid maintenance window, actor/owner approval, and signed rollback artifact. **Hold any push to Production** while any blocker above is unresolved: Hostinger auto-deploy could start immediately.
8. **Pre-push NO-GO diagnostic:** run the source-only log classifier locally against a fresh sanitized/secured Production log (see below). Treat output as negative evidence only. All blocking issues must have separate live remediation receipts; merely suppressing log lines never earns a pass.
9. **Deployment and aftercare (separately authorized):** only after 1–8 pass, promote via governed release controller; never from this PR. Verify actual deployed SHA against expected, DB principal, catalog columns, grants and write canaries, auth, feature health, response chunk persistence, tenant isolation, metrics and real rollback. If any critical readback fails, pause further writes and initiate governed rollback/compensation. DB schema/data rollbacks require their own authorized safety plan.

## Offline diagnostic command (no Hostinger mutation)

Keep the original raw log **only in a private operator workstation or secured evidence store**. Do not upload it to GitHub; the CLI prints only fixed codes and event counts, not log lines or secrets.

```sh
node http-generic-api/scripts/production-promotion-log-preflight.mjs \
  --log-file /secure/operator/hostinger-production.log \
  --expected-source-sha <EXACT_40_CHARACTER_RELEASE_SHA>
```

Use `--queue-required` only if BullMQ is part of this release's explicitly accepted mandatory capabilities. The CLI returns nonzero on any blocker. **Even a nonzero-free diagnostic in a future version would never authorize Production mutation without separate provider, database, source and server-policy attestations.** The current report always remains `promotion_authorized=false`.

## Evidence and safety policies

- Source tests, workflow success, runtime success, DB privileges, device proof, Hostinger provider CREATE permissions, server Rulesets and deployment acceptance are **different evidence authorities**.
- No database/user/environment/SSH write and no direct `Production` push from this PR. Production deployment requires separately scoped owner approval.
- Do not put secrets, masked values, DB credentials, GitHub App private key, access tokens, full raw Production logs or personal user identifiers into generated evidence or GitHub comments.
- Current logs are historical observations, not fresh same-cycle certificates. After remediation, explicitly re-query each status and the exact principal/host/DB with independent readbacks.

## Additional release-enforcement objections from live logs

- `mcp_catalog_schema_startup_preflight.ready=false` while `startup_blocked=false`: the application remains routable despite missing catalog columns. The preflight blocks on `MCP_SCHEMA_UNREADY_STARTUP_FAIL_OPEN`.
- `EXECUTION_AUTHORITY_MANIFEST_GUARD.enforced=false` with reason `execution_authority_manifest_enforcement_disabled`: verify explicit read-only exemptions and enforce write-capability checks independently. Preflight flags `EXECUTION_AUTHORITY_MANIFEST_ENFORCEMENT_DISABLED`.
- The 60 operational scenarios remain source-level negative contracts, never proof of live Hostinger privileges.
