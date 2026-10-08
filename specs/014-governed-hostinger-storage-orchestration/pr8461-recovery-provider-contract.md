# Spec 014 extension — Hostinger Recovery capability allowlist / PR #8461

Status: registry source + read-only discovery endpoint completed; NO provider operation, database create, Production environment edit, schema mutation or grants execution authorized.

## 1. Authority boundary and existing implementation reuse

Existing building blocks:
- productionRecoveryControlStoreBootstrap: exact Production SHA, identity, immutable bootstrap schema plan; **does not** create DB or set environment variables.
- recoveryControlDb: independent control store connection and structural schema readiness.
- productionRecoveryAuthorityPreflight: check runtime class, server-managed binding and authority graph prerequisites.
- runtimeBreakglassBroker + Host Breakglass: separate runbooks for selected-role inspection/rebuild/grant operations.
- remoteRuntime + hostingerSshDeployExecutor: Hostinger target metadata and bounded SSH deploy/probe (not arbitrary SQL/hPanel administration).

The Hostinger capability catalog is a discovery adapter, not a new Recovery Kernel. Never add a parallel approval ledger, independent role selection, ad-hoc SQL shell, automatic Production side channel, or alternate 'current SHA' resolver.

## 2. Capability lifecycle

REGISTERED -> DISCOVERED -> PROVIDER_PROVEN -> TARGET_ALLOWLIST_APPROVED
-> EXECUTOR_CERTIFIED -> EXACT_PLAN -> INDEPENDENT_APPROVAL -> TICKET_FENCED
-> ONE_APPLY -> READBACK_VERIFIED / PARTIAL_RECONCILIATION_REQUIRED.

The planned command catalog currently advertises:
- hostinger_recovery_database_inventory;
- hostinger_recovery_control_store_plan;
- hostinger_recovery_database_create;
- hostinger_recovery_environment_binding_plan;
- hostinger_recovery_environment_binding_apply;
- hostinger_recovery_grants_plan;
- hostinger_recovery_grants_apply.

All seven have **planned** registry status, **zero** live executor authority and **no automatic target allowlist write**. Future approval to bind one command to one target must be separate from catalog registration. Active Hostinger SSH is NOT evidence of hPanel API privileges, MySQL CREATE, GRANT or ability to modify host-managed environment settings.

## 3. Provider adapter and Hostinger entitlement discovery

A future provider adapter must expose immutable typed capabilities and evidence timestamps, not raw shell. Each required operation must be evaluated independently:
1. DB inventory: list *existing* database names/ownership/privileges with no credential values.
2. DB creation: prove dedicated Hostinger API or database principal CREATE permission; exact new DB name, existing-object preflight, no overwrite, no SQL from caller.
3. Environment binding: attest the supported atomic host-side managed secret-reference mechanism; no plaintext parameter, no generic file writes.
4. Grant apply: prove privilege for a restricted exact role/table set without GRANT OPTION.
5. Readback: verify actual resource identity and checksum/permission impact through independent provider or database query.
6. Worker: host-key pinned, least-privilege service account, bounded output and no user-defined command templates.

If capability source is missing, unsupported, ambiguous or stale -> BLOCKED. UI may suggest a governed alternative but never silently choose an unmatched provider.

## 4. Recovery Control Store bootstrapping deadlock

The Recovery Kernel cannot trust mutation authority stored inside a Recovery Control Store that does not yet exist. Provisioning the empty **database** is a distinct external authority action from initializing its repository-owned schema. Required sequence:

EXTERNAL_BOOTSTRAP_AUTHORITY -> PROVIDER_CREATE_IF_ABSENT -> HOST_SECRET_REFERENCE_BINDING
-> CONTROL_STORE_CONNECTIVITY -> existing productionRecoveryControlStoreBootstrap schema PLAN
-> independent CONFIRM / SCHEMA_APPLY -> same-cycle readiness
-> server-managed Recovery binding -> durable full inspection
-> selected role recovery -> separate grants -> ordinary migrations.

Each arrow has its own exact resource identity/commit SHA, expiry, plan digest, separate approval and readback. A partially committed stage must return a durable partial receipt, not attempt the full chain again. Existing nonempty DB, missing provider permission, changed Production SHA or externally modified env abort before writes.

## 5. Denial matrix and fault injection

| Condition | Result |
|---|---|
| SSH active; no hPanel DB-create entitlement | provider_capability_unavailable |
| Catalog command planned but not target-bound | discovery only |
| Target-bound but no certified executor | dispatch blocked |
| Valid provider but wrong tenant/env/host | authorization denied |
| Production SHA changes between plan and apply | stale plan; replan |
| Missing Control Store but ordinary app down | external bootstrap only |
| DB exists with unexpected owner/objects | reconciliation required; no overwrite |
| Grants partially applied | independent durable receipt and controlled resume |
| Secret reference changed or revoked | stop, reauthorize, never reuse cached bytes |
| Post-apply provider response lost | unknown outcome; readback before any retry |
| CI queued or skipped | no release acceptance |
| Hostinger connection from another plugin | cannot inherit authority |

## 6. Verification gates

H0: exact source/source-of-truth reconciliation with recovery contracts.
H1: SQL migration idempotency in MySQL and MariaDB, with zero Production target writes.
H2: independent Hostinger system/target binding and current credential readiness.
H3: provider API entitlement and exact live hPanel/DB discovery, no credential payload.
H4: certified limited plan-only executor and non-mutating staging smoke.
H5: separate creation, environment binding and grants approvals, signed ticket + idempotency.
H6: host-side immutable partial receipt and independently attested same-cycle readback.
H7: exact Production candidate, security approval and tested rollback with no destructive replay.

H0 source alignment partially complete; H1–H7 require native and live acceptance. Do not claim Production readiness before these gates.
