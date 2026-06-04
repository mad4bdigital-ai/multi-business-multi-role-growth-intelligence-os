# GitHub Branch Maintenance Fallbacks

Date: 2026-06-04

## Purpose

This change adds governed fallback support for two branch maintenance paths when `gh` is not installed on the host running admin control.

## Option 1: Branch ref reset

The GitHub REST fallback now supports guarded branch ref updates:

```text
gh api -X PATCH /repos/{owner}/{repo}/git/refs/heads/{branch}
```

The fallback accepts this only when all guardrails pass:

- branch is not `main`, `master`, `production`, `prod`, `staging`, or `release`
- branch starts with `gpt/`, `chore/`, `fix/`, `feature/`, `docs/`, or `hotfix/`
- `sha` is a 40-character commit SHA
- `force=true` is explicit
- a typed confirmation is present

Confirmation format:

```text
RESET_BRANCH_REF_<BRANCH_WITH_NON_ALNUM_AS_UNDERSCORES_UPPERCASE>
```

Example:

```text
RESET_BRANCH_REF_GPT_CONNECTED_EXECUTION_WORKER_BRIDGE
```

The confirmation is stripped before the GitHub API body is sent.

## Option 2: Merge-base update

Existing REST fallback support remains available for:

```text
POST /merges
PUT /pulls/{pull_number}/update-branch
```

This gives the platform two maintenance strategies:

1. safely reset a non-production PR branch to a known base SHA and reapply changes
2. ask GitHub to merge/update the branch when the merge can be resolved automatically

## Safety

This does not enable production branch mutation.
It does not expose secrets.
It does not allow workflow file mutation.
It keeps unsupported GitHub API paths blocked by default.
