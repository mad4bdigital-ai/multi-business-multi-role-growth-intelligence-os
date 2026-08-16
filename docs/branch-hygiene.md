# Branch Hygiene Governance

## Purpose

The repository intentionally creates many short-lived branches for generated-artifact recovery, evidence collection, production-promotion validation, and parallel feature work. This policy keeps branch inventory bounded without deleting unmerged work or disturbing protected release paths.

## Operating modes

The workflow `.github/workflows/branch-hygiene.yml` supports two modes. `dry_run` is the default for manual dispatch and produces a complete JSON report without deleting refs. The weekly schedule runs the policy's configured `schedule_mode`, currently `apply`, but the apply path remains limited to branches that satisfy every deletion predicate.

An explicit manual apply requires the exact confirmation string `APPLY_BRANCH_HYGIENE`. The workflow is restricted to `main`, uses a single concurrency group, revalidates the default branch SHA, and revalidates every branch head immediately before deletion.

## Deletion predicates

A branch is eligible for deletion only when it is fully merged into `main`, has no open pull request, is not provider-protected, does not match a protected or excluded namespace, and is older than the seven-day grace period. The mutation path never force-pushes, never mutates `main` or `Production`, and does not access databases, providers, credentials, or deployment systems.

## Non-destructive review path

Branches with unmerged commits are report-only. Once they exceed the review TTL, the report marks them for review and includes their exact head SHA, age, unique commit count, namespace classification, and open-PR state. The workflow does not archive or delete these branches automatically because their commits may not exist in `main`.

## Permanent exclusions

The policy excludes `main`, `Production`, provider-protected branches, `feat/spec015-tenant-audit-convergence`, production-promotion candidate and validation namespaces, generated-artifact recovery branches, Work Map recovery branches, and evidence/recovery namespaces. These patterns are tested in CI and are bound to a policy SHA in every report.

## Audit evidence

Each run uploads `branch-hygiene-report-<run_id>` for 90 days. The report contract is `mad4b.branch-hygiene-report.v2` and includes the policy SHA-256, exact `main` SHA, mode, category counts, safety flags, triage summaries, and per-branch decisions. The report is the source of truth for subsequent review or any separately authorized cleanup campaign.

## Triage taxonomy and processing queue

Report v2 adds a deterministic triage layer so a maintainer can sort the complete inventory before taking any separate cleanup decision. Every branch receives a `priority`, `reasonCode`, `recommendedAction`, `actionOwner`, `ageBand`, and `namespace`. The priority order is `critical`, `high`, `medium`, `low`, then `info`; the canonical sort is priority rank ascending, age descending, unique commit count descending, and branch name ascending.

| Priority | Meaning | Typical action | Owner |
|---|---|---|---|
| `critical` | A cleanup attempt failed or needs immediate investigation. | Investigate the failure and revalidate the branch head. | Maintainer |
| `high` | The branch is either delete-eligible under all predicates or has an open pull request blocking cleanup. | Apply the governed delete path, or review the open PR. | Automation or maintainer |
| `medium` | Unmerged work has passed the review TTL and requires an explicit human decision. | Review, rebase, archive, or close through a separately authorized process. | Maintainer |
| `low` | Unmerged or unclassified work is not yet old enough for the review queue. | Retain and revisit later. | Maintainer |
| `info` | The branch is protected, excluded, active, or inside the grace period. | Retain; no cleanup action is proposed. | None or automation |

`recommendedAction` is an operational recommendation, not an authorization. In particular, `review_unmerged_or_archive` never implies deletion authority, and the excluded namespace `feat/spec015-tenant-audit-convergence` remains retained regardless of age or merge state.

## Report formats

Each workflow run produces one canonical report and two derived views. The JSON artifact, `branch-hygiene-report.json`, is the complete machine-readable inventory and audit record. The CSV artifact, `branch-hygiene-report.csv`, contains one sortable row per branch with stable columns for namespace, age, merge state, open PR, priority, reason, recommended action, ownership, and mutation outcome. The Markdown artifact, `branch-hygiene-report.md`, contains the priority and action summaries plus the actionable queue, limited to the first 200 actionable rows for readable workflow summaries. The full JSON or CSV should be used when the queue contains more rows than the Markdown display limit.

The workflow publishes the Markdown report to `GITHUB_STEP_SUMMARY` and uploads all three formats together with the command summary. Every artifact remains bound to the exact `main` SHA and policy SHA, which prevents a report from being mistaken for evidence about a later state of the repository.

## Safe processing procedure

Start with the `critical` and `high` rows, then review `medium` rows with their unique commit counts and exact head SHAs. Only branches classified as `delete_eligible` may enter the governed apply path, and the apply path still revalidates both the default branch and each branch head immediately before deletion. No report category authorizes force-pushes, production changes, database mutations, provider changes, credential access, or changes to the excluded Spec 015 path.

The weekly workflow retains its configured `apply` mode, while manual runs default to `dry_run`. A maintainer should use the CSV or JSON artifact to make any explicit decision about unmerged work rather than treating the Markdown display as a complete inventory.

## Contract version

The current report contract is `mad4b.branch-hygiene-report.v2`, with policy contract `mad4b.branch-hygiene-policy.v2`. Consumers that require the former v1 shape should pin or migrate their parser before adopting the v2 artifact.
