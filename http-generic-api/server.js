
import express from "express";
import { google } from "googleapis";
import crypto from "node:crypto";
import YAML from "yaml";
import { promises as fs } from "fs";
import {
  redis, jobQueue, createWorker, closeQueue,
  getJobFromRedis, setJobInRedis, getAllJobsFromRedis,
  getIdempotencyEntry, setIdempotencyEntry, deleteIdempotencyEntry, hasIdempotencyEntry
} from "./queue.js";

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
  PORT as port, SERVICE_VERSION, GITHUB_API_BASE_URL, GITHUB_TOKEN,
  GITHUB_BLOB_CHUNK_MAX_LENGTH, DEFAULT_JOB_MAX_ATTEMPTS,
  JOB_WEBHOOK_TIMEOUT_MS, JOB_RETRY_DELAYS_MS
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
  buildWordpressBuilderAuditRow,
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
  getWordpressItemById,
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
  listWordpressEntriesByType,
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

function requireGithubToken() {
  if (!GITHUB_TOKEN) {
    const err = new Error("Missing required environment variable: GITHUB_TOKEN");
    err.code = "missing_github_token";
    err.status = 500;
    throw err;
  }
  return GITHUB_TOKEN;
}

function assertNonEmptyString(value, fieldName) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    const err = new Error(`${fieldName} is required.`);
    err.code = "invalid_request";
    err.status = 400;
    throw err;
  }
  return normalized;
}

function parseBoundedInteger(value, fieldName, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    const err = new Error(
      `${fieldName} must be an integer between ${min} and ${max}.`
    );
    err.code = "invalid_request";
    err.status = 400;
    throw err;
  }
  return parsed;
}

function decodeBase64ToBuffer(value) {
  return Buffer.from(String(value || "").replace(/\s+/g, ""), "base64");
}

async function fetchGitHubBlobPayload({ owner, repo, fileSha }) {
  const token = requireGithubToken();
  const url =
    `${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(owner)}` +
    `/${encodeURIComponent(repo)}/git/blobs/${encodeURIComponent(fileSha)}`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });

  const raw = await response.text();
  let payload = {};
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = {};
    }
  }

  if (!response.ok) {
    const err = new Error(
      payload?.message || `GitHub blob fetch failed with status ${response.status}.`
    );
    err.code =
      response.status === 404 ? "github_blob_not_found" : "github_blob_fetch_failed";
    err.status = response.status === 404 ? 404 : 502;
    throw err;
  }

  if (String(payload?.encoding || "").trim().toLowerCase() !== "base64") {
    const err = new Error("GitHub blob response encoding is not base64.");
    err.code = "github_blob_encoding_unsupported";
    err.status = 502;
    throw err;
  }

  return payload;
}

async function githubGitBlobChunkRead({ input = {} }) {
  const owner = assertNonEmptyString(input.owner, "owner");
  const repo = assertNonEmptyString(input.repo, "repo");
  const fileSha = assertNonEmptyString(
    input.file_sha || input.fileSha,
    "file_sha"
  );

  const start = parseBoundedInteger(
    input.start,
    "start",
    0,
    Number.MAX_SAFE_INTEGER
  );
  const length = parseBoundedInteger(
    input.length,
    "length",
    1,
    GITHUB_BLOB_CHUNK_MAX_LENGTH
  );

  const blob = await fetchGitHubBlobPayload({
    owner,
    repo,
    fileSha
  });

  const blobBuffer = decodeBase64ToBuffer(blob.content);
  const totalSize = blobBuffer.length;

  if (start > totalSize) {
    return {
      ok: false,
      statusCode: 416,
      error: {
        code: "range_not_satisfiable",
        message: "start exceeds blob size."
      }
    };
  }

  const endExclusive = Math.min(start + length, totalSize);
  const chunkBuffer = blobBuffer.subarray(start, endExclusive);

  return {
    ok: true,
    statusCode: 200,
    owner,
    repo,
    file_sha: fileSha,
    start,
    length: chunkBuffer.length,
    end: endExclusive,
    total_size: totalSize,
    encoding: "base64",
    content: chunkBuffer.toString("base64"),
    has_more: endExclusive < totalSize
  };
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

function toUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizeMethod(method) {
  const m = toUpper(method);
  const allowed = ["GET", "POST", "PUT", "PATCH", "DELETE"];
  if (!allowed.includes(m)) {
    const err = new Error(`Method not allowed: ${m}`);
    err.code = "method_not_allowed";
    err.status = 403;
    throw err;
  }
  return m;
}

function normalizePath(path) {
  if (!path || typeof path !== "string" || !path.startsWith("/")) {
    const err = new Error("path must be a relative path starting with '/'.");
    err.code = "path_not_allowed";
    err.status = 400;
    throw err;
  }
  if (/^https?:\/\//i.test(path)) {
    const err = new Error("Full URLs are not allowed.");
    err.code = "path_not_allowed";
    err.status = 403;
    throw err;
  }
  return path;
}

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


const SITE_RUNTIME_INVENTORY_REGISTRY_COLUMNS = [
  "target_key",
  "brand_name",
  "brand_domain",
  "base_url",
  "site_type",
  "supported_cpts",
  "supported_taxonomies",
  "generated_endpoint_support",
  "runtime_validation_status",
  "last_runtime_validated_at",
  "active_status"
];

const SITE_SETTINGS_INVENTORY_REGISTRY_COLUMNS = [
  "target_key",
  "brand_name",
  "brand_domain",
  "base_url",
  "site_type",
  "permalink_structure",
  "timezone_string",
  "site_language",
  "active_theme",
  "settings_validation_status",
  "last_settings_validated_at",
  "active_status"
];

const PLUGIN_INVENTORY_REGISTRY_COLUMNS = [
  "target_key",
  "brand_name",
  "brand_domain",
  "base_url",
  "site_type",
  "active_plugins",
  "plugin_versions_json",
  "plugin_owned_tables",
  "plugin_owned_entities",
  "plugin_validation_status",
  "last_plugin_validated_at",
  "active_status"
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

const PREMIUM_RETRY_MUTATION_KEYS = new Set([
  "premium",
  "ultra_premium"
]);

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

function retryMutationEnabled(policies = []) {
  return String(
    policyValue(policies, "HTTP Execution Resilience", "Retry Mutation Enabled", "FALSE")
  ).trim().toUpperCase() === "TRUE";
}

function retryMutationAppliesToQuery(policies = []) {
  return String(
    policyValue(policies, "HTTP Execution Resilience", "Retry Mutation Apply To", "")
  ).trim() === "query";
}

function retryMutationSchemaModeAllowlisted(policies = []) {
  return String(
    policyValue(policies, "HTTP Execution Resilience", "Retry Mutation Schema Mode", "")
  ).trim() === "allowlisted";
}

function parseRetryStageValue(stageValue = "") {
  const raw = String(stageValue || "").trim();
  if (!raw || raw === "{}") return {};

  const mutation = {};
  const pairs = raw
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);

  for (const pair of pairs) {
    const [rawKey, rawValue] = pair.split("=");
    const key = String(rawKey || "").trim();
    const value = String(rawValue || "").trim().toLowerCase();

    if (!key) continue;
    if (!PREMIUM_RETRY_MUTATION_KEYS.has(key)) continue;

    if (value === "true") mutation[key] = true;
    else if (value === "false") mutation[key] = false;
    else mutation[key] = String(rawValue || "").trim();
  }

  return mutation;
}

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
  const inferred_asset_type =
    String(args.parent_action_key || "").trim() === "wordpress_api"
      ? inferWordpressInventoryAssetType(args.endpoint_key)
      : args.job_id
      ? "raw_queue_response_body"
      : "raw_sync_response_body";
  const asset_type = String(args.asset_type || inferred_asset_type).trim();
  const oversized = !!args.oversized;
  const payloadBody = extractJsonAssetPayloadBody(args);
  const embeddedPayload = oversized
    ? ""
    : JSON.stringify(payloadBody ?? null);
  const assetHome = assertJsonAssetWriteAllowed({
    ...args,
    endpoint_key: endpoint,
    asset_type,
    asset_key: args.asset_key || `${endpoint}__${args.execution_trace_id}`
  });

  return {
    asset_id,
    brand_name: brand,
    asset_key: args.asset_key || `${endpoint}__${args.execution_trace_id}`,
    asset_type,
    cpt_slug: args.cpt_slug || "",
    mapping_status: "captured_unreduced",
    mapping_version: oversized
      ? "response_body_artifact_v2"
      : "response_body_embedded_v2",
    storage_format: "json",
    google_drive_link: oversized ? args.google_drive_link : "",
    source_mode: "server_writeback_artifact",
    source_asset_ref: oversized ? args.drive_file_id : "",
    json_payload: embeddedPayload,
    transport_status: oversized ? "captured_external" : "captured_embedded",
    validation_status: "pending",
    last_validated_at: args.captured_at,
    notes: oversized
      ? `Oversized derived JSON artifact captured for execution_trace_id=${args.execution_trace_id}; authoritative_home=${assetHome.authoritative_home}`
      : `Embedded derived JSON artifact captured for execution_trace_id=${args.execution_trace_id}; authoritative_home=${assetHome.authoritative_home}`,
    active_status: "TRUE"
  };
}

function inferWordpressInventoryAssetType(endpointKey = "") {
  const key = String(endpointKey || "").trim();

  if (key === "wordpress_list_tags") return "wordpress_taxonomy_inventory";
  if (key === "wordpress_list_categories") return "wordpress_taxonomy_inventory";
  if (key === "wordpress_list_types") return "wordpress_cpt_inventory";

  return "wordpress_runtime_response";
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

function extractJsonAssetPayloadBody(args = {}) {
  const body = args.response_body;

  if (
    body &&
    typeof body === "object" &&
    !Array.isArray(body)
  ) {
    if (Object.prototype.hasOwnProperty.call(body, "data")) {
      return body.data;
    }
  }

  return body ?? null;
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

function assertExecutionLogRowIsSpillSafe(row) {
  const rowText = JSON.stringify(row);
  if (rowText.length > 50_000) {
    throw new Error("Activity Log row exceeded safe compact-write size.");
  }

  const forbiddenLiteralColumns = [];

  const populated = forbiddenLiteralColumns.filter(
    key => String(row?.[key] ?? "").trim() !== ""
  );

  if (populated.length) {
    const err = new Error(
      `Activity Log row must not provide literal values for formula-managed columns: ${populated.join(", ")}`
    );
    err.code = "formula_managed_columns_literal_value";
    err.status = 500;
    throw err;
  }

  const requiredRawWritebackColumns = [
    "target_module_writeback",
    "target_workflow_writeback",
    "execution_trace_id_writeback",
    "log_source_writeback",
    "monitored_row_writeback",
    "performance_impact_row_writeback"
  ];

  const missingRawValues = requiredRawWritebackColumns.filter(
    key => !Object.prototype.hasOwnProperty.call(row, key)
  );

  if (missingRawValues.length) {
    const err = new Error(
      `Activity Log row missing raw writeback columns: ${missingRawValues.join(", ")}`
    );
    err.code = "missing_raw_writeback_columns";
    err.status = 500;
    throw err;
  }
}

async function persistOversizedArtifact(input = {}) {
  const { drive } = await getGoogleClients();
  const artifact_file_name = buildArtifactFileName({
    brand_name: input.brand_name || input.target_key || "unknown_brand",
    endpoint_key: input.endpoint_key,
    captured_at: input.captured_at,
    execution_trace_id: input.execution_trace_id
  });

  const requestBody = {
    name: artifact_file_name,
    mimeType: "application/json"
  };

  if (OVERSIZED_ARTIFACTS_DRIVE_FOLDER_ID) {
    requestBody.parents = [OVERSIZED_ARTIFACTS_DRIVE_FOLDER_ID];
  }

  const created = await drive.files.create({
    requestBody,
    media: {
      mimeType: "application/json",
      body: JSON.stringify(input.body ?? null, null, 2)
    },
    fields: "id,webViewLink"
  });

  const drive_file_id = String(created?.data?.id || "").trim();
  if (!drive_file_id) {
    throw new Error("Oversized artifact write succeeded without a Drive file id.");
  }

  return {
    drive_file_id,
    google_drive_link:
      String(created?.data?.webViewLink || "").trim() ||
      `https://drive.google.com/file/d/${drive_file_id}/view`,
    artifact_file_name
  };
}

async function performUniversalServerWriteback(input = {}) {
  const started_at = input.started_at || new Date().toISOString();
  const execution_trace_id = input.execution_trace_id ?? createExecutionTraceId();
  const responseBody = input.responseBody;

  const completed_at = new Date().toISOString();
  const durationMs =
    new Date(completed_at).getTime() - new Date(started_at).getTime();
  const duration_seconds =
    Number.isFinite(durationMs) && durationMs >= 0
      ? durationMs / 1000
      : undefined;

  const oversized = isOversizedBody(responseBody);
  const status = mapExecutionStatus(input.status_source);
  const error_code = normalizeExecutionErrorCode(input.error_code);
  const result_classification = classifyExecutionResult({
    status,
    error_code,
    oversized,
    async_mode: input.mode === "async"
  });

  let artifactPointer;
  let jsonAssetRow;
  let artifactJsonAssetId = "";

  const extractedJsonAssetBody = extractJsonAssetPayloadBody({
    parent_action_key: input.parent_action_key,
    response_body: responseBody
  });

  const isMeaningfulJsonAssetBody =
    Array.isArray(extractedJsonAssetBody) ||
    (
      extractedJsonAssetBody &&
      typeof extractedJsonAssetBody === "object" &&
      Object.keys(extractedJsonAssetBody).length > 0 &&
      !isSchemaMetaOnlyPayload(extractedJsonAssetBody)
    );

  const assetHome = classifyAssetHome({
    asset_type: input.asset_type,
    endpoint_key: input.endpoint_key,
    source_asset_ref: input.source_asset_ref,
    asset_key: input.asset_key
  });

  const shouldPersistJsonAsset =
    assetHome.json_asset_allowed &&
    (
      oversized ||
      status === "failed" ||
      (
        status === "success" &&
        isMeaningfulJsonAssetBody
      )
    );

  if (oversized) {
    const artifact = await persistOversizedArtifact({
      brand_name: input.brand_name,
      target_key: input.target_key,
      endpoint_key: input.endpoint_key,
      execution_trace_id,
      captured_at: started_at,
      body: extractedJsonAssetBody
    });

    artifactPointer = {
      drive_file_id: artifact.drive_file_id,
      google_drive_link: artifact.google_drive_link
    };
  }

  if (shouldPersistJsonAsset) {
    const nextAssetKey = `${String(input.endpoint_key || "unknown_endpoint").trim()}__${execution_trace_id}`;
    const existingAssetRow = await findExistingJsonAssetByAssetKey(nextAssetKey);

    if (!existingAssetRow) {
      jsonAssetRow = toJsonAssetRegistryRow({
        brand_name: input.brand_name,
        endpoint_key: input.endpoint_key,
        parent_action_key: input.parent_action_key,
        execution_trace_id,
        google_drive_link: artifactPointer?.google_drive_link || "",
        drive_file_id: artifactPointer?.drive_file_id || "",
        captured_at: completed_at,
        job_id: input.job_id,
        oversized,
        response_body: extractedJsonAssetBody,
        cpt_slug: input.cpt_slug || "",
        asset_type: input.asset_type || assetHome.asset_class,
        asset_key: input.asset_key || `${String(input.endpoint_key || "unknown_endpoint").trim()}__${execution_trace_id}`,
        source_asset_ref: input.source_asset_ref || ""
      });

      artifactJsonAssetId = String(jsonAssetRow.asset_id || "").trim();
    }
  }

  const writeback = {
    execution_trace_id,
    job_id: input.job_id,
    target_key: input.target_key,
    parent_action_key: input.parent_action_key,
    endpoint_key: input.endpoint_key,
    response_body_embedded: !oversized,
    response_body_oversized: oversized,
    route_id: input.route_id,
    target_module: input.target_module,
    target_workflow: input.target_workflow,
    entry_type: oversized
      ? "oversized_capture"
      : EXECUTION_ENTRY_TYPES.has(input.entry_type)
      ? input.entry_type
      : "sync_execution",
    execution_class: oversized
      ? "oversized"
      : EXECUTION_CLASSES.has(input.execution_class)
      ? input.execution_class
      : "sync",
    source_layer: String(input.source_layer || "unknown_layer"),
    status,
    result_classification: EXECUTION_RESULT_CLASSIFICATIONS.has(result_classification)
      ? result_classification
      : "unresolved",
    error_code: error_code || undefined,
    error_message_short: compactErrorMessage(input.error_message_short) || undefined,
    started_at,
    completed_at,
    duration_seconds,
    attempt_count:
      input.attempt_count === undefined || input.attempt_count === null
        ? undefined
        : Number(input.attempt_count),
    output_summary: buildOutputSummary({
      endpoint_key: input.endpoint_key,
      status,
      http_status: input.http_status,
      error_code,
      oversized
    }),
    monitored_row: false,
    performance_impact_row: false,
    log_source: AUTHORITATIVE_RAW_EXECUTION_LOG_SURFACE_ID,
    artifact_pointer: artifactPointer,
    artifact_json_asset_id: artifactJsonAssetId
  };

  let governedSinkSheetTitles = {
    executionLogTitles: [],
    jsonAssetTitles: []
  };
  try {
    governedSinkSheetTitles = await assertGovernedSinkSheetsExist();
  } catch (err) {
    err.error_code = "governed_sink_sheet_missing";
    throw err;
  }

  const row = toExecutionLogUnifiedRow(writeback);
  let executionLogWriteMeta;
  let jsonAssetWriteMeta;
  let workflowLogRetryAttempted = false;
  assertExecutionLogRowIsSpillSafe(row);

  try {
    executionLogWriteMeta = await writeExecutionLogUnifiedRow(row);
  } catch (err) {
    workflowLogRetryAttempted = true;
    try {
      executionLogWriteMeta = await writeExecutionLogUnifiedRow(row);
    } catch (retryErr) {
      retryErr.error_code =
        retryErr.error_code || err.error_code || "authoritative_log_write_failed";
      retryErr.logging_retry_attempted = true;
      retryErr.logging_retry_exhausted = true;
      throw retryErr;
    }
  }

  if (jsonAssetRow) {
    try {
      jsonAssetWriteMeta = await writeJsonAssetRegistryRow(jsonAssetRow);
    } catch (err) {
      // do not erase primary execution truth because registry follow-up failed
      console.error("JSON Asset Registry write failed", err);
    }
  }

  const governedWriteState = {
    execution_log_surface_id: AUTHORITATIVE_RAW_EXECUTION_LOG_SURFACE_ID,
    execution_log_sheet: EXECUTION_LOG_UNIFIED_SHEET,
    json_asset_registry_sheet: JSON_ASSET_REGISTRY_SHEET,
    execution_log_spreadsheet_id: EXECUTION_LOG_UNIFIED_SPREADSHEET_ID,
    json_asset_registry_spreadsheet_id: JSON_ASSET_REGISTRY_SPREADSHEET_ID,
    authoritative_raw_execution_sink: AUTHORITATIVE_RAW_EXECUTION_LOG_SURFACE_ID,
    raw_execution_single_write_enforced: true,
    execution_log_sheet_exists: governedSinkSheetTitles.executionLogTitles.includes(
      String(EXECUTION_LOG_UNIFIED_SHEET || "").trim()
    ),
    json_asset_registry_sheet_exists: governedSinkSheetTitles.jsonAssetTitles.includes(
      String(JSON_ASSET_REGISTRY_SHEET || "").trim()
    ),

    execution_log_header_schema_validated: !!executionLogWriteMeta?.headerSignature,
    execution_log_row2_template_read: !!executionLogWriteMeta?.row2Read,
    execution_log_formula_managed_columns_protected:
      !!executionLogWriteMeta?.formulaManagedColumnsProtected,
    execution_log_readback_verified: true,
    workflow_log_retry_attempted: workflowLogRetryAttempted,
    workflow_log_retry_exhausted: false,

    json_asset_header_schema_validated: jsonAssetRow
      ? !!jsonAssetWriteMeta?.headerSignature
      : null,
    json_asset_row2_template_read: jsonAssetRow
      ? !!jsonAssetWriteMeta?.row2Read
      : null,
    json_asset_readback_verified: jsonAssetRow
      ? !!jsonAssetWriteMeta
      : null,

    prewrite_header_schema_validated:
      !!executionLogWriteMeta?.headerSignature &&
      (jsonAssetRow ? !!jsonAssetWriteMeta?.headerSignature : true),

    prewrite_row2_template_read:
      !!executionLogWriteMeta?.row2Read &&
      (jsonAssetRow ? !!jsonAssetWriteMeta?.row2Read : true),

    execution_log_safe_columns: executionLogWriteMeta?.safeColumns || [],
    execution_log_unsafe_columns: executionLogWriteMeta?.unsafeColumns || [],
    json_asset_safe_columns: jsonAssetWriteMeta?.safeColumns || [],
    json_asset_unsafe_columns: jsonAssetWriteMeta?.unsafeColumns || [],
    asset_class: assetHome.asset_class,
    authoritative_asset_home: assetHome.authoritative_home,
    json_asset_write_allowed: assetHome.json_asset_allowed,
    artifact_json_asset_id: jsonAssetRow?.asset_id || "",
    artifact_drive_file_id: artifactPointer?.drive_file_id || "",
    artifact_google_drive_link: artifactPointer?.google_drive_link || ""
  };

  return {
    execution_trace_id,
    writeback,
    row,
    jsonAssetRow,
    governedWriteState
  };
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

function normalizeExecutionPayload(payload) {
  const safePayload = payload && typeof payload === "object" ? payload : {};
  const query =
    safePayload.query && typeof safePayload.query === "object"
      ? safePayload.query
      : safePayload.params?.query &&
        typeof safePayload.params.query === "object"
      ? safePayload.params.query
      : {};

  const body = Object.prototype.hasOwnProperty.call(safePayload, "body")
    ? safePayload.body
    : undefined;

  const routingFields = normalizeTopLevelRoutingFields(safePayload);

  return {
    ...safePayload,
    ...routingFields,
    query,
    body
  };
}

function normalizeTopLevelRoutingFields(payload = {}) {
  return {
    target_key: payload.target_key,
    brand: payload.brand,
    brand_domain: payload.brand_domain,
    provider_domain: payload.provider_domain,
    parent_action_key: payload.parent_action_key,
    endpoint_key: payload.endpoint_key,
    method: payload.method,
    path: payload.path,
    force_refresh: payload.force_refresh
  };
}

function validatePayloadIntegrity(originalPayload = {}, normalizedPayload = {}) {
  const trackedFields = [
    "target_key",
    "brand",
    "brand_domain",
    "provider_domain",
    "parent_action_key",
    "endpoint_key",
    "method",
    "path"
  ];

  const mismatches = [];

  for (const field of trackedFields) {
    const originalValue = originalPayload[field];
    const normalizedValue = normalizedPayload[field];

    const originalText = originalValue === undefined ? "" : String(originalValue);
    const normalizedText = normalizedValue === undefined ? "" : String(normalizedValue);

    if (originalText !== normalizedText) {
      mismatches.push({
        field,
        original: originalValue ?? "",
        normalized: normalizedValue ?? ""
      });
    }
  }

  return {
    ok: mismatches.length === 0,
    mismatches
  };
}

function validateTopLevelRoutingFields(payload = {}, policies = []) {
  const requireTopLevelSources = String(
    policyValue(
      policies,
      "HTTP Transport Routing",
      "Placeholder Resolution Sources Must Be Top-Level",
      "FALSE"
    )
  ).trim().toUpperCase() === "TRUE";

  const allowNestedSources = String(
    policyValue(
      policies,
      "HTTP Transport Routing",
      "Nested Placeholder Resolution Sources Allowed",
      "TRUE"
    )
  ).trim().toUpperCase() === "TRUE";

  const errors = [];

  const topLevelHasSource =
    !!String(payload.target_key || "").trim() ||
    !!String(payload.brand || "").trim() ||
    !!String(payload.brand_domain || "").trim();

  const nestedBody = payload.body && typeof payload.body === "object" ? payload.body : {};
  const isDelegatedWrapper = isDelegatedHttpExecuteWrapper(payload);

  const nestedHasSource =
    !!String(nestedBody.target_key || "").trim() ||
    !!String(nestedBody.brand || "").trim() ||
    !!String(nestedBody.brand_domain || "").trim();

  if (requireTopLevelSources && payload.provider_domain === "target_resolved" && !topLevelHasSource) {
    errors.push("top-level target_key, brand, or brand_domain is required when provider_domain is target_resolved");
  }

  if (!allowNestedSources && nestedHasSource && !isDelegatedWrapper) {
    errors.push("target_key, brand, and brand_domain must be top-level fields; nested body.* routing fields are not allowed");
  }

  if (payload.target_key !== undefined && typeof payload.target_key !== "string") {
    errors.push("target_key must be a string");
  }

  if (payload.brand !== undefined && typeof payload.brand !== "string") {
    errors.push("brand must be a string");
  }

  if (payload.brand_domain !== undefined && typeof payload.brand_domain !== "string") {
    errors.push("brand_domain must be a string");
  }

  if (payload.provider_domain !== undefined && typeof payload.provider_domain !== "string") {
    errors.push("provider_domain must be a string");
  }

  if (payload.parent_action_key !== undefined && typeof payload.parent_action_key !== "string") {
    errors.push("parent_action_key must be a string");
  }

  if (payload.endpoint_key !== undefined && typeof payload.endpoint_key !== "string") {
    errors.push("endpoint_key must be a string");
  }

  if (payload.method !== undefined && typeof payload.method !== "string") {
    errors.push("method must be a string");
  }

  if (payload.path !== undefined && typeof payload.path !== "string") {
    errors.push("path must be a string");
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

function validateAssetHomePayloadRules(payload = {}) {
  const assetType = normalizeAssetType(payload.asset_type);
  if (!assetType) {
    return { ok: true, errors: [] };
  }

  const classification = classifyAssetHome({
    asset_type: assetType,
    endpoint_key: payload.endpoint_key,
    source_asset_ref: payload.source_asset_ref,
    asset_key: payload.asset_key
  });

  if (
    classification.authoritative_home === "brand_core_registry" &&
    String(payload.force_json_asset_write || "").trim().toUpperCase() === "TRUE"
  ) {
    return {
      ok: false,
      errors: [
        `asset_type=${assetType} must not force JSON Asset Registry write; authoritative home is ${BRAND_CORE_REGISTRY_SHEET}`
      ]
    };
  }

  return { ok: true, errors: [] };
}

function isHttpGenericTransportEndpointKey(endpointKey = "") {
  return [
    "http_get",
    "http_post",
    "http_put",
    "http_patch",
    "http_delete"
  ].includes(String(endpointKey || "").trim());
}

function isDelegatedHttpExecuteWrapper(payload = {}) {
  return (
    String(payload.parent_action_key || "").trim() === "http_generic_api" &&
    isHttpGenericTransportEndpointKey(payload.endpoint_key) &&
    String(payload.path || "").trim() === "/http-execute"
  );
}

function promoteDelegatedExecutionPayload(payload = {}) {
  if (!isDelegatedHttpExecuteWrapper(payload)) {
    return payload;
  }

  const nested = payload.body && typeof payload.body === "object" ? payload.body : {};

  const nestedHeaders =
    nested.headers && typeof nested.headers === "object"
      ? nested.headers
      : undefined;

  const nestedQuery =
    nested.query && typeof nested.query === "object"
      ? nested.query
      : undefined;

  const nestedPathParams =
    nested.path_params && typeof nested.path_params === "object"
      ? nested.path_params
      : undefined;

  return {
    ...payload,

    // routing-source
    target_key: payload.target_key || nested.target_key,
    brand: payload.brand || nested.brand,
    brand_domain: payload.brand_domain || nested.brand_domain,

    // execution-target
    provider_domain: nested.provider_domain || payload.provider_domain,
    parent_action_key: nested.parent_action_key || payload.parent_action_key,
    endpoint_key: nested.endpoint_key || payload.endpoint_key,
    method: nested.method || payload.method,
    path: nested.path || payload.path,
    force_refresh: nested.force_refresh ?? payload.force_refresh,
    timeout_seconds: nested.timeout_seconds ?? payload.timeout_seconds,
    expect_json: nested.expect_json ?? payload.expect_json,
    readback: nested.readback ?? payload.readback,

    headers: nestedHeaders || payload.headers,
    query: nestedQuery || payload.query,
    path_params: nestedPathParams || payload.path_params,
    body: Object.prototype.hasOwnProperty.call(nested, "body")
      ? nested.body
      : payload.body
  };
}

function isHostingerAction(parentActionKey = "") {
  return String(parentActionKey || "").trim() === "hostinger_api";
}

function isSiteTargetKey(targetKey = "") {
  const v = String(targetKey || "").trim();
  if (!v) return false;
  return (
    v.endsWith("_wp") ||
    v.startsWith("site_") ||
    v.startsWith("brand_") ||
    v.includes("_wordpress")
  );
}

function isHostingAccountTargetKey(targetKey = "") {
  const v = String(targetKey || "").trim();
  if (!v) return false;
  return (
    v.startsWith("hostinger_") ||
    v.includes("_shared_manager_") ||
    v.includes("_hosting_account_") ||
    v.includes("_cloud_plan_") ||
    v.includes("_account_")
  );
}

function assertHostingerTargetTier(payload = {}) {
  const parentActionKey = String(payload.parent_action_key || "").trim();
  const endpointKey = String(payload.endpoint_key || "").trim();
  const targetKey = String(payload.target_key || "").trim();

  if (!isHostingerAction(parentActionKey)) {
    return { ok: true };
  }

  if (!targetKey) {
    const err = new Error(
      "Hostinger execution requires an authoritative hosting-account target_key."
    );
    err.code = "hostinger_target_key_missing";
    err.status = 400;
    throw err;
  }

  if (isSiteTargetKey(targetKey) && !isHostingAccountTargetKey(targetKey)) {
    const err = new Error(
      `Hostinger endpoint ${endpointKey} must resolve through a hosting-account target_key, not a WordPress/site target_key (${targetKey}).`
    );
    err.code = "hostinger_target_tier_mismatch";
    err.status = 400;
    throw err;
  }

  return { ok: true };
}

function headerMap(headerRow, sheetName = "unknown_sheet") {
  const map = {};
  const duplicates = [];

  headerRow.forEach((rawName, idx) => {
    const name = String(rawName || "").trim();
    if (!name) return;

    if (Object.prototype.hasOwnProperty.call(map, name)) {
      duplicates.push(name);
      return;
    }

    map[name] = idx;
  });

  if (duplicates.length) {
    const err = new Error(
      `Duplicate headers detected in ${sheetName}: ${[...new Set(duplicates)].join(", ")}`
    );
    err.code = "duplicate_sheet_headers";
    err.status = 500;
    throw err;
  }

  return map;
}

function getCell(row, map, key) {
  const idx = map[key];
  return idx === undefined ? "" : (row[idx] ?? "");
}

async function getGoogleClients() {
  requireEnv("REGISTRY_SPREADSHEET_ID");
  const auth = new google.auth.GoogleAuth({
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive"
    ]
  });
  const client = await auth.getClient();
  return {
    sheets: google.sheets({ version: "v4", auth: client }),
    drive: google.drive({ version: "v3", auth: client })
  };
}

async function getGoogleClientsForSpreadsheet(spreadsheetId) {
  requireEnv("REGISTRY_SPREADSHEET_ID");
  if (!String(spreadsheetId || "").trim()) {
    const err = new Error("Missing required spreadsheet id for governed sink.");
    err.code = "missing_env";
    err.status = 500;
    throw err;
  }
  const auth = new google.auth.GoogleAuth({
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive"
    ]
  });
  const client = await auth.getClient();
  return {
    spreadsheetId: String(spreadsheetId || "").trim(),
    sheets: google.sheets({ version: "v4", auth: client }),
    drive: google.drive({ version: "v3", auth: client })
  };
}

async function assertSheetExistsInSpreadsheet(spreadsheetId, sheetName) {
  const { sheets } = await getGoogleClientsForSpreadsheet(spreadsheetId);
  const response = await sheets.spreadsheets.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    fields: "sheets.properties.title"
  });

  const titles = (response.data.sheets || [])
    .map(s => String(s?.properties?.title || "").trim())
    .filter(Boolean);

  const normalizedSheetName = String(sheetName || "").trim();
  if (!titles.includes(normalizedSheetName)) {
    const err = new Error(
      `Governed sink sheet not found: ${normalizedSheetName}. Available sheets: ${titles.join(", ")}`
    );
    err.code = "sheet_not_found";
    err.status = 500;
    err.available_sheets = titles;
    err.requested_sheet = normalizedSheetName;
    err.spreadsheet_id = String(spreadsheetId || "").trim();
    throw err;
  }

  return titles;
}

async function assertGovernedSinkSheetsExist() {
  const executionLogTitles = await assertSheetExistsInSpreadsheet(
    EXECUTION_LOG_UNIFIED_SPREADSHEET_ID,
    EXECUTION_LOG_UNIFIED_SHEET
  );

  const jsonAssetTitles = await assertSheetExistsInSpreadsheet(
    JSON_ASSET_REGISTRY_SPREADSHEET_ID,
    JSON_ASSET_REGISTRY_SHEET
  );

  return {
    executionLogTitles,
    jsonAssetTitles
  };
}

async function fetchRange(sheets, range) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    range
  });
  return response.data.values || [];
}

function toSheetCellValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return String(value);
}

function toA1Start(sheetName) {
  return toValuesApiRange(sheetName, "A1");
}

async function readLiveSheetShape(spreadsheetId, sheetName, rangeA1) {
  const { sheets } = await getGoogleClientsForSpreadsheet(spreadsheetId);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: rangeA1
  });

  const values = response.data.values || [];
  const header = (values[0] || []).map(v => String(v || "").trim());
  const row2 = (values[1] || []).map(v => String(v || "").trim());

  if (!header.length) {
    const err = new Error(`${sheetName} header row is empty.`);
    err.code = "sheet_header_missing";
    err.status = 500;
    throw err;
  }

  return {
    header,
    row2,
    headerMap: headerMap(header, sheetName),
    columnCount: header.length
  };
}

async function getRegistrySurfaceCatalogRowBySurfaceId(surfaceId = "") {
  const normalizedSurfaceId = String(surfaceId || "").trim();
  if (!normalizedSurfaceId) return null;

  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(REGISTRY_SPREADSHEET_ID || "").trim(),
    range: toValuesApiRange(REGISTRY_SURFACES_CATALOG_SHEET, "A:AG")
  });

  const values = response.data.values || [];
  if (values.length < 2) return null;

  const header = values[0].map(v => String(v || "").trim());
  const map = headerMap(header, REGISTRY_SURFACES_CATALOG_SHEET);

  for (const row of values.slice(1)) {
    const rowSurfaceId = String(getCell(row, map, "surface_id") || "").trim();
    if (rowSurfaceId !== normalizedSurfaceId) continue;

    return {
      surface_id: rowSurfaceId,
      surface_name: String(getCell(row, map, "surface_name") || "").trim(),
      worksheet_name: String(getCell(row, map, "worksheet_name") || "").trim(),
      worksheet_gid: String(getCell(row, map, "worksheet_gid") || "").trim(),
      active_status: String(getCell(row, map, "active_status") || "").trim(),
      authority_status: String(getCell(row, map, "authority_status") || "").trim(),
      required_for_execution: String(getCell(row, map, "required_for_execution") || "").trim(),
      schema_ref: String(getCell(row, map, "schema_ref") || "").trim(),
      schema_version: String(getCell(row, map, "schema_version") || "").trim(),
      header_signature: String(getCell(row, map, "header_signature") || "").trim(),
      expected_column_count: String(getCell(row, map, "expected_column_count") || "").trim(),
      binding_mode: String(getCell(row, map, "binding_mode") || "").trim(),
      sheet_role: String(getCell(row, map, "sheet_role") || "").trim(),
      audit_mode: String(getCell(row, map, "audit_mode") || "").trim(),
      legacy_surface_containment_required: String(
        getCell(row, map, "legacy_surface_containment_required") || ""
      ).trim(),
      repair_candidate_types: String(getCell(row, map, "repair_candidate_types") || "").trim(),
      repair_priority: String(getCell(row, map, "repair_priority") || "").trim()
    };
  }

  return null;
}

function buildExpectedHeaderSignatureFromCanonical(columns = []) {
  return (columns || []).map(v => String(v || "").trim()).join("|");
}

function normalizeExpectedColumnCount(value, fallbackColumns = []) {
  const n = Number(value);
  if (Number.isFinite(n) && n >= 0) return n;
  return Array.isArray(fallbackColumns) ? fallbackColumns.length : 0;
}

async function getCanonicalSurfaceMetadata(surfaceId = "", fallback = {}) {
  const row = await getRegistrySurfaceCatalogRowBySurfaceId(surfaceId);

  if (!row) {
    return {
      source: "fallback_constant",
      surface_id: surfaceId,
      schema_ref: fallback.schema_ref || "",
      schema_version: fallback.schema_version || "",
      header_signature: buildExpectedHeaderSignatureFromCanonical(fallback.columns || []),
      expected_column_count: Array.isArray(fallback.columns) ? fallback.columns.length : 0,
      binding_mode: fallback.binding_mode || "constant_fallback",
      sheet_role: fallback.sheet_role || "",
      audit_mode: fallback.audit_mode || ""
    };
  }

  return {
    source: "registry_surface_catalog",
    surface_id: row.surface_id,
    schema_ref: row.schema_ref,
    schema_version: row.schema_version,
    header_signature:
      row.header_signature || buildExpectedHeaderSignatureFromCanonical(fallback.columns || []),
    expected_column_count: normalizeExpectedColumnCount(
      row.expected_column_count,
      fallback.columns || []
    ),
    binding_mode: row.binding_mode || fallback.binding_mode || "",
    sheet_role: row.sheet_role || fallback.sheet_role || "",
    audit_mode: row.audit_mode || fallback.audit_mode || "",
    authority_status: row.authority_status || "",
    active_status: row.active_status || "",
    required_for_execution: row.required_for_execution || "",
    legacy_surface_containment_required: row.legacy_surface_containment_required || ""
  };
}

function assertHeaderMatchesSurfaceMetadata(args = {}) {
  const sheetName = String(args.sheetName || "sheet").trim();
  const actualHeader = (args.actualHeader || []).map(v => String(v || "").trim());
  const metadata = args.metadata || {};
  const fallbackColumns = args.fallbackColumns || [];

  const expectedColumnCount = normalizeExpectedColumnCount(
    metadata.expected_column_count,
    fallbackColumns
  );

  const expectedSignature =
    String(metadata.header_signature || "").trim() ||
    buildExpectedHeaderSignatureFromCanonical(fallbackColumns);

  const actualSignature = actualHeader.join("|");

  if (expectedColumnCount && actualHeader.length !== expectedColumnCount) {
    const err = new Error(
      `${sheetName} header column count mismatch from surface metadata. expected=${expectedColumnCount} actual=${actualHeader.length}`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  if (expectedSignature && actualSignature !== expectedSignature) {
    const err = new Error(
      `${sheetName} header signature mismatch from surface metadata.`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  if (String(metadata.audit_mode || "").trim() === "exact_header_match") {
    assertCanonicalHeaderExact(actualHeader, fallbackColumns, sheetName);
  }

  return true;
}

function computeHeaderSignature(header = []) {
  return crypto
    .createHash("sha256")
    .update(header.map(v => String(v || "").trim()).join("|"))
    .digest("hex");
}

function assertExpectedColumnsPresent(header = [], required = [], sheetName = "sheet") {
  const missing = required.filter(col => !header.includes(col));
  if (missing.length) {
    const err = new Error(
      `${sheetName} missing required columns: ${missing.join(", ")}`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }
}

function detectUnsafeColumnsFromRow2(header = [], row2 = []) {
  const unsafe = new Set();

  for (let i = 0; i < header.length; i += 1) {
    const colName = String(header[i] || "").trim();
    const sample = String(row2[i] || "").trim();

    if (!colName) continue;

    const looksFormula =
      sample.startsWith("=") ||
      sample.includes("ARRAYFORMULA(") ||
      sample.includes("=arrayformula(");

    if (looksFormula) {
      unsafe.add(colName);
    }
  }

  return unsafe;
}

function buildGovernedWritePlan(args = {}) {
  const protectedColumns = args.protectedColumns || new Set();
  const unsafeFromRow2 = detectUnsafeColumnsFromRow2(args.header, args.row2);

  const safeColumns = [];
  const unsafeColumns = [];

  for (const col of args.requestedColumns || []) {
    if (!args.header.includes(col)) {
      unsafeColumns.push(col);
      continue;
    }

    if (protectedColumns.has(col)) {
      unsafeColumns.push(col);
      continue;
    }

    if (unsafeFromRow2.has(col)) {
      unsafeColumns.push(col);
      continue;
    }

    safeColumns.push(col);
  }

  return {
    header: args.header || [],
    row2: args.row2 || [],
    safeColumns,
    unsafeColumns
  };
}

function assertExecutionLogFormulaColumnsProtected(plan = {}, sheetName = "Execution Log Unified") {
  const missingRawColumns = EXECUTION_LOG_UNIFIED_RAW_WRITEBACK_COLUMNS.filter(
    col => !(plan.header || []).includes(col)
  );

  if (missingRawColumns.length) {
    const err = new Error(
      `${sheetName} missing raw writeback columns: ${missingRawColumns.join(", ")}`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }
}

function buildFullWidthGovernedRow(header = [], safeColumns = [], rowObject = {}) {
  const safeSet = new Set(safeColumns);
  return header.map(col => {
    const columnName = String(col || "").trim();
    if (!columnName) return "";
    if (!safeSet.has(columnName)) return "";
    return toSheetCellValue(rowObject[columnName]);
  });
}

function buildColumnSliceRow(columns = [], rowObject = {}) {
  return columns.map(col => toSheetCellValue(rowObject[col]));
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

async function loadLiveGovernedChangeControlPolicies() {
  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);
  const rows = await fetchRange(
    sheets,
    toValuesApiRange(EXECUTION_POLICY_SHEET, "A:H")
  );

  if (!rows.length) {
    const err = new Error("Execution Policy Registry is empty.");
    err.code = "policy_registry_unavailable";
    err.status = 500;
    throw err;
  }

  const header = rows[0].map(v => String(v || "").trim());
  const map = headerMap(header, EXECUTION_POLICY_SHEET);
  const body = rows.slice(1);

  return body
    .filter(row => {
      const group = String(getCell(row, map, "policy_group") || "").trim();
      const active = String(getCell(row, map, "active") || "").trim().toUpperCase();
      return group === "Governed Change Control" && active === "TRUE";
    })
    .map(row => ({
      policy_group: String(getCell(row, map, "policy_group") || "").trim(),
      policy_key: String(getCell(row, map, "policy_key") || "").trim(),
      policy_value: String(getCell(row, map, "policy_value") || "").trim(),
      active: String(getCell(row, map, "active") || "").trim(),
      execution_scope: String(getCell(row, map, "execution_scope") || "").trim(),
      owner_module: String(getCell(row, map, "owner_module") || "").trim(),
      enforcement_required: String(getCell(row, map, "enforcement_required") || "").trim(),
      notes: String(getCell(row, map, "notes") || "").trim()
    }));
}

function governedPolicyValue(policies = [], key = "", fallback = "") {
  const row = policies.find(
    policy => String(policy.policy_key || "").trim() === String(key || "").trim()
  );
  return row ? String(row.policy_value || "").trim() : fallback;
}

function governedPolicyEnabled(policies = [], key = "", fallback = false) {
  const fallbackText = fallback ? "TRUE" : "FALSE";
  return (
    String(governedPolicyValue(policies, key, fallbackText)).trim().toUpperCase() === "TRUE"
  );
}

async function readRelevantExistingRowWindow(
  spreadsheetId,
  sheetName,
  scanRangeA1 = "A:Z"
) {
  const { sheets } = await getGoogleClientsForSpreadsheet(spreadsheetId);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toValuesApiRange(sheetName, scanRangeA1)
  });

  const values = response.data.values || [];
  const header = (values[0] || []).map(v => String(v || "").trim());
  const rows = values.slice(1);

  return {
    header,
    headerMap: headerMap(header, sheetName),
    rows
  };
}

function normalizeSemanticValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function findSemanticDuplicateRows(header = [], rows = [], rowObject = {}) {
  if (!header.length || !rows.length) return [];

  const candidateKeys = Object.keys(rowObject).filter(
    key => normalizeSemanticValue(rowObject[key]) !== ""
  );

  if (!candidateKeys.length) return [];

  return rows
    .map((row, idx) => {
      let score = 0;
      for (const key of candidateKeys) {
        const colIdx = header.indexOf(key);
        if (colIdx === -1) continue;
        if (
          normalizeSemanticValue(row[colIdx]) ===
          normalizeSemanticValue(rowObject[key])
        ) {
          score += 1;
        }
      }
      return { rowNumber: idx + 2, score, row };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

function classifyGovernedMutationIntent(args = {}) {
  const {
    mutationType = "append",
    duplicateCandidates = [],
    targetRowNumber = null,
    renameOnly = false,
    mergeCandidate = false
  } = args;

  if (mutationType === "append") {
    if (duplicateCandidates.length) return "blocked_duplicate";
    return "append_new";
  }

  if (mutationType === "update") {
    if (renameOnly) return "rename_existing";
    if (mergeCandidate) return "merge_existing";
    if (targetRowNumber) return "update_existing";
    return "blocked_policy_unconfirmed";
  }

  if (mutationType === "delete") {
    return targetRowNumber ? "update_existing" : "blocked_policy_unconfirmed";
  }

  if (mutationType === "repair") {
    return targetRowNumber ? "update_existing" : "blocked_policy_unconfirmed";
  }

  return "blocked_policy_unconfirmed";
}

function resolveGovernedTargetRowNumber(args = {}) {
  const {
    targetRowNumber = null,
    duplicateCandidates = []
  } = args;

  if (Number.isInteger(targetRowNumber) && targetRowNumber >= 2) {
    return targetRowNumber;
  }

  if (duplicateCandidates.length === 1) {
    return duplicateCandidates[0].rowNumber;
  }

  return null;
}

async function enforceGovernedMutationPreflight(args = {}) {
  const {
    spreadsheetId,
    sheetName,
    rowObject = {},
    mutationType = "append",
    scanRangeA1 = "A:Z",
    targetRowNumber = null,
    renameOnly = false,
    mergeCandidate = false
  } = args;

  const policies = await loadLiveGovernedChangeControlPolicies();

  if (
    governedPolicyEnabled(
      policies,
      "Live Policy Read Required Before Any Mutation",
      true
    ) !== true
  ) {
    const err = new Error("Live governed change-control policy confirmation failed.");
    err.code = "governed_policy_confirmation_failed";
    err.status = 500;
    throw err;
  }

  const appliesToAllSheets = governedPolicyEnabled(
    policies,
    "Applies To All Authoritative System Sheets",
    true
  );

  if (!appliesToAllSheets) {
    return {
      ok: true,
      classification: "append_new",
      duplicateCandidates: [],
      consultedPolicyKeys: policies.map(p => p.policy_key),
      consultedExistingRows: [],
      enforcementBypassed: true
    };
  }

  const existingWindow = await readRelevantExistingRowWindow(
    spreadsheetId,
    sheetName,
    scanRangeA1
  );

  const duplicateCandidates = governedPolicyEnabled(
    policies,
    "Semantic Duplicate Check Required Before Append",
    true
  )
    ? findSemanticDuplicateRows(existingWindow.header, existingWindow.rows, rowObject)
    : [];

  const isHighRiskSheet = HIGH_RISK_GOVERNED_SHEETS.has(String(sheetName || "").trim());
  const resolvedTargetRowNumber = resolveGovernedTargetRowNumber({
    targetRowNumber,
    duplicateCandidates
  });
  const classification = classifyGovernedMutationIntent({
    mutationType,
    duplicateCandidates,
    targetRowNumber: resolvedTargetRowNumber,
    renameOnly,
    mergeCandidate
  });

  if (
    mutationType === "append" &&
    duplicateCandidates.length &&
    governedPolicyEnabled(
      policies,
      "Append Forbidden When Update Or Rename Suffices",
      true
    )
  ) {
    const err = new Error(
      `${sheetName} append blocked because semantically equivalent live rows already exist.`
    );
    err.code = "governed_duplicate_append_blocked";
    err.status = 409;
    err.mutation_classification = "blocked_duplicate";
    err.duplicate_candidates = duplicateCandidates.slice(0, 5).map(item => ({
      rowNumber: item.rowNumber,
      score: item.score
    }));
    err.consulted_policy_keys = policies.map(p => p.policy_key);
    throw err;
  }

  if (
    mutationType !== "append" &&
    !resolvedTargetRowNumber &&
    governedPolicyEnabled(
      policies,
      "Pre-Mutation Change Classification Required",
      true
    )
  ) {
    const err = new Error(
      `${sheetName} ${mutationType} blocked because no governed target row could be resolved.`
    );
    err.code = "governed_target_row_unresolved";
    err.status = 409;
    err.mutation_classification = "blocked_policy_unconfirmed";
    err.consulted_policy_keys = policies.map(p => p.policy_key);
    throw err;
  }

  return {
    ok: true,
    classification,
    mutationType,
    targetRowNumber: resolvedTargetRowNumber,
    duplicateCandidates: duplicateCandidates.slice(0, 5).map(item => ({
      rowNumber: item.rowNumber,
      score: item.score
    })),
    consultedPolicyKeys: policies.map(p => p.policy_key),
    consultedExistingRows: duplicateCandidates.slice(0, 5).map(item => item.rowNumber),
    highRiskSheet: isHighRiskSheet
  };
}

function columnLetter(colIndex) {
  let letter = "";
  while (colIndex > 0) {
    let temp = (colIndex - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    colIndex = (colIndex - temp - 1) / 26;
  }
  return letter;
}

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
  if (!Number.isInteger(targetRowNumber) || targetRowNumber < 2) {
    const err = new Error(`${sheetName} update requires a valid target row number.`);
    err.code = "invalid_target_row_number";
    err.status = 400;
    throw err;
  }

  if (!safeColumns.length) {
    const err = new Error(`${sheetName} has no safe writable columns.`);
    err.code = "no_safe_write_columns";
    err.status = 500;
    throw err;
  }

  const range = `${String(sheetName || "").trim()}!A${targetRowNumber}:${columnLetter(header.length)}${targetRowNumber}`;
  const fullRow = buildFullWidthGovernedRow(header, safeColumns, rowObject);

  await sheets.spreadsheets.values.update({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range,
    valueInputOption: "RAW",
    requestBody: {
      majorDimension: "ROWS",
      values: [fullRow]
    }
  });

  return {
    targetRowNumber,
    preflight
  };
}

async function deleteSheetRowGoverned(
  sheets,
  spreadsheetId,
  sheetName,
  targetRowNumber,
  preflight = null
) {
  if (!Number.isInteger(targetRowNumber) || targetRowNumber < 2) {
    const err = new Error(`${sheetName} delete requires a valid target row number.`);
    err.code = "invalid_target_row_number";
    err.status = 400;
    throw err;
  }

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    fields: "sheets.properties(sheetId,title)"
  });

  const sheet = (meta.data.sheets || []).find(
    s => String(s?.properties?.title || "").trim() === String(sheetName || "").trim()
  );

  if (!sheet?.properties?.sheetId && sheet?.properties?.sheetId !== 0) {
    const err = new Error(`Sheet not found for delete: ${sheetName}`);
    err.code = "sheet_not_found";
    err.status = 404;
    throw err;
  }

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: String(spreadsheetId || "").trim(),
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: Number(sheet.properties.sheetId),
              dimension: "ROWS",
              startIndex: targetRowNumber - 1,
              endIndex: targetRowNumber
            }
          }
        }
      ]
    }
  });

  return {
    targetRowNumber,
    preflight
  };
}

async function performGovernedSheetMutation(args = {}) {
  const {
    spreadsheetId,
    sheetName,
    mutationType = "append",
    rowObject = {},
    safeColumns = [],
    header = [],
    targetRowNumber = null,
    scanRangeA1 = "A:Z"
  } = args;

  const { sheets } = await getGoogleClientsForSpreadsheet(spreadsheetId);

  const preflight = await enforceGovernedMutationPreflight({
    spreadsheetId,
    sheetName,
    rowObject,
    mutationType,
    scanRangeA1,
    targetRowNumber
  });

  if (mutationType === "append") {
    if (sheetName === EXECUTION_LOG_UNIFIED_SHEET) {
      return await appendExecutionLogUnifiedRowGoverned(
        sheets,
        spreadsheetId,
        sheetName,
        header,
        rowObject,
        preflight
      );
    }

    return await appendSheetRowGoverned(
      sheets,
      spreadsheetId,
      sheetName,
      header,
      safeColumns,
      rowObject,
      preflight
    );
  }

  if (mutationType === "update" || mutationType === "repair") {
    return await updateSheetRowGoverned(
      sheets,
      spreadsheetId,
      sheetName,
      header,
      safeColumns,
      rowObject,
      preflight.targetRowNumber,
      preflight
    );
  }

  if (mutationType === "delete") {
    return await deleteSheetRowGoverned(
      sheets,
      spreadsheetId,
      sheetName,
      preflight.targetRowNumber,
      preflight
    );
  }

  const err = new Error(`Unsupported governed mutation type: ${mutationType}`);
  err.code = "unsupported_governed_mutation_type";
  err.status = 400;
  throw err;
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
  if (!safeColumns.length) {
    const err = new Error(`${sheetName} has no safe writable columns.`);
    err.code = "no_safe_write_columns";
    err.status = 500;
    throw err;
  }

  const fullRow = buildFullWidthGovernedRow(header, safeColumns, rowObject);

  await sheets.spreadsheets.values.append({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toA1Start(sheetName),
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [fullRow]
    }
  });

  return {
    preflight
  };
}

