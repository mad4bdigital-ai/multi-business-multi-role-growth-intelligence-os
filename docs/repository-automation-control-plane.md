# Repository Automation Control Plane

## Status

Implemented as an Admin-only, SQL-primary orchestration layer. The control plane coordinates existing governed tools; it does not replace their action-specific authority.

## Purpose

The control plane reduces repeated manual coordination across pull-request delivery, migration release, deployment readback, branch cleanup, operational closeout, and recurring repository hygiene. It preserves the same safety gates that apply when each tool is called separately.

## Admin tools

| Tool | Purpose | Mutation behavior |
| --- | --- | --- |
| `repository_automation_plan` | Build a deterministic workflow plan and identify missing approvals or inputs | Read-only |
| `repository_automation_run` | Execute or resume a workflow through existing governed tools | Dry-run by default; apply is envelope-gated |
| `repository_automation_status` | Read the run, step timeline, receipts, and readback evidence | Read-only |
| `repository_automation_hygiene_scan` | Detect expired envelopes/overrides, unapplied migrations, stale runs/PRs, merged branches, and deployment drift | Read-only |

## Workflow templates

- `pr_delivery`: Docs Agent stabilization, Spec lifecycle guard, branch reconciliation, CI, CI recovery, mark-ready, merge, branch cleanup, and deployment parity.
- `migration_release`: production parity, authorization bootstrap, dry-run, apply, and ledger readback.
- `post_merge_closeout`: production parity, SQL cache diagnostics, operational-alert synchronization, migration ledger, and repository inventory.
- `branch_cleanup`: drift classification, cleanup dry-run, and evidence-bound apply.
- `spec_lifecycle`: decide active `specs/<feature>/` versus implemented `docs/history/<topic>/` placement.
- `hygiene_scan`: read-only daily/weekly maintenance findings.
- `full_workstream`: combines all applicable stages into one resumable run.

## Safety model

### Outer and inner authority

Apply mode requires a ready `platform_orchestration` capability envelope for the compound run. This outer envelope authorizes orchestration only. Every nested mutation still requires the original tool's own capability envelope, typed confirmation, expected SHA/checksum, approval, ledger, and readback evidence.

The control plane never:

- creates approvals automatically;
- invents typed confirmations;
- force-pushes;
- injects provider credentials;
- executes freeform mutation SQL;
- bypasses repository mutation policy;
- treats an incomplete readback as success.

When a nested mutation is missing required fields, the run stops at `awaiting_input` and returns a resumable checkpoint.

### Just-in-time envelopes

Create nested envelopes immediately before the relevant mutation, after CI, SHA, checksum, and resource evidence is fresh. Expired envelopes are not reused. The hygiene scan reports expired ready/referenced envelopes for explicit review.

### Retry and idempotency

A step receives a stable request hash and idempotency key. Successful mutations create a no-secret receipt. When a 502, 503, or 504 interrupts a mutation response, the control plane performs readback before retry. If readback proves completion, the receipt is marked recovered and the mutation is not replayed. Otherwise only one bounded retry is allowed.

### Response chunks

Large governed responses are consumed through `response_chunk_read` until continuation is complete. The collector records chunk count and a response hash, reconstructs JSON when possible, and blocks fallback while required chunks remain unread.

## PR delivery behavior

1. Read the PR twice and require a stable head SHA after automated documentation commits.
2. Classify Spec content before CI.
3. Reconcile branch drift through governed branch tools; no force update.
4. Read required checks and dispatch CI only when missing and separately approved.
5. Mark the PR ready only with pinned head/base evidence.
6. Finalize through `github_pr_finalize` with the four required checks.
7. Verify merge ancestry and branch absence.
8. Verify production checkout is clean and equals current GitHub `main`.

## Migration release behavior

1. Verify production/main parity.
2. Bind authorization to the published migration SHA-256 and statement count.
3. Require zero-risk dry-run.
4. Create and apply-authorize a just-in-time migration envelope.
5. Apply through `governed_migration_execute`.
6. Verify the governed ledger and business-state readback.

## Spec lifecycle behavior

- Active governed delivery remains under `specs/<feature>/` and must satisfy the current completion gate.
- Implemented or superseded reference material belongs under `docs/history/<topic>/`.
- Historical curation blocks stale `completion.json`, `tasks.md`, checklists, and duplicated generated PR documentation.

## Deployment parity

Normal production deployment is Hostinger Auto Deploy from `main`. The parity watcher compares GitHub `main` with the production checkout and requires a clean checkout. It never opens routine SSH deployment. A mismatch returns `deploying_or_degraded` and requests a later readback.

## Hygiene cadence

Migration `1034_sprint69_repository_automation_control_plane.sql` stores a disabled-by-default cadence contract:

Daily findings:

- expired temporary policy overrides;
- merged PR branches still present;
- stale draft PRs;
- missing required checks;
- production/main SHA mismatch;
- authorized but unapplied migrations.

Weekly findings:

- SQL cache health trends;
- migration-ledger reconciliation;
- historical material under active Spec paths;
- open-PR dependency graph.

The cadence is read-only. Enabling a scheduled runner requires separate certification of a governed Admin job or n8n binding.

## Persistence

- `repository_automation_runs`: workflow identity, plan hash, status, stage, and summary.
- `repository_automation_step_runs`: ordered steps, attempts, outputs, and failures.
- `repository_automation_receipts`: idempotent mutation receipts and readback evidence.

All three tables enforce `secrets_included = 0`.

## Examples

### Plan a full workstream

```json
{
  "automation_key": "full_workstream",
  "mode": "dry_run",
  "pull_number": 2044,
  "branch": "gpt/example",
  "migration": "1034_sprint69_repository_automation_control_plane.sql",
  "expected_checksum_sha256": "<64 hex characters>",
  "expected_statement_count": 12
}
```

### Read-only hygiene scan

```json
{
  "owner": "mad4bdigital-ai",
  "repo": "multi-business-multi-role-growth-intelligence-os",
  "include_github": true,
  "stale_hours": 24,
  "stale_draft_days": 7
}
```

## Operational interpretation

A completed orchestration run means every included step completed with its required evidence. `awaiting_input` means the plan is healthy but a fresh approval, confirmation, SHA, checksum, or tool-specific envelope is still required. `blocked` means a policy, authority, drift, CI, deployment, or readback condition failed and must not be bypassed.
