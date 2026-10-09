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


## 12. Follow-up implementation cycle — 2026-10-09 (source-only)

**Evidence boundary:** This cycle changed the PR branch only. No live Hostinger API/SSH call, SQL mutation, runtime database migration, host environment replacement, grant, rollout, Production deploy, or merge occurred. Source-oriented V8 checks are not native Node/MySQL/MariaDB/PowerShell or browser acceptance.

### A. MCP Runtime schema guard hardening
- `mcpCatalogSchemaGuard.js` now treats a zero `information_schema.columns` count as ambiguous until a whitelisted `SELECT mcp_catalog_level FROM <catalog_table> LIMIT 0` read-only probe establishes the column state.
- `ER_BAD_FIELD_ERROR` confirms a missing column. `ER_NO_SUCH_TABLE`, access denial, or an unknown metadata/probe error do **not** confer migration authority.
- In a two-table contract, migration recommendation is blocked if either table remains unknown/inaccessible; an invalid Runtime identity suppresses migration advice even if the schema of the wrong database appears deficient.
- The tools' no-secret not-ready projection only declares `migration_apply_required=true` for a verified missing-field condition.
- Regressions were added for confirmed missing, wrong Runtime, inaccessible table, absent table, metadata false negative, mixed certainty, and safe error projection. They are source tests, not live Runtime readback.

### B. Hostinger discovery and safety semantics
- `assessHostingerNodeEnvReplacement` can complete an evaluation without claiming successful or permissible execution. `ok=false`, `evaluation_completed=true`, `candidate_ready=false`, `execution_allowed=false` when safeguards block.
- A disabled Hostinger connected system can no longer report `discovery_ready` or `plan_candidate` even if the planned catalog command is listed.
- The seven recovery commands remain catalog-only; no executor/entitlement/target approval has been activated. No generic environment PUT is safe without complete unmasked authoritative values, a bounded host lease/revision mechanism, exact approval and independent readback.

### C. Installer epoch secret-boundary correction
- Removed reliance on global `BACKEND_API_KEY` from `installerCredentialEpoch.js` and its test fixture.
- Epoch HMAC now uses the already-enrolled connector secret as its key and binds exact device/config/user/tenant, connector secret and Cloudflare token. Credential rotation invalidates the previous epoch.
- This changes the derived epoch compared to the earlier nondeployed PR candidate: signed installer tokens issued under that earlier source must be reissued. Do not silently accept old epochs or use an administrator/backend shared key as a device identity.

### D. E2E, frontend, and Configuration Drift governance
- Added explicit `.changes/e2e/pr8461-device-hostinger-recovery-maintenance.json` with `delivery_mode=single_pr`, secret-free source-only synthetic scope, concrete tests, and exact changed-path coverage.
- Classified `POST /platform/remote-runtime/hosting/recovery-allowlist/discover` as a bounded `read_action` in `frontend-surface-policy.json`, and registered the tests in the command manifest and frontend evidence registry.
- Downloaded the exact Repository Tool Lifecycle CI artifact from workflow run `37854733570`. Its **three** catalog findings were: one new installer `BACKEND_API_KEY` secret candidate, and unregistered `connector.config.id` / `connector.device.id`. The **five** drift findings were the three installer/test `BACKEND_API_KEY` references and the two connector identity refs.
- Addressed these exact source findings by removing the global key from the installer and tests, registering the two non-secret device identity settings in the Config Catalog, and adding only their reviewed non-secret fingerprints to the permanent drift extension. No suppression or authority expansion was used.

### E. Verification and remaining gates
- Targeted dynamic checks against fetched source passed: **13/13** MCP/Hostinger first-cycle behavioral cases, **9/9** registry/secret-boundary checks, and **5/5** second-cycle MCP/Hostinger/E2E cases. The fixtures mocked providers and database responses; these are **not** native DB, remote host, or deployment certificates.
- On the latest checked candidate before this report update, `f932dd58640816511e6ff560dc67da10e9318bb6`, CI still had pending/queued checks and Docs Agent had failed without job-level details. Do not count unresolved jobs as PASS.
- Still P0 and outside this source-only work: live Hostinger account entitlement; external independently governed Recovery Control Store provisioning and connection; actual Production Runtime schema/privilege readback and if needed separately approved migration; independent device-generation attestation; staging fault injection / rollback; exact generated artifact convergence; native multi-runtime certification.
- Keep PR Draft/Open and `main` unchanged until current exact-head functional tests and operational authority/readbacks are certified. A reported `mergeable=true` is not release acceptance.

