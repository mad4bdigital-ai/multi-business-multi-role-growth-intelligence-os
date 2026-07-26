# Phase 1 Repository and Registry Discovery Evidence

**Feature:** `001-capability-security-hardening`  
**Pull request:** `#1913`  
**Branch:** `gpt/001-capability-security-hardening-phase1-discovery`  
**Observed:** 2026-06-26  
**Scope:** T010–T019 discovery and evidence only

## Safety boundary

The discovery cycle used MySQL-primary reads, repository inspection, credential-plan metadata, device diagnostics, and resolver preview calls. It performed no provider write, no live capability dispatch, no credential payload read, no production mutation, and returned no secrets. Findings below are inventory and design inputs; they do not authorize unrestricted tenant execution or production promotion.

## Repository module map — T010 and T019

The live implementation is concentrated under `http-generic-api/` rather than fully matching the proposed top-level layered layout. Current responsibility boundaries include:

- dispatch and execution: `server.js`, `governed.js`, `execution*.js`, `executionDispatch.js`, `connectorExecutor.js`
- registry and resolution: `registry.js`, `registryResolution.js`, `actionRegistryAuthorityResolver.js`, `surfaceAuthorityResolver.js`, `platformPluginResolver.js`, `tenantEffectiveCapabilityResolver.js`
- credentials and intake: `credentialResolver.js`, `authCredentialResolution.js`, `credentialIntakeBindingPolicy.js`, `credentialIntakeEnforcement.js`, `credentialIntakeSingleUse.js`
- device trust: `localConnectorDeviceTrust.js`, `localConnectorCompositeHealth.js`, connector execution boundaries
- approval and mutation governance: `capabilityResolutionEnvelopeGuard.js`, `mutationGovernance.js`, `governedExecutionPreflight.js`
- audit and alerting: `auditLogger.js`, `executionEvidenceLogger.js`, `operationalAlertService.js`

`plan.md` now records this live mapping while retaining the constitution and dependency-direction constraints.

## SQL-primary capability inventory — T011–T014

The complete live report scanned **3,811** active records with no source truncation and no unavailable source.

| Task | Result |
|---|---|
| T011 active aliases and surfaces | 3,811 records inventoried |
| T012 dual-surface capabilities | 59 identified; 57 current policy mismatches retained as remediation backlog |
| T013 tenant-visible administrative capabilities | 22 identified |
| T014 mutation policy coverage | 1,694 policy gaps and 248 missing mutation classifications identified |

Live report SHA-256: `f9be9defbd3af578195745ec262d76f5955da7e227a3abba4ef58eb20b1be65b`.

The raw 2.3 MB administrative report was not committed because it contains a large registry snapshot. Its bounded counts and digest are recorded here; the original execution evidence remains in the governed session/runtime evidence surfaces.

## Credential resolution inventory — T015

Registered credential client modes observed were `api_key`, `oauth_client`, and `service_account`, using server-side references rather than returned secret material. The effective resolver plan confirmed the following precedence:

1. explicit credential bindings
2. active user application connections
3. action-level secret reference
4. tenant-target convention
5. platform-managed fallback only when policy permits

Authorization and target authority remain separate from credential availability, and the diagnostic returned metadata only.

## Device identity and heartbeat inventory — T016

The governed device diagnostics confirmed identity binding across configuration, device, user, and tenant identifiers. Readiness includes connector route identity, heartbeat timestamps/freshness, expected authentication headers, policy checksum, and bounded shell/file/application capability policy. Device registration alone is not treated as current health.

## Resolver performance and traffic baseline — T017

A read-only baseline executed `resolvePlatformPluginExecution` for the GitHub administrative preview path with 10 warmups followed by 100 measured samples. No provider call, external write, or mutation occurred.

| Metric | Value |
|---|---:|
| minimum | 222.399 ms |
| p50 | 228.902 ms |
| p95 | 271.817 ms |
| p99 | 307.352 ms |
| maximum | 331.661 ms |
| mean | 234.662 ms |

Observed request-envelope volume was one historical row total and zero rows in the preceding 24 hours, 7 days, and 30 days. This baseline therefore measures resolver cost, not representative production throughput. The existing container preview benchmark separately enforces its own synthetic latency budgets.

## Build and verification mechanisms — T018

- MySQL-primary schema changes are additive migrations under `http-generic-api/migrations/` and are executed only through the governed migration controls.
- The repository test manifest is executed by `scripts/run-test-manifest.mjs` and currently enumerates 534 tests/commands.
- Runtime policy and feature controls are loaded from registry/config authority and include independent containment kill switches.
- OpenAPI authority is rooted in `http-generic-api/openapi.yaml` with split schemas, route coverage checks, and endpoint inventory synchronization through `openApiEndpointInventorySync.js`.
- The Phase 1 CI failure was isolated to a test fixture inheriting `GITHUB_HEAD_REF`; the fixture is now pinned to its synthetic branch constant so repository behavior remains strict while the test remains deterministic.

## Discovery conclusion

T010–T019 are complete as discovery tasks. The identified mismatches and policy gaps are intentionally not marked remediated; they are inputs to T020 onward. Full release remains blocked pending the implementation, migration, staging verification, security review, production approval, rollout, and post-merge audit phases.
