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
  createJobRepository,
  createIdempotencyRepository,
  resolveJob,
  failAsyncSubmission,
  getInMemoryJobs
} from "./runtimeState.js";

import {
  requireEnv as requireEnvCore,
  isBackendApiKeyEnabled,
  isDebugEnabled,
  createDebugLog,
  createBackendApiKeyMiddleware
} from "./runtimeGuards.js";

import {
  jsonParseSafe,
  boolFromSheet,
  asBool,
  rowToObject
} from "./runtimeHelpers.js";

import {
  requireMcpToken,
  requireMcpAcceptHeader,
  mcpInitialize,
  mcpToolsList,
  mcpToolsCall
} from "./mcpRuntime.js";

import {
  extractJsonAssetPayloadBody,
  matchesHostingerSshTarget,
  normalizePath,
  normalizeProviderDomain,
  safeNormalizeProviderDomain,
  normalizeEndpointProviderDomain,
  isVariablePlaceholder,
  sanitizeCallerHeaders,
  buildUrl,
  appendQuery
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
  buildProviderRetryMutations as buildProviderRetryMutationsCore,
  retryMutationEnabled as retryMutationEnabledCore
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
  normalizeSiteMigrationPayload,
  validateSiteMigrationPayload,
  validateSiteMigrationRouteWorkflowReadiness,
  executeSiteMigrationJob,
  firstPopulated
} from "./domainAdapters/wordpressAdapter.js";
import {
  toJobSummary,
  inferLocalDispatchHttpStatus,
  createSiteMigrationJobRecord,
  executeSameServiceNativeEndpoint,
  dispatchEndpointKeyExecution,
  configureJobRunner
} from "./jobRunner.js";
import { registerRoutes } from "./routes/index.js";
import { createExecutionFacade } from "./executionFacade.js";


// --- Runtime Guards Initialization ---
const debugLog = createDebugLog(process.env);
const debugEnabled = isDebugEnabled(process.env);
const backendApiKeyEnabled = isBackendApiKeyEnabled(process.env);
const requireBackendApiKey = createBackendApiKeyMiddleware(process.env);

function requireEnv(name) {
  return requireEnvCore(name, process.env[name]);
}


const app = express();
app.use(express.json({ limit: JSON_BODY_LIMIT }));



// --- Runtime State Initialization ---
const jobRepository = createJobRepository({
  setJobInRedis,
  getJobFromRedis,
  debugLog
});

const idempotencyRepository = createIdempotencyRepository({
  getByIdempotencyKey: getIdempotencyEntry,
  setByIdempotencyKey: setIdempotencyEntry,
  deleteByIdempotencyKey: deleteIdempotencyEntry,
  hasByIdempotencyKey: hasIdempotencyEntry
});

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
const retryMutationEnabled = p => retryMutationEnabledCore(p);

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






const executionFacade = createExecutionFacade({
  // shared
  requireEnv,
  nowIso,
  createExecutionTraceId,
  debugLog,
  performUniversalServerWriteback,
  // payload normalization
  promoteDelegatedExecutionPayload,
  normalizeExecutionPayload,
  validateAssetHomePayloadRules,
  normalizeAssetType,
  classifyAssetHome,
  assertHostingerTargetTier,
  validatePayloadIntegrity,
  normalizeTopLevelRoutingFields,
  isDelegatedHttpExecuteWrapper,
  validateTopLevelRoutingFields,
  // registry
  getRegistry,
  reloadRegistry,
  // policy
  getRequiredHttpExecutionPolicyKeys,
  requirePolicySet,
  policyValue,
  policyList,
  // execution context resolution
  resolveHttpExecutionContext: resolveHttpExecutionContextCore,
  boolFromSheet,
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
  ensureMethodAndPathMatchEndpoint,
  // dispatch
  dispatchEndpointKeyExecution,
  inferLocalDispatchHttpStatus,
  executeSameServiceNativeEndpoint,
  // provider / auth
  resolveProviderDomain,
  normalizeAuthContract,
  resolveAccountKey,
  isGoogleApiHost,
  enforceSupportedAuthMode,
  mintGoogleAccessTokenForEndpoint,
  ensureWritePermissions,
  // schema
  fetchSchemaContract,
  resolveSchemaOperation,
  injectAuthForSchemaValidation,
  getAdditionalStaticAuthHeaders,
  validateParameters,
  validateRequestBody,
  logValidationRunWriteback,
  // auth / headers
  injectAuthIntoHeaders,
  sanitizeCallerHeaders,
  jsonParseSafe,
  buildUrl,
  appendQuery,
  // resilience
  resilienceAppliesToParentAction,
  retryMutationEnabled,
  buildProviderRetryMutations,
  shouldRetryProviderResponse,
  // transport
  executeUpstreamAttempt,
  finalizeTransportBody,
  // response validation
  classifySchemaDrift,
  validateByJsonSchema,
  // constants
  MAX_TIMEOUT_SECONDS,
  // job submission
  normalizeSiteMigrationPayload,
  validateSiteMigrationPayload,
  createSiteMigrationJobRecord,
  buildExecutionPayloadFromJobRequest,
  validateAsyncJobRequest,
  normalizeWebhookUrl,
  buildJobId,
  normalizeMaxAttempts,
  makeIdempotencyLookupKey,
  idempotencyRepository,
  getJobFromRedis,
  getJob,
  updateJob,
  jobRepository,
  enqueueJob,
  failAsyncSubmission,
  toJobSummary,
  // job read
  resolveJob: (id) => resolveJob(jobRepository, id),
  normalizeJobStatus,
  TERMINAL_JOB_STATUSES,
  ACTIVE_JOB_STATUSES
});

registerRoutes(app, {
  // --- health ---
  jobRepository,
  normalizeJobStatus,
  getWaitingCountSafe,
  getRedisRuntimeStatus,
  SERVICE_VERSION,
  QUEUE_WORKER_ENABLED,
  // --- mcp ---
  requireMcpToken,
  requireMcpAcceptHeader,
  mcpInitialize,
  mcpToolsList,
  mcpToolsCall,
  // --- governance ---
  requireBackendApiKey,
  hostingerSshRuntimeRead,
  buildGovernedAdditionReviewResult,
  ensureSiteMigrationRegistrySurfaces,
  ensureSiteMigrationRouteWorkflowRows,
  requireEnv,
  // --- jobs + execute (via facade) ---
  executionFacade,
  resolveRequestedBy
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
