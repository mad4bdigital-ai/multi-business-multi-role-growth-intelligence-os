# PR #8461 — Comprehensive Delivery & Operational Handoff
**Date:** 2026-10-09  
**Repository:** `mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os`  
**PR:** https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/pull/8461  
**Branch:** `fix/app-control-stale-device-target-governance-20261008` → `main` (Draft; not merged)  
**Scope:** MAD4B App Control, local device self-recovery, Hostinger Production capability discovery/allowlist, independent Recovery Control Store and MCP catalog schema readiness. **Not Remote Desktop Commander.**

## 1. Decision / acceptance status
**Code delivered to one Draft PR, not Production-ready.** No Production database, account, grants or environment mutation has been executed through this PR. The new Hostinger capability commands remain `planned` and do **not** grant provider or SSH write authority. Device `RECOVERED` must not be claimed from heartbeat or server response alone without nonexportable hardware/generation evidence.

Last independently queried GitHub state **before this report commit**: HEAD `d31a6830af4aad701ce49320e2fef335d9add8fb`; base `486e4ec387b29dc4c0ffb0fbdd9085c114e1cf10`; Draft/Open/unmerged; mergeable=true is **not** release acceptance; 59 changed files, 138 commits, +2620/-897 lines. The PR HEAD will change with this report commit; always re-read the exact latest SHA and checks before any decision.

## 2. Evidence origin and confidence

| Evidence | Origin | What it proves | What it does NOT prove |
|---|---|---|---|
| Current source/PR states, changed paths | GitHub connector readback on 2026-10-09 | Source changes are present on PR #8461 | Deployed binaries or current live Production grants |
| `hostinger_ssh_prod_platform` active; managed SSH key; encrypted Platform DB; Production `auth.mad4b.com` | User-provided live platform connector inventory | Registered Production connector exists and is active in that observed inventory | hPanel API scope, database CREATE, server environment writer, verified running installation |
| `active_installations=0` | User-provided connector inventory | The inventory registered **zero installations** | Host is unreachable or service is definitively absent; no physical-instance proof |
| Registered operations status/logs/restart/deploy/rollback | User-provided connector capability observation | Existing SSH operational capabilities are declared | New DB/create-user/env/grant capabilities |
| `schema_contract_not_ready: mcp_catalog_level` | User-provided `listAdminSystemTools` / `listAdminTools` diagnostic | MCP catalog contract did not pass at observation time | Whether the root cause is only a missing column, wrong Runtime database, privilege mismatch, or failed metadata query |
| Hostinger database and Node.js API endpoints | Official Hostinger API reference + repository provider contract | API operations are documented; Node env GET masks values; PUT fully replaces keys and restarts Node | Account-specific permission, account/website id binding, safe conditional update |
| Isolated source tests | Existing PR deep-audit handoff | Earlier mock/source suites reported 48/48 pass | Native Node + PowerShell + MySQL/MariaDB + Windows + provider acceptance |

**Do not treat the user-supplied live inventory as a new direct provider readback by this report.** It is valuable evidence with an explicit source and observation context. Recheck same-cycle registration after rollout.

## 3. Hostinger Production connector — observed inventory (user-provided)

| Property | Observation |
|---|---|
| System key | `hostinger_ssh_prod_platform` |
| Provider | Hostinger |
| Environment | Production |
| Connection | `active` |
| Authentication | Managed SSH key |
| Credential storage | Encrypted Platform DB |
| Public application host | `auth.mad4b.com` |
| Active installations | 0 registered |
| Declared operational permissions | Server status, log reads; approved restart; Production release deploy; authorized rollback |
| Not demonstrated | MySQL database/user creation, Grants, Hostinger Node.js environment mutation, independent Recovery Store creation |

**Decision:** Reuse the existing connected system as the registered discovery entry point. Do not request a new Hostinger connection or assume the remote server has no deployment. Do not infer hPanel API authorization from SSH authentication.

## 4. Scope delivered in this PR

