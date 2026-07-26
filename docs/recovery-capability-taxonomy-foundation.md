# Recovery Capability Taxonomy Foundation

Date: 2026-05-31

## Purpose

This foundation adds a registry-first recovery taxonomy for CI and repo recovery work. It is intentionally read-only: it classifies failures, describes evidence requirements, and exposes planning tools through existing platform engine surfaces.

It does not fetch secrets, mutate repositories, update branches, apply patches, or merge pull requests.

## Registry Objects

Migration:

- `http-generic-api/migrations/174_sprint65_recovery_capability_taxonomy_foundation.sql`

Tables:

- `platform_recovery_failure_taxonomy`

Engine:

- `recovery_capability_taxonomy_engine`

Policy:

- `recovery_capability_taxonomy_policy_v1`

Skills:

- `github_ci_recovery`
- `repo_recovery`

## Recovery Capabilities

Seeded capability rules:

- `github.job_logs.get`
- `github.check_annotations.get`
- `github.ci.wait_for_sha`
- `github.ci.summarize_sha`
- `github.required_checks.summary`
- `repo.patch.error.classify`
- `repo.patch.context_recover`
- `repo.patch.no_match.diagnose`
- `github.pr.merge_idempotent`

These are declarative capability entries. They do not execute GitHub mutation or repo mutation directly.

## Failure Taxonomy

Seeded CI failure states:

- `pending`
- `failed_with_logs`
- `cancelled_by_newer_run`
- `skipped_by_path_filter`
- `guard_failed`
- `schema_contract_failed`
- `unit_test_failed`
- `stale_run`

Every taxonomy row carries:

- required evidence shape
- recommended recovery capabilities
- severity
- safe retry flag
- explicit `apply_allowed = 0`
- explicit `secrets_may_be_returned = 0`

## Admin Planning Tools

The migration registers read-only admin tools through existing platform engine paths:

- `github_ci_recovery_decision_brief`
- `github_ci_failure_classification_plan`
- `repo_patch_recovery_decision_brief`
- `github_required_checks_summary_plan`

All are tagged:

- `read_only`
- `no_execution`
- `no_apply`
- `no_secret_read`

## Boundaries

This foundation must not be expanded into apply behavior without a separate gated phase.

Still required before apply:

- resource authority gate
- validator gate
- approval gate
- scope guard
- audit evidence shape
- exact tests for live GitHub/App and connector relay behavior

Tenant GPT schema remains unchanged. Tenant capability expansion continues through registry-backed `listTools` and `callTool`, not direct admin route exposure.

## Verification

Static guard:

- `node http-generic-api/test-recovery-capability-taxonomy.mjs`

The guard asserts:

- all recovery capabilities are seeded
- all failure taxonomy states are seeded
- admin tools are read-only and no-apply
- migration is idempotent
- destructive SQL is absent
- tenant OpenAPI does not expose the recovery engine or admin tools