async function appendExecutionLogUnifiedRowGoverned(
  sheets,
  spreadsheetId,
  sheetName,
  header,
  rowObject,
  preflight = null
) {
  const requiredRawColumns = EXECUTION_LOG_UNIFIED_RAW_WRITEBACK_COLUMNS.filter(
    col => !header.includes(col)
  );

  if (requiredRawColumns.length) {
    const err = new Error(
      `${sheetName} missing raw writeback columns: ${requiredRawColumns.join(", ")}`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const fullRow = buildFullWidthGovernedRow(
    header,
    EXECUTION_LOG_UNIFIED_COLUMNS,
    rowObject
  );

  const appendResponse = await sheets.spreadsheets.values.append({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toA1Start(sheetName),
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    includeValuesInResponse: false,
    requestBody: {
      values: [fullRow]
    }
  });

  const updatedRange = String(
    appendResponse?.data?.updates?.updatedRange || ""
  ).trim();

  const rowMatch = updatedRange.match(/![A-Z]+(\d+):/);
  const appendedRowNumber = rowMatch ? Number(rowMatch[1]) : NaN;

  if (!Number.isFinite(appendedRowNumber) || appendedRowNumber < 2) {
    const err = new Error(
      `${sheetName} append succeeded but appended row number could not be determined.`
    );
    err.code = "sheet_append_row_unknown";
    err.status = 500;
    throw err;
  }

  const rawWritebackValues = buildColumnSliceRow(
    EXECUTION_LOG_UNIFIED_RAW_WRITEBACK_COLUMNS,
    rowObject
  );

  await sheets.spreadsheets.values.update({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toValuesApiRange(
      sheetName,
      `${EXECUTION_LOG_UNIFIED_RAW_WRITEBACK_START_COLUMN}${appendedRowNumber}:${EXECUTION_LOG_UNIFIED_RAW_WRITEBACK_END_COLUMN}${appendedRowNumber}`
    ),
    valueInputOption: "RAW",
    requestBody: {
      values: [rawWritebackValues]
    }
  });

  return { appendedRowNumber, preflight };
}

async function verifyAppendReadback(
  spreadsheetId,
  sheetName,
  expectedStartTime,
  expectedSummary,
  expectedStatus,
  expectedEntryType,
  expectedArtifactJsonAssetId = "",
  expectedRawWriteback = {}
) {
  const { sheets } = await getGoogleClientsForSpreadsheet(spreadsheetId);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toValuesApiRange(sheetName, "A:AQ")
  });

  const values = response.data.values || [];
  if (values.length < 2) {
    const err = new Error(`${sheetName} readback returned no data rows.`);
    err.code = "sheet_readback_failed";
    err.status = 500;
    throw err;
  }

  const header = values[0].map(v => String(v || "").trim());
  const rows = values.slice(1);
  const map = headerMap(header, sheetName);

  const startIdx = map["Start Time"];
  const summaryIdx = map["Output Summary"];
  const statusIdx = map["Execution Status"];
  const entryTypeIdx = map["Entry Type"];
  const artifactJsonAssetIdIdx = map["artifact_json_asset_id"];
  const targetModuleWritebackIdx = map["target_module_writeback"];
  const targetWorkflowWritebackIdx = map["target_workflow_writeback"];
  const executionTraceIdWritebackIdx = map["execution_trace_id_writeback"];
  const logSourceWritebackIdx = map["log_source_writeback"];
  const monitoredRowWritebackIdx = map["monitored_row_writeback"];
  const performanceImpactRowWritebackIdx = map["performance_impact_row_writeback"];

  if (
    startIdx === undefined ||
    summaryIdx === undefined ||
    statusIdx === undefined ||
    entryTypeIdx === undefined ||
    targetModuleWritebackIdx === undefined ||
    targetWorkflowWritebackIdx === undefined ||
    executionTraceIdWritebackIdx === undefined ||
    logSourceWritebackIdx === undefined ||
    monitoredRowWritebackIdx === undefined ||
    performanceImpactRowWritebackIdx === undefined
  ) {
    const err = new Error(`${sheetName} readback missing verification columns.`);
    err.code = "sheet_readback_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const matched = rows.some(row => {
    const start = String(row[startIdx] || "").trim();
    const summary = String(row[summaryIdx] || "").trim();
    const status = String(row[statusIdx] || "").trim();
    const entryType = String(row[entryTypeIdx] || "").trim();
    const artifactJsonAssetId =
      artifactJsonAssetIdIdx === undefined
        ? ""
        : String(row[artifactJsonAssetIdIdx] || "").trim();
    const targetModuleWriteback = String(row[targetModuleWritebackIdx] || "").trim();
    const targetWorkflowWriteback = String(row[targetWorkflowWritebackIdx] || "").trim();
    const executionTraceIdWriteback = String(row[executionTraceIdWritebackIdx] || "").trim();
    const logSourceWriteback = String(row[logSourceWritebackIdx] || "").trim();
    const monitoredRowWriteback = String(row[monitoredRowWritebackIdx] || "").trim();
    const performanceImpactRowWriteback = String(row[performanceImpactRowWritebackIdx] || "").trim();

    return (
      start === String(expectedStartTime || "").trim() &&
      summary === String(expectedSummary || "").trim() &&
      status === String(expectedStatus || "").trim() &&
      entryType === String(expectedEntryType || "").trim() &&
      artifactJsonAssetId === String(expectedArtifactJsonAssetId || "").trim() &&
      targetModuleWriteback === String(expectedRawWriteback.target_module_writeback || "").trim() &&
      targetWorkflowWriteback === String(expectedRawWriteback.target_workflow_writeback || "").trim() &&
      executionTraceIdWriteback === String(expectedRawWriteback.execution_trace_id_writeback || "").trim() &&
      logSourceWriteback === String(expectedRawWriteback.log_source_writeback || "").trim() &&
      monitoredRowWriteback === String(expectedRawWriteback.monitored_row_writeback || "").trim() &&
      performanceImpactRowWriteback === String(expectedRawWriteback.performance_impact_row_writeback || "").trim()
    );
  });

  if (!matched) {
    const err = new Error(`${sheetName} readback could not verify appended row.`);
    err.code = "sheet_readback_verification_failed";
    err.status = 500;
    throw err;
  }
}

async function verifyJsonAssetAppendReadback(
  spreadsheetId,
  sheetName,
  expectedAssetId,
  expectedAssetType,
  expectedSourceAssetRef,
  expectedGoogleDriveLink,
  expectedJsonPayload = ""
) {
  const { sheets } = await getGoogleClientsForSpreadsheet(spreadsheetId);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toValuesApiRange(sheetName, "A:AZ")
  });

  const values = response.data.values || [];
  if (values.length < 2) {
    const err = new Error(`${sheetName} readback returned no data rows.`);
    err.code = "sheet_readback_failed";
    err.status = 500;
    throw err;
  }

  const header = values[0].map(v => String(v || "").trim());
  const rows = values.slice(1);
  const map = headerMap(header, sheetName);
  const assetIdIdx = map.asset_id;
  const assetTypeIdx = map.asset_type;
  const sourceAssetRefIdx = map.source_asset_ref;
  const googleDriveLinkIdx = map.google_drive_link;
  const jsonPayloadIdx = map.json_payload;

  if (
    assetIdIdx === undefined ||
    assetTypeIdx === undefined ||
    sourceAssetRefIdx === undefined ||
    googleDriveLinkIdx === undefined ||
    jsonPayloadIdx === undefined
  ) {
    const err = new Error(`${sheetName} readback missing verification columns.`);
    err.code = "sheet_readback_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const matched = rows.some(row => {
    const assetId = String(row[assetIdIdx] || "").trim();
    const assetType = String(row[assetTypeIdx] || "").trim();
    const sourceAssetRef = String(row[sourceAssetRefIdx] || "").trim();
    const googleDriveLink = String(row[googleDriveLinkIdx] || "").trim();
    const jsonPayload = String(row[jsonPayloadIdx] || "").trim();
    return (
      assetId === String(expectedAssetId || "").trim() &&
      assetType === String(expectedAssetType || "").trim() &&
      sourceAssetRef === String(expectedSourceAssetRef || "").trim() &&
      googleDriveLink === String(expectedGoogleDriveLink || "").trim() &&
      jsonPayload === String(expectedJsonPayload || "").trim()
    );
  });

  if (!matched) {
    const err = new Error(`${sheetName} readback could not verify appended row.`);
    err.code = "sheet_readback_verification_failed";
    err.status = 500;
    throw err;
  }
}

async function writeExecutionLogUnifiedRow(row) {
  const { sheets } = await getGoogleClients();

  const live = await readLiveSheetShape(
    EXECUTION_LOG_UNIFIED_SPREADSHEET_ID,
    EXECUTION_LOG_UNIFIED_SHEET,
    EXECUTION_LOG_UNIFIED_RANGE
  );

  assertExpectedColumnsPresent(
    live.header,
    EXECUTION_LOG_UNIFIED_COLUMNS,
    EXECUTION_LOG_UNIFIED_SHEET
  );

  if (live.columnCount < EXECUTION_LOG_UNIFIED_COLUMNS.length) {
    const err = new Error(
      `${EXECUTION_LOG_UNIFIED_SHEET} column count is lower than expected.`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const expectedHeaderSignature = computeHeaderSignature(
    EXECUTION_LOG_UNIFIED_COLUMNS
  );
  const alignedLiveHeaderSignature = computeHeaderSignature(
    live.header.slice(0, EXECUTION_LOG_UNIFIED_COLUMNS.length)
  );
  const headerSignature = computeHeaderSignature(live.header);
  if (!headerSignature || !expectedHeaderSignature) {
    const err = new Error(
      `${EXECUTION_LOG_UNIFIED_SHEET} header signature could not be computed.`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }
  if (alignedLiveHeaderSignature !== expectedHeaderSignature) {
    const err = new Error(
      `${EXECUTION_LOG_UNIFIED_SHEET} header signature mismatch.`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const plan = buildGovernedWritePlan({
    sheetName: EXECUTION_LOG_UNIFIED_SHEET,
    header: live.header,
    row2: live.row2,
    requestedColumns: EXECUTION_LOG_UNIFIED_COLUMNS,
    protectedColumns: PROTECTED_UNIFIED_LOG_COLUMNS
  });

  assertExecutionLogFormulaColumnsProtected(
    plan,
    EXECUTION_LOG_UNIFIED_SHEET
  );

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: EXECUTION_LOG_UNIFIED_SPREADSHEET_ID,
    sheetName: EXECUTION_LOG_UNIFIED_SHEET,
    mutationType: "append",
    rowObject: row,
    header: live.header,
    safeColumns: plan.safeColumns,
    scanRangeA1: "A:AQ"
  });

  await verifyAppendReadback(
    EXECUTION_LOG_UNIFIED_SPREADSHEET_ID,
    EXECUTION_LOG_UNIFIED_SHEET,
    row["Start Time"],
    row["Output Summary"],
    row["Execution Status"],
    row["Entry Type"],
    row.artifact_json_asset_id,
    {
      target_module_writeback: row.target_module_writeback,
      target_workflow_writeback: row.target_workflow_writeback,
      execution_trace_id_writeback: row.execution_trace_id_writeback,
      log_source_writeback: row.log_source_writeback,
      monitored_row_writeback: row.monitored_row_writeback,
      performance_impact_row_writeback: row.performance_impact_row_writeback
    }
  );

  return {
    headerSignature,
    expectedHeaderSignature,
    row2Read: true,
    formulaManagedColumnsProtected: true,
    preflight: mutationResult.preflight,
    safeColumns: plan.safeColumns,
    unsafeColumns: plan.unsafeColumns
  };
}

async function writeJsonAssetRegistryRow(row) {
  const { sheets } = await getGoogleClients();

  const live = await readLiveSheetShape(
    JSON_ASSET_REGISTRY_SPREADSHEET_ID,
    JSON_ASSET_REGISTRY_SHEET,
    JSON_ASSET_REGISTRY_RANGE
  );

  assertExpectedColumnsPresent(
    live.header,
    JSON_ASSET_REGISTRY_COLUMNS,
    JSON_ASSET_REGISTRY_SHEET
  );

  if (live.columnCount < JSON_ASSET_REGISTRY_COLUMNS.length) {
    const err = new Error(
      `${JSON_ASSET_REGISTRY_SHEET} column count is lower than expected.`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const expectedHeaderSignature = computeHeaderSignature(
    JSON_ASSET_REGISTRY_COLUMNS
  );
  const alignedLiveHeaderSignature = computeHeaderSignature(
    live.header.slice(0, JSON_ASSET_REGISTRY_COLUMNS.length)
  );
  const headerSignature = computeHeaderSignature(live.header);
  if (!headerSignature || !expectedHeaderSignature) {
    const err = new Error(
      `${JSON_ASSET_REGISTRY_SHEET} header signature could not be computed.`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }
  if (alignedLiveHeaderSignature !== expectedHeaderSignature) {
    const err = new Error(
      `${JSON_ASSET_REGISTRY_SHEET} header signature mismatch.`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const plan = buildGovernedWritePlan({
    sheetName: JSON_ASSET_REGISTRY_SHEET,
    header: live.header,
    row2: live.row2,
    requestedColumns: JSON_ASSET_REGISTRY_COLUMNS,
    protectedColumns: new Set()
  });

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: JSON_ASSET_REGISTRY_SPREADSHEET_ID,
    sheetName: JSON_ASSET_REGISTRY_SHEET,
    mutationType: "append",
    rowObject: row,
    header: live.header,
    safeColumns: plan.safeColumns,
    scanRangeA1: "A:Q"
  });

  await verifyJsonAssetAppendReadback(
    JSON_ASSET_REGISTRY_SPREADSHEET_ID,
    JSON_ASSET_REGISTRY_SHEET,
    row.asset_id,
    row.asset_type,
    row.source_asset_ref,
    row.google_drive_link,
    row.json_payload
  );

  return {
    headerSignature,
    expectedHeaderSignature,
    row2Read: true,
    preflight: mutationResult.preflight,
    safeColumns: plan.safeColumns,
    unsafeColumns: plan.unsafeColumns
  };
}

async function loadBrandRegistry(sheets) {
  const values = await fetchRange(sheets, `'${BRAND_REGISTRY_SHEET}'!A1:CX1000`);
  if (!values.length) throw registryError("Brand Registry");
  const headers = values[0];
  const map = headerMap(headers, BRAND_REGISTRY_SHEET);

  return values
    .slice(1)
    .map(row => ({
      brand_name: getCell(row, map, "Brand Name"),
      normalized_brand_name: getCell(row, map, "Normalized Brand Name"),
      brand_domain: getCell(row, map, "brand_domain"),
      target_key: getCell(row, map, "target_key"),
      site_aliases_json: getCell(row, map, "site_aliases_json"),
      base_url: getCell(row, map, "base_url"),
      transport_action_key: getCell(row, map, "transport_action_key"),
      auth_type: getCell(row, map, "auth_type"),
      credential_resolution: getCell(row, map, "credential_resolution"),
      username: getCell(row, map, "username"),
      application_password: getCell(row, map, "application_password"),
      default_headers_json: getCell(row, map, "default_headers_json"),
      write_allowed: getCell(row, map, "write_allowed"),
      destructive_allowed: getCell(row, map, "destructive_allowed"),
      transport_enabled: getCell(row, map, "transport_enabled"),
      target_resolution_mode: getCell(row, map, "target_resolution_mode"),

      // hosting linkage
      hosting_provider: getCell(row, map, "hosting_provider"),
      hosting_account_key: getCell(row, map, "hosting_account_key"),
      hostinger_api_target_key: getCell(row, map, "hostinger_api_target_key"),
      server_environment_label: getCell(row, map, "server_environment_label"),
      server_environment_type: getCell(row, map, "server_environment_type"),
      server_region_or_datacenter: getCell(row, map, "server_region_or_datacenter"),
      server_primary_domain: getCell(row, map, "server_primary_domain"),
      server_panel_reference: getCell(row, map, "server_panel_reference"),
      hosting_account_registry_ref: getCell(row, map, "hosting_account_registry_ref")
    }))
    .filter(r => r.brand_name || r.target_key || r.base_url);
}

async function loadHostingAccountRegistry(sheets) {
  const values = await fetchRange(
    sheets,
    `'${HOSTING_ACCOUNT_REGISTRY_SHEET}'!A1:AZ1000`
  );
  if (!values.length) throw registryError("Hosting Account Registry");

  const headers = values[0];
  const map = headerMap(headers, HOSTING_ACCOUNT_REGISTRY_SHEET);
  const requiredHostingColumns = HOSTING_ACCOUNT_REGISTRY_COLUMNS;

  for (const col of requiredHostingColumns) {
    if (!Object.prototype.hasOwnProperty.call(map, col)) {
      const err = new Error(
        `Hosting Account Registry missing required column: ${col}`
      );
      err.code = "registry_schema_mismatch";
      err.status = 500;
      throw err;
    }
  }

  return values
    .slice(1)
    .map(row => ({
      hosting_account_key: getCell(row, map, "hosting_account_key"),
      hosting_provider: getCell(row, map, "hosting_provider"),
      account_identifier: getCell(row, map, "account_identifier"),
      api_auth_mode: getCell(row, map, "api_auth_mode"),
      api_key_reference: getCell(row, map, "api_key_reference"),
      api_key_storage_mode: getCell(row, map, "api_key_storage_mode"),
      plan_label: getCell(row, map, "plan_label"),
      plan_type: getCell(row, map, "plan_type"),
      account_scope_notes: getCell(row, map, "account_scope_notes"),
      status: getCell(row, map, "status"),
      last_reviewed_at: getCell(row, map, "last_reviewed_at"),

      brand_sites_json: getCell(row, map, "brand_sites_json"),
      resolver_target_keys_json: getCell(row, map, "resolver_target_keys_json"),
      auth_validation_status: getCell(row, map, "auth_validation_status"),
      endpoint_binding_status: getCell(row, map, "endpoint_binding_status"),
      resolver_execution_ready: getCell(row, map, "resolver_execution_ready"),
      last_runtime_check_at: getCell(row, map, "last_runtime_check_at"),

      // Hostinger SSH runtime details are governed as columns in Hosting Account Registry.
      server_environment_type: getCell(row, map, "server_environment_type"),
      server_panel_reference: getCell(row, map, "server_panel_reference"),
      ssh_available: getCell(row, map, "ssh_available"),
      ssh_enabled: getCell(row, map, "ssh_enabled"),
      ssh_source: getCell(row, map, "ssh_source"),
      ssh_host: getCell(row, map, "ssh_host"),
      ssh_port: getCell(row, map, "ssh_port"),
      ssh_username: getCell(row, map, "ssh_username"),
      ssh_auth_mode: getCell(row, map, "ssh_auth_mode"),
      ssh_credential_reference: getCell(row, map, "ssh_credential_reference"),
      ssh_runtime_notes: getCell(row, map, "ssh_runtime_notes"),
      account_mode: getCell(row, map, "account_mode"),
      shared_access_enabled: getCell(row, map, "shared_access_enabled"),
      sftp_available: getCell(row, map, "sftp_available"),
      wp_cli_available: getCell(row, map, "wp_cli_available"),
      last_validated_at: getCell(row, map, "last_validated_at")
    }))
    .filter(r => r.hosting_account_key);
}

async function loadActionsRegistry(sheets) {
  const values = await fetchRange(sheets, `'${ACTIONS_REGISTRY_SHEET}'!A1:AM1000`);
  if (!values.length) throw registryError("Actions Registry");
  const headers = values[0];
  const map = headerMap(headers, ACTIONS_REGISTRY_SHEET);
  return values.slice(1).map(row => ({
    action_key: getCell(row, map, "action_key"),
    status: getCell(row, map, "status"),
    module_binding: getCell(row, map, "module_binding"),
    connector_family: getCell(row, map, "connector_family"),
    api_key_mode: getCell(row, map, "api_key_mode"),
    api_key_param_name: getCell(row, map, "api_key_param_name"),
    api_key_header_name: getCell(row, map, "api_key_header_name"),
    api_key_value: getCell(row, map, "api_key_value"),
    api_key_storage_mode: getCell(row, map, "api_key_storage_mode"),
    openai_schema_file_id: getCell(row, map, "openai_schema_file_id"),
    oauth_config_file_id: getCell(row, map, "oauth_config_file_id"),
    oauth_config_file_name: getCell(row, map, "oauth_config_file_name"),
    runtime_capability_class: getCell(row, map, "runtime_capability_class"),
    runtime_callable: getCell(row, map, "runtime_callable"),
    primary_executor: getCell(row, map, "primary_executor"),
    notes: getCell(row, map, "notes")
  })).filter(r => r.action_key);
}

async function loadEndpointRegistry(sheets) {
  const values = await fetchRange(sheets, `'${ENDPOINT_REGISTRY_SHEET}'!A1:BA2000`);
  if (!values.length) throw registryError("API Actions Endpoint Registry");
  const headers = values[0];
  const map = headerMap(headers, ENDPOINT_REGISTRY_SHEET);
  debugLog("ENDPOINT_REGISTRY_HEADERS:", JSON.stringify(headers));
  debugLog("ENDPOINT_REGISTRY_HEADER_MAP_KEYS:", JSON.stringify(Object.keys(map)));
  return values.slice(1).map(row => ({
    endpoint_id: getCell(row, map, "endpoint_id"),
    parent_action_key: getCell(row, map, "parent_action_key"),
    endpoint_key: getCell(row, map, "endpoint_key"),
    provider_domain: getCell(row, map, "provider_domain"),
    method: getCell(row, map, "method"),
    endpoint_path_or_function: getCell(row, map, "endpoint_path_or_function"),
    module_binding: getCell(row, map, "module_binding"),
    connector_family: getCell(row, map, "connector_family"),
    status: getCell(row, map, "status"),
    spec_validation_status: getCell(row, map, "spec_validation_status"),
    auth_validation_status: getCell(row, map, "auth_validation_status"),
    privacy_validation_status: getCell(row, map, "privacy_validation_status"),
    execution_readiness: getCell(row, map, "execution_readiness"),
    endpoint_role: getCell(row, map, "endpoint_role"),
    execution_mode: getCell(row, map, "execution_mode"),
    transport_required: getCell(row, map, "transport_required"),
    fallback_allowed: getCell(row, map, "fallback_allowed"),
    fallback_match_basis: getCell(row, map, "fallback_match_basis"),
    fallback_provider_domain: getCell(row, map, "fallback_provider_domain"),
    fallback_connector_family: getCell(row, map, "fallback_connector_family"),
    fallback_action_name: getCell(row, map, "fallback_action_name"),
    fallback_route_target: getCell(row, map, "fallback_route_target"),
    fallback_notes: getCell(row, map, "fallback_notes"),
    inventory_role: getCell(row, map, "inventory_role"),
    inventory_source: getCell(row, map, "inventory_source"),
    notes: getCell(row, map, "notes"),
    brand_resolution_source: getCell(row, map, "brand_resolution_source"),
    transport_action_key: getCell(row, map, "transport_action_key")
  })).filter(r => r.endpoint_key);
}

async function loadExecutionPolicies(sheets) {
  const values = await fetchRange(sheets, `'${EXECUTION_POLICY_SHEET}'!A1:H2000`);
  if (!values.length) throw registryError("Execution Policy Registry");
  const headers = values[0];
  const map = headerMap(headers, EXECUTION_POLICY_SHEET);
  const policies = values.slice(1).map(row => ({
    policy_group: getCell(row, map, "policy_group"),
    policy_key: getCell(row, map, "policy_key"),
    policy_value: getCell(row, map, "policy_value"),
    active: getCell(row, map, "active"),
    execution_scope: getCell(row, map, "execution_scope"),
    affects_layer: getCell(row, map, "affects_layer"),
    blocking: getCell(row, map, "blocking"),
    notes: getCell(row, map, "notes")
  })).filter(r => r.policy_key && boolFromSheet(r.active));
  return policies;
}

async function readExecutionPolicyRegistryLive() {
  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);
  const values = await fetchRange(
    sheets,
    toValuesApiRange(EXECUTION_POLICY_SHEET, "A1:H2000")
  );
  if (!values.length) throw registryError("Execution Policy Registry");

  const header = values[0].map(v => String(v || "").trim());
  const rows = values.slice(1);
  return {
    header,
    rows,
    map: headerMap(header, EXECUTION_POLICY_SHEET)
  };
}

function buildExecutionPolicyRow(input = {}) {
  return {
    policy_group: String(input.policy_group || "").trim(),
    policy_key: String(input.policy_key || "").trim(),
    policy_value: String(input.policy_value || "").trim(),
    active:
      input.active === true || String(input.active || "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    execution_scope: String(input.execution_scope || "execution").trim(),
    affects_layer: String(input.affects_layer || "").trim(),
    blocking:
      input.blocking === true || String(input.blocking || "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    notes: String(input.notes || "").trim()
  };
}

function findExecutionPolicyRowNumber(header = [], rows = [], input = {}) {
  const groupIdx = header.indexOf("policy_group");
  const keyIdx = header.indexOf("policy_key");

  if (groupIdx === -1 || keyIdx === -1) {
    const err = new Error("Execution Policy Registry header missing policy_group or policy_key.");
    err.code = "execution_policy_header_invalid";
    err.status = 500;
    throw err;
  }

  const wantedGroup = String(input.policy_group || "").trim();
  const wantedKey = String(input.policy_key || "").trim();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const existingGroup = String(row[groupIdx] || "").trim();
    const existingKey = String(row[keyIdx] || "").trim();
    if (existingGroup === wantedGroup && existingKey === wantedKey) {
      return i + 2;
    }
  }

  return null;
}

async function writeExecutionPolicyRow(input = {}) {
  const live = await readExecutionPolicyRegistryLive();
  const row = buildExecutionPolicyRow(input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: EXECUTION_POLICY_SHEET,
    mutationType: "append",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    scanRangeA1: "A:H"
  });

  return {
    mutationType: "append",
    row,
    preflight: mutationResult.preflight
  };
}

async function updateExecutionPolicyRow(input = {}) {
  const live = await readExecutionPolicyRegistryLive();
  const row = buildExecutionPolicyRow(input);
  const targetRowNumber = findExecutionPolicyRowNumber(live.header, live.rows, input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: EXECUTION_POLICY_SHEET,
    mutationType: "update",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:H"
  });

  return {
    mutationType: "update",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    row,
    preflight: mutationResult.preflight
  };
}

async function deleteExecutionPolicyRow(input = {}) {
  const live = await readExecutionPolicyRegistryLive();
  const targetRowNumber = findExecutionPolicyRowNumber(live.header, live.rows, input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: EXECUTION_POLICY_SHEET,
    mutationType: "delete",
    rowObject: buildExecutionPolicyRow(input),
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:H"
  });

  return {
    mutationType: "delete",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    preflight: mutationResult.preflight
  };
}

async function readTaskRoutesLive() {
  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);
  const values = await fetchRange(
    sheets,
    toValuesApiRange(TASK_ROUTES_SHEET, "A1:AF2000")
  );
  if (!values.length) throw registryError(TASK_ROUTES_SHEET);

  const header = values[0].map(v => String(v || "").trim());
  const rows = values.slice(1);
  return {
    header,
    rows,
    map: headerMap(header, TASK_ROUTES_SHEET)
  };
}

function buildTaskRouteRow(input = {}) {
  const row = {};

  for (const col of TASK_ROUTES_CANONICAL_COLUMNS) {
    row[col] = "";
  }

  row["Task Key"] = String(input["Task Key"] ?? input.task_key ?? "").trim();
  row["Trigger Terms"] = String(input["Trigger Terms"] ?? input.trigger_terms ?? "").trim();
  row["Route Modules"] = String(input["Route Modules"] ?? input.route_modules ?? "").trim();
  row["Execution Layer"] = String(input["Execution Layer"] ?? input.execution_layer ?? "").trim();
  row["Priority"] = String(input["Priority"] ?? input.priority_label ?? "").trim();
  row["Enabled"] =
    input["Enabled"] === true || String(input["Enabled"] ?? input.enabled ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["Output Focus"] = String(input["Output Focus"] ?? input.output_focus ?? "").trim();
  row["Notes"] = String(input["Notes"] ?? input.notes ?? "").trim();
  row["Entry Sources"] = String(input["Entry Sources"] ?? input.entry_sources ?? "").trim();
  row["Linked Starter Titles"] = String(input["Linked Starter Titles"] ?? input.linked_starter_titles ?? "").trim();
  row["Active Starter Count"] = String(input["Active Starter Count"] ?? input.active_starter_count ?? "").trim();
  row["Route Key Match Status"] = String(input["Route Key Match Status"] ?? input.route_key_match_status ?? "").trim();

  row["row_id"] = String(input.row_id ?? "").trim();
  row["route_id"] = String(input.route_id ?? "").trim();
  row["active"] =
    input.active === true || String(input.active ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["intent_key"] = String(input.intent_key ?? "").trim();
  row["brand_scope"] = String(input.brand_scope ?? "").trim();
  row["request_type"] = String(input.request_type ?? "").trim();
  row["route_mode"] = String(input.route_mode ?? "").trim();
  row["target_module"] = String(input.target_module ?? "").trim();
  row["workflow_key"] = String(input.workflow_key ?? "").trim();
  row["lifecycle_mode"] = String(input.lifecycle_mode ?? "").trim();
  row["memory_required"] =
    input.memory_required === true || String(input.memory_required ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["logging_required"] =
    input.logging_required === true || String(input.logging_required ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["review_required"] =
    input.review_required === true || String(input.review_required ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["priority"] = String(input.priority ?? "").trim();
  row["allowed_states"] = String(input.allowed_states ?? "").trim();
  row["degraded_action"] = String(input.degraded_action ?? "").trim();
  row["blocked_action"] = String(input.blocked_action ?? "").trim();
  row["match_rule"] = String(input.match_rule ?? "").trim();
  row["route_source"] = String(input.route_source ?? "").trim();
  row["last_validated_at"] = String(input.last_validated_at ?? "").trim();

  return row;
}

function findTaskRouteRowNumber(header = [], rows = [], input = {}) {
  const routeIdIdx = header.indexOf("route_id");
  const taskKeyIdx = header.indexOf("Task Key");

  if (routeIdIdx === -1 && taskKeyIdx === -1) {
    const err = new Error("Task Routes header missing route_id and Task Key.");
    err.code = "task_routes_header_invalid";
    err.status = 500;
    throw err;
  }

  const wantedRouteId = String(input.route_id || "").trim();
  const wantedTaskKey = String(input["Task Key"] ?? input.task_key ?? "").trim();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const existingRouteId = routeIdIdx === -1 ? "" : String(row[routeIdIdx] || "").trim();
    const existingTaskKey = taskKeyIdx === -1 ? "" : String(row[taskKeyIdx] || "").trim();

    if (wantedRouteId && existingRouteId === wantedRouteId) {
      return i + 2;
    }

    if (!wantedRouteId && wantedTaskKey && existingTaskKey === wantedTaskKey) {
      return i + 2;
    }
  }

  return null;
}

async function writeTaskRouteRow(input = {}) {
  const live = await readTaskRoutesLive();
  const row = buildTaskRouteRow(input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: TASK_ROUTES_SHEET,
    mutationType: "append",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    scanRangeA1: "A:AF"
  });

  return {
    mutationType: "append",
    row,
    preflight: mutationResult.preflight
  };
}

async function updateTaskRouteRow(input = {}) {
  const live = await readTaskRoutesLive();
  const row = buildTaskRouteRow(input);
  const targetRowNumber = findTaskRouteRowNumber(live.header, live.rows, input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: TASK_ROUTES_SHEET,
    mutationType: "update",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AF"
  });

  return {
    mutationType: "update",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    row,
    preflight: mutationResult.preflight
  };
}

async function deleteTaskRouteRow(input = {}) {
  const live = await readTaskRoutesLive();
  const targetRowNumber = findTaskRouteRowNumber(live.header, live.rows, input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: TASK_ROUTES_SHEET,
    mutationType: "delete",
    rowObject: buildTaskRouteRow(input),
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AF"
  });

  return {
    mutationType: "delete",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    preflight: mutationResult.preflight
  };
}

async function readWorkflowRegistryLive() {
  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);
  const values = await fetchRange(
    sheets,
    toValuesApiRange(WORKFLOW_REGISTRY_SHEET, "A1:AL2000")
  );
  if (!values.length) throw registryError(WORKFLOW_REGISTRY_SHEET);

  const header = values[0].map(v => String(v || "").trim());
  const rows = values.slice(1);
  return {
    header,
    rows,
    map: headerMap(header, WORKFLOW_REGISTRY_SHEET)
  };
}

function buildWorkflowRegistryRow(input = {}) {
  const row = {};

  for (const col of WORKFLOW_REGISTRY_CANONICAL_COLUMNS) {
    row[col] = "";
  }

  row["Workflow ID"] = String(input["Workflow ID"] ?? input.workflow_id ?? "").trim();
  row["Workflow Name"] = String(input["Workflow Name"] ?? input.workflow_name ?? "").trim();
  row["Module Mode"] = String(input["Module Mode"] ?? input.module_mode ?? "").trim();
  row["Trigger Source"] = String(input["Trigger Source"] ?? input.trigger_source ?? "").trim();
  row["Input Type"] = String(input["Input Type"] ?? input.input_type ?? "").trim();
  row["Primary Objective"] = String(input["Primary Objective"] ?? input.primary_objective ?? "").trim();
  row["Mapped Engine(s)"] = String(input["Mapped Engine(s)"] ?? input.mapped_engines ?? "").trim();
  row["Engine Order"] = String(input["Engine Order"] ?? input.engine_order ?? "").trim();
  row["Workflow Type"] = String(input["Workflow Type"] ?? input.workflow_type ?? "").trim();
  row["Primary Output"] = String(input["Primary Output"] ?? input.primary_output ?? "").trim();
  row["Input Detection Rules"] = String(input["Input Detection Rules"] ?? input.input_detection_rules ?? "").trim();
  row["Output Template"] = String(input["Output Template"] ?? input.output_template ?? "").trim();
  row["Priority"] = String(input["Priority"] ?? input.priority_label ?? "").trim();
  row["Route Key"] = String(input["Route Key"] ?? input.route_key ?? "").trim();
  row["Execution Mode"] = String(input["Execution Mode"] ?? input.execution_mode ?? "").trim();
  row["User Facing"] =
    input["User Facing"] === true || String(input["User Facing"] ?? input.user_facing ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["Parent Layer"] = String(input["Parent Layer"] ?? input.parent_layer ?? "").trim();
  row["Status"] = String(input["Status"] ?? input.status_label ?? "").trim();
  row["Linked Workflows"] = String(input["Linked Workflows"] ?? input.linked_workflows ?? "").trim();
  row["Linked Engines"] = String(input["Linked Engines"] ?? input.linked_engines ?? "").trim();
  row["Notes"] = String(input["Notes"] ?? input.notes ?? "").trim();
  row["Entry Priority Weight"] = String(input["Entry Priority Weight"] ?? input.entry_priority_weight ?? "").trim();
  row["Dependency Type"] = String(input["Dependency Type"] ?? input.dependency_type ?? "").trim();
  row["Output Artifact Type"] = String(input["Output Artifact Type"] ?? input.output_artifact_type ?? "").trim();

  row["workflow_key"] = String(input.workflow_key ?? "").trim();
  row["active"] =
    input.active === true || String(input.active ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["target_module"] = String(input.target_module ?? "").trim();
  row["execution_class"] = String(input.execution_class ?? "").trim();
  row["lifecycle_mode"] = String(input.lifecycle_mode ?? "").trim();
  row["route_compatibility"] = String(input.route_compatibility ?? "").trim();
  row["memory_required"] =
    input.memory_required === true || String(input.memory_required ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["logging_required"] =
    input.logging_required === true || String(input.logging_required ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["review_required"] =
    input.review_required === true || String(input.review_required ?? "").trim().toUpperCase() === "TRUE"
      ? "TRUE"
      : "FALSE";
  row["allowed_states"] = String(input.allowed_states ?? "").trim();
  row["degraded_action"] = String(input.degraded_action ?? "").trim();
  row["blocked_action"] = String(input.blocked_action ?? "").trim();
  row["registry_source"] = String(input.registry_source ?? "").trim();
  row["last_validated_at"] = String(input.last_validated_at ?? "").trim();

  return row;
}

function findWorkflowRegistryRowNumber(header = [], rows = [], input = {}) {
  const workflowIdIdx = header.indexOf("Workflow ID");
  const workflowKeyIdx = header.indexOf("workflow_key");

  if (workflowIdIdx === -1 && workflowKeyIdx === -1) {
    const err = new Error("Workflow Registry header missing Workflow ID and workflow_key.");
    err.code = "workflow_registry_header_invalid";
    err.status = 500;
    throw err;
  }

  const wantedWorkflowId = String(input["Workflow ID"] ?? input.workflow_id ?? "").trim();
  const wantedWorkflowKey = String(input.workflow_key || "").trim();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const existingWorkflowId =
      workflowIdIdx === -1 ? "" : String(row[workflowIdIdx] || "").trim();
    const existingWorkflowKey =
      workflowKeyIdx === -1 ? "" : String(row[workflowKeyIdx] || "").trim();

    if (wantedWorkflowId && existingWorkflowId === wantedWorkflowId) {
      return i + 2;
    }

    if (!wantedWorkflowId && wantedWorkflowKey && existingWorkflowKey === wantedWorkflowKey) {
      return i + 2;
    }
  }

  return null;
}

async function writeWorkflowRegistryRow(input = {}) {
  const live = await readWorkflowRegistryLive();
  const row = buildWorkflowRegistryRow(input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: WORKFLOW_REGISTRY_SHEET,
    mutationType: "append",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    scanRangeA1: "A:AL"
  });

  return {
    mutationType: "append",
    row,
    preflight: mutationResult.preflight
  };
}

async function updateWorkflowRegistryRow(input = {}) {
  const live = await readWorkflowRegistryLive();
  const row = buildWorkflowRegistryRow(input);
  const targetRowNumber = findWorkflowRegistryRowNumber(live.header, live.rows, input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: WORKFLOW_REGISTRY_SHEET,
    mutationType: "update",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AL"
  });

  return {
    mutationType: "update",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    row,
    preflight: mutationResult.preflight
  };
}

async function deleteWorkflowRegistryRow(input = {}) {
  const live = await readWorkflowRegistryLive();
  const targetRowNumber = findWorkflowRegistryRowNumber(live.header, live.rows, input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: WORKFLOW_REGISTRY_SHEET,
    mutationType: "delete",
    rowObject: buildWorkflowRegistryRow(input),
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AL"
  });

  return {
    mutationType: "delete",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    preflight: mutationResult.preflight
  };
}

async function readRegistrySurfacesCatalogLive() {
  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);
  const values = await fetchRange(
    sheets,
    toValuesApiRange(REGISTRY_SURFACES_CATALOG_SHEET, "A1:AG2000")
  );
  if (!values.length) throw registryError(REGISTRY_SURFACES_CATALOG_SHEET);

  const header = values[0].map(v => String(v || "").trim());
  const rows = values.slice(1);
  return {
    header,
    rows,
    map: headerMap(header, REGISTRY_SURFACES_CATALOG_SHEET)
  };
}

function buildRegistrySurfaceCatalogRow(input = {}) {
  return {
    surface_id: String(input.surface_id ?? "").trim(),
    surface_name: String(input.surface_name ?? "").trim(),
    worksheet_name: String(input.worksheet_name ?? "").trim(),
    worksheet_gid: String(input.worksheet_gid ?? "").trim(),
    active_status:
      input.active_status === true ||
      String(input.active_status ?? "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    authority_status: String(input.authority_status ?? "").trim(),
    required_for_execution:
      input.required_for_execution === true ||
      String(input.required_for_execution ?? "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    schema_ref: String(input.schema_ref ?? "").trim(),
    schema_version: String(input.schema_version ?? "").trim(),
    header_signature: String(input.header_signature ?? "").trim(),
    expected_column_count: String(input.expected_column_count ?? "").trim(),
    binding_mode: String(input.binding_mode ?? "").trim(),
    sheet_role: String(input.sheet_role ?? "").trim(),
    audit_mode: String(input.audit_mode ?? "").trim(),
    legacy_surface_containment_required:
      input.legacy_surface_containment_required === true ||
      String(input.legacy_surface_containment_required ?? "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    repair_candidate_types: String(input.repair_candidate_types ?? "").trim(),
    repair_priority: String(input.repair_priority ?? "").trim()
  };
}

function findRegistrySurfaceCatalogRowNumber(header = [], rows = [], input = {}) {
  const surfaceIdIdx = header.indexOf("surface_id");
  const surfaceNameIdx = header.indexOf("surface_name");

  if (surfaceIdIdx === -1 && surfaceNameIdx === -1) {
    const err = new Error(
      "Registry Surfaces Catalog header missing surface_id and surface_name."
    );
    err.code = "registry_surfaces_catalog_header_invalid";
    err.status = 500;
    throw err;
  }

  const wantedSurfaceId = String(input.surface_id || "").trim();
  const wantedSurfaceName = String(input.surface_name || "").trim();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const existingSurfaceId =
      surfaceIdIdx === -1 ? "" : String(row[surfaceIdIdx] || "").trim();
    const existingSurfaceName =
      surfaceNameIdx === -1 ? "" : String(row[surfaceNameIdx] || "").trim();

    if (wantedSurfaceId && existingSurfaceId === wantedSurfaceId) {
      return i + 2;
    }

    if (!wantedSurfaceId && wantedSurfaceName && existingSurfaceName === wantedSurfaceName) {
      return i + 2;
    }
  }

  return null;
}

async function writeRegistrySurfaceCatalogRow(input = {}) {
  const live = await readRegistrySurfacesCatalogLive();
  const row = buildRegistrySurfaceCatalogRow(input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: REGISTRY_SURFACES_CATALOG_SHEET,
    mutationType: "append",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    scanRangeA1: "A:AG"
  });

  return {
    mutationType: "append",
    row,
    preflight: mutationResult.preflight
  };
}

async function updateRegistrySurfaceCatalogRow(input = {}) {
  const live = await readRegistrySurfacesCatalogLive();
  const row = buildRegistrySurfaceCatalogRow(input);
  const targetRowNumber = findRegistrySurfaceCatalogRowNumber(live.header, live.rows, input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: REGISTRY_SURFACES_CATALOG_SHEET,
    mutationType: "update",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AG"
  });

  return {
    mutationType: "update",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    row,
    preflight: mutationResult.preflight
  };
}

async function deleteRegistrySurfaceCatalogRow(input = {}) {
  const live = await readRegistrySurfacesCatalogLive();
  const targetRowNumber = findRegistrySurfaceCatalogRowNumber(live.header, live.rows, input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: REGISTRY_SURFACES_CATALOG_SHEET,
    mutationType: "delete",
    rowObject: buildRegistrySurfaceCatalogRow(input),
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AG"
  });

  return {
    mutationType: "delete",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    preflight: mutationResult.preflight
  };
}

