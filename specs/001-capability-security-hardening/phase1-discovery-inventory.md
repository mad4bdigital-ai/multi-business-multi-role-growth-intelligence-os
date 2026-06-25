# Phase 1 Capability Security Discovery

**Baseline:** `main@8c7bd63eae1100c2da886bf5df3c78e5fb12c7da`  
**Date:** 2026-06-25  
**Posture:** repository inspection only; no provider execution, database mutation, deployment, or production promotion.

## T010 runtime map

| Area | Live repository surfaces |
|---|---|
| Admin and tenant ingress | `http-generic-api/routes/platformPluginRoutes.js`, `http-generic-api/routes/tenantPlatformPluginRoutes.js`, `http-generic-api/routes/gptToolsRoutes.js`, `http-generic-api/routes/connectorRoutes.js` |
| Capability resolution | `http-generic-api/platformPluginResolver.js`, `http-generic-api/platformPluginCatalog.js`, `http-generic-api/platformPluginPolicy.js`, `http-generic-api/platformPluginActionGrant.js` |
| Provider dispatch | `http-generic-api/platformPluginRestDispatch.js`, `http-generic-api/connectorExecutor.js`, `http-generic-api/appAdapters/index.js` |
| Policy preflight | `http-generic-api/governedExecutionPreflight.js`, `http-generic-api/runtimePolicyResolver.js`, `http-generic-api/runtimePolicyLoader.js` |
| Credentials | `http-generic-api/credentialIntakeBindingPolicy.js`, `http-generic-api/routes/credentialIntakeRoutes.js`, `http-generic-api/tokenEncryption.js`, `http-generic-api/platformPluginTargetAuthority.js` |
| Approval envelopes | `http-generic-api/capabilityResolutionEnvelopeGuard.js`, `http-generic-api/scripts/capability-resolution-envelope-create.mjs`, `http-generic-api/scripts/capability-resolution-envelope-approve.mjs` |
| Device and local execution | `http-generic-api/routes/connectorProxyRoutes.js`, `http-generic-api/routes/localGatewayToolsRoutes.js`, `http-generic-api/connectorExecutor.js` |
| Audit | `http-generic-api/auditLogger.js`, `http-generic-api/executionEvidenceLogger.js`, `http-generic-api/platformPluginSecurityAlerts.js` |
| Root TypeScript resolver | `src/services/execution/dispatchPlanStep.ts`, `src/services/connectors/execution/resolveConnectorExecutor.ts`, `src/store/registries/connectorExecutorRegistry.ts` |

The repository has two execution-resolution surfaces: the root TypeScript resolver and the `http-generic-api` JavaScript runtime. Phase 1 parity work must cover both.

## T018 build and governance mechanisms

- Migrations: `http-generic-api/migrations/` through `http-generic-api/scripts/governed-migration-runner.mjs`.
- HTTP tests: `cd http-generic-api && npm test` through `scripts/run-test-manifest.mjs`.
- Resolver tests: root `npm run ci:execution-resolvers`.
- Canonicals: edit `canonicals/`, run `node build-canonicals.mjs`, and verify with `--check`.
- Canonical structure: `node validate-canonical-sources.mjs`.
- OpenAPI 3.1: `http-generic-api/openapi.yaml`, `openapi.tenant-gpt.auth.yaml`, and `openapi.custom-gpt.auth-dispatcher.yaml`.
- CI: `.github/workflows/ci.yml` requires Syntax, Unit & Integration, Execution Resolver, and Architecture Drift jobs.
- Spec Kit: `http-generic-api/scripts/spec-kit-completion-gate.mjs` enforces truthful `completion.json`.

## Finding D-001: envelope bootstrap policy declaration

Phase 0 fail-closed mutation handling exposed a bootstrap metadata gap: `capability_resolution_dry_run`, `capability_resolution_envelope_create`, and `capability_resolution_envelope_approve` did not carry the explicit descriptor tags expected by `evaluateGptToolDispatchPreflight`.

Repository remediation is now present in:

- `http-generic-api/migrations/315_sprint69_capability_envelope_bootstrap_policy_declaration.sql`
- `http-generic-api/test-explicit-mutation-policy-fail-closed.mjs`

The migration classifies the passive dry-run as `preview_only/no_mutation/no_execution`; classifies envelope creation and approval as authority-record mutations using `mutation/capability_envelope/readback`; adds `approval_required` to the approval tool; and explicitly forbids target execution, provider calls, and secret return.

Validation evidence:

- Commit `867994c21d3b0f391fbc55a0202d3d31021f726b`
- Syntax Check: pass
- Unit & Integration Tests: pass
- Execution Resolver Gate: pass
- Architecture Drift Detection: pass

The migration is committed but has **not** been applied to production. Application requires the governed migration authorization/preflight/readback chain after review and merge. No direct SQL or policy bypass is authorized.

## Remaining Phase 1 work

T011–T017 and T019 remain open: full alias inventory, dual-surface parity, tenant-visible admin exposure, mutation-policy completeness, credential provenance, device model, latency/volume baselines, and plan reconciliation.

T010 and T018 have repository evidence and green CI. Their task checkboxes should be updated only in the final reviewed branch state.
