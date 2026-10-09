# Post-#8461 operational recovery acceptance — 9 October 2026

## Boundaries

**Merged source:** `main@f9d80998ca3fce852d47465dbe990a8c08458462`. This follow-up is **source-only** and creates no Hostinger DB, user, password, production environment replacement, SSH write, hardware attestation, deployment, or schema migration. An active SSH registered connector is not a Hostinger account management API grant.

The new tests and modules deliberately distinguish **source acceptance** from **real Production or Staging acceptance**. Never promote a positive synthetic mock to actual provider entitlement or a physical Windows device certificate.

## Separation of duties and independent gates

| Lane | Implemented on this branch | Mandatory operational proof still missing |
| --- | --- | --- |
| GitHub server policy | The existing repository policy controller + merged Constitution define a strict `Derived State Closure` check. Branch protection was observed `protected=false`. | Owner/admin token with GitHub Rulesets administration scope; read back effective branch targets, bypass actors, required check producer, strict CI and push prevention. **No Ruleset apply from this PR**. |
| Hostinger databases | `hostingerRecoveryReadOnlyPlanner.js` implements the documented bounded provider GET via managed-token source, rejects 401/403, redirects, duplicate/paginated/unknown shapes; creates nonexecutable SHA-256 preview. | Bind an independently managed Hostinger API credential and exact account. Verify inventory against provider and account permissions, then create a **separate** exact-scoped write planner/executor, owner approval, durable lease, user secret intake, confirmed database/user/grants and readback. `hostinger_ssh_prod_platform` alone is insufficient. |
| Hostinger Node.js env | Existing `assessHostingerNodeEnvReplacement` forbids values masked by Hostinger's list endpoint. | Complete trusted vault snapshot, every original key/value, compare-and-set or serialized host lease with same-cycle revision proof, exact approved diff, canary and rollback. Hostinger's PUT **replaces the complete set and restarts**; no implicit apply. |
| Runtime MCP Catalog | `mcpCatalogRecoveryDecision.js` interprets same-session SQL evidence and separates missing column vs unknown permissions/identity, without executing DDL. | Call Runtime principal/DB live, inspect both endpoint tool tables and required `mcp_catalog_level` column, compare migration SHA, issue governed exact DB plan, apply once only after approval, independent schema and catalog readback. |
| Local Connector | `deviceGenerationChallengeVerifier.js` proves exact-scope ECDSA key **possession** and requires durable single-use nonce store. `adminLocalConnectorTarget.js` no longer trusts `deviceGenerationAttested=true`. | Discover real active physical Windows device; same generation key enrollment; hardware-backed **nonexportability attestation from trusted issuer**, durable nonce transaction, native Service/Task, authenticated command success, revoked/cross-tenant negatives, tunnel ownership, Staging rollback. No auto-fallback to stale aliases. |
| Governance schemas | No production migration in this branch. | Exact Recovery Control Store DB role and 17-table object names/grants; Migration 225/1051 dry run, MariaDB replay, fault injection, signed ledger and source/host/runtime SHA readback; independent Production controller approvals. |
| Production #8460 | No production deploy or branch promotion. | Only after above evidence and GitHub policy server readback; separate exact-candidate production promotion authorization and reversible rollout. |

## Operation sequence (fail-closed)

