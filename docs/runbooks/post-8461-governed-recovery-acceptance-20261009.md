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
