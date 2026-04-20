
import express from "express";
import crypto from "node:crypto";
import { promises as fs } from "fs";
import {
  redis, jobQueue, createWorker, closeQueue,
  getJobFromRedis, setJobInRedis, getAllJobsFromRedis,
  getIdempotencyEntry, setIdempotencyEntry, deleteIdempotencyEntry, hasIdempotencyEntry,
  getRedisRuntimeStatus, getWaitingCountSafe
} from "./queue.js";

import {
  extractJsonAssetPayloadBody
} from "./utils.js";
import {
  buildWordpressJsonAssetContext,
  inferWordpressInventoryAssetType
} from "./wordpress-cpt-preflight.js";
import {
  enforceGovernedMutationPreflight
} from "./mutationGovernance.js";
import {
  performUniversalServerWriteback as performUniversalServerWritebackCore,
  persistOversizedArtifact as persistOversizedArtifactCore
} from "./sinkOrchestration.js";
import {
  assertExecutionLogRowIsSpillSafe as assertExecutionLogRowIsSpillSafeCore,
  verifyAppendReadback as verifyAppendReadbackCore,
  verifyJsonAssetAppendReadback as verifyJsonAssetAppendReadbackCore,
  writeExecutionLogUnifiedRow as writeExecutionLogUnifiedRowCore,
  writeJsonAssetRegistryRow as writeJsonAssetRegistryRowCore
} from "./sinkVerification.js";
import {
  appendExecutionLogUnifiedRowGoverned as appendExecutionLogUnifiedRowGovernedCore,
  appendSheetRowGoverned as appendSheetRowGovernedCore,
  assertExecutionLogFormulaColumnsProtected as assertExecutionLogFormulaColumnsProtectedCore,
  buildColumnSliceRow as buildColumnSliceRowCore,
  buildFullWidthGovernedRow as buildFullWidthGovernedRowCore,
  buildGovernedWritePlan as buildGovernedWritePlanCore,
  deleteSheetRowGoverned as deleteSheetRowGovernedCore,
  detectUnsafeColumnsFromRow2 as detectUnsafeColumnsFromRow2Core,
  performGovernedSheetMutation as performGovernedSheetMutationCore,
  updateSheetRowGoverned as updateSheetRowGovernedCore
} from "./governedSheetWrites.js";
import {
  findSemanticDuplicateRows as findSemanticDuplicateRowsCore,
  governedPolicyEnabled as governedPolicyEnabledCore,
  governedPolicyValue as governedPolicyValueCore,
  loadLiveGovernedChangeControlPolicies as loadLiveGovernedChangeControlPoliciesCore,
  normalizeSemanticValue as normalizeSemanticValueCore,
  readRelevantExistingRowWindow as readRelevantExistingRowWindowCore
} from "./governedChangeControl.js";
import {
  assertExpectedColumnsPresent as assertExpectedColumnsPresentCore,
  assertHeaderMatchesSurfaceMetadata as assertHeaderMatchesSurfaceMetadataCore,
  buildExpectedHeaderSignatureFromCanonical as buildExpectedHeaderSignatureFromCanonicalCore,
  computeHeaderSignature as computeHeaderSignatureCore,
  getCanonicalSurfaceMetadata as getCanonicalSurfaceMetadataCore,
  normalizeExpectedColumnCount as normalizeExpectedColumnCountCore,
  readLiveSheetShape as readLiveSheetShapeCore,
  toA1Start as toA1StartCore,
  toSheetCellValue as toSheetCellValueCore
} from "./surfaceMetadata.js";
import {
  appendRowsIfMissingByKeys as appendRowsIfMissingByKeysCore,
  assertCanonicalHeaderExact as assertCanonicalHeaderExactCore,
  assertNoDirectActivationWithoutGovernedReview as assertNoDirectActivationWithoutGovernedReviewCore,
  assertNoLegacySiteMigrationScaffolding as assertNoLegacySiteMigrationScaffoldingCore,
  assertSingleActiveRowByKey as assertSingleActiveRowByKeyCore,
  blockLegacyRouteWorkflowWrite as blockLegacyRouteWorkflowWriteCore,
  buildGovernedAdditionReviewResult as buildGovernedAdditionReviewResultCore,
  buildRecordFromHeaderAndRow as buildRecordFromHeaderAndRowCore,
  buildSheetRowFromColumns as buildSheetRowFromColumnsCore,
  ensureSheetWithHeader as ensureSheetWithHeaderCore,
  ensureSiteMigrationRegistrySurfaces as ensureSiteMigrationRegistrySurfacesCore,
  ensureSiteMigrationRouteWorkflowRows as ensureSiteMigrationRouteWorkflowRowsCore,
  getSpreadsheetSheetMap as getSpreadsheetSheetMapCore,
  governedAdditionStateBlocksAuthority as governedAdditionStateBlocksAuthorityCore,
  hasDeferredGovernedActivationDependencies as hasDeferredGovernedActivationDependenciesCore,
  normalizeGovernedAdditionOutcome as normalizeGovernedAdditionOutcomeCore,
  normalizeGovernedAdditionState as normalizeGovernedAdditionStateCore
} from "./routeWorkflowGovernance.js";
import {
  loadTaskRoutesRegistry as loadTaskRoutesRegistryCore,
  loadWorkflowRegistry as loadWorkflowRegistryCore
} from "./routeWorkflowRegistryModels.js";
import {
  findRegistryRecordByIdentity as findRegistryRecordByIdentityCore,
  hostingerSshRuntimeRead as hostingerSshRuntimeReadCore,
  normalizeLooseHostname as normalizeLooseHostnameCore,
  readGovernedSheetRecords as readGovernedSheetRecordsCore,
  resolveBrandRegistryBinding as resolveBrandRegistryBindingCore
} from "./governedRecordResolution.js";
import {
  classifySchemaDrift as classifySchemaDriftCore,
  resolveSchemaOperation as resolveSchemaOperationCore,
  validateByJsonSchema as validateByJsonSchemaCore,
  validateParameters as validateParametersCore,
  validateRequestBody as validateRequestBodyCore
} from "./schemaValidation.js";
import {
  buildResolvedAuthHeaders as buildResolvedAuthHeadersCore,
  inferAuthMode as inferAuthModeCore,
  injectAuthForSchemaValidation as injectAuthForSchemaValidationCore,
  injectAuthIntoHeaders as injectAuthIntoHeadersCore,
  injectAuthIntoQuery as injectAuthIntoQueryCore,
  isOAuthConfigured as isOAuthConfiguredCore
} from "./authInjection.js";
import {
  normalizeAuthContract as normalizeAuthContractCore,
  findHostingAccountByKey as findHostingAccountByKeyCore,
  resolveAccountKeyFromBrand as resolveAccountKeyFromBrandCore,
  resolveAccountKey as resolveAccountKeyCore,
  resolveSecretFromReference as resolveSecretFromReferenceCore,
  isGoogleApiHost as isGoogleApiHostCore,
  getAdditionalStaticAuthHeaders as getAdditionalStaticAuthHeadersCore,
  enforceSupportedAuthMode as enforceSupportedAuthModeCore
} from "./authCredentialResolution.js";
import {
  normalizePath as normalizePathCore,
  pathTemplateToRegex as pathTemplateToRegexCore,
  ensureMethodAndPathMatchEndpoint as ensureMethodAndPathMatchEndpointCore
} from "./httpRequestUtils.js";
import {
  TERMINAL_JOB_STATUSES,
  ACTIVE_JOB_STATUSES,
  nowIso as nowIsoCore,
  normalizeJobStatus as normalizeJobStatusCore,
  normalizeWebhookUrl as normalizeWebhookUrlCore,
  normalizeMaxAttempts as normalizeMaxAttemptsCore,
  buildJobId as buildJobIdCore,
  resolveRequestedBy as resolveRequestedByCore,
  makeIdempotencyLookupKey as makeIdempotencyLookupKeyCore,
  buildExecutionPayloadFromJobRequest as buildExecutionPayloadFromJobRequestCore,
  validateAsyncJobRequest as validateAsyncJobRequestCore
} from "./jobUtils.js";
import {
  fetchSchemaContract as fetchSchemaContractCore
} from "./driveFileLoader.js";
import {
  mintGoogleAccessTokenForEndpoint as mintGoogleAccessTokenForEndpointCore,
  requirePolicyTrue as requirePolicyTrueCore,
  requirePolicySet as requirePolicySetCore,
  getRequiredHttpExecutionPolicyKeys as getRequiredHttpExecutionPolicyKeysCore,
  buildMissingRequiredPolicyError as buildMissingRequiredPolicyErrorCore,
  resilienceAppliesToParentAction as resilienceAppliesToParentActionCore,
  shouldRetryProviderResponse as shouldRetryProviderResponseCore,
  buildProviderRetryMutations as buildProviderRetryMutationsCore
} from "./auth.js";
import {
  assertHostingerTargetTier,
  isDelegatedHttpExecuteWrapper,
  normalizeExecutionPayload,
  normalizeTopLevelRoutingFields,
  promoteDelegatedExecutionPayload,
  validateAssetHomePayloadRules,
  validatePayloadIntegrity,
  validateTopLevelRoutingFields
} from "./normalization.js";
import {
  headerMap as headerMapUtil,
  getCell as getCellUtil
} from "./sheetHelpers.js";
import {
  getGoogleClients as getGoogleClientsBase,
  getGoogleClientsForSpreadsheet as getGoogleClientsForSpreadsheetBase,
  fetchRange as fetchRangeBase,
  assertSheetExistsInSpreadsheet as assertSheetExistsInSpreadsheetBase
} from "./googleSheets.js";
import {
  loadSiteRuntimeInventoryRegistry as loadSiteRuntimeInventoryRegistryCore,
  loadSiteSettingsInventoryRegistry as loadSiteSettingsInventoryRegistryCore,
  loadPluginInventoryRegistry as loadPluginInventoryRegistryCore
} from "./siteInventoryRegistry.js";
import {
  getEndpointExecutionSnapshot as getEndpointExecutionSnapshotCore,
  getPlaceholderResolutionSources as getPlaceholderResolutionSourcesCore,
  isDelegatedTransportTarget as isDelegatedTransportTargetCore,
  policyList as policyListCore,
  policyValue as policyValueCore,
  requireEndpointExecutionEligibility as requireEndpointExecutionEligibilityCore,
  requireExecutionModeCompatibility as requireExecutionModeCompatibilityCore,
  requireNativeFamilyBoundary as requireNativeFamilyBoundaryCore,
  requireNoFallbackDirectExecution as requireNoFallbackDirectExecutionCore,
  requireRuntimeCallableAction as requireRuntimeCallableActionCore,
  requireTransportIfDelegated as requireTransportIfDelegatedCore,
  resolveAction as resolveActionCore,
  resolveBrand as resolveBrandCore,
  resolveEndpoint as resolveEndpointCore,
  resolveProviderDomain as resolveProviderDomainCore
} from "./registryResolution.js";
import {
  resolveHttpExecutionContext as resolveHttpExecutionContextCore
} from "./executionRouting.js";
import {
  buildExecutionPolicyRow as buildExecutionPolicyRowCore,
  findExecutionPolicyRowNumber as findExecutionPolicyRowNumberCore,
  getRegistrySurfaceCatalogRowBySurfaceId as getRegistrySurfaceCatalogRowBySurfaceIdCore,
  loadActionsRegistry as loadActionsRegistryCore,
  loadBrandRegistry as loadBrandRegistryCore,
  loadEndpointRegistry as loadEndpointRegistryCore,
  loadExecutionPolicies as loadExecutionPoliciesCore,
  loadHostingAccountRegistry as loadHostingAccountRegistryCore,
  readExecutionPolicyRegistryLive as readExecutionPolicyRegistryLiveCore
} from "./registrySheets.js";
import {
  buildActionsRegistryRow as buildActionsRegistryRowCore,
  buildRegistrySurfaceCatalogRow as buildRegistrySurfaceCatalogRowCore,
  buildTaskRouteRow as buildTaskRouteRowCore,
  buildValidationRepairRegistryRow as buildValidationRepairRegistryRowCore,
  buildWorkflowRegistryRow as buildWorkflowRegistryRowCore,
  deleteActionsRegistryRow as deleteActionsRegistryRowCore,
  deleteExecutionPolicyRow as deleteExecutionPolicyRowCore,
  deleteRegistrySurfaceCatalogRow as deleteRegistrySurfaceCatalogRowCore,
  deleteTaskRouteRow as deleteTaskRouteRowCore,
  deleteValidationRepairRegistryRow as deleteValidationRepairRegistryRowCore,
  deleteWorkflowRegistryRow as deleteWorkflowRegistryRowCore,
  findActionsRegistryRowNumber as findActionsRegistryRowNumberCore,
  findRegistrySurfaceCatalogRowNumber as findRegistrySurfaceCatalogRowNumberCore,
  findTaskRouteRowNumber as findTaskRouteRowNumberCore,
  findValidationRepairRegistryRowNumber as findValidationRepairRegistryRowNumberCore,
  findWorkflowRegistryRowNumber as findWorkflowRegistryRowNumberCore,
  readActionsRegistryLive as readActionsRegistryLiveCore,
  readRegistrySurfacesCatalogLive as readRegistrySurfacesCatalogLiveCore,
  readTaskRoutesLive as readTaskRoutesLiveCore,
  readValidationRepairRegistryLive as readValidationRepairRegistryLiveCore,
  readWorkflowRegistryLive as readWorkflowRegistryLiveCore,
  updateActionsRegistryRow as updateActionsRegistryRowCore,
  updateExecutionPolicyRow as updateExecutionPolicyRowCore,
  updateRegistrySurfaceCatalogRow as updateRegistrySurfaceCatalogRowCore,
  updateTaskRouteRow as updateTaskRouteRowCore,
  updateValidationRepairRegistryRow as updateValidationRepairRegistryRowCore,
  updateWorkflowRegistryRow as updateWorkflowRegistryRowCore,
  writeActionsRegistryRow as writeActionsRegistryRowCore,
  writeExecutionPolicyRow as writeExecutionPolicyRowCore,
  writeRegistrySurfaceCatalogRow as writeRegistrySurfaceCatalogRowCore,
  writeTaskRouteRow as writeTaskRouteRowCore,
  writeValidationRepairRegistryRow as writeValidationRepairRegistryRowCore,
  writeWorkflowRegistryRow as writeWorkflowRegistryRowCore
} from "./registryMutations.js";

import {
  JSON_BODY_LIMIT, REGISTRY_SPREADSHEET_ID, ACTIVITY_SPREADSHEET_ID,
  BRAND_REGISTRY_SHEET, ACTIONS_REGISTRY_SHEET, ENDPOINT_REGISTRY_SHEET,
  EXECUTION_POLICY_SHEET, HOSTING_ACCOUNT_REGISTRY_SHEET,
  SITE_RUNTIME_INVENTORY_REGISTRY_SHEET, SITE_SETTINGS_INVENTORY_REGISTRY_SHEET,
  PLUGIN_INVENTORY_REGISTRY_SHEET, TASK_ROUTES_SHEET, WORKFLOW_REGISTRY_SHEET,
  REGISTRY_SURFACES_CATALOG_SHEET, VALIDATION_REPAIR_REGISTRY_SHEET,
  EXECUTION_LOG_UNIFIED_SHEET, JSON_ASSET_REGISTRY_SHEET, BRAND_CORE_REGISTRY_SHEET,
  EXECUTION_LOG_UNIFIED_SPREADSHEET_ID, JSON_ASSET_REGISTRY_SPREADSHEET_ID,
  OVERSIZED_ARTIFACTS_DRIVE_FOLDER_ID, RAW_BODY_MAX_BYTES, MAX_TIMEOUT_SECONDS,
  PORT as port, SERVICE_VERSION, QUEUE_WORKER_ENABLED
} from "./config.js";