**Cycle result:** source-side defects and documented CI drift findings were addressed; **full operational closure has not been achieved or claimed**.


## 13. Objection-driven replay and authority review — 2026-10-09

This section supersedes any earlier implication that registering a Hostinger command provides operational provider permission. Every finding below is scoped to a bounded source-only PR; Production remains untouched.

| Objection / attempted bypass | Implementation or release decision | Evidence / outstanding authority |
| --- | --- | --- |
| Fresh Runtime rebuild lacks a connected Hostinger account, so conditional command INSERTs vanish | Removed `WHERE EXISTS (SELECT ... connected_systems ... system_key='hostinger_ssh_prod_platform')` from all seven **planned-only** command registrations. Capability metadata is site-independent; exact target verification remains in live discovery | `20261009_hostinger_recovery_allowlist_discovery.sql`; new replay regression. Real MariaDB empty-rebuild readback is still required |
| Multiple Staging entrypoints replay different seed sets | Canonical role manifest, Auto Deploy and One-Click now carry an identical ordered nine-file seed chain, including both PR8461 migration files. Added equality regression to catch future drift | `test-hostinger-recovery-seed-replay.mjs`, `test-staging-auto-deploy-contract.mjs`, `test-staging-one-click-autopilot-core.mjs`, `test-staging-database-readiness-repair.mjs`, `test-staging-schema-bundle-builder.mjs` |
| Replaying a migration inserts duplicate command identities | Schema defines `UNIQUE (plugin_key, command_key)`; seven INSERTs are idempotent with bounded `ON DUPLICATE KEY` clauses. No connector, token, or target is created | Migration foundation + source assertions; verify MariaDB second replay and exact row cardinality before a rebuild is certified |
| Admin discovery is enabled just because the seed was inserted | Admin registration remains `is_enabled=0`. Activation requires independently accepted Staging route and role tests | SQL static check. The live route acceptance has not happened |
| Catalog `planned` (or manually marked `active`) means the provider can dispatch | Discovery always reports `discovery_ready=false`, `plan_candidate=false`, `plan_allowed=false`, `dispatch_ready=false`, `execution_allowed=false`; `catalog_visible` is metadata only | `hostingerRecoveryCapabilityDiscovery.js`, active+planned regression; source V8 checks were PASS |
| Old device name/alias silently becomes current execution target | Exact canonical config/device identity and live lifecycle/heartbeat remain mandatory; stale or ambiguous aliases cannot authorize an installer/repair | Existing scoped device resolver tests. No live device attestation in this cycle |
| Stale installer token works after credential rotation | Device-scoped credential epoch derived from enrolled connector secret and exact scoped identity; old token fails after rotation | Installer tests; tokens from pre-change PR candidate must be reissued |
| Runtime metadata zero count means column absent | Whitelisted `SELECT ... LIMIT 0` distinguishes `ER_BAD_FIELD_ERROR` from hidden metadata, absent table, access denial and unavailable DB | MCP schema tests. Do not apply any Production DDL without correct Runtime DB identity |
| A partially verified two-table MCP catalog means full migration required | Any unknown or inaccessible table suppresses whole-schema migration guidance | `mcpCatalogSchemaGuard.js` test matrix; independent Runtime role readback pending |
| Hostinger SSH implies database creation/grants/hPanel authority | No: connector SSH capability, hosting account entitlement and provider control-panel permission are separate typed capabilities. No fallback to shell/SQL/File Manager as an implicit DB-control authority | Catalog-only contract; live account-scoped entitlement verification pending |
| Hostinger env GET values can be round-tripped into PUT | No: official GET masks values, and PUT replaces the whole set and restarts the Node.js process. The current safety predicate always rejects replace until full secret-source, exact-host and CAS/readback authority is certified | https://developers.hostinger.com/; `assessHostingerNodeEnvReplacement` returns `execution_allowed=false` even if other checks pass |
| Recovery DB creation succeeds without an independent Control Store | No: absence of an independent durable store is a hard authority blocker, not permission to create credentials/grants or self-approve | Hostinger DB-create predicate; Production Control Store not provisioned or attested |
| CI queue/Docs Agent failure can be interpreted as implementation PASS | No. A queued/skipped/missing job is not a successful certificate. Native Node, MariaDB, Windows Staging, browser and generator checks remain separate exact-head gates | GitHub PR #8461 workflow statuses; no green blanket assertions |
| Generated artifact diffs can be manually discarded to force convergence | No: frontend OpenAPI, remote-MCP scope and work-map outputs must be regenerated by their registered authorities and checked against an exact candidate, never suppressed or hand-patched | Generated Artifact Refresh / Derived-State Closure outstanding |
| Production database schema can be inferred from repository migration text | No: independent connected Runtime identity, table/column census, principal grants, and exact bound source SHA must be read back live | Production readback pending, no SQL mutation performed |
| Any failed step can be blindly retried | No: unknown Hostinger/provisioning outcomes require idempotency key, immutable receipt, lease/fence and same-cycle provider readback before retry/compensation | Provider executor absent; runtime certification and rollback pending |
| Site-specific hardcoded provider identity is acceptable as a generic registry prerequisite | No: core planned capability metadata is independent of an account name; site binding occurs only at live resolved target+tenant+environment scope | Seven command seeds no longer mention the old platform account key; regression guards that invariant |

