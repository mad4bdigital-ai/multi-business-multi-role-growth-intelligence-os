# Project Integration Checklist
**Governance document — updated after each Sprint**  
Last updated: 2026-04-19 (v2.2.0-server-decomposed)

---

## Closure Criteria (Project is complete when ALL items are ✓)

### Module Integrity
- [x] All phases A–P exist as independent modules in `wordpress/`
- [x] phaseA–phaseP: all modules pass `node --check`
- [x] K.9 `buildWordpressPhaseKFinalOperatorHandoffBundle` added (36 functions)
- [x] execution.js: 72 truncated functions repaired via fix-all-truncated.mjs
- [x] governed.js: 33 truncated functions repaired
- [x] registry.js: 61 truncated functions repaired

### Export Integrity
- [x] phaseA: 33 exports
- [x] phaseB–G: ~21 exports each
- [x] phaseH: 33 exports
- [x] phaseI: 36 exports
- [x] phaseJ: 36 exports
- [x] phaseK: 36 exports (K.9 complete)
- [x] phaseL: 18 exports (Backup/Recovery)
- [x] phaseM: 18 exports (Deployment/Release/Rollback)
- [x] phaseN: 18 exports (Data Integrity/Reconciliation)
- [x] phaseO: 18 exports (QA/Smoke/Acceptance)
- [x] phaseP: 18 exports (Production Cutover)
- [x] shared.js: 68 exports (utilities + constants)
- [x] wordpress/index.js barrel re-export — 545 total exports

### Runtime Wiring
- [x] All phases A–P wired in `runWordpressConnectorMigration` (phaseA.js)
- [x] phaseA.js: explicit imports for all phase modules (B–P) and shared.js symbols
- [x] server.js imports from `./wordpress/index.js` (not monolith)
- [x] Cross-import validation: 0 ghost references in server.js

### Deduplication
- [x] 335 duplicate phase functions removed from server.js
- [x] server.js: 28,952 → 10,332 lines
- [x] Remaining duplicates in server.js: 0 (dedup scan passed)
- [x] Dead code removed: `isWordPressAction` (server.js, never called)

### Shared Symbol Resolution
- [x] 11 missing symbols added to shared.js (toPositiveInt, nowIsoSafe, normalizeWordpressPhaseAType, WORDPRESS_PHASE_*_TYPES, normalizeStringList, normalizeProviderDomain, etc.)
- [x] 47 explicit imports added across phaseA–K via fix-module-imports.mjs
- [x] `runWordpressBuilderAssetsInventoryAudit` moved to phaseB.js

### Runtime Validation
- [x] 545 total exports load at runtime — 0 ReferenceErrors
- [x] 0 ReferenceErrors across all 545 exported functions
- [x] Smoke tests pass: resolveWordpressPhaseLPlan, buildWordpressPhasePGate, buildWordpressPhaseKFinalOperatorHandoffBundle

### Evidence & Handoff
- [x] All phases A–P: evidence fields wired into both writeback blocks in phaseA.js
- [x] phaseP: `cutover_feasible` gate checks L/M/N/O statuses before allowing cutover
- [x] phaseK K.9: handoff bundle evidence in both writeback blocks

### Phase Contract Compliance
- [x] Each phase (A–P) has the full 18-function contract:
  resolvePlan, assertPlan, buildGate, runInventory, buildNormalizedInventory,
  buildReadinessGate, buildSafeCandidates, buildReconciliationPayloadPlanner,
  resolveExecutionPlan, buildExecutionGuard, buildMutationCandidateSelector,
  buildMutationCandidateArtifact, buildMutationPayloadComposer,
  buildMutationPayloadArtifact, simulateDryRunRow, buildDryRunExecutionSimulator,
  buildDryRunExecutionArtifact, buildFinalOperatorHandoffBundle

### Sprint 3 — server.js Decomposition
- [x] authCredentialResolution.js extracted (normalizeAuthContract, findHostingAccountByKey, resolveAccountKey, resolveSecretFromReference, enforceSupportedAuthMode, etc.)
- [x] httpRequestUtils.js extracted (normalizeMethod, normalizePath, applyPathParams, pathTemplateToRegex, ensureMethodAndPathMatchEndpoint)
- [x] jobUtils.js extracted (nowIso, normalizeJobId, normalizeJobStatus, buildJobId, validateAsyncJobRequest, nextRetryDelayMs, etc.)
- [x] driveFileLoader.js extracted (fetchSchemaContract, fetchOAuthConfigContract)
- [x] sheetHelpers.js extracted (headerMap, getCell)
- [x] googleSheets.js extracted (getGoogleClients, fetchRange, assertSheetExistsInSpreadsheet, readLiveSheetShape, etc.)
- [x] siteInventoryRegistry.js extracted (loadSiteRuntimeInventoryRegistry, loadSiteSettingsInventoryRegistry, loadPluginInventoryRegistry)
- [x] jobRunner.js extracted with configureJobRunner factory (toJobSummary, buildWebhookPayload, sendJobWebhook, executeSameServiceNativeEndpoint, executeJobThroughHttpEndpoint, dispatchEndpointKeyExecution, shouldRetryJobFailure, inferLocalDispatchHttpStatus, createSiteMigrationJobRecord)
- [x] Dead code removed: WordPress phase constants, toPositiveInt, sleep, chunkArray, nowIsoSafe, verifyWordpressRolledBackEntry, normalizeStringList, runWordpressBuilderAssetsInventoryAudit, normalizeWordpressFormIntegrationSignals
- [x] server.js: 10,332 → 4,961 lines after Sprint 3 decomposition

### Project-Wide Validation
- [x] All .js files pass `node --check`
- [x] All cross-imports resolve (0 ReferenceErrors at runtime)
- [x] Runtime wiring coverage: all phase calls present in runWordpressConnectorMigration
- [x] Duplicate symbol scan: 0 remaining duplicates
- [x] Integration test harness: 63 tests pass (30 unit + 33 integration including runWordpressConnectorMigration dry-run)
- [x] Per-phase governance advancement: all phases A–P at snapshot_archived

### Archive
- [x] v2.0.0-wordpress-modular — Sprint 2 extraction complete (commit 37cefb0)
- [x] v2.1.0-runtime-clean — 0 ReferenceErrors, all imports resolved (commit 0db68d7)
- [x] v2.2.0-server-decomposed — Sprint 3 server.js module extraction complete (2026-04-19)

---

## Open Items (Post v2.2.0)

| Item | Priority | Notes |
|------|----------|-------|
| None | | |

---

## Resolved Post-v2.2.0 Items
- [x] `inferWordpressInventoryAssetType` evaluated. Instead of `shared.js`, it (along with its preflight payload logic) was extracted to a dedicated top-level module `wordpress-cpt-preflight.js` alongside `utils.js`.

---

## Current Blockers

None. Project is in a production-ready state as of v2.2.0-server-decomposed.