async function readValidationRepairRegistryLive() {
  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);
  const values = await fetchRange(
    sheets,
    toValuesApiRange(VALIDATION_REPAIR_REGISTRY_SHEET, "A1:AZ2000")
  );
  if (!values.length) throw registryError(VALIDATION_REPAIR_REGISTRY_SHEET);

  const header = values[0].map(v => String(v || "").trim());
  const rows = values.slice(1);
  return {
    header,
    rows,
    map: headerMap(header, VALIDATION_REPAIR_REGISTRY_SHEET)
  };
}

function buildValidationRepairRegistryRow(input = {}) {
  return {
    validation_key: String(input.validation_key ?? "").trim(),
    validation_name: String(input.validation_name ?? "").trim(),
    surface_id: String(input.surface_id ?? "").trim(),
    target_sheet: String(input.target_sheet ?? "").trim(),
    target_range: String(input.target_range ?? "").trim(),
    validation_type: String(input.validation_type ?? "").trim(),
    validation_scope: String(input.validation_scope ?? "").trim(),
    severity: String(input.severity ?? "").trim(),
    blocking:
      input.blocking === true ||
      String(input.blocking ?? "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    active_status:
      input.active_status === true ||
      String(input.active_status ?? "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    repair_strategy: String(input.repair_strategy ?? "").trim(),
    repair_module: String(input.repair_module ?? "").trim(),
    expected_schema_ref: String(input.expected_schema_ref ?? "").trim(),
    expected_schema_version: String(input.expected_schema_version ?? "").trim(),
    expected_header_signature: String(input.expected_header_signature ?? "").trim(),
    drift_detection_mode: String(input.drift_detection_mode ?? "").trim(),
    last_validated_at: String(input.last_validated_at ?? "").trim(),
    notes: String(input.notes ?? "").trim()
  };
}

function findValidationRepairRegistryRowNumber(header = [], rows = [], input = {}) {
  const validationKeyIdx = header.indexOf("validation_key");
  const validationNameIdx = header.indexOf("validation_name");

  if (validationKeyIdx === -1 && validationNameIdx === -1) {
    const err = new Error(
      "Validation & Repair Registry header missing validation_key and validation_name."
    );
    err.code = "validation_repair_registry_header_invalid";
    err.status = 500;
    throw err;
  }

  const wantedValidationKey = String(input.validation_key || "").trim();
  const wantedValidationName = String(input.validation_name || "").trim();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const existingValidationKey =
      validationKeyIdx === -1 ? "" : String(row[validationKeyIdx] || "").trim();
    const existingValidationName =
      validationNameIdx === -1 ? "" : String(row[validationNameIdx] || "").trim();

    if (wantedValidationKey && existingValidationKey === wantedValidationKey) {
      return i + 2;
    }

    if (
      !wantedValidationKey &&
      wantedValidationName &&
      existingValidationName === wantedValidationName
    ) {
      return i + 2;
    }
  }

  return null;
}

async function writeValidationRepairRegistryRow(input = {}) {
  const live = await readValidationRepairRegistryLive();
  const row = buildValidationRepairRegistryRow(input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: VALIDATION_REPAIR_REGISTRY_SHEET,
    mutationType: "append",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    scanRangeA1: "A:AZ"
  });

  return {
    mutationType: "append",
    row,
    preflight: mutationResult.preflight
  };
}

async function updateValidationRepairRegistryRow(input = {}) {
  const live = await readValidationRepairRegistryLive();
  const row = buildValidationRepairRegistryRow(input);
  const targetRowNumber = findValidationRepairRegistryRowNumber(
    live.header,
    live.rows,
    input
  );

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: VALIDATION_REPAIR_REGISTRY_SHEET,
    mutationType: "update",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AZ"
  });

  return {
    mutationType: "update",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    row,
    preflight: mutationResult.preflight
  };
}

async function deleteValidationRepairRegistryRow(input = {}) {
  const live = await readValidationRepairRegistryLive();
  const targetRowNumber = findValidationRepairRegistryRowNumber(
    live.header,
    live.rows,
    input
  );

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: VALIDATION_REPAIR_REGISTRY_SHEET,
    mutationType: "delete",
    rowObject: buildValidationRepairRegistryRow(input),
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AZ"
  });

  return {
    mutationType: "delete",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    preflight: mutationResult.preflight
  };
}

async function readActionsRegistryLive() {
  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);
  const values = await fetchRange(
    sheets,
    toValuesApiRange(ACTIONS_REGISTRY_SHEET, "A1:AZ2000")
  );
  if (!values.length) throw registryError(ACTIONS_REGISTRY_SHEET);

  const header = values[0].map(v => String(v || "").trim());
  const rows = values.slice(1);
  return {
    header,
    rows,
    map: headerMap(header, ACTIONS_REGISTRY_SHEET)
  };
}

function buildActionsRegistryRow(input = {}) {
  return {
    action_key: String(input.action_key ?? "").trim(),
    parent_action_key: String(input.parent_action_key ?? "").trim(),
    action_name: String(input.action_name ?? "").trim(),
    action_label: String(input.action_label ?? "").trim(),
    action_type: String(input.action_type ?? "").trim(),
    target_module: String(input.target_module ?? "").trim(),
    workflow_key: String(input.workflow_key ?? "").trim(),
    execution_mode: String(input.execution_mode ?? "").trim(),
    request_method: String(input.request_method ?? "").trim(),
    path_template: String(input.path_template ?? "").trim(),
    provider_domain_mode: String(input.provider_domain_mode ?? "").trim(),
    auth_mode: String(input.auth_mode ?? "").trim(),
    schema_mode: String(input.schema_mode ?? "").trim(),
    request_schema_ref: String(input.request_schema_ref ?? "").trim(),
    response_schema_ref: String(input.response_schema_ref ?? "").trim(),
    route_scope: String(input.route_scope ?? "").trim(),
    retry_profile: String(input.retry_profile ?? "").trim(),
    active_status:
      input.active_status === true ||
      String(input.active_status ?? "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    blocking:
      input.blocking === true ||
      String(input.blocking ?? "").trim().toUpperCase() === "TRUE"
        ? "TRUE"
        : "FALSE",
    notes: String(input.notes ?? "").trim(),
    owner_module: String(input.owner_module ?? "").trim(),
    authority_source: String(input.authority_source ?? "").trim(),
    last_validated_at: String(input.last_validated_at ?? "").trim()
  };
}

function findActionsRegistryRowNumber(header = [], rows = [], input = {}) {
  const actionKeyIdx = header.indexOf("action_key");
  const actionNameIdx = header.indexOf("action_name");

  if (actionKeyIdx === -1 && actionNameIdx === -1) {
    const err = new Error(
      "Actions Registry header missing action_key and action_name."
    );
    err.code = "actions_registry_header_invalid";
    err.status = 500;
    throw err;
  }

  const wantedActionKey = String(input.action_key || "").trim();
  const wantedActionName = String(input.action_name || "").trim();

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const existingActionKey =
      actionKeyIdx === -1 ? "" : String(row[actionKeyIdx] || "").trim();
    const existingActionName =
      actionNameIdx === -1 ? "" : String(row[actionNameIdx] || "").trim();

    if (wantedActionKey && existingActionKey === wantedActionKey) {
      return i + 2;
    }

    if (!wantedActionKey && wantedActionName && existingActionName === wantedActionName) {
      return i + 2;
    }
  }

  return null;
}

async function writeActionsRegistryRow(input = {}) {
  const live = await readActionsRegistryLive();
  const row = buildActionsRegistryRow(input);

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: ACTIONS_REGISTRY_SHEET,
    mutationType: "append",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    scanRangeA1: "A:AZ"
  });

  return {
    mutationType: "append",
    row,
    preflight: mutationResult.preflight
  };
}

async function updateActionsRegistryRow(input = {}) {
  const live = await readActionsRegistryLive();
  const row = buildActionsRegistryRow(input);
  const targetRowNumber = findActionsRegistryRowNumber(
    live.header,
    live.rows,
    input
  );

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: ACTIONS_REGISTRY_SHEET,
    mutationType: "update",
    rowObject: row,
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AZ"
  });

  return {
    mutationType: "update",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    row,
    preflight: mutationResult.preflight
  };
}

async function deleteActionsRegistryRow(input = {}) {
  const live = await readActionsRegistryLive();
  const targetRowNumber = findActionsRegistryRowNumber(
    live.header,
    live.rows,
    input
  );

  const mutationResult = await performGovernedSheetMutation({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    sheetName: ACTIONS_REGISTRY_SHEET,
    mutationType: "delete",
    rowObject: buildActionsRegistryRow(input),
    header: live.header,
    safeColumns: live.header.filter(Boolean),
    targetRowNumber,
    scanRangeA1: "A:AZ"
  });

  return {
    mutationType: "delete",
    targetRowNumber: mutationResult.targetRowNumber || targetRowNumber,
    preflight: mutationResult.preflight
  };
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
  const row = policies.find(p => p.policy_group === group && p.policy_key === key && boolFromSheet(p.active));
  return row ? row.policy_value : fallback;
}

function policyList(policies, group, key) {
  return String(policyValue(policies, group, key, ""))
    .split("|")
    .map(v => v.trim())
    .filter(Boolean);
}

function getDefaultGoogleScopes(action = {}, endpoint = {}) {
  const actionKey = String(action.action_key || "").trim();
  const method = String(endpoint.method || "").trim().toUpperCase();
  const readonly = method === "GET";

  switch (actionKey) {
    case "googleads_api":
      return ["https://www.googleapis.com/auth/adwords"];

    case "searchads360_api":
      return ["https://www.googleapis.com/auth/doubleclicksearch"];

    case "searchconsole_api":
      return [
        readonly
          ? "https://www.googleapis.com/auth/webmasters.readonly"
          : "https://www.googleapis.com/auth/webmasters"
      ];

    case "analytics_data_api":
      return ["https://www.googleapis.com/auth/analytics.readonly"];

    case "analytics_admin_api":
      return ["https://www.googleapis.com/auth/analytics.edit"];

    case "tagmanager_api":
      return [
        readonly
          ? "https://www.googleapis.com/auth/tagmanager.readonly"
          : "https://www.googleapis.com/auth/tagmanager.edit.containers"
      ];

    default:
      return ["https://www.googleapis.com/auth/cloud-platform"];
  }
}

function normalizeGoogleScopeList(scopes = []) {
  return Array.isArray(scopes)
    ? [...new Set(scopes.map(v => String(v || "").trim()).filter(Boolean))]
    : [];
}

function getScopesFromOAuthConfig(oauthConfigContract, action) {
  const parsed = oauthConfigContract?.parsed || {};
  const byFamily = parsed?.scopes_by_action_family || {};
  const actionKey = String(action.action_key || "").trim();
  return normalizeGoogleScopeList(byFamily[actionKey] || []);
}

function validateGoogleOAuthConfigTraceability(action, oauthConfigContract) {
  const expectedName = String(action.oauth_config_file_name || "").trim();
  const actualName = String(oauthConfigContract?.name || "").trim();
  if (!expectedName || !actualName) return;
  if (expectedName !== actualName) {
    debugLog("OAUTH_CONFIG_NAME_MISMATCH:", {
      action_key: action.action_key,
      expected: expectedName,
      actual: actualName
    });
  }
}

async function resolveDelegatedGoogleScopes({ drive, policies, action, endpoint }) {
  const endpointScopedKey = `${action.action_key}|${endpoint.endpoint_key}|scopes`;
  const actionScopedKey = `${action.action_key}|scopes`;

  // 1) OAuth config file first
  const oauthConfigContract = await fetchOAuthConfigContract(drive, action);
  validateGoogleOAuthConfigTraceability(action, oauthConfigContract);
  const fileScopes = getScopesFromOAuthConfig(oauthConfigContract, action);
  if (fileScopes.length) {
    return {
      explicitScopes: fileScopes,
      scopeSource: `oauth_config_file:${oauthConfigContract.name || action.oauth_config_file_name || action.oauth_config_file_id}`
    };
  }

  // 2) endpoint-level policy override
  const endpointPolicyScopes = policyList(policies, "HTTP Google Auth", endpointScopedKey);
  if (endpointPolicyScopes.length) {
    return {
      explicitScopes: endpointPolicyScopes,
      scopeSource: `execution_policy:endpoint:${endpointScopedKey}`
    };
  }

  // 3) action-level policy override
  const actionPolicyScopes = policyList(policies, "HTTP Google Auth", actionScopedKey);
  if (actionPolicyScopes.length) {
    return {
      explicitScopes: actionPolicyScopes,
      scopeSource: `execution_policy:action:${actionScopedKey}`
    };
  }

  // 4) current hardcoded fallback
  return {
    explicitScopes: getDefaultGoogleScopes(action, endpoint),
    scopeSource: `server_default:${action.action_key}`
  };
}

async function mintGoogleAccessTokenForEndpoint({ drive, policies, action, endpoint }) {
  const { explicitScopes, scopeSource } = await resolveDelegatedGoogleScopes({
    drive,
    policies,
    action,
    endpoint
  });
  debugLog("GOOGLE_SCOPE_SOURCE:", scopeSource);
  debugLog("GOOGLE_SCOPES:", JSON.stringify(explicitScopes));

  const auth = new google.auth.GoogleAuth({ scopes: explicitScopes });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token;
  if (!token) {
    const err = new Error("Unable to mint Google access token for delegated execution.");
    err.code = "auth_resolution_failed";
    err.status = 500;
    throw err;
  }
  return token;
}

function requirePolicyTrue(policies, group, key, message) {
  const value = policyValue(policies, group, key, "FALSE");
  if (String(value).trim().toUpperCase() !== "TRUE") {
    const err = new Error(message || `${group} | ${key} policy is not enabled.`);
    err.code = "policy_blocked";
    err.status = 403;
    throw err;
  }
}

function requirePolicySet(policies, group, keys = []) {
  const missing = (keys || []).filter(key => {
    const value = policyValue(policies, group, key, "FALSE");
    return String(value).trim().toUpperCase() !== "TRUE";
  });

  return {
    ok: missing.length === 0,
    missing
  };
}

function getRequiredHttpExecutionPolicyKeys(policies = []) {
  const auditEnabled =
    String(
      policyValue(
        policies,
        "HTTP Execution Governance",
        "Required Policy Presence Audit Enabled",
        "FALSE"
      )
    )
      .trim()
      .toUpperCase() === "TRUE";

  const configuredKeys = policyList(
    policies,
    "HTTP Execution Governance",
    "Required Policy Presence Audit Keys"
  );

  const fallbackKeys = [
    "Require Endpoint Active",
    "Require Execution Readiness",
    "Enforce Parent Action Match",
    "Require Relative Path",
    "Require Auth Generation",
    "Server-Side Auth Injection Required",
    "Require Action Schema Resolution",
    "Require Request Schema Alignment"
  ];

  if (auditEnabled && configuredKeys.length) {
    return configuredKeys;
  }

  return fallbackKeys;
}

function buildMissingRequiredPolicyError(policies = [], missing = []) {
  const handling = String(
    policyValue(
      policies,
      "HTTP Execution Governance",
      "Missing Required Policy Handling",
      "BLOCK"
    )
  ).trim();

  const err = new Error(
    "Required HTTP Execution Governance policies are not fully enabled."
  );
  err.code = "missing_required_http_execution_policy";
  err.status = 403;
  err.details = {
    policy_group: "HTTP Execution Governance",
    missing_keys: missing,
    handling
  };
  return err;
}