### Acceptance boundary

**Source correction:** completed for the objections explicitly marked as implemented above. Focused source evaluation passed 14 metadata/seed checks and 4 provider-discovery negative cases. These do not certify native PHP/Node/MariaDB/PowerShell or Hostinger runtime behavior.

**Release blockers (not waived):** exact-head CI/evidence convergence; clean disposable MariaDB zero-object rebuild and second replay; Staging same-cycle readback and rollback; live device identity attestation; Hostinger account-specific provider entitlement; external Recovery Control Store; Runtime catalog migrations/grants only after independent plan/approval; verified Production source/DB identity and privilege matrix.

**Forbidden until those gates pass:** merge to `main`, Production promotion, arbitrary SSH fallback, real environment PUT, database creation/grants, SQL migration apply, secret value export, marking capabilities executable, or claiming operational closure.


## 14. Canonical catalog runtime row readback (source integration)

An additional acceptance boundary was implemented after the objection ledger:

- Canonical `staging-database-role-migration-manifest.json` declares **eight** read-only, exact-cardinality rows: seven Hostinger catalog commands required to remain `status=planned`, plus the disabled Admin discovery tool (`is_enabled=0`).
- `Clone-StagingDatabases.Legacy.ps1` now runs `Assert-CanonicalCatalogRows` after initial seed import **and** when evaluating a previously completed import. It validates the manifest contract, table whitelist, bounded row count (1–64), strict key grammar, duplicate declarations, required non-active status, and exact `COUNT(*)=1` from the local Staging Runtime DB.
- The importer persists `catalog_registry_row_counts` within `canonical_seed_readback`, and returns the equivalent readback in completed-state checks. A missing, duplicated or unexpectedly activated command blocks import acceptance rather than silently returning success.
- The importer adds no provider call, remote shell, secret retrieval, Production access, environment mutation, database creation or grant.
- `test-hostinger-recovery-seed-replay.mjs` now asserts row-contract parity and importer integration.

**Verification gap:** The source wiring is committed, and source-level checks can inspect it. An actual fresh ephemeral MariaDB 11.4 rebuild, second replay, completed-state reopen and negative fault injection must still run and yield exact receipts. Do not interpret unexecuted PowerShell as a runtime certificate.

This gate is **provider-target-independent**: it validates canonical catalog row semantics, not the existence of a particular registered Hostinger account.


## 15. Exact CI artifact-driven closure — follow-up (2026-10-09)

**Provenance:** Downloaded canonical workflow evidence from the completed PR #8461 candidate `b58650c10a0d98038892fe174abf48762dc34a6f`. Its 36 workflows concluded: 22 success, 13 failure, 1 skipped. These conclusions apply to that SHA **only**; later commits require separate readback.

### Root causes and committed source remediations

