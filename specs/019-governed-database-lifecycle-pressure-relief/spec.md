# Spec 019 — Governed Database Lifecycle and Pressure Relief

## Status

Draft specification and contract-only foundation. This Spec Kit authorizes design and bounded implementation planning; it does not authorize a production database mutation, migration apply, compaction, deployment, or arbitrary SQL execution.

## Purpose

Define a governed Database Lifecycle and Pressure Relief control plane that can observe storage pressure, classify database resources by domain semantics, resolve an explicit lifecycle policy, produce an immutable plan, bind exact resource authority, require typed approval, execute only registered bounded operations, perform same-cycle readback, and evaluate logical cleanup separately from physical reclaim.

The feature converts the manually demonstrated incident workflow into a reusable platform contract without giving GPT, an agent, an operator, or an HTTP caller generic SQL authority.

## Problem Statement

`main` already contains a database lifecycle registry, reporting views, retention-plan snapshots, scheduler readiness, approval metadata, incident bridging, and fail-closed read-only planning surfaces. Those surfaces are valuable foundations, but they do not yet provide a complete governed execution path for domain-safe cleanup. In particular, the current retention planner explicitly remains dry-run/read-only, and the daily runtime is limited to snapshot/report execution.

The incident evidence distinguishes three materially different resource classes:

1. `governed_tool_response_chunks` has an authoritative `expires_at` TTL and is a candidate for a bounded expired-row cleanup pilot.
2. `repo_file_audit_findings` requires supersession and latest-observation invariants; age alone is insufficient.
3. `platform_engine_execution_runs` contains large payload fields but lacks an approved archive/thinning contract, so it must remain assessment-only and execution-blocked.

The platform therefore needs a generic lifecycle engine that asks the right questions while domain adapters retain ownership of resource semantics.

## Goals

### G1 — Pressure observation

The platform can collect database size, quota when available, used percentage, free capacity, `data_free`, largest tables, growth velocity, time-to-full estimate, policy coverage, eligible cleanup bytes, and potential physical reclaim bytes without requiring manual SQL.

### G2 — Domain-aware classification

The planner distinguishes authoritative TTL, superseded observation history, audit/session lineage, unknown retention, and physical-reclaim candidates. A missing policy is a blocking result, not permission to guess.

### G3 — Immutable planning

Every candidate set is frozen into a plan containing exact resource identity, recipe, policy revision, cutoff, preservation rules, bounded batch limits, risk, authority requirements, approval requirements, and a deterministic fingerprint.

### G4 — Narrow authority

Authority is bound to an exact `database_table` resource URI and exact registered recipe key. Wildcard database authority, arbitrary table names, arbitrary predicates, and caller-provided SQL are forbidden.

### G5 — Durable bounded execution

Mutation is available only through a registered internal database operation, a durable mutation receipt, an execution lease/idempotency key, bounded batches, and same-cycle readback. The executor executes the frozen plan; it does not reinterpret policy.

### G6 — Separate cleanup and reclaim

Logical cleanup and physical reclaim are separate operations, results, risk classes, approvals, and readbacks. Successful deletion does not imply recovered hosting capacity.

### G7 — Safe initial domains

The first implementation path is read-only pressure intelligence followed by a response-chunk TTL pilot. Repo-audit supersession follows only after its preservation invariants are proven. Engine execution runs remain plan-only until an archive/thinning contract is approved.

## Non-Goals

This specification does not expose arbitrary SQL, generic `DELETE`, generic `TRUNCATE`, arbitrary `OPTIMIZE TABLE`, GPT-generated predicates, wildcard database authority, or an external cron that bypasses the control plane. It does not apply migrations, mutate Production, install tools, deploy to Hostinger, or declare production readiness. It does not turn a storage emergency into an emergency retention override. It does not delete session transcripts, audit logs, or execution payloads merely because they are old.

## Governing Lifecycle

```text
Observe pressure
    -> Diagnose largest consumers and growth
    -> Classify resource semantics
    -> Resolve registered lifecycle policy
    -> Discover candidates and preservation dependencies
    -> Estimate rows, logical bytes, and physical reclaim
    -> Build immutable plan and fingerprint
    -> Resolve exact resource authority
    -> Require typed approval or policy-bound low-risk authorization
    -> Execute registered bounded batches
    -> Persist mutation receipt and execution evidence
    -> Same-cycle readback and reconciliation
    -> Evaluate physical reclaim separately
    -> Audit and publish bounded observability
```

The executor MUST NOT decide retention semantics. It receives a frozen plan, verifies identity/fingerprint/authority/lease, executes only the registered operation, and reports the outcome.

## Architecture

The architecture is layered:

```text
Resource Registry / Recipes
        |
        v
Domain Lifecycle Policies and Adapters
        |
        v
Lifecycle Planner -> Immutable Plan -> Fingerprint
        |
        v
Resource Authority + Capability Envelope + Typed Approval
        |
        v
Durable Execution Plan + Mutation Receipt
        |
        v
Registered Internal DB Operation -> Bounded Batch Executor
        |
        v
Same-Cycle Readback -> Logical Result -> Physical Reclaim Assessment
```

