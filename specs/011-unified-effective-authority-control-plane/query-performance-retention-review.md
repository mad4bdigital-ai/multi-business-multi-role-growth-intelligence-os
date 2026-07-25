# UEACP Query Performance and Retention Review

## Review status

- Feature: `011-unified-effective-authority-control-plane`
- Pull request: `#2888`
- Reviewed head: `5d7761ad0a8aade384d3f96b2ce66e5aa0029f4d`
- Reviewed base: `05e939a8f328adc0dff77c9d1b4d3cf8941211d0`
- Review result: `index_migration_prepared_retention_policy_open`
- Migration execution: not performed
- Purge execution: not implemented
- Production behavior changed: false

This review records live read-only table and query-plan evidence, proposes additive indexes, and documents retention/access constraints. It does not authorize migration execution, purge scheduling, evidence persistence, deployment, or merge.

## Reviewed queries

### Tenant connector inventory

The read-only inventory query filters `connected_systems` by Tenant and cursor, excludes archived rows, joins active installations, groups by connector identity, and orders by `system_id`.

Observed live behavior before the proposed indexes:

- `connected_systems` row estimate: `31`
- `installations` row estimate: `3`
- the optimizer uses the existing Tenant index only partially;
- ordering/grouping requires a filesort;
- the installation join primarily uses `system_id` rather than the complete Tenant-aware state key.

### Connector projection summary

The summary query calculates Registered, Authorized, Projected, and Executable Candidate counts across `connected_systems`, with an installation-state join for executable candidates.

Observed live behavior before the proposed indexes:

- the current full scan is inexpensive at the present table size;
- the installation join uses `system_id` as its primary access path;
- growth in connector or installation counts would make the Tenant-aware composite join and state predicates more important.

The review found no N+1 query pattern in the current inventory or summary path. Both queries execute as bounded repository operations.

## Proposed additive indexes

Migration:

`http-generic-api/migrations/20260725_ueacp_performance_retention_indexes.sql`

Indexes:

1. `idx_ueacp_connected_systems_tenant_cursor (tenant_id, system_id, status)`
   - supports Tenant-scoped cursor traversal and stable connector ordering;
   - preserves the existing `system_id` cursor contract;
   - does not change connector rows or authorization semantics.

2. `idx_ueacp_installations_system_tenant_state (system_id, tenant_id, status, expires_at)`
   - supports the Tenant-aware installation join;
   - supports active/non-expired readiness predicates;
   - does not expose credential references or provider payloads.

3. `idx_ueacp_shadow_decisions_expires (expires_at)`
   - prepares bounded retention scans for expired shadow decisions;
   - does not delete evidence or create a purge job.

The migration is additive and idempotent through `CREATE INDEX IF NOT EXISTS`. It contains no destructive SQL and is protected by a checksum-bound contract test.

## Retention policy boundary

The schema defines `expires_at` for shadow decisions, but this PR does not establish a final retention duration or deletion authority.

Until a separate policy is approved:

- no automated purge may run;
- no shadow decision may be deleted solely because `expires_at` has passed;
- open drift events must not be deleted;
- resolved or ignored drift events require an approved retention period and audit evidence before deletion;
- legal hold, incident hold, and compliance hold requirements override any future purge eligibility;
- retention execution must use a bounded batch size, explicit approval, deterministic selection, and same-cycle deletion readback;
- purge code must remain separate from the read-only projection and reconciliation paths.

## Access policy boundary

- External consumers receive only allowlisted Activation projections.
- `principal_id`, raw manifest JSON, raw evidence JSON, credential references, provider payloads, tokens, and secrets remain excluded from projected surfaces.
- Direct ledger access remains limited to approved Platform runtime and governed Admin diagnostics.
- Tenant callers must never query another Tenant's evidence.
- Any future deletion or export operation requires a typed capability, explicit resource authority, audit evidence, and readback.

## Open approvals

The following are not approved by this review:

- final retention duration;
- retention-policy owner;
- legal-hold process;
- purge schedule and batch size;
- deletion capability and authorization contract;
- access-role matrix for raw ledger rows;
- production index application;
- post-migration query-plan acceptance.

## Post-migration verification required

After a separately authorized migration apply:

1. verify all three indexes in `information_schema.statistics`;
2. rerun representative Platform and Tenant `EXPLAIN FORMAT=JSON` queries;
3. confirm the connector inventory remains cursor-stable and Tenant-scoped;
4. confirm the installation join considers the composite index;
5. verify the expiration index without executing deletion;
6. record same-cycle schema and query-plan readback;
7. keep scheduler and evidence persistence disabled unless separately approved.

## Safety readback

- Migration executed: `false`
- Purge job created: `false`
- Evidence deleted: `false`
- Scheduler enabled: `false`
- Evidence persistence enabled: `false`
- Provider call made: `false`
- Credential payload read: `false`
- External write made: `false`
- Enforcement cutover authorized: `false`
- Secrets included: `false`
