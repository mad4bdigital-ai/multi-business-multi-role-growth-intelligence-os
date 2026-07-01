# Phase 2 Closeout Evidence - 2026-07-01

## Merge Evidence

- Pull request: `#1969`
- Status: `merged`
- Merge commit: `3fc6370becfb2a112c50f037a018f15cc5e5c277`
- Merged at: `2026-07-01T13:48:50Z`
- Main head observed after follow-up runtime-policy merge: `009c26548f5b79840f18cdf8f4a42646359af434`
- Required CI gates on the merged Phase 2 head: `success`
  - `Syntax Check`
  - `Unit & Integration Tests`
  - `Execution Resolver Gate`
  - `Architecture Drift Detection`

## Non-Blocking Workflow Triage

- Workflow: `Generate reviewable remediation PR`
- Classification: `automation_only_pending_triage`
- Runtime Phase 2 blocker: `false`
- Notes: the workflow failure was not one of the required merge gates recorded for PR `#1969`. It still requires separate automation triage before relying on remediation PR generation.

## Migration 1030 Static Evidence

- Migration file: `http-generic-api/migrations/1030_sprint69_canonical_capability_domain.sql`
- SHA-256: `ce835693b2251c8845d7467e5a1a7ea0d2e6aab07b420234a500c93b75ac562a`
- Statement count: `5`
- Preflight status: `pass`
- Risk count: `0`
- Destructive statement count: `0`
- Secrets included: `false`
- Static scope:
  - creates `canonical_capabilities`
  - creates `capability_aliases`
  - backfills canonical capabilities from active admin and tenant tool catalogs
  - backfills aliases from active admin and tenant tool catalogs
  - creates `v_capability_alias_integrity`

## Governed Apply Status

- Migration applied: `false`
- Ledger/schema readback: `not_run`
- Integrity report: `not_run`
- Blocker: governed auth control-plane discovery was attempted with list-before-call at `https://auth.mad4b.com/gpt/tools`, but this Codex session had no connection auth layer available. The endpoint returned `401 missing_backend_api_key`.
- Fallback decision: direct database execution was not used. This preserves the auth control-plane rule and avoids unsanctioned DB mutation.

## Required Remaining Sequence

1. List admin tools through the governed auth connection.
2. Use `governed_migration_authorization_bootstrap` with the exact checksum, statement count, PR number, merge SHA, and typed confirmation:
   `AUTHORIZE_GOVERNED_MIGRATION_1030_SPRINT69_CANONICAL_CAPABILITY_DOMAIN`
3. Run `governed_migration_execute` in `dry_run` mode for the same migration, checksum, and statement count.
4. Apply with typed confirmation:
   `APPLY_1030_SPRINT69_CANONICAL_CAPABILITY_DOMAIN`
5. Read back `governed_migration_ledger`.
6. Read back schema objects:
   - `canonical_capabilities`
   - `capability_aliases`
   - `v_capability_alias_integrity`
7. Run `http-generic-api/scripts/capability-alias-integrity-report.mjs`.
8. Record counts for inventory, aliases, duplicate active alias targets, orphan aliases, and incomplete active capabilities.

## Task Accounting And Execution Plan

- Total tasks: `114`
- Completed tasks: `56`
- Remaining tasks: `58`
- Remaining range: `T027-T045,T073-T081,T085-T114`
- Completed out of order and excluded from remaining work: `T046-T072,T082-T084`
- Reuse constraint: completed approval work in `T082-T084` must be reused; do not create a parallel approval path.

Execution order:

1. Finish Phase 2 closeout evidence, Migration 1030 governed apply/readback, and branch cleanup.
2. Deliver Phase 3 strict request contract in an independent PR.
3. Deliver Phase 4 security decision engine in one PR or small PR set bounded by domain, application, and integration surfaces.
4. After the decision engine is stable, run Phase 8 and Phase 9 on synchronized branches.
5. Run Phase 10 after the decision trace contract is fixed.
6. Run Phase 11 after request and trace contracts stabilize.
7. Run Phase 12 only as verification and release, including regression coverage for completed Phases 5-7 against the new decision engine.

Merge policy: merge is deferred until the full plan is complete and required CI is successful for the final integration point.

## Execution Authority Boundary

Phase 2 merged the canonical capability domain and alias registry, but it does not change runtime execution authority by itself. Existing action and tool registries remain runtime authority until later phases explicitly route dispatch through the canonical capability domain and pass their own CI, migration, rollout, and authorization gates.

Phase 3 remains `not_started_pending_phase2_migration_apply_and_readback`.