### A. Canonical local device identity
- Removed obsolete `mohammedlap` implicit targeting. Historical hostname/alias evidence is not current device identity.
- Exact `user_id + tenant_id + config_id + canonical device_id` matching; revoked, archived and disabled identities denied.
- Stale heartbeat permits explicitly targeted **diagnosis only**, not command execution or claims of recovered device.
- Read-only `GET /admin/cli/local-connector/devices` inventory without credentials.
- Self-repair no longer uses global Backend API Key or Cloudflare tokens as a device credential substitute.

### B. Credential and installer safety
- Old `GET /admin/cli/local-connector/install-bundle?format=bat` directly carrying credentials is retired with HTTP 410.
- JSON metadata points to the independent signed/scoped/expiring installer flow.
- Signed installer capability is fenced to the device credential epoch at issue, claim and final secret read, preventing reuse after credential rotation.
- Legacy agents need a governed compatibility upgrade; there is no promise that previous plaintext/manual installers remain valid.

### C. Heartbeat / route truth / watchdog
- `/connector-agent/heartbeat` and `/policy` require device-owned identity and active unique lifecycle-bound rows.
- Route health has three outcomes: verified success, verified failure, maintenance/indeterminate with **no** health demotion.
- Idempotent database updates require independent scoped lifecycle readback rather than interpreting 0 changed rows as revocation.
- Watchdog uses exact enrolled `CONNECTOR_CONFIG_ID`, `CONNECTOR_DEVICE_ID`, dedicated secret file and device-owned public runtime route, not an old shared hostname.
- No redirects for health probes; restart/rollback is not success until verified public health. Physical-generation attestation remains a separate P0 gap.

### D. Hostinger capability discovery and allowlist
- `POST /platform/remote-runtime/hosting/recovery-allowlist/discover` is read-only, admin-protected and resolves exact registered Hostinger target/system/tenant/environment.
- Source-only migration `20261009_hostinger_recovery_allowlist_discovery.sql` adds **seven planned** commands to the registry, without activating Executors and without modifying the target allowlist.
- Categories: `hostinger_recovery_database_inventory`, `hostinger_recovery_control_store_plan`, `hostinger_recovery_database_create`, `hostinger_recovery_environment_binding_plan`, `hostinger_recovery_environment_binding_apply`, `hostinger_recovery_grants_plan`, `hostinger_recovery_grants_apply`.
- Each requires later provider entitlement verification, target-level allowlist approval, exact plan, separate authorization, a certified bounded executor, durable receipt and independent readback.
- No generic SSH or raw SQL expansion.

### E. Catalog contract correction in this handoff
The forward Admin-tool catalog reconciliation migration `20261008_admin_local_connector_target_catalog_alignment.sql` was corrected to describe JSON-only installer diagnosis and HTTP 410 for the retired raw BAT path. It no longer advertises a credential-producing BAT operation through `listAdminTools`.

## 5. Explicit MCP catalog schema blocker

**Observed external error:** `schema_contract_not_ready: mcp_catalog_level`.

**Repository authoritative guard:** `http-generic-api/mcpCatalogSchemaGuard.js`. It expects `mcp_catalog_level` on **both** `admin_platform_endpoint_tools` and `tenant_platform_endpoint_tools` in the **Runtime** database, using `DB_NAME/DB_USER`. Fixed repository migration: `http-generic-api/migrations/20260815_custom_gpt_mcp_catalog_levels.sql`, SHA-256 `528143808adac23eb457058c4c34dd95c4c5d462bca9ac4b170b1f19b2006681`.

A reported `schema_contract_not_ready` is not sufficient alone to authorize `ALTER TABLE`. Separate these root causes using **read-only** evidence:
1. Confirm exact deployed source SHA, runtime class, `DB_NAME` and `DB_USER` identity via `DATABASE()` and `CURRENT_USER()`, **without exposing credentials**.
2. Query information_schema for both required tables and column presence; confirm missing vs inaccessible vs wrong DB.
3. Inspect migration ledger and exact checksum; classify empty, partial, nonempty and drift. Never blindly rerun full migrations.
4. If the exact schema migration is required, generate a separate immutable plan with environment, db-role, SHA, checksum, owner approval and explicit apply. This is a **Runtime** migration, not Governance, Runtime Persistence or a new Recovery Control Store.
5. Same-cycle independent readback: both columns present, supported indexes, expected projection, `listAdminTools` and `listAdminSystemTools` operational, plus a no-secret `repo_inspect` smoke probe.
6. Only **after** catalog readiness may future planned recovery tools be discovered as runtime tools; catalog readiness does NOT enable the seven Hostinger commands.

