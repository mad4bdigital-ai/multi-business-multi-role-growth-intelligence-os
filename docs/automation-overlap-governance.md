# Automation Overlap Governance

## Purpose

This control prevents repository scripts, scheduled workflows, generated-artifact jobs, and database reconcilers from performing overlapping work without an explicit ownership and concurrency contract.

It supplements `scripts/taxonomy/script-taxonomy.json`:

- the taxonomy classifies what a script is responsible for;
- `automation-overlap-policy.json` declares which resources it may touch and how concurrent access is coordinated;
- `automation-overlap-analyzer.mjs` combines policy checks with behavioral discovery.

## Control Model

The analyzer builds this relationship graph:

```text
workflow trigger
  -> direct script
  -> transitive child scripts
  -> observed file/database behavior
  -> concurrency group
  -> governed resource group or advisory lock
```

Policy-declared regressions are classified as `critical` and block CI. Newly discovered behavioral overlaps are reported as `high` by default but remain non-blocking until reviewed. This ratchet avoids accepting new known hazards without making the first rollout depend on clearing every historical automation pattern at once.

## Governed Resource Groups

### Repository generated artifacts

The registered workflows participating in generated repository state are:

- `.github/workflows/openapi-auto-sync.yml`
- `.github/workflows/surface-contract-auto-remediation.yml`
- `.github/workflows/docs-agent.yml`
- `.github/workflows/docs-agent-main-followup.yml`

They share:

```text
repository-generated-artifacts-${{ github.repository }}-${{ github.ref }}
```

and retain:

```yaml
cancel-in-progress: false
queue: max
```

Queueing is intentional. `cancel-in-progress: false` prevents a running lifecycle from being interrupted, while `queue: max` permits multiple pending members of the same generated-artifact resource group to wait instead of using GitHub Actions' single-pending replacement behavior.

The queue is only one layer of the contract. Repository mutation is also separated from ambient events:

- Docs Agent pull-request runs are preview-only and have read permissions. Main impact-note publication is owned by the separate Docs Agent Main Follow-up writer.
- OpenAPI Auto Sync push runs resolve the exact live `main` SHA and dispatch an explicit writer run; the event job does not generate or publish repository changes.
- Surface Contract push and scheduled runs resolve the exact live `main` SHA and dispatch an explicit writer run; the event job does not create remediation branches or pull requests.
- Docs Agent Main Follow-up push runs likewise dispatch a writer bound to the exact main SHA and exact first-parent base.

Each repository writer is therefore a `workflow_dispatch` path with an explicit `expected_head_sha`. Before generation or branch publication it must prove that the checked-out commit and the live `main` ref still equal that expected SHA. Its proposed work branch must also be different from both `main` and `Production`.

This event-to-exact-writer pattern means queueing does not turn stale events into authority. When main moves before an event dispatcher acts, the stale event exits without mutation and the newer main event owns regeneration. When main moves after a writer is dispatched but before it writes, the writer fails closed on exact-head readback.

Cancelling a mutation workflow after it starts can interrupt generation, evidence collection, branch creation, or pull-request publication after only part of the lifecycle has completed. Replacing a pending lifecycle before it starts is also unsafe because it silently drops the requested work. Executing a queued lifecycle against a newer unpinned main snapshot is unsafe for the opposite reason: it performs work that was never bound to the triggering state. The governed queue and exact-head writer contract address all three cases.

### Governed Work Map writer

Pull-request Work Map generation remains separately serialized by the PR-keyed Work Map writer/recovery lease. It also uses `cancel-in-progress: false` and `queue: max`, and mutation remains bound to exact pull-request head identity rather than an ambient branch checkout.

### Governed migration reconciliation

Every entry point into `runGovernedMigrationReconciliationRuntime` uses the MySQL advisory lock:

```text
governed_migration_reconciliation.v1
```

The lock is acquired and released on one dedicated connection. When busy, the second invocation returns a bounded successful skip rather than executing a second reconciler.

## Schedule Separation

The daily surface-contract remediation precedes the platform completion readback. The policy requires at least 20 minutes between them so the readback observes post-remediation state rather than an in-flight snapshot.

The scheduled Surface Contract event is a dispatcher, not direct mutation authority. Its writer still has to bind itself to exact current `main` before changing generated evidence or opening a remediation PR.

## Local Commands

From `http-generic-api`:

```bash
npm run automation:overlap:report
npm run automation:overlap:check
npm run test:automation:overlap
```

A machine-readable and Markdown report can be written with:

```bash
node scripts/automation-overlap-analyzer.mjs \
  --check \
  --report-file=automation-overlap-report.json \
  --markdown-file=automation-overlap-report.md
```

The repository lifecycle regression is also part of the governed automation boundary:

```bash
node scripts/test-repository-tool-lifecycle-guard.mjs
```

## Adding Automation

Before adding or changing a script or workflow:

1. Classify the script in `script-taxonomy.json`.
2. Identify files, database tables, queues, branches, pull requests, and provider effects it may mutate.
3. Reuse an existing resource group when ownership overlaps.
4. Add a new resource group only when the resource boundary is real and independently operable.
5. Use a bounded multi-pending concurrency queue for shared mutation lifecycles; do not rely on the single-pending default.
6. Separate pull-request previews from repository writers.
7. For push, schedule, or other ambient events that can lead to repository mutation, use the event only to resolve and dispatch an exact-head writer.
8. Require the writer to reject stale source identity and protected target branches before mutation.
9. Use a durable database lock, lease, claim token, or queue ownership mechanism for database and worker coordination.
10. Add tests for lock-busy, stale-head rejection, failure cleanup, repeated invocation, and idempotent replay.
11. Run the overlap and lifecycle checks before requesting review.

## Ratcheting

Behavioral findings should not remain permanently non-blocking.

For each recurring finding:

1. Confirm the inferred call and write paths.
2. Assign one owner.
3. Add or reuse a resource group or lock contract.
4. Separate observation/preview events from mutation authority where necessary.
5. Remove any temporary allowlist entry.
6. Raise the CI threshold from `critical` to `high` after the high-severity baseline reaches zero.

## Failure Handling

The overlap analyzer fails closed for missing policy workflows, concurrency drift, unsafe mutation cancellation, insufficient governed schedule separation, and incomplete database lock contracts. Focused regression tests additionally require shared generated-artifact workflows to retain their declared multi-pending queue.

Repository Tool Lifecycle Governance independently rejects pull-request write workflows, branch-specific work literals, unguarded repository mutation, missing expected-head verification, protected-branch mutation, force pushes, and unregistered maintenance tools. The two controls are complementary: overlap governance determines who may share a mutable resource and how work queues; lifecycle governance determines how each admitted writer proves authority to mutate.

Reports contain no credentials or raw environment values and explicitly return `secrets_included: false`.
