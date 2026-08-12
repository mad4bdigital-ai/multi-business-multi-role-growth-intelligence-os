# Expanded External Execution Runbook

## Purpose

This runbook expands the implementation scope to include the Issues that require GitHub administration, Production readback, Cloudflare, OAuth, migrations, or an external trigger. It does not silently authorize those actions. Each action remains gated by an exact preflight, typed confirmation, immutable identity, bounded mutation, and same-cycle readback.

## Execution lanes

| Lane | Issues | Repository work | External requirement | Completion evidence |
|---|---|---|---|---|
| Repository reconciliation apply | #6913 | Finalize lease-bound tool schema, plan binding, negative tests, dry-run executor, and synthetic disposable-branch smoke | Admin apply authority and explicit recipe activation | Exact plan/operation/lease/envelope identity, provider receipt, tree/ref/ancestry readback, protected-branch untouched |
| Tenant runtime migration | #6871 | Validate migration checksum, statement count, readiness contract, rollback/readback scripts, and evidence schema | Production dry-run and authorized migration execution | Exact migration SHA, environment identity, preflight, apply result, schema readback, rollback evidence |
| Governance DB writer authority | #6813 | Preserve fail-closed writer checks, contract parity, privilege diagnostics, and regression tests | Production DB writer privilege and environment authority | Writer identity, privilege readback, migration readiness, no-secret evidence |
| GitHub repository policy activation | #6625, #6612, #6391 | Validate policy schema, required checks, single-owner/independent-review modes, and exact policy readback | Ruleset/branch protection mutation, collaborator permission, finalizer App ID | Active policy readback, zero unintended bypass actors, eligible reviewer proof, exact required checks |
| Migration 1050 rollout | #6628 | Validate immutable migration blob/checksum/statement count and rollout producer contract | Production promotion and governed apply | Migration ledger, environment, checksum, statement count, post-apply readback |
| Finalization TOCTOU | #5872 | Local repair and tests are implemented in this branch | Independent eligible reviewer and protected-main policy | Exact-head eligible approval, final policy readback, merge and ancestry evidence |
| Retail Commerce schema evidence | #5459 | Keep collector, select-only guards, trigger contract, and evidence parser tested | Canonical Production trigger and runtime readback | Two-source parity, migration ledger, table/column/index evidence, no row data or mutation |
| Main-write incident controls | #5021, #6046 | Preserve branch-only workflows, protected-ref assertions, and incident regression tests | Repository policy enforcement and workflow authorization | No direct-main write path, branch/ref audit, workflow permission readback |
| Cloudflare recovery | #4957 | Validate connector configuration, typed upstream error handling, and break-glass runbook | Cloudflare Tunnel/connector access and provider-side repair | HTTP/Tunnel health, route identity, provider response, recovery readback |
| Tenant self-repair and operations | #4451, #4450, #4448, #4447, #4446, #4445 | Implement and test catalog, auth, authority, dry-run repair, observability, SLA, reporting, and ownership boundaries | Tenant credentials/OAuth, provider operations, approval/readback for mutations | Tenant-scoped evidence, no secret disclosure, dry-run/apply separation, operation SLA/readback |
| Release and rollout convergence | #4216, #4122, #3809 | Validate migration contracts, release gates, readiness scripts, and staging preflight | Runner allocation, staging/Production authorization, external provider state | Exact-head CI, migration readiness, staging readback, rollback/disable evidence |

## Mandatory preflight envelope

Before any external mutation, the operator must record the repository SHA, target environment, target resource, action key, plan ID and hash, operation ID, lease ID and fingerprint where applicable, expected base/head or migration checksum, capability envelope ID, approval hold, and expiry. The preflight must explicitly state `force_push_allowed=false`, `migration_apply_allowed=false` unless separately authorized, `secrets_included=false`, and the exact rollback/readback path.

## Issue-specific operator sequences

### #6913 — Repository reconciliation apply

First validate the detached resolution candidate against a fresh current-main read, then create a dry-run plan. The plan must bind every consequential installed-tool step, including repository, PR, branch, base, head, resolution commit, and no-force policy. Only the canonical capability-envelope and approval-hold validators may authorize an apply. Lease acquire/release and evidence/classify steps remain engine-managed and must not be dispatched as provider tools. Use a disposable non-protected branch for the positive smoke; never use `main` or `Production` for the smoke.

### #6871 and #6813 — Migration and writer readiness

Run syntax, checksum, statement-count, dependency, privilege, and rollback preflight first. Production execution must use the declared governed migration path rather than shell SQL. A successful migration apply is insufficient without schema/ledger readback from the same environment and a proof that no unexpected writer or credential was used.

### #6625, #6612, and #6391 — GitHub policy

The local policy contract must be validated against the exact required checks and reviewer mode. External setup must create or update active protection for `main`, require pull requests and eligible review, block direct writes, and exclude unauthorized bypass actors. Read back the policy through the canonical controller. Do not claim completion from a successful local policy JSON validation.

### #5459 — Retail Commerce production evidence

Use the existing select-only collector and its test harness. The production trigger must be one-file, immutable, and explicitly readback-only. The evidence must contain migration ledger, table, column, and index parity while excluding row data, secrets, and mutation results. The trigger is not a migration apply.

### #4957 — Cloudflare recovery

Verify the configured connector and tunnel identity before changing routing. Capture the current HTTP 530 response, perform the smallest authorized provider-side repair, and immediately re-read the tunnel, route, origin health, and public endpoint. Do not rotate or expose credentials in repository evidence.

### #4451, #4450, #4448, #4447, #4446, and #4445 — Tenant operations

Keep tenant authentication User-JWT based and derive tenant and user identity from auth, never request bodies. All repairs must begin as dry-run plans with typed blockers, effect classification, idempotency identity, approval requirements, rollback, and final eligibility readback. Observability, audit, SLA, and report surfaces must be tenant-safe and must not expose credentials, cross-tenant existence, or internal admin capability details.

## Stop conditions

Stop immediately if the target SHA, migration checksum, branch, environment, lease, approval hold, policy readback, provider identity, or capability envelope differs from the preflight. Also stop on unknown provider outcome, missing readback, permission ambiguity, stale evidence, unexpected file scope, or any request to bypass the declared approval or protected-branch policy.

## Closeout evidence

An Issue may be marked complete only when local tests, CI, external action evidence, runtime/Production readback, rollback or disable evidence, and the Issue-specific acceptance criteria are all present. A prepared trigger, green local test, or merged documentation PR alone does not constitute completion.