If the runtime DB itself is unconfigured or unreachable, repair the **database identity/privilege** issue first. Do not reinterpret the catalog error as Hostinger database-create permission.

## 6. Recovery Control Store dependency order

```text
Hostinger connected-system inventory (observed active; read-only)
  -> hosting account / website / capability entitlement proof
  -> no-secret database inventory: absent / empty / nonempty / partial
  -> EXTERNAL independent bootstrap approval for DB/user creation if genuinely absent
  -> exact provider create-if-absent + host resource readback
  -> independently authorized managed credential intake
  -> safe environment binding (separate operation; no blind full-replace)
  -> Recovery Store connectivity + exact runtime identity
  -> existing productionRecoveryControlStoreBootstrap status / immutable schema plan
  -> separately approved schema apply + same-cycle readback
  -> server-managed Production Recovery binding
  -> durable full inspection / role provenance
  -> separate governance and runtime_persistence repairs where required
  -> exact grants readback
  -> ordinary migrations and activation checks.
```

**Do not build a second Recovery Kernel.** Reuse `productionRecoveryControlStoreBootstrap.js`, `recoveryControlDb.js` and `productionRecoveryAuthorityPreflight.js`. The existing bootstrap module can initialize schema on an already connected independent DB; it explicitly **cannot** create the underlying database or modify Hostinger environment variables.

### Hostinger provider API risk
Official Hostinger docs describe `POST /api/hosting/v1/accounts/{username}/databases` to create database + dedicated user, **not** proof of this account's entitlement. `GET /nodejs/builds/settings/env` masks secret values; `PUT` is a **full replacement** and restarts Node.js. It is unsafe to merge new `RECOVERY_CONTROL_DB_*` values using masked GET output or claim an atomic patch. Source safety predicates correctly keep `execution_allowed=false` pending an independently verified authoritative source, exclusive lease and revision/compare-and-swap safety.

## 7. GitHub CI / generator / source acceptance (point-in-time)

For HEAD `d31a6830af4aad701ce49320e2fef335d9add8fb`, GitHub Actions returned **36 workflow runs**: **3 success**, **8 failure**, **23 queued/pending/in progress**, and **2 other completed**. A partially stuck CI queue does not justify overlooking completed failure.

| Completed failure | Failed step / issue |
|---|---|
| E2E Phase Governance | Classify and validate parallel PR mode |
| Repository Tool Lifecycle Governance | Enforce repository tool lifecycle |
| Frontend surface dispatch | Enforce structured generator-contract decision |
| PR Generated Artifact Refresh | Enforce derived-state closure before legacy artifact evaluation |
| CI: Syntax Check | Enforce Runtime data lifecycle classification; upload Staging migration contract evidence |
| Derived State Closure | Verify environment impact and migration compatibility closure |
| Policy Objection CI | Evaluate dynamic semantic repository fixed point |
| Docs Agent | Run failed; no jobs shown in first-page job readback |

The existing deep-audit handoff reports **48/48 source-oriented isolated checks**, not a native test certification. Complete real Node, PowerShell/Windows, YAML generator byte parity, MariaDB/MySQL schema tests, Cloudflare fault injection and rollback tests on an **exact immutable candidate**. As other sessions may push to the branch, rerun all results on its latest SHA.

## 8. Priority risk register and closure gates

