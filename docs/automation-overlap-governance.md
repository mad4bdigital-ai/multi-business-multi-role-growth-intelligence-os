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

The following workflows may write generated repository state:

- `.github/workflows/openapi-auto-sync.yml`
- `.github/workflows/surface-contract-auto-remediation.yml`
- `.github/workflows/docs-agent.yml`

They must share:

```text
repository-generated-artifacts-${{ github.repository }}-${{ github.ref }}
```

and must use `cancel-in-progress: false`.

Queueing is intentional. Cancelling a mutation workflow can interrupt generation, evidence collection, branch creation, or pull-request publication after only part of the lifecycle has completed.

### Governed migration reconciliation

Every entry point into `runGovernedMigrationReconciliationRuntime` uses the MySQL advisory lock:

```text
governed_migration_reconciliation.v1
```

The lock is acquired and released on one dedicated connection. When busy, the second invocation returns a bounded successful skip rather than executing a second reconciler.

## Schedule Separation

The daily surface-contract remediation precedes the platform completion readback. The policy requires at least 20 minutes between them so the readback observes post-remediation state rather than an in-flight snapshot.

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

## Adding Automation

Before adding or changing a script or workflow:

1. Classify the script in `script-taxonomy.json`.
2. Identify files, database tables, queues, branches, pull requests, and provider effects it may mutate.
3. Reuse an existing resource group when ownership overlaps.
4. Add a new resource group only when the resource boundary is real and independently operable.
5. Use a durable database lock, lease, claim token, or queue ownership mechanism for database and worker coordination.
6. Add tests for lock-busy, failure cleanup, repeated invocation, and idempotent replay.
7. Run the overlap check before requesting review.

## Ratcheting

Behavioral findings should not remain permanently non-blocking.

For each recurring finding:

1. Confirm the inferred call and write paths.
2. Assign one owner.
3. Add or reuse a resource group or lock contract.
4. Remove any temporary allowlist entry.
5. Raise the CI threshold from `critical` to `high` after the high-severity baseline reaches zero.

## Failure Handling

The analyzer fails closed for missing policy workflows, concurrency drift, unsafe mutation cancellation, insufficient governed schedule separation, and incomplete database lock contracts.

Reports contain no credentials or raw environment values and explicitly return `secrets_included: false`.