1. **Unit and integration: two failing installer assertions.** `test-connect-routes.mjs` expected obsolete SQL, while runtime now constrains exact tenant + device, active lifecycle, nonrevoked and nonarchived records, and uses `LIMIT 2` to deny ambiguous matches. Updated the test to assert stronger current route semantics rather than weakening the runtime gate.
2. **Custom GPT / Staging Admin schema: Tenant Core candidate unmapped.** New `discoverHostingerRecoveryAllowlist` is tagged `platform-plugins` but strictly `admin_backend`, with both GPT exclusion flags. Added one explicit reviewed `tenant_core.candidate_policy.exclusion_records` entry (Owner: remote-runtime); did not add a Tenant Core source marker or expose the Admin endpoint. Added a test that enforces the isolation.
3. **E2E Phase Governance: two owned Spec contracts were not changed.** Canonical `e2e-phase-evaluation.json` findings were `e2e_phase_contract_not_changed_with_feature` for `specs/009-local-connector-reachability-recovery/e2e-phases.json` and `specs/014-governed-hostinger-storage-orchestration/e2e-phases.json`. Both current MVP journeys now reference the bounded PR8461 objection evidence without claiming new implementation/Production authority.
4. **Repository semantic fixed point: two unclassified root documents.** Classified only `GPT_Admin_Assistant_Knowledge_Guide.md` and `runtime_confirmation_procedure.md` as documentation evidence in `repository-governance-constitution.json`. No broad wildcard or unclassified-path waiver.
5. **Environment Impact Closure: three unclassified paths.** Added the same two exact root docs to `deployment-branch-policy.json` repository-governance class and `http-generic-api/scripts/governed-migration-runner-legacy.mjs` to shared-runtime (retaining cross-environment certification requirement). Added explicit regression assertions.
6. **Test Authority Closure: seven unregistered new regression tests.** Assigned three Local Connector tests to `local_connector_environment_and_transport_isolation` and four Hostinger/MCP tests to `hostinger_runtime_bootstrap_contract` within the existing test-authority registry; the native manifest remains separate.
7. **Remote MCP OAuth Path Guard: stale denied-mutation registry source SHA.** CI `ci:path-guard` computed `818cac5681cd2ea230a5c0b2f3cdf28c2db022ce74db5190c221db0e9560fdd9` from four generated source OpenAPI subsets, but tracked registry still used `7a9f158589e3774740f7a4912e37578dbc7c5dca6780514305f3307369bb5ccd`. Re-pinned the registry fingerprint to the independently observed CI source SHA **without** changing the 36 denied operation definitions or `write_activation_allowed=false`. The full native semantic equality guard must still pass; a checksum alone is insufficient.

### Adversarial objections and safety treatment

- **Can changing a GPT candidate list accidentally expose Admin capabilities?** No: the route is explicitly excluded and tests require admin-backend security alternatives, no Tenant source marker, and one reviewed exclusion record.
- **Can stale test strings be fixed by reducing tenant isolation?** No: tests assert stricter query predicates, lifecycle/revocation fences, unique readbacks, and token-specific identity.
- **Can unknown repository files be broadly suppressed from governance?** No: exact paths were classified with typed effects; Legacy Migration Runner remains shared-runtime and therefore subject to live-readiness requirements.
- **Can a generated fingerprint be rubber-stamped as a passed policy?** No: its recomputed source value was taken from actual CI output; other deep-equality/coverage predicates remain enforced. Await exact-head verification.
- **Can old results certify the new HEAD?** No: every CI artifact is source-identity-bound, and fresh head checks cannot be treated as success until they complete.

### Still blocked

- Derived State Closure: four blocking artifacts (`frontend_openapi_projection`, `remote_mcp_write_scope_inventory`, `portable_staging_manifest`, `work_maps`) and two observability artifacts (`repository_inventory`, `repository_evaluation`) remain stale until their registered generators/writers produce exact-head readback.
- Exact-head native tests, disposable MariaDB replay, Windows/PowerShell, Staging route, installer token redemption, and browser fault injection require independent certificates.
- Live Hostinger provider entitlements, independent Recovery Control Store, correct Production Runtime DB identity/schema/grants, and per-device generation attestation are not established.
- The connected Remote Desktop Commander device was found offline; no local/remote native test execution was represented as performed.
- Production mutation, secret exposure, DDL/grants, arbitrary SSH, environment PUT, deploy, and merging to main remain forbidden.


## 16. Adversarial source evidence audit — follow-up

**Identity boundary:** GitHub CI for candidate `34f8f316020605bc174be6256a316c2eb1eb4396` reported 23 successes, 11 failures, one skipped and one still in progress at its last check. Latest branch commits supersede that candidate; *do not* transfer its CI status to the new HEAD.

