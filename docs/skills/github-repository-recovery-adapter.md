# GitHub Repository Recovery Adapter Skill

## Purpose

This adapter handles GitHub-specific repository, PR, CI, workflow-run, and branch recovery. It must use the general Platform Registry & Database Recovery Skill for any DB-backed registry bootstrap or repair.

## Dependency

```text
github_repository_recovery_adapter
  depends_on -> platform_registry_database_recovery
```

## Supported recovery cases

```text
GitHub CI failure
workflow action_required
missing GitHub REST endpoint
response_schema_missing
pull_request_head_not_fresh
diverged_no_overlap
diverged_same_files
activation surface coverage failure in CI
```

## GitHub workflow approval endpoint

The canonical endpoint is:

```text
parent_action_key = github_api_mcp
endpoint_key = github_approve_workflow_run
method = POST
path = /repos/{owner}/{repo}/actions/runs/{run_id}/approve
expected_success_status = 204
```

The endpoint is exposed only through the registry-driven `github_rest_endpoint_dispatch` tool. Callers must not provide raw GitHub URLs, raw HTTP methods, or authorization headers.

## Mutation requirements

Provider writes require:

```text
registry endpoint authority
dry-run/preflight
typed confirmation
same-cycle readback
no force push
no direct main write
no secrets returned
```

## CI and PR gate

Repository finalization must use the governed PR gate with required checks:

```text
Syntax Check
Architecture Drift Detection
Execution Resolver Gate
Unit & Integration Tests
```

Merges require expected head/base SHA validation and a governed capability envelope. Branch cleanup requires same-cycle absence readback.

## Branch drift policy

```text
ahead_only -> PR may proceed after checks
behind_only -> fast-forward/reconcile before merge
diverged_no_overlap -> recoverable with governed reconcile or narrow policy
diverged_same_files -> stop for explicit conflict resolution
```

## Evidence expectations

A successful adapter action should leave evidence in `execution_log`, including resolved `agent_key`, `skill_key`, `skill_grant_resolution`, and no secrets. The general execution evidence logger resolves tenant-scoped grants first, then global grants.
