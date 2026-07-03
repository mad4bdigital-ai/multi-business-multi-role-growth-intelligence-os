# Phase 12 Verification And Release Readiness

**Scope:** T103-T114 for capability security hardening.

This record is a release gate, not an implementation shortcut. It does not authorize provider execution, credential access, external writes, production mutation, branch merge, or production promotion. The implementation PRs remain unmerged until the complete plan has passed CI and the governed release evidence below is complete.

## Required Evidence

| Task | Gate | Required evidence | Current status |
|---|---|---|---|
| T103 | Full unit, integration, and security suites | Current-head CI plus local focused suites for selector contracts, decision engine, local shell/files, mutation policy, status observability, OpenAPI generation, and schema guards | Prepared; awaiting full CI evidence |
| T104 | Staging preview acceptance matrix | Acceptance matrix A01-J08 executed in staging preview mode with `will_execute=false` for preview-only requests | Blocked until staging preview run |
| T105 | Shadow evaluation mismatch review | Shadow decision ledger comparing legacy and new decisions, every mismatch triaged by owner, zero unreviewed P0/P1 mismatch before enforcement | Blocked until shadow run |
| T106 | Latency and resource budgets | p50, p95, and p99 resolver comparisons against the Phase 1 baseline; memory and query-count deltas inside approved budget | Blocked until benchmark run |
| T107 | Dependency-outage fail-closed proof | Database, credential store, device heartbeat, approval store, Cloudflare, n8n, and local connector dependency outage scenarios prove deny/no-dispatch behavior | Blocked until outage drill |
| T108 | Bounded staging mutations | Explicitly approved staging-only Cloudflare and n8n mutation probes with preflight, same-cycle readback, cleanup, rollback metadata, and no production targets | Blocked until staging approval |
| T109 | Security and architecture reviews | Security reviewer and architecture owner sign off on route/domain/infrastructure boundaries, trace projection, mutation approval reuse, and no-secret evidence | Blocked until reviews |
| T110 | Feature-flag rollback | Rollback exercise proves enforcement can be disabled without re-enabling P0 tenant-to-admin exposure, raw intake exposure, or unapproved mutations | Blocked until rollback drill |
| T111 | Release-readiness checklist | `checklists/release-readiness.md` completed with this Phase 12 record, CI links, staging evidence, review signoffs, and residual-risk decision | Blocked |
| T112 | Production promotion approval | Explicit governed production promotion approval naming approver, scope, commit SHAs, rollback owner, and expiry | Not granted |
| T113 | Rollout by enforcement group | Enforcement groups activated incrementally with monitoring of denials, invariant alerts, latency, and shadow mismatch rate | Not started |
| T114 | Legacy branch retirement | Legacy branches and policy paths retired only after stability window and parity criteria pass | Not started |

## Local Verification Command Set

The local command set below is the minimum pre-CI evidence for this Phase 12 branch. Passing it does not replace GitHub CI, staging preview, or governed production approval.

```text
node test-platform-plugin-strict-request-contract.mjs
node test-security-decision-engine.mjs
node test-platform-plugin-resolver.mjs
node test-tenant-platform-plugin-routes.mjs
node test-local-project-path-repair-security.mjs
node test-n8n-instance-mode-ownership-policy.mjs
node test-cloudflare-mutation-policy-contract.mjs
node test-phase10-status-observability-readiness-audit.mjs
node test-platform-plugin-contract-docs.mjs
node test-phase12-verification-release-readiness.mjs
npm run schemas:check
npm run schemas:guard
git diff --check
```

## Local Pre-CI Evidence

Recorded on 2026-07-03 from the Phase 12 worktree using the repository-local Node/npm toolchain because the managed Windows sandbox could not initialize reliably in this session. This evidence is local-only and does not satisfy CI, staging, production approval, rollout, or legacy retirement gates.

Passed locally:

```text
node test-phase12-verification-release-readiness.mjs
node test-release-readiness-tool-dispatch-integrity.mjs
node test-release-readiness-migration-drift.mjs
node test-spec-kit-phase0-containment-evidence.mjs
node test-security-decision-engine.mjs
node test-platform-plugin-strict-request-contract.mjs
node test-platform-plugin-resolver.mjs
node test-tenant-platform-plugin-routes.mjs
node test-phase10-status-observability-readiness-audit.mjs
node test-explicit-mutation-policy-fail-closed.mjs
node test-security-decision-trace-contract.mjs
node test-platform-plugin-contract-docs.mjs
npm run schemas:check
npm run schemas:guard
git diff --check
```

