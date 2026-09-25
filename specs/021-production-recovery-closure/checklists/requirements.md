# Requirements checklist

- [x] Closure is exact-SHA bound.
- [x] Caller may supply only expected_sha.
- [x] Recovery truth requires a server-injected evidence resolver.
- [x] Durable same-cycle inspection evidence is mandatory.
- [x] Verified all-role backup evidence is mandatory.
- [x] Governance and runtime-persistence baseline readiness are core gates.
- [x] Canonical grants and bootstrap ledger readiness are core gates.
- [x] MCP catalog schema plus Admin/Device functional readback are core gates.
- [x] Governed response-chunk durable smoke is a core gate.
- [x] Production activation readiness is a core gate.
- [x] Unknown outcome forces reconciliation and forbids automatic retry.
- [x] Connector auth and 429 attribution remain non-DB degradation.
- [x] Closure evaluation performs no database/provider/Production mutation.
- [~] Live Production recovery execution — N/A for this repository-only PR; requires separate exact-SHA deployment and approval.
- [~] Production migration/grant apply — N/A for this repository-only PR; remains separately governed.


## Convergence requirements

- [x] Single convergence entrypoint is `platform_recovery_converge_v1`.
- [x] Run/plan/step/idempotency identities are durable and exact-SHA bound.
- [x] Status and reconciliation require an existing run.
- [x] One advance crosses at most one mutation boundary.
- [x] Governance/runtime-persistence baseline rebuild is zero-object conditional.
- [x] Runtime role is never rebuilt by this convergence plan.
- [x] Grants precede the fixed MCP catalog migration.
- [x] Catalog verification precedes Admin/Device functional readback.
- [x] Response-chunk acceptance requires a real durable write/read smoke.
- [x] Connector credential-invalid and 429 paths are distinct.
- [x] Connector rebind keeps the old credential until the new authenticated probe succeeds.
- [x] Local Manager polling backoff survives restart and is secret-free.
- [x] Local Manager E2E requires create, claim and complete.
- [x] Final active state requires exact deployment parity.