The generic engine owns orchestration, determinism, limits, evidence, and fail-closed behavior. Domain adapters own semantics such as TTL authority, latest observation ordering, parent-run terminality, lineage preservation, archive eligibility, and table reconstructibility.

## Resource and Recipe Contract

The first registered recipes are:

| Recipe key | Mode | Initial decision |
|---|---|---|
| `database.storage_pressure.inspect` | read-only | P0 foundation |
| `database.response_chunks.expired_cleanup` | bounded mutation | P0 pilot after receipts and authority readiness |
| `database.repo_audit.superseded_findings_cleanup` | bounded mutation | P1 after latest-observation proof |
| `database.engine_runs.retention_assessment` | read-only/plan-only | P1 |
| `database.engine_runs.archive_payloads` | mutation | Later, after archive contract |
| `database.table.physical_reclaim.assess` | diagnostic | P1 |
| `database.table.physical_reclaim.apply` | destructive/high-risk | Separate future slice |

A caller supplies `recipe_key`, exact `resource_uri`, and bounded parameters. A caller never supplies SQL, table identifiers outside the registered resource, a free-form `WHERE` clause, or an unbounded batch.

## Domain Policies

### Response chunks

Eligibility MUST use an immutable plan cutoff, not a moving `CURRENT_TIMESTAMP` at apply time. The adapter must preserve rows newer than the cutoff and rows inserted after planning. The pilot may recommend physical reclaim only after proving the table is empty, reconstructible, free of concurrent-writer risk, and covered by a separately approved reclaim recipe. Cleanup MUST NOT automatically trigger `TRUNCATE` or compaction.

### Repository audit findings

A finding is eligible only when the parent audit run is terminal/completed, the finding is older than the policy cutoff, a newer observation exists for the same logical `file_path`, and the current finding is not the latest observation. Latest ordering is deterministic: `created_at DESC`, then `finding_id DESC`. The planner must prove that the latest observation per file, parent runs, and non-terminal runs remain preserved.

The manually used 45-day threshold is incident evidence, not a platform default. It must not become a hard-coded retention rule without policy approval.

### Engine execution runs

The initial adapter is assessment-only. It may classify status, size payloads, validate lineage, and recommend archive/thinning. It MUST return `execution_allowed=false` when the retention/archive contract is missing. It MUST NOT delete runs, null payload fields, or rewrite audit evidence.

### Sensitive lineage resources

Session events, transcript turns, audit logs, and security-sensitive records remain blocked unless an explicit domain policy, owner, retention basis, preservation rules, and rollback/readback contract are approved.

## Immutable Plan Contract

Every plan MUST contain at least:

```json
{
  "plan_id": "...",
  "resource_uri": "mysql://growthOS/governed_tool_response_chunks",
  "resource_version": "...",
  "recipe_key": "database.response_chunks.expired_cleanup",
  "policy_version": "1",
  "cutoff_at": "2026-08-13T00:00:00Z",
  "candidate_rows": 0,
  "estimated_payload_bytes": 0,
  "estimated_reclaimable_bytes": 0,
  "risk_class": "medium",
  "batch_size": 500,
  "max_batches": 20,
  "preservation_rules": [],
  "authority_requirement": "exact_resource_and_recipe",
  "requires_typed_confirmation": true,
  "requires_same_cycle_readback": true,
  "plan_fingerprint": "sha256:..."
}
```

The plan fingerprint covers canonicalized plan content and is immutable after approval. A stale plan, changed cutoff, changed resource identity, changed candidate set, changed policy revision, or changed preservation invariant MUST fail closed.

## Authority and Approval

A database authority grant MUST bind `resource_type=database_table`, an exact resource URI, an exact recipe key, an authority revision, the actor/principal, and an expiry. `mysql://growthOS/*`, `mysql://*`, `database`, and equivalent wildcard scopes are invalid. A typed approval binds `plan_id`, fingerprint, cutoff, resource, recipe, risk class, and authority binding; it cannot be replayed against another plan.

Low-risk policy-bound execution may be considered only after observation evidence and an approved policy. Archive, purge, compaction, rebuild, truncate, and physical reclaim always require stronger approval and a separate risk contract.

## Durable Execution and Readback

Mutation receipts are the authority for idempotency, unknown outcomes, retry safety, mutation identity, and readback reconciliation. `execution_plan_events` remain timeline/evidence and are not a substitute for a durable mutation receipt. If the canonical `execution_plan_mutation_receipts` schema is not present and authorized in the target environment, mutation execution remains disabled even when the source migration exists.

A database disconnect after dispatch produces `unknown_outcome`, not an automatic retry. Reconciliation must establish whether the exact mutation occurred before a retry can be considered. Partial batch failure leaves the plan and receipt open for bounded reconciliation; it never silently changes batch limits or candidate predicates.