function resilienceAppliesToParentAction(policies, parentActionKey) {
  const enabled = String(
    policyValue(
      policies,
      "HTTP Execution Resilience",
      "Retry Mutation Enabled",
      "FALSE"
    )
  ).trim().toUpperCase() === "TRUE";

  if (!enabled) return false;

  const affected = policyList(
    policies,
    "HTTP Execution Resilience",
    "Affected Parent Action Keys"
  );

  return affected.includes(String(parentActionKey || "").trim());
}

function shouldRetryProviderResponse(policies, upstreamStatus, responseText) {
  const triggers = policyList(
    policies,
    "HTTP Execution Resilience",
    "Provider Retry Trigger"
  );

  const text = String(responseText || "");
  for (const trigger of triggers) {
    if (trigger === "upstream_status>=500" && Number(upstreamStatus) >= 500) {
      return true;
    }
    if (trigger.startsWith("response_contains:")) {
      const needle = trigger.slice("response_contains:".length);
      if (needle && text.includes(needle)) {
        return true;
      }
    }
  }
  return false;
}

function buildProviderRetryMutations(policies, actionKey = "") {
  if (!retryMutationEnabled(policies)) return [];
  if (!retryMutationAppliesToQuery(policies)) return [];
  if (!retryMutationSchemaModeAllowlisted(policies)) return [];
  if (!resilienceAppliesToParentAction(policies, actionKey)) return [];

  const strategy = String(
    policyValue(policies, "HTTP Execution Resilience", "Retry Strategy", "")
  ).trim();

  if (strategy !== "premium_escalation") return [];

  const stages = [
    String(policyValue(policies, "HTTP Execution Resilience", "Retry Stage 0", "{}")).trim(),
    String(policyValue(policies, "HTTP Execution Resilience", "Retry Stage 1", "")).trim(),
    String(policyValue(policies, "HTTP Execution Resilience", "Retry Stage 2", "")).trim()
  ].filter(Boolean);

  return stages
    .map(parseRetryStageValue)
    .filter((mutation, index) => {
      if (index === 0) return false;
      return Object.keys(mutation || {}).length > 0;
    });
}

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
  const requestedProviderDomain = requestPayload.provider_domain
    ? safeNormalizeProviderDomain(requestPayload.provider_domain)
    : "";

  const targetKey = String(requestPayload.target_key || "").trim().toLowerCase();
  const brandName = String(requestPayload.brand || "").trim().toLowerCase();
  const brandDomain = String(requestPayload.brand_domain || "").trim().toLowerCase();

  const normalizedRows = rows.map(r => {
    const aliases = jsonParseSafe(r.site_aliases_json, []).map(v => String(v).toLowerCase());
    let rowBaseUrl = "";
    try {
      rowBaseUrl = r.base_url ? normalizeProviderDomain(r.base_url) : "";
    } catch {}
    return {
      ...r,
      _aliases: aliases,
      _normalized_brand_name: String(r.normalized_brand_name || "").toLowerCase(),
      _display_name: String(r.brand_name || "").toLowerCase(),
      _target_key: String(r.target_key || "").toLowerCase(),
      _brand_domain: String(r.brand_domain || "").toLowerCase(),
      _base_url: rowBaseUrl
    };
  });

  let row = null;

  if (targetKey) {
    row = normalizedRows.find(r => r._target_key === targetKey) || null;
  }

  if (!row && brandName) {
    row = normalizedRows.find(
      r =>
        r._normalized_brand_name === brandName ||
        r._display_name === brandName ||
        r._aliases.includes(brandName)
    ) || null;
  }

  if (!row && brandDomain) {
    row = normalizedRows.find(r => r._brand_domain === brandDomain) || null;
  }

  if (!row && requestedProviderDomain && requestedProviderDomain !== "target_resolved") {
    row = normalizedRows.find(r => r._base_url === requestedProviderDomain) || null;
  }

  if (!row) return null;

  if (!boolFromSheet(row.transport_enabled)) {
    const err = new Error(`Transport is not enabled for resolved brand ${row.brand_name}.`);
    err.code = "transport_disabled";
    err.status = 403;
    throw err;
  }

  if (row.transport_action_key && row.transport_action_key !== "http_generic_api") {
    const err = new Error(`Unsupported transport_action_key: ${row.transport_action_key}`);
    err.code = "unsupported_transport";
    err.status = 403;
    throw err;
  }

  return row;
}

function resolveAction(rows, parentActionKey) {
  const matches = rows.filter(r => r.action_key === parentActionKey);

  debugLog(
    "ACTION_RESOLUTION_REQUEST:",
    JSON.stringify({
      parent_action_key: parentActionKey,
      match_count: matches.length
    })
  );

  if (!matches.length) {
    const err = new Error(`Parent action not found: ${parentActionKey}`);
    err.code = "parent_action_not_found";
    err.status = 403;
    throw err;
  }

  const active = matches.find(
    r => String(r.status || "").trim().toLowerCase() === "active"
  );

  const action = active || matches[0];

  debugLog(
    "ACTION_RESOLUTION_SELECTED:",
    JSON.stringify({
      action_key: action.action_key,
      status: action.status || "",
      runtime_capability_class: action.runtime_capability_class || "",
      runtime_callable: action.runtime_callable || "",
      primary_executor: action.primary_executor || "",
      openai_schema_storage_surface: action.openai_schema_storage_surface || ""
    })
  );

  if (String(action.status || "").trim().toLowerCase() !== "active") {
    const err = new Error(`Parent action is not active: ${parentActionKey}`);
    err.code = "parent_action_inactive";
    err.status = 403;
    throw err;
  }
  return action;
}

function resolveEndpoint(rows, parentActionKey, endpointKey) {
  const matches = rows.filter(
    r =>
      r.parent_action_key === parentActionKey &&
      r.endpoint_key === endpointKey
  );

  debugLog(
    "ENDPOINT_RESOLUTION_REQUEST:",
    JSON.stringify({
      parent_action_key: parentActionKey,
      endpoint_key: endpointKey,
      match_count: matches.length
    })
  );

  if (!matches.length) {
    const err = new Error(`Endpoint not found: ${endpointKey}`);
    err.code = "endpoint_not_found";
    err.status = 403;
    throw err;
  }

  const activeReady = matches.find(
    r =>
      String(r.status || "").trim().toLowerCase() === "active" &&
      String(r.execution_readiness || "").trim().toLowerCase() === "ready"
  );

  const endpoint = activeReady || matches[0];

  debugLog(
    "ENDPOINT_RESOLUTION_SELECTED:",
    JSON.stringify(getEndpointExecutionSnapshot(endpoint))
  );

  if (String(endpoint.status || "").trim().toLowerCase() !== "active") {
    const err = new Error(`Endpoint is not active: ${endpointKey}`);
    err.code = "endpoint_inactive";
    err.status = 403;
    throw err;
  }

  if (
    String(endpoint.execution_readiness || "").trim().toLowerCase() !== "ready"
  ) {
    const err = new Error(`Endpoint is not execution-ready: ${endpointKey}`);
    err.code = "endpoint_not_ready";
    err.status = 403;
    throw err;
  }

  return endpoint;
}

function isDelegatedTransportTarget(endpoint = {}) {
  return (
    String(endpoint.execution_mode || "")
      .trim()
      .toLowerCase() === "http_delegated" &&
    boolFromSheet(endpoint.transport_required) &&
    String(endpoint.transport_action_key || "").trim() !== ""
  );
}

function getEndpointExecutionSnapshot(endpoint = {}) {
  return {
    endpoint_id: String(endpoint.endpoint_id || "").trim(),
    endpoint_key: String(endpoint.endpoint_key || "").trim(),
    parent_action_key: String(endpoint.parent_action_key || "").trim(),
    endpoint_role: String(endpoint.endpoint_role || "").trim(),
    inventory_role: String(endpoint.inventory_role || "").trim(),
    inventory_source: String(endpoint.inventory_source || "").trim(),
    execution_mode: String(endpoint.execution_mode || "").trim(),
    transport_required_raw: endpoint.transport_required ?? "",
    transport_required: boolFromSheet(endpoint.transport_required),
    transport_action_key: String(endpoint.transport_action_key || "").trim(),
    delegated_transport_target: isDelegatedTransportTarget(endpoint),
    status: String(endpoint.status || "").trim(),
    execution_readiness: String(endpoint.execution_readiness || "").trim(),
    provider_domain: String(endpoint.provider_domain || "").trim(),
    endpoint_path_or_function: String(endpoint.endpoint_path_or_function || "").trim(),
    notes: String(endpoint.notes || "").trim()
  };
}

function requireRuntimeCallableAction(policies, action, endpoint) {
  const requireCallable = String(
    policyValue(
      policies,
      "Execution Capability Governance",
      "Require Runtime Callable For Direct Execution",
      "FALSE"
    )
  ).trim().toUpperCase() === "TRUE";

  const disallowPending = String(
    policyValue(
      policies,
      "Execution Capability Governance",
      "Disallow Pending Binding Execution",
      "FALSE"
    )
  ).trim().toUpperCase() === "TRUE";

  const allowRegistryOnlyDirect = String(
    policyValue(
      policies,
      "Execution Capability Governance",
      "Allow Registry Only Actions Direct Execution",
      "FALSE"
    )
  ).trim().toUpperCase() === "TRUE";

  const runtimeCallable = boolFromSheet(action.runtime_callable);
  const capabilityClass = String(action.runtime_capability_class || "").trim().toLowerCase();
  const primaryExecutor = String(action.primary_executor || "").trim().toLowerCase();
  const delegatedTransportTarget = isDelegatedTransportTarget(endpoint);

  if (disallowPending && capabilityClass === "pending_binding") {
    const err = new Error(`Action is pending binding and cannot execute: ${action.action_key}`);
    err.code = "action_pending_binding";
    err.status = 403;
    throw err;
  }

  if (
    requireCallable &&
    !delegatedTransportTarget &&
    primaryExecutor !== "http_client_backend" &&
    !runtimeCallable
  ) {
    const err = new Error(`Action is not runtime callable: ${action.action_key}`);
    err.code = "action_not_runtime_callable";
    err.status = 403;
    throw err;
  }

  if (
    !allowRegistryOnlyDirect &&
    !delegatedTransportTarget &&
    capabilityClass === "external_action_only" &&
    primaryExecutor !== "http_client_backend"
  ) {
    const err = new Error(`Registry-only external action cannot execute directly: ${action.action_key}`);
    err.code = "external_action_direct_execution_blocked";
    err.status = 403;
    throw err;
  }
}

function requireEndpointExecutionEligibility(policies, endpoint) {
  const blockInventoryOnly =
    String(
      policyValue(
        policies,
        "Execution Capability Governance",
        "Block Inventory Only Endpoints",
        "FALSE"
      )
    )
      .trim()
      .toUpperCase() === "TRUE";

  const endpointRole = String(endpoint.endpoint_role || "")
    .trim()
    .toLowerCase();

  const executionMode = String(endpoint.execution_mode || "")
    .trim()
    .toLowerCase();

  const transportRequired = boolFromSheet(endpoint.transport_required);

  const inventoryRole = String(endpoint.inventory_role || "")
    .trim()
    .toLowerCase();

  const delegatedTransportTarget =
    isDelegatedTransportTarget(endpoint);

  const snapshot = {
    ...getEndpointExecutionSnapshot(endpoint),
    block_inventory_only: blockInventoryOnly
  };

  debugLog(
    "ENDPOINT_EXECUTION_ELIGIBILITY_INPUT:",
    JSON.stringify(snapshot)
  );

  if (
    blockInventoryOnly &&
    !delegatedTransportTarget &&
    endpointRole &&
    endpointRole !== "primary"
  ) {
    debugLog(
      "ENDPOINT_EXECUTION_ELIGIBILITY_BLOCK:",
      JSON.stringify({ ...snapshot, reason: "endpoint_role_blocked" })
    );

    const err = new Error(
      `Endpoint is not a primary executable endpoint: ${endpoint.endpoint_key}`
    );
    err.code = "endpoint_role_blocked";
    err.status = 403;
    err.details = snapshot;
    throw err;
  }

  if (
    blockInventoryOnly &&
    !delegatedTransportTarget &&
    inventoryRole &&
    inventoryRole !== "endpoint_inventory"
  ) {
    debugLog(
      "ENDPOINT_EXECUTION_ELIGIBILITY_BLOCK:",
      JSON.stringify({ ...snapshot, reason: "inventory_only_endpoint" })
    );

    const err = new Error(
      `Non-executable inventory role cannot execute directly: ${endpoint.endpoint_key}`
    );
    err.code = "inventory_only_endpoint";
    err.status = 403;
    err.details = snapshot;
    throw err;
  }

  debugLog(
    "ENDPOINT_EXECUTION_ELIGIBILITY_PASS:",
    JSON.stringify(snapshot)
  );

  return {
    endpointRole,
    executionMode,
    transportRequired,
    delegatedTransportTarget
  };
}

function requireExecutionModeCompatibility(action, endpoint) {
  const primaryExecutor = String(action.primary_executor || "").trim().toLowerCase();
  const executionMode = String(endpoint.execution_mode || "").trim().toLowerCase();

  if (executionMode === "native_direct") {
    const err = new Error(
      `Native-direct endpoint must use native GPT execution path, not http-execute: ${endpoint.endpoint_key}`
    );
    err.code = "native_direct_requires_native_path";
    err.status = 403;
    throw err;
  }

  if (executionMode === "http_delegated" && primaryExecutor !== "http_client_backend") {
    const err = new Error(
      `Execution mode mismatch: endpoint ${endpoint.endpoint_key} is http_delegated but parent executor is ${primaryExecutor || "unset"}.`
    );
    err.code = "execution_mode_mismatch";
    err.status = 403;
    throw err;
  }
}

function requireNativeFamilyBoundary(policies, action, endpoint) {
  const nativeFamilies = policyList(
    policies,
    "HTTP Transport Routing",
    "Native Google Families Allowed"
  );

  const httpFamilies = policyList(
    policies,
    "HTTP Transport Routing",
    "HTTP Client Required Google Families"
  );

  const actionKey = String(action.action_key || "").trim();
  const executionMode = String(endpoint.execution_mode || "").trim().toLowerCase();
  const primaryExecutor = String(action.primary_executor || "").trim().toLowerCase();
  const delegatedTransportTarget = isDelegatedTransportTarget(endpoint);
  const isTransportExecutor = actionKey === "http_generic_api";

  if (nativeFamilies.includes(actionKey) && !delegatedTransportTarget) {
    throw Object.assign(
      new Error(
        `Native family ${actionKey} must not execute through http-execute unless delegated.`
      ),
      { code: "native_family_http_execution_blocked", status: 403 }
    );
  }

  if (httpFamilies.includes(actionKey)) {
    if (!isTransportExecutor && !delegatedTransportTarget) {
      throw Object.assign(
        new Error(
          `HTTP-governed family ${actionKey} must use delegated transport.`
        ),
        { code: "http_family_requires_delegation", status: 403 }
      );
    }
  }
}

function requireTransportIfDelegated(policies, action, endpoint) {
  const requireTransport = String(
    policyValue(
      policies,
      "Execution Capability Governance",
      "Require Transport For Delegated Actions",
      "FALSE"
    )
  ).trim().toUpperCase() === "TRUE";

  const executionMode = String(endpoint.execution_mode || "").trim().toLowerCase();
  const transportRequired = boolFromSheet(endpoint.transport_required);
  const allowedTransport = String(policyValue(
    policies,
    "HTTP Execution Governance",
    "Allowed Transport",
    "http_generic_api"
  )).trim();

  if (requireTransport && executionMode === "http_delegated") {
    const transportActionKey = String(endpoint.transport_action_key || "").trim();
    if (transportRequired && transportActionKey !== allowedTransport) {
      const err = new Error(
        `Delegated endpoint requires supported transport_action_key ${allowedTransport}; received ${transportActionKey || "unset"}.`
      );
      err.code = "transport_required";
      err.status = 403;
      throw err;
    }

    const normalizedPrimaryExecutor = String(action.primary_executor || "").trim().toLowerCase();
    const isTransportExecutor = String(action.action_key || "").trim() === "http_generic_api";

    if (!isTransportExecutor && normalizedPrimaryExecutor !== "http_client_backend") {
      const err = new Error(
        `Delegated endpoint requires http_client_backend as parent executor: ${action.action_key}`
      );
      err.code = "transport_executor_mismatch";
      err.status = 403;
      throw err;
    }
  }
}

function requireNoFallbackDirectExecution(policies, endpoint) {
  const fallbackRequiresPrimaryFailure = String(
    policyValue(
      policies,
      "Execution Capability Governance",
      "Fallback Requires Primary Failure",
      "FALSE"
    )
  ).trim().toUpperCase() === "TRUE";

  if (!fallbackRequiresPrimaryFailure) return;

  const fallbackAllowed = boolFromSheet(endpoint.fallback_allowed);
  const endpointRole = String(endpoint.endpoint_role || "").trim().toLowerCase();

  if (fallbackAllowed && endpointRole === "fallback") {
    const err = new Error(`Fallback endpoint cannot execute directly without primary failure: ${endpoint.endpoint_key}`);
    err.code = "fallback_requires_primary_failure";
    err.status = 403;
    throw err;
  }
}

function getPlaceholderResolutionSources(policies = []) {
  return policyList(
    policies,
    "HTTP Execution Governance",
    "Placeholder Resolution Sources"
  ).map(v => String(v || "").trim().toLowerCase());
}

function resolveRuntimeProviderDomainSource({
  requestBody = {},
  brand = null,
  parentActionKey = ""
}) {
  debugLog("RUNTIME_REQUEST_BODY:", JSON.stringify(requestBody));

  const directProviderDomain = safeNormalizeProviderDomain(requestBody.provider_domain);
  if (directProviderDomain && directProviderDomain !== "target_resolved") {
    return {
      resolvedProviderDomain: directProviderDomain,
      placeholderResolutionSource: "provider_domain"
    };
  }

  // Provider-native actions like Hostinger should not inherit brand.base_url.
  if (String(parentActionKey || "").trim() === "hostinger_api") {
    return {
      resolvedProviderDomain: "",
      placeholderResolutionSource: ""
    };
  }

  if (brand?.base_url) {
    return {
      resolvedProviderDomain: normalizeProviderDomain(brand.base_url),
      placeholderResolutionSource:
        String(requestBody.target_key || "").trim() ? "target_key"
        : String(requestBody.brand || "").trim() ? "brand"
        : String(requestBody.brand_domain || "").trim() ? "brand_domain"
        : "brand"
    };
  }

  return {
    resolvedProviderDomain: "",
    placeholderResolutionSource: ""
  };
}

function resolveProviderDomain({
  requestedProviderDomain,
  endpoint,
  brand,
  parentActionKey,
  policies = [],
  requestBody = {}
}) {
  const endpointProviderDomain = String(endpoint.provider_domain || "").trim();

  if (
    String(endpoint.execution_mode || "").trim().toLowerCase() === "native_controller" ||
    endpointProviderDomain === "same_service_native"
  ) {
    return {
      providerDomain: `http://127.0.0.1:${port}`,
      resolvedProviderDomainMode: "fixed_domain",
      placeholderResolutionSource: ""
    };
  }

  const {
    resolvedProviderDomain: runtimeResolvedProviderDomain,
    placeholderResolutionSource
  } = resolveRuntimeProviderDomainSource({
    requestBody,
    brand,
    parentActionKey
  });

  if (parentActionKey === "wordpress_api") {
    if (!brand || !brand.base_url) {
      const err = new Error("wordpress_api requires a brand-resolved base_url.");
      err.code = "provider_domain_not_allowed";
      err.status = 403;
      throw err;
    }

    return {
      providerDomain: normalizeProviderDomain(brand.base_url),
      resolvedProviderDomainMode: "brand_bound_domain",
      placeholderResolutionSource: placeholderResolutionSource || "brand"
    };
  }

  if (!endpointProviderDomain) {
    if (!runtimeResolvedProviderDomain) {
      const fallbackRequested = safeNormalizeProviderDomain(requestedProviderDomain);
      if (!fallbackRequested) {
        const err = new Error("provider_domain is required.");
        err.code = "provider_domain_not_resolved";
        err.status = 400;
        throw err;
      }

      return {
        providerDomain: fallbackRequested,
        resolvedProviderDomainMode: "fixed_domain",
        placeholderResolutionSource: ""
      };
    }

    return {
      providerDomain: runtimeResolvedProviderDomain,
      resolvedProviderDomainMode: "fixed_domain",
      placeholderResolutionSource
    };
  }

  if (isVariablePlaceholder(endpointProviderDomain, policies)) {
    const allowPlaceholderResolution = String(
      policyValue(
        policies,
        "HTTP Execution Governance",
        "Allow Placeholder Provider Domain Resolution",
        "FALSE"
      )
    ).trim().toUpperCase() === "TRUE";

    if (!allowPlaceholderResolution) {
      const err = new Error("Placeholder provider_domain resolution is disabled by policy.");
      err.code = "provider_domain_placeholder_blocked";
      err.status = 403;
      throw err;
    }

    if (!requestBody.target_key && !requestBody.brand && !requestBody.brand_domain) {
      debugLog("MISSING_PLACEHOLDER_SOURCES_AT_RUNTIME:", JSON.stringify(requestBody));
    }

    const allowedSources = getPlaceholderResolutionSources(policies);
    const hasAllowedSource =
      (allowedSources.includes("brand_domain") && !!String(requestBody.brand_domain || "").trim()) ||
      (allowedSources.includes("target_key") && !!String(requestBody.target_key || "").trim()) ||
      (allowedSources.includes("brand") && !!String(requestBody.brand || "").trim());

    if (allowedSources.length && !hasAllowedSource) {
      debugLog("MISSING_PLACEHOLDER_SOURCES_AT_RUNTIME:", JSON.stringify(requestBody));
      const err = new Error(
        `provider_domain placeholder resolution requires one of: ${allowedSources.join(", ")}`
      );
      err.code = "provider_domain_resolution_source_missing";
      err.status = 400;
      throw err;
    }

    if (!runtimeResolvedProviderDomain) {
      const err = new Error("provider_domain must resolve from governed runtime input.");
      err.code = "provider_domain_not_resolved";
      err.status = 400;
      throw err;
    }

    return {
      providerDomain: runtimeResolvedProviderDomain,
      resolvedProviderDomainMode: "placeholder_runtime_resolved",
      placeholderResolutionSource
    };
  }

  const normalizedEndpointProviderDomain =
    normalizeEndpointProviderDomain(endpointProviderDomain);
  const normalizedRequested =
    safeNormalizeProviderDomain(requestedProviderDomain);

  // Fixed-domain provider actions may omit provider_domain in the request.
  // In that case, trust the endpoint definition.
  if (!normalizedRequested) {
    return {
      providerDomain: normalizedEndpointProviderDomain,
      resolvedProviderDomainMode: "fixed_domain",
      placeholderResolutionSource: ""
    };
  }

  if (normalizedRequested !== normalizedEndpointProviderDomain) {
    const err = new Error("provider_domain does not match endpoint definition.");
    err.code = "provider_domain_mismatch";
    err.status = 403;
    throw err;
  }

  return {
    providerDomain: normalizedEndpointProviderDomain,
    resolvedProviderDomainMode: "fixed_domain",
    placeholderResolutionSource: ""
  };
}

function isOAuthConfigured(action) {
  const fileId = String(action.oauth_config_file_id || "").trim();
  return fileId !== "" && fileId.toLowerCase() !== "null";
}

function inferAuthMode({ action, brand }) {
  if (brand?.auth_type === "basic_auth_app_password") return "basic_auth";

  const actionKey = String(action.action_key || "").trim().toLowerCase();
  const apiKeyMode = String(action.api_key_mode || "").trim().toLowerCase();
  const headerName = String(action.api_key_header_name || "").trim();
  const paramName = String(action.api_key_param_name || "").trim();
  const oauthConfigured = isOAuthConfigured(action);

  if (
    headerName &&
    String(headerName).toLowerCase() === "authorization" &&
    apiKeyMode.includes("bearer")
  ) {
    return "bearer_token";
  }

  if (apiKeyMode === "basic_auth_app_password") {
    return "basic_auth";
  }

  if (
    actionKey === "googleads_api" &&
    oauthConfigured &&
    headerName &&
    String(headerName).toLowerCase() !== "authorization"
  ) {
    return "oauth_gpt_action";
  }

  if (headerName && apiKeyMode === "custom_api") {
    return "api_key_header";
  }

  if (paramName) return "api_key_query";
  if (headerName) return "api_key_header";

  if (oauthConfigured) return "oauth_gpt_action";
  return "none";
}

function normalizeAuthContract({
  action,
  brand,
  hostingAccounts = [],
  targetKey = ""
}) {
  const mode = inferAuthMode({ action, brand });
  const contract = {
    mode,
    inject: true,
    username: "",
    secret: "",
    param_name: "",
    header_name: "",
    custom_headers: {}
  };

  if (mode === "basic_auth") {
    contract.username = brand?.username || "";
    contract.secret = brand?.application_password || "";
    contract.header_name = "Authorization";
    return contract;
  }

  if (mode === "api_key_query") {
    contract.param_name = action.api_key_param_name || "api_key";
    contract.secret = action.api_key_value || "";
    return contract;
  }

  if (mode === "api_key_header") {
    contract.header_name = action.api_key_header_name || "x-api-key";
    contract.secret = action.api_key_value || "";
    return contract;
  }

  if (mode === "bearer_token") {
    contract.header_name = "Authorization";

    const storageMode = String(action.api_key_storage_mode || "")
      .trim()
      .toLowerCase();

    // old/simple action-level mode
    if (!storageMode || storageMode === "embedded_sheet") {
      contract.secret = action.api_key_value || "";
      return contract;
    }

    // governed per-target credentials:
    // brand -> hosting account OR direct hosting-account target -> account registry -> secret reference
    if (storageMode === "per_target_credentials") {
      const accountKey = resolveAccountKey({
        brand,
        targetKey,
        hostingAccounts
      });

      const hostingAccount = findHostingAccountByKey(hostingAccounts, accountKey);

      if (hostingAccount) {
        const accountStorageMode = String(
          hostingAccount.api_key_storage_mode || ""
        ).trim().toLowerCase();

        if (accountStorageMode === "secret_reference") {
          contract.secret = resolveSecretFromReference(
            hostingAccount.api_key_reference
          );
          return contract;
        }
        contract.secret = String(hostingAccount.api_key_reference || "").trim();
        return contract;
      }

      contract.secret = "";
      return contract;
    }

    contract.secret = action.api_key_value || "";
    return contract;
  }

  return contract;
}

function findHostingAccountByKey(hostingAccounts = [], key = "") {
  const wanted = String(key || "").trim();
  if (!wanted) return null;

  return (
    hostingAccounts.find(
      row => String(row.hosting_account_key || "").trim() === wanted
    ) || null
  );
}

function resolveAccountKeyFromBrand(brand = {}) {
  return (
    String(brand?.hosting_account_key || "").trim() ||
    String(brand?.hostinger_api_target_key || "").trim() ||
    String(brand?.hosting_account_registry_ref || "").trim()
  );
}

function resolveAccountKey({
  brand = null,
  targetKey = "",
  hostingAccounts = []
}) {
  const fromBrand = resolveAccountKeyFromBrand(brand);
  if (fromBrand) return fromBrand;

  const directTargetKey = String(targetKey || "").trim();
  if (!directTargetKey) return "";

  const directHostingAccount = findHostingAccountByKey(
    hostingAccounts,
    directTargetKey
  );
  if (directHostingAccount) {
    return String(directHostingAccount.hosting_account_key || "").trim();
  }

  return "";
}

function resolveSecretFromReference(reference = "") {
  const ref = String(reference || "").trim();
  if (!ref) return "";

  const prefix = "ref:secret:";
  if (!ref.startsWith(prefix)) return "";

  const secretKey = ref.slice(prefix.length).trim();
  if (!secretKey) return "";

  return String(process.env[secretKey] || "").trim();
}

function isGoogleApiHost(providerDomain = "") {
  try {
    return new URL(providerDomain).hostname.endsWith("googleapis.com");
  } catch {
    return false;
  }
}