1. **GitHub:** obtain live **server-side** Ruleset/protection readback through authenticated repository administration. Do not treat `mergeable=true`, branch policy JSON or a CI workflow file as server enforcement. Stop if branch remains unprotected.
2. **Hostinger provider discovery:** obtain approved API token from the managed vault on the **server**, never through user prompt parameters, then run only `GET /api/hosting/v1/accounts/{username}/databases`. Compare bounded, non-paginated list with exact account-prefixed recovery database. Stop on 401/403, pagination, schema ambiguity, or missing source authority. Preview SHA is a proposal, not write permission.
3. **Hostinger provisioning:** independently certify account-level database CREATE and role grants; explicit owner step-up for an exact target and secret reference; a distinct executor with no SSH/raw SQL fallback; bounded create receipt + inventory/readback including user/grant proof and compensating rollback. Until then `execution_allowed=false`.
4. **Runtime Catalog:** run `DATABASE()` and `CURRENT_USER()` and both table metadata/projection reads **in a single leased DB connection**. If DB/principal mismatches or table access denied, **no migration**. If field definitely missing, pin migration `20260815_custom_gpt_mcp_catalog_levels.sql` SHA and request DDL approval; replay and readback before switching catalog status to healthy.
5. **Windows Connector:** register a fresh P-256 generation public key bound to user/tenant/device/config/generation. Sign a bounded challenge; consume it in a durable atomic nonce store; reject stale aliases and wrong scope. **Signature is not TPM attestation**. Without independently verified hardware key nonexportability, never mark `RECOVERED`.
6. **Staging acceptance:** real Windows execution + MariaDB migration replay + browser canary, independent same-cycle readback of every operation, 401/403 negatives, rollback proof, no source/host drift.
7. **Production:** a *new* owner-approved exact-head promotion after all prerequisites; no automatic SSH/DB/env mutation.

## Source regression commands

From the repository root (Node.js 22):

```sh
node http-generic-api/test-hostinger-recovery-readonly-planner.mjs
node http-generic-api/test-mcp-catalog-recovery-decision.mjs
node http-generic-api/test-device-generation-challenge-verifier.mjs
node http-generic-api/test-admin-local-connector-target.mjs
```

## Claims forbidden without external certificates

- `hostinger_ssh_prod_platform: active` **does not imply** `hostinger_database_create: allowed`.
- `/health: ok` **does not imply** authenticated Local Connector success or current key generation.
- `migration_apply_required: true` **does not imply** DDL approved or applied.
- `inventory_readback_proven: true` **does not imply** Hostinger CREATE entitlement.
- A passing GitHub CI job **does not imply** Production schema readiness, a live Windows device, or a GitHub branch Ruleset.


## Adversarial objection register (source review, 9 October 2026)

The following are **not** release certificates. Each issue is resolved only at the indicated evidence authority. A test reporting an internal successful mock does not constitute provider, device, DB, or server Ruleset readback.

