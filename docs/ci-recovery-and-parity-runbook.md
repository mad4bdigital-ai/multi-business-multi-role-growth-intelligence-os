# CI Recovery and Local Parity Runbook

Date: 2026-06-02

## Purpose

This runbook documents the governed CI recovery and local parity flow for the platform repository.

The goal is to diagnose CI failures quickly without exposing secrets, without relying on raw GitHub UI inspection, and without adding duplicate tooling when `admin_control` already exposes the required GitHub REST fallback capabilities.

## Current governed capabilities

Use `admin_control` with `tool: github`.

### List recent runs

```json
{
  "tool": "github",
  "args": [
    "run", "list",
    "--branch", "main",
    "--limit", "8",
    "--json", "databaseId,displayTitle,workflowName,headSha,status,conclusion,createdAt,url"
  ]
}
```

This uses the GitHub REST fallback when `gh` CLI is unavailable.

### Inspect a run

```json
{
  "tool": "github",
  "args": [
    "run", "view", "<run_id>",
    "--json", "databaseId,displayTitle,workflowName,headSha,status,conclusion,createdAt,url"
  ]
}
```

### Read failed logs only

```json
{
  "tool": "github",
  "args": [
    "run", "view", "<run_id>",
    "--log-failed"
  ]
}
```

Use this only after a run has failed or timed out. Do not fetch full successful logs unless required.

## Local parity checks before PR

Run the smallest relevant check set before opening a PR.

### JavaScript syntax

```bash
node --check <changed-file>.js
node --check <changed-script>.mjs
```

### Release readiness parser changes

```bash
node --check http-generic-api/releaseReadiness.js
node --check http-generic-api/test-release-readiness-migration-drift.mjs
```

When dependencies are available, also run:

```bash
node http-generic-api/test-release-readiness-migration-drift.mjs
```

### Shell alias / admin route changes

```bash
node --check http-generic-api/routes/adminCliRoutes.js
```

### Governed migration runner changes

```bash
node --check http-generic-api/scripts/governed-migration-runner.mjs
```

## CI recovery decision tree

1. List latest runs for the branch.
2. If all required runs are successful, no recovery action is needed.
3. If a run failed, fetch only failed logs with `run view <run_id> --log-failed`.
4. Classify the failure:
   - syntax or lint failure
   - test failure
   - OpenAPI/schema sync failure
   - missing dependency or environment assumption
   - merge/base drift
   - transient infrastructure failure
5. Apply the smallest safe fix.
6. Re-run CI by pushing a new commit; do not merge with failing checks unless explicitly approved.

## Readiness relationship

`release_readiness` is not a replacement for CI. It verifies runtime DB/platform surfaces after deployment.

CI verifies repository build/test/schema constraints before merge.

Both must remain green for a clean release closure.

## Current baseline

At the time this runbook was added, the latest `main` CI and OpenAPI Auto Sync runs after the admin tool smoke readiness merge were successful.

Latest merged stabilization commits included:

- governed migration execution ledger
- governed migration record-only backfill mode
- governed migration ledger readiness summary
- read-only admin tool registry smoke readiness check

## Safety notes

- Use GitHub REST fallback through `admin_control`; do not expose tokens.
- Prefer failed logs only.
- Keep PR fixes small and focused.
- Do not mutate GitHub workflow files through fallback content writes.
- Do not perform branch deletes or merges without passing governed preflight.
