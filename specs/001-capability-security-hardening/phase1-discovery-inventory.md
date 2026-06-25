# Phase 1 Capability Security Discovery

**Baseline:** `main@89c54872c18432b0b0f41c8963ed731f8f12751f`
**Date:** 2026-06-25
**Posture:** repository inspection only; no provider execution, database mutation, deployment, or production promotion.

## Required canonical authority sources

- `AI_Agent_Knowledge_Guide.md`
- `system_bootstrap.md`
- `memory_schema.json`
- `direct_instructions_registry_patch.md`
- `module_loader.md`
- `prompt_router.md`

These generated/runtime references are authority inputs. Generated files are read for validation; canonical edits remain under `canonicals/` and require `node build-canonicals.mjs` plus `--check` verification.

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
- HTTP tests: `cd http-generic-api && npm test` through `http-generic-api/scripts/run-test-manifest.mjs`.
- Resolver tests: root `npm run ci:execution-resolvers`.
- Canonicals: edit `canonicals/`, run `node build-canonicals.mjs`, and verify with `--check`.
- Canonical structure: `node validate-canonical-sources.mjs`.
- OpenAPI 3.1: `http-generic-api/openapi.yaml`, `openapi.tenant-gpt.auth.yaml`, and `openapi.custom-gpt.auth-dispatcher.yaml`.
- CI: `.github/workflows/ci.yml` requires Syntax, Unit & Integration, Execution Resolver, and Architecture Drift jobs.
- Spec Kit: `http-generic-api/scripts/spec-kit-completion-gate.mjs` enforces truthful `completion.json`.

## Finding D-001: passive dry-run descriptor policy

Phase 0 fail-closed mutation handling exposed descriptor gaps. Current `main` now governs envelope create/approve and `repo_patch*` through `20260625_repository_mutation_descriptor_policy_recovery.sql` and its virtual descriptor changes. The remaining gap is `capability_resolution_dry_run`: it is a passive POST diagnostic but lacks the explicit `preview_only/no_mutation/no_execution` descriptor used by `evaluateGptToolDispatchPreflight`.

Repository remediation for that remaining gap is present in:

- `http-generic-api/migrations/315_sprint69_capability_envelope_bootstrap_policy_declaration.sql`
- `http-generic-api/test-explicit-mutation-policy-fail-closed.mjs`

The migration updates only `capability_resolution_dry_run`, records a no-secret/no-provider policy row, and leaves create/approve plus repository mutations under the newer main authority. It does not execute target capabilities or relax fail-closed behavior.

Validation evidence from the earlier branch commit remains historical; current-head CI must be rerun after reconciliation with `main`.

The migration is committed but has **not** been applied to production. Application requires the governed migration authorization/preflight/readback chain after review and merge. No direct SQL or policy bypass is authorized.

## Phase 1 discovery report

The read-only report implementation is split by responsibility:

- `http-generic-api/phase1CapabilityDiscoverySources.js`
- `http-generic-api/phase1CapabilityDiscoveryAnalysis.js`
- `http-generic-api/phase1CapabilityDiscoveryReport.js`
- `http-generic-api/scripts/phase1-capability-discovery-report.mjs`

It inventories MySQL-primary descriptors for T011-T014, reuses the production mutation classifier, performs no runtime dispatch or provider call, reads no credential payload, and emits no secrets.

## Remaining Phase 1 work

T011-T017 and T019 remain open until the live report and the remaining provenance, device, performance, and plan-reconciliation evidence are complete.

T010 and T018 have repository evidence. Their task checkboxes should be updated only after current-head CI and review succeed.
