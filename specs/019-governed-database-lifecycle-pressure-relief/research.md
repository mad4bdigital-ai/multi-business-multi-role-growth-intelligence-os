# Research — Spec 019 Governed Database Lifecycle and Pressure Relief

## Findings from the Current Repository

The repository already has a database lifecycle registry and a mature read-only governance path. Existing surfaces cover registry upsert planning, lifecycle reporting views, daily snapshots, scheduler readiness, approval metadata, operational status, incident bridging, and retention-plan summaries. The current implementation deliberately avoids delete, archive, truncate, and compaction execution. This is the correct baseline for a safe extension, not a missing generic SQL tool.

The canonical durable execution migration `20260730_spec011_durable_execution_control.sql` provides the relevant mutation-receipt direction, but target-environment application and authorization must be read back before any lifecycle mutation is enabled. Source presence is not production readiness.

## Incident-Derived Domain Evidence

The design is grounded in three behaviors. Response chunks have authoritative expiry semantics. Repository audit findings require supersession and latest-observation preservation. Engine execution runs contain large payloads but lack an approved archive/thinning policy and therefore remain plan-only. Physical reclaim is independent from logical deletion because InnoDB `data_free` can remain after rows are removed.

## Related PR Assessment

PR #6886 (`gpt/018-break-glass-lifecycle-20260810`) is a governance pattern for incident-bound approval, evidence, reconciliation, and fail-closed transitions. It is not a database cleanup implementation and should not be expanded into one. The existing Spec 018 number remains reserved for environment promotion/runtime integrity.

The repository-evaluation diagnostics branches are not implementation authorities for lifecycle cleanup. PR #7027 (`fix/collation-runtime-persistence-authority`) is adjacent plumbing for explicit runtime persistence authority and may be a dependency for future response-chunk work, but it does not contain lifecycle planning, cleanup, or reclaim behavior. It must not be duplicated blindly if it is merged first.

## Reuse Decisions

The feature should reuse `platform_resource_types`, `platform_resource_adapters`, `platform_resource_recipes`, `platform_resource_recipe_steps`, `execution_plans`, `execution_plan_steps`, `execution_plan_events`, and `execution_plan_mutation_receipts` where their contracts fit. A new lifecycle-specific registry should not be created until the reusable recipe/policy model is proven insufficient.

## Open Questions

The first implementation PRs must determine how target environments expose quota and physical reclaim metrics, whether all required mutation-receipt tables and authorization rows are applied, how resource versions are read back, and what exact low-risk policy is approved for response chunks. None of these questions authorize a source-only default or a production mutation.
