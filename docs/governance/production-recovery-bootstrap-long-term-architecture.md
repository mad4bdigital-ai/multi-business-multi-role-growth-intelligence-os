# Production Recovery Bootstrap: current patch and deferred long-term architecture

Status: **Current patch active; long-term architecture deferred**

## Purpose

This document separates the immediate Production Recovery bootstrap closure from the long-term Recovery Authority Plane design.

The current patch is intentionally narrow. It exists to remove the bootstrap deadlock around the independent Recovery Control Store while preserving the existing Recovery Kernel ordering and approval model.

It does **not** authorize or implement the future provider architecture described later in this document.

## Current operational problem

The current Production recovery sequence requires:

```text
recovery_control_plane_ready
→ durable_full_inspection
→ governance_baseline_ready
→ runtime_persistence_baseline_ready
→ canonical_grants_readback_ready
→ governance_authority_ready
→ ordinary_migration
```

The observed blocker is earlier than rebuild, grants, or migrations:

```text
Recovery Control Store not mutation-grade
→ durable inspection cannot be authoritative
→ role_selection_provenance_bound = false
→ role_bundle_bindings_bound = false
→ execution_allowed = false
```

A Recovery Kernel mutation cannot safely bootstrap the store that the same mutation lifecycle requires. The bootstrap authority therefore has to remain separate and narrower than the Recovery Kernel mutation authority.

## Current patch scope

The current patch adds a bounded Production Recovery Control Store bootstrap surface.

### It may

- verify exact Production deployment identity;
- inspect Recovery Control Store configuration presence without exposing secret values;
- inspect connection and schema readiness;
- report server-managed Recovery binding mode/module configuration;
- build an immutable plan bound to the exact Production SHA;
- reconcile only the repository-owned `CREATE TABLE IF NOT EXISTS` schema for the independent Recovery Control Store;
- require an exact plan SHA-256 and typed confirmation before schema reconciliation;
- perform same-cycle schema readback;
- expose the full pre-rebuild dependency sequence.

### It may not

- create a database;
- create or alter a database user;
- accept a database name, credentials, or raw SQL from a caller;
- modify Runtime, Governance, or Runtime Persistence databases;
- apply baseline rebuilds;
- apply grants;
- run ordinary migrations;
- update Hostinger environment variables;
- restart or redeploy Production;
- call provider mutation APIs;
- reuse a plan after exact-SHA or observed-state drift.

## Current gate model

```text
Recovery Control Store configured
→ Recovery Control Store connection ready
→ Recovery Control Store schema ready
→ Server-managed Recovery binding configured (live readiness still unverified)
→ Durable full inspection
→ Role-selection provenance bound
→ Role-bundle bindings bound
→ Governance baseline ready
→ Runtime Persistence baseline ready
→ Canonical grants readback ready
→ Governance authority ready
→ Ordinary migration ready
```

Only the **Recovery Control Store schema-ready** transition is executable by this patch.

All subsequent mutation transitions retain their existing independent authorities and approvals.

## Current typed confirmation

The schema reconciliation confirmation is:

```text
APPLY_PRODUCTION_RECOVERY_CONTROL_STORE_SCHEMA
```

It is valid only with:

- the exact current Production SHA;
- the current authoritative bootstrap plan SHA-256;
- a configuration that already resolves to an independent Recovery Control Store;
- a live connection to that store;
- a schema-not-ready classification.

Any drift requires a new plan.

## Role bundle handling

This patch does not manufacture role-selection evidence.

After the independent store and server-managed binding are ready, a fresh `database_full_inspection` must run through the Recovery Kernel with the durable store injected.

That durable inspection is the authority that produces the evidence required for:

```text
role_selection_provenance_bound = true
role_bundle_bindings_bound = true
```

The bindings must therefore be derived from the fresh durable inspection and not copied from an older remediation plan.

## Grants and Local Manager

Local Manager table presence does not authorize grant repair.

The current ordering remains:

```text
durable inspection
→ baseline repair where required
→ canonical grant readback
→ governance authority
→ ordinary migration
```

Grant mutation remains outside this patch.

## Deferred long-term architecture

The long-term target is an external **Recovery Bootstrap Controller / Recovery Authority Plane** that does not depend on the Production application being healthy.

Target model:

```text
GitHub exact-SHA authority
        +
Provider / Hostinger adapter
        ↓
Recovery Bootstrap Controller
        ↓
Independent Recovery Control Store
        +
semantic runtime-env binding
        +
durable evidence
        ↓
Production restart/readback
        ↓
Durable full inspection
        ↓
Automatic role bundle derivation
        ↓
Recovery Kernel
```

### Deferred capabilities

The future controller should support fixed, governed capabilities such as:

```text
recovery_store.inspect
recovery_store.provision
recovery_store.schema_reconcile
production_runtime.env.inspect
production_runtime.env.patch
production_runtime.restart
production_runtime.readback
```

No raw SQL, freeform shell, or caller-supplied credentials should be accepted.

### Deferred Hostinger provider adapter

The long-term Hostinger adapter should provide:

- Node.js runtime inspection;
- semantic environment-variable patching with unrelated values preserved;
- CAS/revision protection;
- independent MySQL database provisioning;
- principal provisioning and rotation;
- secret-reference binding without exposing secret values to GitHub or ChatGPT;
- controlled restart/redeploy;
- same-cycle deployment/readiness readback.

The existing provider API must not be used as a caller-side full environment replacement because that can erase unrelated values or require secret material to leave the trusted runtime boundary.

### Deferred state machine

```text
UNINITIALIZED
→ PROVIDER_DISCOVERED
→ CONTROL_STORE_CONFIGURED
→ CONTROL_STORE_SCHEMA_READY
→ SERVER_BINDING_READY
→ DURABLE_INSPECTION_READY
→ ROLE_BINDINGS_READY
→ RECOVERY_CONTROL_PLANE_READY
→ BASELINE_REBUILD_ELIGIBLE
→ GRANTS_READY
→ ORDINARY_MIGRATION_READY
```

Every consequential transition should retain:

- exact SHA binding;
- immutable plan hash;
- typed or equivalent owner approval;
- idempotency;
- fencing/lease semantics;
- same-cycle independent readback;
- reconciliation instead of automatic replay after an unknown provider outcome;
- secretless external evidence.

## Explicit deferral

The long-term Recovery Authority Plane, Hostinger semantic env adapter, database/principal provisioning, and self-healing convergence controller are **not implemented by the current patch**.

They should be delivered as a separate feature after the immediate Production recovery bootstrap is closed and verified.

This separation is intentional so the current incident is resolved with the smallest auditable authority increase while preserving a clear migration path to the stronger long-term architecture.

## Schema completeness and deployment drift

The fixed Control Store DDL is the canonical inventory for all eleven tables.
Readiness checks every required column (type, nullability, default, update behavior,
and text collation), primary/unique/secondary index, and InnoDB base-table identity.
Absent tables are eligible for fixed CREATE TABLE reconciliation. Missing or malformed
columns/indexes in an existing table require separate migration authority; CREATE TABLE
IF NOT EXISTS cannot repair them. Metadata query failures never authorize bootstrap.

`scope=durable_inspection` remains compatible with inspection consumers, while
`schema_scope=mutation_grade` and `mutation_grade_schema_ready` describe the expanded
physical schema check. They do not authorize a recovery mutation or certify the live
adapter graph. `server_managed_recovery_binding_configured` and
`binding.readiness_verified=false` deliberately report configuration only. The fresh
Recovery Kernel inspection must resolve and validate the live server-managed binding.

The plan includes a digest of canonical deployment identity, including available
manifest tree, image, context and deployment-time fields. Identity is read again after
pool resolution immediately before the first DDL; drift rejects with HTTP 412 without
SQL dispatch. Drift between statements stops remaining DDL and requires reconciliation.
These checks narrow the race window; they are not an atomic deployment/DB fencing
protocol and cannot detect a remote deployment invisible to the local canonical reader.
A lost first DDL acknowledgement reports unknown outcome, not proven no mutation.
No ambiguous or partial result permits automatic replay.

## Isolation and operational prerequisites

The database, principal and secret configuration must already exist; this bootstrap
cannot provision them. Reusing a target database host remains supported for incident
closure. Distinct database/principal names provide logical isolation only, not
infrastructure failure-domain isolation. Even an explicit different hostname is not
proof of a separate failure domain. External provider/authority-plane independence
remains a separate delivery.

After authorized deployment, obtain fresh status and plan, apply only with the exact
current typed confirmation, verify full-schema readback, then run fresh durable
inspection and the existing governed convergence authorities. Do not reuse plans or
approval material across SHA or state changes.
