# Governed Migration Dependencies

## Purpose

Migration ordering must be enforced from exact evidence, not from task order or operator memory. A migration with a declared dependency cannot proceed through the official execution sequence until every dependency has an exact successful governed migration ledger row.

## Authority

The repository contract is:

- `http-generic-api/config/governed-migration-dependencies.json`

Each target entry binds:

- target migration filename;
- target SHA-256 checksum;
- target statement count;
- dependency migration filename;
- dependency SHA-256 checksum;
- dependency statement count;
- required governed ledger mode.

The target binding prevents a stale dependency declaration from surviving a migration edit. Duplicate dependencies, self-references, malformed values, and dependency cycles fail closed.

## Read-only gate

The executable guard is:

- `http-generic-api/scripts/governed-migration-dependency-gate.mjs`

The guard calls only the existing admin tool:

- `governed_migration_schema_readback`

It does not accept SQL. It does not apply a migration, create an authorization, authorize a Capability Envelope, call a provider, read credential payloads, or perform an external write.

A dependency passes only when readback proves all of the following in the same result:

1. `readback_status=pass`;
2. `ledger.found=true`;
3. exact dependency checksum;
4. exact dependency statement count;
5. exact required ledger mode.

A schema object without the exact ledger evidence does not satisfy the dependency.

## Reusable workflow

Use:

- `.github/workflows/governed-migration-dependency-gate.yml`

The workflow may be called by a governed migration execution vehicle before authorization, dry-run, or apply. It checks out trusted `main`, runs the read-only guard against `auth.mad4b.com`, and uploads a no-secret evidence artifact.

The workflow itself never invokes `governed_migration_execute`.

## Sprint 69 capability coverage sequence

The current declaration binds:

- target: `1007_sprint69_agent_capability_coverage_admin_tools.sql`;
- target checksum: `11b93401bbd0ed64e3e564d183c5a5d9775bcabbe3ccd7002d97e38b0d107a40`;
- target statement count: `1`;
- dependency: `1006_sprint69_agent_capability_evidence_coverage.sql`;
- dependency checksum: `995c657922413f9917fd4d93ac1213e76bc66b077c68646e4f5572c62c744374`;
- dependency statement count: `5`;
- required ledger mode: `apply`.

Therefore Migration 1007 remains blocked until Migration 1006 has been applied through the governed runner and the exact ledger/schema/view readback passes.

## Required execution order

1. Prove current Production runtime parity.
2. Bootstrap a fresh checksum-bound authorization for Migration 1006.
3. Run the governed Migration 1006 dry-run.
4. Use a fresh apply-authorized Capability Envelope and exact typed confirmation.
5. Apply Migration 1006.
6. Verify the exact ledger, three tables, two views, and live view queries without collation errors.
7. Run the dependency gate for Migration 1007.
8. Only after a passing dependency artifact, create fresh authorization and execution evidence for Migration 1007.

Old checksums, authorizations, envelopes, confirmations, or dependency artifacts must not be reused after a migration file changes.