| Priority | Open issue | Exit evidence |
|---|---|---|
| P0 | Production create-DB/user and env binding not proven for current Hostinger account | Provider/account-specific entitlement + exact website/host proof |
| P0 | Recovery Control Store missing/unready; Production bootstrap deadlock | Separate external DB create, schema bootstrap, durable readback |
| P0 | `mcp_catalog_level` catalog contract not ready | Runtime identity + two-column readback + tool functional smoke |
| P0 | Full-replace Node env API risks deleting unknown secrets and restarting service | Exact authoritative inventory, external lease/revision fence, separate approval |
| P0 | Physical hardware/generation not independently attested | Nonexportable challenge-response bound to active generation |
| P1 | Durable recovery budgets, idempotency, partial rollback proof incomplete | Cross-process leases and fault-injected durable receipts |
| P1 | Legacy device/connector compatibility | Signed migration path, canary and rollback tests |
| P1 | Installer token in URL can enter reverse proxy logs | Token log redaction and short-lived single-use verification |
| P1 | CI has real completed failures | Independent correction/evidence for each failed step |
| P1 | OpenAPI/GPT generated artifact byte parity not proven | Deterministic generated artifacts with exact SHA readback |

## 9. Handoff action plan (no Production writes authorized in this report)

**Phase A — readonly facts:** Confirm current managed Hostinger connected system + target identity; obtain a separate source-signed proof of Hostinger API capability, hosting account and exact website binding. Diagnose MCP schema using existing read-only schema guard. Confirm zero-installations semantics separately from local connector devices.

**Phase B — repository acceptance:** Close the 8 observed failure classes, regenerate derived OpenAPI artifacts using canonical generator (not manual patches as authority), native Node/PowerShell/SQL suites, and every staging negative/rollback scenario. Pin candidate SHA.

**Phase C — provider plan-only:** Certify the seven commands individually in a bounded Hostinger adapter. Keep target allowlist unchanged until a separate reviewed authorization. Read current DB inventory; reject nonempty/mismatched objects, missing scopes or host drift. Preview DB, env, grants as **three separate** immutable plans.

**Phase D — governed Production request:** Approval 1: database create only if absent; readback. Approval 2: credential/reference binding through a safe independently certified mechanism; readback. Approval 3: Recovery Control Store schema bootstrap using its **existing** module/typed confirmation; readback. Remaining roles/grants separately. Stop on unknown outcome; no automatic replay.

**Phase E — closure:** Same-cycle Production deployment SHA, store connection/schema, MCP functional tools, durable authority, device generation health, and independently audited rollback receipts. Only then consider merge or release promotion.

## 10. Operating rules / prohibitions
- No `main` or `Production` merge, deploy, DB/user create, env replace, raw SQL/SSH, grant or secret read in this handoff.
- Do not reuse historical `mohammedlap`, any guessed replacement hostname, or a shared admin endpoint as a physical device.
- `active` connection != active installation != valid provider capability != authorized Production mutation.
- `mergeable=true` != passing checks != live acceptance.
- Unknown/partial write results require **readback and reconciliation**, not automatic retry.
- Do not log/export database passwords, Hostinger tokens, SSH private keys, raw env values or signed installer links.

## 11. Reference entry points
- [PR #8461](https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/pull/8461)
- `docs/runbooks/pr8461-deep-audit-handoff-20261009.md`
- `docs/runbooks/hostinger-recovery-allowlist-expansion-pr8461.md`
- `specs/009-local-connector-reachability-recovery/pr8461-adversarial-closure.md`
- `specs/014-governed-hostinger-storage-orchestration/pr8461-recovery-provider-contract.md`
- `http-generic-api/mcpCatalogSchemaGuard.js`
- `http-generic-api/migrations/20260815_custom_gpt_mcp_catalog_levels.sql`
- `http-generic-api/productionRecoveryControlStoreBootstrap.js`
- `http-generic-api/hostingerRecoveryCapabilityDiscovery.js`
- Official Hostinger API: https://developers.hostinger.com/

**Delivery verdict:** PR source delivered; Hostinger registration exists in the supplied observed inventory; requested Production provisioning capability and MCP Runtime schema readiness are **not certified**. This is a controlled handoff, not operational closure.