import {
  applyDeferredWordpressFeaturedMediaLinks,
  applyDeferredWordpressParentLinks,
  applyDeferredWordpressTaxonomyLinks,
  assertWordpressGovernedResolutionConfidence,
  assertWordpressPhaseAScope,
  assertWordpressPhaseBPlan,
  assertWordpressPhaseCPlan,
  assertWordpressPhaseDPlan,
  assertWordpressPhaseEPlan,
  assertWordpressPhaseFPlan,
  assertWordpressPhaseGPlan,
  assertWordpressPhaseHPlan,
  buildDeferredWordpressReferencePlan,
  buildGovernedResolutionRecord,
  buildRegistryDeltaWritebackPlan,
  buildSiteMigrationArtifacts,
  buildWordpressAuthSurfaceMutationPayloadFromCandidate,
  buildWordpressAuthSurfaceReconciliationPayloadRow,
  buildWordpressAuthSurfaceRows,
  buildWordpressBuilderDependencyEdges,
  buildWordpressBuilderDryRunPayloadRow,
  buildWordpressBuilderFamilyMappingTemplate,
  buildWordpressBuilderFamilyMetaPreservationPlan,
  buildWordpressBuilderMutationPayloadFromResolvedRow,
  buildWordpressBuilderNodeKey,
  buildWordpressBuilderPhaseBGate,
  buildWordpressBuilderReferenceIndex,
  buildWordpressConsentMutationPayloadFromCandidate,
  buildWordpressConsentReconciliationPayloadRow,
  buildWordpressConsentRows,
  buildWordpressFormMutationPayloadFromCandidate,
  buildWordpressFormSafeMigrationPayloadRow,
  buildWordpressGeneratedCandidateEvidence,
  buildWordpressMediaMutationPayloadFromCandidate,
  buildWordpressMediaSafeMigrationPayloadRow,
  buildWordpressMetadataMutationPayloadFromCandidate,
  buildWordpressMetadataReconciliationPayloadRow,
  buildWordpressMutationPlan,
  buildWordpressPhaseACheckpoint,
  buildWordpressPhaseACutoverJournal,
  buildWordpressPhaseAExecutionOrder,
  buildWordpressPhaseAFinalOperatorHandoffBundle,
  buildWordpressPhaseAOperatorArtifact,
  buildWordpressPhaseAPerTypeSummary,
  buildWordpressPhaseBDependencySummary,
  buildWordpressPhaseBDryRunArtifact,
  buildWordpressPhaseBDryRunExecutionArtifact,
  buildWordpressPhaseBDryRunExecutionSimulator,
  buildWordpressPhaseBDryRunMigrationPayloadPlanner,
  buildWordpressPhaseBExecutionGuard,
  buildWordpressPhaseBExecutionGuardArtifact,
  buildWordpressPhaseBFamilySummary,
  buildWordpressPhaseBFieldMappingArtifact,
  buildWordpressPhaseBFieldMappingResolver,
  buildWordpressPhaseBFinalOperatorHandoffBundle,
  buildWordpressPhaseBMappingPlanArtifact,
  buildWordpressPhaseBMappingPlanSkeleton,
  buildWordpressPhaseBMappingPrerequisiteArtifact,
  buildWordpressPhaseBMappingPrerequisiteGate,
  buildWordpressPhaseBMigrationBuckets,
  buildWordpressPhaseBMigrationPlanningCandidates,
  buildWordpressPhaseBMutationCandidateArtifact,
  buildWordpressPhaseBMutationCandidateSelector,
  buildWordpressPhaseBMutationPayloadArtifact,
  buildWordpressPhaseBMutationPayloadComposer,
  buildWordpressPhaseBNormalizedAudit,
  buildWordpressPhaseBPlanningArtifact,
  buildWordpressPhaseBReadinessArtifact,
  buildWordpressPhaseBSequenceArtifact,
  buildWordpressPhaseBSequencePlanner,
  buildWordpressPhaseCDiffArtifact,
  buildWordpressPhaseCDryRunExecutionArtifact,
  buildWordpressPhaseCDryRunExecutionSimulator,
  buildWordpressPhaseCExecutionGuard,
  buildWordpressPhaseCExecutionGuardArtifact,
  buildWordpressPhaseCFinalOperatorHandoffBundle,
  buildWordpressPhaseCGate,
  buildWordpressPhaseCInventoryArtifact,
  buildWordpressPhaseCMutationCandidateArtifact,
  buildWordpressPhaseCMutationCandidateSelector,
  buildWordpressPhaseCMutationPayloadArtifact,
  buildWordpressPhaseCMutationPayloadComposer,
  buildWordpressPhaseCNormalizedDiff,
  buildWordpressPhaseCReadinessArtifact,
  buildWordpressPhaseCReconciliationPayloadArtifact,
  buildWordpressPhaseCReconciliationPayloadPlanner,
  buildWordpressPhaseCReconciliationReadiness,
  buildWordpressPhaseCSafeApplyCandidates,
  buildWordpressPhaseDDryRunExecutionArtifact,
  buildWordpressPhaseDDryRunExecutionSimulator,
  buildWordpressPhaseDExecutionGuard,
  buildWordpressPhaseDExecutionGuardArtifact,
  buildWordpressPhaseDFinalOperatorHandoffBundle,
  buildWordpressPhaseDGate,
  buildWordpressPhaseDInventoryArtifact,
  buildWordpressPhaseDMigrationPayloadArtifact,
  buildWordpressPhaseDMigrationPayloadPlanner,
  buildWordpressPhaseDMutationCandidateArtifact,
  buildWordpressPhaseDMutationCandidateSelector,
  buildWordpressPhaseDMutationPayloadArtifact,
  buildWordpressPhaseDMutationPayloadComposer,
  buildWordpressPhaseDNormalizedInventory,
  buildWordpressPhaseDNormalizedInventoryArtifact,
  buildWordpressPhaseDReadinessArtifact,
  buildWordpressPhaseDReadinessGate,
  buildWordpressPhaseDSafeCandidates,
  buildWordpressPhaseEDryRunExecutionArtifact,
  buildWordpressPhaseEDryRunExecutionSimulator,
  buildWordpressPhaseEExecutionGuard,
  buildWordpressPhaseEExecutionGuardArtifact,
  buildWordpressPhaseEFinalOperatorHandoffBundle,
  buildWordpressPhaseEGate,
  buildWordpressPhaseEInventoryArtifact,
  buildWordpressPhaseEMigrationPayloadArtifact,
  buildWordpressPhaseEMigrationPayloadPlanner,
  buildWordpressPhaseEMutationCandidateArtifact,
  buildWordpressPhaseEMutationCandidateSelector,
  buildWordpressPhaseEMutationPayloadArtifact,
  buildWordpressPhaseEMutationPayloadComposer,
  buildWordpressPhaseENormalizedInventory,
  buildWordpressPhaseENormalizedInventoryArtifact,
  buildWordpressPhaseEReadinessArtifact,
  buildWordpressPhaseEReadinessGate,
  buildWordpressPhaseESafeCandidates,
  buildWordpressPhaseFDryRunExecutionArtifact,
  buildWordpressPhaseFDryRunExecutionSimulator,
  buildWordpressPhaseFExecutionGuard,
  buildWordpressPhaseFExecutionGuardArtifact,
  buildWordpressPhaseFFinalOperatorHandoffBundle,
  buildWordpressPhaseFGate,
  buildWordpressPhaseFInventoryArtifact,
  buildWordpressPhaseFMutationCandidateArtifact,
  buildWordpressPhaseFMutationCandidateSelector,
  buildWordpressPhaseFMutationPayloadArtifact,
  buildWordpressPhaseFMutationPayloadComposer,
  buildWordpressPhaseFNormalizedInventory,
  buildWordpressPhaseFNormalizedInventoryArtifact,
  buildWordpressPhaseFReadinessArtifact,
  buildWordpressPhaseFReadinessGate,
  buildWordpressPhaseFReconciliationPayloadArtifact,
  buildWordpressPhaseFReconciliationPayloadPlanner,
  buildWordpressPhaseFSafeCandidates,
  buildWordpressPhaseGDryRunExecutionArtifact,
  buildWordpressPhaseGDryRunExecutionSimulator,
  buildWordpressPhaseGExecutionGuard,
  buildWordpressPhaseGExecutionGuardArtifact,
  buildWordpressPhaseGFinalOperatorHandoffBundle,
  buildWordpressPhaseGGate,
  buildWordpressPhaseGInventoryArtifact,
  buildWordpressPhaseGMutationCandidateArtifact,
  buildWordpressPhaseGMutationCandidateSelector,
  buildWordpressPhaseGMutationPayloadArtifact,
  buildWordpressPhaseGMutationPayloadComposer,
  buildWordpressPhaseGNormalizedInventory,
  buildWordpressPhaseGNormalizedInventoryArtifact,
  buildWordpressPhaseGReadinessArtifact,
  buildWordpressPhaseGReadinessGate,
  buildWordpressPhaseGReconciliationPayloadArtifact,
  buildWordpressPhaseGReconciliationPayloadPlanner,
  buildWordpressPhaseGSafeCandidates,
  buildWordpressPhaseHExecutionGuard,
  buildWordpressPhaseHExecutionGuardArtifact,
  buildWordpressPhaseHGate,
  buildWordpressPhaseHInventoryArtifact,
  buildWordpressPhaseHMutationCandidateArtifact,
  buildWordpressPhaseHMutationCandidateSelector,
  buildWordpressPhaseHMutationPayloadArtifact,
  buildWordpressPhaseHMutationPayloadComposer,
  buildWordpressPhaseHNormalizedInventory,
  buildWordpressPhaseHNormalizedInventoryArtifact,
  buildWordpressPhaseHReadinessArtifact,
  buildWordpressPhaseHReadinessGate,
  buildWordpressPhaseHReconciliationPayloadArtifact,
  buildWordpressPhaseHReconciliationPayloadPlanner,
  buildWordpressPhaseHSafeCandidates,
  buildWordpressPhaseIReadinessArtifact,
  buildWordpressPhaseIReadinessGate,
  buildWordpressPhaseISafeCandidates,
  buildWordpressPostTypeSeoRows,
  buildWordpressRedirectMutationPayloadFromCandidate,
  buildWordpressRedirectReconciliationPayloadRow,
  buildWordpressRedirectRows,
  buildWordpressRestUrl,
  buildWordpressRetryDelayMs,
  buildWordpressRoleInventoryRows,
  buildWordpressRoleMutationPayloadFromCandidate,
  buildWordpressRoleReconciliationPayloadRow,
  buildWordpressSelectivePublishCandidates,
  buildWordpressSelectivePublishRollbackPlan,
  buildWordpressSeoMetadataRows,
  buildWordpressSettingMutationPayloadFromCandidate,
  buildWordpressSettingReconciliationPayloadRow,
  buildWordpressTaxonomySeoRows,
  buildWordpressTrackingMutationPayloadFromCandidate,
  buildWordpressTrackingReconciliationPayloadRow,
  buildWordpressTrackingRows,
  buildWordpressUserMutationPayloadFromCandidate,
  buildWordpressUserReconciliationPayloadRow,
  classifyWordpressAuthSurfaceRisk,
  classifyWordpressBuilderAssetFamily,
  classifyWordpressBuilderDependencyRisk,
  classifyWordpressBuilderMigrationBucket,
  classifyWordpressCapabilityState,
  classifyWordpressConsentRisk,
  classifyWordpressExecutionStage,
  classifyWordpressFormInventoryRow,
  classifyWordpressFormMigrationStrategy,
  classifyWordpressMediaInventoryRow,
  classifyWordpressMediaMigrationStrategy,
  classifyWordpressMetadataRisk,
  classifyWordpressMigrationImpact,
  classifyWordpressPhaseAFinalCutoverRecommendation,
  classifyWordpressPhaseAOutcome,
  classifyWordpressPhaseAScope,
  classifyWordpressRedirectRisk,
  classifyWordpressRolePrivilegeRisk,
  classifyWordpressSettingReconciliationBucket,
  classifyWordpressSettingReconciliationRow,
  classifyWordpressTrackingRisk,
  classifyWordpressUserPrivilegeRisk,
  collectWordpressSiteSettingsInventory,
  computeWordpressBuilderSequenceWeight,
  ensureWordpressPhaseAState,
  evaluateWordpressBuilderCompatibilityForRow,
  evaluateWordpressPhaseAPromotionReadiness,
  evaluateWordpressPhaseAStartReadiness,
  evaluateWordpressPhaseBGraphStability,
  executeSiteMigrationJob,
  executeWordpressRestJsonRequest,
  executeWordpressSelectivePublish,
  executeWordpressSelectivePublishRollback,
  extractWordpressBuilderCompatibilitySignals,
  extractWordpressBuilderCrossReferences,
  extractWordpressCollectionSlugsFromRuntime,
  extractWordpressInlineMediaRefs,
  extractWordpressSourceReferenceMap,
  filterWordpressSelectivePublishCandidates,
  filterWordpressSelectivePublishRollbackCandidates,
  findWordpressDestinationEntryBySlug,
  firstPopulated,
  getWordpressCollectionResolverCache,
  getWordpressSiteAuth,
  inferWordpressAnalyticsPluginSignals,
  inferWordpressBuilderDependencies,
  inferWordpressFormIntegrationSignals,
  inferWordpressSeoPluginSignals,
  isTransientWordpressRetryableError,
  isWordpressHierarchicalType,
  isWordpressPhaseBBuilderType,
  isWordpressPhaseDFormType,
  isWordpressPublishablePhaseAType,
  listDifference,
  listIntersection,
  mapWordpressSourceEntryToMutationPayload,
  normalizeSiteMigrationPayload,
  normalizeWordpressAuthValue,
  normalizeWordpressBuilderDependencyFlags,
  normalizeWordpressBuilderType,
  normalizeWordpressCollectionSlug,
  normalizeWordpressFormType,
  normalizeWordpressMediaMimeClass,
  normalizeWordpressPhaseAType,
  normalizeWordpressRestRoot,
  normalizeWordpressSeoTextValue,
  normalizeWordpressSettingValueForDiff,
  normalizeWordpressSettingsInventoryRecord,
  normalizeWordpressTrackingTextValue,
  normalizeWordpressUserInventoryRow,
  pickWordpressCollectionSlugFromTypeRecord,
  probeWordpressCollectionSlug,
  publishWordpressDestinationEntryById,
  recordWordpressMutationWritebackEvidence,
  rememberWordpressDestinationReference,
  resolveDeferredWordpressParentId,
  resolveDeferredWordpressTaxonomyIds,
  resolveHostingAccountBinding,
  resolveMigrationTransport,
  resolveWordpressBuilderFieldMappingRow,
  resolveWordpressCollectionSlug,
  resolveWordpressCollectionSlugFromTypesEndpoint,
  resolveWordpressPhaseABatchPolicy,
  resolveWordpressPhaseAResumePolicy,
  resolveWordpressPhaseARetryPolicy,
  resolveWordpressPhaseBExecutionPlan,
  resolveWordpressPhaseBPlan,
  resolveWordpressPhaseCExecutionPlan,
  resolveWordpressPhaseCPlan,
  resolveWordpressPhaseDExecutionPlan,
  resolveWordpressPhaseDPlan,
  resolveWordpressPhaseEExecutionPlan,
  resolveWordpressPhaseEPlan,
  resolveWordpressPhaseFExecutionPlan,
  resolveWordpressPhaseFPlan,
  resolveWordpressPhaseGExecutionPlan,
  resolveWordpressPhaseGPlan,
  resolveWordpressPhaseHExecutionPlan,
  resolveWordpressPhaseHPlan,
  resolveWordpressPluginInventory,
  resolveWordpressRuntimeInventory,
  resolveWordpressSelectivePublishPlan,
  resolveWordpressSelectivePublishRollbackPlan,
  resolveWordpressSettingsInventory,
  resolveWordpressSiteAwarenessContext,
  rollbackWordpressPublishedEntryById,
  runHybridWordpressMigration,
  runSshWpCliMigration,
  runWithWordpressSelectiveRetry,
  runWordpressAnalyticsTrackingInventory,
  runWordpressConnectorMigration,
  runWordpressFormsIntegrationsInventory,
  runWordpressMediaInventory,
  runWordpressSeoInventory,
  runWordpressUsersRolesAuthInventory,
  shouldSkipWordpressPhaseAPostType,
  simulateWordpressBuilderDryRunResult,
  simulateWordpressFormDryRunResult,
  simulateWordpressMediaDryRunResult,
  simulateWordpressSeoDryRunRow,
  simulateWordpressSettingDryRunResult,
  simulateWordpressUsersRolesAuthDryRunRow,
  summarizeWordpressBuilderCrossReferences,
  summarizeWordpressBuilderDependencyGraph,
  summarizeWordpressPhaseAFailures,
  trimBatchForResume,
  updateWordpressDestinationEntryById,
  validateSiteMigrationPayload,
  validateSiteMigrationRouteWorkflowReadiness,
  verifyDeferredWordpressParentRepairs,
  verifyDeferredWordpressTaxonomyRepairs,
  verifyRegistryDeltaReadback,
  verifyWordpressPublishedEntry,
  wordpressRichTextToString
} from "./wordpress/index.js";
import {
  toJobSummary,
  inferLocalDispatchHttpStatus,
  createSiteMigrationJobRecord,
  executeSameServiceNativeEndpoint,
  dispatchEndpointKeyExecution,
  configureJobRunner
} from "./jobRunner.js";


const app = express();
app.use(express.json({ limit: JSON_BODY_LIMIT }));



// In-memory job store (per-worker). Writes through to Redis on every mutation.
const inMemoryJobs = new Map();

const jobRepository = {
  get(jobId) {
    return inMemoryJobs.get(String(jobId || "").trim()) || null;
  },
  set(job) {
    const id = String(job?.job_id || "").trim();
    if (!id) return null;
    inMemoryJobs.set(id, job);
    setJobInRedis(job);
    return inMemoryJobs.get(id);
  },
  delete(jobId) {
    const id = String(jobId || "").trim();
    if (!id) return;
    inMemoryJobs.delete(id);
  },
  values() {
    return [...inMemoryJobs.values()];
  },
  size() {
    return inMemoryJobs.size;
  }
};

const {
  getJob,
  updateJob,
  enqueueJob,
  executeSingleQueuedJob
} = configureJobRunner({
  jobRepository,
  executeSiteMigrationJob,
  performUniversalServerWriteback,
  logRetryWriteback
});

// Idempotency — fully async, backed by Redis.
const idempotencyRepository = {
  async get(key) {
    return getIdempotencyEntry(key);
  },
  async set(key, jobId) {
    return setIdempotencyEntry(key, jobId);
  },
  async delete(key) {
    return deleteIdempotencyEntry(key);
  },
  async has(key) {
    return hasIdempotencyEntry(key);
  }
};

// Resolve a job by ID: in-memory first, then Redis fallback (cross-instance).
async function resolveJob(jobId) {
  return jobRepository.get(jobId) || await getJobFromRedis(jobId);
}

async function failAsyncSubmission(job, idempotencyLookupKey, enqueueResult) {
  if (job?.job_id) {
    jobRepository.delete(job.job_id);
  }
  if (idempotencyLookupKey) {
    await idempotencyRepository.delete(idempotencyLookupKey);
  }

  return {
    ok: false,
    error: {
      code: enqueueResult?.error?.code || "queue_unavailable",
      message: "Async job queue is unavailable.",
      details: {
        queue_error: enqueueResult?.error || null
      }
    }
  };
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    const err = new Error(`Missing required environment variable: ${name}`);
    err.code = "missing_env";
    err.status = 500;
    throw err;
  }
  return value;
}

function backendApiKeyEnabled() {
  return !!String(process.env.BACKEND_API_KEY || "").trim();
}

function requireBackendApiKey(req, res, next) {
  const expected = process.env.BACKEND_API_KEY;
  if (!backendApiKeyEnabled()) return next();

  const auth = req.header("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== expected) {
    return res.status(401).json({
      ok: false,
      error: { code: "unauthorized", message: "Invalid backend API key." }
    });
  }
  next();
}

function debugEnabled() {
  return String(process.env.EXECUTION_DEBUG || "").trim().toLowerCase() === "true";
}

function debugLog(...args) {
  if (debugEnabled()) console.log(...args);
}

function jsonParseSafe(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function boolFromSheet(value) {
  return String(value || "").trim().toUpperCase() === "TRUE";
}

function asBool(value) {
  return String(value || "").trim().toUpperCase() === "TRUE";
}

function rowToObject(header, row) {
  const out = {};
  for (let i = 0; i < header.length; i += 1) {
    out[header[i]] = row[i] ?? "";
  }
  return out;
}

function matchesHostingerSshTarget(rowObj, input = {}) {
  if ((rowObj.hosting_provider || "").trim().toLowerCase() !== "hostinger") {
    return false;
  }

  const targetKey = String(input.target_key || "").trim();
  const hostingAccountKey = String(input.hosting_account_key || "").trim();
  const accountIdentifier = String(input.account_identifier || "").trim();
  const siteUrl = String(input.site_url || "").trim().toLowerCase();

  if (hostingAccountKey && rowObj.hosting_account_key === hostingAccountKey) {
    return true;
  }

  if (accountIdentifier && rowObj.account_identifier === accountIdentifier) {
    return true;
  }

  const resolverTargetKeys = jsonParseSafe(rowObj.resolver_target_keys_json, []);
  if (
    targetKey &&
    Array.isArray(resolverTargetKeys) &&
    resolverTargetKeys.includes(targetKey)
  ) {
    return true;
  }

  const brandSites = jsonParseSafe(rowObj.brand_sites_json, []);
  if (
    siteUrl &&
    Array.isArray(brandSites) &&
    brandSites.some(
      x => String(x?.site || "").trim().toLowerCase() === siteUrl
    )
  ) {
    return true;
  }

  return false;
}

function normalizePath(path) { return normalizePathCore(path); }

function normalizeProviderDomain(providerDomain) {
  if (!providerDomain || typeof providerDomain !== "string") {
    const err = new Error("provider_domain is required.");
    err.code = "invalid_request";
    err.status = 400;
    throw err;
  }

  let url;
  try {
    url = new URL(providerDomain);
  } catch {
    const err = new Error("provider_domain must be a valid absolute URL.");
    err.code = "invalid_request";
    err.status = 400;
    throw err;
  }

  if (!["https:", "http:"].includes(url.protocol)) {
    const err = new Error("provider_domain must use http or https.");
    err.code = "invalid_request";
    err.status = 400;
    throw err;
  }

  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function safeNormalizeProviderDomain(value) {
  try {
    return value ? normalizeProviderDomain(value) : "";
  } catch {
    return "";
  }
}

function normalizeEndpointProviderDomain(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return normalizeProviderDomain(v);
  return normalizeProviderDomain(`https://${v}`);
}

function isVariablePlaceholder(value, policies = []) {
  const v = String(value || "").trim();
  const dynamicPlaceholder = String(
    policyValue(
      policies,
      "HTTP Execution Governance",
      "Dynamic Provider Domain Placeholder",
      "target_resolved"
    )
  ).trim();

  return /^\{[^}]+\}$/.test(v) || v === dynamicPlaceholder;
}

function sanitizeCallerHeaders(headers = {}) {
  const forbidden = ["proxy-authorization", "host"];
  const clean = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const lower = String(key).toLowerCase();
    if (forbidden.includes(lower)) {
      const err = new Error(`Forbidden header: ${key}`);
      err.code = "forbidden_header";
      err.status = 403;
      throw err;
    }
    if (lower === "authorization") {
      continue;
    }
    clean[key] = value;
  }
  return clean;
}

function buildUrl(providerDomain, path) {
  const normalizedPath = normalizePath(path);
  const base = new URL(providerDomain);
  const basePath = base.pathname.replace(/\/+$/, "");
  const relativePath = normalizedPath.replace(/^\/+/, "");
  const joinedPath = `${basePath}/${relativePath}`.replace(/\/+/g, "/");
  base.pathname = joinedPath;
  base.search = "";
  return base.toString();
}

function appendQuery(url, query) {
  const u = new URL(url);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null) {
      u.searchParams.set(key, String(value));
    }
  }
  return u.toString();
}

