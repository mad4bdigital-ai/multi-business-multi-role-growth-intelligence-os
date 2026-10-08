# Hostinger recovery allowlist — PR #8461

## Authority and scope
The source-controlled extension covers the **MAD4B App Control** remote runtime, not Remote Desktop Commander. Historical observation: `hostinger_ssh_prod_platform` has been reported as active in auth.mad4b.com. **No current live attestation has been performed from this session.** An active Hostinger SSH connection is not proof of hPanel API authority, MySQL `CREATE DATABASE` privilege, permission to edit environment variables, or authorization for an independent Production mutation.

## Dynamic discovery
- Registered Hostinger remote runtime target + the existing `remote_runtime_command_allowlists` registry remain the source of truth, with independent target-level command allowlist.
- `POST /platform/remote-runtime/hosting/recovery-allowlist/discover` lists registered capabilities and blockers only; it never reads managed SSH credentials, opens SSH, calls Hostinger, edits environment, creates a database, or performs a grant.
- The forward migration adds seven **planned** command keys to the existing command registry and Hostinger production target allowlist. No command executor, capability policy, write tool, or dispatch certification is enabled. The admin discovery tool itself remains disabled until route acceptance.
- Command execution is **never** derived from catalog discovery, active SSH, proposed input schemas, or a target allowlist string. Unknown commands remain unimplemented.

## Expansion catalog
| Command key | Intended operation | Writer |
|---|---|---|
| `hostinger_recovery_database_inventory` | Read-only DB existence/schema/privileges inventory | None |
| `hostinger_recovery_control_store_plan` | Role-aware exact recovery DB creation/reuse plan | None |
| `hostinger_recovery_database_create` | Create the missing *specific* Recovery Control Store DB | None |
| `hostinger_recovery_environment_binding_plan` | Compare approved secret reference bindings without values | None |
| `hostinger_recovery_environment_binding_apply` | Atomic runtime config write, then same-cycle readback | None |
| `hostinger_recovery_grants_plan` | Least-privilege, role-specific grants diff | None |
| `hostinger_recovery_grants_apply` | Separate approved exact grants apply | None |

## Why SSH must not become a database/env writer by default
Hostinger hPanel account APIs and hosting MySQL privileges may differ from the SSH user's permissions. A generic remote-shell alias cannot safely substitute for a certified database-create adapter or a host-side atomic environment binding contract. Before ever changing `status` from `planned` to `active`, supply:
1. **Provider/host capability introspection** proving DB inventory/create privileges and exact env binding mechanism (not assumed from login).
2. Exact platform system, environment, database role and host resource identity; no cross-tenant or cross-environment fallback.
3. A typed immutable plan with exact release SHA, digest and source provenance, expiry, idempotency key, independent approval, and an unforgeable execution ticket.
4. Pre-apply live checks: database missing, or an already existing database with expected owner/schema; abort on unexpected objects or privilege expansion.
5. Host-key pinning, least-privilege account, no free-form SSH, SQL, shell, file paths, arbitrary env names, or raw secret payloads.
6. Database creation / environment binding / grants as **separately authorized** operations. Rollback must not delete a preexisting database or overwrite unknown values.
7. Durable one-shot execution receipt, per-operation lock/lease, bounded output, explicit no-secret logging, independent post-write readback, expiration and failure hold.
8. Feature flag and exact Staging acceptance before a Production certification.

## Self-recovery relationships
Connector health and Hostinger provider execution are independent trust boundaries:
- Local Connector may be Stale but still diagnostic; it must never inherit a different or historical device's identity.
- Hostinger account may be Active yet lack database-create privilege. That is `CAPABILITY_UNAVAILABLE`, **not** an invitation to retry through arbitrary SSH.
- Control Store database may be missing, nonempty, partially provisioned, or owned by another principal. Only a verified absent database is eligible for a separately approved create. Existing empty database initialization is the distinct `database.rebuild_empty` runbook, not `CREATE DATABASE`.
- Environment binding is not an inline response of secret values. Only durable managed credential references plus a host-side atomic writer are acceptable.
- If Control Plane storage itself fails, host-side bootstrap requires existing dedicated out-of-band authority; it cannot depend recursively on the missing Store to approve its own creation.

## Verification matrix
| Scenario | Expected result |
|---|---|
| Hostinger SSH active but new commands are planned | Discovered, `execution_allowed=false` |
| Target command missing from target allowlist | Blocked and explained |
| Production request against development registration | 403 |
| Wrong provider, missing or duplicate target | Fail closed |
| Missing managed credentials or unproven host fingerprint | Cannot certify executor |
| Existing nonempty Recovery DB | Do not overwrite; reconcile independently |
| No MySQL CREATE privilege / no hPanel DB endpoint | Mark provider capability unavailable |
| Raw shell, raw SQL, raw env value request | Not supported by registry or API |
| Stale plan, changed SHA, changed secret reference revision | Reject before any write |
| Post-create or post-env readback fails | Hold, no success claim, compensating plan only |
| Database creation succeeds but grants fail | Partial state with immutable evidence; no automatic repeat |
| Self-Recovery on stale or revoked device | Diagnosis only for stale; revoked denies reuse |

## Status and deployment
Source and tests can be delivered to PR #8461, but migration has **not** been applied and Production writer authority remains disabled. Acceptance is conditional on live `auth.mad4b.com` connector discovery, target registration and managed credential status, schema and host privilege evidence, plus independently verified test results. Do not merge to `main` or promote Production without those checks.


## Hostinger documented API discovery and destructive semantics (2026-10-09)

Public documentation: https://developers.hostinger.com and the official Hostinger SDK database endpoint reference https://github.com/hostinger/api-php-sdk/blob/main/docs/Api/HostingDatabasesApi.md .

- Hostinger documents GET and POST /api/hosting/v1/accounts/{username}/databases. POST creates a database **and** a dedicated user with a caller-supplied password. Account-level API entitlement and plan compatibility are **unverified** for this MAD4B connection.
- Hostinger documents GET and PUT /api/hosting/v1/accounts/{username}/websites/{domain}/nodejs/builds/settings/env.
- The GET response **masks the values**. The PUT **replaces the entire environment variable set** and restarts the Node.js process. Missing keys are removed; sending the masked values back would corrupt the app configuration.
- Consequently, the API is NOT a safe atomic 'add RECOVERY_CONTROL_DB_*' patch. Even complete vault values are insufficient for automatic write until exact website binding, complete nonmasked authoritative snapshot, exclusive mutation fencing, revision/change detection, separate approval and independent readback are proven. The source safety predicate intentionally returns execution_allowed=false.
- Hostinger's website database setup endpoint can create a DB and configure the usual DB_* keys automatically. It is **not** equivalent to bootstrapping an independent Recovery Control Store under RECOVERY_CONTROL_DB_* keys and has a consequential restart/build impact.
- Read-only provider documentation is **not** proof of an account connection, token scope, current website plan, DB CREATE permission, capability lease or Production authorization.

This is why the seven new allowlist command names stay PLANNED and why the existing target allowlist is *not* silently widened by the registry migration. A provider-specific adapter must prove capability for the exact account before an individually approved target-level revision can be considered.
