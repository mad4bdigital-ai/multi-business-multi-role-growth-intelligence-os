# Phase 3 Slice C — Delegation Grant Persistence Contract

## Purpose

Define an additive MariaDB persistence contract for canonical Spec 011 delegation grants while preserving the existing `agent_delegations` table and all legacy callers. This slice adds migration SQL and deterministic contract validation only. It does not apply the migration or enable any mutation route.

## Reuse decision

Phase 0 selected `agent_delegations` as the compatibility authority. Slice C extends that table rather than introducing a parallel grant table.

Legacy columns remain authoritative for existing runtime behavior:

- `delegation_id`, `tenant_id`, `user_id`, and `agent_id`;
- `intent_key`, `brand_key`, and `plan_id`;
- legacy `status`, `expires_at`, `created_at`, and `completed_at`; and
- `failure_reason`.

Canonical columns are additive and nullable unless a safe numeric counter default is required. No legacy row is backfilled into active canonical authority.

## Additive fields

The migration introduces fields for:

- schema and approval mode;
- plan and resource snapshot hashes;
- allowed and denied intent sets;
- risk ceiling;
- mutation, retry, and pull-request limits plus consumed counters;
- readback and stop-on-drift policy;
- policy version, grant hash, and idempotency key;
- canonical lifecycle status;
- approval and revocation provenance; and
- explicit runtime-policy readiness.

## Fail-closed activation

`runtime_policy_ready` is `NOT NULL DEFAULT 0`. `canonical_status` has no active default. Therefore adding the columns cannot make a legacy delegation dispatch-eligible.

The migration defines `effective_agent_delegation_grants_v`. A row appears in the view only when all canonical bindings are complete and valid, including:

- schema version `spec011-delegation-grant-v1`;
- canonical status `active` and compatible legacy status;
- non-expired and non-revoked lifecycle;
- exact plan, resource, and grant hashes;
- valid non-empty JSON resource and allowed-intent sets;
- valid denied-intent JSON;
- recognized approval mode and risk tier;
- complete limits with consumed values inside the approved ceiling;
- readback and stop-on-drift enabled;
- non-empty idempotency key; and
- approval provenance.

The view is advisory persistence authority only. No route uses it in this slice.

## Indexes

The migration adds:

- a Tenant/user/idempotency unique index;
- an active-grant lookup index;
- plan-hash and grant-hash lookup indexes; and
- an approval-hold lookup index.

These indexes support exact Tenant-scoped reads and unsafe-retry protection without changing existing primary or foreign keys.

## Migration safety

- Additive `ALTER TABLE` only.
- No `DROP`, `TRUNCATE`, `DELETE`, data `UPDATE`, data `INSERT`, or backfill.
- No default active lifecycle state.
- No migration execution in this PR.
- No provider call, external send, or credential use.

Before apply, the migration requires:

1. MariaDB syntax validation against the production major version;
2. schema preflight and collision checks;
3. an approved maintenance and rollback plan;
4. governed migration execution with exact-SHA binding; and
5. same-cycle information-schema and view readback.

## Rollback plan

Because the change is additive, runtime rollback is to keep all new rows fail-closed by setting or retaining `runtime_policy_ready = 0`. Physical removal of columns or indexes is a separate destructive migration and is not included in this slice.

## Boundaries

- No public route or OpenAPI change.
- No migration apply.
- No database write from application code.
- No grant create, activate, renew, revoke, or expire mutation.
- No approval mutation.
- No runtime-authority cutover.
- No deployment.

## Follow-up

1. Validate and apply the migration through governed migration tooling.
2. Add a repository/service that writes canonical grants transactionally.
3. Add governed create, inspect, revoke, and expire operations with idempotency receipts and same-cycle readback.
4. Add renewal no-widening checks across plan, resources, intents, risk, limits, and expiry.

T141 remains open until the governed lifecycle mutations are implemented and verified.

## Slice C closeout evidence

- Implementation PR: #3110.
- Merge SHA: `d154a24c0cba9bf692fa3105c574c557b1975e4b`.
- Final CI head: `22f100d6aece8600fa953bed7f05fd1f975890f5`.
- Final CI base: `2587f804045e5045a87a5df3009ea2bac8aa45d8`.
- Required checks passed: Syntax Check, Architecture Drift Detection, Execution Resolver Gate, and Unit & Integration Tests.

The isolated merge diff contains an unapplied migration contract, deterministic contract test, CI registration, and evidence only. It does not add a route, enable runtime authority, write the database, backfill legacy rows, dispatch a provider, or require deployment.

The wider `main`-to-runtime readiness warning includes unrelated operational changes and is not attributed to Slice C. No Release Operation was opened for this closeout.

The migration remains `contract_only_unapplied`. Applying it requires separate governed approval, MariaDB validation, an exact-SHA maintenance and rollback plan, and same-cycle information-schema plus view readback.

Slice C is `complete_on_main`. T141 remains open for governed create, inspect, revoke, expire, idempotency receipt, same-cycle readback, and renewal no-widening behavior.

The overall Spec 011 status remains `in_progress`.

## Closeout recovery evidence

- Original closeout PR #3132 was closed without merge.
- The original head branch was deleted, but verified commit `3733b608d724b83616c6da350a5c2464470169f0` remained available.
- Recovery branch: `gpt/spec-011-phase3-delegation-persistence-closeout-recovery-20260726`.
- Recovery PR: #3146.

The recovery preserves the same three-file documentation and evidence scope. It does not alter the migration, apply SQL, enable runtime authority, create a public route, dispatch a provider, or require deployment.

PR #3146 supersedes the unmerged closeout PR #3132.

## Approval-mode contract drift correction

The canonical approval-mode authority is the `delegation-grant.schema.json` enum together with `approval-delegation-modes.md`. The effective-view contract previously listed three non-canonical modes—`delegated_time_bound`, `delegated_budget_bound`, and `delegated_combined_bound`—instead of `human_on_exception`, `multi_agent_approval`, and `break_glass`.

The migration contract now uses the exact canonical eight-mode set. The deterministic persistence test reads the JSON Schema and compares the effective-view mode list for exact equality, so future additions, removals, or renames fail CI unless the schema and migration contract change together.

This correction changes repository contract text only. The migration remains `contract_only_unapplied`; no SQL was executed, no row was changed, and no runtime authority was enabled.

The initial implementation scope remains limited to `user_approval_only`, `agent_recommend_only`, `agent_queue_for_approval`, `delegated_low_risk`, and `delegated_plan_bound`. Presence in the canonical schema does not activate `human_on_exception`, `multi_agent_approval`, or `break_glass` without their separate implementation and certification phases.

T141 remains open.