const EXECUTION_RESULT_CLASSIFICATIONS = new Set([
  "resolved_sync",
  "resolved_async",
  "resolved_live",
  "timeout_live",
  "oversized_live",
  "failed_validation",
  "auth_failed",
  "transport_failed",
  "unresolved"
]);

const EXECUTION_ENTRY_TYPES = new Set([
  "sync_execution",
  "async_job",
  "poll_read",
  "validation_run",
  "partial_harvest",
  "oversized_capture"
]);

const EXECUTION_CLASSES = new Set([
  "sync",
  "async",
  "retry",
  "poll",
  "validation",
  "partial_harvest",
  "oversized"
]);
const SMOKE_TEST_SCENARIOS = new Set([
  "sync_success",
  "queued_success",
  "timeout",
  "oversized_artifact",
  "pointer_linkage_validation"
]);
const SMOKE_TEST_RESULTS = new Set(["pass", "fail"]);

const EXECUTION_LOG_UNIFIED_COLUMNS = [
  "Run Date",
  "Start Time",
  "End Time",
  "Duration Seconds",
  "Entry Type",
  "Execution Class",
  "Source Layer",
  "User Input",
  "Matched Aliases",
  "Route Key(s)",
  "Selected Workflows",
  "Engine Chain",
  "Execution Mode",
  "Decision Trigger",
  "Score Before",
  "Score After",
  "Performance Delta",
  "Execution Status",
  "Output Summary",
  "Recovery Status",
  "Recovery Score",
  "Recovery Notes",
  "route_id",
  "route_status",
  "route_source",
  "matched_row_id",
  "intake_validation_status",
  "execution_ready_status",
  "failure_reason",
  "recovery_action",
  "artifact_json_asset_id",
  "target_module_writeback",
  "target_workflow_writeback",
  "execution_trace_id_writeback",
  "log_source_writeback",
  "monitored_row_writeback",
  "performance_impact_row_writeback"
];

const JSON_ASSET_REGISTRY_COLUMNS = [
  "asset_id",
  "brand_name",
  "asset_key",
  "asset_type",
  "cpt_slug",
  "mapping_status",
  "mapping_version",
  "storage_format",
  "google_drive_link",
  "source_mode",
  "source_asset_ref",
  "json_payload",
  "transport_status",
  "validation_status",
  "last_validated_at",
  "notes",
  "active_status"
];

const HOSTING_ACCOUNT_REGISTRY_COLUMNS = [
  "hosting_account_key",
  "hosting_provider",
  "account_identifier",
  "api_auth_mode",
  "api_key_reference",
  "api_key_storage_mode",
  "plan_label",
  "plan_type",
  "account_scope_notes",
  "status",
  "last_reviewed_at",
  "brand_sites_json",
  "resolver_target_keys_json",
  "auth_validation_status",
  "endpoint_binding_status",
  "resolver_execution_ready",
  "last_runtime_check_at",
  "ssh_available",
  "wp_cli_available",
  "shared_access_enabled",
  "account_mode",
  "ssh_host",
  "ssh_port",
  "ssh_username",
  "ssh_auth_mode",
  "ssh_credential_reference",
  "ssh_runtime_notes"
];


// Canonical governance note:
// Task Routes and Workflow Registry are live authority surfaces.
// Do not reintroduce compressed SITE_MIGRATION_* route/workflow row builders.
// Migration readiness must be validated against live canonical sheets only.
const TASK_ROUTES_CANONICAL_COLUMNS = [
  "Task Key",
  "Trigger Terms",
  "Route Modules",
  "Execution Layer",
  "Priority",
  "Enabled",
  "Output Focus",
  "Notes",
  "Entry Sources",
  "Linked Starter Titles",
  "Active Starter Count",
  "Route Key Match Status",
  "row_id",
  "route_id",
  "active",
  "intent_key",
  "brand_scope",
  "request_type",
  "route_mode",
  "target_module",
  "workflow_key",
  "lifecycle_mode",
  "memory_required",
  "logging_required",
  "review_required",
  "priority",
  "allowed_states",
  "degraded_action",
  "blocked_action",
  "match_rule",
  "route_source",
  "last_validated_at"
];

const WORKFLOW_REGISTRY_CANONICAL_COLUMNS = [
  "Workflow ID",
  "Workflow Name",
  "Module Mode",
  "Trigger Source",
  "Input Type",
  "Primary Objective",
  "Mapped Engine(s)",
  "Engine Order",
  "Workflow Type",
  "Primary Output",
  "Input Detection Rules",
  "Output Template",
  "Priority",
  "Route Key",
  "Execution Mode",
  "User Facing",
  "Parent Layer",
  "Status",
  "Linked Workflows",
  "Linked Engines",
  "Notes",
  "Entry Priority Weight",
  "Dependency Type",
  "Output Artifact Type",
  "workflow_key",
  "active",
  "target_module",
  "execution_class",
  "lifecycle_mode",
  "route_compatibility",
  "memory_required",
  "logging_required",
  "review_required",
  "allowed_states",
  "degraded_action",
  "blocked_action",
  "registry_source",
  "last_validated_at"
];

const REQUIRED_SITE_MIGRATION_TASK_KEYS = Object.freeze([
  "route_site_migration",
  "route_site_migration_validation",
  "route_site_migration_repair"
]);

const REQUIRED_SITE_MIGRATION_WORKFLOW_IDS = Object.freeze([
  "wf_wordpress_site_migration",
  "wf_wordpress_runtime_inventory_refresh",
  "wf_wordpress_site_migration_repair"
]);

const GOVERNED_ADDITION_OUTCOMES = new Set([
  "reuse_existing",
  "extend_existing",
  "create_new_route",
  "create_new_workflow",
  "create_chain",
  "create_new_surface",
  "blocked_overlap_conflict",
  "degraded_missing_dependencies",
  "pending_validation"
]);

const GOVERNED_ADDITION_STATES = new Set([
  "candidate",
  "inactive",
  "pending_validation",
  "active",
  "blocked",
  "degraded"
]);

const GOVERNED_BRAND_ONBOARDING_OUTCOMES = new Set([
  "reuse_existing_brand",
  "create_brand_candidate",
  "brand_folder_required",
  "brand_folder_created",
  "brand_identity_build_required",
  "brand_identity_partial",
  "property_binding_required",
  "runtime_binding_required",
  "blocked_duplicate_brand",
  "degraded_missing_brand_dependencies",
  "pending_validation"
]);

function toValuesApiRange(sheetName, a1Tail) {
  return `${String(sheetName || "").trim()}!${a1Tail}`;
}

const EXECUTION_LOG_UNIFIED_RANGE = toValuesApiRange(EXECUTION_LOG_UNIFIED_SHEET, "A1:AQ10");
const JSON_ASSET_REGISTRY_RANGE = toValuesApiRange(JSON_ASSET_REGISTRY_SHEET, "A1:AZ10");
const HOSTING_ACCOUNT_REGISTRY_RANGE = toValuesApiRange(
  HOSTING_ACCOUNT_REGISTRY_SHEET,
  "A:AA"
);

const PROTECTED_UNIFIED_LOG_COLUMNS = new Set();

const EXECUTION_LOG_UNIFIED_RAW_WRITEBACK_COLUMNS = [
  "target_module_writeback",
  "target_workflow_writeback",
  "execution_trace_id_writeback",
  "log_source_writeback",
  "monitored_row_writeback",
  "performance_impact_row_writeback"
];

const EXECUTION_LOG_UNIFIED_RAW_WRITEBACK_START_COLUMN = "AF";
const EXECUTION_LOG_UNIFIED_RAW_WRITEBACK_END_COLUMN = "AK";
const AUTHORITATIVE_RAW_EXECUTION_LOG_SURFACE_ID =
  "surface.operations_log_unified_sheet";

const ROUTING_ONLY_TRANSPORT_FIELDS = new Set([
  "target_key",
  "brand",
  "brand_domain",
  "provider_domain",
  "parent_action_key",
  "endpoint_key",
  "force_refresh",
  "timeout_seconds",
  "readback",
  "expect_json",
  "execution_trace_id"
]);


function stripRoutingOnlyTransportFields(value) {
  if (Array.isArray(value)) {
    return value.map(stripRoutingOnlyTransportFields);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const cleaned = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (ROUTING_ONLY_TRANSPORT_FIELDS.has(String(key || "").trim())) {
      continue;
    }
    cleaned[key] = stripRoutingOnlyTransportFields(nestedValue);
  }

  return cleaned;
}

function finalizeTransportBody(body) {
  if (body === undefined) return undefined;
  if (body === null) return null;
  if (Array.isArray(body)) return stripRoutingOnlyTransportFields(body);
  if (typeof body !== "object") return body;
  return stripRoutingOnlyTransportFields(body);
}

function mapExecutionStatus(jobStatus) {
  const status = String(jobStatus || "").trim().toLowerCase();
  switch (status) {
    case "queued":
      return "pending";
    case "running":
      return "running";
    case "succeeded":
      return "success";
    case "failed":
      return "failed";
    case "retrying":
      return "retrying";
    case "cancelled":
      return "cancelled";
    default:
      return "unknown";
  }
}

function classifyExecutionResult(args = {}) {
  if (args.oversized) return "oversized_live";
  if (args.error_code === "worker_timeout") return "timeout_live";
  if (args.error_code === "auth_failed") return "auth_failed";
  if (args.error_code === "failed_validation") return "failed_validation";
  if (args.error_code === "transport_failed") return "transport_failed";
  if (args.status === "success" && args.async_mode) return "resolved_async";
  if (args.status === "success") return "resolved_sync";
  return "unresolved";
}

function buildOutputSummary(args = {}) {
  if (args.oversized) {
    return `Oversized response captured for ${args.endpoint_key ?? "unknown_endpoint"}`;
  }
  if (args.error_code) {
    return `${args.endpoint_key ?? "unknown_endpoint"} failed: ${args.error_code}`;
  }
  return `${args.endpoint_key ?? "unknown_endpoint"} completed with status ${args.status}${args.http_status ? ` (${args.http_status})` : ""}`;
}

function createExecutionTraceId() {
  return `trace_${crypto.randomUUID().replace(/-/g, "")}`;
}

function isOversizedBody(value) {
  try {
    const bytes = Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
    return bytes > RAW_BODY_MAX_BYTES;
  } catch {
    return true;
  }
}

function buildArtifactFileName(input = {}) {
  const brand = (input.brand_name ?? "unknown_brand")
    .replace(/\s+/g, "_")
    .toLowerCase();
  const endpoint = (input.endpoint_key ?? "unknown_endpoint")
    .replace(/\s+/g, "_")
    .toLowerCase();
  const ts = String(input.captured_at || nowIso()).replace(/[:.]/g, "-");
  return `${brand}__${endpoint}__${ts}__${input.execution_trace_id}.json`;
}

function toExecutionLogUnifiedRow(w) {
  const start = new Date(w.started_at);
  const end = w.completed_at ? new Date(w.completed_at) : undefined;

  return {
    "Run Date": start.toISOString().slice(0, 10),
    "Start Time": start.toISOString(),
    "End Time": end ? end.toISOString() : "",
    "Duration Seconds": w.duration_seconds ?? "",
    "Entry Type": w.entry_type,
    "Execution Class": w.execution_class,
    "Source Layer": w.source_layer,
    "User Input": "",
    "Matched Aliases": "",
    "Route Key(s)": "",
    "Selected Workflows": "",
    "Engine Chain": "",
    "Execution Mode": "",
    "Decision Trigger": "",
    "Score Before": "",
    "Score After": "",
    "Performance Delta": "",
    "Execution Status": w.status,
    "Output Summary": w.output_summary,
    "Recovery Status": "",
    "Recovery Score": "",
    "Recovery Notes": "",
    route_id: w.route_id ?? "",
    route_status: "",
    route_source: "",
    matched_row_id: "",
    intake_validation_status: "",
    execution_ready_status: "",
    failure_reason: w.error_code ?? "",
    recovery_action: "",

    artifact_json_asset_id: w.artifact_json_asset_id ?? "",

    // raw writeback columns
    target_module_writeback: w.target_module ?? "",
    target_workflow_writeback: w.target_workflow ?? "",
    execution_trace_id_writeback: w.execution_trace_id ?? "",
    log_source_writeback: w.log_source ?? "",
    monitored_row_writeback:
      w.monitored_row === undefined || w.monitored_row === null
        ? ""
        : (w.monitored_row ? "TRUE" : "FALSE"),
    performance_impact_row_writeback:
      w.performance_impact_row === undefined || w.performance_impact_row === null
        ? ""
        : (w.performance_impact_row ? "TRUE" : "FALSE")
  };
}