Local warnings and gaps:

- `test-platform-plugin-strict-request-contract.mjs`, `schemas:guard`, and route tests printed expected local environment warnings for disabled queue or missing DB environment variables.
- `schemas:check` and `schemas:guard` passed with the existing `tenant_core: 28 operations exceeds warning limit 26` warning.
- The Phase 12 branch does not yet contain the newer Phase 8/9 focused tests named `test-local-project-path-repair-security.mjs`, `test-n8n-instance-mode-ownership-policy.mjs`, or `test-cloudflare-mutation-policy-contract.mjs`; keep T103 awaiting full CI evidence until the phase branches are reconciled and CI runs the complete suite.

## Local Phase Branch Inventory

Recorded on 2026-07-03 as a local branch rollup only. These commits prove local phase-branch closeout evidence, but they are not a substitute for branch reconciliation, integration CI, staging evidence, or governed release approval.

| Phase | Tasks | Branch | Local commit | Local status | Release status |
|---|---|---|---|---|---|
| Phase 3/4 | T027-T045 | `work/phase4-security-decision-engine-20260701` | `9264bfc0` | Implemented and locally tested | Not reconciled into integration/CI |
| Phase 8 | T073-T080 | `work/phase8-local-consent-shell-files-20260701` | `8b1f8085` | Implemented and locally tested | Not reconciled into integration/CI |
| Phase 9 | T081,T085-T089 | `work/phase9-mutation-integrations-20260702` | `07ea3279` | Implemented and locally tested | Not reconciled into integration/CI |
| Phase 10 | T090-T096 | `work/phase10-status-observability-20260702` | `28760484` | Implemented and locally tested | Not reconciled into integration/CI |
| Phase 11 | T097-T102 | `work/phase11-contract-docs-migration-20260702` | `4cb45f8b` | Implemented and locally tested | Not reconciled into integration/CI |
| Phase 12 | T103-T114 | `work/phase12-verification-release-20260702` | `4abfc702` | Local pre-CI evidence recorded | External release gates remain blocked |

Local branch rollup: T001-T102 are complete across the phase worktrees; T103-T114 remain release-gated. Do not merge phase branches or promote production until the branches are reconciled, full CI passes, staging/approval gates complete, and the Phase 12 blockers above are closed.

## Release Blocking Rules

- Do not merge any phase branch until all phase PRs required by the plan are reviewable, CI green, and reconciled with the intended base.
- Do not mark T104, T105, T106, T107, T108, T110, T112, T113, or T114 complete from repository-only evidence.
- Do not use Phase 12 to create new approval infrastructure. Reuse the existing T082-T084 approval binding, replay protection, preflight, and readback mechanisms.
- Do not expose admin-only decision trace detail to tenant surfaces.
- Do not downgrade P0 containment during rollback.
- Do not include secrets in logs, audit evidence, traces, docs, test fixtures, or release artifacts.

## Acceptance Matrix Execution Record

| Matrix group | Coverage | Required runtime evidence |
|---|---|---|
| A selector and parity | A01-A08 | API integration evidence, OpenAPI 3.1 parity, stable selector errors |
| B principal and surface | B01-B07 | Tenant/admin isolation traces and no credential lookup before authorization |
| C gate completeness | C01-C07 | Decision traces proving fail-closed `dispatch_ready` invariants |
| D credentials | D01-D09 | No-secret credential resolution and usability outcomes |
| E secure intake | E01-E09 | Bounded intake sessions, replay denial, redirect allowlist evidence |
| F device trust | F01-F11 | Device ownership, heartbeat, connector identity, and supported-capability evidence |
| G local shell/files | G01-G08 | Registered command capability, typed args, canonical path, bounds, and redaction evidence |
| H approval and mutation | H01-H09 | Approval binding, replay denial, preflight, readback, and stable failure evidence |
| I integration-specific | I01-I07 | Cloudflare and n8n ownership, read/run/activate separation, rollback metadata |
| J status and audit | J01-J08 | Freshness-aware readiness, structured traces, public/admin projection, tamper-evident audit |