| Severity | Objection / concrete counterexample | Source treatment | Residual independent proof |
| --- | --- | --- | --- |
| Critical | Hostinger database GET returns only first 15 rows while `meta.total=100` and recovery DB is on page 2; absence is falsely inferred. | The bounded inventory now rejects any incomplete `meta.current_page/per_page/total` coverage, including missing metadata, 206, unknown continuation or unmatched total. It never creates a DB. | Live GET proof and complete paginated retrieval/independent account privilege certification. |
| Critical | Caller asks to use API token belonging to hosting account A to inventory account B. | Transport binds immutable `boundAccountUsername`; exact account mismatch blocks before network. DB rows must have target account prefix. | Provider-managed credential/account binding, website-domain-to-account readback and CREATE entitlements. |
| Critical | A caller supplies their own public key and valid signature and claims it belongs to the target device generation. | The verifier ignores caller-supplied public keys and demands active, nonrevoked, nonarchived exact-scope key returned by injected trusted server registry lookup. | Provision durable registered key registry, fresh Windows key attestation and post-enrollment negative tests. |
| Critical | Key is revoked or replaced between ECDSA verification and challenge consumption. | Atomic `consumeNonce` contract now includes exact generation scope, issue/expiry timestamps and registered SPKI SHA-256 fingerprint. Wrong/revoked generation fails before consume. | Implement/verify serializable DB transaction checking nonce and active key fingerprint simultaneously; fault-injection and concurrent replay tests in live Staging. |
| High | Cached `mcp_catalog_level` from a reused connection is presented as same-cycle schema readback immediately after column removal. | `readMcpCatalogSchemaReadinessSafe` bypasses the 30-second column cache and freshly probes both allowlisted tables on a leased Runtime connection. | Live Runtime `DATABASE()`, `CURRENT_USER()`, metadata/projection authority, migration/checksum and rollback readback. |
| High | Metadata is hidden by SQL permissions, wrong DB or inaccessible table; the platform requests a migration. | Recovery classifier requires verified Runtime DB/user and both table projections, distinguishes `diagnosis_blocked` from `migration_proposal_only`. `migration_apply_allowed=false` in every state. | DBA privilege inventory; exact SHA migration plan, independently approved DDL executor and replay ledger. |
| High | HTTP 200, valid ECDSA, successful `/policy`, or active SSH connector is used to declare physical device recovery or Hostinger DB grants. | Every such signal is separately labeled; hardware nonexportability and provider CREATE entitlement remain **false**. `RECOVERED` cannot be promoted from caller-supplied boolean. | Current hardware-backed generation, managed credential epoch, non-exportability attestation, provider-specific grants readback. |
| High | Hostinger Node.js env `PUT` overwrites variables returned as masked by GET. | Existing env replacement guard refuses any PUT absent full unmasked managed snapshot and separately certified compare-and-set semantics. | Trusted secret vault, serialized per-site lease, before/after key comparison and host rollback proof. |
| High | GitHub policy file claims `block_direct_push=true`, while live `main` returned `protected=false`. | The PR does not weaken the repository Constitution or edit protected branches. Source CI is not equivalent to server Ruleset enforcement. | Independent admin-authorized Ruleset apply/readback, exact required checks and bypass audit. |
| High | A test appears green on an older SHA while a newer PR HEAD introduces an attack path. | Every merge judgment must pin the newest exact HEAD and native current-phase E2E, test-authority, policy objection and Derived State evidence. | Single-owner exact-head review and trusted attestor required prior to source merge. |
| Medium | A hash of schema classifications or inventory is reused as authorization to mutate a different host, DB or deployment generation. | Diagnostic SHA and Hostinger preview SHA are **non-executable suggestions**, and every executable permission remains false. | A separate signed environment-bound expiring plan with one-time authorization and same-cycle post-operation readback. |
| Medium | A stale Windows hostname such as a previous alias is silently promoted to active device. | Canonical user/tenant/device/config generation binding and explicit target selection remain required. | Real discovered current device identity and native Windows Service/Task acceptance. |
| Medium | An API or browser response is so large that JSON extraction or the Tool Catalog chunk overflows. | Hostinger GET is byte bounded and schema validated. This source feature does not claim live Admin Tool Catalog chunking is repaired. | Runtime chunk/continuation tests, bounded pagination, request timeout and full successful catalog readback. |

### Nonnegotiable release-state distinctions

- **Source merged:** Git commit and required workflow result exist; says nothing about Hostinger/DB/Windows operations.
- **Source design ready:** tests and manifest accept bounded preview/diagnosis; still no network/provider certificate.
- **Provider read-only verified:** exact live account and source credential authority were independently read back; does **not** confer CREATE/ALTER/GRANT.
- **Runtime recovery certified:** device/Hostinger/DB write executor has exact scope, credential vault, independent owner approval, durable execution and rollback receipts; none of these is implemented by this source PR.
- **Production promotion certified:** only after release-candidate SHA, effective server Rulesets, staging canary, exact database grants, ledgers for migrations 225/1051 and independent Hostinger/Windows readback.

### Acceptance checkpoints requiring external access

- `Hostinger`: bind server vault token to actual username, inventory entire account without omission, then prove DB creation privilege through provider read-only capability/entitlement API or explicit governed provisioning workflow. Do not use SSH active flag as proof.
- `MCP Runtime`: resolve actual DB principal and host connection; do not infer `mcp_catalog_level` migration from missing INFORMATION_SCHEMA results alone.
- `Windows`: resolve the **currently active** machine and exact device generation; complete hardware issuer verification and a transactional nonce store; reject historical aliases.
- `GitHub`: admin verifies effective Rulesets for `main` and `Production`, then applies typed minimal-diff policy in a separately authorized policy-controller operation.
- `Staging / Production`: perform Native PowerShell, MariaDB replay, browser acceptance, governed release promotion and rollback only after prior evidence; no deployment from this PR.

