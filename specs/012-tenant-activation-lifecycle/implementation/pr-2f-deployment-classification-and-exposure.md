# Implementation PR-2F: Deployment Classification and Exposure Projection

## Status

Implementation slice for Spec 012 task T024A. This slice classifies request-time deployment observations and projects bounded evidence by immutable principal ceiling. It does not wire public routes or implement the dynamic T024B policy registry.

## Scope

- Derive stable opaque `runtime_version` and `expected_version` identifiers from authoritative release evidence without exposing full commit SHAs.
- Classify deployment observations into `current`, `deploying`, `stale`, `diverged`, or `unknown`.
- Require bounded `freshness_window_ms`; no production threshold is invented or activated by this slice.
- Require explicit governed evidence for deployment-in-progress, authorized-lineage match, environment match, and release sequence when those facts are needed.
- Reject classification-context evidence observed after the correlated request time.
- Never infer release ordering from Git SHAs, opaque release IDs, route names, branch names, environment variables, or caller text.
- Project `none`, `opaque`, `diagnostic`, and `admin_full` response shapes.
- Enforce immutable principal ceilings: Public/Tenant maximum `diagnostic`; Admin/service maximum `admin_full`.
- Optionally project `Deployment-Revision` from the exact same opaque runtime version used in the response body.
- Keep `reconnect_required=false` for every deployment state.

## Classification contract

- `current`: expected and deployed authoritative release identity match, observation is fresh, contract evidence passes, and runtime health evidence passes.
- `deploying`: authoritative deployment-progress evidence is true and reviewed/deployed release identity has not converged.
- `stale`: authoritative release-sequence evidence proves the deployed runtime is older than the expected reviewed release.
- `diverged`: authoritative lineage or environment evidence fails, or authoritative sequence evidence proves an unexpected newer/conflicting runtime state.
- `unknown`: observation missing or outside freshness, contract evidence invalid, matching runtime health not passing, or required ordering evidence unavailable.

Classification is historical and operates on the T024 observation correlated to the original request time.

## Exposure contract

### `none`

No deployment block and no `Deployment-Revision` header.

### `opaque`

Only normalized deployment state and opaque runtime version. No observation time, expected version, SHA, source reference, repository, branch, path, or infrastructure detail.

### `diagnostic`

Opaque runtime/expected versions, normalized state, observation freshness, completeness, stable reason, user next action, and `reconnect_required=false`. Full SHAs and source references remain excluded.

### `admin_full`

Authorized Admin/service principals may receive bounded expected/deployed release evidence, health, contract, migration, source references, and classification evidence. Tenant/Public principals are rejected with `403` if they request `admin_full`.

## Deliberate exclusions

- Dynamic `deployment_evidence_exposure_policy`, questionnaire compilation, exact-version registry readback, policy cache invalidation, and endpoint applicability — T024B.
- Public route/header wiring and OpenAPI changes.
- SQL persistence and migration apply/readback — T026.
- Provider calls, deployment, restart, production verification, protected-user smoke, rollback, credentials, or external writes.

## Safety invariants

- Opaque release IDs are diagnostics only and never authorization, idempotency, ordering, or resource authority.
- Git SHAs are never compared lexically or numerically for release ordering.
- A mismatch without governed progress/lineage/environment/sequence evidence becomes `unknown`.
- Deployment mismatch never produces OAuth reconnect guidance.
- Header and body release IDs share one projection source.
- Tenant/Public projections contain no full SHA or internal source references.
- No principal or registry configuration can raise Tenant/Public above `diagnostic`.
- `secrets_included` is always false.

## Verification

Regression: `http-generic-api/test-activation-deployment-projection-service.mjs`

Registered through: `http-generic-api/test-runtime-verification-contract.mjs`

The regression proves all five classifications, opaque-ID stability, environment separation, stale/newer release ordering through governed sequence evidence, future classification-evidence rejection, all four exposure shapes, Tenant/Public denial of `admin_full`, header/body consistency, no SHA/source-reference leakage to Tenant diagnostic projection, no reconnect guidance, no T024B policy implementation, and no runtime route wiring.

## Mutation boundary

This PR authorizes code and deterministic tests only. It does not authorize policy activation, migration application, database writes, public runtime wiring, provider access, deployment, restart, credential reads, secret inclusion, or external sends.