### 16.1 Native syntax regression recovered from Policy CI

- The repository fixed-point report for the prior candidate isolated exactly one unvalidated executable, `autopilot-portable-staging/Clone-StagingDatabases.Legacy.ps1`, with PowerShell parser failure `Missing '=' operator after key in hash literal.`
- Root cause in the previously added Staging catalog readback integration: `$semanticSnapshotReadback = [ordered]@{` was left unclosed before a `foreach` block. This was a real code defect, not a stale test.
- Corrected to `$semanticSnapshotReadback = [ordered]@{}` and added a dedicated source regression in `test-hostinger-recovery-seed-replay.mjs`.
- **Important:** source assertions alone cannot certify PowerShell syntax; require the exact new HEAD's native `powershell_parser` validator to complete successfully before release.

### 16.2 Connector reachability is not Recovery completion

- A prior ordered test suite failed because `test-local-connector-composite-health.mjs` still expected the obsolete `admin_cli.local_connector_self_repair.not_required` event.
- The current runtime intentionally separates `verified_no_repair` and `verification_pending`, requiring independent device-generation attestation before marking recovery accepted. The test now checks both states, `recoveryReadback.operational_verified`, `recoveryReadback.recovered` and the explicit attestation warning.
- Safety objection: deleting this check to pass CI would falsely equate transport reachability with cryptographically proven device identity. No such relaxation was made.

### 16.3 Runtime schema metadata is not SELECT authority

- Previously, a positive `information_schema.columns` count meant `mcp_catalog_level` was accepted as available without testing the Runtime user's effective projection permission.
- The guard now always performs a whitelist-only `SELECT `mcp_catalog_level` FROM `<catalog_table>` LIMIT 0`. This is read-only; no DDL or provider access.
- Positive metadata but a denied projection is `MCP_CATALOG_SCHEMA_PRIVILEGE_DENIED` with `migration_apply_required=false`.
- Positive metadata but `ER_BAD_FIELD_ERROR` is contradictory evidence `MCP_CATALOG_SCHEMA_METADATA_CONFLICT`, **not** an ALTER instruction.
- Hidden/zero metadata but a successful direct projection is valid; hidden metadata plus `ER_BAD_FIELD_ERROR` is the verified missing-column case, still subject to full runtime identity and two-table certainty before any migration planning.
- Added source regressions to the guard and updated the startup-preflight metadata-positive mock. Eight independent source-isolated checks passed across positive/missing/denied/conflict/absent/hidden cases; they do not establish live Production privileges.

### 16.4 Hostinger provider privilege fail-closed matrix

- Exercised 15 isolated source assertions: active vs disabled connected-system state, only recognized command identities, provider/plugin/environment mismatch refusal, provider dispatch and secret-denial invariants, Node environment replacement denial even with nominally satisfied inputs, and database-create execution denial even when the decision predicate is candidate-ready.
- These tests contain no host calls or database mutation. Hostinger SSH, Hosting API database creation, and hPanel/Node environment replacement are distinct entitlements and must not be conflated.

### 16.5 Generated artifacts are not waiveable

- Recent Custom GPT Contract Guard generated 14 expected source-owned surfaces but found stale outputs in all 14 generated OpenAPI surfaces plus the registration manifest and admin schema index. Staging Admin Schema, Frontend Dispatch and Remote MCP inventory fail for related source/output parity reasons.
- The Source of Truth stays `http-generic-api/openapi.yaml`, the registry `canonicals/openapi/custom-gpt-surfaces.yaml`, and registered generators. **Do not hand-edit or suppress derived output checks.**
- Current blocking derived-state families remain frontend/OpenAPI projection, remote MCP scope inventory, portable Staging manifest, and Spec Kit Work Maps; repository inventory/evaluation are separately advisory.
- The Work Map writer is governed by exact-head delegation; do not forge owner authorization, grant implicit write authority or force-merge to bypass it.
- External acceptance remains open: disposable MariaDB replay/rollback, native Node/PowerShell after exact commit, Staging route/browser observations, independent Hostinger provider entitlement and Control Store, Production Runtime DB identity and permissions, and device-generation attestation.

**End state of this review:** bounded code changes uploaded; no Production operation or merge occurred. Full operational closure is **not** achieved and is not being represented as complete.