## Operational scenario expansion — 60 cases in six independent acceptance lanes

Canonical source: `http-generic-api/config/post8461-operational-scenario-matrix.json`. It is validated in `http-generic-api/test-post8461-operational-scenario-matrix.mjs` and registered in the PR's E2E + Test Authority. All records are **source-level negative contracts**, not proof of live operations.

| Lane | Cases and operational coverage | Safe terminal outcome | External acceptance still required |
| --- | --- | --- | --- |
| Hostinger | 15: inactive provider; expired/incorrect account token; 401/403; 429; redirect; HTTP 206; more than one page; concurrent inventory mutation; over-capacity; mixed-account rows; existing/missing DB; masked env PUT; no write executor | Read-only inventory or `blocked`/`retry_later`; never CREATE | Account authorization, managed token vault, exact website ownership, DB CREATE/grant plan, secrets, issuer, rollback |
| MCP | 8: DB mismatch; principal mismatch; metadata permission denied; missing column; full readback; stale cache; half migration; oversized Tool Catalog | `ready_verified` or migration *proposal* only after protected SQL collector | Native Runtime session, migrations, bounded catalog chunk continuation, independent ledger |
| Windows Device | 9: old hostname; device offline; protected command 401; wrong tenant; attacker key; revoked generation; nonce replay; receipt expiry; no hardware proof | No `RECOVERED` without TPM/non-exportability and independent command | Native Windows key + active device enrollment + durable nonce transaction + Task/Service + Browser |
| DB migrations | 3: 17-table schema absent; Migration 225 partial; Migration 1051 ledger mismatch | Hold DDL and production authority | Exact DB role, privilege matrix, MariaDB replay/fault-injection, signed readback |
| GitHub Rulesets | 3: main unprotected; policy API 403; SHA changed after owner approval | Hold auto-merge and Production policy | Admin-owned server-side Ruleset apply and exact effective protection/readback |
| Release | 4: Staging rollback unverified; Production SHA drift; browser-data canary mismatch; Production rollback receipt missing | No Production promotion | Explicit approval, exact release SHA, parity, canary, readback and rollback |

### Hostinger pagination and concurrency

Official Hostinger `GET /api/hosting/v1/accounts/{username}/databases` supports `page` and `per_page` with maximum `per_page=100`. The read-only planner now uses deterministic page numbers, a hard five-page/500-database cap, and a second full scan when more than one page exists. It rejects count drift, invalid page metadata, duplicate names, cross-account rows, 206, redirects, 401/403, 429, transport failures and size overflow. A two-pass equality check does **not** confer transaction-level consistency: if a write executor is added later, it MUST reacquire provider state under a separate governed lock before any create.

Never auto-repeat 429 requests within a shared account rate-limit budget, and never follow server-advertised continuation URLs with a bearer token.

### Scenario ownership and evidence collection

- Evidence classes: `source_unit`, `staging_native`, `provider_account`, `runtime_db`, `device_attestation`, `github_server_policy`, `production_change`. Do not convert any of these into another.
- When an external provider is unavailable, return `blocked` or `retry_later` with a bounded reason. No `success`, `ready` or `recovered` without a same-cycle readback.
- A completed read-only inventory establishes a bounded observation only; `inventory_readback_proven=false`, `website_identity_verified=false`, and `execution_allowed=false` remain explicit until independently attested.
- Real operational certification must attach exact scope (account/site/tenant/device), signed identity and nonexportable key where appropriate, evidence source, issued/expiry times, runtime commit SHA, mutation and inverse receipts, and same-cycle readback.
- Retest the negative paths after credential rotation, host restart, schema drift, service reconnection, Release Cut changes or provider permission changes.


Additional Production-log scenarios: see [the Hostinger Production release preflight](./pr8471-production-promotion-preflight-from-hostinger-logs-20261009.md), including schema startup fail-open, manifest-enforcement state, OAuth and audit writes, Production source divergence and auto-deploy. These are part of a 60-scenario source matrix, not a live certification.
