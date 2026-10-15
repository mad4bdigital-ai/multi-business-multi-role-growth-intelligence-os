# Staging → Production: two-gate operational acceptance

**Source baseline:** `main@6b439a2810eadfba53c224a274ca12ced20c14b4` (2026-10-15); **Production baseline:** `e0c07f6fba431650b87d7a6f3dde76a364be6223`. Re-pin both on each attempt. Current git ancestry: Production is ancestor of main; main is **1,506 commits ahead** at this baseline. This is a **read-only runbook**, not an execution receipt, deploy grant, or database migration authority.

## One practical condition before proceeding

The active, authorized Windows Docker Staging runtime must be reachable through a verified remote computer/agent. ChatGPT's currently connected Desktop Commander reports its only listed device `DESKTOP-91FDEFP` **offline** (last seen 524 hours ago). Do not assume this historical device is the current host. Discover and prove the **current** Staging host, Docker context, identity, and DB before running the gate. The legacy `dev.mad4b.com` verification workflow explicitly says the public host is retired; success in GitHub CI does **not** certify the live Staging server.

## Gate A — actual Staging acceptance (mandatory; no Production action)

1. **Identity / no cross-environment writes:** verify active Windows host and Docker context; application, `runtime-db`, separate governance/control-plane DB, Redis and selected tunnel; exact commit, image digest, Git tree/context SHA; ensure Staging DB names and writer role cannot target Production.
2. **Startup and dependencies:** inspect current container identities and bind mounts; confirm quiescent background-startup mode; verify `/health`, local `/deployment-info`, logs, resource budgets, writer-grants preflight and baseline/rollback snapshot. No rebuild/restart or database write merely to diagnose.
3. **Use existing canonical host certification:** from the *verified* repository root in Windows PowerShell, execute `autopilot-portable-staging/Invoke-StagingCertification.ps1` with `-RepositoryPath`, exact `-ExpectedCommit`, `-Ref main`, the **observed** `-TunnelMode` and a writable `-StatePath` under Staging logs.
4. **Explicitly reject degraded as release-ready:** this canonical script deliberately passes `STAGING_CERT_REQUIRE_READY=false` and can return exit code 0 on `degraded`. Therefore an exit code of 0 is **not enough**. The saved state MUST assert `certification_status = ready`, `certification_ready = true`, `certified_commit = expected SHA`, `certified_branch = main`, and empty `certification_blocking_failures` and `certification_degraded_reasons`; otherwise Gate A FAILS.
5. **Functional E2E + MariaDB:** separately test real authenticated admin and tenant user journeys, OAuth PKCE/SSO, MCP tool listing/execution in allowed scope, access denial across tenants, workflows/queue, CRM/requests, exact DB migrations and ledger/readbacks (schema, data, indexes, triggers, dedicated writer grants). Audit the five SQL source risks listed in `docs/governance/surface-contract-five-sql-static-risk-review-20261015.md`, especially recipe activation and enabled-tool upsert. The source code and CI are not proof that the required tables/roles exist in the **live** DB.
6. **Staging database correction:** if live drift is verified, create a bounded, checksum-pinned migration plan, backup and restore proof, and preflight; independently authorize **Staging-only** execution and verify same-cycle before/after SQL evidence. Never reuse that authorization or DB credential in Production.
7. **Close Gate A only with a single no-secret report:** `staging_host_verified`, `exact_main_sha`, `runtime_artifact_verified`, `readiness_ready`, `e2e_passed`, `database_schema_ready`, `governance_writer_ready`, `rollback_verified`, `cross_environment_writes_false`, `unresolved_blockers=[]`. Any missing or degraded item means BLOCKED.

## Gate B — governed Production release (only after Gate A passes)

1. Pin immutable main release cut and current Production SHA, re-verify ancestry and recent CI. Respect the existing `Governed Production Promotion Request Launcher` (exact request PR with title `ops: request governed Production synchronization`, typed authorization, SHA and validation-base binding) and `Certified Production Release Cut Validation`. This process creates a candidate; it **does not directly merge or deploy Production**.
2. Resolve live GitHub Ruleset gaps/producer identity **without silent bypass**: main policy readback is incomplete and `Production` is currently `protected=false`. First approve and verify precise Production protection, trusted `Governed Production Promotion` check issuer, and release branch rules. No direct protected-branch push or force push.
3. Independently authorize promotion of the **exact certified candidate**; merge only when same-cycle verification, policy, staging certificate, source/Production identity and rollback are all valid.
4. **A Git branch promotion does not fix a DB.** Hostinger Production deploy and each governed Production SQL migration/grant operation need separate scoped approvals, preflight/backup, dedicated writer role, apply receipt and post-apply readbacks. Avoid global/replayed SQL, environment replacement, or implicit restarts.
5. Verify the new public runtime SHA and Production branch with GET-only R7 and OAuth/MCP/user-journey canaries. On failure stop and use the separately rehearsed rollback.

## Operator result for this baseline

- `Gate A = NOT PROVEN` (no current live Staging host connection or complete DB/E2E readbacks).
- `Gate B = BLOCKED` (Gate A not accepted, missing Production branch protection, trusted check producer and production DB readiness).
- `Production change = NONE`; this document grants none.
- **One next operational action:** reconnect a *current verified* Windows Staging device to the authorized remote agent. Resume Gate A directly; no need to create another staging deploy framework.
