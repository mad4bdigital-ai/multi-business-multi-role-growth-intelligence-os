# ADMIN Release Intelligence Spec

## Objective

ADMIN workflows provide platform-wide release orchestration, runtime parity recovery, deploy gate management, and self-healing recommendations for all authorized platform and tenant targets.

ADMIN mode may inspect cross-tenant operational state only through governed registry views, scoped capability envelopes, audit trails, and sanitized evidence. ADMIN mode must never return credentials or raw secret payloads.

## ADMIN responsibilities

- Detect production parity drift.
- Create or reuse a `release_operation`.
- Resolve runtime target ownership and capability template.
- Run dry-run preflight.
- Request or approve capability envelopes where policy allows.
- Open temporary gates with TTL and operation binding.
- Dispatch deploy/restart as async operation.
- Poll or run readback until verified, degraded, or rollback required.
- Close temporary gates and verify cleanup.
- Archive evidence and update operational attention state.

## ADMIN operation flow

```text
main moved or parity mismatch detected
  -> release advisor classifies drift
  -> release_operation created
  -> capability template resolved
  -> target authority checked
  -> dry-run deploy plan produced
  -> approval/envelope resolved
  -> gate opened with TTL if needed
  -> deploy accepted as async operation
  -> readback verifies commit/routes/health
  -> gate closed
  -> release_operation closed with evidence
```

## ADMIN action classes

### Read-only

- Inspect release readiness.
- Inspect runtime parity.
- Inspect operation ledger.
- Inspect sanitized evidence manifest.
- Inspect target capability readiness.

### State-changing internal registry

- Create release operation.
- Create gate event.
- Create capability envelope request.
- Record verification run.
- Close operation.

### Provider or remote runtime affecting

- Deploy release.
- Restart app.
- Rollback release.
- Open runtime executor gate.
- Close runtime executor gate.

These require capability envelope, approval when policy requires, readback, and audit.

## ADMIN safety requirements

- No direct provider call from advisor mode.
- No deploy without `ready_for_dispatch` envelope.
- No stale envelope reuse when tenant, workspace, target, or expected commit differ.
- No fixed parity IDs embedded in reusable gate logic.
- No final success without same-cycle readback.
- No recovered classification without same-cycle validation.

## ADMIN evidence model

Every operation should store:

- expected commit SHA
- deployed commit SHA
- runtime target id
- branch
- capability envelope id
- approval hold id
- dry-run evidence ref
- dispatch attempt ref
- verification run id
- gate open/close events
- final classification
- no-secret assertion

## ADMIN acceptance criteria

- Release readiness remains summary-first and bounded.
- Runtime parity is verified after deploy.
- Gate cleanup is verified after deploy.
- Operation ledger has no orphaned open gates.
- All evidence references are available through governed read-only APIs.