function getAdditionalStaticAuthHeaders(action = {}, authContract = {}) {
  const headerName = String(action.api_key_header_name || "").trim();
  const headerValue = String(action.api_key_value || "").trim();

  if (!headerName || !headerValue) return {};
  if (headerName.toLowerCase() === "authorization") return {};

  return { [headerName]: headerValue };
}

function enforceSupportedAuthMode(policies, mode) {
  const supported = String(policyValue(policies, "HTTP Execution Governance", "Supported Auth Modes", ""))
    .split("|")
    .map(v => v.trim())
    .filter(Boolean);
  if (!supported.includes(mode)) {
    const err = new Error(`Resolved auth mode is unsupported by policy: ${mode}`);
    err.code = "unsupported_auth_mode";
    err.status = 403;
    throw err;
  }
}

function applyPathParams(pathTemplate, pathParams = {}) {
  return String(pathTemplate || "").replace(/\{([^}]+)\}/g, (_, key) => {
    const value = pathParams[key];
    if (value === undefined || value === null || value === "") {
      const err = new Error(`Missing required path param: ${key}`);
      err.code = "invalid_request";
      err.status = 400;
      throw err;
    }
    return encodeURIComponent(String(value));
  });
}

function pathTemplateToRegex(pathTemplate) {
  const escaped = String(pathTemplate)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\{[^}]+\\\}/g, "[^/]+");
  return new RegExp(`^${escaped}$`);
}

function ensureMethodAndPathMatchEndpoint(
  endpoint,
  requestedMethod,
  requestedPath,
  pathParams = {}
) {
  const endpointMethod = normalizeMethod(endpoint.method);
  const endpointPath = normalizePath(endpoint.endpoint_path_or_function);

  let expandedPath = "";
  let pathExpansionError = null;

  try {
    expandedPath = normalizePath(
      applyPathParams(endpointPath, pathParams)
    );
  } catch (err) {
    pathExpansionError = err;
  }

  if (requestedMethod) {
    const normalizedRequestedMethod = normalizeMethod(requestedMethod);
    if (normalizedRequestedMethod !== endpointMethod) {
      const err = new Error(
        `Method does not match endpoint definition for ${endpoint.endpoint_key}.`
      );
      err.code = "method_mismatch";
      err.status = 400;
      throw err;
    }
  }

  if (requestedPath) {
    const normalizedRequestedPath = normalizePath(requestedPath);

    const exact =
      normalizedRequestedPath === endpointPath ||
      (!!expandedPath && normalizedRequestedPath === expandedPath);

    const regexMatch =
      pathTemplateToRegex(endpointPath).test(normalizedRequestedPath);

    if (!exact && !regexMatch) {
      const err = new Error(
        `Path does not match endpoint definition for ${endpoint.endpoint_key}.`
      );
      err.code = "path_mismatch";
      err.status = 400;
      throw err;
    }

    return {
      method: endpointMethod,
      path: normalizedRequestedPath,
      templatePath: endpointPath
    };
  }

  if (pathExpansionError) {
    throw pathExpansionError;
  }

  return {
    method: endpointMethod,
    path: expandedPath,
    templatePath: endpointPath
  };
}

async function fetchSchemaContract(drive, fileId) {
  if (!fileId) {
    const err = new Error("Missing openai_schema_file_id.");
    err.code = "schema_binding_missing";
    err.status = 403;
    throw err;
  }

  const meta = await drive.files.get({
    fileId,
    fields: "id,name,mimeType"
  });

  const { mimeType = "", name = "" } = meta.data || {};
  let raw = "";

  if (mimeType.startsWith("application/vnd.google-apps")) {
    const exported = await drive.files.export(
      { fileId, mimeType: "text/plain" },
      { responseType: "text" }
    );
    raw = String(exported.data || "");
  } else {
    const content = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "text" }
    );
    raw = String(content.data || "");
  }

  let parsed;
  try {
    if (name.endsWith(".json") || mimeType.includes("json")) {
      parsed = JSON.parse(raw);
    } else {
      parsed = YAML.parse(raw);
    }
  } catch {
    const err = new Error(`Unable to parse schema file ${fileId}.`);
    err.code = "schema_parse_failed";
    err.status = 500;
    throw err;
  }

  return { fileId, name, mimeType, raw, parsed };
}

async function fetchOAuthConfigContract(drive, action) {
  const fileId = String(action.oauth_config_file_id || "").trim();
  if (!fileId) return null;

  try {
    const meta = await drive.files.get({ fileId, fields: "id,name,mimeType" });
    const { mimeType = "", name = "" } = meta.data || {};
    let raw = "";

    if (mimeType.startsWith("application/vnd.google-apps")) {
      const exported = await drive.files.export(
        { fileId, mimeType: "text/plain" },
        { responseType: "text" }
      );
      raw = String(exported.data || "");
    } else {
      const content = await drive.files.get(
        { fileId, alt: "media" },
        { responseType: "text" }
      );
      raw = String(content.data || "");
    }

    let parsed;
    try {
      if (name.endsWith(".json") || mimeType.includes("json")) {
        parsed = JSON.parse(raw);
      } else {
        parsed = YAML.parse(raw);
      }
    } catch {
      parsed = JSON.parse(raw);
    }

    return { fileId, name, mimeType, raw, parsed };
  } catch (err) {
    debugLog("OAUTH_CONFIG_READ_FAILED:", {
      action_key: action.action_key,
      oauth_config_file_id: fileId,
      message: err?.message || String(err)
    });
    return null;
  }
}

function resolveSchemaOperation(schema, method, path) {
  const doc = schema?.parsed || {};
  const paths = doc.paths || {};
  const methodKey = String(method || "").toLowerCase();

  if (paths[path] && paths[path][methodKey]) {
    return { operation: paths[path][methodKey], pathTemplate: path };
  }

  for (const [template, entry] of Object.entries(paths)) {
    const regex = pathTemplateToRegex(template);
    if (regex.test(path) && entry?.[methodKey]) {
      return { operation: entry[methodKey], pathTemplate: template };
    }
  }

  return null;
}

