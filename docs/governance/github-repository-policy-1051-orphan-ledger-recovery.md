# Migration 1051 orphan-ledger recovery

## Problem

Production can contain the complete metadata seeded by `1051_github_repository_policy_live_apply_authority.sql` while the exact checksum-bound `governed_migration_ledger` row is absent. In that state the GitHub Review Policy readiness gate must fail closed: complete metadata is not proof that the migration SQL was executed by the governed runner.

The recovery must not fabricate an `apply` ledger row and must not replay SQL under a generic continue instruction.

## Recovery contract

The existing `Governed Migration 1051 GitHub Repository Policy Authority Rollout` workflow owns the recovery. No second workflow authority is added.

Two explicit confirmations are added:

- `RECONCILE_1051_GITHUB_REPOSITORY_POLICY_RECORD_ONLY_LEDGER`
- `APPLY_1051_GITHUB_REPOSITORY_POLICY_AFTER_RECORD_ONLY_RECONCILIATION`

They are intentionally independent.

### Record-only reconciliation

The reconciliation job:

1. checks out the exact issue-comment event head;
2. runs the existing Migration 225 + Governance DB writer readiness guard;
3. runs the existing Migration 1051 authorization/bootstrap dry-run so the durable authorization is checksum-bound;
4. verifies exact Production runtime parity and the reviewed Migration 1051 Git blob;
5. requires the complete semantic metadata state: adapter/readback/apply policy/binding/policy layers, typed confirmation, same-cycle dry-run, capability readiness, authorized migration state, and `live_github_policy_apply=false`;
6. requires zero missing schema/readback objects and no conflicting ledger state;
7. invokes only the existing `migration_ledger_record_apply` shell alias with the exact `RECORD_1051_GITHUB_REPOSITORY_POLICY_LIVE_APPLY_AUTHORITY` runner confirmation;
8. verifies the resulting exact checksum ledger is `mode=record_only`, `applied_by=governed_migration_runner_backfill`, `record_only_backfill=true`, `sql_applied_by_this_run=false`, preflight pass/0, and `secrets_included=false`.

This phase does not replay Migration 1051 SQL and does not call GitHub provider mutation surfaces.

### Reconciled Apply

A later, separately confirmed job can execute Migration 1051 SQL only after:

1. Migration 225 and Governance DB writer readiness pass again in the same cycle;
2. the exact record-only ledger proof is still present and checksum-bound;
3. Production runtime parity still resolves to the exact Production SHA;
4. semantic metadata remains complete.

Only then does the existing Migration 1051 apply runner execute. That creates a truthful `mode=apply` ledger row by actually executing the reviewed idempotent metadata migration. The existing same-cycle dry-run, capability-envelope, durable authorization, checksum, statement-count, and post-apply readback requirements remain in force.

## Safety boundary

Neither source merge nor record-only reconciliation authorizes:

- `APPLY_GITHUB_MAIN_REVIEW_POLICY`;
- a GitHub Ruleset/provider mutation;
- Production deployment or branch promotion;
- force push or protected-ref content mutation;
- credential payload reads;
- freeform SQL;
- reuse of a stale typed authorization.

The current Governance DB writer dependency tracked by #6813 remains a prerequisite. This source repair does not broaden DB grants or bypass that dependency.

## Read-only Verify credential scope on GitHub Actions (9 Oct 2026)

Live user readback confirmed that `BACKEND_API_KEY` exists as both a repository-level secret and an environment-level secret under GitHub Environment `Production`. The canonical policy activation workflow is bound to `environment: Production` with `deployment: false` and reached the Migration 1051 ledger check (HTTP 409); the independent Migration 1051 Verify job lacked an environment binding and its Migration 225 dependency probe was rejected with `invalid_backend_api_key` (HTTP 403). This strongly indicates a scope-dependent API credential mismatch; the encrypted secret values were not read and **equality or expiry is not proven**.

The bounded source-only fix adds the existing `Production` environment to **only** the `verify` job in `.github/workflows/github-repository-policy-1051-governed-rollout.yml`, using `deployment: false`. The `verify` job invokes the metadata diagnostic in `METADATA_DIAGNOSTIC_MODE: verify` and the existing ledger/metadata verifier in `ROLLOUT_PHASE: verify`. All other jobs, including authorization/dry-run, record-only ledger writes and Apply, retain their prior credential scopes and explicit confirmations; this fix grants them nothing. The environment binding is for read-only verification against the Production Runtime; it **does not** promote or deploy Production code.

Acceptance must be obtained by a normal reviewed PR merged into the default branch, since the `issue_comment` trigger checks out the default-branch workflow. After merge, the operator may request the canonical read-only verify marker on issue #6625. Even if HTTP 403 disappears, the readback may legitimately continue to fail on Migration 225 exact ledger or Governance DB readiness (previously 0/17 required tables). Do not infer database health from authentication health.

Never paste or copy a credential, echo or hash an API key into logs, mirror Production secrets into repository scope, add `environment: Production` to mutating jobs, disable environment approval policies, fabricate an Apply ledger, or bypass protected-main policy gates to speed up this verification. GitHub Ruleset and Migration 1051 Apply remain separately governed.