## Logical Cleanup and Physical Reclaim

The logical result records deleted rows, logical bytes removed, remaining eligible rows, and preservation checks. The physical result records table size, `data_free`, engine, estimated reclaimable bytes, maintenance-window requirement, concurrency evidence, and whether a separate reclaim plan is safe. These results are never collapsed into one success flag.

```text
logical cleanup succeeded
    != physical space reclaimed
```

## Storage Pressure Thresholds

The following values are design candidates, not production policy defaults: 80% used may produce a warning, 85% may generate read-only plans, 90% may make already-eligible low-risk policy cleanup reviewable, and 95% may enter an emergency observation mode. Emergency mode may accelerate observation and already-approved eligible work; it MUST NOT change retention rules or bypass authority/approval.

## Error Taxonomy

Machine-readable errors include:

`DATABASE_LIFECYCLE_POLICY_MISSING`, `DATABASE_RESOURCE_NOT_REGISTERED`, `DATABASE_RESOURCE_AUTHORITY_REQUIRED`, `DATABASE_RECIPE_NOT_EXECUTABLE`, `DATABASE_PLAN_FINGERPRINT_MISMATCH`, `DATABASE_PLAN_STALE`, `DATABASE_CUTOFF_MISMATCH`, `DATABASE_BATCH_LIMIT_EXCEEDED`, `DATABASE_PRESERVATION_INVARIANT_FAILED`, `DATABASE_READBACK_MISMATCH`, `DATABASE_PHYSICAL_RECLAIM_UNSAFE`, `DATABASE_INSUFFICIENT_RECLAIM_HEADROOM`, `DATABASE_CONCURRENT_WRITER_DETECTED`, and `DATABASE_MUTATION_RECEIPT_REQUIRED`.

Errors MUST be structured, bounded, actionable, and free of secrets or raw SQL content.

## Security and Safety Requirements

The implementation MUST use least privilege, exact resource scope, path/identifier allowlists, parameterized registered operations, immutable plan evidence, typed approval, expiry, replay protection, bounded batches, idempotency, and same-cycle readback. It MUST reject injection, path traversal, arbitrary table selection, arbitrary predicates, secret output, stale evidence, missing policy, missing receipt authority, and unknown outcome retries.

## Observability

Each lifecycle cycle should expose pressure percentage, eligible rows, estimated bytes, actual deleted rows, logical bytes removed, physical bytes reclaimed, batch duration, lock duration, remaining eligible rows, readback mismatches, policy version, plan fingerprint, authority binding ID, approval ID, execution receipt ID, policy coverage, and last successful lifecycle run. Dashboard work is a later delivery slice; the contract is established here.

## Compatibility and Rollout

The implementation is multi-PR and additive:

1. Spec and contracts only.
2. Read-only pressure inspector, resource classification, policy resolution, and planner.
3. Exact `database_table` resource authority and durable mutation-readiness binding.
4. Response-chunk TTL cleanup pilot in non-production first.
5. Repo-audit supersession adapter after preservation evidence.
6. Bounded JobRunner using the same registered recipes and receipts.
7. Policy-bound autopilot only after an observation period.
8. Engine-run archive/thinning design as a separate policy project.
9. Physical reclaim assessment and, later, high-risk reclaim operations as a separate slice.

No production deployment or mutation is implied by this Spec Kit.

## Acceptance Criteria

1. Storage pressure can be observed without manual SQL.
2. Largest consumers, growth, policy coverage, eligible rows, and reclaim estimates are exposed as bounded evidence.
3. TTL, supersession, audit/session lineage, and unknown retention are classified differently.
4. Missing policy, missing authority, stale plan, and missing receipt authority fail closed.
5. No arbitrary SQL or wildcard database authority is exposed.
6. Every mutation plan is immutable, fingerprinted, bounded, and tied to exact resource and recipe identity.
7. Typed approval cannot be replayed against a different plan.
8. Durable receipts, idempotency, unknown-outcome reconciliation, and same-cycle readback are required.
9. Response-chunk cleanup preserves non-expired and post-plan rows and never auto-compacts.
10. Repo-audit cleanup preserves latest file observations, parent runs, and non-terminal runs.
11. Engine execution runs remain mutation-blocked without an archive/thinning policy.
12. Logical cleanup and physical reclaim are measured independently.
13. OpenAPI/contracts, tests, documentation, observability, rollback, and staging/canary gates are updated before production promotion.
14. The Spec/Contracts PR performs no migration apply, protected-branch write, production mutation, or deployment.

## Definition of Done for the Feature

The feature is not complete until a governed surface can perform the read-only pressure-to-plan path, execute the approved response-chunk pilot end-to-end without manual phpMyAdmin, preserve the latest repo finding per file, keep engine runs plan-only without archive policy, maintain exact authority and durable receipts, enforce same-cycle readback, report logical versus physical outcomes separately, and pass staging/canary/readback gates. This Spec PR intentionally delivers only the contract foundation.