function validateByJsonSchema(schema, value, scope, pathPrefix = "") {
  if (!schema) return [];

  const errors = [];
  const types = Array.isArray(schema.type) ? schema.type : (schema.type ? [schema.type] : []);
  const actualType = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
  const normalizedActualType = actualType === "number" && Number.isInteger(value) ? "integer" : actualType;

  if (types.length && !types.includes(normalizedActualType) && !(types.includes("number") && normalizedActualType === "integer")) {
    errors.push(`${scope}${pathPrefix}: expected ${types.join("|")} got ${normalizedActualType}`);
    return errors;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${scope}${pathPrefix}: value not in enum`);
    return errors;
  }

  if (normalizedActualType === "object" && schema.properties) {
    const required = schema.required || [];
    for (const req of required) {
      if (!(req in (value || {}))) {
        errors.push(`${scope}${pathPrefix}.${req}: missing required property`);
      }
    }
    for (const [key, rule] of Object.entries(schema.properties || {})) {
      if (value && key in value) {
        errors.push(...validateByJsonSchema(rule, value[key], scope, `${pathPrefix}.${key}`));
      }
    }
  }

  if (normalizedActualType === "array" && schema.items && Array.isArray(value)) {
    value.forEach((item, idx) => {
      errors.push(...validateByJsonSchema(schema.items, item, scope, `${pathPrefix}[${idx}]`));
    });
  }

  return errors;
}

function validateParameters(operation, request) {
  const errors = [];
  const params = operation?.parameters || [];
  for (const param of params) {
    const where = param.in;
    const name = param.name;
    const required = !!param.required;
    const source = where === "path" ? request.path_params
      : where === "query" ? request.query
      : where === "header" ? request.headers
      : {};
    const value = source ? source[name] ?? source[name?.toLowerCase?.()] : undefined;
    if (required && (value === undefined || value === null || value === "")) {
      errors.push(`missing required ${where} parameter: ${name}`);
      continue;
    }
    if (value !== undefined && param.schema) {
      errors.push(...validateByJsonSchema(param.schema, value, `${where}:${name}`));
    }
  }
  return errors;
}

function validateRequestBody(operation, body) {
  const reqBody = operation?.requestBody;
  if (!reqBody) return [];
  if (reqBody.required && (body === undefined || body === null)) {
    return ["missing required request body"];
  }
  if (body === undefined || body === null) return [];

  const content = reqBody.content || {};
  const jsonContent = content["application/json"] || Object.values(content)[0];
  const schema = jsonContent?.schema;
  if (!schema) return [];
  return validateByJsonSchema(schema, body, "body");
}

function classifySchemaDrift(expected, actual, scope) {
  if (!expected || actual === undefined || actual === null || typeof actual !== "object" || Array.isArray(actual)) return null;
  const expectedProps = expected.properties || {};
  const expectedKeys = new Set(Object.keys(expectedProps));
  const actualKeys = Object.keys(actual);
  const required = new Set(expected.required || []);

  for (const key of required) {
    if (!(key in actual)) {
      return { schema_drift_detected: true, schema_drift_type: "missing_required", schema_drift_scope: scope };
    }
  }

  for (const key of actualKeys) {
    if (!expectedKeys.has(key)) {
      return { schema_drift_detected: true, schema_drift_type: "additive", schema_drift_scope: scope };
    }
    const rule = expectedProps[key] || {};
    if (rule.enum && !rule.enum.includes(actual[key])) {
      return { schema_drift_detected: true, schema_drift_type: "enum_mismatch", schema_drift_scope: scope };
    }
    const t = rule.type;
    if (t) {
      const actualType = Array.isArray(actual[key]) ? "array" : actual[key] === null ? "null" : typeof actual[key];
      const mappedActual = actualType === "number" && Number.isInteger(actual[key]) ? "integer" : actualType;
      const acceptable = Array.isArray(t) ? t : [t];
      if (!acceptable.includes(mappedActual) && !(acceptable.includes("number") && mappedActual === "integer")) {
        return { schema_drift_detected: true, schema_drift_type: "type_mismatch", schema_drift_scope: scope };
      }
    }
  }
  return null;
}

function buildResolvedAuthHeaders(contract) {
  if (contract.mode === "basic_auth") {
    if (!contract.username || !contract.secret) {
      const err = new Error("Missing username or secret for basic_auth.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    const token = Buffer.from(`${contract.username}:${contract.secret}`, "utf8").toString("base64");
    return { Authorization: `Basic ${token}` };
  }

  if (contract.mode === "bearer_token") {
    if (!contract.secret) {
      const err = new Error("Missing secret for bearer_token.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    return { Authorization: `Bearer ${contract.secret}` };
  }

  if (contract.mode === "custom_headers") {
    return { ...(contract.custom_headers || {}) };
  }

  return {};
}

function injectAuthIntoQuery(query, contract) {
  if (contract.mode === "api_key_query") {
    if (!contract.param_name || !contract.secret) {
      const err = new Error("Missing param_name or secret for api_key_query.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    return { ...query, [contract.param_name]: contract.secret };
  }
  return query;
}

function injectAuthIntoHeaders(headers, contract) {
  if (contract.mode === "api_key_header") {
    if (!contract.header_name || !contract.secret) {
      const err = new Error("Missing header_name or secret for api_key_header.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    return { ...headers, [contract.header_name]: contract.secret };
  }

  return { ...headers, ...buildResolvedAuthHeaders(contract) };
}

function injectAuthForSchemaValidation(query, headers, contract) {
  let nextQuery = { ...(query || {}) };
  let nextHeaders = { ...(headers || {}) };

  if (contract.mode === "api_key_query") {
    if (!contract.param_name || !contract.secret) {
      const err = new Error("Missing param_name or secret for api_key_query.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    nextQuery[contract.param_name] = contract.secret;
  }

  if (contract.mode === "api_key_header") {
    if (!contract.header_name || !contract.secret) {
      const err = new Error("Missing header_name or secret for api_key_header.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    nextHeaders[contract.header_name] = contract.secret;
  }

  if (contract.mode === "bearer_token") {
    if (!contract.secret) {
      const err = new Error("Missing secret for bearer_token.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    nextHeaders["Authorization"] = `Bearer ${contract.secret}`;
  }

  if (contract.mode === "basic_auth") {
    if (!contract.username || !contract.secret) {
      const err = new Error("Missing username or secret for basic_auth.");
      err.code = "auth_resolution_failed";
      err.status = 500;
      throw err;
    }
    const token = Buffer.from(`${contract.username}:${contract.secret}`, "utf8").toString("base64");
    nextHeaders["Authorization"] = `Basic ${token}`;
  }

  return { query: nextQuery, headers: nextHeaders };
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


const TERMINAL_JOB_STATUSES = new Set([
  "succeeded",
  "failed",
  "cancelled"
]);
const ACTIVE_JOB_STATUSES = new Set([
  "queued",
  "running",
  "retrying"
]);

function nowIso() {
  return new Date().toISOString();
}

function normalizeJobId(value = "") {
  return String(value || "").trim();
}

function normalizeJobStatus(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizeWebhookUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function normalizeMaxAttempts(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_JOB_MAX_ATTEMPTS;
  return Math.min(Math.floor(n), 10);
}

function nextRetryDelayMs(attemptCount) {
  const idx = Math.max(0, Number(attemptCount || 1) - 1);
  if (idx < JOB_RETRY_DELAYS_MS.length) return JOB_RETRY_DELAYS_MS[idx];
  return JOB_RETRY_DELAYS_MS[JOB_RETRY_DELAYS_MS.length - 1];
}

function buildJobId() {
  return `job_${crypto.randomUUID().replace(/-/g, "")}`;
}

function resolveRequestedBy(req) {
  const byHeader =
    req.header("X-Requested-By") ||
    req.header("X-Requester-Id") ||
    "";

  return String(byHeader || req.ip || "unknown").trim();
}

function makeIdempotencyLookupKey(requestedBy, idempotencyKey) {
  const key = String(idempotencyKey || "").trim();
  if (!key) return "";
  return `${String(requestedBy || "").trim()}::${key}`;
}

function buildExecutionPayloadFromJobRequest(body = {}) {
  const nested =
    body.request_payload &&
    typeof body.request_payload === "object" &&
    !Array.isArray(body.request_payload)
      ? { ...body.request_payload }
      : null;

  const topLevelPayload = { ...(body || {}) };
  delete topLevelPayload.request_payload;
  delete topLevelPayload.job_type;
  delete topLevelPayload.max_attempts;
  delete topLevelPayload.webhook_url;
  delete topLevelPayload.callback_secret;
  delete topLevelPayload.idempotency_key;

  return nested || topLevelPayload;
}

function validateAsyncJobRequest(payload = {}) {
  const errors = [];
  const allowedMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return ["request payload must be an object."];
  }

  if (!String(payload.parent_action_key || "").trim()) {
    errors.push("parent_action_key is required.");
  }

  if (!String(payload.endpoint_key || "").trim()) {
    errors.push("endpoint_key is required.");
  }

  if (payload.target_key !== undefined && typeof payload.target_key !== "string") {
    errors.push("target_key must be a string when provided.");
  }

  if (payload.brand !== undefined && typeof payload.brand !== "string") {
    errors.push("brand must be a string when provided.");
  }

  if (payload.brand_domain !== undefined && typeof payload.brand_domain !== "string") {
    errors.push("brand_domain must be a string when provided.");
  }

  if (payload.provider_domain !== undefined && typeof payload.provider_domain !== "string") {
    errors.push("provider_domain must be a string when provided.");
  }

  if (payload.parent_action_key !== undefined && typeof payload.parent_action_key !== "string") {
    errors.push("parent_action_key must be a string when provided.");
  }

  if (payload.endpoint_key !== undefined && typeof payload.endpoint_key !== "string") {
    errors.push("endpoint_key must be a string when provided.");
  }

  if (payload.method !== undefined) {
    if (typeof payload.method !== "string") {
      errors.push("method must be a string when provided.");
    } else {
      const normalizedMethod = String(payload.method).trim().toUpperCase();
      if (!allowedMethods.has(normalizedMethod)) {
        errors.push("method must be one of GET, POST, PUT, PATCH, DELETE.");
      }
    }
  }

  if (payload.path !== undefined) {
    if (typeof payload.path !== "string") {
      errors.push("path must be a string when provided.");
    } else {
      const trimmedPath = String(payload.path).trim();
      if (!trimmedPath.startsWith("/")) {
        errors.push("path must start with '/'.");
      }
      if (/^https?:\/\//i.test(trimmedPath)) {
        errors.push("path must be a relative path, not a full URL.");
      }
    }
  }

  if (
    payload.path_params !== undefined &&
    (
      !payload.path_params ||
      typeof payload.path_params !== "object" ||
      Array.isArray(payload.path_params)
    )
  ) {
    errors.push("path_params must be an object when provided.");
  }

  if (
    payload.query !== undefined &&
    (
      !payload.query ||
      typeof payload.query !== "object" ||
      Array.isArray(payload.query)
    )
  ) {
    errors.push("query must be an object when provided.");
  }

  if (
    payload.headers !== undefined &&
    (
      !payload.headers ||
      typeof payload.headers !== "object" ||
      Array.isArray(payload.headers)
    )
  ) {
    errors.push("headers must be an object when provided.");
  }

  if (payload.headers && typeof payload.headers === "object" && !Array.isArray(payload.headers)) {
    for (const [key, value] of Object.entries(payload.headers)) {
      if (typeof value !== "string") {
        errors.push(`headers.${key} must be a string.`);
      }
      if (String(key).toLowerCase() === "authorization") {
        errors.push("headers.Authorization must not be supplied by caller.");
      }
    }
  }

  if (
    payload.readback !== undefined &&
    (
      !payload.readback ||
      typeof payload.readback !== "object" ||
      Array.isArray(payload.readback)
    )
  ) {
    errors.push("readback must be an object when provided.");
  }

  if (payload.readback && typeof payload.readback === "object" && !Array.isArray(payload.readback)) {
    if (
      payload.readback.required !== undefined &&
      typeof payload.readback.required !== "boolean"
    ) {
      errors.push("readback.required must be a boolean when provided.");
    }

    if (payload.readback.mode !== undefined) {
      const allowedModes = new Set(["none", "echo", "location_followup"]);
      if (typeof payload.readback.mode !== "string") {
        errors.push("readback.mode must be a string when provided.");
      } else if (!allowedModes.has(String(payload.readback.mode).trim())) {
        errors.push("readback.mode must be one of none, echo, location_followup.");
      }
    }
  }

  if (
    payload.expect_json !== undefined &&
    typeof payload.expect_json !== "boolean"
  ) {
    errors.push("expect_json must be a boolean when provided.");
  }

  if (
    payload.force_refresh !== undefined &&
    typeof payload.force_refresh !== "boolean"
  ) {
    errors.push("force_refresh must be a boolean when provided.");
  }

  if (payload.timeout_seconds !== undefined) {
    if (
      typeof payload.timeout_seconds !== "number" ||
      !Number.isInteger(payload.timeout_seconds)
    ) {
      errors.push("timeout_seconds must be an integer when provided.");
    } else {
      if (payload.timeout_seconds < 1) {
        errors.push("timeout_seconds must be at least 1.");
      }
      if (payload.timeout_seconds > MAX_TIMEOUT_SECONDS) {
        errors.push(`timeout_seconds must be <= ${MAX_TIMEOUT_SECONDS}.`);
      }
    }
  }

  return errors;
}



function createHttpError(code, message, status = 400, details) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  if (details !== undefined) err.details = details;
  return err;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => String(item || "").trim())
    .filter(Boolean);
}


function buildRecordFromHeaderAndRow(header = [], row = []) {
  const record = {};
  header.forEach((key, idx) => {
    const normalizedKey = String(key || "").trim();
    if (!normalizedKey) return;
    record[normalizedKey] = row[idx] ?? "";
  });
  return record;
}

function buildSheetRowFromColumns(columns = [], row = {}) {
  return columns.map(column => toSheetCellValue(row[column]));
}

function assertCanonicalHeaderExact(header = [], expected = [], sheetName = "sheet") {
  const actual = (header || []).map(v => String(v || "").trim());
  const canonical = (expected || []).map(v => String(v || "").trim());

  if (actual.length !== canonical.length) {
    const err = new Error(
      `${sheetName} header column count mismatch. expected=${canonical.length} actual=${actual.length}`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    throw err;
  }

  const mismatches = [];
  for (let i = 0; i < canonical.length; i += 1) {
    if (actual[i] !== canonical[i]) {
      mismatches.push({
        index: i,
        expected: canonical[i],
        actual: actual[i] || ""
      });
    }
  }

  if (mismatches.length) {
    const err = new Error(
      `${sheetName} header order mismatch at ${mismatches.length} position(s).`
    );
    err.code = "sheet_schema_mismatch";
    err.status = 500;
    err.details = mismatches;
    throw err;
  }

  return true;
}

function blockLegacyRouteWorkflowWrite(surfaceName = "", requestedColumns = []) {
  const cols = (requestedColumns || []).map(v => String(v || "").trim());

  if (
    surfaceName === TASK_ROUTES_SHEET &&
    cols.length > 0 &&
    cols.length < TASK_ROUTES_CANONICAL_COLUMNS.length
  ) {
    const err = new Error(
      `Blocked legacy write to ${surfaceName}. Canonical schema requires ${TASK_ROUTES_CANONICAL_COLUMNS.length} columns.`
    );
    err.code = "legacy_schema_write_blocked";
    err.status = 500;
    throw err;
  }

  if (
    surfaceName === WORKFLOW_REGISTRY_SHEET &&
    cols.length > 0 &&
    cols.length < WORKFLOW_REGISTRY_CANONICAL_COLUMNS.length
  ) {
    const err = new Error(
      `Blocked legacy write to ${surfaceName}. Canonical schema requires ${WORKFLOW_REGISTRY_CANONICAL_COLUMNS.length} columns.`
    );
    err.code = "legacy_schema_write_blocked";
    err.status = 500;
    throw err;
  }

  return true;
}

function assertNoLegacySiteMigrationScaffolding() {
  if (
    typeof SITE_MIGRATION_TASK_ROUTE_COLUMNS !== "undefined" ||
    typeof SITE_MIGRATION_WORKFLOW_COLUMNS !== "undefined" ||
    typeof SITE_MIGRATION_TASK_ROUTE_ROWS !== "undefined" ||
    typeof SITE_MIGRATION_WORKFLOW_ROWS !== "undefined"
  ) {
    const err = new Error("Legacy SITE_MIGRATION_* scaffolding must not exist in canonical mode.");
    err.code = "legacy_site_migration_scaffolding_present";
    err.status = 500;
    throw err;
  }
}

function assertSingleActiveRowByKey(rows = [], keyName = "", activeName = "active", sheetName = "sheet") {
  const seen = new Map();

  for (const row of rows) {
    const key = String(row?.[keyName] || "").trim();
    const active = String(row?.[activeName] || "").trim().toUpperCase() === "TRUE";
    if (!key || !active) continue;

    const count = seen.get(key) || 0;
    seen.set(key, count + 1);
  }

  const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key);
  if (duplicates.length) {
    const err = new Error(
      `${sheetName} has duplicate active governed keys: ${duplicates.join(", ")}`
    );
    err.code = "duplicate_active_governed_keys";
    err.status = 500;
    throw err;
  }

  return true;
}

function normalizeGovernedAdditionState(value = "") {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return "active";
  if (!GOVERNED_ADDITION_STATES.has(v)) return "active";
  return v;
}

function normalizeGovernedAdditionOutcome(value = "") {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return "";
  if (!GOVERNED_ADDITION_OUTCOMES.has(v)) return "";
  return v;
}

function governedAdditionStateBlocksAuthority(value = "") {
  const state = normalizeGovernedAdditionState(value);
  return ["candidate", "inactive", "pending_validation", "blocked", "degraded"].includes(state);
}

function hasDeferredGovernedActivationDependencies(row = {}, keys = []) {
  return (keys || []).some(key => boolFromSheet(row?.[key]));
}

function buildGovernedAdditionReviewResult(args = {}) {
  const outcome = normalizeGovernedAdditionOutcome(args.outcome);
  if (!outcome) {
    const err = new Error("Invalid governed addition outcome.");
    err.code = "invalid_governed_addition_outcome";
    err.status = 400;
    throw err;
  }

  return {
    outcome,
    addition_state: normalizeGovernedAdditionState(args.addition_state || "pending_validation"),
    route_overlap_detected: !!args.route_overlap_detected,
    workflow_overlap_detected: !!args.workflow_overlap_detected,
    chain_needed: !!args.chain_needed,
    graph_update_required: !!args.graph_update_required,
    bindings_update_required: !!args.bindings_update_required,
    policy_update_required: !!args.policy_update_required,
    starter_update_required: !!args.starter_update_required,
    reconciliation_required: !!args.reconciliation_required,
    validation_required: true
  };
}

function assertNoDirectActivationWithoutGovernedReview(row = {}, surfaceName = "sheet") {
  const additionState = normalizeGovernedAdditionState(
    row.addition_status || row.governance_status || row.validation_status || ""
  );
  const active = String(row.active || "").trim().toUpperCase() === "TRUE";

  if (active && ["candidate", "pending_validation", "inactive", "blocked", "degraded"].includes(additionState)) {
    return true;
  }

  if (active && !additionState) {
    // existing canonical rows are allowed
    return true;
  }

  return true;
}

async function getSpreadsheetSheetMap(sheets, spreadsheetId) {
  const response = await sheets.spreadsheets.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    fields: "sheets.properties(sheetId,title,index)"
  });

  const map = {};
  for (const sheet of response.data.sheets || []) {
    const props = sheet?.properties || {};
    const title = String(props.title || "").trim();
    if (!title) continue;
    map[title] = {
      sheetId: props.sheetId,
      title,
      index: props.index
    };
  }
  return map;
}

async function ensureSheetWithHeader(sheets, spreadsheetId, sheetName, columns) {
  blockLegacyRouteWorkflowWrite(sheetName, columns);

  const sheetMap = await getSpreadsheetSheetMap(sheets, spreadsheetId);
  if (!sheetMap[sheetName]) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: String(spreadsheetId || "").trim(),
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: sheetName
              }
            }
          }
        ]
      }
    });
  }

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toValuesApiRange(sheetName, "1:2")
  });

  const values = response.data.values || [];
  const existingHeader = (values[0] || []).map(v => String(v || "").trim()).filter(Boolean);

  if (!existingHeader.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: String(spreadsheetId || "").trim(),
      range: toValuesApiRange(sheetName, "A1"),
      valueInputOption: "RAW",
      requestBody: {
        values: [columns]
      }
    });
    return { created: true, header_written: true };
  }

  const existingSignature = computeHeaderSignature(existingHeader);
  const expectedSignature = computeHeaderSignature(columns);
  if (existingSignature !== expectedSignature) {
    const err = new Error(`${sheetName} header signature mismatch.`);
    err.code = "sheet_schema_mismatch";
    err.status = 409;
    throw err;
  }

  return { created: false, header_written: false };
}

async function appendRowsIfMissingByKeys(
  sheets,
  spreadsheetId,
  sheetName,
  columns,
  keyColumns,
  rows = []
) {
  blockLegacyRouteWorkflowWrite(sheetName, columns);

  if (!rows.length) return { appended: 0, existing: 0 };

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toValuesApiRange(sheetName, "A:AZ")
  });

  const values = response.data.values || [];
  const header = (values[0] || []).map(v => String(v || "").trim());
  const existingRows = values.slice(1).map(row => buildRecordFromHeaderAndRow(header, row));

  const seen = new Set(
    existingRows.map(record => keyColumns.map(key => String(record[key] || "").trim()).join("||"))
  );

  const missingRows = rows.filter(row => {
    const key = keyColumns.map(column => String(row[column] || "").trim()).join("||");
    return key && !seen.has(key);
  });

  if (!missingRows.length) {
    return { appended: 0, existing: rows.length };
  }

  for (const row of missingRows) {
    assertNoDirectActivationWithoutGovernedReview(row, sheetName);
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: toA1Start(sheetName),
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: missingRows.map(row => buildSheetRowFromColumns(columns, row))
    }
  });

  return {
    appended: missingRows.length,
    existing: rows.length - missingRows.length
  };
}

async function ensureSiteMigrationRegistrySurfaces() {
  assertNoLegacySiteMigrationScaffolding();

  await assertSheetExistsInSpreadsheet(REGISTRY_SPREADSHEET_ID, SITE_RUNTIME_INVENTORY_REGISTRY_SHEET);
  await assertSheetExistsInSpreadsheet(REGISTRY_SPREADSHEET_ID, SITE_SETTINGS_INVENTORY_REGISTRY_SHEET);
  await assertSheetExistsInSpreadsheet(REGISTRY_SPREADSHEET_ID, PLUGIN_INVENTORY_REGISTRY_SHEET);

  const taskShape = await readLiveSheetShape(
    REGISTRY_SPREADSHEET_ID,
    TASK_ROUTES_SHEET,
    toValuesApiRange(TASK_ROUTES_SHEET, "A1:AF2")
  );
  const taskRoutesMetadata = await getCanonicalSurfaceMetadata(
    "surface.task_routes_sheet",
    {
      columns: TASK_ROUTES_CANONICAL_COLUMNS,
      schema_ref: "row_audit_schema:Task Routes",
      schema_version: "v1",
      binding_mode: "gid_based",
      sheet_role: "authority_surface",
      audit_mode: "exact_header_match"
    }
  );
  assertHeaderMatchesSurfaceMetadata({
    sheetName: TASK_ROUTES_SHEET,
    actualHeader: taskShape.header,
    metadata: taskRoutesMetadata,
    fallbackColumns: TASK_ROUTES_CANONICAL_COLUMNS
  });

  const workflowShape = await readLiveSheetShape(
    REGISTRY_SPREADSHEET_ID,
    WORKFLOW_REGISTRY_SHEET,
    toValuesApiRange(WORKFLOW_REGISTRY_SHEET, "A1:AL2")
  );
  const workflowRegistryMetadata = await getCanonicalSurfaceMetadata(
    "surface.workflow_registry_sheet",
    {
      columns: WORKFLOW_REGISTRY_CANONICAL_COLUMNS,
      schema_ref: "row_audit_schema:Workflow Registry",
      schema_version: "v1",
      binding_mode: "gid_based",
      sheet_role: "authority_surface",
      audit_mode: "exact_header_match"
    }
  );
  assertHeaderMatchesSurfaceMetadata({
    sheetName: WORKFLOW_REGISTRY_SHEET,
    actualHeader: workflowShape.header,
    metadata: workflowRegistryMetadata,
    fallbackColumns: WORKFLOW_REGISTRY_CANONICAL_COLUMNS
  });

  const taskRoutesSchemaLabel =
    [
      String(taskRoutesMetadata.schema_ref || "").trim(),
      String(taskRoutesMetadata.schema_version || "").trim()
    ]
      .filter(Boolean)
      .join("@") || "canonical_32";
  const workflowRegistrySchemaLabel =
    [
      String(workflowRegistryMetadata.schema_ref || "").trim(),
      String(workflowRegistryMetadata.schema_version || "").trim()
    ]
      .filter(Boolean)
      .join("@") || "canonical_38";

  return {
    mode: "validate_only",
    site_runtime_inventory: { exists: true },
    site_settings_inventory: { exists: true },
    plugin_inventory: { exists: true },
    task_routes: {
      exists: true,
      schema: taskRoutesSchemaLabel
    },
    workflow_registry: {
      exists: true,
      schema: workflowRegistrySchemaLabel
    }
  };
}

async function ensureSiteMigrationRouteWorkflowRows() {
  assertNoLegacySiteMigrationScaffolding();

  const taskShape = await readLiveSheetShape(
    REGISTRY_SPREADSHEET_ID,
    TASK_ROUTES_SHEET,
    toValuesApiRange(TASK_ROUTES_SHEET, "A1:AF2")
  );
  const taskRoutesMetadata = await getCanonicalSurfaceMetadata(
    "surface.task_routes_sheet",
    {
      columns: TASK_ROUTES_CANONICAL_COLUMNS,
      schema_ref: "row_audit_schema:Task Routes",
      schema_version: "v1",
      binding_mode: "gid_based",
      sheet_role: "authority_surface",
      audit_mode: "exact_header_match"
    }
  );
  assertHeaderMatchesSurfaceMetadata({
    sheetName: TASK_ROUTES_SHEET,
    actualHeader: taskShape.header,
    metadata: taskRoutesMetadata,
    fallbackColumns: TASK_ROUTES_CANONICAL_COLUMNS
  });

  const workflowShape = await readLiveSheetShape(
    REGISTRY_SPREADSHEET_ID,
    WORKFLOW_REGISTRY_SHEET,
    toValuesApiRange(WORKFLOW_REGISTRY_SHEET, "A1:AL2")
  );
  const workflowRegistryMetadata = await getCanonicalSurfaceMetadata(
    "surface.workflow_registry_sheet",
    {
      columns: WORKFLOW_REGISTRY_CANONICAL_COLUMNS,
      schema_ref: "row_audit_schema:Workflow Registry",
      schema_version: "v1",
      binding_mode: "gid_based",
      sheet_role: "authority_surface",
      audit_mode: "exact_header_match"
    }
  );
  assertHeaderMatchesSurfaceMetadata({
    sheetName: WORKFLOW_REGISTRY_SHEET,
    actualHeader: workflowShape.header,
    metadata: workflowRegistryMetadata,
    fallbackColumns: WORKFLOW_REGISTRY_CANONICAL_COLUMNS
  });

  const { sheets } = await getGoogleClients();

  const taskRoutes = await loadTaskRoutesRegistry(sheets, {
    include_candidate_inspection: true
  });
  const workflows = await loadWorkflowRegistry(sheets, {
    include_candidate_inspection: true
  });

  const foundTaskKeys = new Set(
    taskRoutes
      .map(row => String(row.task_key || row.route_key || "").trim())
      .filter(Boolean)
  );
  const foundWorkflowIds = new Set(
    workflows
      .map(row => String(row.workflow_id || "").trim())
      .filter(Boolean)
  );

  const executableTaskKeys = new Set(
    taskRoutes
      .filter(row => row.executable_authority === true)
      .map(row => String(row.task_key || row.route_key || "").trim())
      .filter(Boolean)
  );
  const executableWorkflowIds = new Set(
    workflows
      .filter(row => row.executable_authority === true)
      .map(row => String(row.workflow_id || "").trim())
      .filter(Boolean)
  );

  const missingTaskKeys = REQUIRED_SITE_MIGRATION_TASK_KEYS.filter(v => !foundTaskKeys.has(v));
  const missingWorkflowIds = REQUIRED_SITE_MIGRATION_WORKFLOW_IDS.filter(v => !foundWorkflowIds.has(v));

  const unresolvedTaskAuthority = REQUIRED_SITE_MIGRATION_TASK_KEYS.filter(
    v => foundTaskKeys.has(v) && !executableTaskKeys.has(v)
  );
  const unresolvedWorkflowAuthority = REQUIRED_SITE_MIGRATION_WORKFLOW_IDS.filter(
    v => foundWorkflowIds.has(v) && !executableWorkflowIds.has(v)
  );

  const chainReviewRequired =
    taskRoutes.some(row => boolFromSheet(row.chain_candidate)) ||
    workflows.some(row => boolFromSheet(row.chain_eligible));
  const graphReviewRequired =
    taskRoutes.some(row => boolFromSheet(row.graph_update_required)) ||
    workflows.some(row => boolFromSheet(row.graph_update_required));
  const bindingsReviewRequired =
    taskRoutes.some(row => boolFromSheet(row.bindings_update_required)) ||
    workflows.some(row => boolFromSheet(row.bindings_update_required));
  const reconciliationRequired =
    taskRoutes.some(row => boolFromSheet(row.reconciliation_required)) ||
    workflows.some(row => boolFromSheet(row.reconciliation_required));
  const policyReviewRequired =
    taskRoutes.some(row => boolFromSheet(row.policy_update_required)) ||
    workflows.some(row =>
      boolFromSheet(row.policy_update_required) ||
      boolFromSheet(row.policy_dependency_required)
    );
  const starterReviewRequired =
    taskRoutes.some(row => boolFromSheet(row.starter_update_required)) ||
    workflows.some(row => boolFromSheet(row.starter_update_required));
  const repairMappingRequired =
    workflows.some(row => boolFromSheet(row.repair_mapping_required));

  const hasMissingDependencies = missingTaskKeys.length > 0 || missingWorkflowIds.length > 0;
  const hasDeferredActivation =
    unresolvedTaskAuthority.length > 0 ||
    unresolvedWorkflowAuthority.length > 0 ||
    chainReviewRequired ||
    graphReviewRequired ||
    bindingsReviewRequired ||
    reconciliationRequired ||
    policyReviewRequired ||
    starterReviewRequired ||
    repairMappingRequired;

  const outcome = hasMissingDependencies
    ? "degraded_missing_dependencies"
    : hasDeferredActivation
    ? "pending_validation"
    : "reuse_existing";

  const review = buildGovernedAdditionReviewResult({
    outcome,
    addition_state: outcome === "reuse_existing" ? "active" : "pending_validation",
    route_overlap_detected: false,
    workflow_overlap_detected: false,
    chain_needed: chainReviewRequired,
    graph_update_required: graphReviewRequired,
    bindings_update_required: bindingsReviewRequired,
    policy_update_required: policyReviewRequired,
    starter_update_required: starterReviewRequired,
    reconciliation_required: reconciliationRequired
  });

  const taskRoutesSchemaLabel =
    [
      String(taskRoutesMetadata.schema_ref || "").trim(),
      String(taskRoutesMetadata.schema_version || "").trim()
    ]
      .filter(Boolean)
      .join("@") || "canonical_32";
  const workflowRegistrySchemaLabel =
    [
      String(workflowRegistryMetadata.schema_ref || "").trim(),
      String(workflowRegistryMetadata.schema_version || "").trim()
    ]
      .filter(Boolean)
      .join("@") || "canonical_38";

  return {
    mode: "validate_only",
    outcome,
    review,
    task_routes_schema: taskRoutesSchemaLabel,
    workflow_registry_schema: workflowRegistrySchemaLabel,
    found_task_keys: [...foundTaskKeys],
    found_workflow_ids: [...foundWorkflowIds],
    executable_task_keys: [...executableTaskKeys],
    executable_workflow_ids: [...executableWorkflowIds],
    missing_task_keys: missingTaskKeys,
    missing_workflow_ids: missingWorkflowIds,
    unresolved_task_authority: unresolvedTaskAuthority,
    unresolved_workflow_authority: unresolvedWorkflowAuthority,
    chain_review_required: chainReviewRequired,
    graph_review_required: graphReviewRequired,
    bindings_review_required: bindingsReviewRequired,
    reconciliation_required: reconciliationRequired,
    policy_review_required: policyReviewRequired,
    starter_review_required: starterReviewRequired,
    repair_mapping_required: repairMappingRequired,
    task_routes_ready: REQUIRED_SITE_MIGRATION_TASK_KEYS.every(v => executableTaskKeys.has(v)),
    workflow_registry_ready: REQUIRED_SITE_MIGRATION_WORKFLOW_IDS.every(v => executableWorkflowIds.has(v))
  };
}

async function loadSiteRuntimeInventoryRegistry(sheets) {
  const values = await fetchRange(
    sheets,
    `'${SITE_RUNTIME_INVENTORY_REGISTRY_SHEET}'!A1:Z2000`
  );
  if (!values.length) throw registryError("Site Runtime Inventory Registry");
  const headers = values[0];
  const map = headerMap(headers, SITE_RUNTIME_INVENTORY_REGISTRY_SHEET);
  for (const col of SITE_RUNTIME_INVENTORY_REGISTRY_COLUMNS) {
    if (!Object.prototype.hasOwnProperty.call(map, col)) {
      const err = new Error(
        `${SITE_RUNTIME_INVENTORY_REGISTRY_SHEET} missing required column: ${col}`
      );
      err.code = "registry_schema_mismatch";
      err.status = 500;
      throw err;
    }
  }

  return values.slice(1).map(row => ({
    target_key: getCell(row, map, "target_key"),
    brand_name: getCell(row, map, "brand_name"),
    brand_domain: getCell(row, map, "brand_domain"),
    base_url: getCell(row, map, "base_url"),
    site_type: getCell(row, map, "site_type"),
    supported_cpts: getCell(row, map, "supported_cpts"),
    supported_taxonomies: getCell(row, map, "supported_taxonomies"),
    generated_endpoint_support: getCell(row, map, "generated_endpoint_support"),
    runtime_validation_status: getCell(row, map, "runtime_validation_status"),
    last_runtime_validated_at: getCell(row, map, "last_runtime_validated_at"),
    active_status: getCell(row, map, "active_status")
  })).filter(r => r.target_key || r.brand_domain || r.base_url);
}

async function loadSiteSettingsInventoryRegistry(sheets) {
  const values = await fetchRange(
    sheets,
    `'${SITE_SETTINGS_INVENTORY_REGISTRY_SHEET}'!A1:Z2000`
  );
  if (!values.length) throw registryError("Site Settings Inventory Registry");
  const headers = values[0];
  const map = headerMap(headers, SITE_SETTINGS_INVENTORY_REGISTRY_SHEET);
  for (const col of SITE_SETTINGS_INVENTORY_REGISTRY_COLUMNS) {
    if (!Object.prototype.hasOwnProperty.call(map, col)) {
      const err = new Error(
        `${SITE_SETTINGS_INVENTORY_REGISTRY_SHEET} missing required column: ${col}`
      );
      err.code = "registry_schema_mismatch";
      err.status = 500;
      throw err;
    }
  }

  return values.slice(1).map(row => ({
    target_key: getCell(row, map, "target_key"),
    brand_name: getCell(row, map, "brand_name"),
    brand_domain: getCell(row, map, "brand_domain"),
    base_url: getCell(row, map, "base_url"),
    site_type: getCell(row, map, "site_type"),
    permalink_structure: getCell(row, map, "permalink_structure"),
    timezone_string: getCell(row, map, "timezone_string"),
    site_language: getCell(row, map, "site_language"),
    active_theme: getCell(row, map, "active_theme"),
    settings_validation_status: getCell(row, map, "settings_validation_status"),
    last_settings_validated_at: getCell(row, map, "last_settings_validated_at"),
    active_status: getCell(row, map, "active_status")
  })).filter(r => r.target_key || r.brand_domain || r.base_url);
}

async function loadPluginInventoryRegistry(sheets) {
  const values = await fetchRange(
    sheets,
    `'${PLUGIN_INVENTORY_REGISTRY_SHEET}'!A1:Z2000`
  );
  if (!values.length) throw registryError("Plugin Inventory Registry");
  const headers = values[0];
  const map = headerMap(headers, PLUGIN_INVENTORY_REGISTRY_SHEET);
  for (const col of PLUGIN_INVENTORY_REGISTRY_COLUMNS) {
    if (!Object.prototype.hasOwnProperty.call(map, col)) {
      const err = new Error(
        `${PLUGIN_INVENTORY_REGISTRY_SHEET} missing required column: ${col}`
      );
      err.code = "registry_schema_mismatch";
      err.status = 500;
      throw err;
    }
  }

  return values.slice(1).map(row => ({
    target_key: getCell(row, map, "target_key"),
    brand_name: getCell(row, map, "brand_name"),
    brand_domain: getCell(row, map, "brand_domain"),
    base_url: getCell(row, map, "base_url"),
    site_type: getCell(row, map, "site_type"),
    active_plugins: getCell(row, map, "active_plugins"),
    plugin_versions_json: getCell(row, map, "plugin_versions_json"),
    plugin_owned_tables: getCell(row, map, "plugin_owned_tables"),
    plugin_owned_entities: getCell(row, map, "plugin_owned_entities"),
    plugin_validation_status: getCell(row, map, "plugin_validation_status"),
    last_plugin_validated_at: getCell(row, map, "last_plugin_validated_at"),
    active_status: getCell(row, map, "active_status")
  })).filter(r => r.target_key || r.brand_domain || r.base_url);
}

async function loadTaskRoutesRegistry(sheets, options = {}) {
  const includeCandidateInspection = options?.include_candidate_inspection === true;

  const taskShape = await readLiveSheetShape(
    REGISTRY_SPREADSHEET_ID,
    TASK_ROUTES_SHEET,
    toValuesApiRange(TASK_ROUTES_SHEET, "A1:AF2")
  );
  const taskRoutesMetadata = await getCanonicalSurfaceMetadata(
    "surface.task_routes_sheet",
    {
      columns: TASK_ROUTES_CANONICAL_COLUMNS,
      schema_ref: "row_audit_schema:Task Routes",
      schema_version: "v1",
      binding_mode: "gid_based",
      sheet_role: "authority_surface",
      audit_mode: "exact_header_match"
    }
  );
  assertHeaderMatchesSurfaceMetadata({
    sheetName: TASK_ROUTES_SHEET,
    actualHeader: taskShape.header,
    metadata: taskRoutesMetadata,
    fallbackColumns: TASK_ROUTES_CANONICAL_COLUMNS
  });

  const values = await fetchRange(
    sheets,
    toValuesApiRange(TASK_ROUTES_SHEET, "A1:AF2000")
  );
  if (!values.length) throw registryError("Task Routes");
  const headers = (values[0] || []).map(v => String(v || "").trim());
  assertHeaderMatchesSurfaceMetadata({
    sheetName: TASK_ROUTES_SHEET,
    actualHeader: headers,
    metadata: taskRoutesMetadata,
    fallbackColumns: TASK_ROUTES_CANONICAL_COLUMNS
  });
  const map = headerMap(headers, TASK_ROUTES_SHEET);

  const rows = values.slice(1).map(row => {
    const taskKey = getCell(row, map, "Task Key");
    const activeRaw = getCell(row, map, "active");
    const routeActive = String(activeRaw || "").trim().toUpperCase() === "TRUE";
    const additionStatus = normalizeGovernedAdditionState(
      getCell(row, map, "addition_status") ||
      getCell(row, map, "governance_status") ||
      getCell(row, map, "validation_status")
    );

    const routeRecord = {
      task_key: taskKey,
      route_key: taskKey,
      trigger_terms: getCell(row, map, "Trigger Terms"),
      route_modules: getCell(row, map, "Route Modules"),
      execution_layer: getCell(row, map, "Execution Layer"),
      enabled: getCell(row, map, "Enabled"),
      output_focus: getCell(row, map, "Output Focus"),
      notes: getCell(row, map, "Notes"),
      entry_sources: getCell(row, map, "Entry Sources"),
      linked_starter_titles: getCell(row, map, "Linked Starter Titles"),
      active_starter_count: getCell(row, map, "Active Starter Count"),
      route_key_match_status: getCell(row, map, "Route Key Match Status"),
      row_id: getCell(row, map, "row_id"),
      route_id: getCell(row, map, "route_id"),
      active: activeRaw,
      intent_key: getCell(row, map, "intent_key"),
      brand_scope: getCell(row, map, "brand_scope"),
      request_type: getCell(row, map, "request_type"),
      route_mode: getCell(row, map, "route_mode"),
      target_module: getCell(row, map, "target_module"),
      workflow_key: getCell(row, map, "workflow_key"),
      lifecycle_mode: getCell(row, map, "lifecycle_mode"),
      memory_required: getCell(row, map, "memory_required"),
      logging_required: getCell(row, map, "logging_required"),
      review_required: getCell(row, map, "review_required"),
      priority: getCell(row, map, "priority"),
      allowed_states: getCell(row, map, "allowed_states"),
      degraded_action: getCell(row, map, "degraded_action"),
      blocked_action: getCell(row, map, "blocked_action"),
      match_rule: getCell(row, map, "match_rule"),
      route_source: getCell(row, map, "route_source"),
      last_validated_at: getCell(row, map, "last_validated_at"),

      addition_status: additionStatus,
      governance_status: getCell(row, map, "governance_status"),
      validation_status: getCell(row, map, "validation_status"),
      overlap_group: getCell(row, map, "overlap_group"),
      integration_mode: getCell(row, map, "integration_mode"),
      chain_candidate: getCell(row, map, "chain_candidate"),
      graph_update_required: getCell(row, map, "graph_update_required"),
      bindings_update_required: getCell(row, map, "bindings_update_required"),
      policy_update_required: getCell(row, map, "policy_update_required"),
      starter_update_required: getCell(row, map, "starter_update_required"),
      reconciliation_required: getCell(row, map, "reconciliation_required")
    };

    const deferredActivationRequired = hasDeferredGovernedActivationDependencies(
      routeRecord,
      [
        "chain_candidate",
        "graph_update_required",
        "bindings_update_required",
        "policy_update_required",
        "starter_update_required",
        "reconciliation_required"
      ]
    );

    const executableAuthority =
      routeActive &&
      !governedAdditionStateBlocksAuthority(routeRecord.addition_status) &&
      !deferredActivationRequired;

    return {
      ...routeRecord,
      executable_authority: executableAuthority
    };
  }).filter(row =>
    String(row.task_key || "").trim() ||
    String(row.route_id || "").trim() ||
    String(row.workflow_key || "").trim()
  );

  assertSingleActiveRowByKey(rows, "route_id", "active", TASK_ROUTES_SHEET);
  assertSingleActiveRowByKey(rows, "task_key", "active", TASK_ROUTES_SHEET);

  // Execution Chains and graph surfaces can inform validation only; they do not promote authority.
  return includeCandidateInspection ? rows : rows.filter(row => row.executable_authority);
}

async function loadWorkflowRegistry(sheets, options = {}) {
  const includeCandidateInspection = options?.include_candidate_inspection === true;

  const workflowShape = await readLiveSheetShape(
    REGISTRY_SPREADSHEET_ID,
    WORKFLOW_REGISTRY_SHEET,
    toValuesApiRange(WORKFLOW_REGISTRY_SHEET, "A1:AL2")
  );
  const workflowRegistryMetadata = await getCanonicalSurfaceMetadata(
    "surface.workflow_registry_sheet",
    {
      columns: WORKFLOW_REGISTRY_CANONICAL_COLUMNS,
      schema_ref: "row_audit_schema:Workflow Registry",
      schema_version: "v1",
      binding_mode: "gid_based",
      sheet_role: "authority_surface",
      audit_mode: "exact_header_match"
    }
  );
  assertHeaderMatchesSurfaceMetadata({
    sheetName: WORKFLOW_REGISTRY_SHEET,
    actualHeader: workflowShape.header,
    metadata: workflowRegistryMetadata,
    fallbackColumns: WORKFLOW_REGISTRY_CANONICAL_COLUMNS
  });

  const values = await fetchRange(
    sheets,
    toValuesApiRange(WORKFLOW_REGISTRY_SHEET, "A1:AL2000")
  );
  if (!values.length) throw registryError("Workflow Registry");
  const headers = (values[0] || []).map(v => String(v || "").trim());
  assertHeaderMatchesSurfaceMetadata({
    sheetName: WORKFLOW_REGISTRY_SHEET,
    actualHeader: headers,
    metadata: workflowRegistryMetadata,
    fallbackColumns: WORKFLOW_REGISTRY_CANONICAL_COLUMNS
  });
  const map = headerMap(headers, WORKFLOW_REGISTRY_SHEET);

  const rows = values.slice(1).map(row => {
    const activeRaw = getCell(row, map, "active");
    const workflowActive = String(activeRaw || "").trim().toUpperCase() === "TRUE";
    const additionStatus = normalizeGovernedAdditionState(
      getCell(row, map, "addition_status") ||
      getCell(row, map, "governance_status") ||
      getCell(row, map, "validation_status")
    );

    const workflowRecord = {
      workflow_id: getCell(row, map, "Workflow ID"),
      workflow_name: getCell(row, map, "Workflow Name"),
      module_mode: getCell(row, map, "Module Mode"),
      trigger_source: getCell(row, map, "Trigger Source"),
      input_type: getCell(row, map, "Input Type"),
      primary_objective: getCell(row, map, "Primary Objective"),
      mapped_engines: getCell(row, map, "Mapped Engine(s)"),
      engine_order: getCell(row, map, "Engine Order"),
      workflow_type: getCell(row, map, "Workflow Type"),
      primary_output: getCell(row, map, "Primary Output"),
      input_detection_rules: getCell(row, map, "Input Detection Rules"),
      output_template: getCell(row, map, "Output Template"),
      priority: getCell(row, map, "Priority"),
      route_key: getCell(row, map, "Route Key"),
      execution_mode: getCell(row, map, "Execution Mode"),
      user_facing: getCell(row, map, "User Facing"),
      parent_layer: getCell(row, map, "Parent Layer"),
      status: getCell(row, map, "Status"),
      linked_workflows: getCell(row, map, "Linked Workflows"),
      linked_engines: getCell(row, map, "Linked Engines"),
      notes: getCell(row, map, "Notes"),
      entry_priority_weight: getCell(row, map, "Entry Priority Weight"),
      dependency_type: getCell(row, map, "Dependency Type"),
      output_artifact_type: getCell(row, map, "Output Artifact Type"),
      workflow_key: getCell(row, map, "workflow_key"),
      active: activeRaw,
      target_module: getCell(row, map, "target_module"),
      execution_class: getCell(row, map, "execution_class"),
      lifecycle_mode: getCell(row, map, "lifecycle_mode"),
      route_compatibility: getCell(row, map, "route_compatibility"),
      memory_required: getCell(row, map, "memory_required"),
      logging_required: getCell(row, map, "logging_required"),
      review_required: getCell(row, map, "review_required"),
      allowed_states: getCell(row, map, "allowed_states"),
      degraded_action: getCell(row, map, "degraded_action"),
      blocked_action: getCell(row, map, "blocked_action"),
      registry_source: getCell(row, map, "registry_source"),
      last_validated_at: getCell(row, map, "last_validated_at"),

      addition_status: additionStatus,
      governance_status: getCell(row, map, "governance_status"),
      validation_status: getCell(row, map, "validation_status"),
      workflow_family: getCell(row, map, "workflow_family"),
      overlap_group: getCell(row, map, "overlap_group"),
      execution_path_role: getCell(row, map, "execution_path_role"),
      chain_eligible: getCell(row, map, "chain_eligible"),
      graph_update_required: getCell(row, map, "graph_update_required"),
      bindings_update_required: getCell(row, map, "bindings_update_required"),
      repair_mapping_required: getCell(row, map, "repair_mapping_required"),
      policy_dependency_required: getCell(row, map, "policy_dependency_required"),
      policy_update_required: getCell(row, map, "policy_update_required"),
      starter_update_required: getCell(row, map, "starter_update_required"),
      reconciliation_required: getCell(row, map, "reconciliation_required")
    };

    const deferredActivationRequired = hasDeferredGovernedActivationDependencies(
      workflowRecord,
      [
        "chain_eligible",
        "graph_update_required",
        "bindings_update_required",
        "repair_mapping_required",
        "policy_dependency_required",
        "policy_update_required",
        "starter_update_required",
        "reconciliation_required"
      ]
    );

    const executableAuthority =
      workflowActive &&
      !governedAdditionStateBlocksAuthority(workflowRecord.addition_status) &&
      !deferredActivationRequired;

    return {
      ...workflowRecord,
      executable_authority: executableAuthority
    };
  }).filter(row =>
    String(row.workflow_id || "").trim() ||
    String(row.workflow_key || "").trim()
  );

  assertSingleActiveRowByKey(rows, "workflow_id", "active", WORKFLOW_REGISTRY_SHEET);
  assertSingleActiveRowByKey(rows, "workflow_key", "active", WORKFLOW_REGISTRY_SHEET);

  // Execution chains/graphs are support signals; they do not activate workflow authority.
  return includeCandidateInspection ? rows : rows.filter(row => row.executable_authority);
}

const WORDPRESS_MUTATION_PUBLISH_STATUSES = new Set([
  "draft",
  "publish",
  "pending",
  "private",
  "future"
]);

async function readGovernedSheetRecords(sheetName, spreadsheetId = REGISTRY_SPREADSHEET_ID) {
  const trimmedSheetName = String(sheetName || "").trim();
  const trimmedSpreadsheetId = String(spreadsheetId || "").trim();
  if (!trimmedSheetName) {
    throw createHttpError("missing_sheet_name", "Sheet name is required.", 500);
  }
  if (!trimmedSpreadsheetId) {
    throw createHttpError("missing_spreadsheet_id", "Spreadsheet id is required.", 500);
  }

  await assertSheetExistsInSpreadsheet(trimmedSpreadsheetId, trimmedSheetName);
  const { sheets } = await getGoogleClientsForSpreadsheet(trimmedSpreadsheetId);
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: trimmedSpreadsheetId,
    range: toValuesApiRange(trimmedSheetName, "A:AZ")
  });

  const values = response.data.values || [];
  if (!values.length) {
    return { header: [], rows: [], map: {} };
  }

  const header = (values[0] || []).map(v => String(v || "").trim());
  const map = headerMap(header, trimmedSheetName);
  const rows = values.slice(1).map(row => {
    const record = {};
    header.forEach((key, idx2) => {
      if (!key) return;
      record[key] = row[idx2] ?? "";
    });
    return record;
  });

  return { header, rows, map };
}

function normalizeLooseHostname(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  return raw.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
}

function findRegistryRecordByIdentity(rows = [], identity = {}) {
  const targetKey = String(identity.target_key || "").trim().toLowerCase();
  const domain = normalizeLooseHostname(identity.domain || identity.brand_domain || "");
  const brand = String(identity.brand || identity.target_key || "").trim().toLowerCase();

  const targetCandidates = [
    "target_key",
    "brand_key",
    "site_key",
    "website_key",
    "brand_name",
    "company_name"
  ];
  const domainCandidates = [
    "brand_domain",
    "domain",
    "site_domain",
    "base_url",
    "brand.base_url",
    "website_url"
  ];

  const exactTarget = rows.find(row =>
    targetCandidates.some(key => String(row?.[key] || "").trim().toLowerCase() === targetKey) ||
    targetCandidates.some(key => String(row?.[key] || "").trim().toLowerCase() === brand)
  );
  if (exactTarget) return exactTarget;

  if (domain) {
    const exactDomain = rows.find(row =>
      domainCandidates.some(key =>
        normalizeLooseHostname(row?.[key] || "") === domain
      )
    );
    if (exactDomain) return exactDomain;
  }

  return null;
}

async function resolveBrandRegistryBinding(identity = {}) {
  const registry = await readGovernedSheetRecords(BRAND_REGISTRY_SHEET);
  const row = findRegistryRecordByIdentity(registry.rows, identity);

  if (!row) {
    throw createHttpError(
      "brand_registry_binding_not_found",
      `Brand Registry binding not found for ${identity.target_key || identity.domain || "unknown site"}.`,
      409
    );
  }

  return {
    row,
    target_key:
      firstPopulated(row, ["target_key", "brand_key", "site_key"]) ||
      String(identity.target_key || "").trim(),
    brand_name:
      firstPopulated(row, ["brand_name", "company_name", "target_key"]) ||
      String(identity.brand || identity.target_key || "").trim(),
    base_url: firstPopulated(row, ["brand.base_url", "base_url", "website_url", "domain", "brand_domain"]),
    brand_domain: normalizeLooseHostname(
      firstPopulated(row, ["brand_domain", "domain", "website_url", "base_url"])
    ),
    hosting_account_key:
      firstPopulated(row, [
        "hosting_account_key",
        "hosting_account_registry_ref",
        "account_key",
        "hosting_key"
      ]) || "",
    hostinger_api_target_key:
      firstPopulated(row, [
        "hostinger_api_target_key",
        "hosting_account_key",
        "hosting_account_registry_ref"
      ]) || "",
    row_data: row
  };
}

async function hostingerSshRuntimeRead({ input = {} }) {
  const { sheets } = await getGoogleClientsForSpreadsheet(REGISTRY_SPREADSHEET_ID);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: String(REGISTRY_SPREADSHEET_ID || "").trim(),
    range: HOSTING_ACCOUNT_REGISTRY_RANGE
  });

  const values = response.data.values || [];
  if (values.length < 2) {
    const err = new Error("Hosting Account Registry is empty or missing data rows.");
    err.code = "hosting_account_registry_empty";
    err.status = 500;
    throw err;
  }

  const [header, ...rows] = values;
  const rowObjs = rows.map(row => rowToObject(header, row));
  const match = rowObjs.find(rowObj => matchesHostingerSshTarget(rowObj, input));

  if (!match) {
    return {
      ok: false,
      endpoint_key: "hostinger_ssh_runtime_read",
      resolution_status: "blocked",
      reason: "no_matching_hosting_account_registry_row",
      authoritative_source: HOSTING_ACCOUNT_REGISTRY_SHEET,
      input
    };
  }

  return {
    ok: true,
    endpoint_key: "hostinger_ssh_runtime_read",
    resolution_status: "validated",
    authoritative_source: HOSTING_ACCOUNT_REGISTRY_SHEET,
    hosting_account_key: match.hosting_account_key || "",
    hosting_provider: match.hosting_provider || "",
    account_identifier: match.account_identifier || "",
    resolver_target_keys_json: match.resolver_target_keys_json || "[]",
    brand_sites_json: match.brand_sites_json || "[]",
    ssh_available: asBool(match.ssh_available),
    wp_cli_available: asBool(match.wp_cli_available),
    shared_access_enabled: asBool(match.shared_access_enabled),
    account_mode: match.account_mode || "",
    ssh_host: match.ssh_host || "",
    ssh_port: match.ssh_port || "22",
    ssh_username: match.ssh_username || "",
    ssh_auth_mode: match.ssh_auth_mode || "",
    ssh_credential_reference: match.ssh_credential_reference || "",
    ssh_runtime_notes: match.ssh_runtime_notes || "",
    auth_validation_status: match.auth_validation_status || "",
    endpoint_binding_status: match.endpoint_binding_status || "",
    resolver_execution_ready: asBool(match.resolver_execution_ready),
    last_runtime_check_at: match.last_runtime_check_at || ""
  };
}

const WORDPRESS_CORE_POST_TYPE_COLLECTION_ALIASES = Object.freeze({
  post: "posts",
  posts: "posts",
  page: "pages",
  pages: "pages",
  attachment: "media",
  media: "media"
});

const WORDPRESS_PHASE_A_ALLOWED_TYPES = new Set([
  "post",
  "page",
  "category",
  "tag"
]);

const WORDPRESS_PHASE_A_BLOCKED_TYPES = new Set([
  "attachment",
  "elementor_library",
  "wp_template",
  "wp_template_part",
  "wp_navigation",
  "popup",
  "global_widget",
  "acf-field-group",
  "acf-field",
  "wpforms",
  "fluentform",
  "contact-form-7",
  "seedprod",
  "mailpoet_page"
]);

function toPositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function sleep(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function chunkArray(items = [], size = 20) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function verifyWordpressRolledBackEntry(args = {}) {
  const readback = await getWordpressItemById({
    siteRef: args.destinationSiteRef,
    collectionSlug: String(args.collectionSlug || "").trim(),
    id: args.destinationId,
    authRequired: true
  });

  const actualStatus = String(readback?.status || "").trim().toLowerCase();
  return {
    verified: actualStatus === "draft",
    actual_status: actualStatus || "",
    readback
  };
}

function nowIsoSafe() {
  try {
    return new Date().toISOString();
  } catch {
    return "";
  }
}

const WORDPRESS_PHASE_B_BUILDER_TYPES = new Set([
  "elementor_library",
  "wp_template",
  "wp_template_part",
  "wp_navigation",
  "popup",
  "global_widget",
  "reusable_block",
  "wp_block"
]);

async function runWordpressBuilderAssetsInventoryAudit(args = {}) {
  const {
    payload = {},
    wpContext = {},
    phaseBPlan = {},
    phaseBGate = {}
  } = args;

  if (phaseBGate.phase_b_gate_ready !== true) {
    return {
      phase_b_inventory_status: "blocked",
      audit_rows: [],
      inventory_counts: [],
      failures: [
        {
          code: "phase_b_builder_audit_blocked",
          message: "Phase B builder audit blocked by phase_b_gate.",
          blocking_reasons: phaseBGate.blocking_reasons || []
        }
      ]
    };
  }

  const auditRows = [];
  const inventoryCounts = [];
  const failures = [];

  for (const postType of phaseBPlan.post_types || []) {
    try {
      const itemsRaw = await listWordpressEntriesByType({
        siteRef: wpContext.source,
        postType,
        authRequired: false
      });

      const items = itemsRaw.slice(0, phaseBPlan.max_items_per_type);
      const keptItems = phaseBPlan.include_inactive
        ? items
        : items.filter(item => {
            const status = String(item?.status || "").trim().toLowerCase();
            return !status || status === "publish" || status === "draft";
          });

      for (const item of keptItems) {
        auditRows.push(
          buildWordpressBuilderAuditRow({
            postType,
            item,
            payload
          })
        );
      }

      inventoryCounts.push({
        post_type: postType,
        discovered_count: itemsRaw.length,
        retained_count: keptItems.length,
        audit_only: phaseBPlan.audit_only === true
      });
    } catch (err) {
      failures.push({
        post_type: postType,
        code: err?.code || "wordpress_builder_inventory_failed",
        message: err?.message || "WordPress builder inventory audit failed."
      });
    }
  }

  return {
    phase_b_inventory_status:
      failures.length === 0 ? "completed" : "completed_with_failures",
    audit_rows: auditRows,
    inventory_counts: inventoryCounts,
    failures
  };
}

const WORDPRESS_PHASE_D_FORM_TYPES = new Set([
  "wpcf7_contact_form",
  "wpforms",
  "fluentform",
  "gf_form",
  "elementor_form",
  "formidable_form"
]);

function normalizeWordpressFormIntegrationSignals(signals = {}) {
  const safeSignals =
    signals && typeof signals === "object" && !Array.isArray(signals)
      ? signals
      : {};

  return {
    has_email_routing: safeSignals.has_email_routing === true,
    has_webhook: safeSignals.has_webhook === true,
    has_recaptcha: safeSignals.has_recaptcha === true,
    has_smtp_dependency: safeSignals.has_smtp_dependency === true,
    has_crm_integration: safeSignals.has_crm_integration === true,
    has_payment_integration: safeSignals.has_payment_integration === true,
    has_file_upload: safeSignals.has_file_upload === true,
    has_conditional_logic: safeSignals.has_conditional_logic === true
  };
}

const siteMigrationTransports = {
  wordpress_connector: runWordpressConnectorMigration,
  ssh_wpcli: runSshWpCliMigration,
  hybrid_wordpress: runHybridWordpressMigration
};


function createSiteMigrationJobRecord({ payload, requestedBy, executionTraceId, maxAttempts, webhookUrl, callbackSecret, idempotencyKey }) {
  const createdAt = nowIso();
  return {
    job_id: buildJobId(),
    job_type: "site_migration",
    status: "queued",
    created_at: createdAt,
    updated_at: createdAt,
    completed_at: "",
    requested_by: requestedBy,
    target_key: String(payload?.destination?.target_key || payload?.source?.target_key || "").trim(),
    parent_action_key: "site_migration_controller",
    endpoint_key: "site_migrate",
    route_id: "site_migration",
    target_module: "wordpress_site_migration",
    target_workflow: "wf_wordpress_site_migration",
    brand_name: String(payload?.destination?.brand || payload?.source?.brand || "").trim(),
    execution_trace_id: executionTraceId,
    request_payload: payload,
    attempt_count: 0,
    max_attempts: normalizeMaxAttempts(maxAttempts),
    result_payload: null,
    error_payload: null,
    next_retry_at: "",
    webhook_url: normalizeWebhookUrl(webhookUrl),
    callback_secret: String(callbackSecret || "").trim(),
    idempotency_key: String(idempotencyKey || "").trim()
  };
}

async function executeQueuedJobByType(job) {
  const jobType = String(job?.job_type || "http_execute").trim();
  if (jobType === "site_migration") {
    return await executeSiteMigrationJob(job);
  }
  return await executeJobThroughHttpEndpoint(job);
}

function getJob(jobId) {
  const id = normalizeJobId(jobId);
  return id ? jobRepository.get(id) : null;
}

function updateJob(job, patch = {}) {
  Object.assign(job, patch);
  job.updated_at = nowIso();
  jobRepository.set(job);
  return job;
}

function toJobSummary(job) {
  return {
    job_id: job.job_id,
    job_type: job.job_type,
    status: job.status,
    created_at: job.created_at,
    updated_at: job.updated_at,
    requested_by: job.requested_by,
    target_key: job.target_key,
    parent_action_key: job.parent_action_key,
    endpoint_key: job.endpoint_key,
    route_id: job.route_id || "",
    target_module: job.target_module || "",
    target_workflow: job.target_workflow || "",
    brand_name: job.brand_name || "",
    execution_trace_id: job.execution_trace_id || "",
    attempt_count: job.attempt_count,
    max_attempts: job.max_attempts,
    next_retry_at: job.next_retry_at || null,
    status_url: `/jobs/${job.job_id}`,
    result_url: `/jobs/${job.job_id}/result`
  };
}

function buildWebhookPayload(job) {
  return {
    job_id: job.job_id,
    execution_trace_id: job.execution_trace_id || "",
    status: job.status,
    attempt_count: job.attempt_count,
    max_attempts: job.max_attempts,
    created_at: job.created_at,
    updated_at: job.updated_at,
    completed_at: job.completed_at || null,
    result: job.result_payload || null,
    error: job.error_payload || null
  };
}

async function sendJobWebhook(job) {
  const webhookUrl = normalizeWebhookUrl(job.webhook_url || "");
  if (!webhookUrl) return;

  const payloadObj = buildWebhookPayload(job);
  const payload = JSON.stringify(payloadObj);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const secret = String(job.callback_secret || "").trim();
  const signature = secret
    ? crypto.createHmac("sha256", secret)
        .update(`${timestamp}.${payload}`)
        .digest("hex")
    : "";

  const headers = {
    "Content-Type": "application/json",
    "X-Job-Id": job.job_id,
    "X-Job-Status": job.status,
    "X-Job-Timestamp": timestamp
  };
  if (signature) headers["X-Signature"] = signature;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JOB_WEBHOOK_TIMEOUT_MS);

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: payload,
      signal: controller.signal
    });

    if (!response.ok) {
      debugLog("JOB_WEBHOOK_FAILED:", {
        job_id: job.job_id,
        webhook_url: webhookUrl,
        status: response.status
      });
      return;
    }

    debugLog("JOB_WEBHOOK_SENT:", {
      job_id: job.job_id,
      webhook_url: webhookUrl,
      status: response.status
    });
  } catch (err) {
    debugLog("JOB_WEBHOOK_FAILED:", {
      job_id: job.job_id,
      webhook_url: webhookUrl,
      message: err?.message || String(err)
    });
  } finally {
    clearTimeout(timer);
  }
}

function shouldRetryJobFailure(statusCode, payload) {
  const code = String(payload?.error?.code || "").trim().toLowerCase();

  if (statusCode === 429) return true;
  if (statusCode >= 500) return true;
  if (code.includes("timeout")) return true;
  if (code === "worker_transport_error") return true;
  return false;
}

async function executeSameServiceNativeEndpoint({
  method,
  path: relativePath,
  body,
  timeoutSeconds,
  expectJson = true
}) {
  const headers = {
    "Content-Type": "application/json"
  };

  if (process.env.BACKEND_API_KEY) {
    headers.Authorization = `Bearer ${process.env.BACKEND_API_KEY}`;
  }

  const boundedTimeoutSeconds = Math.min(
    Number(timeoutSeconds || MAX_TIMEOUT_SECONDS),
    MAX_TIMEOUT_SECONDS
  );

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    (Number.isFinite(boundedTimeoutSeconds) && boundedTimeoutSeconds > 0
      ? boundedTimeoutSeconds
      : MAX_TIMEOUT_SECONDS) * 1000 + 5000
  );

  try {
    const response = await fetch(`http://127.0.0.1:${port}${relativePath}`, {
      method,
      headers,
      body:
        method === "GET" || method === "DELETE"
          ? undefined
          : JSON.stringify(body ?? {}),
      signal: controller.signal
    });

    const raw = await response.text();
    let parsed;

    if (!raw) {
      parsed = {};
    } else if (expectJson !== false) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = {
          ok: false,
          error: {
            code: "upstream_unparseable_response",
            message: raw
          }
        };
      }
    } else {
      parsed = { ok: response.ok, raw };
    }

    return {
      success: response.ok && (parsed?.ok !== false),
      statusCode: response.status,
      payload: parsed
    };
  } catch (err) {
    const aborted = err?.name === "AbortError";
    return {
      success: false,
      statusCode: aborted ? 504 : 502,
      payload: {
        ok: false,
        error: {
          code: aborted ? "worker_timeout" : "worker_transport_error",
          message: err?.message || String(err)
        }
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

async function dispatchEndpointKeyExecution({ endpoint_key, requestPayload }) {
  switch (String(endpoint_key || "").trim()) {
    case "hostinger_ssh_runtime_read": {
      return await hostingerSshRuntimeRead({
        input: requestPayload || {}
      });
    }
    case "github_git_blob_chunk_read": {
      return await githubGitBlobChunkRead({
        input: requestPayload || {}
      });
    }
    default:
      return null;
  }
}

function inferLocalDispatchHttpStatus(result = {}) {
  const explicit = Number(result?.statusCode);
  if (Number.isInteger(explicit) && explicit >= 100 && explicit <= 599) {
    return explicit;
  }

  const code = String(result?.error?.code || "").trim().toLowerCase();
  if (code === "range_not_satisfiable") return 416;
  if (code === "github_blob_not_found") return 404;
  if (code === "missing_github_token") return 500;
  if (code === "github_blob_fetch_failed") return 502;
  if (code === "github_blob_encoding_unsupported") return 502;

  return result?.ok ? 200 : 400;
}

async function executeJobThroughHttpEndpoint(job) {
  const headers = {
    "Content-Type": "application/json"
  };
  if (process.env.BACKEND_API_KEY) {
    headers.Authorization = `Bearer ${process.env.BACKEND_API_KEY}`;
  }

  const timeoutSeconds = Math.min(
    Number(job.request_payload?.timeout_seconds || 300),
    MAX_TIMEOUT_SECONDS
  );
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    (Number.isFinite(timeoutSeconds) && timeoutSeconds > 0 ? timeoutSeconds : 300) * 1000 + 5000
  );

  try {
    const response = await fetch(`http://127.0.0.1:${port}/http-execute`, {
      method: "POST",
      headers,
      body: JSON.stringify(job.request_payload || {}),
      signal: controller.signal
    });

    const raw = await response.text();
    let parsed = {};
    if (raw) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = {
          ok: false,
          error: {
            code: "upstream_unparseable_response",
            message: raw
          }
        };
      }
    }

    const success = response.ok && parsed?.ok === true;
    return {
      success,
      statusCode: response.status,
      payload: parsed
    };
  } catch (err) {
    const aborted = err?.name === "AbortError";
    return {
      success: false,
      statusCode: aborted ? 504 : 502,
      payload: {
        ok: false,
        error: {
          code: aborted ? "worker_timeout" : "worker_transport_error",
          message: err?.message || String(err)
        }
      }
    };
  } finally {
    clearTimeout(timer);
  }
}

