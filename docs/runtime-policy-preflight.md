# Runtime Policy Preflight

## Purpose

This phase restores `execution_policies` as an active runtime authority source instead of leaving it as migrated registry memory or readiness evidence only.

The first enforcement surface is repository/GitHub mutation safety because it is high-impact and already showed a real stale-branch scenario during platform maintenance.

## Added runtime modules

```text
http-generic-api/runtimePolicyLoader.js
http-generic-api/governedExecutionPreflight.js
```

`runtimePolicyLoader` reads active rows from `execution_policies` and filters them by:

- `policy_group`
- `policy_key`
- `execution_scope`
- `affects_layer`
- `blocking`

`governedExecutionPreflight` evaluates matching policies and returns a structured decision envelope:

```json
{
  "ok": true,
  "classification": "allow|allow_with_policy_warnings|blocked",
  "policy_source": "execution_policies",
  "policies": [],
  "blocking_policies": [],
  "warnings": [],
  "errors": [],
  "evidence": {},
  "secrets_included": false
}
```

## First active policy

Migration:

```text
http-generic-api/migrations/122_sprint64_runtime_policy_preflight.sql
```

Policy row:

```text
policy_group: Repository Mutation Governance
policy_key: Stale Duplicate Branch Merge Guard
execution_scope: repo_mutation|github_pr_merge|branch_delete
affects_layer: adminCliRoutes|github_rest_fallback|repo_patch_apply
blocking: TRUE
```

Policy value includes:

```text
require_compare_main_branch=true
block_unmerged_branch_delete=true
block_risky_file_statuses=true
risky_file_statuses=removed
require_mergeability_check=true
```

## Current enforcement points

`adminCliRoutes.js` calls governed preflight before GitHub mutations:

- `gh pr merge ...`
- GitHub REST fallback `pr merge`
- GitHub REST fallback branch-ref delete

`gptToolsRoutes.js` now calls governed preflight in two places:

- generic `/gpt/tools/call` dispatch path via `evaluateGptToolDispatchPreflight`
- `repo_patch_apply` before branch creation, branch reuse, or GitHub Contents writes

The preflight fetches PR/branch compare evidence through the GitHub App token and blocks clear unsafe conditions:

- protected/default branch delete
- branch delete while the branch still has commits ahead of `main`
- non-mergeable PRs when GitHub reports `mergeable=false`
- PRs that contain risky removed-file statuses under the active policy
- repo patch attempts against an existing branch that is behind/diverged from the default branch unless `allow_stale_branch_patch=true` and `stale_branch_reason` is supplied

Warnings are preserved for conditions that should be visible but not always blocking:

- PR branch is behind base
- compare status is diverged
- mergeability is not final yet
- existing repo patch branch already has commits ahead of `main`

## Why this matters

The older Workbook/Sheet governance canonicals treated `Execution Policy Registry` as an authority for blocking/degraded outcomes. The SQL migration preserved the data but not all runtime semantics. This phase starts reconnecting that table to real JS execution paths.

## Next enforcement targets

- `repo_patch_apply`
- generic `/gpt/tools/call` dispatch
- `appAdapters/index.js` before external app actions
- `connectorExecutor.js` before workflow dispatch
- `agentLoopRunner.js` before model/tool loops

These should reuse the same preflight envelope and add policy-specific evaluators rather than embedding one-off hardcoded checks.