function createJsonAssetId() {
  return `JSON-ASSET-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

function toJsonAssetRegistryRow(args = {}) {
  const asset_id = createJsonAssetId();
  const brand = args.brand_name ?? "Unknown Brand";
  const endpoint = args.endpoint_key ?? "unknown_endpoint";
  const wordpressAssetContext =
    String(args.parent_action_key || "").trim() === "wordpress_api" ||
    String(args.asset_type || "").trim() === "wordpress_cpt_schema_preflight"
      ? buildWordpressJsonAssetContext(args)
      : null;
  const isWordpressPreflightAsset =
    wordpressAssetContext?.isWordpressPreflightAsset === true;
  const inferred_asset_type =
    wordpressAssetContext
      ? wordpressAssetContext.inferred_asset_type
      : args.job_id
      ? "raw_queue_response_body"
      : "raw_sync_response_body";
  const asset_type = String(args.asset_type || inferred_asset_type).trim();
  const oversized = !!args.oversized;
  const payloadBody = wordpressAssetContext
    ? wordpressAssetContext.payloadBody
    : extractJsonAssetPayloadBody(args);
  const embeddedPayload = oversized
    ? ""
    : JSON.stringify(payloadBody ?? null);
  const assetHome = assertJsonAssetWriteAllowed({
    ...args,
    endpoint_key: endpoint,
    asset_type,
    asset_key: wordpressAssetContext?.asset_key || `${endpoint}__${args.execution_trace_id}`
  });

  return {
    asset_id,
    brand_name: brand,
    asset_key: wordpressAssetContext?.asset_key || `${endpoint}__${args.execution_trace_id}`,
    asset_type,
    cpt_slug: args.cpt_slug || args.post_type || args.type || "",
    mapping_status: wordpressAssetContext?.mapping_status || "captured_unreduced",
    mapping_version: isWordpressPreflightAsset
      ? wordpressAssetContext?.mapping_version
      : oversized
      ? "response_body_artifact_v2"
      : "response_body_embedded_v2",
    storage_format: "json",
    google_drive_link: oversized ? args.google_drive_link : "",
    source_mode: wordpressAssetContext?.source_mode || "server_writeback_artifact",
    source_asset_ref: isWordpressPreflightAsset
      ? wordpressAssetContext?.source_asset_ref
      : oversized
      ? args.drive_file_id
      : "",
    json_payload: embeddedPayload,
    transport_status: isWordpressPreflightAsset
      ? wordpressAssetContext?.transport_status
      : oversized
      ? "captured_external"
      : "captured_embedded",
    validation_status: wordpressAssetContext?.validation_status || "pending",
    last_validated_at: args.captured_at,
    notes: isWordpressPreflightAsset
      ? `Governed wordpress_cpt_schema_preflight asset captured for execution_trace_id=${args.execution_trace_id}; authoritative_home=${assetHome.authoritative_home}`
      : oversized
      ? `Oversized derived JSON artifact captured for execution_trace_id=${args.execution_trace_id}; authoritative_home=${assetHome.authoritative_home}`
      : `Embedded derived JSON artifact captured for execution_trace_id=${args.execution_trace_id}; authoritative_home=${assetHome.authoritative_home}`,
    active_status: "TRUE"
  };
}

const BRAND_CORE_OPERATIONAL_ASSET_TYPES = new Set([
  "profile",
  "profile_asset",
  "playbook",
  "playbook_asset",
  "import_template",
  "import_template_asset",
  "composed_payload",
  "composed_payload_asset",
  "brand_site_profile",
  "brand_publish_playbook",
  "brand_multilingual_import_template",
  "workbook_asset",
  "brand_core_serialized_asset"
]);

function normalizeAssetType(value = "") {
  return String(value || "").trim().toLowerCase();
}

function isDerivedJsonArtifactAssetType(assetType = "") {
  return normalizeAssetType(assetType) === "derived_json_artifact";
}

function isBrandCoreOperationalAssetType(assetType = "") {
  return BRAND_CORE_OPERATIONAL_ASSET_TYPES.has(normalizeAssetType(assetType));
}

function classifyAssetHome(args = {}) {
  const explicitAssetType = normalizeAssetType(args.asset_type);
  const endpointKey = String(args.endpoint_key || "").trim();
  const sourceAssetRef = String(args.source_asset_ref || "").trim();
  const assetKey = String(args.asset_key || "").trim();

  if (isDerivedJsonArtifactAssetType(explicitAssetType)) {
    return {
      asset_class: "derived_json_artifact",
      authoritative_home: "json_asset_registry",
      json_asset_allowed: true
    };
  }

  if (
    isBrandCoreOperationalAssetType(explicitAssetType) ||
    /^brand_site_profile/i.test(assetKey) ||
    /^brand_publish_playbook/i.test(assetKey) ||
    /^brand_multilingual_import_template/i.test(assetKey) ||
    /^profile_asset/i.test(assetKey) ||
    /^playbook_asset/i.test(assetKey) ||
    /^import_template_asset/i.test(assetKey) ||
    /^composed_payload_asset/i.test(assetKey) ||
    /^brand_site_profile/i.test(sourceAssetRef) ||
    /^brand_publish_playbook/i.test(sourceAssetRef) ||
    /^brand_multilingual_import_template/i.test(sourceAssetRef) ||
    /^profile_asset/i.test(sourceAssetRef) ||
    /^playbook_asset/i.test(sourceAssetRef) ||
    /^import_template_asset/i.test(sourceAssetRef) ||
    /^composed_payload_asset/i.test(sourceAssetRef)
  ) {
    return {
      asset_class: explicitAssetType || "brand_core_operational_asset",
      authoritative_home: "brand_core_registry",
      json_asset_allowed: false
    };
  }

  if (
    endpointKey === "wordpress_list_tags" ||
    endpointKey === "wordpress_list_categories" ||
    endpointKey === "wordpress_list_types"
  ) {
    return {
      asset_class: normalizeAssetType(inferWordpressInventoryAssetType(endpointKey)),
      authoritative_home: "json_asset_registry",
      json_asset_allowed: true
    };
  }

  return {
    asset_class: explicitAssetType || "derived_json_artifact",
    authoritative_home: "json_asset_registry",
    json_asset_allowed: true
  };
}

function assertJsonAssetWriteAllowed(args = {}) {
  const classification = classifyAssetHome(args);

  if (!classification.json_asset_allowed) {
    const err = new Error(
      `JSON Asset Registry is not the authoritative home for asset_type=${classification.asset_class}. Use ${BRAND_CORE_REGISTRY_SHEET}.`
    );
    err.code = "json_asset_authority_violation";
    err.status = 400;
    err.authoritative_home = classification.authoritative_home;
    err.asset_class = classification.asset_class;
    throw err;
  }

  return classification;
}

function isSchemaMetaOnlyPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const keys = Object.keys(value);
  if (keys.length !== 3) return false;

  return (
    Object.prototype.hasOwnProperty.call(value, "request_schema_alignment_status") &&
    Object.prototype.hasOwnProperty.call(value, "openai_schema_file_id") &&
    Object.prototype.hasOwnProperty.call(value, "schema_name")
  );
}

async function findExistingJsonAssetByAssetKey(assetKey = "") {
  const normalizedAssetKey = String(assetKey || "").trim();
  if (!normalizedAssetKey) return null;

  const { sheets } = await getGoogleClientsForSpreadsheet(
    JSON_ASSET_REGISTRY_SPREADSHEET_ID
  );

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(JSON_ASSET_REGISTRY_SPREADSHEET_ID || "").trim(),
    range: toValuesApiRange(JSON_ASSET_REGISTRY_SHEET, "A:Q")
  });

  const values = response.data.values || [];
  if (values.length < 2) return null;

  const header = values[0].map(v => String(v || "").trim());
  const rows = values.slice(1);
  const map = headerMap(header, JSON_ASSET_REGISTRY_SHEET);

  const assetKeyIdx = map.asset_key;
  if (assetKeyIdx === undefined) return null;

  const transportStatusIdx = map.transport_status;
  const activeStatusIdx = map.active_status;

  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    const existingAssetKey = String(row[assetKeyIdx] || "").trim();
    const transportStatus =
      transportStatusIdx === undefined ? "" : String(row[transportStatusIdx] || "").trim();
    const activeStatus =
      activeStatusIdx === undefined ? "" : String(row[activeStatusIdx] || "").trim();

    if (
      existingAssetKey === normalizedAssetKey &&
      activeStatus === "TRUE" &&
      transportStatus !== ""
    ) {
      return row;
    }
  }

  return null;
}

function normalizeExecutionErrorCode(errorCode = "") {
  const code = String(errorCode || "").trim();
  if (!code) return "";

  if (code === "worker_transport_error") return "transport_failed";
  if (code === "auth_resolution_failed") return "auth_failed";
  if (
    code === "request_schema_mismatch" ||
    code === "response_schema_mismatch" ||
    code === "response_schema_missing"
  ) {
    return "failed_validation";
  }
  return code;
}

function compactErrorMessage(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.slice(0, 500);
}

function classifySmokeTestResult(args = {}) {
  if (!SMOKE_TEST_SCENARIOS.has(String(args.scenario || "").trim())) {
    const err = new Error(`Unknown smoke test scenario: ${args.scenario}`);
    err.code = "unknown_smoke_test_scenario";
    err.status = 400;
    throw err;
  }

  const result = args.passed ? "pass" : "fail";
  if (!SMOKE_TEST_RESULTS.has(result)) {
    const err = new Error(`Invalid smoke test result: ${result}`);
    err.code = "invalid_smoke_test_result";
    err.status = 500;
    throw err;
  }
  return result;
}

function buildSmokeTestSummary(args = {}) {
  const scenario = String(args.scenario || "").trim();
  const result = classifySmokeTestResult(args);
  const note = String(args.note || "").trim();
  return note
    ? `[${result}] ${scenario}: ${note}`
    : `[${result}] ${scenario}`;
}

async function runWritebackSmokeTest(input = {}) {
  const scenario = String(input.scenario || "").trim();
  const passed = !!input.passed;
  const result = classifySmokeTestResult({ scenario, passed });

  return {
    scenario,
    result,
    summary: buildSmokeTestSummary({
      scenario,
      passed,
      note: input.note || ""
    }),
    execution_trace_id: String(input.execution_trace_id || "").trim(),
    artifact_expected: !!input.artifact_expected,
    artifact_observed: !!input.artifact_observed,
    pointer_linkage_expected: !!input.pointer_linkage_expected,
    pointer_linkage_observed: !!input.pointer_linkage_observed
  };
}

function evaluateWritebackSmokeSuite(args = {}) {
  const checks = [
    runWritebackSmokeTest({
      scenario: "sync_success",
      passed: !!args.sync_success,
      note: args.sync_success_note || ""
    }),
    runWritebackSmokeTest({
      scenario: "queued_success",
      passed: !!args.queued_success,
      note: args.queued_success_note || ""
    }),
    runWritebackSmokeTest({
      scenario: "timeout",
      passed: !!args.timeout,
      note: args.timeout_note || ""
    }),
    runWritebackSmokeTest({
      scenario: "oversized_artifact",
      passed: !!args.oversized_artifact,
      note: args.oversized_artifact_note || "",
      artifact_expected: true,
      artifact_observed: !!args.oversized_artifact
    }),
    runWritebackSmokeTest({
      scenario: "pointer_linkage_validation",
      passed: !!args.pointer_linkage_validation,
      note: args.pointer_linkage_validation_note || "",
      pointer_linkage_expected: true,
      pointer_linkage_observed: !!args.pointer_linkage_validation
    })
  ];

  return Promise.all(checks).then(results => ({
    overall:
      results.every(r => r.result === "pass") ? "pass" : "fail",
    results
  }));
}

async function performUniversalServerWriteback(input = {}) {
  return await performUniversalServerWritebackCore(
    input,
    {
      createExecutionTraceId,
      isOversizedBody,
      mapExecutionStatus,
      normalizeExecutionErrorCode,
      classifyExecutionResult,
      extractJsonAssetPayloadBody,
      isSchemaMetaOnlyPayload,
      classifyAssetHome,
      persistOversizedArtifactImpl: (artifactInput) => persistOversizedArtifactCore(
        artifactInput,
        {
          getGoogleClients,
          buildArtifactFileName,
          oversizedArtifactsDriveFolderId: OVERSIZED_ARTIFACTS_DRIVE_FOLDER_ID
        }
      ),
      findExistingJsonAssetByAssetKey,
      toJsonAssetRegistryRow,
      executionEntryTypes: EXECUTION_ENTRY_TYPES,
      executionClasses: EXECUTION_CLASSES,
      executionResultClassifications: EXECUTION_RESULT_CLASSIFICATIONS,
      compactErrorMessage,
      buildOutputSummary,
      authoritativeRawExecutionLogSurfaceId: AUTHORITATIVE_RAW_EXECUTION_LOG_SURFACE_ID,
      assertGovernedSinkSheetsExist,
      toExecutionLogUnifiedRow,
      assertExecutionLogRowIsSpillSafe: assertExecutionLogRowIsSpillSafeCore,
      writeExecutionLogUnifiedRow: (row) => writeExecutionLogUnifiedRowCore(
        row,
        {
          getGoogleClients,
          readLiveSheetShape,
          executionLogUnifiedSpreadsheetId: EXECUTION_LOG_UNIFIED_SPREADSHEET_ID,
          executionLogUnifiedSheet: EXECUTION_LOG_UNIFIED_SHEET,
          executionLogUnifiedRange: EXECUTION_LOG_UNIFIED_RANGE,
          assertExpectedColumnsPresent,
          executionLogUnifiedColumns: EXECUTION_LOG_UNIFIED_COLUMNS,
          computeHeaderSignature,
          buildGovernedWritePlan,
          protectedUnifiedLogColumns: PROTECTED_UNIFIED_LOG_COLUMNS,
          assertExecutionLogFormulaColumnsProtected,
          performGovernedSheetMutation,
          verifyAppendReadbackImpl: (args) => verifyAppendReadbackCore(
            args,
            {
              getGoogleClientsForSpreadsheet,
              toValuesApiRange,
              headerMap
            }
          )
        }
      ),
      writeJsonAssetRegistryRow: (row) => writeJsonAssetRegistryRowCore(
        row,
        {
          getGoogleClients,
          readLiveSheetShape,
          jsonAssetRegistrySpreadsheetId: JSON_ASSET_REGISTRY_SPREADSHEET_ID,
          jsonAssetRegistrySheet: JSON_ASSET_REGISTRY_SHEET,
          jsonAssetRegistryRange: JSON_ASSET_REGISTRY_RANGE,
          assertExpectedColumnsPresent,
          jsonAssetRegistryColumns: JSON_ASSET_REGISTRY_COLUMNS,
          computeHeaderSignature,
          buildGovernedWritePlan,
          performGovernedSheetMutation,
          verifyJsonAssetAppendReadbackImpl: (args) => verifyJsonAssetAppendReadbackCore(
            args,
            {
              getGoogleClientsForSpreadsheet,
              toValuesApiRange,
              headerMap
            }
          )
        }
      ),
      executionLogUnifiedSheet: EXECUTION_LOG_UNIFIED_SHEET,
      jsonAssetRegistrySheet: JSON_ASSET_REGISTRY_SHEET,
      executionLogUnifiedSpreadsheetId: EXECUTION_LOG_UNIFIED_SPREADSHEET_ID,
      jsonAssetRegistrySpreadsheetId: JSON_ASSET_REGISTRY_SPREADSHEET_ID
    }
  );
}

async function logValidationRunWriteback(input = {}) {
  return await performUniversalServerWriteback({
    mode: "validation",
    job_id: undefined,
    target_key: input.target_key,
    parent_action_key: input.parent_action_key,
    endpoint_key: input.endpoint_key,
    route_id: input.route_id,
    target_module: input.target_module,
    target_workflow: input.target_workflow,
    source_layer: "system_bootstrap",
    entry_type: "validation_run",
    execution_class: "validation",
    attempt_count: input.attempt_count ?? 1,
    status_source: input.validationStatus,
    responseBody: input.validationPayload,
    error_code: input.error_code,
    error_message_short: input.error_message_short,
    http_status: undefined,
    brand_name: input.brand_name,
    execution_trace_id: input.execution_trace_id,
    started_at: input.started_at
  });
}

async function logPartialHarvestWriteback(input = {}) {
  return await performUniversalServerWriteback({
    mode: "partial_harvest",
    job_id: input.job_id,
    target_key: input.target_key,
    parent_action_key: input.parent_action_key,
    endpoint_key: input.endpoint_key,
    route_id: input.route_id,
    target_module: input.target_module,
    target_workflow: input.target_workflow,
    source_layer: "http_client_backend",
    entry_type: "partial_harvest",
    execution_class: "partial_harvest",
    attempt_count: input.attempt_count,
    status_source: input.status_source,
    responseBody: input.harvestedChunk,
    error_code: input.error_code,
    error_message_short: input.error_message_short,
    http_status: input.http_status,
    brand_name: input.brand_name,
    execution_trace_id: input.execution_trace_id,
    started_at: input.started_at
  });
}

async function logRetryWriteback(input = {}) {
  return await performUniversalServerWriteback({
    mode: "async",
    job_id: input.job_id,
    target_key: input.target_key,
    parent_action_key: input.parent_action_key,
    endpoint_key: input.endpoint_key,
    route_id: input.route_id,
    target_module: input.target_module,
    target_workflow: input.target_workflow,
    source_layer: "http_client_backend",
    entry_type: "async_job",
    execution_class: "retry",
    attempt_count: input.attempt_count,
    status_source: "retrying",
    responseBody: input.responseBody,
    error_code: input.error_code,
    error_message_short: input.error_message_short,
    http_status: input.http_status,
    brand_name: input.brand_name,
    execution_trace_id: input.execution_trace_id,
    started_at: input.started_at
  });
}

function headerMap(headerRow, sheetName) { return headerMapUtil(headerRow, sheetName); }
function getCell(row, map, key) { return getCellUtil(row, map, key); }

async function getGoogleClients() { return getGoogleClientsBase(); }
async function getGoogleClientsForSpreadsheet(id) { return getGoogleClientsForSpreadsheetBase(id); }
async function assertSheetExistsInSpreadsheet(spreadsheetId, sheetName) { return assertSheetExistsInSpreadsheetBase(spreadsheetId, sheetName); }

async function assertGovernedSinkSheetsExist() {
  const executionLogTitles = await assertSheetExistsInSpreadsheet(
    EXECUTION_LOG_UNIFIED_SPREADSHEET_ID,
    EXECUTION_LOG_UNIFIED_SHEET
  );
  const jsonAssetTitles = await assertSheetExistsInSpreadsheet(
    JSON_ASSET_REGISTRY_SPREADSHEET_ID,
    JSON_ASSET_REGISTRY_SHEET
  );
  return { executionLogTitles, jsonAssetTitles };
}

async function fetchRange(sheets, range) { return fetchRangeBase(sheets, range); }

function toSheetCellValue(value) {
  return toSheetCellValueCore(value);
}

function toA1Start(sheetName) {
  return toA1StartCore(sheetName, { toValuesApiRange });
}

async function readLiveSheetShape(spreadsheetId, sheetName, rangeA1) {
  return readLiveSheetShapeCore(spreadsheetId, sheetName, rangeA1, {
    getGoogleClientsForSpreadsheet,
    headerMap
  });
}

async function getRegistrySurfaceCatalogRowBySurfaceId(surfaceId = "") {
  return getRegistrySurfaceCatalogRowBySurfaceIdCore(surfaceId, {
    REGISTRY_SPREADSHEET_ID,
    REGISTRY_SURFACES_CATALOG_SHEET,
    getGoogleClientsForSpreadsheet,
    getCell,
    headerMap,
    toValuesApiRange
  });
}

function buildExpectedHeaderSignatureFromCanonical(columns = []) {
  return buildExpectedHeaderSignatureFromCanonicalCore(columns);
}

function normalizeExpectedColumnCount(value, fallbackColumns = []) {
  return normalizeExpectedColumnCountCore(value, fallbackColumns);
}

async function getCanonicalSurfaceMetadata(surfaceId = "", fallback = {}) {
  return getCanonicalSurfaceMetadataCore(surfaceId, fallback, {
    getRegistrySurfaceCatalogRowBySurfaceId
  });
}

function assertHeaderMatchesSurfaceMetadata(args = {}) {
  return assertHeaderMatchesSurfaceMetadataCore(args, {
    assertCanonicalHeaderExact
  });
}

function computeHeaderSignature(header = []) {
  return computeHeaderSignatureCore(header);
}

function assertExpectedColumnsPresent(header = [], required = [], sheetName = "sheet") {
  return assertExpectedColumnsPresentCore(header, required, sheetName);
}

function detectUnsafeColumnsFromRow2(header = [], row2 = []) {
  return detectUnsafeColumnsFromRow2Core(header, row2);
}

function buildGovernedWritePlan(args = {}) {
  return buildGovernedWritePlanCore(args);
}

function assertExecutionLogFormulaColumnsProtected(plan = {}, sheetName = "Execution Log Unified") {
  return assertExecutionLogFormulaColumnsProtectedCore(plan, {
    executionLogUnifiedRawWritebackColumns: EXECUTION_LOG_UNIFIED_RAW_WRITEBACK_COLUMNS,
    sheetName
  });
}

function buildFullWidthGovernedRow(header = [], safeColumns = [], rowObject = {}) {
  return buildFullWidthGovernedRowCore(header, safeColumns, rowObject, {
    toSheetCellValue
  });
}

function buildColumnSliceRow(columns = [], rowObject = {}) {
  return buildColumnSliceRowCore(columns, rowObject, { toSheetCellValue });
}

const HIGH_RISK_GOVERNED_SHEETS = new Set([
  EXECUTION_POLICY_SHEET,
  TASK_ROUTES_SHEET,
  WORKFLOW_REGISTRY_SHEET,
  ACTIONS_REGISTRY_SHEET,
  ENDPOINT_REGISTRY_SHEET,
  REGISTRY_SURFACES_CATALOG_SHEET,
  VALIDATION_REPAIR_REGISTRY_SHEET,
  BRAND_REGISTRY_SHEET,
  BRAND_CORE_REGISTRY_SHEET,
  JSON_ASSET_REGISTRY_SHEET,
  EXECUTION_LOG_UNIFIED_SHEET
]);

const loadLiveGovernedChangeControlPolicies = async () => loadLiveGovernedChangeControlPoliciesCore({
  EXECUTION_POLICY_SHEET,
  REGISTRY_SPREADSHEET_ID,
  fetchRange,
  getCell,
  getGoogleClientsForSpreadsheet,
  headerMap,
  toValuesApiRange
});

const governedPolicyValue = (policies = [], key = "", fallback = "") =>
  governedPolicyValueCore(policies, key, fallback);

const governedPolicyEnabled = (policies = [], key = "", fallback = false) =>
  governedPolicyEnabledCore(policies, key, fallback);

const readRelevantExistingRowWindow = async (
  spreadsheetId,
  sheetName,
  scanRangeA1 = "A:Z"
) => readRelevantExistingRowWindowCore(
  spreadsheetId,
  sheetName,
  scanRangeA1,
  {
    getGoogleClientsForSpreadsheet,
    headerMap,
    toValuesApiRange
  }
);

const normalizeSemanticValue = value => normalizeSemanticValueCore(value);

const findSemanticDuplicateRows = (header = [], rows = [], rowObject = {}) =>
  findSemanticDuplicateRowsCore(header, rows, rowObject);

async function updateSheetRowGoverned(
  sheets,
  spreadsheetId,
  sheetName,
  header,
  safeColumns,
  rowObject,
  targetRowNumber,
  preflight = null
) {
  return updateSheetRowGovernedCore(
    {
      sheets,
      spreadsheetId,
      sheetName,
      header,
      safeColumns,
      rowObject,
      targetRowNumber,
      preflight
    },
    {
      toSheetCellValue
    }
  );
}

async function deleteSheetRowGoverned(
  sheets,
  spreadsheetId,
  sheetName,
  targetRowNumber,
  preflight = null
) {
  return deleteSheetRowGovernedCore({
    sheets,
    spreadsheetId,
    sheetName,
    targetRowNumber,
    preflight
  });
}

async function performGovernedSheetMutation(args = {}) {
  return performGovernedSheetMutationCore(args, {
    enforceGovernedMutationPreflight,
    executionLogUnifiedColumns: EXECUTION_LOG_UNIFIED_COLUMNS,
    executionLogUnifiedRawWritebackColumns: EXECUTION_LOG_UNIFIED_RAW_WRITEBACK_COLUMNS,
    executionLogUnifiedRawWritebackEndColumn: EXECUTION_LOG_UNIFIED_RAW_WRITEBACK_END_COLUMN,
    executionLogUnifiedRawWritebackStartColumn: EXECUTION_LOG_UNIFIED_RAW_WRITEBACK_START_COLUMN,
    executionLogUnifiedSheetName: EXECUTION_LOG_UNIFIED_SHEET,
    findSemanticDuplicateRows,
    getGoogleClientsForSpreadsheet,
    governedPolicyEnabled,
    highRiskGovernedSheets: HIGH_RISK_GOVERNED_SHEETS,
    loadLiveGovernedChangeControlPolicies,
    readRelevantExistingRowWindow,
    toA1Start,
    toSheetCellValue,
    toValuesApiRange
  });
}

async function appendSheetRowGoverned(
  sheets,
  spreadsheetId,
  sheetName,
  header,
  safeColumns,
  rowObject,
  preflight = null
) {
  return appendSheetRowGovernedCore(
    {
      sheets,
      spreadsheetId,
      sheetName,
      header,
      safeColumns,
      rowObject,
      preflight
    },
    {
      toA1Start,
      toSheetCellValue
    }
  );
}

async function appendExecutionLogUnifiedRowGoverned(
  sheets,
  spreadsheetId,
  sheetName,
  header,
  rowObject,
  preflight = null
) {
  return appendExecutionLogUnifiedRowGovernedCore(
    {
      sheets,
      spreadsheetId,
      sheetName,
      header,
      rowObject,
      preflight
    },
    {
      executionLogUnifiedColumns: EXECUTION_LOG_UNIFIED_COLUMNS,
      executionLogUnifiedRawWritebackColumns: EXECUTION_LOG_UNIFIED_RAW_WRITEBACK_COLUMNS,
      executionLogUnifiedRawWritebackEndColumn: EXECUTION_LOG_UNIFIED_RAW_WRITEBACK_END_COLUMN,
      executionLogUnifiedRawWritebackStartColumn: EXECUTION_LOG_UNIFIED_RAW_WRITEBACK_START_COLUMN,
      toA1Start,
      toSheetCellValue,
      toValuesApiRange
    }
  );
}

async function loadBrandRegistry(sheets) {
  return loadBrandRegistryCore(sheets, {
    BRAND_REGISTRY_SHEET,
    REGISTRY_SPREADSHEET_ID,
    getCell,
    headerMap,
    registryError
  });
}

async function loadHostingAccountRegistry(sheets) {
  return loadHostingAccountRegistryCore(sheets, {
    HOSTING_ACCOUNT_REGISTRY_COLUMNS,
    HOSTING_ACCOUNT_REGISTRY_SHEET,
    REGISTRY_SPREADSHEET_ID,
    getCell,
    headerMap,
    registryError
  });
}

async function loadActionsRegistry(sheets) {
  return loadActionsRegistryCore(sheets, {
    ACTIONS_REGISTRY_SHEET,
    REGISTRY_SPREADSHEET_ID,
    getCell,
    headerMap,
    registryError
  });
}

async function loadEndpointRegistry(sheets) {
  return loadEndpointRegistryCore(sheets, {
    ENDPOINT_REGISTRY_SHEET,
    REGISTRY_SPREADSHEET_ID,
    debugLog,
    getCell,
    headerMap,
    registryError
  });
}

async function loadExecutionPolicies(sheets) {
  return loadExecutionPoliciesCore(sheets, {
    EXECUTION_POLICY_SHEET,
    REGISTRY_SPREADSHEET_ID,
    boolFromSheet,
    getCell,
    headerMap,
    registryError
  });
}

async function readExecutionPolicyRegistryLive() {
  return readExecutionPolicyRegistryLiveCore({
    EXECUTION_POLICY_SHEET,
    REGISTRY_SPREADSHEET_ID,
    getGoogleClientsForSpreadsheet,
    headerMap,
    registryError,
    toValuesApiRange
  });
}

function buildExecutionPolicyRow(input = {}) {
  return buildExecutionPolicyRowCore(input);
}

function findExecutionPolicyRowNumber(header = [], rows = [], input = {}) {
  return findExecutionPolicyRowNumberCore(header, rows, input);
}

async function writeExecutionPolicyRow(input = {}) {
  return writeExecutionPolicyRowCore(input, {
    EXECUTION_POLICY_SHEET,
    REGISTRY_SPREADSHEET_ID,
    buildExecutionPolicyRow,
    performGovernedSheetMutation,
    readExecutionPolicyRegistryLive
  });
}

async function updateExecutionPolicyRow(input = {}) {
  return updateExecutionPolicyRowCore(input, {
    EXECUTION_POLICY_SHEET,
    REGISTRY_SPREADSHEET_ID,
    buildExecutionPolicyRow,
    findExecutionPolicyRowNumber,
    performGovernedSheetMutation,
    readExecutionPolicyRegistryLive
  });
}

async function deleteExecutionPolicyRow(input = {}) {
  return deleteExecutionPolicyRowCore(input, {
    EXECUTION_POLICY_SHEET,
    REGISTRY_SPREADSHEET_ID,
    buildExecutionPolicyRow,
    findExecutionPolicyRowNumber,
    performGovernedSheetMutation,
    readExecutionPolicyRegistryLive
  });
}

async function readTaskRoutesLive() {
  return readTaskRoutesLiveCore({
    REGISTRY_SPREADSHEET_ID,
    TASK_ROUTES_SHEET,
    getGoogleClientsForSpreadsheet,
    headerMap,
    registryError,
    toValuesApiRange
  });
}

function buildTaskRouteRow(input = {}) {
  return buildTaskRouteRowCore(input, { TASK_ROUTES_CANONICAL_COLUMNS });
}

function findTaskRouteRowNumber(header = [], rows = [], input = {}) {
  return findTaskRouteRowNumberCore(header, rows, input);
}

async function writeTaskRouteRow(input = {}) {
  return writeTaskRouteRowCore(input, {
    REGISTRY_SPREADSHEET_ID,
    TASK_ROUTES_CANONICAL_COLUMNS,
    TASK_ROUTES_SHEET,
    getGoogleClientsForSpreadsheet,
    headerMap,
    performGovernedSheetMutation,
    registryError,
    toValuesApiRange
  });
}

async function updateTaskRouteRow(input = {}) {
  return updateTaskRouteRowCore(input, {
    REGISTRY_SPREADSHEET_ID,
    TASK_ROUTES_CANONICAL_COLUMNS,
    TASK_ROUTES_SHEET,
    getGoogleClientsForSpreadsheet,
    headerMap,
    performGovernedSheetMutation,
    registryError,
    toValuesApiRange
  });
}

async function deleteTaskRouteRow(input = {}) {
  return deleteTaskRouteRowCore(input, {
    REGISTRY_SPREADSHEET_ID,
    TASK_ROUTES_CANONICAL_COLUMNS,
    TASK_ROUTES_SHEET,
    getGoogleClientsForSpreadsheet,
    headerMap,
    performGovernedSheetMutation,
    registryError,
    toValuesApiRange
  });
}

async function readWorkflowRegistryLive() {
  return readWorkflowRegistryLiveCore({
    REGISTRY_SPREADSHEET_ID,
    WORKFLOW_REGISTRY_SHEET,
    getGoogleClientsForSpreadsheet,
    headerMap,
    registryError,
    toValuesApiRange
  });
}

function buildWorkflowRegistryRow(input = {}) {
  return buildWorkflowRegistryRowCore(input, { WORKFLOW_REGISTRY_CANONICAL_COLUMNS });
}

function findWorkflowRegistryRowNumber(header = [], rows = [], input = {}) {
  return findWorkflowRegistryRowNumberCore(header, rows, input);
}

async function writeWorkflowRegistryRow(input = {}) {
  return writeWorkflowRegistryRowCore(input, {
    REGISTRY_SPREADSHEET_ID,
    WORKFLOW_REGISTRY_CANONICAL_COLUMNS,
    WORKFLOW_REGISTRY_SHEET,
    getGoogleClientsForSpreadsheet,
    headerMap,
    performGovernedSheetMutation,
    registryError,
    toValuesApiRange
  });
}

async function updateWorkflowRegistryRow(input = {}) {
  return updateWorkflowRegistryRowCore(input, {
    REGISTRY_SPREADSHEET_ID,
    WORKFLOW_REGISTRY_CANONICAL_COLUMNS,
    WORKFLOW_REGISTRY_SHEET,
    getGoogleClientsForSpreadsheet,
    headerMap,
    performGovernedSheetMutation,
    registryError,
    toValuesApiRange
  });
}

async function deleteWorkflowRegistryRow(input = {}) {
  return deleteWorkflowRegistryRowCore(input, {
    REGISTRY_SPREADSHEET_ID,
    WORKFLOW_REGISTRY_CANONICAL_COLUMNS,
    WORKFLOW_REGISTRY_SHEET,
    getGoogleClientsForSpreadsheet,
    headerMap,
    performGovernedSheetMutation,
    registryError,
    toValuesApiRange
  });
}

async function readRegistrySurfacesCatalogLive() {
  return readRegistrySurfacesCatalogLiveCore({
    REGISTRY_SPREADSHEET_ID,
    REGISTRY_SURFACES_CATALOG_SHEET,
    getGoogleClientsForSpreadsheet,
    headerMap,
    registryError,
    toValuesApiRange
  });
}

function buildRegistrySurfaceCatalogRow(input = {}) {
  return buildRegistrySurfaceCatalogRowCore(input);
}

function findRegistrySurfaceCatalogRowNumber(header = [], rows = [], input = {}) {
  return findRegistrySurfaceCatalogRowNumberCore(header, rows, input);
}

async function writeRegistrySurfaceCatalogRow(input = {}) {
  return writeRegistrySurfaceCatalogRowCore(input, {
    REGISTRY_SPREADSHEET_ID,
    REGISTRY_SURFACES_CATALOG_SHEET,
    getGoogleClientsForSpreadsheet,
    headerMap,
    performGovernedSheetMutation,
    registryError,
    toValuesApiRange
  });
}

async function updateRegistrySurfaceCatalogRow(input = {}) {
  return updateRegistrySurfaceCatalogRowCore(input, {
    REGISTRY_SPREADSHEET_ID,
    REGISTRY_SURFACES_CATALOG_SHEET,
    getGoogleClientsForSpreadsheet,
    headerMap,
    performGovernedSheetMutation,
    registryError,
    toValuesApiRange
  });
}

async function deleteRegistrySurfaceCatalogRow(input = {}) {
  return deleteRegistrySurfaceCatalogRowCore(input, {
    REGISTRY_SPREADSHEET_ID,
    REGISTRY_SURFACES_CATALOG_SHEET,
    getGoogleClientsForSpreadsheet,
    headerMap,
    performGovernedSheetMutation,
    registryError,
    toValuesApiRange
  });
}

async function readValidationRepairRegistryLive() {
  return readValidationRepairRegistryLiveCore({
    REGISTRY_SPREADSHEET_ID,
    VALIDATION_REPAIR_REGISTRY_SHEET,
    getGoogleClientsForSpreadsheet,
    headerMap,
    registryError,
    toValuesApiRange
  });
}

function buildValidationRepairRegistryRow(input = {}) {
  return buildValidationRepairRegistryRowCore(input);
}

function findValidationRepairRegistryRowNumber(header = [], rows = [], input = {}) {
  return findValidationRepairRegistryRowNumberCore(header, rows, input);
}

async function writeValidationRepairRegistryRow(input = {}) {
  return writeValidationRepairRegistryRowCore(input, {
    REGISTRY_SPREADSHEET_ID,
    VALIDATION_REPAIR_REGISTRY_SHEET,
    getGoogleClientsForSpreadsheet,
    headerMap,
    performGovernedSheetMutation,
    registryError,
    toValuesApiRange
  });
}

async function updateValidationRepairRegistryRow(input = {}) {
  return updateValidationRepairRegistryRowCore(input, {
    REGISTRY_SPREADSHEET_ID,
    VALIDATION_REPAIR_REGISTRY_SHEET,
    getGoogleClientsForSpreadsheet,
    headerMap,
    performGovernedSheetMutation,
    registryError,
    toValuesApiRange
  });
}

async function deleteValidationRepairRegistryRow(input = {}) {
  return deleteValidationRepairRegistryRowCore(input, {
    REGISTRY_SPREADSHEET_ID,
    VALIDATION_REPAIR_REGISTRY_SHEET,
    getGoogleClientsForSpreadsheet,
    headerMap,
    performGovernedSheetMutation,
    registryError,
    toValuesApiRange
  });
}

async function readActionsRegistryLive() {
  return readActionsRegistryLiveCore({
    REGISTRY_SPREADSHEET_ID,
    ACTIONS_REGISTRY_SHEET,
    getGoogleClientsForSpreadsheet,
    headerMap,
    registryError,
    toValuesApiRange
  });
}

function buildActionsRegistryRow(input = {}) {
  return buildActionsRegistryRowCore(input);
}

function findActionsRegistryRowNumber(header = [], rows = [], input = {}) {
  return findActionsRegistryRowNumberCore(header, rows, input);
}

async function writeActionsRegistryRow(input = {}) {
  return writeActionsRegistryRowCore(input, {
    ACTIONS_REGISTRY_SHEET,
    REGISTRY_SPREADSHEET_ID,
    getGoogleClientsForSpreadsheet,
    headerMap,
    performGovernedSheetMutation,
    registryError,
    toValuesApiRange
  });
}

async function updateActionsRegistryRow(input = {}) {
  return updateActionsRegistryRowCore(input, {
    ACTIONS_REGISTRY_SHEET,
    REGISTRY_SPREADSHEET_ID,
    getGoogleClientsForSpreadsheet,
    headerMap,
    performGovernedSheetMutation,
    registryError,
    toValuesApiRange
  });
}

async function deleteActionsRegistryRow(input = {}) {
  return deleteActionsRegistryRowCore(input, {
    ACTIONS_REGISTRY_SHEET,
    REGISTRY_SPREADSHEET_ID,
    getGoogleClientsForSpreadsheet,
    headerMap,
    performGovernedSheetMutation,
    registryError,
    toValuesApiRange
  });
}

async function fetchFromGoogleSheets() {
  const { sheets, drive } = await getGoogleClients();
  const [
    brandRows,
    hostingAccounts,
    actionRows,
    endpointRows,
    policies,
    siteRuntimeInventoryRows,
    siteSettingsInventoryRows,
    pluginInventoryRows,
    taskRouteRows,
    workflowRows
  ] = await Promise.all([
    loadBrandRegistry(sheets),
    loadHostingAccountRegistry(sheets),
    loadActionsRegistry(sheets),
    loadEndpointRegistry(sheets),
    loadExecutionPolicies(sheets),
    loadSiteRuntimeInventoryRegistry(sheets).catch(() => []),
    loadSiteSettingsInventoryRegistry(sheets).catch(() => []),
    loadPluginInventoryRegistry(sheets).catch(() => []),
    loadTaskRoutesRegistry(sheets).catch(() => []),
    loadWorkflowRegistry(sheets).catch(() => [])
  ]);

  return {
    drive,
    brandRows,
    hostingAccounts,
    actionRows,
    endpointRows,
    policies,
    siteRuntimeInventoryRows,
    siteSettingsInventoryRows,
    pluginInventoryRows,
    taskRouteRows,
    workflowRows
  };
}

async function getRegistry() {
  return await fetchFromGoogleSheets();
}

async function reloadRegistry() {
  return await fetchFromGoogleSheets();
}

function registryError(name) {
  const err = new Error(`${name} sheet is empty or unreadable.`);
  err.code = "registry_unavailable";
  err.status = 500;
  return err;
}

function policyValue(policies, group, key, fallback = "") {
  return policyValueCore(policies, group, key, fallback, { boolFromSheet });
}

function policyList(policies, group, key) {
  return policyListCore(policies, group, key, { boolFromSheet });
}

const mintGoogleAccessTokenForEndpoint = args => mintGoogleAccessTokenForEndpointCore(args);
const requirePolicyTrue = (p, g, k, m) => requirePolicyTrueCore(p, g, k, m);
const requirePolicySet = (p, g, k) => requirePolicySetCore(p, g, k);
const getRequiredHttpExecutionPolicyKeys = p => getRequiredHttpExecutionPolicyKeysCore(p);
const buildMissingRequiredPolicyError = (p, m) => buildMissingRequiredPolicyErrorCore(p, m);
const resilienceAppliesToParentAction = (p, k) => resilienceAppliesToParentActionCore(p, k);
const shouldRetryProviderResponse = (p, s, t) => shouldRetryProviderResponseCore(p, s, t);
const buildProviderRetryMutations = (p, k) => buildProviderRetryMutationsCore(p, k);

async function executeUpstreamAttempt({
  requestUrl,
  requestInit
}) {
  const upstream = await fetch(requestUrl, requestInit);

  const contentType = upstream.headers.get("content-type") || "";
  let data;
  let responseText = "";

  if (contentType.includes("application/json")) {
    data = await upstream.json();
    responseText = JSON.stringify(data);
  } else {
    data = await upstream.text();
    responseText = String(data || "");
  }

  const responseHeaders = {};
  upstream.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  return {
    upstream,
    data,
    responseText,
    responseHeaders,
    contentType
  };
}

// Brand resolution must use the normalized execution payload,
// not raw req.body, so all routing/governance uses one canonical request shape.
function resolveBrand(rows, requestPayload = {}) {
  return resolveBrandCore(rows, requestPayload, {
    boolFromSheet,
    jsonParseSafe,
    normalizeProviderDomain,
    safeNormalizeProviderDomain
  });
}

function resolveAction(rows, parentActionKey) {
  return resolveActionCore(rows, parentActionKey, { debugLog });
}

function resolveEndpoint(rows, parentActionKey, endpointKey) {
  return resolveEndpointCore(rows, parentActionKey, endpointKey, {
    boolFromSheet,
    debugLog
  });
}

function isDelegatedTransportTarget(endpoint = {}) {
  return isDelegatedTransportTargetCore(endpoint, { boolFromSheet });
}

function getEndpointExecutionSnapshot(endpoint = {}) {
  return getEndpointExecutionSnapshotCore(endpoint, { boolFromSheet });
}

function requireRuntimeCallableAction(policies, action, endpoint) {
  return requireRuntimeCallableActionCore(policies, action, endpoint, {
    boolFromSheet
  });
}

function requireEndpointExecutionEligibility(policies, endpoint) {
  return requireEndpointExecutionEligibilityCore(policies, endpoint, {
    boolFromSheet,
    debugLog
  });
}

function requireExecutionModeCompatibility(action, endpoint) {
  return requireExecutionModeCompatibilityCore(action, endpoint);
}

function requireNativeFamilyBoundary(policies, action, endpoint) {
  return requireNativeFamilyBoundaryCore(policies, action, endpoint, {
    boolFromSheet
  });
}

function requireTransportIfDelegated(policies, action, endpoint) {
  return requireTransportIfDelegatedCore(policies, action, endpoint, {
    boolFromSheet
  });
}

function requireNoFallbackDirectExecution(policies, endpoint) {
  return requireNoFallbackDirectExecutionCore(policies, endpoint, {
    boolFromSheet
  });
}

function getPlaceholderResolutionSources(policies = []) {
  return getPlaceholderResolutionSourcesCore(policies, { boolFromSheet });
}

function resolveProviderDomain({
  requestedProviderDomain,
  endpoint,
  brand,
  parentActionKey,
  policies = [],
  requestBody = {}
}) {
  return resolveProviderDomainCore(
    {
      requestedProviderDomain,
      endpoint,
      brand,
      parentActionKey,
      policies,
      requestBody
    },
    {
      boolFromSheet,
      debugLog,
      isVariablePlaceholder,
      normalizeEndpointProviderDomain,
      normalizeProviderDomain,
      port,
      safeNormalizeProviderDomain
    }
  );
}

function isOAuthConfigured(action) {
  return isOAuthConfiguredCore(action);
}

function inferAuthMode({ action, brand }) {
  return inferAuthModeCore({ action, brand });
}

function normalizeAuthContract(args) { return normalizeAuthContractCore(args); }
function findHostingAccountByKey(h, k) { return findHostingAccountByKeyCore(h, k); }
function resolveAccountKeyFromBrand(b) { return resolveAccountKeyFromBrandCore(b); }
function resolveAccountKey(args) { return resolveAccountKeyCore(args); }
function resolveSecretFromReference(r) { return resolveSecretFromReferenceCore(r); }
function isGoogleApiHost(d) { return isGoogleApiHostCore(d); }
function getAdditionalStaticAuthHeaders(a, c) { return getAdditionalStaticAuthHeadersCore(a, c); }
function enforceSupportedAuthMode(p, m) { return enforceSupportedAuthModeCore(p, m); }

function pathTemplateToRegex(t) { return pathTemplateToRegexCore(t); }
function ensureMethodAndPathMatchEndpoint(e, m, p, pp) { return ensureMethodAndPathMatchEndpointCore(e, m, p, pp); }

async function fetchSchemaContract(drive, fileId) { return fetchSchemaContractCore(drive, fileId); }

function resolveSchemaOperation(schema, method, path) {
  return resolveSchemaOperationCore(schema, method, path, { pathTemplateToRegex });
}

function validateByJsonSchema(schema, value, scope, pathPrefix = "") {
  return validateByJsonSchemaCore(schema, value, scope, pathPrefix);
}

function validateParameters(operation, request) {
  return validateParametersCore(operation, request);
}

function validateRequestBody(operation, body) {
  return validateRequestBodyCore(operation, body);
}

function classifySchemaDrift(expected, actual, scope) {
  return classifySchemaDriftCore(expected, actual, scope);
}

function buildResolvedAuthHeaders(contract) {
  return buildResolvedAuthHeadersCore(contract);
}

function injectAuthIntoQuery(query, contract) {
  return injectAuthIntoQueryCore(query, contract);
}

function injectAuthIntoHeaders(headers, contract) {
  return injectAuthIntoHeadersCore(headers, contract);
}

function injectAuthForSchemaValidation(query, headers, contract) {
  return injectAuthForSchemaValidationCore(query, headers, contract);
}

function ensureWritePermissions(brand, method) {
  if (brand && ["POST", "PUT", "PATCH"].includes(method) && !boolFromSheet(brand.write_allowed)) {
    const err = new Error(`Write operations are not allowed for ${brand.brand_name || brand.base_url}.`);
    err.code = "method_not_allowed";
    err.status = 403;
    throw err;
  }

  if (method === "DELETE") {
    if (brand && boolFromSheet(brand.destructive_allowed)) return;
    const err = new Error("DELETE is not allowed for this target.");
    err.code = "method_not_allowed";
    err.status = 403;
    throw err;
  }
}


const nowIso = () => nowIsoCore();
const normalizeJobStatus = v => normalizeJobStatusCore(v);
const normalizeWebhookUrl = v => normalizeWebhookUrlCore(v);
const normalizeMaxAttempts = v => normalizeMaxAttemptsCore(v);
const buildJobId = () => buildJobIdCore();
const resolveRequestedBy = req => resolveRequestedByCore(req);
const makeIdempotencyLookupKey = (r, k) => makeIdempotencyLookupKeyCore(r, k);
const buildExecutionPayloadFromJobRequest = b => buildExecutionPayloadFromJobRequestCore(b);

const validateAsyncJobRequest = p => validateAsyncJobRequestCore(p);



function createHttpError(code, message, status = 400, details) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (details !== undefined) err.details = details;
  return err;
}

function buildRecordFromHeaderAndRow(header = [], row = []) {
  return buildRecordFromHeaderAndRowCore(header, row);
}

function buildSheetRowFromColumns(columns = [], row = {}) {
  return buildSheetRowFromColumnsCore(columns, row, { toSheetCellValue });
}

function assertCanonicalHeaderExact(header = [], expected = [], sheetName = "sheet") {
  return assertCanonicalHeaderExactCore(header, expected, sheetName);
}

function blockLegacyRouteWorkflowWrite(surfaceName = "", requestedColumns = []) {
  return blockLegacyRouteWorkflowWriteCore(surfaceName, requestedColumns, {
    TASK_ROUTES_CANONICAL_COLUMNS,
    TASK_ROUTES_SHEET,
    WORKFLOW_REGISTRY_CANONICAL_COLUMNS,
    WORKFLOW_REGISTRY_SHEET
  });
}

function assertNoLegacySiteMigrationScaffolding() {
  return assertNoLegacySiteMigrationScaffoldingCore({
    siteMigrationTaskRouteColumnsDefined: typeof SITE_MIGRATION_TASK_ROUTE_COLUMNS !== "undefined",
    siteMigrationWorkflowColumnsDefined: typeof SITE_MIGRATION_WORKFLOW_COLUMNS !== "undefined",
    siteMigrationTaskRouteRowsDefined: typeof SITE_MIGRATION_TASK_ROUTE_ROWS !== "undefined",
    siteMigrationWorkflowRowsDefined: typeof SITE_MIGRATION_WORKFLOW_ROWS !== "undefined"
  });
}

function assertSingleActiveRowByKey(rows = [], keyName = "", activeName = "active", sheetName = "sheet") {
  return assertSingleActiveRowByKeyCore(rows, keyName, activeName, sheetName);
}

function normalizeGovernedAdditionState(value = "") {
  return normalizeGovernedAdditionStateCore(value, { GOVERNED_ADDITION_STATES });
}

function normalizeGovernedAdditionOutcome(value = "") {
  return normalizeGovernedAdditionOutcomeCore(value, { GOVERNED_ADDITION_OUTCOMES });
}

function governedAdditionStateBlocksAuthority(value = "") {
  return governedAdditionStateBlocksAuthorityCore(value, { GOVERNED_ADDITION_STATES });
}

function hasDeferredGovernedActivationDependencies(row = {}, keys = []) {
  return hasDeferredGovernedActivationDependenciesCore(row, keys, { boolFromSheet });
}

function buildGovernedAdditionReviewResult(args = {}) {
  return buildGovernedAdditionReviewResultCore(args, {
    GOVERNED_ADDITION_OUTCOMES,
    GOVERNED_ADDITION_STATES
  });
}

function assertNoDirectActivationWithoutGovernedReview(row = {}, surfaceName = "sheet") {
  return assertNoDirectActivationWithoutGovernedReviewCore(row, surfaceName, {
    GOVERNED_ADDITION_STATES
  });
}

async function getSpreadsheetSheetMap(sheets, spreadsheetId) {
  return getSpreadsheetSheetMapCore(sheets, spreadsheetId);
}

async function ensureSheetWithHeader(sheets, spreadsheetId, sheetName, columns) {
  return ensureSheetWithHeaderCore(sheets, spreadsheetId, sheetName, columns, {
    TASK_ROUTES_CANONICAL_COLUMNS,
    TASK_ROUTES_SHEET,
    WORKFLOW_REGISTRY_CANONICAL_COLUMNS,
    WORKFLOW_REGISTRY_SHEET,
    computeHeaderSignature,
    toValuesApiRange
  });
}

async function appendRowsIfMissingByKeys(
  sheets,
  spreadsheetId,
  sheetName,
  columns,
  keyColumns,
  rows = []
) {
  return appendRowsIfMissingByKeysCore(
    sheets,
    spreadsheetId,
    sheetName,
    columns,
    keyColumns,
    rows,
    {
      TASK_ROUTES_CANONICAL_COLUMNS,
      TASK_ROUTES_SHEET,
      WORKFLOW_REGISTRY_CANONICAL_COLUMNS,
      WORKFLOW_REGISTRY_SHEET,
      GOVERNED_ADDITION_STATES,
      toA1Start,
      toSheetCellValue,
      toValuesApiRange
    }
  );
}

async function ensureSiteMigrationRegistrySurfaces() {
  return ensureSiteMigrationRegistrySurfacesCore({
    REGISTRY_SPREADSHEET_ID,
    PLUGIN_INVENTORY_REGISTRY_SHEET,
    SITE_RUNTIME_INVENTORY_REGISTRY_SHEET,
    SITE_SETTINGS_INVENTORY_REGISTRY_SHEET,
    TASK_ROUTES_CANONICAL_COLUMNS,
    TASK_ROUTES_SHEET,
    WORKFLOW_REGISTRY_CANONICAL_COLUMNS,
    WORKFLOW_REGISTRY_SHEET,
    assertHeaderMatchesSurfaceMetadata,
    assertSheetExistsInSpreadsheet,
    getCanonicalSurfaceMetadata,
    readLiveSheetShape,
    toValuesApiRange,
    siteMigrationTaskRouteColumnsDefined: typeof SITE_MIGRATION_TASK_ROUTE_COLUMNS !== "undefined",
    siteMigrationWorkflowColumnsDefined: typeof SITE_MIGRATION_WORKFLOW_COLUMNS !== "undefined",
    siteMigrationTaskRouteRowsDefined: typeof SITE_MIGRATION_TASK_ROUTE_ROWS !== "undefined",
    siteMigrationWorkflowRowsDefined: typeof SITE_MIGRATION_WORKFLOW_ROWS !== "undefined"
  });
}

async function ensureSiteMigrationRouteWorkflowRows() {
  return ensureSiteMigrationRouteWorkflowRowsCore({
    REGISTRY_SPREADSHEET_ID,
    REQUIRED_SITE_MIGRATION_TASK_KEYS,
    REQUIRED_SITE_MIGRATION_WORKFLOW_IDS,
    GOVERNED_ADDITION_OUTCOMES,
    GOVERNED_ADDITION_STATES,
    TASK_ROUTES_CANONICAL_COLUMNS,
    TASK_ROUTES_SHEET,
    WORKFLOW_REGISTRY_CANONICAL_COLUMNS,
    WORKFLOW_REGISTRY_SHEET,
    assertHeaderMatchesSurfaceMetadata,
    boolFromSheet,
    getCanonicalSurfaceMetadata,
    getGoogleClients,
    loadTaskRoutesRegistry,
    loadWorkflowRegistry,
    readLiveSheetShape,
    toValuesApiRange,
    siteMigrationTaskRouteColumnsDefined: typeof SITE_MIGRATION_TASK_ROUTE_COLUMNS !== "undefined",
    siteMigrationWorkflowColumnsDefined: typeof SITE_MIGRATION_WORKFLOW_COLUMNS !== "undefined",
    siteMigrationTaskRouteRowsDefined: typeof SITE_MIGRATION_TASK_ROUTE_ROWS !== "undefined",
    siteMigrationWorkflowRowsDefined: typeof SITE_MIGRATION_WORKFLOW_ROWS !== "undefined"
  });
}

async function loadSiteRuntimeInventoryRegistry(s) { return loadSiteRuntimeInventoryRegistryCore(s); }
async function loadSiteSettingsInventoryRegistry(s) { return loadSiteSettingsInventoryRegistryCore(s); }
async function loadPluginInventoryRegistry(s) { return loadPluginInventoryRegistryCore(s); }

async function loadTaskRoutesRegistry(sheets, options = {}) {
  return loadTaskRoutesRegistryCore(sheets, options, {
    REGISTRY_SPREADSHEET_ID,
    TASK_ROUTES_CANONICAL_COLUMNS,
    TASK_ROUTES_SHEET,
    assertHeaderMatchesSurfaceMetadata,
    assertSingleActiveRowByKey,
    fetchRange,
    getCanonicalSurfaceMetadata,
    getCell,
    governedAdditionStateBlocksAuthority,
    hasDeferredGovernedActivationDependencies,
    headerMap,
    normalizeGovernedAdditionState,
    readLiveSheetShape,
    registryError,
    toValuesApiRange
  });
}

async function loadWorkflowRegistry(sheets, options = {}) {
  return loadWorkflowRegistryCore(sheets, options, {
    REGISTRY_SPREADSHEET_ID,
    WORKFLOW_REGISTRY_CANONICAL_COLUMNS,
    WORKFLOW_REGISTRY_SHEET,
    assertHeaderMatchesSurfaceMetadata,
    assertSingleActiveRowByKey,
    fetchRange,
    getCanonicalSurfaceMetadata,
    getCell,
    governedAdditionStateBlocksAuthority,
    hasDeferredGovernedActivationDependencies,
    headerMap,
    normalizeGovernedAdditionState,
    readLiveSheetShape,
    registryError,
    toValuesApiRange
  });
}

async function readGovernedSheetRecords(sheetName, spreadsheetId = REGISTRY_SPREADSHEET_ID) {
  return readGovernedSheetRecordsCore(sheetName, spreadsheetId, {
    REGISTRY_SPREADSHEET_ID,
    assertSheetExistsInSpreadsheet,
    createHttpError,
    getGoogleClientsForSpreadsheet,
    headerMap,
    toValuesApiRange
  });
}

function normalizeLooseHostname(value = "") {
  return normalizeLooseHostnameCore(value);
}

function findRegistryRecordByIdentity(rows = [], identity = {}) {
  return findRegistryRecordByIdentityCore(rows, identity);
}

async function resolveBrandRegistryBinding(identity = {}) {
  return resolveBrandRegistryBindingCore(identity, {
    BRAND_REGISTRY_SHEET,
    REGISTRY_SPREADSHEET_ID,
    createHttpError,
    firstPopulated,
    assertSheetExistsInSpreadsheet,
    getGoogleClientsForSpreadsheet,
    headerMap,
    toValuesApiRange
  });
}

async function hostingerSshRuntimeRead({ input = {} }) {
  return hostingerSshRuntimeReadCore(
    { input },
    {
      REGISTRY_SPREADSHEET_ID,
      HOSTING_ACCOUNT_REGISTRY_RANGE,
      HOSTING_ACCOUNT_REGISTRY_SHEET,
      asBool,
      getGoogleClientsForSpreadsheet,
      matchesHostingerSshTarget,
      rowToObject
    }
  );
}


const siteMigrationTransports = {
  wordpress_connector: runWordpressConnectorMigration,
  ssh_wpcli: runSshWpCliMigration,
  hybrid_wordpress: runHybridWordpressMigration
};




app.get("/health", async (_req, res) => {
  const counts = {
    queued: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    retrying: 0,
    cancelled: 0
  };
  for (const job of jobRepository.values()) {
    const status = normalizeJobStatus(job.status);
    if (Object.prototype.hasOwnProperty.call(counts, status)) {
      counts[status] += 1;
    }
  }

  const queueHealth = await getWaitingCountSafe();
  const redisHealth = getRedisRuntimeStatus();
  const dependencyStatus = redisHealth.connected && queueHealth.ok ? "healthy" : "degraded";

  res.json({
    ok: true,
    service: "http_generic_api_connector",
    status: dependencyStatus,
    version: SERVICE_VERSION,
    jobs: {
      total: jobRepository.size(),
      queued_buffer_size: queueHealth.count,
      statuses: counts
    },
    dependencies: {
      redis: redisHealth,
      queue: queueHealth.ok
        ? { connected: true }
        : {
            connected: false,
            error: queueHealth.error
          },
      worker: {
        enabled: QUEUE_WORKER_ENABLED
      }
    },
    timestamp: new Date().toISOString()
  });
});

app.post("/hostinger/ssh-runtime-read", requireBackendApiKey, async (req, res) => {
  try {
    const result = await hostingerSshRuntimeRead({
      input: req.body || {}
    });

    return res.status(result.ok ? 200 : 404).json(result);
  } catch (err) {
    return res.status(err.status || 500).json({
      ok: false,
      error: {
        code: err.code || "hostinger_ssh_runtime_read_failed",
        message: err.message || "Hostinger SSH runtime read failed."
      }
    });
  }
});

app.post("/governed-addition/review", requireBackendApiKey, async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const result = buildGovernedAdditionReviewResult({
      outcome: body.outcome || "pending_validation",
      addition_state: body.addition_state || "pending_validation",
      route_overlap_detected: body.route_overlap_detected,
      workflow_overlap_detected: body.workflow_overlap_detected,
      chain_needed: body.chain_needed,
      graph_update_required: body.graph_update_required,
      bindings_update_required: body.bindings_update_required,
      policy_update_required: body.policy_update_required,
      starter_update_required: body.starter_update_required,
      reconciliation_required: body.reconciliation_required
    });

    return res.status(200).json({
      ok: true,
      review: result
    });
  } catch (err) {
    return res.status(err.status || 500).json({
      ok: false,
      error: {
        code: err.code || "governed_addition_review_failed",
        message: err.message || "Governed addition review failed."
      }
    });
  }
});



app.post("/site-migration/bootstrap-registry", requireBackendApiKey, async (_req, res) => {
  try {
    requireEnv("REGISTRY_SPREADSHEET_ID");

    const surfaces = await ensureSiteMigrationRegistrySurfaces();
    const rowResults = await ensureSiteMigrationRouteWorkflowRows();
    const readiness = {
      ok:
        !!rowResults.task_routes_ready &&
        !!rowResults.workflow_registry_ready &&
        String(rowResults.outcome || "").trim() === "reuse_existing",
      ...rowResults
    };

    if (!readiness.ok) {
      return res.status(409).json({
        ok: false,
        degraded: true,
        message: "Validation-only check complete: registry schemas are metadata-governed, but route/workflow readiness remains pending validation or degraded by dependencies.",
        surfaces,
        row_results: rowResults,
        readiness
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Validation-only check complete: site migration registry surfaces and live route/workflow authority are ready.",
      surfaces,
      row_results: rowResults,
      readiness
    });
  } catch (err) {
    if (String(err?.code || "").trim() === "sheet_schema_mismatch") {
      return res.status(409).json({
        ok: false,
        degraded: true,
        blocked: true,
        message: "Validation-only check failed: metadata-governed surface schema mismatch detected.",
        error: {
          code: err?.code || "sheet_schema_mismatch",
          message: err?.message || "Registry bootstrap surface schema validation failed.",
          details: err?.details || {}
        }
      });
    }
    return res.status(err?.status || 500).json({
      ok: false,
      error: {
        code: err?.code || "registry_bootstrap_failed",
        message: err?.message || "Registry bootstrap failed."
      }
    });
  }
});

app.post("/site-migrate", requireBackendApiKey, async (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const payload = normalizeSiteMigrationPayload(body);
  const validation = validateSiteMigrationPayload(payload);

  if (validation.errors.length) {
    return res.status(400).json({
      ok: false,
      error: {
        code: "invalid_site_migration_request",
        message: "Invalid site migration payload.",
        details: { errors: validation.errors }
      }
    });
  }

  const requestedBy = resolveRequestedBy(req);
  const idempotencyKey = String(
    body.idempotency_key || req.header("Idempotency-Key") || ""
  ).trim();
  const idempotencyLookupKey = makeIdempotencyLookupKey(
    requestedBy,
    idempotencyKey
  );

  if (idempotencyLookupKey && await idempotencyRepository.has(idempotencyLookupKey)) {
    const existingJobId = await idempotencyRepository.get(idempotencyLookupKey);
    const existingJob = getJob(existingJobId) || await getJobFromRedis(existingJobId);
    if (existingJob) {
      return res.status(200).json({
        ...toJobSummary(existingJob),
        deduplicated: true
      });
    }
    await idempotencyRepository.delete(idempotencyLookupKey);
  }

  const execution_trace_id =
    String(body.execution_trace_id || "").trim() || createExecutionTraceId();

  const job = createSiteMigrationJobRecord({
    payload: {
      ...payload,
      execution_trace_id
    },
    requestedBy,
    executionTraceId: execution_trace_id,
    maxAttempts: body.max_attempts,
    webhookUrl: body.webhook_url,
    callbackSecret: body.callback_secret,
    idempotencyKey
  });

  jobRepository.set(job);
  if (idempotencyLookupKey) {
    await idempotencyRepository.set(idempotencyLookupKey, job.job_id);
  }

  const enqueueResult = await enqueueJob(job.job_id);
  if (!enqueueResult?.ok) {
    const failure = await failAsyncSubmission(job, idempotencyLookupKey, enqueueResult);
    return res.status(503).json(failure);
  }

  return res.status(202).json({
    ...toJobSummary(job),
    route: "/site-migrate",
    execution_class: "migration"
  });
});

app.post("/jobs", requireBackendApiKey, async (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const hasNestedRequestPayload =
    body.request_payload &&
    typeof body.request_payload === "object" &&
    !Array.isArray(body.request_payload);

  const topLevelExecutionFields = [
    "target_key",
    "brand",
    "brand_domain",
    "provider_domain",
    "parent_action_key",
    "endpoint_key",
    "method",
    "path",
    "path_params",
    "query",
    "headers",
    "body",
    "expect_json",
    "timeout_seconds",
    "readback",
    "force_refresh"
  ];

  const hasTopLevelExecutionFields = topLevelExecutionFields.some(
    key => body[key] !== undefined
  );

  if (hasNestedRequestPayload && hasTopLevelExecutionFields) {
    return res.status(400).json({
      ok: false,
      error: {
        code: "invalid_job_request",
        message: "Job request is invalid.",
        details: {
          errors: [
            "Provide either request_payload or top-level execution fields, not both."
          ]
        }
      }
    });
  }

  const requestPayload = buildExecutionPayloadFromJobRequest(body);
  const requestedJobType = String(body.job_type || "http_execute").trim() || "http_execute";
  const validationErrors =
    requestedJobType === "site_migration"
      ? validateSiteMigrationPayload(normalizeSiteMigrationPayload(requestPayload)).errors
      : validateAsyncJobRequest(requestPayload);

  if (body.max_attempts !== undefined) {
    const maxAttempts = Number(body.max_attempts);
    if (!Number.isFinite(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
      validationErrors.push("max_attempts must be an integer between 1 and 10 when provided.");
    }
  }

  if (body.webhook_url !== undefined) {
    const normalizedWebhookUrl = normalizeWebhookUrl(body.webhook_url);
    if (String(body.webhook_url || "").trim() && !normalizedWebhookUrl) {
      validationErrors.push("webhook_url must be a valid http or https URL when provided.");
    }
  }

  if (body.callback_secret !== undefined && typeof body.callback_secret !== "string") {
    validationErrors.push("callback_secret must be a string when provided.");
  }

  if (body.idempotency_key !== undefined && typeof body.idempotency_key !== "string") {
    validationErrors.push("idempotency_key must be a string when provided.");
  }

  if (body.job_type !== undefined && typeof body.job_type !== "string") {
    validationErrors.push("job_type must be a string when provided.");
  }

  if (validationErrors.length) {
    return res.status(400).json({
      ok: false,
      error: {
        code: "invalid_job_request",
        message: "Job request is invalid.",
        details: { errors: validationErrors }
      }
    });
  }

  const requestedBy = resolveRequestedBy(req);
  const idempotencyKey = String(
    body.idempotency_key || req.header("Idempotency-Key") || ""
  ).trim();
  const idempotencyLookupKey = makeIdempotencyLookupKey(
    requestedBy,
    idempotencyKey
  );

  if (idempotencyLookupKey && await idempotencyRepository.has(idempotencyLookupKey)) {
    const existingJobId = await idempotencyRepository.get(idempotencyLookupKey);
    const existingJob = getJob(existingJobId) || await getJobFromRedis(existingJobId);
    if (existingJob) {
      return res.status(200).json({
        ...toJobSummary(existingJob),
        deduplicated: true
      });
    }
    await idempotencyRepository.delete(idempotencyLookupKey);
  }

  const createdAt = nowIso();
  const inboundExecutionTraceId = String(
    requestPayload.execution_trace_id || body.execution_trace_id || ""
  ).trim();
  const execution_trace_id = inboundExecutionTraceId || createExecutionTraceId();
  requestPayload.execution_trace_id = execution_trace_id;
  const normalizedJobType = String(body.job_type || "http_execute").trim() || "http_execute";
  const normalizedSiteMigrationPayload =
    normalizedJobType === "site_migration"
      ? normalizeSiteMigrationPayload(requestPayload)
      : null;

  const job = {
    job_id: buildJobId(),
    job_type: normalizedJobType,
    status: "queued",
    created_at: createdAt,
    updated_at: createdAt,
    completed_at: "",
    requested_by: requestedBy,
    target_key:
      normalizedJobType === "site_migration"
        ? String(
            normalizedSiteMigrationPayload?.destination?.target_key ||
              normalizedSiteMigrationPayload?.source?.target_key ||
              ""
          ).trim()
        : String(requestPayload.target_key || "").trim(),
    parent_action_key:
      normalizedJobType === "site_migration"
        ? "site_migration_controller"
        : String(requestPayload.parent_action_key || "").trim(),
    endpoint_key:
      normalizedJobType === "site_migration"
        ? "site_migrate"
        : String(requestPayload.endpoint_key || "").trim(),
    route_id:
      normalizedJobType === "site_migration"
        ? "site_migration"
        : String(requestPayload.route_id || "").trim(),
    target_module:
      normalizedJobType === "site_migration"
        ? "wordpress_site_migration"
        : String(requestPayload.target_module || "").trim(),
    target_workflow:
      normalizedJobType === "site_migration"
        ? "wf_wordpress_site_migration"
        : String(requestPayload.target_workflow || "").trim(),
    brand_name:
      normalizedJobType === "site_migration"
        ? String(
            normalizedSiteMigrationPayload?.destination?.brand ||
              normalizedSiteMigrationPayload?.source?.brand ||
              ""
          ).trim()
        : String(requestPayload.brand_name || requestPayload.brand || "").trim(),
    execution_trace_id,
    request_payload: normalizedJobType === "site_migration" ? normalizedSiteMigrationPayload : requestPayload,
    attempt_count: 0,
    max_attempts: normalizeMaxAttempts(body.max_attempts),
    result_payload: null,
    error_payload: null,
    next_retry_at: "",
    webhook_url: normalizeWebhookUrl(body.webhook_url),
    callback_secret: String(body.callback_secret || "").trim(),
    idempotency_key: idempotencyKey
  };

  jobRepository.set(job);
  if (idempotencyLookupKey) {
    await idempotencyRepository.set(idempotencyLookupKey, job.job_id);
  }

  debugLog("JOB_CREATED:", {
    job_id: job.job_id,
    requested_by: job.requested_by,
    parent_action_key: job.parent_action_key,
    endpoint_key: job.endpoint_key
  });

  const enqueueResult = await enqueueJob(job.job_id);
  if (!enqueueResult?.ok) {
    const failure = await failAsyncSubmission(job, idempotencyLookupKey, enqueueResult);
    return res.status(503).json(failure);
  }

  return res.status(202).json(toJobSummary(job));
});

app.get("/jobs/:jobId", requireBackendApiKey, async (req, res) => {
  const job = await resolveJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({
      ok: false,
      error: {
        code: "job_not_found",
        message: "Job not found."
      }
    });
  }

  const summary = toJobSummary(job);
  return res.status(200).json({
    ...summary,
    terminal: TERMINAL_JOB_STATUSES.has(normalizeJobStatus(job.status)),
    active: ACTIVE_JOB_STATUSES.has(normalizeJobStatus(job.status))
  });
});

app.get("/jobs/:jobId/result", requireBackendApiKey, async (req, res) => {
  try {
    const job = await resolveJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({
        ok: false,
        error: {
          code: "job_not_found",
          message: "Job not found."
        }
      });
    }

    const poll_started_at = nowIso();
    const execution_trace_id =
      String(job.execution_trace_id || "").trim() || createExecutionTraceId();
    if (job.execution_trace_id !== execution_trace_id) {
      updateJob(job, { execution_trace_id });
    }

    const status = normalizeJobStatus(job.status);
    if (status === "succeeded") {
      const responsePayload = {
        job_id: job.job_id,
        status: job.status,
        result: job.result_payload || null
      };

      await performUniversalServerWriteback({
        mode: "poll",
        job_id: job.job_id,
        target_key: job.target_key,
        parent_action_key: job.parent_action_key,
        endpoint_key: job.endpoint_key,
        route_id: job.route_id,
        target_module: job.target_module,
        target_workflow: job.target_workflow,
        source_layer: "http_client_backend",
        entry_type: "poll_read",
        execution_class: "poll",
        attempt_count: job.attempt_count,
        status_source: status,
        responseBody: job.result_payload,
        error_code: job.result_payload?.error?.code,
        error_message_short: job.result_payload?.error?.message,
        http_status: 200,
        brand_name: job.brand_name,
        execution_trace_id,
        started_at: poll_started_at
      });

      return res.status(200).json(responsePayload);
    }

    if (status === "failed" || status === "cancelled") {
      const responsePayload = {
        job_id: job.job_id,
        status: job.status,
        error: job.error_payload || null
      };

      await performUniversalServerWriteback({
        mode: "poll",
        job_id: job.job_id,
        target_key: job.target_key,
        parent_action_key: job.parent_action_key,
        endpoint_key: job.endpoint_key,
        route_id: job.route_id,
        target_module: job.target_module,
        target_workflow: job.target_workflow,
        source_layer: "http_client_backend",
        entry_type: "poll_read",
        execution_class: "poll",
        attempt_count: job.attempt_count,
        status_source: status,
        responseBody: job.error_payload,
        error_code: job.error_payload?.error?.code,
        error_message_short: job.error_payload?.error?.message,
        http_status: 200,
        brand_name: job.brand_name,
        execution_trace_id,
        started_at: poll_started_at
      });

      return res.status(200).json(responsePayload);
    }

    const pendingPayload = {
      job_id: job.job_id,
      status: job.status,
      message: "Job is not complete yet.",
      status_url: `/jobs/${job.job_id}`
    };

    await performUniversalServerWriteback({
      mode: "poll",
      job_id: job.job_id,
      target_key: job.target_key,
      parent_action_key: job.parent_action_key,
      endpoint_key: job.endpoint_key,
      route_id: job.route_id,
      target_module: job.target_module,
      target_workflow: job.target_workflow,
      source_layer: "http_client_backend",
      entry_type: "poll_read",
      execution_class: "poll",
      attempt_count: job.attempt_count,
      status_source: status,
      responseBody: pendingPayload,
      error_code: "",
      error_message_short: "",
      http_status: 202,
      brand_name: job.brand_name,
      execution_trace_id,
      started_at: poll_started_at
    });

    return res.status(202).json(pendingPayload);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: {
        code: "poll_read_failed",
        message: err?.message || "Poll read failed."
      }
    });
  }
});

app.post("/http-execute", requireBackendApiKey, async (req, res) => {
  let requestPayload = null;
  let action = null;
  let endpoint = null;
  let brand = null;
  let sameServiceNativeTarget = false;
  let resolvedMethodPath = null;
  const sync_execution_started_at = nowIso();
  let execution_trace_id =
    String(req.body?.execution_trace_id || "").trim() || createExecutionTraceId();

  try {
    requireEnv("REGISTRY_SPREADSHEET_ID");

    const originalPayload = req.body || {};
    const originalPayloadPromoted =
      promoteDelegatedExecutionPayload(originalPayload);

    const normalized = normalizeExecutionPayload(originalPayloadPromoted);
    const normalizedPromoted =
      promoteDelegatedExecutionPayload(normalized);
    const normalizedAssetHomeValidation = validateAssetHomePayloadRules(
      normalizedPromoted,
      { normalizeAssetType, classifyAssetHome }
    );
    if (!normalizedAssetHomeValidation.ok) {
      return res.status(400).json({
        ok: false,
        error: {
          code: "normalized_asset_home_validation_failed",
          message: "Normalized asset home validation failed.",
          details: normalizedAssetHomeValidation.errors
        }
      });
    }
    assertHostingerTargetTier(normalizedPromoted);

    const payloadIntegrity = validatePayloadIntegrity(
      normalizeTopLevelRoutingFields(originalPayloadPromoted),
      normalizeTopLevelRoutingFields(normalizedPromoted)
    );
    if (!payloadIntegrity.ok) {
      return res.status(400).json({
        ok: false,
        error: {
          code: "payload_integrity_violation",
          message: "Normalized payload does not preserve required top-level routing fields.",
          details: {
            mismatches: payloadIntegrity.mismatches
          }
        },
        execution_guardrail: true
      });
    }

    // FORCE canonical payload for all downstream logic
    requestPayload = normalizedPromoted;
    execution_trace_id =
      String(requestPayload.execution_trace_id || execution_trace_id || "").trim() ||
      createExecutionTraceId();
    requestPayload.execution_trace_id = execution_trace_id;
    debugLog("IS_DELEGATED_HTTP_EXECUTE_WRAPPER:", isDelegatedHttpExecuteWrapper(requestPayload));
    debugLog("PROMOTED_ROUTING_FIELDS:", JSON.stringify({
      target_key: requestPayload.target_key || "",
      brand: requestPayload.brand || "",
      brand_domain: requestPayload.brand_domain || ""
    }));
    debugLog("PROMOTED_EXECUTION_TARGET:", JSON.stringify({
      provider_domain: requestPayload.provider_domain || "",
      parent_action_key: requestPayload.parent_action_key || "",
      endpoint_key: requestPayload.endpoint_key || "",
      method: requestPayload.method || "",
      path: requestPayload.path || ""
    }));
    const provider_domain = requestPayload.provider_domain;
    const parent_action_key = requestPayload.parent_action_key;
    const endpoint_key = requestPayload.endpoint_key;

    if (!parent_action_key || !endpoint_key) {
      return res.status(400).json({
        ok: false,
        error: {
          code: "invalid_request",
          message: "parent_action_key and endpoint_key are required."
        }
      });
    }

    const forceRefresh = requestPayload.force_refresh === true || String(requestPayload.force_refresh || "").toLowerCase() === "true";
    if (forceRefresh) {
      debugLog("REGISTRY_FORCE_REFRESH:", true);
    }
    const { drive, brandRows, hostingAccounts, actionRows, endpointRows, policies } = forceRefresh
      ? await reloadRegistry()
      : await getRegistry();

    const requiredHttpExecutionPolicyKeys =
      getRequiredHttpExecutionPolicyKeys(policies);

    const requiredHttpExecutionPolicyCheck =
      requirePolicySet(
        policies,
        "HTTP Execution Governance",
        requiredHttpExecutionPolicyKeys
      );

    if (!requiredHttpExecutionPolicyCheck.ok) {
      return res.status(403).json({
        ok: false,
        error: {
          code: "missing_required_http_execution_policy",
          message: "Required HTTP Execution Governance policies are not fully enabled.",
          details: {
            policy_group: "HTTP Execution Governance",
            missing_keys: requiredHttpExecutionPolicyCheck.missing,
            handling: String(
              policyValue(
                policies,
                "HTTP Execution Governance",
                "Missing Required Policy Handling",
                "BLOCK"
              )
            ).trim()
          }
        },
        execution_guardrail: true,
        repair_action: "restore_required_http_execution_governance_rows",
        execution_trace_id
      });
    }

    const topLevelRoutingValidation = validateTopLevelRoutingFields(
      requestPayload,
      policies,
      { policyValue }
    );
    if (!topLevelRoutingValidation.ok) {
      return res.status(400).json({
        ok: false,
        error: {
          code: "top_level_routing_schema_violation",
          message: "Top-level routing fields failed validation.",
          details: {
            errors: topLevelRoutingValidation.errors
          }
        },
        execution_guardrail: true
      });
    }
    const assetHomeValidation = validateAssetHomePayloadRules(
      requestPayload,
      { normalizeAssetType, classifyAssetHome }
    );

    if (!assetHomeValidation.ok) {
      return res.status(400).json({
        ok: false,
        error: {
          code: "asset_home_validation_failed",
          message: "Asset home validation failed.",
          details: assetHomeValidation.errors
        }
      });
    }

    const callerHeaders = sanitizeCallerHeaders(requestPayload.headers || {});
    const query = requestPayload.query && typeof requestPayload.query === "object"
      ? { ...requestPayload.query }
      : {};
    const body = requestPayload.body;
    const pathParams = requestPayload.path_params || {};
    debugLog("NORMALIZED_TOP_LEVEL_ROUTING_FIELDS:", JSON.stringify({
      provider_domain: requestPayload.provider_domain || "",
      parent_action_key: requestPayload.parent_action_key || "",
      endpoint_key: requestPayload.endpoint_key || "",
      method: requestPayload.method || "",
      path: requestPayload.path || "",
      target_key: requestPayload.target_key || "",
      brand: requestPayload.brand || "",
      brand_domain: requestPayload.brand_domain || ""
    }));

    ({
      action,
      endpoint,
      brand,
      sameServiceNativeTarget,
      resolvedMethodPath
    } = resolveHttpExecutionContextCore(
      {
        requestPayload,
        parent_action_key,
        endpoint_key,
        actionRows,
        endpointRows,
        brandRows,
        policies,
        allowedTransport: process.env.HTTP_ALLOWED_TRANSPORT
      },
      {
        debugLog,
        boolFromSheet,
        policyValue,
        resolveAction,
        resolveEndpoint,
        getEndpointExecutionSnapshot,
        resolveBrand,
        requireRuntimeCallableAction,
        requireEndpointExecutionEligibility,
        requireExecutionModeCompatibility,
        requireNativeFamilyBoundary,
        requireTransportIfDelegated,
        requireNoFallbackDirectExecution,
        isDelegatedTransportTarget,
        ensureMethodAndPathMatchEndpoint
      }
    ));

    const dispatchedEndpointResult = await dispatchEndpointKeyExecution({
      endpoint_key,
      requestPayload
    });

    if (dispatchedEndpointResult) {
      const localDispatchStatusCode =
        inferLocalDispatchHttpStatus(dispatchedEndpointResult);

      await performUniversalServerWriteback({
        mode: "sync",
        job_id: undefined,
        target_key: requestPayload.target_key,
        parent_action_key: parent_action_key,
        endpoint_key: endpoint_key,
        route_id: String(endpoint?.endpoint_id || "").trim(),
        target_module: String(endpoint?.module_binding || "").trim(),
        target_workflow: String(action?.action_key || "").trim(),
        source_layer: "http_client_backend",
        entry_type: "sync_execution",
        execution_class: "sync",
        attempt_count: 1,
        status_source: dispatchedEndpointResult.ok ? "succeeded" : "failed",
        responseBody: dispatchedEndpointResult,
        error_code: dispatchedEndpointResult?.error?.code || "",
        error_message_short: dispatchedEndpointResult?.error?.message || "",
        http_status: localDispatchStatusCode,
        brand_name: String(brand?.brand_name || requestPayload.brand || "").trim(),
        execution_trace_id,
        started_at: sync_execution_started_at
      });

      return res
        .status(localDispatchStatusCode)
        .json(dispatchedEndpointResult);
    }

    if (sameServiceNativeTarget) {
      const nativeOutcome = await executeSameServiceNativeEndpoint({
        method: resolvedMethodPath.method,
        path: resolvedMethodPath.path,
        body: requestPayload.body,
        timeoutSeconds: requestPayload.timeout_seconds,
        expectJson: requestPayload.expect_json
      });

      return res.status(nativeOutcome.statusCode).json(nativeOutcome.payload);
    }

    debugLog("REQUEST_PAYLOAD_TARGET_KEY:", requestPayload.target_key || "");
    debugLog("REQUEST_PAYLOAD_BRAND:", requestPayload.brand || "");
    debugLog("REQUEST_PAYLOAD_BRAND_DOMAIN:", requestPayload.brand_domain || "");
    const {
      providerDomain: resolvedProviderDomain,
      resolvedProviderDomainMode,
      placeholderResolutionSource
    } = resolveProviderDomain({
      requestedProviderDomain: provider_domain,
      endpoint,
      brand,
      parentActionKey: parent_action_key,
      policies,
      requestBody: requestPayload
    });
    debugLog("RESOLVED_PROVIDER_DOMAIN:", resolvedProviderDomain);
    debugLog("RESOLVED_PROVIDER_DOMAIN_MODE:", resolvedProviderDomainMode);
    debugLog("PLACEHOLDER_RESOLUTION_SOURCE:", placeholderResolutionSource);

    const requestBody = requestPayload;
    const resolvedTargetKey = String(
      requestPayload.target_key || brand?.target_key || ""
    ).trim();

    const authContract = normalizeAuthContract({
      action,
      brand,
      hostingAccounts,
      targetKey: requestBody.target_key || resolvedTargetKey || ""
    });
    if (String(action.action_key || "").trim() === "hostinger_api") {
      debugLog("HOSTINGER_BRAND_TARGET_KEY:", brand?.target_key || "");
      debugLog(
        "HOSTINGER_EFFECTIVE_ACCOUNT_KEY:",
        resolveAccountKey({
          brand,
          targetKey: requestBody.target_key || resolvedTargetKey || "",
          hostingAccounts
        })
      );
      debugLog("HOSTINGER_REQUEST_TARGET_KEY:", requestBody.target_key || resolvedTargetKey || "");
    }
    debugLog("INFERRED_AUTH_MODE:", authContract.mode);
    enforceSupportedAuthMode(policies, authContract.mode);

    if (authContract.mode === "oauth_gpt_action") {
      const handling = policyValue(
        policies,
        "HTTP Execution Governance",
        "OAuth GPT Action Transport Handling",
        "NATIVE_ONLY"
      );

      const allowDelegatedGoogleOAuth = String(
        policyValue(
          policies,
          "HTTP Google Auth",
          "Allow Delegated Google OAuth",
          "TRUE"
        )
      ).trim().toUpperCase() === "TRUE";

      const delegatedGoogleEndpoint =
        isDelegatedTransportTarget(endpoint) &&
        isGoogleApiHost(resolvedProviderDomain);

      if (!allowDelegatedGoogleOAuth || !delegatedGoogleEndpoint) {
        const err = new Error(
          `Resolved auth mode ${authContract.mode} must use governed native connector path (${handling}).`
        );
        err.code = "native_connector_required";
        err.status = 403;
        throw err;
      }

      try {
        authContract.mode = "bearer_token";
        authContract.header_name = "Authorization";
        authContract.secret = await mintGoogleAccessTokenForEndpoint({
          drive,
          policies,
          action,
          endpoint
        });
      } catch (err) {
        debugLog("DELEGATED_GOOGLE_OAUTH_FALLBACK:", {
          action_key: action.action_key,
          endpoint_key: endpoint.endpoint_key,
          provider_domain: resolvedProviderDomain,
          message: err?.message || String(err)
        });
        const authErr = new Error("Delegated Google OAuth token mint failed.");
        authErr.code = "auth_resolution_failed";
        authErr.status = err?.status || 500;
        throw authErr;
      }
    } else if (
      authContract.mode === "none" &&
      isDelegatedTransportTarget(endpoint) &&
      isGoogleApiHost(resolvedProviderDomain)
    ) {
      try {
        authContract.mode = "bearer_token";
        authContract.header_name = "Authorization";
        authContract.secret = await mintGoogleAccessTokenForEndpoint({
          drive,
          policies,
          action,
          endpoint
        });
      } catch (err) {
        debugLog("DELEGATED_GOOGLE_OAUTH_FALLBACK:", {
          action_key: action.action_key,
          endpoint_key: endpoint.endpoint_key,
          provider_domain: resolvedProviderDomain,
          message: err?.message || String(err)
        });
        const authErr = new Error("Delegated Google OAuth token mint failed.");
        authErr.code = "auth_resolution_failed";
        authErr.status = err?.status || 500;
        throw authErr;
      }
    }

    ensureWritePermissions(brand, resolvedMethodPath.method);

    const schemaContract = await fetchSchemaContract(drive, action.openai_schema_file_id);
    const schemaOperationInfo = resolveSchemaOperation(schemaContract, resolvedMethodPath.method, resolvedMethodPath.path);
    if (!schemaOperationInfo) {
      const err = new Error(`Method/path not found in authoritative schema for ${parent_action_key}.`);
      err.code = "schema_path_method_mismatch";
      err.status = 422;
      throw err;
    }

    debugLog("NORMALIZED_QUERY:", query);
    const schemaValidationInput = injectAuthForSchemaValidation(
      query,
      callerHeaders,
      authContract
    );

    const queryWithAuth = schemaValidationInput.query;
    const headersWithAuthForValidation = {
      ...schemaValidationInput.headers,
      ...getAdditionalStaticAuthHeaders(action, authContract)
    };

    const schemaValidationErrors = [
      ...validateParameters(schemaOperationInfo.operation, {
        query: queryWithAuth,
        headers: headersWithAuthForValidation,
        path_params: pathParams
      }),
      ...validateRequestBody(schemaOperationInfo.operation, body)
    ];
    const route_id = String(endpoint?.endpoint_id || "").trim();
    const target_module = String(endpoint?.module_binding || "").trim();
    const target_workflow = String(action?.action_key || "").trim();
    const brand_name = String(brand?.brand_name || requestPayload.brand || "").trim();

    const callerAuthTrust = policyValue(policies, "HTTP Execution Governance", "Caller Authorization Header Trust", "FALSE");
    if (
      String(callerAuthTrust).toUpperCase() === "FALSE" &&
      (requestPayload.headers?.Authorization || requestPayload.headers?.authorization)
    ) {
      const err = new Error("Caller-supplied Authorization is not trusted by policy.");
      err.code = "forbidden_header";
      err.status = 403;
      throw err;
    }

    if (schemaValidationErrors.length) {
      const responsePayload = {
        ok: false,
        error: {
          code: "request_schema_mismatch",
          message: "Request failed schema alignment.",
          details: {
            request_schema_alignment_status: "degraded",
            errors: schemaValidationErrors,
            openai_schema_file_id: action.openai_schema_file_id,
            schema_name: schemaContract.name
          }
        }
      };

      await performUniversalServerWriteback({
        mode: "sync",
        job_id: undefined,
        target_key: requestPayload.target_key,
        parent_action_key,
        endpoint_key,
        route_id,
        target_module,
        target_workflow,
        source_layer: "http_client_backend",
        entry_type: "sync_execution",
        execution_class: "sync",
        attempt_count: 1,
        status_source: "failed",
        responseBody: responsePayload,
        error_code: "request_schema_mismatch",
        error_message_short: "Request failed schema alignment.",
        http_status: 422,
        brand_name,
        execution_trace_id,
        started_at: sync_execution_started_at
      });

      return res.status(422).json(responsePayload);
    }

    await logValidationRunWriteback({
      target_key: requestPayload.target_key,
      parent_action_key,
      endpoint_key,
      route_id,
      target_module,
      target_workflow,
      validationStatus: "succeeded",
      validationPayload: {
        request_schema_alignment_status: "validated",
        openai_schema_file_id: action.openai_schema_file_id,
        schema_name: schemaContract.name
      },
      error_code: undefined,
      error_message_short: undefined,
      brand_name,
      execution_trace_id,
      started_at: sync_execution_started_at
    });

    const finalQuery = queryWithAuth;
    let finalHeaders = {
      Accept: "application/json",
      ...(brand ? jsonParseSafe(brand.default_headers_json, {}) : {}),
      ...callerHeaders
    };
    finalHeaders = injectAuthIntoHeaders(finalHeaders, authContract);
    finalHeaders = {
      ...finalHeaders,
      ...getAdditionalStaticAuthHeaders(action, authContract)
    };

    if (body !== undefined && !finalHeaders["Content-Type"] && !finalHeaders["content-type"]) {
      finalHeaders["Content-Type"] = "application/json";
    }

    const baseUrl = buildUrl(resolvedProviderDomain, resolvedMethodPath.path);
    const requestUrl = appendQuery(baseUrl, finalQuery);

    debugLog("OUTBOUND_URL:", requestUrl);
    debugLog("AUTH_MODE:", authContract.mode);
    debugLog("HAS_AUTH_HEADER:", !!(finalHeaders["Authorization"] || finalHeaders["authorization"]));
    debugLog("AUTH_HEADER_NAME:", authContract.header_name || "");
    debugLog("HAS_CUSTOM_API_HEADER:", authContract.header_name ? !!finalHeaders[authContract.header_name] : false);

    const timeoutSeconds = Math.min(Number(requestPayload.timeout_seconds || 300), MAX_TIMEOUT_SECONDS);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

    const resilienceApplies = resilienceAppliesToParentAction(policies, parent_action_key);
    const providerRetryEnabled = retryMutationEnabled(policies);

    const maxAdditionalAttempts = Number(
      policyValue(
        policies,
        "HTTP Execution Resilience",
        "Provider Retry Max Additional Attempts",
        "0"
      )
    ) || 0;

    const retryMutations = buildProviderRetryMutations(
      policies,
      action?.action_key || parent_action_key
    );

    const transportBody = finalizeTransportBody(body);

    const upstreamRequest = {
      method: resolvedMethodPath.method,
      headers: finalHeaders,
      body: transportBody === undefined ? undefined : JSON.stringify(transportBody),
      signal: controller.signal,
      redirect: "follow"
    };

    let finalAttemptQuery = { ...finalQuery };
    let upstream;
    let data;
    let responseHeaders = {};
    let contentType = "";
    let responseText = "";
    let effectiveRequestUrl = requestUrl;

    const attempts = [{}, ...retryMutations].slice(
      0,
      1 + Math.max(0, maxAdditionalAttempts)
    );

    for (let i = 0; i < attempts.length; i++) {
      const mutation = attempts[i] || {};
      const attemptQuery = { ...finalQuery, ...mutation };
      const attemptUrl = appendQuery(baseUrl, attemptQuery);

      debugLog("RESILIENCE_APPLIES:", resilienceApplies);
      debugLog("PROVIDER_RETRY_ENABLED:", providerRetryEnabled);
      debugLog("PROVIDER_RETRY_ATTEMPT_INDEX:", i);
      debugLog("PROVIDER_RETRY_MUTATION:", mutation);
      debugLog("OUTBOUND_URL_ATTEMPT:", attemptUrl);

      const attemptResult = await executeUpstreamAttempt({
        requestUrl: attemptUrl,
        requestInit: upstreamRequest
      });

      upstream = attemptResult.upstream;
      data = attemptResult.data;
      responseHeaders = attemptResult.responseHeaders;
      contentType = attemptResult.contentType;
      responseText = attemptResult.responseText;
      effectiveRequestUrl = attemptUrl;
      finalAttemptQuery = attemptQuery;

      const canRetry =
        resilienceApplies &&
        providerRetryEnabled &&
        i < attempts.length - 1 &&
        shouldRetryProviderResponse(policies, upstream.status, responseText);

      if (!canRetry) {
        break;
      }
    }

    clearTimeout(timer);

    let responseSchemaAlignmentStatus = "not_declared";

    const responseSchemaEnforcementEnabled = String(
      policyValue(
        policies,
        "HTTP Response Schema Enforcement",
        "Response Schema Enforcement Enabled",
        "FALSE"
      )
    ).trim().toUpperCase() === "TRUE";

    const enforcedContentTypes = policyList(
      policies,
      "HTTP Response Schema Enforcement",
      "Response Content Type Enforcement"
    ).map(v => v.toLowerCase());

    const currentContentType = String(contentType || "").toLowerCase();

    const responseContent =
      schemaOperationInfo.operation?.responses?.[String(upstream.status)]?.content ||
      schemaOperationInfo.operation?.responses?.default?.content ||
      {};

    const responseJsonSchema =
      responseContent["application/json"]?.schema ||
      responseContent["application/problem+json"]?.schema ||
      null;

    const contentTypeEligible = enforcedContentTypes.length
      ? enforcedContentTypes.some(ct => currentContentType.includes(ct))
      : currentContentType.includes("application/json");

    if (responseSchemaEnforcementEnabled && contentTypeEligible) {
      if (!responseJsonSchema) {
        responseSchemaAlignmentStatus = "degraded";

        const responsePayload = {
          ok: false,
          error: {
            code: "response_schema_missing",
            message: "Response schema could not be resolved for schema-bound endpoint.",
            details: {
              schema_drift_detected: true,
              schema_drift_type: "structure_mismatch",
              schema_drift_scope: "response",
              schema_learning_candidate_emitted: true,
              upstream_status: upstream.status,
              openai_schema_file_id: action.openai_schema_file_id
            }
          }
        };

        await performUniversalServerWriteback({
          mode: "sync",
          job_id: undefined,
          target_key: requestPayload.target_key,
          parent_action_key,
          endpoint_key,
          route_id,
          target_module,
          target_workflow,
          source_layer: "http_client_backend",
          entry_type: "sync_execution",
          execution_class: "sync",
          attempt_count: 1,
          status_source: "failed",
          responseBody: responsePayload,
          error_code: "response_schema_missing",
          error_message_short: "Response schema could not be resolved for schema-bound endpoint.",
          http_status: 422,
          brand_name,
          execution_trace_id,
          started_at: sync_execution_started_at
        });

        return res.status(422).json(responsePayload);
      }

      responseSchemaAlignmentStatus = "validated";
      const responseErrors = validateByJsonSchema(responseJsonSchema, data, "response");
      if (responseErrors.length) {
        const drift = classifySchemaDrift(responseJsonSchema, data, "response") || {
          schema_drift_detected: true,
          schema_drift_type: "type_mismatch",
          schema_drift_scope: "response"
        };

        responseSchemaAlignmentStatus = "degraded";
        const responsePayload = {
          ok: false,
          error: {
            code: "response_schema_mismatch",
            message: "Response failed strict schema validation.",
            details: {
              errors: responseErrors,
              ...drift,
              schema_learning_candidate_emitted: true,
              upstream_status: upstream.status,
              openai_schema_file_id: action.openai_schema_file_id
            }
          }
        };

        await performUniversalServerWriteback({
          mode: "sync",
          job_id: undefined,
          target_key: requestPayload.target_key,
          parent_action_key,
          endpoint_key,
          route_id,
          target_module,
          target_workflow,
          source_layer: "http_client_backend",
          entry_type: "sync_execution",
          execution_class: "sync",
          attempt_count: 1,
          status_source: "failed",
          responseBody: responsePayload,
          error_code: "response_schema_mismatch",
          error_message_short: "Response failed strict schema validation.",
          http_status: 422,
          brand_name,
          execution_trace_id,
          started_at: sync_execution_started_at
        });

        return res.status(422).json(responsePayload);
      }
    }

    const compactWordPressCreate = parent_action_key === "wordpress_api" && endpoint_key === "wordpress_create_post";
    if (compactWordPressCreate) {
      const success = upstream.status === 201 && data && typeof data === "object" && data.id;
      if (success) {
        const responsePayload = {
          ok: true,
          upstream_status: upstream.status,
          provider_domain: resolvedProviderDomain,
          parent_action_key,
          endpoint_key,
          method: resolvedMethodPath.method,
          path: resolvedMethodPath.path,
          openai_schema_file_id: action.openai_schema_file_id,
          schema_name: schemaContract.name,
          resolved_auth_mode: authContract.mode,
          runtime_capability_class: action.runtime_capability_class || "",
          runtime_callable: boolFromSheet(action.runtime_callable),
          primary_executor: action.primary_executor || "",
          endpoint_role: endpoint.endpoint_role || "",
          execution_mode: endpoint.execution_mode || "",
          transport_required: boolFromSheet(endpoint.transport_required),
          request_schema_alignment_status: "validated",
          response_schema_alignment_status: responseSchemaAlignmentStatus,
          transport_request_contract_status: "validated",
          resolved_provider_domain_mode: resolvedProviderDomainMode,
          placeholder_resolution_source: placeholderResolutionSource,
          resilience_applied: resilienceApplies,
          final_query: finalAttemptQuery,
          request_url: effectiveRequestUrl,
          post_id: data.id,
          status: data.status,
          link: data.link || ""
        };

        await performUniversalServerWriteback({
          mode: "sync",
          job_id: undefined,
          target_key: requestPayload.target_key,
          parent_action_key,
          endpoint_key,
          route_id,
          target_module,
          target_workflow,
          source_layer: "http_client_backend",
          entry_type: "sync_execution",
          execution_class: "sync",
          attempt_count: 1,
          status_source: "succeeded",
          responseBody: data,
          error_code: data?.error?.code,
          error_message_short: data?.error?.message,
          http_status: upstream.status,
          brand_name,
          execution_trace_id,
          started_at: sync_execution_started_at
        });

        return res.status(200).json(responsePayload);
      }

      const responsePayload = {
        ok: false,
        upstream_status: upstream.status,
        provider_domain: resolvedProviderDomain,
        parent_action_key,
        endpoint_key,
        method: resolvedMethodPath.method,
        path: resolvedMethodPath.path,
        openai_schema_file_id: action.openai_schema_file_id,
        schema_name: schemaContract.name,
        resolved_auth_mode: authContract.mode,
        runtime_capability_class: action.runtime_capability_class || "",
        runtime_callable: boolFromSheet(action.runtime_callable),
        primary_executor: action.primary_executor || "",
        endpoint_role: endpoint.endpoint_role || "",
        execution_mode: endpoint.execution_mode || "",
        transport_required: boolFromSheet(endpoint.transport_required),
        request_schema_alignment_status: "validated",
        response_schema_alignment_status: responseSchemaAlignmentStatus,
        transport_request_contract_status: "validated",
        resolved_provider_domain_mode: resolvedProviderDomainMode,
        placeholder_resolution_source: placeholderResolutionSource,
        resilience_applied: resilienceApplies,
        final_query: finalAttemptQuery,
        request_url: effectiveRequestUrl,
        error: {
          code: "wordpress_request_failed",
          message: "WordPress did not confirm post creation.",
          details: {
            upstream_status: upstream.status,
            data
          }
        }
      };

      await performUniversalServerWriteback({
        mode: "sync",
        job_id: undefined,
        target_key: requestPayload.target_key,
        parent_action_key,
        endpoint_key,
        route_id,
        target_module,
        target_workflow,
        source_layer: "http_client_backend",
        entry_type: "sync_execution",
        execution_class: "sync",
        attempt_count: 1,
        status_source: "failed",
        responseBody: data,
        error_code: "wordpress_request_failed",
        error_message_short: "WordPress did not confirm post creation.",
        http_status: upstream.status,
        brand_name,
        execution_trace_id,
        started_at: sync_execution_started_at
      });

      return res.status(200).json(responsePayload);
    }

    const responsePayload = {
      ok: upstream.ok,
      status: upstream.status,
      provider_domain: resolvedProviderDomain,
      parent_action_key,
      endpoint_key,
      method: resolvedMethodPath.method,
      path: resolvedMethodPath.path,
      openai_schema_file_id: action.openai_schema_file_id,
      schema_name: schemaContract.name,
      resolved_auth_mode: authContract.mode,
      runtime_capability_class: action.runtime_capability_class || "",
      runtime_callable: boolFromSheet(action.runtime_callable),
      primary_executor: action.primary_executor || "",
      endpoint_role: endpoint.endpoint_role || "",
      execution_mode: endpoint.execution_mode || "",
      transport_required: boolFromSheet(endpoint.transport_required),
      request_schema_alignment_status: "validated",
      response_schema_alignment_status: responseSchemaAlignmentStatus,
      transport_request_contract_status: "validated",
      resolved_provider_domain_mode: resolvedProviderDomainMode,
      placeholder_resolution_source: placeholderResolutionSource,
      resilience_applied: resilienceApplies,
      final_query: finalAttemptQuery,
      request_url: effectiveRequestUrl,
      response_headers: responseHeaders,
      data
    };

    await performUniversalServerWriteback({
      mode: "sync",
      job_id: undefined,
      target_key: requestPayload.target_key,
      parent_action_key,
      endpoint_key,
      route_id,
      target_module,
      target_workflow,
      source_layer: "http_client_backend",
      entry_type: "sync_execution",
      execution_class: "sync",
      attempt_count: 1,
      status_source: upstream.ok ? "succeeded" : "failed",
      responseBody: data,
      error_code: data?.error?.code,
      error_message_short: data?.error?.message,
      http_status: upstream.status,
      brand_name,
      execution_trace_id,
      started_at: sync_execution_started_at
    });

    return res.status(upstream.ok ? 200 : upstream.status).json(responsePayload);
  } catch (err) {
    const errorPayload = {
      code: err?.code || "internal_error",
      message: err?.message || "Unexpected error.",
      status: err?.status || 500,
      details: err?.details || null
    };

    console.error(
      "HTTP_EXECUTE_ERROR:",
      JSON.stringify({
        error: errorPayload,
        request: {
          provider_domain: requestPayload?.provider_domain || req.body?.provider_domain || "",
          parent_action_key: requestPayload?.parent_action_key || req.body?.parent_action_key || "",
          endpoint_key: requestPayload?.endpoint_key || req.body?.endpoint_key || "",
          method: requestPayload?.method || req.body?.method || "",
          path: requestPayload?.path || req.body?.path || ""
        },
        action: action
          ? {
              action_key: action.action_key,
              runtime_capability_class: action.runtime_capability_class,
              runtime_callable: action.runtime_callable,
              primary_executor: action.primary_executor
            }
          : null,
        endpoint: endpoint ? getEndpointExecutionSnapshot(endpoint) : null,
        brand: brand
          ? {
              brand_name: brand.brand_name,
              target_key: brand.target_key,
              base_url: brand.base_url
            }
          : null
      })
    );

    try {
      await performUniversalServerWriteback({
        mode: "sync",
        job_id: undefined,
        target_key: requestPayload?.target_key || "",
        parent_action_key:
          requestPayload?.parent_action_key || req.body?.parent_action_key || "",
        endpoint_key: requestPayload?.endpoint_key || req.body?.endpoint_key || "",
        route_id: String(endpoint?.endpoint_id || "").trim(),
        target_module: String(endpoint?.module_binding || "").trim(),
        target_workflow: String(action?.action_key || "").trim(),
        source_layer: "http_client_backend",
        entry_type: "sync_execution",
        execution_class: "sync",
        attempt_count: 1,
        status_source: "failed",
        responseBody: errorPayload,
        error_code: errorPayload.code,
        error_message_short: errorPayload.message,
        http_status: errorPayload.status,
        brand_name: String(brand?.brand_name || requestPayload?.brand || req.body?.brand || "").trim(),
        execution_trace_id,
        started_at: sync_execution_started_at
      });
    } catch (writebackErr) {
      console.error("SYNC_WRITEBACK_FAILED:", writebackErr);
    }

    return res.status(errorPayload.status).json({
      ok: false,
      error: errorPayload
    });
  }
});

async function shutdownJobState() {
  try {
    await closeQueue();
  } catch (err) {
    console.error("JOB_STATE_SHUTDOWN_FAILED:", err);
  }
}

process.on("SIGINT", async () => {
  await shutdownJobState();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await shutdownJobState();
  process.exit(0);
});

// BullMQ worker — processes jobs concurrently across all instances.
if (QUEUE_WORKER_ENABLED) {
  createWorker(async (bullJob) => {
    const job = bullJob.data;
    jobRepository.set(job);
    await executeSingleQueuedJob(job);
  });
} else {
  console.log("QUEUE_WORKER_DISABLED: skipping BullMQ worker startup for this instance.");
}

app.listen(port, () => {
  console.log(`http_generic_api_connector listening on port ${port}`);
});