function enqueueJob(jobId) {
  const job = jobRepository.get(jobId);
  if (!job) return;
  jobQueue.add("execute", job, { jobId: job.job_id, attempts: 1 })
    .catch(err => console.error("ENQUEUE_FAILED:", { job_id: jobId, err: err?.message }));
}

function scheduleJobRetry(job, delayMs) {
  updateJob(job, {
    status: "retrying",
    next_retry_at: new Date(Date.now() + delayMs).toISOString()
  });

  debugLog("JOB_RETRY_SCHEDULED:", {
    job_id: job.job_id,
    delay_ms: delayMs,
    attempt_count: job.attempt_count,
    next_retry_at: job.next_retry_at
  });

  // Use BullMQ delayed job instead of setTimeout — survives restarts.
  const retryData = { ...job, status: "queued", next_retry_at: "" };
  jobQueue.add("execute", retryData, { delay: delayMs, attempts: 1 })
    .catch(err => console.error("RETRY_ENQUEUE_FAILED:", { job_id: job.job_id, err: err?.message }));
}

async function executeSingleQueuedJob(job) {
  if (normalizeJobStatus(job.status) !== "queued") return;
  const queuedExecutionStartedAt = nowIso();
  const execution_trace_id =
    String(job.execution_trace_id || "").trim() || createExecutionTraceId();

  updateJob(job, {
    execution_trace_id,
    status: "running",
    attempt_count: Number(job.attempt_count || 0) + 1,
    next_retry_at: ""
  });

  debugLog("JOB_EXECUTION_STARTED:", {
    job_id: job.job_id,
    attempt_count: job.attempt_count,
    parent_action_key: job.parent_action_key,
    endpoint_key: job.endpoint_key
  });

  const outcome = await executeQueuedJobByType(job);
  const success = outcome.success === true;

  if (success) {
    updateJob(job, {
      status: "succeeded",
      result_payload: outcome.payload || null,
      error_payload: null,
      completed_at: nowIso()
    });

    await performUniversalServerWriteback({
      mode: "async",
      job_id: job.job_id,
      target_key: job.target_key,
      parent_action_key: job.parent_action_key,
      endpoint_key: job.endpoint_key,
      route_id: job.route_id,
      target_module: job.target_module,
      target_workflow: job.target_workflow,
      source_layer: "http_client_backend",
      entry_type: "async_job",
      execution_class: "async",
      attempt_count: job.attempt_count,
      status_source: job.status,
      responseBody: job.result_payload,
      error_code: job.result_payload?.error?.code,
      error_message_short: job.result_payload?.error?.message,
      http_status: outcome.statusCode,
      brand_name: job.brand_name,
      execution_trace_id,
      started_at: queuedExecutionStartedAt
    });

    await sendJobWebhook(job);
    return;
  }

  updateJob(job, {
    result_payload: null,
    error_payload: outcome.payload || {
      ok: false,
      error: {
        code: "job_execution_failed",
        message: "Background execution failed."
      }
    }
  });

  const retryable = shouldRetryJobFailure(outcome.statusCode, job.error_payload);
  const canRetry = retryable && Number(job.attempt_count || 0) < Number(job.max_attempts || 1);

  if (canRetry) {
    await logRetryWriteback({
      job_id: job.job_id,
      target_key: job.target_key,
      parent_action_key: job.parent_action_key,
      endpoint_key: job.endpoint_key,
      route_id: job.route_id,
      target_module: job.target_module,
      target_workflow: job.target_workflow,
      attempt_count: job.attempt_count,
      responseBody: job.error_payload,
      error_code: job.error_payload?.error?.code,
      error_message_short: job.error_payload?.error?.message,
      http_status: outcome.statusCode,
      brand_name: job.brand_name,
      execution_trace_id,
      started_at: queuedExecutionStartedAt
    });
    scheduleJobRetry(job, nextRetryDelayMs(job.attempt_count));
    return;
  }

  updateJob(job, {
    status: "failed",
    completed_at: nowIso()
  });

  await performUniversalServerWriteback({
    mode: "async",
    job_id: job.job_id,
    target_key: job.target_key,
    parent_action_key: job.parent_action_key,
    endpoint_key: job.endpoint_key,
    route_id: job.route_id,
    target_module: job.target_module,
    target_workflow: job.target_workflow,
    source_layer: "http_client_backend",
    entry_type: "async_job",
    execution_class: "async",
    attempt_count: job.attempt_count,
    status_source: job.status,
    responseBody: job.error_payload,
    error_code: job.error_payload?.error?.code,
    error_message_short: job.error_payload?.error?.message,
    http_status: outcome.statusCode,
    brand_name: job.brand_name,
    execution_trace_id,
    started_at: queuedExecutionStartedAt
  });

  await sendJobWebhook(job);
}


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

  res.json({
    ok: true,
    service: "http_generic_api_connector",
    status: "healthy",
    version: SERVICE_VERSION,
    jobs: {
      total: jobRepository.size(),
      queued_buffer_size: await jobQueue.getWaitingCount(),
      statuses: counts
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

  enqueueJob(job.job_id);

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

  enqueueJob(job.job_id);

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
    const normalizedAssetHomeValidation = validateAssetHomePayloadRules(normalizedPromoted);
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

    const topLevelRoutingValidation = validateTopLevelRoutingFields(requestPayload, policies);
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
    const assetHomeValidation = validateAssetHomePayloadRules(requestPayload);

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

    debugLog("FINAL_EXECUTION_PARENT_ACTION_KEY:", parent_action_key);
    debugLog("FINAL_EXECUTION_ENDPOINT_KEY:", endpoint_key);
    action = resolveAction(actionRows, parent_action_key);
    debugLog("RESOLVED_ACTION_OBJECT:", JSON.stringify(action));
    endpoint = resolveEndpoint(endpointRows, parent_action_key, endpoint_key);

    debugLog(
      "PRE_GUARD_ENDPOINT_OBJECT:",
      JSON.stringify(getEndpointExecutionSnapshot(endpoint))
    );

    brand = resolveBrand(brandRows, requestPayload);

    debugLog(
      "PRE_GUARD_ACTION_RUNTIME:",
      JSON.stringify({
        action_key: action.action_key,
        runtime_capability_class: action.runtime_capability_class,
        runtime_callable: action.runtime_callable,
        primary_executor: action.primary_executor,
        oauth_config_file_id: action.oauth_config_file_id || ""
      })
    );

    requireRuntimeCallableAction(policies, action, endpoint);

    const endpointEligibility =
      requireEndpointExecutionEligibility(policies, endpoint);

    requireExecutionModeCompatibility(action, endpoint);
    requireNativeFamilyBoundary(policies, action, endpoint);
    requireTransportIfDelegated(policies, action, endpoint);
    requireNoFallbackDirectExecution(policies, endpoint);

    debugLog(
      "POST_GUARD_ENDPOINT_ELIGIBILITY:",
      JSON.stringify(endpointEligibility)
    );

    const allowedTransport = String(
      process.env.HTTP_ALLOWED_TRANSPORT ||
      policyValue(
        policies,
        "HTTP Execution Governance",
        "Allowed Transport",
        "http_generic_api"
      )
    ).trim();

    const endpointExecutionMode = String(endpoint.execution_mode || "").trim().toLowerCase();
    const endpointTransportActionKey = String(endpoint.transport_action_key || "").trim();
    const delegatedTransportTarget = isDelegatedTransportTarget(endpoint);
    const sameServiceNativeTarget =
      endpointExecutionMode === "native_controller" ||
      String(endpoint.provider_domain || "").trim() === "same_service_native";

    debugLog(
      "TRANSPORT_COMPATIBILITY_INPUT:",
      JSON.stringify({
        endpoint_key: endpoint.endpoint_key,
        endpoint_transport_action_key: endpointTransportActionKey,
        endpoint_execution_mode: String(endpoint.execution_mode || "").trim(),
        endpoint_transport_required_raw: endpoint.transport_required ?? "",
        endpoint_transport_required: boolFromSheet(endpoint.transport_required),
        delegated_transport_target: delegatedTransportTarget,
        same_service_native_target: sameServiceNativeTarget
      })
    );

    if (
      !sameServiceNativeTarget &&
      endpointTransportActionKey &&
      endpointTransportActionKey !== allowedTransport
    ) {
      const err = new Error(`Endpoint transport_action_key is not supported: ${endpointTransportActionKey}`);
      err.code = "unsupported_transport";
      err.status = 403;
      throw err;
    }

    if (
      !sameServiceNativeTarget &&
      boolFromSheet(endpoint.transport_required) &&
      endpointExecutionMode === "http_delegated" &&
      endpointTransportActionKey !== allowedTransport
    ) {
      const err = new Error(`Delegated transport endpoint is missing required allowed transport: ${endpoint.endpoint_key}`);
      err.code = "missing_required_transport";
      err.status = 403;
      throw err;
    }

    const resolvedMethodPath = ensureMethodAndPathMatchEndpoint(
      endpoint,
      requestPayload.method,
      requestPayload.path,
      pathParams
    );

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
createWorker(async (bullJob) => {
  const job = bullJob.data;
  jobRepository.set(job);
  await executeSingleQueuedJob(job);
});

app.listen(port, () => {
  console.log(`http_generic_api_connector listening on port ${port}`);
});
