import {
  WORDPRESS_MUTATION_PUBLISH_STATUSES,
  WORDPRESS_PHASE_A_ALLOWED_TYPES,
  WORDPRESS_PHASE_A_BLOCKED_TYPES,
  applyDeferredWordpressFeaturedMediaLinks,
  applyDeferredWordpressParentLinks,
  applyDeferredWordpressTaxonomyLinks,
  assertWordpressGovernedResolutionConfidence,
  buildDeferredWordpressReferencePlan,
  buildGovernedResolutionRecord,
  buildSiteMigrationArtifacts,
  classifyWordpressExecutionStage,
  ensureWordpressPhaseAState,
  executeWordpressRestJsonRequest,
  findWordpressDestinationEntryBySlug,
  getWordpressItemById,
  getWordpressSiteAuth,
  listWordpressEntriesByType,
  mapWordpressSourceEntryToMutationPayload,
  normalizeWordpressCollectionSlug,
  normalizeWordpressPhaseAType,
  nowIsoSafe,
  recordWordpressMutationWritebackEvidence,
  resolveWordpressCollectionSlug,
  runWithWordpressSelectiveRetry,
  toPositiveInt,
  updateWordpressDestinationEntryById,
  verifyDeferredWordpressParentRepairs,
  verifyDeferredWordpressTaxonomyRepairs,
  verifyWordpressRolledBackEntry
} from "./shared.js";
// Auto-extracted from server.js — do not edit manually, use domain logic here.
import {
  resolveWordpressPhaseLPlan,
  buildWordpressPhaseLGate,
  runWordpressBackupRecoveryInventory,
  buildWordpressPhaseLNormalizedInventory,
  buildWordpressPhaseLReadinessGate,
  buildWordpressPhaseLSafeCandidates,
  buildWordpressPhaseLReconciliationPayloadPlanner,
  resolveWordpressPhaseLExecutionPlan,
  buildWordpressPhaseLExecutionGuard,
  buildWordpressPhaseLMutationCandidateSelector,
  buildWordpressPhaseLMutationCandidateArtifact,
  buildWordpressPhaseLMutationPayloadComposer,
  buildWordpressPhaseLMutationPayloadArtifact,
  buildWordpressPhaseLDryRunExecutionSimulator,
  buildWordpressPhaseLDryRunExecutionArtifact,
  buildWordpressPhaseLFinalOperatorHandoffBundle
} from "./phaseL.js";
import {
  resolveWordpressPhaseMPlan,
  assertWordpressPhaseMPlan,
  buildWordpressPhaseMGate,
  runWordpressDeploymentReleaseInventory,
  buildWordpressPhaseMNormalizedInventory,
  buildWordpressPhaseMReadinessGate,
  buildWordpressPhaseMMutationCandidateSelector,
  buildWordpressPhaseMMutationCandidateArtifact,
  buildWordpressPhaseMMutationPayloadComposer,
  buildWordpressPhaseMMutationPayloadArtifact,
  buildWordpressPhaseMSafeCandidates,
  buildWordpressPhaseMReconciliationPayloadPlanner,
  resolveWordpressPhaseMExecutionPlan,
  buildWordpressPhaseMExecutionGuard,
  buildWordpressPhaseMDryRunExecutionSimulator,
  buildWordpressPhaseMDryRunExecutionArtifact,
  buildWordpressPhaseMFinalOperatorHandoffBundle
} from "./phaseM.js";
import {
  resolveWordpressPhaseNPlan,
  assertWordpressPhaseNPlan,
  buildWordpressPhaseNGate,
  runWordpressDataIntegrityInventory,
  buildWordpressPhaseNNormalizedInventory,
  buildWordpressPhaseNReadinessGate,
  buildWordpressPhaseNSafeCandidates,
  buildWordpressPhaseNReconciliationPayloadPlanner,
  resolveWordpressPhaseNExecutionPlan,
  buildWordpressPhaseNExecutionGuard,
  buildWordpressPhaseNMutationCandidateSelector,
  buildWordpressPhaseNMutationCandidateArtifact,
  buildWordpressPhaseNMutationPayloadComposer,
  buildWordpressPhaseNMutationPayloadArtifact,
  buildWordpressPhaseNDryRunExecutionSimulator,
  buildWordpressPhaseNDryRunExecutionArtifact,
  buildWordpressPhaseNFinalOperatorHandoffBundle
} from "./phaseN.js";
import {
  resolveWordpressPhaseOPlan,
  assertWordpressPhaseOPlan,
  buildWordpressPhaseOGate,
  runWordpressQaAcceptanceInventory,
  buildWordpressPhaseONormalizedInventory,
  buildWordpressPhaseOReadinessGate,
  buildWordpressPhaseOSafeCandidates,
  buildWordpressPhaseOReconciliationPayloadPlanner,
  resolveWordpressPhaseOExecutionPlan,
  buildWordpressPhaseOExecutionGuard,
  buildWordpressPhaseOMutationCandidateSelector,
  buildWordpressPhaseOMutationCandidateArtifact,
  buildWordpressPhaseOMutationPayloadComposer,
  buildWordpressPhaseOMutationPayloadArtifact,
  buildWordpressPhaseODryRunExecutionSimulator,
  buildWordpressPhaseODryRunExecutionArtifact,
  buildWordpressPhaseOFinalOperatorHandoffBundle
} from "./phaseO.js";
import {
  resolveWordpressPhasePPlan,
  assertWordpressPhasePPlan,
  buildWordpressPhasePGate,
  runWordpressProductionCutoverInventory,
  buildWordpressPhasePNormalizedInventory,
  buildWordpressPhasePReadinessGate,
  buildWordpressPhasePSafeCandidates,
  buildWordpressPhasePReconciliationPayloadPlanner,
  resolveWordpressPhasePExecutionPlan,
  buildWordpressPhasePExecutionGuard,
  buildWordpressPhasePMutationCandidateSelector,
  buildWordpressPhasePMutationCandidateArtifact,
  buildWordpressPhasePMutationPayloadComposer,
  buildWordpressPhasePMutationPayloadArtifact,
  buildWordpressPhasePDryRunExecutionSimulator,
  buildWordpressPhasePDryRunExecutionArtifact,
  buildWordpressPhasePFinalOperatorHandoffBundle
} from "./phaseP.js";
import {
  resolveWordpressPhaseKPlan,
  assertWordpressPhaseKPlan,
  buildWordpressPhaseKGate,
  runWordpressObservabilityMonitoringInventory,
  buildWordpressPhaseKInventoryArtifact,
  buildWordpressPhaseKNormalizedInventory,
  buildWordpressPhaseKNormalizedInventoryArtifact,
  buildWordpressPhaseKReadinessGate,
  buildWordpressPhaseKSafeCandidates,
  buildWordpressPhaseKReadinessArtifact,
  buildWordpressPhaseKReconciliationPayloadPlanner,
  buildWordpressPhaseKReconciliationPayloadArtifact,
  resolveWordpressPhaseKExecutionPlan,
  buildWordpressPhaseKExecutionGuard,
  buildWordpressPhaseKExecutionGuardArtifact,
  buildWordpressPhaseKMutationCandidateSelector,
  buildWordpressPhaseKMutationCandidateArtifact,
  buildWordpressPhaseKMutationPayloadComposer,
  buildWordpressPhaseKMutationPayloadArtifact,
  buildWordpressPhaseKDryRunExecutionSimulator,
  buildWordpressPhaseKDryRunExecutionArtifact,
  buildWordpressPhaseKFinalOperatorHandoffBundle
} from "./phaseK.js";
import {
  resolveWordpressPhaseBPlan,
  assertWordpressPhaseBPlan,
  buildWordpressPhaseBMappingPrerequisiteGate,
  buildWordpressPhaseBMappingPrerequisiteArtifact,
  buildWordpressPhaseBNormalizedAudit,
  buildWordpressPhaseBFieldMappingResolver,
  buildWordpressPhaseBFieldMappingArtifact,
  buildWordpressPhaseBMappingPlanSkeleton,
  buildWordpressPhaseBMappingPlanArtifact,
  buildWordpressPhaseBMigrationPlanningCandidates,
  buildWordpressPhaseBSequencePlanner,
  buildWordpressPhaseBSequenceArtifact,
  buildWordpressPhaseBPlanningArtifact,
  buildWordpressPhaseBReadinessArtifact,
  buildWordpressPhaseBDryRunMigrationPayloadPlanner,
  buildWordpressPhaseBDryRunArtifact,
  buildWordpressPhaseBExecutionGuard,
  buildWordpressPhaseBExecutionGuardArtifact,
  resolveWordpressPhaseBExecutionPlan,
  buildWordpressPhaseBMutationCandidateSelector,
  buildWordpressPhaseBMutationCandidateArtifact,
  buildWordpressPhaseBMutationPayloadComposer,
  buildWordpressPhaseBMutationPayloadArtifact,
  buildWordpressPhaseBDryRunExecutionSimulator,
  buildWordpressPhaseBDryRunExecutionArtifact,
  buildWordpressPhaseBFinalOperatorHandoffBundle,
  runWordpressBuilderAssetsInventoryAudit
} from "./phaseB.js";
import {
  resolveWordpressPhaseCPlan,
  assertWordpressPhaseCPlan,
  buildWordpressPhaseCGate,
  buildWordpressPhaseCInventoryArtifact,
  buildWordpressPhaseCNormalizedDiff,
  buildWordpressPhaseCDiffArtifact,
  buildWordpressPhaseCReconciliationReadiness,
  buildWordpressPhaseCSafeApplyCandidates,
  buildWordpressPhaseCReconciliationPayloadPlanner,
  buildWordpressPhaseCReconciliationPayloadArtifact,
  resolveWordpressPhaseCExecutionPlan,
  buildWordpressPhaseCExecutionGuard,
  buildWordpressPhaseCExecutionGuardArtifact,
  buildWordpressPhaseCMutationCandidateSelector,
  buildWordpressPhaseCMutationCandidateArtifact,
  buildWordpressPhaseCMutationPayloadComposer,
  buildWordpressPhaseCMutationPayloadArtifact,
  buildWordpressPhaseCDryRunExecutionSimulator,
  buildWordpressPhaseCDryRunExecutionArtifact,
  buildWordpressPhaseCReadinessArtifact,
  buildWordpressPhaseCFinalOperatorHandoffBundle
} from "./phaseC.js";
import {
  resolveWordpressPhaseDPlan,
  assertWordpressPhaseDPlan,
  buildWordpressPhaseDGate,
  runWordpressFormsIntegrationsInventory,
  buildWordpressPhaseDInventoryArtifact,
  buildWordpressPhaseDNormalizedInventory,
  buildWordpressPhaseDNormalizedInventoryArtifact,
  buildWordpressPhaseDReadinessGate,
  buildWordpressPhaseDSafeCandidates,
  buildWordpressPhaseDReadinessArtifact,
  buildWordpressPhaseDMigrationPayloadPlanner,
  buildWordpressPhaseDMigrationPayloadArtifact,
  resolveWordpressPhaseDExecutionPlan,
  buildWordpressPhaseDExecutionGuard,
  buildWordpressPhaseDExecutionGuardArtifact,
  buildWordpressPhaseDMutationCandidateSelector,
  buildWordpressPhaseDMutationCandidateArtifact,
  buildWordpressPhaseDMutationPayloadComposer,
  buildWordpressPhaseDMutationPayloadArtifact,
  buildWordpressPhaseDDryRunExecutionSimulator,
  buildWordpressPhaseDDryRunExecutionArtifact,
  buildWordpressPhaseDFinalOperatorHandoffBundle
} from "./phaseD.js";
import {
  resolveWordpressPhaseEPlan,
  assertWordpressPhaseEPlan,
  buildWordpressPhaseEGate,
  runWordpressMediaInventory,
  buildWordpressPhaseEInventoryArtifact,
  buildWordpressPhaseENormalizedInventory,
  buildWordpressPhaseENormalizedInventoryArtifact,
  buildWordpressPhaseEReadinessGate,
  buildWordpressPhaseESafeCandidates,
  buildWordpressPhaseEReadinessArtifact,
  buildWordpressPhaseEMigrationPayloadPlanner,
  buildWordpressPhaseEMigrationPayloadArtifact,
  resolveWordpressPhaseEExecutionPlan,
  buildWordpressPhaseEExecutionGuard,
  buildWordpressPhaseEExecutionGuardArtifact,
  buildWordpressPhaseEMutationCandidateSelector,
  buildWordpressPhaseEMutationCandidateArtifact,
  buildWordpressPhaseEMutationPayloadComposer,
  buildWordpressPhaseEMutationPayloadArtifact,
  buildWordpressPhaseEDryRunExecutionSimulator,
  buildWordpressPhaseEDryRunExecutionArtifact,
  buildWordpressPhaseEFinalOperatorHandoffBundle
} from "./phaseE.js";
import {
  resolveWordpressPhaseFPlan,
  assertWordpressPhaseFPlan,
  buildWordpressPhaseFGate,
  runWordpressUsersRolesAuthInventory,
  buildWordpressPhaseFInventoryArtifact,
  buildWordpressPhaseFNormalizedInventory,
  buildWordpressPhaseFNormalizedInventoryArtifact,
  buildWordpressPhaseFReadinessGate,
  buildWordpressPhaseFSafeCandidates,
  buildWordpressPhaseFReadinessArtifact,
  buildWordpressPhaseFReconciliationPayloadPlanner,
  buildWordpressPhaseFReconciliationPayloadArtifact,
  resolveWordpressPhaseFExecutionPlan,
  buildWordpressPhaseFExecutionGuard,
  buildWordpressPhaseFExecutionGuardArtifact,
  buildWordpressPhaseFMutationCandidateSelector,
  buildWordpressPhaseFMutationCandidateArtifact,
  buildWordpressPhaseFMutationPayloadComposer,
  buildWordpressPhaseFMutationPayloadArtifact,
  buildWordpressPhaseFDryRunExecutionSimulator,
  buildWordpressPhaseFDryRunExecutionArtifact,
  buildWordpressPhaseFFinalOperatorHandoffBundle
} from "./phaseF.js";
import {
  resolveWordpressPhaseGPlan,
  assertWordpressPhaseGPlan,
  buildWordpressPhaseGGate,
  runWordpressSeoInventory,
  buildWordpressPhaseGInventoryArtifact,
  buildWordpressPhaseGNormalizedInventory,
  buildWordpressPhaseGNormalizedInventoryArtifact,
  buildWordpressPhaseGReadinessGate,
  buildWordpressPhaseGSafeCandidates,
  buildWordpressPhaseGReadinessArtifact,
  buildWordpressPhaseGReconciliationPayloadPlanner,
  buildWordpressPhaseGReconciliationPayloadArtifact,
  resolveWordpressPhaseGExecutionPlan,
  buildWordpressPhaseGExecutionGuard,
  buildWordpressPhaseGExecutionGuardArtifact,
  buildWordpressPhaseGMutationCandidateSelector,
  buildWordpressPhaseGMutationCandidateArtifact,
  buildWordpressPhaseGMutationPayloadComposer,
  buildWordpressPhaseGMutationPayloadArtifact,
  buildWordpressPhaseGDryRunExecutionSimulator,
  buildWordpressPhaseGDryRunExecutionArtifact,
  buildWordpressPhaseGFinalOperatorHandoffBundle
} from "./phaseG.js";
import {
  resolveWordpressPhaseHPlan,
  assertWordpressPhaseHPlan,
  buildWordpressPhaseHGate,
  runWordpressAnalyticsTrackingInventory,
  buildWordpressPhaseHInventoryArtifact,
  buildWordpressPhaseHNormalizedInventory,
  buildWordpressPhaseHNormalizedInventoryArtifact,
  buildWordpressPhaseHReadinessGate,
  buildWordpressPhaseHSafeCandidates,
  buildWordpressPhaseHReadinessArtifact,
  buildWordpressPhaseHReconciliationPayloadPlanner,
  buildWordpressPhaseHReconciliationPayloadArtifact,
  resolveWordpressPhaseHExecutionPlan,
  buildWordpressPhaseHExecutionGuard,
  buildWordpressPhaseHExecutionGuardArtifact,
  buildWordpressPhaseHMutationCandidateSelector,
  buildWordpressPhaseHMutationCandidateArtifact,
  buildWordpressPhaseHMutationPayloadComposer,
  buildWordpressPhaseHMutationPayloadArtifact,
  buildWordpressPhaseHDryRunExecutionSimulator,
  buildWordpressPhaseHDryRunExecutionArtifact,
  buildWordpressPhaseHFinalOperatorHandoffBundle
} from "./phaseH.js";
import {
  resolveWordpressPhaseIPlan,
  assertWordpressPhaseIPlan,
  buildWordpressPhaseIGate,
  runWordpressPerformanceOptimizationInventory,
  buildWordpressPhaseIInventoryArtifact,
  buildWordpressPhaseINormalizedInventory,
  buildWordpressPhaseINormalizedInventoryArtifact,
  buildWordpressPhaseIReadinessGate,
  buildWordpressPhaseISafeCandidates,
  buildWordpressPhaseIReadinessArtifact,
  buildWordpressPhaseIReconciliationPayloadPlanner,
  buildWordpressPhaseIReconciliationPayloadArtifact,
  resolveWordpressPhaseIExecutionPlan,
  buildWordpressPhaseIExecutionGuard,
  buildWordpressPhaseIExecutionGuardArtifact,
  buildWordpressPhaseIMutationCandidateSelector,
  buildWordpressPhaseIMutationCandidateArtifact,
  buildWordpressPhaseIMutationPayloadComposer,
  buildWordpressPhaseIMutationPayloadArtifact,
  buildWordpressPhaseIDryRunExecutionSimulator,
  buildWordpressPhaseIDryRunExecutionArtifact,
  buildWordpressPhaseIFinalOperatorHandoffBundle
} from "./phaseI.js";
import {
  resolveWordpressPhaseJPlan,
  assertWordpressPhaseJPlan,
  buildWordpressPhaseJGate,
  runWordpressSecurityHardeningInventory,
  buildWordpressPhaseJInventoryArtifact,
  buildWordpressPhaseJNormalizedInventory,
  buildWordpressPhaseJNormalizedInventoryArtifact,
  buildWordpressPhaseJReadinessGate,
  buildWordpressPhaseJSafeCandidates,
  buildWordpressPhaseJReadinessArtifact,
  buildWordpressPhaseJReconciliationPayloadPlanner,
  buildWordpressPhaseJReconciliationPayloadArtifact,
  resolveWordpressPhaseJExecutionPlan,
  buildWordpressPhaseJExecutionGuard,
  buildWordpressPhaseJExecutionGuardArtifact,
  buildWordpressPhaseJMutationCandidateSelector,
  buildWordpressPhaseJMutationCandidateArtifact,
  buildWordpressPhaseJMutationPayloadComposer,
  buildWordpressPhaseJMutationPayloadArtifact,
  buildWordpressPhaseJDryRunExecutionSimulator,
  buildWordpressPhaseJDryRunExecutionArtifact,
  buildWordpressPhaseJFinalOperatorHandoffBundle
} from "./phaseJ.js";

export function evaluateWordpressPhaseAStartReadiness(args = {}) {
  const {
    payload = {},
    wpContext = {},
    sourceCollectionSlug = "",
    destinationCollectionSlug = "",
    generatedCandidate = null,
    materializedRegistryRowExists = false
  } = args;

  const phase = classifyWordpressExecutionStage(payload);
  const apply = payload?.migration?.apply === true;
  const publishStatus = String(payload?.migration?.publish_status || "draft")
    .trim()
    .toLowerCase();

  const governance_gate_results = {
    target_key_valid: !!String(wpContext?.destination?.target_key || "").trim(),
    parent_action_key_valid: true,
    source_collection_resolved: !!String(sourceCollectionSlug || "").trim(),
    destination_collection_resolved: !!String(destinationCollectionSlug || "").trim(),
    draft_first_publish_mode: publishStatus === "draft",
    generated_candidate_present: !!generatedCandidate,
    materialized_registry_row_exists: !!materializedRegistryRowExists,
    writeback_plan_available: true
  };

  const readyForPhaseA =
    governance_gate_results.target_key_valid &&
    governance_gate_results.parent_action_key_valid &&
    governance_gate_results.source_collection_resolved &&
    governance_gate_results.destination_collection_resolved &&
    governance_gate_results.draft_first_publish_mode;

  return {
    phase_a_start_status: readyForPhaseA
      ? "ready_for_phase_a"
      : "blocked_by_governance_gate",
    execution_stage: phase,
    apply,
    publish_status: publishStatus,
    governance_gate_results
  };
}

export function buildWordpressGeneratedCandidateEvidence(args = {}) {
  const slug = String(args.slug || "").trim();
  const kind = String(args.kind || "").trim();
  const method = String(args.method || "").trim().toUpperCase();
  const materializedRegistryRowExists = !!args.materializedRegistryRowExists;

  if (!slug || !kind || !method) return null;

  const actionMap = {
    GET_COLLECTION: "list",
    POST_COLLECTION: "create",
    GET_ITEM: "get",
    POST_ITEM: "update",
    DELETE_ITEM: "delete"
  };

  const action = String(args.action || "").trim() ||
    actionMap[String(args.actionClass || "").trim()] ||
    "";

  if (!action) return null;

  const endpointKey = `wordpress_${action}_${slug}`;
  const itemPath = `/wp/v2/${slug}/{id}`;
  const collectionPath = `/wp/v2/${slug}`;
  const generatedPath =
    action === "get" || action === "update" || action === "delete"
      ? itemPath
      : collectionPath;

  return {
    generated_candidate: true,
    generated_candidate_kind: kind,
    generated_candidate_slug: slug,
    generated_candidate_endpoint_key: endpointKey,
    generated_candidate_path: generatedPath,
    generated_candidate_basis: "template_path_rule",
    generated_candidate_confidence: "high",
    materialized_registry_row_exists: materializedRegistryRowExists
  };
}

export function classifyWordpressPhaseAScope(postType = "") {
  const normalized = normalizeWordpressPhaseAType(postType);

  if (WORDPRESS_PHASE_A_ALLOWED_TYPES.has(normalized)) {
    return {
      normalized,
      phase_a_allowed: true,
      phase_a_blocked: false,
      scope_family: normalized === "category" || normalized === "tag"
        ? "taxonomy"
        : "content"
    };
  }

  if (WORDPRESS_PHASE_A_BLOCKED_TYPES.has(normalized)) {
    return {
      normalized,
      phase_a_allowed: false,
      phase_a_blocked: true,
      scope_family: "blocked_phase_b_or_later"
    };
  }

  return {
    normalized,
    phase_a_allowed: false,
    phase_a_blocked: true,
    scope_family: "unsupported_in_phase_a"
  };
}

export function assertWordpressPhaseAScope(payload = {}) {
  const requested =
    Array.isArray(payload?.migration?.post_types) && payload.migration.post_types.length
      ? payload.migration.post_types
      : ["post"];

  const classifications = requested.map(classifyWordpressPhaseAScope);
  const blocked = classifications.filter(x => !x.phase_a_allowed);

  const publishStatus = String(payload?.migration?.publish_status || "draft")
    .trim()
    .toLowerCase();

  if (publishStatus !== "draft") {
    const err = createHttpError(
      "wordpress_phase_a_requires_draft_first",
      "WordPress Phase A only allows draft-first execution.",
      409
    );
    err.phase_a_scope_classifications = classifications;
    err.publish_status = publishStatus;
    throw err;
  }

  if (blocked.length) {
    const err = createHttpError(
      "wordpress_phase_a_scope_blocked",
      "WordPress Phase A is restricted to post/page/category/tag only.",
      409
    );
    err.phase_a_scope_classifications = classifications;
    err.blocked_types = blocked.map(x => x.normalized);
    throw err;
  }

  return classifications;
}

export function buildWordpressPhaseAExecutionOrder(postTypes = []) {
  const priority = new Map([
    ["category", 10],
    ["tag", 20],
    ["page", 30],
    ["post", 40]
  ]);

  return [...postTypes]
    .map(x => normalizeWordpressPhaseAType(x))
    .sort((a, b) => (priority.get(a) || 999) - (priority.get(b) || 999));
}

export function resolveWordpressPhaseABatchPolicy(payload = {}) {
  const migration = payload?.migration || {};

  const batch_size = toPositiveInt(
    migration.batch_size,
    20
  );

  const throttle_ms = Math.max(
    0,
    toPositiveInt(migration.throttle_ms, 0)
  );

  const max_items_per_type = Math.max(
    1,
    toPositiveInt(migration.max_items_per_type, 500)
  );

  const continue_on_item_error =
    migration.continue_on_item_error === undefined
      ? true
      : migration.continue_on_item_error === true;

  return {
    batch_size,
    throttle_ms,
    max_items_per_type,
    continue_on_item_error
  };
}

export function resolveWordpressPhaseARetryPolicy(payload = {}) {
  const migration = payload?.migration || {};

  return {
    retry_enabled:
      migration.retry_enabled === undefined ? true : migration.retry_enabled === true,
    max_attempts: Math.max(1, toPositiveInt(migration.retry_max_attempts, 3)),
    base_delay_ms: Math.max(0, toPositiveInt(migration.retry_base_delay_ms, 750)),
    retry_on_statuses: Array.isArray(migration.retry_on_statuses)
      ? migration.retry_on_statuses
          .map(x => Number(x))
          .filter(Number.isFinite)
      : [429, 500, 502, 503, 504],
    retry_on_codes: Array.isArray(migration.retry_on_codes)
      ? migration.retry_on_codes.map(x => String(x || "").trim()).filter(Boolean)
      : [
          "fetch_failed",
          "request_timeout",
          "timeout",
          "wordpress_source_read_failed",
          "wordpress_destination_lookup_failed",
          "wordpress_destination_write_failed",
          "wordpress_readback_failed"
        ]
  };
}

export function resolveWordpressPhaseAResumePolicy(payload = {}) {
  const migration = payload?.migration || {};
  const checkpoint =
    migration.checkpoint && typeof migration.checkpoint === "object"
      ? migration.checkpoint
      : {};

  return {
    resume_enabled:
      migration.resume_enabled === undefined ? true : migration.resume_enabled === true,
    checkpoint: {
      post_type: String(checkpoint.post_type || "").trim(),
      batch_index: Math.max(1, toPositiveInt(checkpoint.batch_index, 1)),
      last_completed_slug: String(checkpoint.last_completed_slug || "").trim()
    }
  };
}

export function shouldSkipWordpressPhaseAPostType(postType = "", resumePolicy = {}) {
  if (!resumePolicy?.resume_enabled) return false;

  const checkpointPostType = String(resumePolicy?.checkpoint?.post_type || "").trim();
  if (!checkpointPostType) return false;

  const ordered = buildWordpressPhaseAExecutionOrder([
    "category",
    "tag",
    "page",
    "post"
  ]);

  const currentIdx = ordered.indexOf(normalizeWordpressPhaseAType(postType));
  const checkpointIdx = ordered.indexOf(normalizeWordpressPhaseAType(checkpointPostType));

  if (currentIdx === -1 || checkpointIdx === -1) return false;
  return currentIdx < checkpointIdx;
}

export function trimBatchForResume(batch = [], batchIndex = 1, postType = "", resumePolicy = {}) {
  if (!resumePolicy?.resume_enabled) return batch;

  const checkpoint = resumePolicy.checkpoint || {};
  const checkpointPostType = normalizeWordpressPhaseAType(checkpoint.post_type || "");
  const currentPostType = normalizeWordpressPhaseAType(postType);
  const checkpointBatchIndex = Math.max(1, toPositiveInt(checkpoint.batch_index, 1));
  const lastCompletedSlug = String(checkpoint.last_completed_slug || "").trim();

  if (!checkpointPostType || checkpointPostType !== currentPostType) {
    return batch;
  }

  if (batchIndex < checkpointBatchIndex) {
    return [];
  }

  if (batchIndex > checkpointBatchIndex) {
    return batch;
  }

  if (!lastCompletedSlug) {
    return batch;
  }

  const idx = batch.findIndex(
    item => String(item?.slug || "").trim() === lastCompletedSlug
  );

  if (idx === -1) {
    return batch;
  }

  return batch.slice(idx + 1);
}

export function buildWordpressPhaseACheckpoint(args = {}) {
  return {
    post_type: String(args.post_type || "").trim(),
    batch_index: Math.max(1, toPositiveInt(args.batch_index, 1)),
    last_completed_slug: String(args.last_completed_slug || "").trim()
  };
}

export function buildWordpressPhaseAPerTypeSummary(args = {}) {
  const destinationStatuses = Array.isArray(args.destinationStatuses)
    ? args.destinationStatuses
    : [];
  const failures = Array.isArray(args.failures) ? args.failures : [];
  const postTypes = Array.isArray(args.postTypes) ? args.postTypes : [];

  return postTypes.map(postType => {
    const statusRows = destinationStatuses.filter(
      x => String(x?.post_type || "").trim() === String(postType || "").trim()
    );
    const failureRows = failures.filter(
      x => String(x?.post_type || "").trim() === String(postType || "").trim()
    );

    const created_count = statusRows.filter(
      x => String(x?.operation || "").trim() === "created"
    ).length;
    const updated_count = statusRows.filter(
      x => String(x?.operation || "").trim() === "updated"
    ).length;
    const discovered_existing_count = statusRows.filter(
      x => String(x?.operation || "").trim() === "discovered_existing"
    ).length;
    const not_found_count = statusRows.filter(
      x => String(x?.operation || "").trim() === "not_found"
    ).length;

    const verified_count = statusRows.filter(x => x?.readback_verified === true).length;
    const retry_used_count = statusRows.filter(x => x?.retry_used === true).length;
    const parent_repair_applied_count = statusRows.filter(
      x => x?.parent_repair_applied === true
    ).length;
    const taxonomy_repair_applied_count = statusRows.filter(
      x => x?.taxonomy_repair_applied === true
    ).length;
    const taxonomy_repair_blocked_count = statusRows.filter(
      x => x?.taxonomy_repair_blocked === true
    ).length;
    const featured_media_deferred_count = statusRows.filter(
      x => x?.featured_media_deferred === true
    ).length;

    const processed_count = statusRows.length;
    const failure_count = failureRows.length;

    let status_classification = "not_started";
    if (processed_count > 0 && failure_count === 0) {
      status_classification = "success";
    } else if (processed_count > 0 && failure_count > 0) {
      status_classification = "partial_success";
    } else if (processed_count === 0 && failure_count > 0) {
      status_classification = "failed";
    }

    return {
      post_type: String(postType || "").trim(),
      processed_count,
      created_count,
      updated_count,
      discovered_existing_count,
      not_found_count,
      verified_count,
      retry_used_count,
      parent_repair_applied_count,
      taxonomy_repair_applied_count,
      taxonomy_repair_blocked_count,
      featured_media_deferred_count,
      failure_count,
      status_classification
    };
  });
}

export function classifyWordpressPhaseAOutcome(args = {}) {
  const perTypeSummary = Array.isArray(args.perTypeSummary) ? args.perTypeSummary : [];
  const failures = Array.isArray(args.failures) ? args.failures : [];
  const apply = args.apply === true;

  const processedCount = perTypeSummary.reduce(
    (sum, row) => sum + Number(row?.processed_count || 0),
    0
  );
  const failureCount = failures.length;
  const allSuccess =
    perTypeSummary.length > 0 &&
    perTypeSummary.every(x => String(x?.status_classification || "") === "success");

  let outcome = "no_op";
  let outcome_message = "No WordPress Phase A operations were executed.";

  if (!apply && processedCount > 0) {
    outcome = "discovery_only";
    outcome_message = "WordPress Phase A discovery completed.";
  } else if (apply && processedCount > 0 && failureCount === 0 && allSuccess) {
    outcome = "success";
    outcome_message = "WordPress Phase A migration completed successfully.";
  } else if (apply && processedCount > 0 && failureCount > 0) {
    outcome = "partial_success";
    outcome_message = "WordPress Phase A migration completed with partial success.";
  } else if (apply && processedCount === 0 && failureCount > 0) {
    outcome = "failed";
    outcome_message = "WordPress Phase A migration failed before any item completed.";
  }

  return {
    phase_a_outcome: outcome,
    phase_a_outcome_message: outcome_message,
    processed_count: processedCount,
    failure_count: failureCount
  };
}

export function summarizeWordpressPhaseAFailures(failures = [], limit = 25) {
  if (!Array.isArray(failures) || !failures.length) return [];

  return failures.slice(0, limit).map(row => ({
    post_type: String(row?.post_type || "").trim(),
    slug: String(row?.slug || "").trim(),
    batch_index: Number(row?.batch_index || 0) || null,
    code: String(row?.code || row?.failure_reason || "").trim(),
    message: String(row?.message || "").trim()
  }));
}

export function buildWordpressPhaseAOperatorArtifact(args = {}) {
  const payload = args.payload && typeof args.payload === "object" ? args.payload : {};
  const phaseAOutcome = args.phaseAOutcome || {};
  const phaseAPerTypeSummary = Array.isArray(args.phaseAPerTypeSummary)
    ? args.phaseAPerTypeSummary
    : [];
  const failures = Array.isArray(args.failures) ? args.failures : [];
  const postTypeResolution = Array.isArray(args.postTypeResolution)
    ? args.postTypeResolution
    : [];
  const batchTelemetry = Array.isArray(args.phaseABatchTelemetry)
    ? args.phaseABatchTelemetry
    : [];
  const retryTelemetry = Array.isArray(args.phaseARetryTelemetry)
    ? args.phaseARetryTelemetry
    : [];

  const migration = payload?.migration || {};

  return {
    artifact_type: "wordpress_phase_a_operator_review",
    artifact_version: "v1",
    execution_stage: classifyWordpressExecutionStage(payload),
    publish_mode: "draft_first",
    phase_a_scope: "content_safe_migration",
    phase_a_outcome: String(phaseAOutcome.phase_a_outcome || "").trim(),
    phase_a_outcome_message: String(
      phaseAOutcome.phase_a_outcome_message || ""
    ).trim(),
    requested_post_types: Array.isArray(migration.post_types)
      ? migration.post_types.map(x => String(x || "").trim()).filter(Boolean)
      : ["post"],
    processed_count: Number(phaseAOutcome.processed_count || 0),
    failure_count: Number(phaseAOutcome.failure_count || 0),
    source_limit_per_type: Number(args.batchPolicy?.max_items_per_type || 0),
    batch_size: Number(args.batchPolicy?.batch_size || 0),
    throttle_ms: Number(args.batchPolicy?.throttle_ms || 0),
    retry_enabled: !!args.retryPolicy?.retry_enabled,
    retry_max_attempts: Number(args.retryPolicy?.max_attempts || 0),
    checkpoint: args.phaseACheckpoint || {},
    per_type_summary: phaseAPerTypeSummary,
    post_type_resolution: postTypeResolution,
    failure_summary: summarizeWordpressPhaseAFailures(failures, 25),
    batch_overview: batchTelemetry.map(row => ({
      post_type: String(row?.post_type || "").trim(),
      batch_index: Number(row?.batch_index || 0) || null,
      batch_size: Number(row?.batch_size || 0),
      resumed_batch_size: Number(row?.resumed_batch_size || 0),
      created_count: Number(row?.created_count || 0),
      updated_count: Number(row?.updated_count || 0),
      failed_count: Number(row?.failed_count || 0),
      skipped_by_resume: row?.skipped_by_resume === true
    })),
    retry_overview: retryTelemetry.slice(0, 100).map(row => ({
      post_type: String(row?.post_type || "").trim(),
      slug: String(row?.slug || "").trim(),
      retry_domain: String(row?.retry_domain || "").trim(),
      retry_used: row?.retry_used === true,
      final_attempt: Number(row?.final_attempt || 0)
    }))
  };
}

export function evaluateWordpressPhaseAPromotionReadiness(args = {}) {
  const phaseAOutcome = args.phaseAOutcome || {};
  const phaseAPerTypeSummary = Array.isArray(args.phaseAPerTypeSummary)
    ? args.phaseAPerTypeSummary
    : [];
  const destinationStatuses = Array.isArray(args.destinationStatuses)
    ? args.destinationStatuses
    : [];
  const deferredRepairFailures = Array.isArray(args.deferredRepairFailures)
    ? args.deferredRepairFailures
    : [];

  const unresolvedTaxonomyCount = destinationStatuses.filter(
    x => x?.taxonomy_repair_blocked === true
  ).length;

  const parentReadbackFailedCount = destinationStatuses.filter(
    x => x?.parent_readback_verified === false
  ).length;

  const taxonomyReadbackFailedCount = destinationStatuses.filter(
    x => x?.taxonomy_readback_verified === false
  ).length;

  const itemReadbackFailedCount = destinationStatuses.filter(
    x => x?.readback_verified === false
  ).length;

  const featuredMediaDeferredCount = destinationStatuses.filter(
    x => x?.featured_media_deferred === true
  ).length;

  const successfulTypes = phaseAPerTypeSummary.filter(
    row => String(row?.status_classification || "").trim() === "success"
  ).map(row => String(row?.post_type || "").trim());

  const blockingReasons = [];

  if (String(phaseAOutcome.phase_a_outcome || "").trim() === "failed") {
    blockingReasons.push("phase_a_failed");
  }

  if (deferredRepairFailures.length > 0) {
    blockingReasons.push("deferred_repair_failures_present");
  }

  if (unresolvedTaxonomyCount > 0) {
    blockingReasons.push("taxonomy_unresolved_present");
  }

  if (parentReadbackFailedCount > 0) {
    blockingReasons.push("parent_readback_failed");
  }

  if (taxonomyReadbackFailedCount > 0) {
    blockingReasons.push("taxonomy_readback_failed");
  }

  if (itemReadbackFailedCount > 0) {
    blockingReasons.push("item_readback_failed");
  }

  const promotionReady = blockingReasons.length === 0;

  return {
    selective_publish_ready: promotionReady,
    promotion_status: promotionReady
      ? "ready_for_selective_publish"
      : "blocked_for_selective_publish",
    blocking_reasons: blockingReasons,
    successful_post_types: successfulTypes,
    unresolved_taxonomy_count: unresolvedTaxonomyCount,
    parent_readback_failed_count: parentReadbackFailedCount,
    taxonomy_readback_failed_count: taxonomyReadbackFailedCount,
    item_readback_failed_count: itemReadbackFailedCount,
    featured_media_deferred_count: featuredMediaDeferredCount
  };
}

export function isWordpressPublishablePhaseAType(postType = "") {
  const normalized = normalizeWordpressPhaseAType(postType);
  return normalized === "post" || normalized === "page";
}

export function buildWordpressSelectivePublishCandidates(args = {}) {
  const destinationStatuses = Array.isArray(args.destinationStatuses)
    ? args.destinationStatuses
    : [];
  const promotionGuard =
    args.promotionGuard && typeof args.promotionGuard === "object"
      ? args.promotionGuard
      : {};
  const limit = Math.max(1, toPositiveInt(args.limit, 200));

  const candidates = [];
  const rejected = [];

  for (const row of destinationStatuses) {
    const postType = String(row?.post_type || "").trim();
    const operation = String(row?.operation || "").trim();
    const id = Number(row?.id);
    const slug = String(row?.slug || "").trim();

    const baseRecord = {
      post_type: postType,
      slug,
      destination_id: Number.isFinite(id) ? id : null,
      operation,
      status: String(row?.status || "").trim()
    };

    if (!isWordpressPublishablePhaseAType(postType)) {
      rejected.push({
        ...baseRecord,
        rejection_reason: "non_publishable_phase_a_type"
      });
      continue;
    }

    if (!Number.isFinite(id)) {
      rejected.push({
        ...baseRecord,
        rejection_reason: "missing_destination_id"
      });
      continue;
    }

    if (!(operation === "created" || operation === "updated")) {
      rejected.push({
        ...baseRecord,
        rejection_reason: "non_mutated_item"
      });
      continue;
    }

    if (row?.readback_verified !== true) {
      rejected.push({
        ...baseRecord,
        rejection_reason: "item_readback_not_verified"
      });
      continue;
    }

    if (row?.parent_readback_verified === false) {
      rejected.push({
        ...baseRecord,
        rejection_reason: "parent_readback_not_verified"
      });
      continue;
    }

    if (row?.taxonomy_repair_blocked === true) {
      rejected.push({
        ...baseRecord,
        rejection_reason: "taxonomy_repair_blocked"
      });
      continue;
    }

    if (row?.taxonomy_readback_verified === false) {
      rejected.push({
        ...baseRecord,
        rejection_reason: "taxonomy_readback_not_verified"
      });
      continue;
    }

    candidates.push({
      ...baseRecord,
      ready_for_publish: promotionGuard.selective_publish_ready === true,
      retry_used: row?.retry_used === true,
      featured_media_deferred: row?.featured_media_deferred === true,
      parent_repair_applied: row?.parent_repair_applied === true,
      taxonomy_repair_applied: row?.taxonomy_repair_applied === true,
      candidate_reason: "phase_a_verified_mutation"
    });
  }

  return {
    candidate_count: Math.min(limit, candidates.length),
    rejected_count: rejected.length,
    candidates: candidates.slice(0, limit),
    rejected: rejected.slice(0, limit)
  };
}

export function resolveWordpressSelectivePublishPlan(payload = {}) {
  const migration = payload?.migration || {};
  const selective =
    migration.selective_publish && typeof migration.selective_publish === "object"
      ? migration.selective_publish
      : {};

  return {
    enabled: selective.enabled === true,
    apply_limit: Math.max(1, toPositiveInt(selective.apply_limit, 25)),
    include_post_types: Array.isArray(selective.include_post_types)
      ? selective.include_post_types
          .map(x => normalizeWordpressPhaseAType(x))
          .filter(Boolean)
      : ["post", "page"],
    include_slugs: Array.isArray(selective.include_slugs)
      ? selective.include_slugs.map(x => String(x || "").trim()).filter(Boolean)
      : [],
    exclude_slugs: Array.isArray(selective.exclude_slugs)
      ? selective.exclude_slugs.map(x => String(x || "").trim()).filter(Boolean)
      : []
  };
}

export function filterWordpressSelectivePublishCandidates(args = {}) {
  const candidates = Array.isArray(args.candidates) ? args.candidates : [];
  const plan = args.plan && typeof args.plan === "object" ? args.plan : {};

  const includePostTypes = new Set(
    Array.isArray(plan.include_post_types) ? plan.include_post_types : []
  );
  const includeSlugs = new Set(
    Array.isArray(plan.include_slugs) ? plan.include_slugs : []
  );
  const excludeSlugs = new Set(
    Array.isArray(plan.exclude_slugs) ? plan.exclude_slugs : []
  );

  let filtered = candidates.filter(row =>
    includePostTypes.size === 0
      ? true
      : includePostTypes.has(normalizeWordpressPhaseAType(row?.post_type || ""))
  );

  if (includeSlugs.size > 0) {
    filtered = filtered.filter(row => includeSlugs.has(String(row?.slug || "").trim()));
  }

  if (excludeSlugs.size > 0) {
    filtered = filtered.filter(row => !excludeSlugs.has(String(row?.slug || "").trim()));
  }

  return filtered.slice(0, Math.max(1, Number(plan.apply_limit || 25)));
}

export async function publishWordpressDestinationEntryById(args = {}) {
  return await updateWordpressDestinationEntryById({
    destinationSiteRef: args.destinationSiteRef,
    collectionSlug: String(args.collectionSlug || "").trim(),
    destinationId: args.destinationId,
    body: { status: "publish" },
    authRequired: true
  });
}

export async function verifyWordpressPublishedEntry(args = {}) {
  const readback = await getWordpressItemById({
    siteRef: args.destinationSiteRef,
    collectionSlug: String(args.collectionSlug || "").trim(),
    id: args.destinationId,
    authRequired: true
  });

  const actualStatus = String(readback?.status || "").trim().toLowerCase();
  return {
    verified: actualStatus === "publish",
    actual_status: actualStatus || "",
    readback
  };
}

export async function executeWordpressSelectivePublish(args = {}) {
  const destinationSiteRef = args.destinationSiteRef;
  const promotionGuard = args.promotionGuard || {};
  const plan = args.plan || {};
  const candidateBundle = args.candidateBundle || {};

  const candidates = filterWordpressSelectivePublishCandidates({
    candidates: candidateBundle.candidates || [],
    plan
  });

  const results = [];
  const failures = [];

  if (plan.enabled !== true) {
    return {
      publish_attempted: false,
      publish_status: "disabled",
      selected_candidates: [],
      results,
      failures
    };
  }

  if (promotionGuard.selective_publish_ready !== true) {
    return {
      publish_attempted: false,
      publish_status: "blocked_by_promotion_guard",
      selected_candidates: candidates,
      results,
      failures: [
        {
          code: "selective_publish_blocked",
          message: "Selective publish blocked by phase_a_promotion_guard.",
          blocking_reasons: promotionGuard.blocking_reasons || []
        }
      ]
    };
  }

  for (const candidate of candidates) {
    const postType = normalizeWordpressPhaseAType(candidate?.post_type || "");
    const collectionSlug = normalizeWordpressCollectionSlug(postType);
    const destinationId = Number(candidate?.destination_id);

    try {
      await publishWordpressDestinationEntryById({
        destinationSiteRef,
        collectionSlug,
        destinationId
      });

      const verification = await verifyWordpressPublishedEntry({
        destinationSiteRef,
        collectionSlug,
        destinationId
      });

      const row = {
        post_type: postType,
        slug: String(candidate?.slug || "").trim(),
        destination_id: destinationId,
        publish_requested: true,
        publish_verified: verification.verified,
        actual_status: verification.actual_status
      };

      results.push(row);

      if (!verification.verified) {
        failures.push({
          post_type: postType,
          slug: String(candidate?.slug || "").trim(),
          destination_id: destinationId,
          code: "selective_publish_readback_failed",
          message: "Selective publish readback verification failed.",
          actual_status: verification.actual_status
        });
      }
    } catch (err) {
      failures.push({
        post_type: postType,
        slug: String(candidate?.slug || "").trim(),
        destination_id: destinationId,
        code: err?.code || "selective_publish_failed",
        message: err?.message || "Selective publish failed."
      });
    }
  }

  return {
    publish_attempted: true,
    publish_status:
      failures.length === 0 ? "completed" : "completed_with_failures",
    selected_candidates: candidates,
    results,
    failures
  };
}

export function buildWordpressSelectivePublishRollbackPlan(args = {}) {
  const execution =
    args.execution && typeof args.execution === "object" ? args.execution : {};
  const results = Array.isArray(execution.results) ? execution.results : [];
  const failures = Array.isArray(execution.failures) ? execution.failures : [];

  const rollbackCandidates = results
    .filter(row => row?.publish_requested === true)
    .map(row => ({
      post_type: String(row?.post_type || "").trim(),
      slug: String(row?.slug || "").trim(),
      destination_id: Number.isFinite(Number(row?.destination_id))
        ? Number(row.destination_id)
        : null,
      current_status: String(row?.actual_status || "").trim(),
      rollback_target_status: "draft",
      rollback_reason:
        row?.publish_verified === true
          ? "published_in_phase_a_selective_publish"
          : "publish_verification_uncertain"
    }))
    .filter(row => Number.isFinite(row.destination_id));

  const rollbackBlocked =
    String(execution.publish_status || "").trim() === "blocked_by_promotion_guard";

  const rollbackReady = !rollbackBlocked && rollbackCandidates.length > 0;

  const blockingReasons = [];
  if (rollbackBlocked) {
    blockingReasons.push("publish_blocked_by_promotion_guard");
  }
  if (rollbackCandidates.length === 0) {
    blockingReasons.push("no_published_candidates_to_rollback");
  }

  return {
    rollback_ready: rollbackReady,
    rollback_status: rollbackReady
      ? "rollback_available"
      : "rollback_not_available",
    candidate_count: rollbackCandidates.length,
    blocking_reasons: blockingReasons,
    failures_present: failures.length > 0,
    rollback_candidates: rollbackCandidates
  };
}

export function resolveWordpressSelectivePublishRollbackPlan(payload = {}) {
  const migration = payload?.migration || {};
  const rollback =
    migration.selective_publish_rollback &&
    typeof migration.selective_publish_rollback === "object"
      ? migration.selective_publish_rollback
      : {};

  return {
    enabled: rollback.enabled === true,
    apply_limit: Math.max(1, toPositiveInt(rollback.apply_limit, 25)),
    include_post_types: Array.isArray(rollback.include_post_types)
      ? rollback.include_post_types
          .map(x => normalizeWordpressPhaseAType(x))
          .filter(Boolean)
      : ["post", "page"],
    include_slugs: Array.isArray(rollback.include_slugs)
      ? rollback.include_slugs.map(x => String(x || "").trim()).filter(Boolean)
      : [],
    exclude_slugs: Array.isArray(rollback.exclude_slugs)
      ? rollback.exclude_slugs.map(x => String(x || "").trim()).filter(Boolean)
      : []
  };
}

export function filterWordpressSelectivePublishRollbackCandidates(args = {}) {
  const rollbackPlan =
    args.rollbackPlan && typeof args.rollbackPlan === "object"
      ? args.rollbackPlan
      : {};
  const executionPlan =
    args.executionPlan && typeof args.executionPlan === "object"
      ? args.executionPlan
      : {};

  let candidates = Array.isArray(executionPlan.rollback_candidates)
    ? executionPlan.rollback_candidates
    : [];

  const includePostTypes = new Set(
    Array.isArray(rollbackPlan.include_post_types)
      ? rollbackPlan.include_post_types
      : []
  );
  const includeSlugs = new Set(
    Array.isArray(rollbackPlan.include_slugs) ? rollbackPlan.include_slugs : []
  );
  const excludeSlugs = new Set(
    Array.isArray(rollbackPlan.exclude_slugs) ? rollbackPlan.exclude_slugs : []
  );

  candidates = candidates.filter(row =>
    includePostTypes.size === 0
      ? true
      : includePostTypes.has(normalizeWordpressPhaseAType(row?.post_type || ""))
  );

  if (includeSlugs.size > 0) {
    candidates = candidates.filter(row => includeSlugs.has(String(row?.slug || "").trim()));
  }

  if (excludeSlugs.size > 0) {
    candidates = candidates.filter(row => !excludeSlugs.has(String(row?.slug || "").trim()));
  }

  return candidates.slice(0, Math.max(1, Number(rollbackPlan.apply_limit || 25)));
}

export async function rollbackWordpressPublishedEntryById(args = {}) {
  return await updateWordpressDestinationEntryById({
    destinationSiteRef: args.destinationSiteRef,
    collectionSlug: String(args.collectionSlug || "").trim(),
    destinationId: args.destinationId,
    body: { status: "draft" },
    authRequired: true
  });
}

export async function executeWordpressSelectivePublishRollback(args = {}) {
  const destinationSiteRef = args.destinationSiteRef;
  const rollbackPlan = args.rollbackPlan || {};
  const executionPlan = args.executionPlan || {};

  const selectedCandidates = filterWordpressSelectivePublishRollbackCandidates({
    rollbackPlan,
    executionPlan
  });

  const results = [];
  const failures = [];

  if (rollbackPlan.enabled !== true) {
    return {
      rollback_attempted: false,
      rollback_execution_status: "disabled",
      selected_candidates: [],
      results,
      failures
    };
  }

  if (executionPlan.rollback_ready !== true) {
    return {
      rollback_attempted: false,
      rollback_execution_status: "blocked_by_rollback_plan",
      selected_candidates: selectedCandidates,
      results,
      failures: [
        {
          code: "selective_publish_rollback_blocked",
          message: "Selective publish rollback blocked by rollback plan.",
          blocking_reasons: executionPlan.blocking_reasons || []
        }
      ]
    };
  }

  for (const candidate of selectedCandidates) {
    const postType = normalizeWordpressPhaseAType(candidate?.post_type || "");
    const collectionSlug = normalizeWordpressCollectionSlug(postType);
    const destinationId = Number(candidate?.destination_id);

    try {
      await rollbackWordpressPublishedEntryById({
        destinationSiteRef,
        collectionSlug,
        destinationId
      });

      const verification = await verifyWordpressRolledBackEntry({
        destinationSiteRef,
        collectionSlug,
        destinationId
      });

      const row = {
        post_type: postType,
        slug: String(candidate?.slug || "").trim(),
        destination_id: destinationId,
        rollback_requested: true,
        rollback_verified: verification.verified,
        actual_status: verification.actual_status
      };

      results.push(row);

      if (!verification.verified) {
        failures.push({
          post_type: postType,
          slug: String(candidate?.slug || "").trim(),
          destination_id: destinationId,
          code: "selective_publish_rollback_readback_failed",
          message: "Selective publish rollback readback verification failed.",
          actual_status: verification.actual_status
        });
      }
    } catch (err) {
      failures.push({
        post_type: postType,
        slug: String(candidate?.slug || "").trim(),
        destination_id: destinationId,
        code: err?.code || "selective_publish_rollback_failed",
        message: err?.message || "Selective publish rollback failed."
      });
    }
  }

  return {
    rollback_attempted: true,
    rollback_execution_status:
      failures.length === 0 ? "completed" : "completed_with_failures",
    selected_candidates: selectedCandidates,
    results,
    failures
  };
}

export function buildWordpressPhaseACutoverJournal(args = {}) {
  const payload = args.payload && typeof args.payload === "object" ? args.payload : {};
  const phaseAOutcome =
    args.phaseAOutcome && typeof args.phaseAOutcome === "object"
      ? args.phaseAOutcome
      : {};
  const promotionGuard =
    args.promotionGuard && typeof args.promotionGuard === "object"
      ? args.promotionGuard
      : {};
  const selectivePublishExecution =
    args.selectivePublishExecution &&
    typeof args.selectivePublishExecution === "object"
      ? args.selectivePublishExecution
      : {};
  const selectivePublishRollbackExecution =
    args.selectivePublishRollbackExecution &&
    typeof args.selectivePublishRollbackExecution === "object"
      ? args.selectivePublishRollbackExecution
      : {};
  const checkpoint =
    args.phaseACheckpoint && typeof args.phaseACheckpoint === "object"
      ? args.phaseACheckpoint
      : {};
  const perTypeSummary = Array.isArray(args.phaseAPerTypeSummary)
    ? args.phaseAPerTypeSummary
    : [];

  const publishResults = Array.isArray(selectivePublishExecution.results)
    ? selectivePublishExecution.results
    : [];
  const rollbackResults = Array.isArray(selectivePublishRollbackExecution.results)
    ? selectivePublishRollbackExecution.results
    : [];

  const migration = payload?.migration || {};

  const timeline = [
    {
      step: "phase_a_execution",
      status: String(phaseAOutcome.phase_a_outcome || "").trim() || "unknown",
      recorded_at: nowIsoSafe(),
      detail: String(phaseAOutcome.phase_a_outcome_message || "").trim()
    },
    {
      step: "promotion_guard",
      status: String(promotionGuard.promotion_status || "").trim() || "unknown",
      recorded_at: nowIsoSafe(),
      detail: Array.isArray(promotionGuard.blocking_reasons)
        ? promotionGuard.blocking_reasons.join(", ")
        : ""
    },
    {
      step: "selective_publish",
      status: String(selectivePublishExecution.publish_status || "").trim() || "not_run",
      recorded_at: nowIsoSafe(),
      detail: `published=${publishResults.filter(x => x?.publish_verified === true).length}`
    },
    {
      step: "selective_publish_rollback",
      status:
        String(selectivePublishRollbackExecution.rollback_execution_status || "").trim() ||
        "not_run",
      recorded_at: nowIsoSafe(),
      detail: `rolled_back=${rollbackResults.filter(x => x?.rollback_verified === true).length}`
    }
  ];

  return {
    artifact_type: "wordpress_phase_a_cutover_journal",
    artifact_version: "v1",
    execution_stage: classifyWordpressExecutionStage(payload),
    publish_mode: "draft_first",
    requested_post_types: Array.isArray(migration.post_types)
      ? migration.post_types.map(x => String(x || "").trim()).filter(Boolean)
      : ["post"],
    phase_a_outcome: String(phaseAOutcome.phase_a_outcome || "").trim(),
    phase_a_outcome_message: String(phaseAOutcome.phase_a_outcome_message || "").trim(),
    promotion_status: String(promotionGuard.promotion_status || "").trim(),
    selective_publish_ready: promotionGuard.selective_publish_ready === true,
    checkpoint,
    per_type_summary: perTypeSummary,
    published_count: publishResults.filter(x => x?.publish_verified === true).length,
    publish_failed_count: Array.isArray(selectivePublishExecution.failures)
      ? selectivePublishExecution.failures.length
      : 0,
    rollback_count: rollbackResults.filter(x => x?.rollback_verified === true).length,
    rollback_failed_count: Array.isArray(selectivePublishRollbackExecution.failures)
      ? selectivePublishRollbackExecution.failures.length
      : 0,
    timeline
  };
}

export function classifyWordpressPhaseAFinalCutoverRecommendation(args = {}) {
  const phaseAOutcome =
    args.phaseAOutcome && typeof args.phaseAOutcome === "object"
      ? args.phaseAOutcome
      : {};
  const promotionGuard =
    args.promotionGuard && typeof args.promotionGuard === "object"
      ? args.promotionGuard
      : {};
  const selectivePublishExecution =
    args.selectivePublishExecution &&
    typeof args.selectivePublishExecution === "object"
      ? args.selectivePublishExecution
      : {};
  const selectivePublishRollbackExecution =
    args.selectivePublishRollbackExecution &&
    typeof args.selectivePublishRollbackExecution === "object"
      ? args.selectivePublishRollbackExecution
      : {};
  const perTypeSummary = Array.isArray(args.phaseAPerTypeSummary)
    ? args.phaseAPerTypeSummary
    : [];

  const publishFailures = Array.isArray(selectivePublishExecution.failures)
    ? selectivePublishExecution.failures.length
    : 0;
  const rollbackFailures = Array.isArray(selectivePublishRollbackExecution.failures)
    ? selectivePublishRollbackExecution.failures.length
    : 0;

  const successfulTypes = perTypeSummary
    .filter(row => String(row?.status_classification || "").trim() === "success")
    .map(row => String(row?.post_type || "").trim());

  let recommendation = "hold";
  let recommendation_reason =
    "WordPress Phase A requires further review before cutover.";

  if (String(phaseAOutcome.phase_a_outcome || "").trim() === "failed") {
    recommendation = "do_not_cutover";
    recommendation_reason = "Phase A failed.";
  } else if (promotionGuard.selective_publish_ready !== true) {
    recommendation = "fix_before_cutover";
    recommendation_reason =
      "Promotion guard blocked selective publish readiness.";
  } else if (
    String(selectivePublishExecution.publish_status || "").trim() === "completed" &&
    publishFailures === 0 &&
    rollbackFailures === 0
  ) {
    recommendation = "ready_for_controlled_cutover";
    recommendation_reason =
      "Phase A passed, promotion guard is clear, and selective publish completed cleanly.";
  } else if (
    String(phaseAOutcome.phase_a_outcome || "").trim() === "success" &&
    promotionGuard.selective_publish_ready === true
  ) {
    recommendation = "ready_for_reviewed_cutover";
    recommendation_reason =
      "Phase A succeeded and promotion guard is clear, but publish/rollback history still needs operator review.";
  }

  return {
    final_cutover_recommendation: recommendation,
    final_cutover_reason: recommendation_reason,
    successful_post_types: successfulTypes,
    promotion_status: String(promotionGuard.promotion_status || "").trim(),
    publish_status: String(selectivePublishExecution.publish_status || "").trim(),
    rollback_status: String(
      selectivePublishRollbackExecution.rollback_execution_status || ""
    ).trim(),
    publish_failure_count: publishFailures,
    rollback_failure_count: rollbackFailures
  };
}

export function buildWordpressPhaseAFinalOperatorHandoffBundle(args = {}) {
  const payload = args.payload && typeof args.payload === "object" ? args.payload : {};
  const phaseAOutcome =
    args.phaseAOutcome && typeof args.phaseAOutcome === "object"
      ? args.phaseAOutcome
      : {};
  const promotionGuard =
    args.promotionGuard && typeof args.promotionGuard === "object"
      ? args.promotionGuard
      : {};
  const finalCutoverRecommendation =
    args.finalCutoverRecommendation &&
    typeof args.finalCutoverRecommendation === "object"
      ? args.finalCutoverRecommendation
      : {};
  const operatorArtifact =
    args.operatorArtifact && typeof args.operatorArtifact === "object"
      ? args.operatorArtifact
      : {};
  const cutoverJournal =
    args.cutoverJournal && typeof args.cutoverJournal === "object"
      ? args.cutoverJournal
      : {};
  const selectivePublishCandidates =
    args.selectivePublishCandidates &&
    typeof args.selectivePublishCandidates === "object"
      ? args.selectivePublishCandidates
      : {};
  const selectivePublishExecution =
    args.selectivePublishExecution &&
    typeof args.selectivePublishExecution === "object"
      ? args.selectivePublishExecution
      : {};
  const selectivePublishRollbackPlan =
    args.selectivePublishRollbackPlan &&
    typeof args.selectivePublishRollbackPlan === "object"
      ? args.selectivePublishRollbackPlan
      : {};
  const selectivePublishRollbackExecution =
    args.selectivePublishRollbackExecution &&
    typeof args.selectivePublishRollbackExecution === "object"
      ? args.selectivePublishRollbackExecution
      : {};
  const phaseAPerTypeSummary = Array.isArray(args.phaseAPerTypeSummary)
    ? args.phaseAPerTypeSummary
    : [];
  const checkpoint =
    args.phaseACheckpoint && typeof args.phaseACheckpoint === "object"
      ? args.phaseACheckpoint
      : {};

  const migration = payload?.migration || {};

  return {
    artifact_type: "wordpress_phase_a_final_operator_handoff",
    artifact_version: "v1",
    execution_stage: classifyWordpressExecutionStage(payload),
    publish_mode: "draft_first",
    requested_post_types: Array.isArray(migration.post_types)
      ? migration.post_types.map(x => String(x || "").trim()).filter(Boolean)
      : ["post"],
    phase_a_outcome: String(phaseAOutcome.phase_a_outcome || "").trim(),
    phase_a_outcome_message: String(phaseAOutcome.phase_a_outcome_message || "").trim(),
    final_cutover_recommendation: String(
      finalCutoverRecommendation.final_cutover_recommendation || ""
    ).trim(),
    final_cutover_reason: String(
      finalCutoverRecommendation.final_cutover_reason || ""
    ).trim(),
    promotion_status: String(promotionGuard.promotion_status || "").trim(),
    selective_publish_ready: promotionGuard.selective_publish_ready === true,
    checkpoint,
    per_type_summary: phaseAPerTypeSummary,
    operator_review_artifact: operatorArtifact,
    cutover_journal: cutoverJournal,
    selective_publish_candidate_count: Number(
      selectivePublishCandidates.candidate_count || 0
    ),
    selective_publish_rejected_count: Number(
      selectivePublishCandidates.rejected_count || 0
    ),
    selective_publish_status: String(
      selectivePublishExecution.publish_status || ""
    ).trim(),
    selective_publish_published_count: Array.isArray(selectivePublishExecution.results)
      ? selectivePublishExecution.results.filter(x => x?.publish_verified === true).length
      : 0,
    selective_publish_failure_count: Array.isArray(selectivePublishExecution.failures)
      ? selectivePublishExecution.failures.length
      : 0,
    rollback_ready: selectivePublishRollbackPlan.rollback_ready === true,
    rollback_status: String(selectivePublishRollbackPlan.rollback_status || "").trim(),
    rollback_execution_status: String(
      selectivePublishRollbackExecution.rollback_execution_status || ""
    ).trim(),
    rollback_applied_count: Array.isArray(selectivePublishRollbackExecution.results)
      ? selectivePublishRollbackExecution.results.filter(x => x?.rollback_verified === true).length
      : 0,
    rollback_failure_count: Array.isArray(selectivePublishRollbackExecution.failures)
      ? selectivePublishRollbackExecution.failures.length
      : 0,
    operator_actions: [
      String(finalCutoverRecommendation.final_cutover_recommendation || "").trim() ===
      "ready_for_controlled_cutover"
        ? "proceed_with_controlled_cutover"
        : "hold_cutover",
      promotionGuard.selective_publish_ready === true
        ? "review_selective_publish_results"
        : "review_blocking_reasons",
      selectivePublishRollbackPlan.rollback_ready === true
        ? "retain_rollback_plan"
        : "rollback_plan_not_available"
    ]
  };
}

export async function runWordpressConnectorMigration({ payload, wpContext, mutationPlan, writebackPlan }) {
  const apply = payload?.migration?.apply === true;
  const requestedPostTypes = (payload?.migration?.post_types || []).length
    ? payload.migration.post_types
    : ["post"];
  const phaseAScopeClassifications = assertWordpressPhaseAScope(payload);
  const postTypes = buildWordpressPhaseAExecutionOrder(requestedPostTypes);
  const batchPolicy = resolveWordpressPhaseABatchPolicy(payload);
  const retryPolicy = resolveWordpressPhaseARetryPolicy(payload);
  const resumePolicy = resolveWordpressPhaseAResumePolicy(payload);
  const publishStatus = String(payload?.migration?.publish_status || "draft")
    .trim()
    .toLowerCase();

  const resultBase = {
    transport: "wordpress_connector",
    mutation_plan: mutationPlan,
    writeback_plan: writebackPlan,
    artifacts: buildSiteMigrationArtifacts(wpContext, payload, "wordpress_connector"),
    runtime_delta: {
      source_supported_cpts: wpContext?.source?.runtime?.supported_cpts || [],
      destination_supported_cpts: wpContext?.destination?.runtime?.supported_cpts || []
    },
    settings_delta: {
      source_permalink_structure: wpContext?.source?.settings?.permalink_structure || "",
      destination_permalink_structure: wpContext?.destination?.settings?.permalink_structure || ""
    },
    plugin_delta: {
      source_plugins: wpContext?.source?.plugins?.active_plugins || [],
      destination_plugins: wpContext?.destination?.plugins?.active_plugins || []
    }
  };

  if (!apply) {
    return {
      ok: true,
      ...resultBase,
      execution_mode: "plan_only",
      apply: false,
      publish_status: publishStatus,
      message: "WordPress connector migration plan prepared (apply=false).",
      source_items_scanned: 0,
      created_count: 0,
      updated_count: 0,
      destination_ids: [],
      destination_statuses: [],
      readback_verified: false
    };
  }

  if (!WORDPRESS_MUTATION_PUBLISH_STATUSES.has(publishStatus)) {
    throw createHttpError(
      "invalid_publish_status",
      `Unsupported publish status: ${publishStatus}`,
      400
    );
  }

  if (!getWordpressSiteAuth(wpContext?.destination || {})) {
    throw createHttpError(
      "wordpress_destination_auth_missing",
      "Destination WordPress credentials are required for live mutation.",
      409
    );
  }

  const destinationStatuses = [];
  const postTypeResolution = [];
  const failures = [];
  const governedResolutionRecords = [];
  const generatedCandidateEvidence = [];
  const phaseAState = ensureWordpressPhaseAState(mutationPlan);
  let createdCount = 0;
  let updatedCount = 0;
  let sourceItemsScanned = 0;
  const phaseABatchTelemetry = [];
  const phaseARetryTelemetry = [];
  let phaseACheckpoint = buildWordpressPhaseACheckpoint({});

  for (const postTypeRaw of postTypes) {
    const postType = normalizeWordpressCollectionSlug(postTypeRaw);
    if (!postType) continue;

    if (shouldSkipWordpressPhaseAPostType(postType, resumePolicy)) {
      phaseABatchTelemetry.push({
        post_type: postType,
        skipped_by_resume: true,
        checkpoint: resumePolicy.checkpoint
      });
      continue;
    }

    const scopeClassification = classifyWordpressPhaseAScope(postType);
    let sourceCollectionSlug = "";
    let destinationCollectionSlug = "";

    try {
      sourceCollectionSlug = await resolveWordpressCollectionSlug({
        siteRef: wpContext?.source || {},
        postType,
        authRequired: false
      });
      destinationCollectionSlug = await resolveWordpressCollectionSlug({
        siteRef: wpContext?.destination || {},
        postType,
        authRequired: true
      });
      postTypeResolution.push({
        post_type: postType,
        phase_a_scope_family: scopeClassification.scope_family,
        source_collection: sourceCollectionSlug,
        destination_collection: destinationCollectionSlug
      });

      const generatedEvidence = buildWordpressGeneratedCandidateEvidence({
        slug: destinationCollectionSlug || sourceCollectionSlug || postType,
        kind: "post_type",
        method: apply ? "POST" : "GET",
        actionClass: apply ? "POST_COLLECTION" : "GET_COLLECTION",
        materializedRegistryRowExists: false
      });

      const governedRecord = buildGovernedResolutionRecord({
        normalized_query: `wordpress:${postType}`,
        candidate_count: generatedEvidence ? 1 : 0,
        selected_candidate_id: generatedEvidence
          ? generatedEvidence.generated_candidate_endpoint_key
          : "",
        selected_candidate_key: generatedEvidence
          ? generatedEvidence.generated_candidate_endpoint_key
          : "",
        selection_confidence: generatedEvidence ? "high" : "low",
        selection_basis: generatedEvidence
          ? "resolver_backed_template_generation"
          : "unresolved",
        rejected_candidate_summary: [],
        fallback_used: false,
        governance_gate_results: {
          source_collection_resolved: !!sourceCollectionSlug,
          destination_collection_resolved: !!destinationCollectionSlug,
          generated_candidate_present: !!generatedEvidence,
          materialized_registry_row_exists: false
        }
      });

      assertWordpressGovernedResolutionConfidence(governedRecord, apply);
      governedResolutionRecords.push(governedRecord);
      if (generatedEvidence) generatedCandidateEvidence.push(generatedEvidence);
    } catch (err) {
      failures.push({
        post_type: postType,
        stage: "post_type_resolution",
        source_id: null,
        code: String(err?.code || "wordpress_post_type_resolution_failed"),
        message: String(err?.message || "Unable to resolve source/destination post type collection.")
      });
      continue;
    }

    const phaseAReadiness = evaluateWordpressPhaseAStartReadiness({
      payload,
      wpContext,
      sourceCollectionSlug,
      destinationCollectionSlug,
      generatedCandidate: generatedCandidateEvidence[generatedCandidateEvidence.length - 1] || null,
      materializedRegistryRowExists: false
    });

    if (phaseAReadiness.phase_a_start_status !== "ready_for_phase_a" && apply) {
      failures.push({
        post_type: postType,
        code: "wordpress_phase_a_start_blocked",
        message: "WordPress Phase A start blocked by governed readiness gate.",
        phase_a_start_status: phaseAReadiness.phase_a_start_status,
        governance_gate_results: phaseAReadiness.governance_gate_results
      });
      continue;
    }

    let sourceEntriesRaw = [];
    try {
      const sourceEntriesRetry = await runWithWordpressSelectiveRetry(
        () =>
          listWordpressEntriesByType({
            siteRef: wpContext?.source || {},
            postType,
            collectionSlug: sourceCollectionSlug
          }),
        retryPolicy,
        { retry_domain: "source_list" }
      );

      sourceEntriesRaw = Array.isArray(sourceEntriesRetry.result)
        ? sourceEntriesRetry.result
        : [];

      phaseARetryTelemetry.push({
        post_type: postType,
        retry_domain: "source_list",
        retry_used: sourceEntriesRetry.retry_used,
        final_attempt: sourceEntriesRetry.final_attempt,
        attempts: sourceEntriesRetry.attempts
      });
    } catch (err) {
      failures.push({
        post_type: postType,
        post_type_collection: sourceCollectionSlug,
        stage: "source_read",
        source_id: null,
        code: String(err?.code || "source_read_failed"),
        message: String(err?.message || "Unable to read source entries."),
        retry_attempts: err?.wordpress_retry_attempts || []
      });
      continue;
    }

    const sourceEntries = sourceEntriesRaw.slice(0, batchPolicy.max_items_per_type);
    const batches = chunkArray(sourceEntries, batchPolicy.batch_size);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex];
      const resumableBatch = trimBatchForResume(
        batch,
        batchIndex + 1,
        postType,
        resumePolicy
      );
      let batchCreated = 0;
      let batchUpdated = 0;
      let batchFailed = 0;

      for (const sourceEntry of resumableBatch) {
        sourceItemsScanned += 1;
        const sourceId = Number(sourceEntry?.id);
        const safeSourceId = Number.isFinite(sourceId) ? sourceId : null;
        const mutationPayload = mapWordpressSourceEntryToMutationPayload(
          sourceEntry,
          publishStatus
        );
        const slug = String(mutationPayload.slug || "").trim();

        try {
          let operation = "create";
          let targetId = null;
          let existingRetry = {
            retry_used: false,
            final_attempt: 0,
            attempts: []
          };

          if (slug) {
            existingRetry = await runWithWordpressSelectiveRetry(
              () =>
                findWordpressDestinationEntryBySlug({
                  siteRef: wpContext?.destination || {},
                  postType,
                  slug,
                  collectionSlug: destinationCollectionSlug
                }),
              retryPolicy,
              { retry_domain: "destination_lookup" }
            );

            const existing = existingRetry.result;
            const existingId = Number(existing?.id);
            if (Number.isFinite(existingId) && existingId > 0) {
              operation = "update";
              targetId = existingId;
            }

            phaseARetryTelemetry.push({
              post_type: postType,
              slug,
              retry_domain: "destination_lookup",
              retry_used: existingRetry.retry_used,
              final_attempt: existingRetry.final_attempt,
              attempts: existingRetry.attempts
            });
          }

          const upsertRetry = await runWithWordpressSelectiveRetry(
            async () => {
              const response = await executeWordpressRestJsonRequest({
                siteRef: wpContext?.destination || {},
                method: "POST",
                restPath: targetId
                  ? `/wp/v2/${encodeURIComponent(destinationCollectionSlug)}/${targetId}`
                  : `/wp/v2/${encodeURIComponent(destinationCollectionSlug)}`,
                body: mutationPayload,
                authRequired: true
              });

              if (!response.ok) {
                throw createHttpError(
                  String(response?.data?.code || "wordpress_destination_write_failed"),
                  String(
                    response?.data?.message ||
                      `Destination ${operation} failed with status ${response.status}.`
                  ),
                  Number(response.status || 502),
                  {
                    post_type: postType,
                    post_type_collection: destinationCollectionSlug,
                    batch_index: batchIndex + 1,
                    stage: operation,
                    source_id: safeSourceId,
                    response: response.data
                  }
                );
              }

              const destinationId = Number(response?.data?.id);
              if (!Number.isFinite(destinationId) || destinationId < 1) {
                throw createHttpError(
                  "wordpress_mutation_missing_id",
                  "Destination mutation succeeded without a valid destination id.",
                  400,
                  {
                    post_type: postType,
                    post_type_collection: destinationCollectionSlug,
                    batch_index: batchIndex + 1,
                    stage: operation,
                    source_id: safeSourceId
                  }
                );
              }

              return {
                id: destinationId,
                status: String(response?.data?.status || ""),
                link: String(
                  response?.data?.link ||
                    response?.data?.guid?.rendered ||
                    ""
                ),
                slug: String(response?.data?.slug || slug || "").trim()
              };
            },
            retryPolicy,
            { retry_domain: "destination_upsert" }
          );

          const upsertResult = upsertRetry.result;

          phaseARetryTelemetry.push({
            post_type: postType,
            slug: upsertResult.slug || slug,
            retry_domain: "destination_upsert",
            retry_used: upsertRetry.retry_used,
            final_attempt: upsertRetry.final_attempt,
            attempts: upsertRetry.attempts
          });

          if (operation === "create") {
            createdCount += 1;
            batchCreated += 1;
          } else {
            updatedCount += 1;
            batchUpdated += 1;
          }

          buildDeferredWordpressReferencePlan(phaseAState, {
            postType,
            postTypeCollection: destinationCollectionSlug,
            destinationCollectionSlug,
            item: sourceEntry,
            destinationId: upsertResult.id
          });

          destinationStatuses.push({
            id: upsertResult.id,
            source_id: safeSourceId,
            destination_id: upsertResult.id,
            post_type: postType,
            post_type_collection: destinationCollectionSlug,
            batch_index: batchIndex + 1,
            operation,
            status: upsertResult.status,
            link: upsertResult.link,
            slug: upsertResult.slug,
            retry_used: existingRetry.retry_used || upsertRetry.retry_used
          });

          phaseACheckpoint = buildWordpressPhaseACheckpoint({
            post_type: postType,
            batch_index: batchIndex + 1,
            last_completed_slug: String(
              sourceEntry?.slug || mutationPayload?.slug || upsertResult?.slug || ""
            ).trim()
          });
        } catch (err) {
          batchFailed += 1;
          failures.push({
            post_type: postType,
            slug: sourceEntry?.slug || "",
            post_type_collection: destinationCollectionSlug,
            batch_index: batchIndex + 1,
            stage: "mutation_exception",
            source_id: safeSourceId,
            code: String(err?.code || "wordpress_item_migration_failed"),
            message: String(err?.message || "WordPress item migration failed."),
            retry_attempts: err?.wordpress_retry_attempts || []
          });
          if (!batchPolicy.continue_on_item_error) {
            throw err;
          }
        }
      }

      phaseABatchTelemetry.push({
        post_type: postType,
        batch_index: batchIndex + 1,
        batch_size: batch.length,
        resumed_batch_size: resumableBatch.length,
        created_count: batchCreated,
        updated_count: batchUpdated,
        failed_count: batchFailed,
        checkpoint_after_batch: phaseACheckpoint,
        throttle_ms_applied:
          batchPolicy.throttle_ms > 0 && batchIndex < batches.length - 1
            ? batchPolicy.throttle_ms
            : 0
      });

      if (batchPolicy.throttle_ms > 0 && batchIndex < batches.length - 1) {
        await sleep(batchPolicy.throttle_ms);
      }
    }
  }

  let deferredParentRepairs = [];
  let deferredTaxonomyRepairs = [];
  let deferredFeaturedMediaRepairs = [];
  let deferredParentReadbackChecks = [];
  let deferredTaxonomyReadbackChecks = [];
  let deferredRepairFailures = [];
  let phaseAPerTypeSummary = [];
  let phaseAOutcome = {
    phase_a_outcome: "no_op",
    phase_a_outcome_message: "No WordPress Phase A operations were executed.",
    processed_count: 0,
    failure_count: 0
  };
  let phaseAOperatorArtifact = null;
  let phaseAPromotionGuard = {
    selective_publish_ready: false,
    promotion_status: "blocked_for_selective_publish",
    blocking_reasons: ["phase_a_not_evaluated"],
    successful_post_types: [],
    unresolved_taxonomy_count: 0,
    parent_readback_failed_count: 0,
    taxonomy_readback_failed_count: 0,
    item_readback_failed_count: 0,
    featured_media_deferred_count: 0
  };
  let selectivePublishCandidates = {
    candidate_count: 0,
    rejected_count: 0,
    candidates: [],
    rejected: []
  };
  let selectivePublishPlan = {
    enabled: false,
    apply_limit: 25,
    include_post_types: ["post", "page"],
    include_slugs: [],
    exclude_slugs: []
  };
  let selectivePublishExecution = {
    publish_attempted: false,
    publish_status: "disabled",
    selected_candidates: [],
    results: [],
    failures: []
  };
  let selectivePublishRollbackPlan = {
    rollback_ready: false,
    rollback_status: "rollback_not_available",
    candidate_count: 0,
    blocking_reasons: ["selective_publish_not_evaluated"],
    failures_present: false,
    rollback_candidates: []
  };
  let selectivePublishRollbackExecutionPlan = {
    enabled: false,
    apply_limit: 25,
    include_post_types: ["post", "page"],
    include_slugs: [],
    exclude_slugs: []
  };
  let selectivePublishRollbackExecution = {
    rollback_attempted: false,
    rollback_execution_status: "disabled",
    selected_candidates: [],
    results: [],
    failures: []
  };
  let phaseACutoverJournal = null;
  let phaseAFinalCutoverRecommendation = {
    final_cutover_recommendation: "hold",
    final_cutover_reason: "Cutover not yet evaluated.",
    successful_post_types: [],
    promotion_status: "",
    publish_status: "",
    rollback_status: "",
    publish_failure_count: 0,
    rollback_failure_count: 0
  };
  let phaseAFinalOperatorHandoffBundle = null;
  let phaseBPlan = {
    enabled: false,
    audit_only: true,
    apply: false,
    post_types: [],
    max_items_per_type: 250,
    dependency_scan_enabled: true,
    include_inactive: false
  };
  let phaseBPlanStatus = {
    phase_b_status: "disabled",
    phase_b_ready: false,
    blocking_reasons: ["phase_b_not_evaluated"]
  };
  let phaseBGate = {
    phase_b_gate_status: "blocked",
    phase_b_gate_ready: false,
    phase_b_audit_only: true,
    blocking_reasons: ["phase_b_gate_not_evaluated"]
  };
  let phaseBInventoryAudit = {
    phase_b_inventory_status: "disabled",
    audit_rows: [],
    inventory_counts: [],
    failures: []
  };
  let phaseBNormalizedAudit = {
    normalized_audit_rows: [],
    dependency_summary: [],
    dependency_totals: {
      total_count: 0,
      low_risk_count: 0,
      medium_risk_count: 0,
      high_risk_count: 0
    },
    family_summary: [],
    migration_buckets: {
      candidate_low_complexity: [],
      candidate_reviewed_low_risk: [],
      staged_dependency_review: [],
      blocked_high_dependency: [],
      manual_review: []
    },
    cross_reference_summary: {
      total_rows: 0,
      rows_with_template_refs: 0,
      rows_with_widget_refs: 0,
      rows_with_navigation_refs: 0,
      rows_with_popup_refs: 0,
      rows_with_shortcode_refs: 0
    },
    dependency_reference_index: {
      by_node_key: {},
      by_source_id: {}
    },
    dependency_graph_edges: [],
    dependency_graph_unresolved: [],
    dependency_graph_summary: {
      edge_count: 0,
      unresolved_count: 0,
      relation_counts: {},
      unresolved_relation_counts: {}
    }
  };
  let phaseBGraphStability = {
    phase_b_graph_stable: false,
    phase_b_readiness_status: "not_evaluated",
    blocking_reasons: ["phase_b_graph_not_evaluated"],
    unresolved_reference_count: 0,
    high_risk_asset_count: 0,
    blocked_bucket_count: 0,
    staged_dependency_review_count: 0
  };
  let phaseBReadinessArtifact = {
    artifact_type: "wordpress_phase_b_readiness_gate",
    artifact_version: "v1",
    phase_b_enabled: false,
    phase_b_audit_only: true,
    phase_b_gate_status: "blocked",
    phase_b_graph_stable: false,
    phase_b_readiness_status: "not_evaluated",
    blocking_reasons: ["phase_b_graph_not_evaluated"],
    unresolved_reference_count: 0,
    high_risk_asset_count: 0,
    blocked_bucket_count: 0,
    staged_dependency_review_count: 0,
    dependency_graph_edge_count: 0,
    dependency_graph_unresolved_count: 0,
    family_summary: []
  };
  let phaseBPlanningCandidates = {
    planning_status: "blocked",
    candidate_count: 0,
    blocked_count: 0,
    planning_candidates: [],
    blocked_candidates: [],
    blocking_reasons: ["phase_b_planning_not_evaluated"]
  };
  let phaseBPlanningArtifact = {
    artifact_type: "wordpress_phase_b_planning_candidates",
    artifact_version: "v1",
    planning_status: "blocked",
    phase_b_graph_stable: false,
    candidate_count: 0,
    blocked_count: 0,
    blocking_reasons: ["phase_b_planning_not_evaluated"],
    planning_candidates: [],
    blocked_candidates: []
  };
  let phaseBSequencePlanner = {
    sequence_status: "blocked",
    total_sequence_count: 0,
    family_sequence_summary: [],
    migration_sequence: [],
    blocking_reasons: ["phase_b_sequence_not_evaluated"]
  };
  let phaseBSequenceArtifact = {
    artifact_type: "wordpress_phase_b_sequence_plan",
    artifact_version: "v1",
    sequence_status: "blocked",
    total_sequence_count: 0,
    family_sequence_summary: [],
    migration_sequence: [],
    blocking_reasons: ["phase_b_sequence_not_evaluated"]
  };
  let phaseBMappingPrerequisiteGate = {
    mapping_gate_status: "blocked",
    mapping_gate_ready: false,
    mapping_ready_count: 0,
    mapping_review_required_count: 0,
    compatibility_review_required_count: 0,
    blocked_count: 0,
    blocking_reasons: ["phase_b_mapping_prerequisites_not_evaluated"],
    mapping_rows: []
  };
  let phaseBMappingPrerequisiteArtifact = {
    artifact_type: "wordpress_phase_b_mapping_prerequisite_gate",
    artifact_version: "v1",
    mapping_gate_status: "blocked",
    mapping_gate_ready: false,
    mapping_ready_count: 0,
    mapping_review_required_count: 0,
    compatibility_review_required_count: 0,
    blocked_count: 0,
    blocking_reasons: ["phase_b_mapping_prerequisites_not_evaluated"],
    mapping_rows: []
  };
  let phaseBMappingPlanSkeleton = {
    mapping_plan_status: "blocked",
    family_mapping_plans: [],
    asset_mapping_rows: [],
    blocking_reasons: ["phase_b_mapping_plan_not_evaluated"]
  };
  let phaseBMappingPlanArtifact = {
    artifact_type: "wordpress_phase_b_mapping_plan_skeleton",
    artifact_version: "v1",
    mapping_plan_status: "blocked",
    family_mapping_plans: [],
    asset_mapping_rows: [],
    blocking_reasons: ["phase_b_mapping_plan_not_evaluated"]
  };
  let phaseBFieldMappingResolver = {
    field_mapping_status: "blocked",
    resolved_mapping_rows: [],
    family_mapping_summary: [],
    blocking_reasons: ["phase_b_field_mapping_not_evaluated"]
  };
  let phaseBFieldMappingArtifact = {
    artifact_type: "wordpress_phase_b_field_mapping_plan",
    artifact_version: "v1",
    field_mapping_status: "blocked",
    resolved_mapping_rows: [],
    family_mapping_summary: [],
    blocking_reasons: ["phase_b_field_mapping_not_evaluated"]
  };
  let phaseBDryRunPlanner = {
    dry_run_status: "blocked",
    payload_count: 0,
    dry_run_payload_rows: [],
    family_payload_summary: [],
    blocking_reasons: ["phase_b_dry_run_not_evaluated"]
  };
  let phaseBDryRunArtifact = {
    artifact_type: "wordpress_phase_b_dry_run_payload_plan",
    artifact_version: "v1",
    dry_run_status: "blocked",
    payload_count: 0,
    family_payload_summary: [],
    dry_run_payload_rows: [],
    blocking_reasons: ["phase_b_dry_run_not_evaluated"]
  };
  let phaseBExecutionPlan = {
    enabled: false,
    apply: false,
    dry_run_only: true,
    candidate_limit: 50,
    allow_review_required_rows: false
  };
  let phaseBExecutionGuard = {
    execution_guard_status: "blocked_before_builder_mutation_execution",
    execution_guard_ready: false,
    blocking_reasons: ["phase_b_execution_guard_not_evaluated"],
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 50
  };
  let phaseBExecutionGuardArtifact = {
    artifact_type: "wordpress_phase_b_execution_guard",
    artifact_version: "v1",
    execution_guard_status: "blocked_before_builder_mutation_execution",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 50,
    blocking_reasons: ["phase_b_execution_guard_not_evaluated"]
  };
  let phaseBMutationCandidateSelector = {
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_b_mutation_candidates_not_evaluated"]
  };
  let phaseBMutationCandidateArtifact = {
    artifact_type: "wordpress_phase_b_mutation_candidates",
    artifact_version: "v1",
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_b_mutation_candidates_not_evaluated"]
  };
  let phaseBMutationPayloadComposer = {
    composer_status: "blocked",
    payload_count: 0,
    composed_payloads: [],
    blocking_reasons: ["phase_b_mutation_payloads_not_evaluated"]
  };
  let phaseBMutationPayloadArtifact = {
    artifact_type: "wordpress_phase_b_mutation_payloads",
    artifact_version: "v1",
    composer_status: "blocked",
    payload_count: 0,
    composed_payloads: [],
    blocking_reasons: ["phase_b_mutation_payloads_not_evaluated"]
  };
  let phaseBDryRunExecutionSimulator = {
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_rows: [],
    mutation_evidence_preview_summary: {
      total_rows: 0,
      expected_draft_count: 0,
      total_required_meta_keys: 0,
      total_optional_meta_keys: 0
    },
    blocking_reasons: ["phase_b_dry_run_execution_not_evaluated"]
  };
  let phaseBDryRunExecutionArtifact = {
    artifact_type: "wordpress_phase_b_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_rows: [],
    mutation_evidence_preview_summary: {
      total_rows: 0,
      expected_draft_count: 0,
      total_required_meta_keys: 0,
      total_optional_meta_keys: 0
    },
    blocking_reasons: ["phase_b_dry_run_execution_not_evaluated"]
  };
  let phaseBFinalOperatorHandoffBundle = {
    artifact_type: "wordpress_phase_b_final_operator_handoff",
    artifact_version: "v1",
    phase_b_enabled: false,
    phase_b_audit_only: true,
    phase_b_apply_requested: false,
    requested_builder_post_types: [],
    phase_b_gate_status: "blocked",
    phase_b_readiness_status: "not_evaluated",
    phase_b_graph_stable: false,
    phase_b_planning_status: "blocked",
    phase_b_sequence_status: "blocked",
    phase_b_mapping_gate_status: "blocked",
    phase_b_mapping_plan_status: "blocked",
    phase_b_field_mapping_status: "blocked",
    phase_b_dry_run_status: "blocked",
    phase_b_execution_guard_status: "blocked_before_builder_mutation_execution",
    phase_b_mutation_selector_status: "blocked",
    phase_b_mutation_payload_status: "blocked",
    phase_b_dry_run_execution_status: "blocked",
    inventory_totals: {
      total_count: 0,
      low_risk_count: 0,
      medium_risk_count: 0,
      high_risk_count: 0
    },
    graph_summary: {
      edge_count: 0,
      unresolved_count: 0,
      relation_counts: {},
      unresolved_relation_counts: {}
    },
    family_summary: [],
    planning_candidate_count: 0,
    planning_blocked_count: 0,
    mapping_ready_count: 0,
    mapping_review_required_count: 0,
    compatibility_review_required_count: 0,
    blocked_mapping_count: 0,
    mutation_candidate_count: 0,
    mutation_rejected_count: 0,
    composed_payload_count: 0,
    dry_run_simulated_count: 0,
    blocking_reasons: ["phase_b_final_handoff_not_evaluated"],
    operator_actions: [
      "resolve_builder_graph_instability",
      "resolve_mapping_prerequisites",
      "hold_builder_mutation_execution",
      "no_dry_run_preview_available"
    ],
    readiness_artifact: {},
    planning_artifact: {},
    sequence_artifact: {},
    mapping_prerequisite_artifact: {},
    mapping_plan_artifact: {},
    field_mapping_artifact: {},
    dry_run_artifact: {},
    execution_guard_artifact: {},
    mutation_candidate_artifact: {},
    mutation_payload_artifact: {},
    dry_run_execution_artifact: {}
  };
  let phaseCPlan = {
    enabled: false,
    reconciliation_only: true,
    apply: false,
    include_keys: []
  };
  let phaseCPlanStatus = {
    phase_c_status: "blocked",
    phase_c_ready: false,
    blocking_reasons: ["phase_c_not_evaluated"]
  };
  let phaseCGate = {
    phase_c_gate_status: "blocked",
    phase_c_gate_ready: false,
    reconciliation_only: true,
    blocking_reasons: ["phase_c_gate_not_evaluated"]
  };
  let phaseCSettingsInventory = {
    phase_c_inventory_status: "blocked",
    inventory_rows: [],
    summary: {
      total_count: 0,
      aligned_count: 0,
      diff_count: 0
    },
    failures: []
  };
  let phaseCInventoryArtifact = {
    artifact_type: "wordpress_phase_c_settings_inventory",
    artifact_version: "v1",
    phase_c_gate_status: "blocked",
    phase_c_inventory_status: "blocked",
    reconciliation_only: true,
    summary: {
      total_count: 0,
      aligned_count: 0,
      diff_count: 0
    },
    inventory_rows: [],
    blocking_reasons: ["phase_c_not_evaluated"],
    failures: []
  };
  let phaseCNormalizedDiff = {
    normalized_diff_rows: [],
    diff_summary: {
      total_count: 0,
      aligned_count: 0,
      diff_count: 0,
      already_aligned_count: 0,
      safe_reconcile_candidate_count: 0,
      environment_sensitive_review_count: 0,
      structured_settings_review_count: 0,
      review_required_count: 0
    },
    reconciliation_buckets: {
      already_aligned: [],
      safe_reconcile_candidate: [],
      environment_sensitive_review: [],
      structured_settings_review: [],
      review_required: []
    }
  };
  let phaseCDiffArtifact = {
    artifact_type: "wordpress_phase_c_settings_diff",
    artifact_version: "v1",
    phase_c_gate_status: "blocked",
    reconciliation_only: true,
    diff_summary: {
      total_count: 0,
      aligned_count: 0,
      diff_count: 0,
      already_aligned_count: 0,
      safe_reconcile_candidate_count: 0,
      environment_sensitive_review_count: 0,
      structured_settings_review_count: 0,
      review_required_count: 0
    },
    normalized_diff_rows: [],
    reconciliation_buckets: {
      already_aligned: [],
      safe_reconcile_candidate: [],
      environment_sensitive_review: [],
      structured_settings_review: [],
      review_required: []
    },
    blocking_reasons: ["phase_c_diff_not_evaluated"]
  };
  let phaseCReconciliationReadiness = {
    reconciliation_readiness_status: "blocked_for_reconciliation",
    reconciliation_ready: false,
    safe_candidate_count: 0,
    environment_sensitive_count: 0,
    structured_review_count: 0,
    review_required_count: 0,
    total_diff_count: 0,
    blocking_reasons: ["phase_c_reconciliation_not_evaluated"]
  };
  let phaseCSafeApplyCandidates = {
    safe_apply_status: "blocked",
    candidate_count: 0,
    candidates: [],
    blocking_reasons: ["phase_c_safe_apply_not_evaluated"]
  };
  let phaseCReadinessArtifact = {
    artifact_type: "wordpress_phase_c_reconciliation_readiness",
    artifact_version: "v1",
    reconciliation_readiness_status: "blocked_for_reconciliation",
    reconciliation_ready: false,
    safe_candidate_count: 0,
    environment_sensitive_count: 0,
    structured_review_count: 0,
    review_required_count: 0,
    total_diff_count: 0,
    safe_apply_status: "blocked",
    safe_apply_candidate_count: 0,
    candidates: [],
    blocking_reasons: ["phase_c_reconciliation_not_evaluated"]
  };
  let phaseCReconciliationPayloadPlanner = {
    payload_planner_status: "blocked",
    payload_count: 0,
    payload_rows: [],
    blocking_reasons: ["phase_c_payload_planner_not_evaluated"]
  };
  let phaseCReconciliationPayloadArtifact = {
    artifact_type: "wordpress_phase_c_reconciliation_payloads",
    artifact_version: "v1",
    payload_planner_status: "blocked",
    payload_count: 0,
    payload_rows: [],
    blocking_reasons: ["phase_c_payload_planner_not_evaluated"]
  };
  let phaseCExecutionPlan = {
    enabled: false,
    apply: false,
    dry_run_only: true,
    candidate_limit: 25
  };
  let phaseCExecutionGuard = {
    execution_guard_status: "blocked_before_settings_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 25,
    blocking_reasons: ["phase_c_execution_guard_not_evaluated"]
  };
  let phaseCExecutionGuardArtifact = {
    artifact_type: "wordpress_phase_c_execution_guard",
    artifact_version: "v1",
    execution_guard_status: "blocked_before_settings_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 25,
    blocking_reasons: ["phase_c_execution_guard_not_evaluated"]
  };
  let phaseCMutationCandidateSelector = {
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_c_mutation_candidates_not_evaluated"]
  };
  let phaseCMutationCandidateArtifact = {
    artifact_type: "wordpress_phase_c_mutation_candidates",
    artifact_version: "v1",
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_c_mutation_candidates_not_evaluated"]
  };
  let phaseCMutationPayloadComposer = {
    composer_status: "blocked",
    payload_count: 0,
    composed_payloads: [],
    blocking_reasons: ["phase_c_mutation_payloads_not_evaluated"]
  };
  let phaseCMutationPayloadArtifact = {
    artifact_type: "wordpress_phase_c_mutation_payloads",
    artifact_version: "v1",
    composer_status: "blocked",
    payload_count: 0,
    composed_payloads: [],
    blocking_reasons: ["phase_c_mutation_payloads_not_evaluated"]
  };
  let phaseCDryRunExecutionSimulator = {
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_rows: [],
    reconciliation_evidence_preview_summary: {
      total_rows: 0,
      safe_reconcile_count: 0,
      expected_apply_key_count: 0
    },
    blocking_reasons: ["phase_c_dry_run_execution_not_evaluated"]
  };
  let phaseCDryRunExecutionArtifact = {
    artifact_type: "wordpress_phase_c_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_rows: [],
    reconciliation_evidence_preview_summary: {
      total_rows: 0,
      safe_reconcile_count: 0,
      expected_apply_key_count: 0
    },
    blocking_reasons: ["phase_c_dry_run_execution_not_evaluated"]
  };
  let phaseCFinalOperatorHandoffBundle = {
    artifact_type: "wordpress_phase_c_final_operator_handoff",
    artifact_version: "v1",
    phase_c_enabled: false,
    phase_c_reconciliation_only: true,
    phase_c_apply_requested: false,
    requested_settings_keys: [],
    phase_c_gate_status: "blocked",
    phase_c_inventory_status: "blocked",
    phase_c_diff_status: "blocked",
    phase_c_reconciliation_readiness_status: "blocked_for_reconciliation",
    phase_c_safe_apply_status: "blocked",
    phase_c_payload_planner_status: "blocked",
    phase_c_execution_guard_status: "blocked_before_settings_mutation",
    phase_c_mutation_selector_status: "blocked",
    phase_c_mutation_payload_status: "blocked",
    phase_c_dry_run_execution_status: "blocked",
    inventory_summary: {
      total_count: 0,
      aligned_count: 0,
      diff_count: 0
    },
    diff_summary: {
      total_count: 0,
      aligned_count: 0,
      diff_count: 0,
      already_aligned_count: 0,
      safe_reconcile_candidate_count: 0,
      environment_sensitive_review_count: 0,
      structured_settings_review_count: 0,
      review_required_count: 0
    },
    safe_candidate_count: 0,
    mutation_candidate_count: 0,
    mutation_rejected_count: 0,
    composed_payload_count: 0,
    dry_run_simulated_count: 0,
    blocking_reasons: ["phase_c_final_handoff_not_evaluated"],
    operator_actions: [
      "resolve_settings_reconciliation_blockers",
      "hold_settings_mutation_execution",
      "no_settings_dry_run_preview_available"
    ],
    inventory_artifact: {},
    diff_artifact: {},
    readiness_artifact: {},
    payload_artifact: {},
    execution_guard_artifact: {},
    mutation_candidate_artifact: {},
    mutation_payload_artifact: {},
    dry_run_execution_artifact: {}
  };
  let phaseDPlan = {
    enabled: false,
    inventory_only: true,
    apply: false,
    post_types: [],
    include_integrations: true,
    max_items_per_type: 250
  };
  let phaseDPlanStatus = {
    phase_d_status: "blocked",
    phase_d_ready: false,
    blocking_reasons: ["phase_d_not_evaluated"]
  };
  let phaseDGate = {
    phase_d_gate_status: "blocked",
    phase_d_gate_ready: false,
    inventory_only: true,
    blocking_reasons: ["phase_d_gate_not_evaluated"]
  };
  let phaseDFormsInventory = {
    phase_d_inventory_status: "blocked",
    inventory_rows: [],
    inventory_counts: [],
    failures: []
  };
  let phaseDInventoryArtifact = {
    artifact_type: "wordpress_phase_d_forms_integrations_inventory",
    artifact_version: "v1",
    phase_d_gate_status: "blocked",
    phase_d_inventory_status: "blocked",
    inventory_only: true,
    inventory_counts: [],
    inventory_rows: [],
    blocking_reasons: ["phase_d_not_evaluated"],
    failures: []
  };
  let phaseDNormalizedInventory = {
    normalized_inventory_rows: [],
    strategy_summary: {
      total_count: 0,
      simple_migrate_candidate_count: 0,
      reviewed_migrate_or_rebuild_count: 0,
      rebuild_required_count: 0
    },
    strategy_buckets: {
      simple_migrate_candidate: [],
      reviewed_migrate_or_rebuild: [],
      rebuild_required: []
    }
  };
  let phaseDNormalizedInventoryArtifact = {
    artifact_type: "wordpress_phase_d_forms_integrations_strategy",
    artifact_version: "v1",
    phase_d_gate_status: "blocked",
    strategy_summary: {
      total_count: 0,
      simple_migrate_candidate_count: 0,
      reviewed_migrate_or_rebuild_count: 0,
      rebuild_required_count: 0
    },
    normalized_inventory_rows: [],
    strategy_buckets: {
      simple_migrate_candidate: [],
      reviewed_migrate_or_rebuild: [],
      rebuild_required: []
    },
    blocking_reasons: ["phase_d_strategy_not_evaluated"]
  };
  let phaseDReadinessGate = {
    readiness_status: "blocked_for_forms_migration",
    readiness_ready: false,
    simple_migrate_candidate_count: 0,
    reviewed_migrate_or_rebuild_count: 0,
    rebuild_required_count: 0,
    safe_candidate_count: 0,
    blocking_reasons: ["phase_d_readiness_not_evaluated"]
  };
  let phaseDSafeCandidates = {
    safe_candidate_status: "blocked",
    candidate_count: 0,
    candidates: [],
    blocking_reasons: ["phase_d_safe_candidates_not_evaluated"]
  };
  let phaseDReadinessArtifact = {
    artifact_type: "wordpress_phase_d_readiness_gate",
    artifact_version: "v1",
    readiness_status: "blocked_for_forms_migration",
    readiness_ready: false,
    simple_migrate_candidate_count: 0,
    reviewed_migrate_or_rebuild_count: 0,
    rebuild_required_count: 0,
    safe_candidate_count: 0,
    safe_candidate_status: "blocked",
    candidates: [],
    blocking_reasons: ["phase_d_readiness_not_evaluated"]
  };
  let phaseDMigrationPayloadPlanner = {
    payload_planner_status: "blocked",
    payload_count: 0,
    payload_rows: [],
    blocking_reasons: ["phase_d_payload_planner_not_evaluated"]
  };
  let phaseDMigrationPayloadArtifact = {
    artifact_type: "wordpress_phase_d_migration_payloads",
    artifact_version: "v1",
    payload_planner_status: "blocked",
    payload_count: 0,
    payload_rows: [],
    blocking_reasons: ["phase_d_payload_planner_not_evaluated"]
  };
  let phaseDExecutionPlan = {
    enabled: false,
    apply: false,
    dry_run_only: true,
    candidate_limit: 25
  };
  let phaseDExecutionGuard = {
    execution_guard_status: "blocked_before_forms_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 25,
    blocking_reasons: ["phase_d_execution_guard_not_evaluated"]
  };
  let phaseDExecutionGuardArtifact = {
    artifact_type: "wordpress_phase_d_execution_guard",
    artifact_version: "v1",
    execution_guard_status: "blocked_before_forms_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 25,
    blocking_reasons: ["phase_d_execution_guard_not_evaluated"]
  };
  let phaseDMutationCandidateSelector = {
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_d_mutation_candidates_not_evaluated"]
  };
  let phaseDMutationCandidateArtifact = {
    artifact_type: "wordpress_phase_d_mutation_candidates",
    artifact_version: "v1",
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_d_mutation_candidates_not_evaluated"]
  };
  let phaseDMutationPayloadComposer = {
    composer_status: "blocked",
    payload_count: 0,
    composed_payloads: [],
    blocking_reasons: ["phase_d_mutation_payloads_not_evaluated"]
  };
  let phaseDMutationPayloadArtifact = {
    artifact_type: "wordpress_phase_d_mutation_payloads",
    artifact_version: "v1",
    composer_status: "blocked",
    payload_count: 0,
    composed_payloads: [],
    blocking_reasons: ["phase_d_mutation_payloads_not_evaluated"]
  };
  let phaseDDryRunExecutionSimulator = {
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_rows: [],
    integration_evidence_preview_summary: {
      total_rows: 0,
      expected_draft_count: 0,
      safe_form_migration_count: 0,
      smtp_rebind_required_count: 0,
      webhook_review_count: 0,
      recaptcha_review_count: 0
    },
    blocking_reasons: ["phase_d_dry_run_execution_not_evaluated"]
  };
  let phaseDDryRunExecutionArtifact = {
    artifact_type: "wordpress_phase_d_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_rows: [],
    integration_evidence_preview_summary: {
      total_rows: 0,
      expected_draft_count: 0,
      safe_form_migration_count: 0,
      smtp_rebind_required_count: 0,
      webhook_review_count: 0,
      recaptcha_review_count: 0
    },
    blocking_reasons: ["phase_d_dry_run_execution_not_evaluated"]
  };
  let phaseDFinalOperatorHandoffBundle = {
    artifact_type: "wordpress_phase_d_final_operator_handoff",
    artifact_version: "v1",
    phase_d_enabled: false,
    phase_d_inventory_only: true,
    phase_d_apply_requested: false,
    requested_form_post_types: [],
    phase_d_gate_status: "blocked",
    phase_d_inventory_status: "blocked",
    phase_d_strategy_status: "blocked",
    phase_d_readiness_status: "blocked_for_forms_migration",
    phase_d_safe_candidate_status: "blocked",
    phase_d_payload_planner_status: "blocked",
    phase_d_execution_guard_status: "blocked_before_forms_mutation",
    phase_d_mutation_selector_status: "blocked",
    phase_d_mutation_payload_status: "blocked",
    phase_d_dry_run_execution_status: "blocked",
    inventory_counts: [],
    strategy_summary: {
      total_count: 0,
      simple_migrate_candidate_count: 0,
      reviewed_migrate_or_rebuild_count: 0,
      rebuild_required_count: 0
    },
    safe_candidate_count: 0,
    mutation_candidate_count: 0,
    mutation_rejected_count: 0,
    composed_payload_count: 0,
    dry_run_simulated_count: 0,
    blocking_reasons: ["phase_d_final_handoff_not_evaluated"],
    operator_actions: [
      "resolve_forms_migration_blockers",
      "hold_forms_mutation_execution",
      "no_forms_dry_run_preview_available"
    ],
    inventory_artifact: {},
    normalized_inventory_artifact: {},
    readiness_artifact: {},
    migration_payload_artifact: {},
    execution_guard_artifact: {},
    mutation_candidate_artifact: {},
    mutation_payload_artifact: {},
    dry_run_execution_artifact: {}
  };
  let phaseEPlan = {
    enabled: false,
    inventory_only: true,
    apply: false,
    include_featured_media: true,
    include_inline_media: true,
    include_unattached: false,
    max_items: 1000
  };
  let phaseEPlanStatus = {
    phase_e_status: "blocked",
    phase_e_ready: false,
    blocking_reasons: ["phase_e_not_evaluated"]
  };
  let phaseEGate = {
    phase_e_gate_status: "blocked",
    phase_e_gate_ready: false,
    inventory_only: true,
    blocking_reasons: ["phase_e_gate_not_evaluated"]
  };
  let phaseEMediaInventory = {
    phase_e_inventory_status: "blocked",
    inventory_rows: [],
    summary: {
      total_count: 0,
      attached_count: 0,
      unattached_count: 0,
      inline_ref_count: 0
    },
    failures: []
  };
  let phaseEInventoryArtifact = {
    artifact_type: "wordpress_phase_e_media_inventory",
    artifact_version: "v1",
    phase_e_gate_status: "blocked",
    phase_e_inventory_status: "blocked",
    inventory_only: true,
    summary: {
      total_count: 0,
      attached_count: 0,
      unattached_count: 0,
      inline_ref_count: 0
    },
    inventory_rows: [],
    blocking_reasons: ["phase_e_not_evaluated"],
    failures: []
  };
  let phaseENormalizedInventory = {
    normalized_inventory_rows: [],
    strategy_summary: {
      total_count: 0,
      safe_attached_migrate_candidate_count: 0,
      reviewed_media_migrate_count: 0,
      rebuild_or_manual_rebind_required_count: 0,
      excluded_unattached_media_count: 0,
      image_count: 0,
      video_count: 0,
      audio_count: 0,
      document_count: 0,
      other_count: 0
    },
    strategy_buckets: {
      safe_attached_migrate_candidate: [],
      reviewed_media_migrate: [],
      rebuild_or_manual_rebind_required: [],
      excluded_unattached_media: []
    }
  };
  let phaseENormalizedInventoryArtifact = {
    artifact_type: "wordpress_phase_e_media_strategy",
    artifact_version: "v1",
    phase_e_gate_status: "blocked",
    strategy_summary: {
      total_count: 0,
      safe_attached_migrate_candidate_count: 0,
      reviewed_media_migrate_count: 0,
      rebuild_or_manual_rebind_required_count: 0,
      excluded_unattached_media_count: 0,
      image_count: 0,
      video_count: 0,
      audio_count: 0,
      document_count: 0,
      other_count: 0
    },
    normalized_inventory_rows: [],
    strategy_buckets: {
      safe_attached_migrate_candidate: [],
      reviewed_media_migrate: [],
      rebuild_or_manual_rebind_required: [],
      excluded_unattached_media: []
    },
    blocking_reasons: ["phase_e_strategy_not_evaluated"]
  };
  let phaseEReadinessGate = {
    readiness_status: "blocked_for_media_migration",
    readiness_ready: false,
    safe_attached_migrate_candidate_count: 0,
    reviewed_media_migrate_count: 0,
    rebuild_or_manual_rebind_required_count: 0,
    safe_candidate_count: 0,
    blocking_reasons: ["phase_e_readiness_not_evaluated"]
  };
  let phaseESafeCandidates = {
    safe_candidate_status: "blocked",
    candidate_count: 0,
    candidates: [],
    blocking_reasons: ["phase_e_safe_candidates_not_evaluated"]
  };
  let phaseEReadinessArtifact = {
    artifact_type: "wordpress_phase_e_readiness_gate",
    artifact_version: "v1",
    readiness_status: "blocked_for_media_migration",
    readiness_ready: false,
    safe_attached_migrate_candidate_count: 0,
    reviewed_media_migrate_count: 0,
    rebuild_or_manual_rebind_required_count: 0,
    safe_candidate_count: 0,
    safe_candidate_status: "blocked",
    candidates: [],
    blocking_reasons: ["phase_e_readiness_not_evaluated"]
  };
  let phaseEMigrationPayloadPlanner = {
    payload_planner_status: "blocked",
    payload_count: 0,
    payload_rows: [],
    blocking_reasons: ["phase_e_payload_planner_not_evaluated"]
  };
  let phaseEMigrationPayloadArtifact = {
    artifact_type: "wordpress_phase_e_migration_payloads",
    artifact_version: "v1",
    payload_planner_status: "blocked",
    payload_count: 0,
    payload_rows: [],
    blocking_reasons: ["phase_e_payload_planner_not_evaluated"]
  };
  let phaseEExecutionPlan = {
    enabled: false,
    apply: false,
    dry_run_only: true,
    candidate_limit: 100
  };
  let phaseEExecutionGuard = {
    execution_guard_status: "blocked_before_media_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 100,
    blocking_reasons: ["phase_e_execution_guard_not_evaluated"]
  };
  let phaseEExecutionGuardArtifact = {
    artifact_type: "wordpress_phase_e_execution_guard",
    artifact_version: "v1",
    execution_guard_status: "blocked_before_media_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 100,
    blocking_reasons: ["phase_e_execution_guard_not_evaluated"]
  };
  let phaseEMutationCandidateSelector = {
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_e_mutation_candidates_not_evaluated"]
  };
  let phaseEMutationCandidateArtifact = {
    artifact_type: "wordpress_phase_e_mutation_candidates",
    artifact_version: "v1",
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_e_mutation_candidates_not_evaluated"]
  };
  let phaseEMutationPayloadComposer = {
    composer_status: "blocked",
    payload_count: 0,
    composed_payloads: [],
    blocking_reasons: ["phase_e_mutation_payloads_not_evaluated"]
  };
  let phaseEMutationPayloadArtifact = {
    artifact_type: "wordpress_phase_e_mutation_payloads",
    artifact_version: "v1",
    composer_status: "blocked",
    payload_count: 0,
    composed_payloads: [],
    blocking_reasons: ["phase_e_mutation_payloads_not_evaluated"]
  };
  let phaseEDryRunExecutionSimulator = {
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_rows: [],
    attachment_evidence_preview_summary: {
      total_rows: 0,
      expected_inherit_count: 0,
      safe_media_migration_count: 0,
      source_transfer_count: 0,
      parent_rebind_count: 0,
      inline_rebind_count: 0
    },
    blocking_reasons: ["phase_e_dry_run_execution_not_evaluated"]
  };
  let phaseEDryRunExecutionArtifact = {
    artifact_type: "wordpress_phase_e_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_rows: [],
    attachment_evidence_preview_summary: {
      total_rows: 0,
      expected_inherit_count: 0,
      safe_media_migration_count: 0,
      source_transfer_count: 0,
      parent_rebind_count: 0,
      inline_rebind_count: 0
    },
    blocking_reasons: ["phase_e_dry_run_execution_not_evaluated"]
  };
  let phaseEFinalOperatorHandoffBundle = {
    artifact_type: "wordpress_phase_e_final_operator_handoff",
    artifact_version: "v1",
    phase_e_enabled: false,
    phase_e_inventory_only: true,
    phase_e_apply_requested: false,
    requested_media_scope: {
      include_featured_media: true,
      include_inline_media: true,
      include_unattached: false,
      max_items: 0
    },
    requested_media_config: {},
    phase_e_gate_status: "blocked",
    phase_e_inventory_status: "blocked",
    phase_e_strategy_status: "blocked",
    phase_e_readiness_status: "blocked_for_media_migration",
    phase_e_safe_candidate_status: "blocked",
    phase_e_payload_planner_status: "blocked",
    phase_e_execution_guard_status: "blocked_before_media_mutation",
    phase_e_mutation_selector_status: "blocked",
    phase_e_mutation_payload_status: "blocked",
    phase_e_dry_run_execution_status: "blocked",
    inventory_summary: {
      total_count: 0,
      attached_count: 0,
      unattached_count: 0,
      inline_ref_count: 0
    },
    strategy_summary: {
      total_count: 0,
      safe_attached_migrate_candidate_count: 0,
      reviewed_media_migrate_count: 0,
      rebuild_or_manual_rebind_required_count: 0,
      excluded_unattached_media_count: 0,
      image_count: 0,
      video_count: 0,
      audio_count: 0,
      document_count: 0,
      other_count: 0
    },
    safe_candidate_count: 0,
    mutation_candidate_count: 0,
    mutation_rejected_count: 0,
    composed_payload_count: 0,
    dry_run_simulated_count: 0,
    blocking_reasons: ["phase_e_final_handoff_not_evaluated"],
    operator_actions: [
      "resolve_media_migration_blockers",
      "hold_media_mutation_execution",
      "no_media_dry_run_preview_available"
    ],
    inventory_artifact: {},
    normalized_inventory_artifact: {},
    readiness_artifact: {},
    migration_payload_artifact: {},
    execution_guard_artifact: {},
    mutation_candidate_artifact: {},
    mutation_payload_artifact: {},
    dry_run_execution_artifact: {}
  };
  let phaseFPlan = {
    enabled: false,
    inventory_only: true,
    apply: false,
    include_users: true,
    include_roles: true,
    include_auth_surface: true,
    max_users: 500
  };
  let phaseFPlanStatus = {
    phase_f_status: "blocked",
    phase_f_ready: false,
    blocking_reasons: ["phase_f_not_evaluated"]
  };
  let phaseFGate = {
    phase_f_gate_status: "blocked",
    phase_f_gate_ready: false,
    inventory_only: true,
    blocking_reasons: ["phase_f_gate_not_evaluated"]
  };
  let phaseFUsersRolesAuthInventory = {
    phase_f_inventory_status: "blocked",
    user_rows: [],
    role_rows: [],
    auth_surface_rows: [],
    summary: {
      user_count: 0,
      privileged_user_count: 0,
      role_count: 0,
      privileged_role_count: 0,
      auth_surface_count: 0
    },
    failures: []
  };
  let phaseFInventoryArtifact = {
    artifact_type: "wordpress_phase_f_users_roles_auth_inventory",
    artifact_version: "v1",
    phase_f_gate_status: "blocked",
    phase_f_inventory_status: "blocked",
    inventory_only: true,
    summary: {
      user_count: 0,
      privileged_user_count: 0,
      role_count: 0,
      privileged_role_count: 0,
      auth_surface_count: 0
    },
    user_rows: [],
    role_rows: [],
    auth_surface_rows: [],
    blocking_reasons: ["phase_f_not_evaluated"],
    failures: []
  };
  let phaseFNormalizedInventory = {
    normalized_user_rows: [],
    normalized_role_rows: [],
    normalized_auth_surface_rows: [],
    risk_summary: {
      user_total_count: 0,
      user_high_risk_count: 0,
      user_medium_risk_count: 0,
      role_total_count: 0,
      role_high_risk_count: 0,
      role_medium_risk_count: 0,
      auth_surface_total_count: 0,
      auth_surface_high_risk_count: 0,
      auth_surface_medium_risk_count: 0
    }
  };
  let phaseFNormalizedInventoryArtifact = {
    artifact_type: "wordpress_phase_f_privilege_auth_strategy",
    artifact_version: "v1",
    phase_f_gate_status: "blocked",
    risk_summary: {
      user_total_count: 0,
      user_high_risk_count: 0,
      user_medium_risk_count: 0,
      role_total_count: 0,
      role_high_risk_count: 0,
      role_medium_risk_count: 0,
      auth_surface_total_count: 0,
      auth_surface_high_risk_count: 0,
      auth_surface_medium_risk_count: 0
    },
    normalized_user_rows: [],
    normalized_role_rows: [],
    normalized_auth_surface_rows: [],
    blocking_reasons: ["phase_f_strategy_not_evaluated"]
  };
  let phaseFReadinessGate = {
    readiness_status: "blocked_for_users_roles_auth_reconciliation",
    readiness_ready: false,
    user_high_risk_count: 0,
    role_high_risk_count: 0,
    auth_high_risk_count: 0,
    user_medium_risk_count: 0,
    role_medium_risk_count: 0,
    auth_medium_risk_count: 0,
    blocking_reasons: ["phase_f_readiness_not_evaluated"]
  };
  let phaseFSafeCandidates = {
    safe_candidate_status: "blocked",
    candidate_count: 0,
    user_candidates: [],
    role_candidates: [],
    auth_surface_candidates: [],
    blocking_reasons: ["phase_f_safe_candidates_not_evaluated"]
  };
  let phaseFReadinessArtifact = {
    artifact_type: "wordpress_phase_f_readiness_gate",
    artifact_version: "v1",
    readiness_status: "blocked_for_users_roles_auth_reconciliation",
    readiness_ready: false,
    user_high_risk_count: 0,
    role_high_risk_count: 0,
    auth_high_risk_count: 0,
    user_medium_risk_count: 0,
    role_medium_risk_count: 0,
    auth_medium_risk_count: 0,
    safe_candidate_status: "blocked",
    candidate_count: 0,
    user_candidates: [],
    role_candidates: [],
    auth_surface_candidates: [],
    blocking_reasons: ["phase_f_readiness_not_evaluated"]
  };
  let phaseFReconciliationPayloadPlanner = {
    payload_planner_status: "blocked",
    payload_count: 0,
    user_payload_rows: [],
    role_payload_rows: [],
    auth_surface_payload_rows: [],
    blocking_reasons: ["phase_f_payload_planner_not_evaluated"]
  };
  let phaseFReconciliationPayloadArtifact = {
    artifact_type: "wordpress_phase_f_reconciliation_payloads",
    artifact_version: "v1",
    payload_planner_status: "blocked",
    payload_count: 0,
    user_payload_rows: [],
    role_payload_rows: [],
    auth_surface_payload_rows: [],
    blocking_reasons: ["phase_f_payload_planner_not_evaluated"]
  };
  let phaseFExecutionPlan = {
    enabled: false,
    apply: false,
    dry_run_only: true,
    candidate_limit: 100
  };
  let phaseFExecutionGuard = {
    execution_guard_status: "blocked_before_users_roles_auth_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 100,
    blocking_reasons: ["phase_f_execution_guard_not_evaluated"]
  };
  let phaseFExecutionGuardArtifact = {
    artifact_type: "wordpress_phase_f_execution_guard",
    artifact_version: "v1",
    execution_guard_status: "blocked_before_users_roles_auth_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 100,
    blocking_reasons: ["phase_f_execution_guard_not_evaluated"]
  };
  let phaseFMutationCandidateSelector = {
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_user_candidates: [],
    selected_role_candidates: [],
    selected_auth_surface_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_f_mutation_candidates_not_evaluated"]
  };
  let phaseFMutationCandidateArtifact = {
    artifact_type: "wordpress_phase_f_mutation_candidates",
    artifact_version: "v1",
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_user_candidates: [],
    selected_role_candidates: [],
    selected_auth_surface_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_f_mutation_candidates_not_evaluated"]
  };
  let phaseFMutationPayloadComposer = {
    composer_status: "blocked",
    payload_count: 0,
    user_composed_payloads: [],
    role_composed_payloads: [],
    auth_surface_composed_payloads: [],
    blocking_reasons: ["phase_f_mutation_payloads_not_evaluated"]
  };
  let phaseFMutationPayloadArtifact = {
    artifact_type: "wordpress_phase_f_mutation_payloads",
    artifact_version: "v1",
    composer_status: "blocked",
    payload_count: 0,
    user_composed_payloads: [],
    role_composed_payloads: [],
    auth_surface_composed_payloads: [],
    blocking_reasons: ["phase_f_mutation_payloads_not_evaluated"]
  };
  let phaseFDryRunExecutionSimulator = {
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_user_rows: [],
    simulated_role_rows: [],
    simulated_auth_surface_rows: [],
    evidence_preview_summary: {
      total_rows: 0,
      user_rows: 0,
      role_rows: 0,
      auth_surface_rows: 0,
      review_before_apply_count: 0
    },
    blocking_reasons: ["phase_f_dry_run_execution_not_evaluated"]
  };
  let phaseFDryRunExecutionArtifact = {
    artifact_type: "wordpress_phase_f_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_user_rows: [],
    simulated_role_rows: [],
    simulated_auth_surface_rows: [],
    evidence_preview_summary: {
      total_rows: 0,
      user_rows: 0,
      role_rows: 0,
      auth_surface_rows: 0,
      review_before_apply_count: 0
    },
    blocking_reasons: ["phase_f_dry_run_execution_not_evaluated"]
  };
  let phaseFFinalOperatorHandoffBundle = {
    artifact_type: "wordpress_phase_f_final_operator_handoff",
    artifact_version: "v1",
    phase_f_enabled: false,
    phase_f_inventory_only: true,
    phase_f_apply_requested: false,
    requested_auth_scope: {
      include_users: true,
      include_roles: true,
      include_auth_surface: true,
      max_users: 0
    },
    requested_auth_config: {},
    phase_f_gate_status: "blocked",
    phase_f_inventory_status: "blocked",
    phase_f_strategy_status: "blocked",
    phase_f_readiness_status: "blocked_for_users_roles_auth_reconciliation",
    phase_f_safe_candidate_status: "blocked",
    phase_f_payload_planner_status: "blocked",
    phase_f_execution_guard_status: "blocked_before_users_roles_auth_mutation",
    phase_f_mutation_selector_status: "blocked",
    phase_f_mutation_payload_status: "blocked",
    phase_f_dry_run_execution_status: "blocked",
    inventory_summary: {
      user_count: 0,
      privileged_user_count: 0,
      role_count: 0,
      privileged_role_count: 0,
      auth_surface_count: 0
    },
    risk_summary: {
      user_total_count: 0,
      user_high_risk_count: 0,
      user_medium_risk_count: 0,
      role_total_count: 0,
      role_high_risk_count: 0,
      role_medium_risk_count: 0,
      auth_surface_total_count: 0,
      auth_surface_high_risk_count: 0,
      auth_surface_medium_risk_count: 0
    },
    safe_candidate_count: 0,
    mutation_candidate_count: 0,
    mutation_rejected_count: 0,
    composed_payload_count: 0,
    dry_run_simulated_count: 0,
    blocking_reasons: ["phase_f_final_handoff_not_evaluated"],
    operator_actions: [
      "resolve_users_roles_auth_blockers",
      "hold_users_roles_auth_mutation_execution",
      "no_users_roles_auth_dry_run_preview_available"
    ],
    inventory_artifact: {},
    normalized_inventory_artifact: {},
    readiness_artifact: {},
    reconciliation_payload_artifact: {},
    execution_guard_artifact: {},
    mutation_candidate_artifact: {},
    mutation_payload_artifact: {},
    dry_run_execution_artifact: {}
  };
  let phaseGPlan = {
    enabled: false,
    inventory_only: true,
    apply: false,
    include_redirects: true,
    include_metadata: true,
    include_taxonomy_seo: true,
    include_post_type_seo: true,
    max_items: 1000
  };
  let phaseGPlanStatus = {
    phase_g_status: "blocked",
    phase_g_ready: false,
    blocking_reasons: ["phase_g_not_evaluated"]
  };
  let phaseGGate = {
    phase_g_gate_status: "blocked",
    phase_g_gate_ready: false,
    inventory_only: true,
    blocking_reasons: ["phase_g_gate_not_evaluated"]
  };
  let phaseGSeoInventory = {
    phase_g_inventory_status: "blocked",
    plugin_signals: {},
    redirect_rows: [],
    metadata_rows: [],
    taxonomy_seo_rows: [],
    post_type_seo_rows: [],
    summary: {
      redirect_count: 0,
      metadata_count: 0,
      taxonomy_seo_count: 0,
      post_type_seo_count: 0
    },
    failures: []
  };
  let phaseGInventoryArtifact = {
    artifact_type: "wordpress_phase_g_seo_inventory",
    artifact_version: "v1",
    phase_g_gate_status: "blocked",
    phase_g_inventory_status: "blocked",
    inventory_only: true,
    plugin_signals: {},
    summary: {
      redirect_count: 0,
      metadata_count: 0,
      taxonomy_seo_count: 0,
      post_type_seo_count: 0
    },
    redirect_rows: [],
    metadata_rows: [],
    taxonomy_seo_rows: [],
    post_type_seo_rows: [],
    blocking_reasons: ["phase_g_not_evaluated"],
    failures: []
  };
  let phaseGNormalizedInventory = {
    normalized_redirect_rows: [],
    normalized_metadata_rows: [],
    normalized_taxonomy_seo_rows: [],
    normalized_post_type_seo_rows: [],
    risk_summary: {
      total_count: 0,
      low_risk_count: 0,
      medium_risk_count: 0,
      high_risk_count: 0,
      redirect_count: 0,
      metadata_count: 0,
      taxonomy_seo_count: 0,
      post_type_seo_count: 0
    }
  };
  let phaseGNormalizedInventoryArtifact = {
    artifact_type: "wordpress_phase_g_seo_strategy",
    artifact_version: "v1",
    phase_g_gate_status: "blocked",
    risk_summary: {
      total_count: 0,
      low_risk_count: 0,
      medium_risk_count: 0,
      high_risk_count: 0,
      redirect_count: 0,
      metadata_count: 0,
      taxonomy_seo_count: 0,
      post_type_seo_count: 0
    },
    normalized_redirect_rows: [],
    normalized_metadata_rows: [],
    normalized_taxonomy_seo_rows: [],
    normalized_post_type_seo_rows: [],
    blocking_reasons: ["phase_g_strategy_not_evaluated"]
  };
  let phaseGReadinessGate = {
    readiness_status: "blocked_for_seo_reconciliation",
    readiness_ready: false,
    high_risk_count: 0,
    medium_risk_count: 0,
    low_risk_count: 0,
    blocking_reasons: ["phase_g_readiness_not_evaluated"]
  };
  let phaseGSafeCandidates = {
    safe_candidate_status: "blocked",
    candidate_count: 0,
    redirect_candidates: [],
    metadata_candidates: [],
    taxonomy_seo_candidates: [],
    post_type_seo_candidates: [],
    blocking_reasons: ["phase_g_safe_candidates_not_evaluated"]
  };
  let phaseGReadinessArtifact = {
    artifact_type: "wordpress_phase_g_readiness_gate",
    artifact_version: "v1",
    readiness_status: "blocked_for_seo_reconciliation",
    readiness_ready: false,
    high_risk_count: 0,
    medium_risk_count: 0,
    low_risk_count: 0,
    safe_candidate_status: "blocked",
    candidate_count: 0,
    redirect_candidates: [],
    metadata_candidates: [],
    taxonomy_seo_candidates: [],
    post_type_seo_candidates: [],
    blocking_reasons: ["phase_g_readiness_not_evaluated"]
  };
  let phaseGReconciliationPayloadPlanner = {
    payload_planner_status: "blocked",
    payload_count: 0,
    redirect_payload_rows: [],
    metadata_payload_rows: [],
    taxonomy_seo_payload_rows: [],
    post_type_seo_payload_rows: [],
    blocking_reasons: ["phase_g_payload_planner_not_evaluated"]
  };
  let phaseGReconciliationPayloadArtifact = {
    artifact_type: "wordpress_phase_g_reconciliation_payloads",
    artifact_version: "v1",
    payload_planner_status: "blocked",
    payload_count: 0,
    redirect_payload_rows: [],
    metadata_payload_rows: [],
    taxonomy_seo_payload_rows: [],
    post_type_seo_payload_rows: [],
    blocking_reasons: ["phase_g_payload_planner_not_evaluated"]
  };
  let phaseGExecutionPlan = {
    enabled: false,
    apply: false,
    dry_run_only: true,
    candidate_limit: 200
  };
  let phaseGExecutionGuard = {
    execution_guard_status: "blocked_before_seo_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 200,
    blocking_reasons: ["phase_g_execution_guard_not_evaluated"]
  };
  let phaseGExecutionGuardArtifact = {
    artifact_type: "wordpress_phase_g_execution_guard",
    artifact_version: "v1",
    execution_guard_status: "blocked_before_seo_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 200,
    blocking_reasons: ["phase_g_execution_guard_not_evaluated"]
  };
  let phaseGMutationCandidateSelector = {
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_redirect_candidates: [],
    selected_metadata_candidates: [],
    selected_taxonomy_seo_candidates: [],
    selected_post_type_seo_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_g_mutation_candidates_not_evaluated"]
  };
  let phaseGMutationCandidateArtifact = {
    artifact_type: "wordpress_phase_g_mutation_candidates",
    artifact_version: "v1",
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_redirect_candidates: [],
    selected_metadata_candidates: [],
    selected_taxonomy_seo_candidates: [],
    selected_post_type_seo_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_g_mutation_candidates_not_evaluated"]
  };
  let phaseGMutationPayloadComposer = {
    composer_status: "blocked",
    payload_count: 0,
    redirect_composed_payloads: [],
    metadata_composed_payloads: [],
    taxonomy_seo_composed_payloads: [],
    post_type_seo_composed_payloads: [],
    blocking_reasons: ["phase_g_mutation_payloads_not_evaluated"]
  };
  let phaseGMutationPayloadArtifact = {
    artifact_type: "wordpress_phase_g_mutation_payloads",
    artifact_version: "v1",
    composer_status: "blocked",
    payload_count: 0,
    redirect_composed_payloads: [],
    metadata_composed_payloads: [],
    taxonomy_seo_composed_payloads: [],
    post_type_seo_composed_payloads: [],
    blocking_reasons: ["phase_g_mutation_payloads_not_evaluated"]
  };
  let phaseGDryRunExecutionSimulator = {
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_redirect_rows: [],
    simulated_metadata_rows: [],
    simulated_taxonomy_seo_rows: [],
    simulated_post_type_seo_rows: [],
    evidence_preview_summary: {
      total_rows: 0,
      redirect_rows: 0,
      metadata_rows: 0,
      taxonomy_seo_rows: 0,
      post_type_seo_rows: 0,
      preserve_from_source_count: 0
    },
    blocking_reasons: ["phase_g_dry_run_execution_not_evaluated"]
  };
  let phaseGDryRunExecutionArtifact = {
    artifact_type: "wordpress_phase_g_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_redirect_rows: [],
    simulated_metadata_rows: [],
    simulated_taxonomy_seo_rows: [],
    simulated_post_type_seo_rows: [],
    evidence_preview_summary: {
      total_rows: 0,
      redirect_rows: 0,
      metadata_rows: 0,
      taxonomy_seo_rows: 0,
      post_type_seo_rows: 0,
      preserve_from_source_count: 0
    },
    blocking_reasons: ["phase_g_dry_run_execution_not_evaluated"]
  };
  let phaseGFinalOperatorHandoffBundle = {
    artifact_type: "wordpress_phase_g_final_operator_handoff",
    artifact_version: "v1",
    phase_g_enabled: false,
    phase_g_inventory_only: true,
    phase_g_apply_requested: false,
    requested_seo_scope: {
      include_redirects: true,
      include_metadata: true,
      include_taxonomy_seo: true,
      include_post_type_seo: true,
      max_items: 0
    },
    requested_seo_config: {},
    phase_g_gate_status: "blocked",
    phase_g_inventory_status: "blocked",
    phase_g_strategy_status: "blocked",
    phase_g_readiness_status: "blocked_for_seo_reconciliation",
    phase_g_safe_candidate_status: "blocked",
    phase_g_payload_planner_status: "blocked",
    phase_g_execution_guard_status: "blocked_before_seo_mutation",
    phase_g_mutation_selector_status: "blocked",
    phase_g_mutation_payload_status: "blocked",
    phase_g_dry_run_execution_status: "blocked",
    inventory_summary: {
      redirect_count: 0,
      metadata_count: 0,
      taxonomy_seo_count: 0,
      post_type_seo_count: 0
    },
    plugin_signals: {},
    risk_summary: {
      total_count: 0,
      low_risk_count: 0,
      medium_risk_count: 0,
      high_risk_count: 0,
      redirect_count: 0,
      metadata_count: 0,
      taxonomy_seo_count: 0,
      post_type_seo_count: 0
    },
    safe_candidate_count: 0,
    mutation_candidate_count: 0,
    mutation_rejected_count: 0,
    composed_payload_count: 0,
    dry_run_simulated_count: 0,
    blocking_reasons: ["phase_g_final_handoff_not_evaluated"],
    operator_actions: [
      "resolve_seo_reconciliation_blockers",
      "hold_seo_mutation_execution",
      "no_seo_dry_run_preview_available"
    ],
    inventory_artifact: {},
    normalized_inventory_artifact: {},
    readiness_artifact: {},
    reconciliation_payload_artifact: {},
    execution_guard_artifact: {},
    mutation_candidate_artifact: {},
    mutation_payload_artifact: {},
    dry_run_execution_artifact: {}
  };
  let phaseHPlan = {
    enabled: false,
    inventory_only: true,
    apply: false,
    include_google_analytics: true,
    include_gtm: true,
    include_meta_pixel: true,
    include_tiktok_pixel: false,
    include_custom_tracking: true,
    max_items: 500
  };
  let phaseHPlanStatus = {
    phase_h_status: "blocked",
    phase_h_ready: false,
    blocking_reasons: ["phase_h_not_evaluated"]
  };
  let phaseHGate = {
    phase_h_gate_status: "blocked",
    phase_h_gate_ready: false,
    inventory_only: true,
    blocking_reasons: ["phase_h_gate_not_evaluated"]
  };
  let phaseHAnalyticsInventory = {
    phase_h_inventory_status: "blocked",
    plugin_signals: {},
    tracking_rows: [],
    consent_rows: [],
    summary: {
      tracking_count: 0,
      consent_count: 0
    },
    failures: []
  };
  let phaseHInventoryArtifact = {
    artifact_type: "wordpress_phase_h_analytics_tracking_inventory",
    artifact_version: "v1",
    phase_h_gate_status: "blocked",
    phase_h_inventory_status: "blocked",
    inventory_only: true,
    plugin_signals: {},
    summary: {
      tracking_count: 0,
      consent_count: 0
    },
    tracking_rows: [],
    consent_rows: [],
    blocking_reasons: ["phase_h_not_evaluated"],
    failures: []
  };
  let phaseHNormalizedInventory = {
    normalized_tracking_rows: [],
    normalized_consent_rows: [],
    risk_summary: {
      tracking_total_count: 0,
      tracking_high_risk_count: 0,
      tracking_medium_risk_count: 0,
      consent_total_count: 0,
      consent_high_risk_count: 0,
      consent_medium_risk_count: 0
    }
  };
  let phaseHNormalizedInventoryArtifact = {
    artifact_type: "wordpress_phase_h_analytics_tracking_strategy",
    artifact_version: "v1",
    phase_h_gate_status: "blocked",
    risk_summary: {
      tracking_total_count: 0,
      tracking_high_risk_count: 0,
      tracking_medium_risk_count: 0,
      consent_total_count: 0,
      consent_high_risk_count: 0,
      consent_medium_risk_count: 0
    },
    normalized_tracking_rows: [],
    normalized_consent_rows: [],
    blocking_reasons: ["phase_h_strategy_not_evaluated"]
  };
  let phaseHReadinessGate = {
    readiness_status: "blocked_for_analytics_tracking_reconciliation",
    readiness_ready: false,
    tracking_high_risk_count: 0,
    tracking_medium_risk_count: 0,
    consent_high_risk_count: 0,
    consent_medium_risk_count: 0,
    blocking_reasons: ["phase_h_readiness_not_evaluated"]
  };
  let phaseHSafeCandidates = {
    safe_candidate_status: "blocked",
    candidate_count: 0,
    tracking_candidates: [],
    consent_candidates: [],
    blocking_reasons: ["phase_h_safe_candidates_not_evaluated"]
  };
  let phaseHReadinessArtifact = {
    artifact_type: "wordpress_phase_h_readiness_gate",
    artifact_version: "v1",
    readiness_status: "blocked_for_analytics_tracking_reconciliation",
    readiness_ready: false,
    tracking_high_risk_count: 0,
    tracking_medium_risk_count: 0,
    consent_high_risk_count: 0,
    consent_medium_risk_count: 0,
    safe_candidate_status: "blocked",
    candidate_count: 0,
    tracking_candidates: [],
    consent_candidates: [],
    blocking_reasons: ["phase_h_readiness_not_evaluated"]
  };
  let phaseHReconciliationPayloadPlanner = {
    payload_planner_status: "blocked",
    payload_count: 0,
    tracking_payload_rows: [],
    consent_payload_rows: [],
    blocking_reasons: ["phase_h_payload_planner_not_evaluated"]
  };
  let phaseHReconciliationPayloadArtifact = {
    artifact_type: "wordpress_phase_h_reconciliation_payloads",
    artifact_version: "v1",
    payload_planner_status: "blocked",
    payload_count: 0,
    tracking_payload_rows: [],
    consent_payload_rows: [],
    blocking_reasons: ["phase_h_payload_planner_not_evaluated"]
  };
  let phaseHExecutionPlan = {
    enabled: false,
    apply: false,
    dry_run_only: true,
    candidate_limit: 200
  };
  let phaseHExecutionGuard = {
    execution_guard_status: "blocked_before_analytics_tracking_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 200,
    blocking_reasons: ["phase_h_execution_guard_not_evaluated"]
  };
  let phaseHExecutionGuardArtifact = {
    artifact_type: "wordpress_phase_h_execution_guard",
    artifact_version: "v1",
    execution_guard_status: "blocked_before_analytics_tracking_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 200,
    blocking_reasons: ["phase_h_execution_guard_not_evaluated"]
  };
  let phaseHMutationCandidateSelector = {
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_tracking_candidates: [],
    selected_consent_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_h_mutation_candidates_not_evaluated"]
  };
  let phaseHMutationCandidateArtifact = {
    artifact_type: "wordpress_phase_h_mutation_candidates",
    artifact_version: "v1",
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_tracking_candidates: [],
    selected_consent_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_h_mutation_candidates_not_evaluated"]
  };
  let phaseHMutationPayloadComposer = {
    composer_status: "blocked",
    payload_count: 0,
    tracking_composed_payloads: [],
    consent_composed_payloads: [],
    blocking_reasons: ["phase_h_mutation_payloads_not_evaluated"]
  };
  let phaseHMutationPayloadArtifact = {
    artifact_type: "wordpress_phase_h_mutation_payloads",
    artifact_version: "v1",
    composer_status: "blocked",
    payload_count: 0,
    tracking_composed_payloads: [],
    consent_composed_payloads: [],
    blocking_reasons: ["phase_h_mutation_payloads_not_evaluated"]
  };

  let phaseHDryRunExecutionSimulator = {
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_tracking_rows: [],
    simulated_consent_rows: [],
    evidence_preview_summary: {
      total_rows: 0,
      tracking_rows: 0,
      consent_rows: 0,
      preserve_from_source_count: 0,
      consent_required_true_count: 0,
      blocks_before_consent_true_count: 0
    },
    blocking_reasons: ["phase_h_dry_run_execution_not_evaluated"]
  };

  let phaseHDryRunExecutionArtifact = {
    artifact_type: "wordpress_phase_h_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_tracking_rows: [],
    simulated_consent_rows: [],
    evidence_preview_summary: {
      total_rows: 0,
      tracking_rows: 0,
      consent_rows: 0,
      preserve_from_source_count: 0,
      consent_required_true_count: 0,
      blocks_before_consent_true_count: 0
    },
    blocking_reasons: ["phase_h_dry_run_execution_not_evaluated"]
  };

  let phaseHFinalOperatorHandoffBundle = {
    artifact_type: "wordpress_phase_h_final_operator_handoff",
    artifact_version: "v1",
    phase_h_enabled: false,
    phase_h_inventory_only: true,
    phase_h_apply_requested: false,
    requested_tracking_scope: {
      include_google_analytics: true,
      include_gtm: true,
      include_meta_pixel: true,
      include_tiktok_pixel: false,
      include_custom_tracking: true,
      max_items: 0
    },
    requested_tracking_config: {},
    phase_h_gate_status: "blocked",
    phase_h_inventory_status: "blocked",
    phase_h_strategy_status: "blocked",
    phase_h_readiness_status: "blocked_for_analytics_tracking_reconciliation",
    phase_h_safe_candidate_status: "blocked",
    phase_h_payload_planner_status: "blocked",
    phase_h_execution_guard_status: "blocked_before_analytics_tracking_mutation",
    phase_h_mutation_selector_status: "blocked",
    phase_h_mutation_payload_status: "blocked",
    phase_h_dry_run_execution_status: "blocked",
    inventory_summary: {
      tracking_count: 0,
      consent_count: 0
    },
    plugin_signals: {},
    risk_summary: {
      tracking_total_count: 0,
      tracking_high_risk_count: 0,
      tracking_medium_risk_count: 0,
      consent_total_count: 0,
      consent_high_risk_count: 0,
      consent_medium_risk_count: 0
    },
    safe_candidate_count: 0,
    mutation_candidate_count: 0,
    mutation_rejected_count: 0,
    composed_payload_count: 0,
    dry_run_simulated_count: 0,
    blocking_reasons: ["phase_h_final_handoff_not_evaluated"],
    operator_actions: [
      "resolve_analytics_tracking_reconciliation_blockers",
      "hold_analytics_tracking_mutation_execution",
      "no_analytics_tracking_dry_run_preview_available"
    ],
    inventory_artifact: {},
    normalized_inventory_artifact: {},
    readiness_artifact: {},
    reconciliation_payload_artifact: {},
    execution_guard_artifact: {},
    mutation_candidate_artifact: {},
    mutation_payload_artifact: {},
    dry_run_execution_artifact: {}
  };

  let phaseIPlan = {
    enabled: false,
    inventory_only: true,
    apply: false,
    include_cache_layers: true,
    include_asset_optimization: true,
    include_image_optimization: true,
    include_cdn: true,
    include_lazyload: true,
    max_items: 500
  };

  let phaseIPlanStatus = {
    phase_i_status: "blocked",
    phase_i_ready: false,
    blocking_reasons: ["phase_i_not_evaluated"]
  };

  let phaseIGate = {
    phase_i_gate_status: "blocked",
    phase_i_gate_ready: false,
    inventory_only: true,
    blocking_reasons: ["phase_i_gate_not_evaluated"]
  };

  let phaseIPerformanceInventory = {
    phase_i_inventory_status: "blocked",
    plugin_signals: {},
    cache_layer_rows: [],
    asset_optimization_rows: [],
    image_optimization_rows: [],
    cdn_rows: [],
    lazyload_rows: [],
    summary: {
      cache_layer_count: 0,
      asset_optimization_count: 0,
      image_optimization_count: 0,
      cdn_count: 0,
      lazyload_count: 0
    },
    failures: []
  };

  let phaseIInventoryArtifact = {
    artifact_type: "wordpress_phase_i_performance_inventory",
    artifact_version: "v1",
    phase_i_gate_status: "blocked",
    phase_i_inventory_status: "blocked",
    inventory_only: true,
    plugin_signals: {},
    summary: {
      cache_layer_count: 0,
      asset_optimization_count: 0,
      image_optimization_count: 0,
      cdn_count: 0,
      lazyload_count: 0
    },
    cache_layer_rows: [],
    asset_optimization_rows: [],
    image_optimization_rows: [],
    cdn_rows: [],
    lazyload_rows: [],
    blocking_reasons: ["phase_i_not_evaluated"],
    failures: []
  };

  let phaseINormalizedInventory = {
    normalized_cache_layer_rows: [],
    normalized_asset_optimization_rows: [],
    normalized_image_optimization_rows: [],
    normalized_cdn_rows: [],
    normalized_lazyload_rows: [],
    risk_summary: {
      total_count: 0,
      low_risk_count: 0,
      medium_risk_count: 0,
      high_risk_count: 0,
      cache_layer_count: 0,
      asset_optimization_count: 0,
      image_optimization_count: 0,
      cdn_count: 0,
      lazyload_count: 0
    }
  };

  let phaseINormalizedInventoryArtifact = {
    artifact_type: "wordpress_phase_i_performance_strategy",
    artifact_version: "v1",
    phase_i_gate_status: "blocked",
    risk_summary: {
      total_count: 0,
      low_risk_count: 0,
      medium_risk_count: 0,
      high_risk_count: 0,
      cache_layer_count: 0,
      asset_optimization_count: 0,
      image_optimization_count: 0,
      cdn_count: 0,
      lazyload_count: 0
    },
    normalized_cache_layer_rows: [],
    normalized_asset_optimization_rows: [],
    normalized_image_optimization_rows: [],
    normalized_cdn_rows: [],
    normalized_lazyload_rows: [],
    blocking_reasons: ["phase_i_strategy_not_evaluated"]
  };

  let phaseIReadinessGate = {
    readiness_status: "blocked_for_performance_reconciliation",
    readiness_ready: false,
    high_risk_count: 0,
    medium_risk_count: 0,
    low_risk_count: 0,
    blocking_reasons: ["phase_i_readiness_not_evaluated"]
  };

  let phaseISafeCandidates = {
    safe_candidate_status: "blocked",
    candidate_count: 0,
    cache_layer_candidates: [],
    asset_optimization_candidates: [],
    image_optimization_candidates: [],
    cdn_candidates: [],
    lazyload_candidates: [],
    blocking_reasons: ["phase_i_safe_candidates_not_evaluated"]
  };

  let phaseIReadinessArtifact = {
    artifact_type: "wordpress_phase_i_readiness_gate",
    artifact_version: "v1",
    readiness_status: "blocked_for_performance_reconciliation",
    readiness_ready: false,
    high_risk_count: 0,
    medium_risk_count: 0,
    low_risk_count: 0,
    safe_candidate_status: "blocked",
    candidate_count: 0,
    cache_layer_candidates: [],
    asset_optimization_candidates: [],
    image_optimization_candidates: [],
    cdn_candidates: [],
    lazyload_candidates: [],
    blocking_reasons: ["phase_i_readiness_not_evaluated"]
  };

  let phaseIReconciliationPayloadPlanner = {
    payload_planner_status: "blocked",
    payload_count: 0,
    cache_layer_payload_rows: [],
    asset_optimization_payload_rows: [],
    image_optimization_payload_rows: [],
    cdn_payload_rows: [],
    lazyload_payload_rows: [],
    blocking_reasons: ["phase_i_payload_planner_not_evaluated"]
  };

  let phaseIReconciliationPayloadArtifact = {
    artifact_type: "wordpress_phase_i_reconciliation_payloads",
    artifact_version: "v1",
    payload_planner_status: "blocked",
    payload_count: 0,
    cache_layer_payload_rows: [],
    asset_optimization_payload_rows: [],
    image_optimization_payload_rows: [],
    cdn_payload_rows: [],
    lazyload_payload_rows: [],
    blocking_reasons: ["phase_i_payload_planner_not_evaluated"]
  };

  let phaseIExecutionPlan = {
    enabled: false,
    apply: false,
    dry_run_only: true,
    candidate_limit: 200
  };

  let phaseIExecutionGuard = {
    execution_guard_status: "blocked_before_performance_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 200,
    blocking_reasons: ["phase_i_execution_guard_not_evaluated"]
  };

  let phaseIExecutionGuardArtifact = {
    artifact_type: "wordpress_phase_i_execution_guard",
    artifact_version: "v1",
    execution_guard_status: "blocked_before_performance_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 200,
    blocking_reasons: ["phase_i_execution_guard_not_evaluated"]
  };

  let phaseIMutationCandidateSelector = {
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_cache_layer_candidates: [],
    selected_asset_optimization_candidates: [],
    selected_image_optimization_candidates: [],
    selected_cdn_candidates: [],
    selected_lazyload_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_i_mutation_candidates_not_evaluated"]
  };

  let phaseIMutationCandidateArtifact = {
    artifact_type: "wordpress_phase_i_mutation_candidates",
    artifact_version: "v1",
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_cache_layer_candidates: [],
    selected_asset_optimization_candidates: [],
    selected_image_optimization_candidates: [],
    selected_cdn_candidates: [],
    selected_lazyload_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_i_mutation_candidates_not_evaluated"]
  };

  let phaseIMutationPayloadComposer = {
    composer_status: "blocked",
    payload_count: 0,
    cache_layer_composed_payloads: [],
    asset_optimization_composed_payloads: [],
    image_optimization_composed_payloads: [],
    cdn_composed_payloads: [],
    lazyload_composed_payloads: [],
    blocking_reasons: ["phase_i_mutation_payloads_not_evaluated"]
  };

  let phaseIMutationPayloadArtifact = {
    artifact_type: "wordpress_phase_i_mutation_payloads",
    artifact_version: "v1",
    composer_status: "blocked",
    payload_count: 0,
    cache_layer_composed_payloads: [],
    asset_optimization_composed_payloads: [],
    image_optimization_composed_payloads: [],
    cdn_composed_payloads: [],
    lazyload_composed_payloads: [],
    blocking_reasons: ["phase_i_mutation_payloads_not_evaluated"]
  };

  let phaseIDryRunExecutionSimulator = {
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_cache_layer_rows: [],
    simulated_asset_optimization_rows: [],
    simulated_image_optimization_rows: [],
    simulated_cdn_rows: [],
    simulated_lazyload_rows: [],
    evidence_preview_summary: {
      total_rows: 0,
      cache_layer_rows: 0,
      asset_optimization_rows: 0,
      image_optimization_rows: 0,
      cdn_rows: 0,
      lazyload_rows: 0,
      preserve_from_source_count: 0,
      enabled_true_count: 0
    },
    blocking_reasons: ["phase_i_dry_run_execution_not_evaluated"]
  };

  let phaseIDryRunExecutionArtifact = {
    artifact_type: "wordpress_phase_i_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_cache_layer_rows: [],
    simulated_asset_optimization_rows: [],
    simulated_image_optimization_rows: [],
    simulated_cdn_rows: [],
    simulated_lazyload_rows: [],
    evidence_preview_summary: {
      total_rows: 0,
      cache_layer_rows: 0,
      asset_optimization_rows: 0,
      image_optimization_rows: 0,
      cdn_rows: 0,
      lazyload_rows: 0,
      preserve_from_source_count: 0,
      enabled_true_count: 0
    },
    blocking_reasons: ["phase_i_dry_run_execution_not_evaluated"]
  };

  let phaseIFinalOperatorHandoffBundle = {
    artifact_type: "wordpress_phase_i_final_operator_handoff",
    artifact_version: "v1",
    phase_i_enabled: false,
    phase_i_inventory_only: true,
    phase_i_apply_requested: false,
    requested_performance_scope: {
      include_cache_layers: true,
      include_asset_optimization: true,
      include_image_optimization: true,
      include_cdn: true,
      include_lazyload: true,
      max_items: 0
    },
    requested_performance_config: {},
    phase_i_gate_status: "blocked",
    phase_i_inventory_status: "blocked",
    phase_i_strategy_status: "blocked",
    phase_i_readiness_status: "blocked_for_performance_reconciliation",
    phase_i_safe_candidate_status: "blocked",
    phase_i_payload_planner_status: "blocked",
    phase_i_execution_guard_status: "blocked_before_performance_mutation",
    phase_i_mutation_selector_status: "blocked",
    phase_i_mutation_payload_status: "blocked",
    phase_i_dry_run_execution_status: "blocked",
    inventory_summary: {
      cache_layer_count: 0,
      asset_optimization_count: 0,
      image_optimization_count: 0,
      cdn_count: 0,
      lazyload_count: 0
    },
    plugin_signals: {},
    risk_summary: {
      total_count: 0,
      low_risk_count: 0,
      medium_risk_count: 0,
      high_risk_count: 0,
      cache_layer_count: 0,
      asset_optimization_count: 0,
      image_optimization_count: 0,
      cdn_count: 0,
      lazyload_count: 0
    },
    safe_candidate_count: 0,
    mutation_candidate_count: 0,
    mutation_rejected_count: 0,
    composed_payload_count: 0,
    dry_run_simulated_count: 0,
    blocking_reasons: ["phase_i_final_handoff_not_evaluated"],
    operator_actions: [
      "resolve_performance_reconciliation_blockers",
      "hold_performance_mutation_execution",
      "no_performance_dry_run_preview_available"
    ],
    inventory_artifact: {},
    normalized_inventory_artifact: {},
    readiness_artifact: {},
    reconciliation_payload_artifact: {},
    execution_guard_artifact: {},
    mutation_candidate_artifact: {},
    mutation_payload_artifact: {},
    dry_run_execution_artifact: {}
  };

  let phaseJPlan = {
    enabled: false,
    inventory_only: true,
    apply: false,
    include_security_headers: true,
    include_waf_surface: true,
    include_hardening_controls: true,
    include_exposed_surfaces: true,
    include_tls_surface: true,
    max_items: 500
  };

  let phaseJPlanStatus = {
    phase_j_status: "blocked",
    phase_j_ready: false,
    blocking_reasons: ["phase_j_not_evaluated"]
  };

  let phaseJGate = {
    phase_j_gate_status: "blocked",
    phase_j_gate_ready: false,
    inventory_only: true,
    blocking_reasons: ["phase_j_gate_not_evaluated"]
  };

  let phaseJSecurityInventory = {
    phase_j_inventory_status: "blocked",
    plugin_signals: {},
    security_header_rows: [],
    waf_rows: [],
    hardening_control_rows: [],
    exposed_surface_rows: [],
    tls_rows: [],
    summary: {
      security_header_count: 0,
      waf_count: 0,
      hardening_control_count: 0,
      exposed_surface_count: 0,
      tls_count: 0
    },
    failures: []
  };

  let phaseJInventoryArtifact = {
    artifact_type: "wordpress_phase_j_security_inventory",
    artifact_version: "v1",
    phase_j_gate_status: "blocked",
    phase_j_inventory_status: "blocked",
    inventory_only: true,
    plugin_signals: {},
    summary: {
      security_header_count: 0,
      waf_count: 0,
      hardening_control_count: 0,
      exposed_surface_count: 0,
      tls_count: 0
    },
    security_header_rows: [],
    waf_rows: [],
    hardening_control_rows: [],
    exposed_surface_rows: [],
    tls_rows: [],
    blocking_reasons: ["phase_j_not_evaluated"],
    failures: []
  };

  let phaseJNormalizedInventory = {
    normalized_security_header_rows: [],
    normalized_waf_rows: [],
    normalized_hardening_control_rows: [],
    normalized_exposed_surface_rows: [],
    normalized_tls_rows: [],
    risk_summary: {
      total_count: 0,
      low_risk_count: 0,
      medium_risk_count: 0,
      high_risk_count: 0,
      security_header_count: 0,
      waf_count: 0,
      hardening_control_count: 0,
      exposed_surface_count: 0,
      tls_count: 0
    }
  };

  let phaseJNormalizedInventoryArtifact = {
    artifact_type: "wordpress_phase_j_security_strategy",
    artifact_version: "v1",
    phase_j_gate_status: "blocked",
    risk_summary: {
      total_count: 0,
      low_risk_count: 0,
      medium_risk_count: 0,
      high_risk_count: 0,
      security_header_count: 0,
      waf_count: 0,
      hardening_control_count: 0,
      exposed_surface_count: 0,
      tls_count: 0
    },
    normalized_security_header_rows: [],
    normalized_waf_rows: [],
    normalized_hardening_control_rows: [],
    normalized_exposed_surface_rows: [],
    normalized_tls_rows: [],
    blocking_reasons: ["phase_j_strategy_not_evaluated"]
  };

  let phaseJReadinessGate = {
    readiness_status: "blocked_for_security_reconciliation",
    readiness_ready: false,
    high_risk_count: 0,
    medium_risk_count: 0,
    low_risk_count: 0,
    blocking_reasons: ["phase_j_readiness_not_evaluated"]
  };

  let phaseJSafeCandidates = {
    safe_candidate_status: "blocked",
    candidate_count: 0,
    security_header_candidates: [],
    waf_candidates: [],
    hardening_control_candidates: [],
    exposed_surface_candidates: [],
    tls_candidates: [],
    blocking_reasons: ["phase_j_safe_candidates_not_evaluated"]
  };

  let phaseJReadinessArtifact = {
    artifact_type: "wordpress_phase_j_readiness_gate",
    artifact_version: "v1",
    readiness_status: "blocked_for_security_reconciliation",
    readiness_ready: false,
    high_risk_count: 0,
    medium_risk_count: 0,
    low_risk_count: 0,
    safe_candidate_status: "blocked",
    candidate_count: 0,
    security_header_candidates: [],
    waf_candidates: [],
    hardening_control_candidates: [],
    exposed_surface_candidates: [],
    tls_candidates: [],
    blocking_reasons: ["phase_j_readiness_not_evaluated"]
  };

  let phaseJReconciliationPayloadPlanner = {
    payload_planner_status: "blocked",
    payload_count: 0,
    security_header_payload_rows: [],
    waf_payload_rows: [],
    hardening_control_payload_rows: [],
    exposed_surface_payload_rows: [],
    tls_payload_rows: [],
    blocking_reasons: ["phase_j_payload_planner_not_evaluated"]
  };

  let phaseJReconciliationPayloadArtifact = {
    artifact_type: "wordpress_phase_j_reconciliation_payloads",
    artifact_version: "v1",
    payload_planner_status: "blocked",
    payload_count: 0,
    security_header_payload_rows: [],
    waf_payload_rows: [],
    hardening_control_payload_rows: [],
    exposed_surface_payload_rows: [],
    tls_payload_rows: [],
    blocking_reasons: ["phase_j_payload_planner_not_evaluated"]
  };

  let phaseJExecutionPlan = {
    enabled: false,
    apply: false,
    dry_run_only: true,
    candidate_limit: 200
  };

  let phaseJExecutionGuard = {
    execution_guard_status: "blocked_before_security_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 200,
    blocking_reasons: ["phase_j_execution_guard_not_evaluated"]
  };

  let phaseJExecutionGuardArtifact = {
    artifact_type: "wordpress_phase_j_execution_guard",
    artifact_version: "v1",
    execution_guard_status: "blocked_before_security_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 200,
    blocking_reasons: ["phase_j_execution_guard_not_evaluated"]
  };

  let phaseJMutationCandidateSelector = {
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_security_header_candidates: [],
    selected_waf_candidates: [],
    selected_hardening_control_candidates: [],
    selected_exposed_surface_candidates: [],
    selected_tls_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_j_mutation_candidates_not_evaluated"]
  };

  let phaseJMutationCandidateArtifact = {
    artifact_type: "wordpress_phase_j_mutation_candidates",
    artifact_version: "v1",
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_security_header_candidates: [],
    selected_waf_candidates: [],
    selected_hardening_control_candidates: [],
    selected_exposed_surface_candidates: [],
    selected_tls_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_j_mutation_candidates_not_evaluated"]
  };

  let phaseJMutationPayloadComposer = {
    composer_status: "blocked",
    payload_count: 0,
    security_header_composed_payloads: [],
    waf_composed_payloads: [],
    hardening_control_composed_payloads: [],
    exposed_surface_composed_payloads: [],
    tls_composed_payloads: [],
    blocking_reasons: ["phase_j_mutation_payloads_not_evaluated"]
  };

  let phaseJMutationPayloadArtifact = {
    artifact_type: "wordpress_phase_j_mutation_payloads",
    artifact_version: "v1",
    composer_status: "blocked",
    payload_count: 0,
    security_header_composed_payloads: [],
    waf_composed_payloads: [],
    hardening_control_composed_payloads: [],
    exposed_surface_composed_payloads: [],
    tls_composed_payloads: [],
    blocking_reasons: ["phase_j_mutation_payloads_not_evaluated"]
  };

  let phaseJDryRunExecutionSimulator = {
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_security_header_rows: [],
    simulated_waf_rows: [],
    simulated_hardening_control_rows: [],
    simulated_exposed_surface_rows: [],
    simulated_tls_rows: [],
    evidence_preview_summary: {
      total_rows: 0,
      security_header_rows: 0,
      waf_rows: 0,
      hardening_control_rows: 0,
      exposed_surface_rows: 0,
      tls_rows: 0,
      preserve_from_source_count: 0,
      enabled_true_count: 0
    },
    blocking_reasons: ["phase_j_dry_run_execution_not_evaluated"]
  };

  let phaseJDryRunExecutionArtifact = {
    artifact_type: "wordpress_phase_j_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_security_header_rows: [],
    simulated_waf_rows: [],
    simulated_hardening_control_rows: [],
    simulated_exposed_surface_rows: [],
    simulated_tls_rows: [],
    evidence_preview_summary: {
      total_rows: 0,
      security_header_rows: 0,
      waf_rows: 0,
      hardening_control_rows: 0,
      exposed_surface_rows: 0,
      tls_rows: 0,
      preserve_from_source_count: 0,
      enabled_true_count: 0
    },
    blocking_reasons: ["phase_j_dry_run_execution_not_evaluated"]
  };

  let phaseJFinalOperatorHandoffBundle = {
    artifact_type: "wordpress_phase_j_final_operator_handoff",
    artifact_version: "v1",
    phase_j_enabled: false,
    phase_j_inventory_only: true,
    phase_j_apply_requested: false,
    requested_security_scope: {
      include_security_headers: true,
      include_waf_surface: true,
      include_hardening_controls: true,
      include_exposed_surfaces: true,
      include_tls_surface: true,
      max_items: 0
    },
    requested_security_config: {},
    phase_j_gate_status: "blocked",
    phase_j_inventory_status: "blocked",
    phase_j_strategy_status: "blocked",
    phase_j_readiness_status: "blocked_for_security_reconciliation",
    phase_j_safe_candidate_status: "blocked",
    phase_j_payload_planner_status: "blocked",
    phase_j_execution_guard_status: "blocked_before_security_mutation",
    phase_j_mutation_selector_status: "blocked",
    phase_j_mutation_payload_status: "blocked",
    phase_j_dry_run_execution_status: "blocked",
    inventory_summary: {
      security_header_count: 0,
      waf_count: 0,
      hardening_control_count: 0,
      exposed_surface_count: 0,
      tls_count: 0
    },
    plugin_signals: {},
    risk_summary: {
      total_count: 0,
      low_risk_count: 0,
      medium_risk_count: 0,
      high_risk_count: 0,
      security_header_count: 0,
      waf_count: 0,
      hardening_control_count: 0,
      exposed_surface_count: 0,
      tls_count: 0
    },
    safe_candidate_count: 0,
    mutation_candidate_count: 0,
    mutation_rejected_count: 0,
    composed_payload_count: 0,
    dry_run_simulated_count: 0,
    blocking_reasons: ["phase_j_final_handoff_not_evaluated"],
    operator_actions: [
      "resolve_security_reconciliation_blockers",
      "hold_security_mutation_execution",
      "no_security_dry_run_preview_available"
    ],
    inventory_artifact: {},
    normalized_inventory_artifact: {},
    readiness_artifact: {},
    reconciliation_payload_artifact: {},
    execution_guard_artifact: {},
    mutation_candidate_artifact: {},
    mutation_payload_artifact: {},
    dry_run_execution_artifact: {}
  };

  let phaseKPlan = {
    enabled: false,
    inventory_only: true,
    apply: false,
    include_logging_surfaces: true,
    include_alerting_surfaces: true,
    include_monitoring_surfaces: true,
    include_error_tracking: true,
    include_uptime_surfaces: true,
    max_items: 500
  };

  let phaseKPlanStatus = {
    phase_k_status: "blocked",
    phase_k_ready: false,
    blocking_reasons: ["phase_k_not_evaluated"]
  };

  let phaseKGate = {
    phase_k_gate_status: "blocked",
    phase_k_gate_ready: false,
    inventory_only: true,
    blocking_reasons: ["phase_k_gate_not_evaluated"]
  };

  let phaseKObservabilityInventory = {
    phase_k_inventory_status: "blocked",
    plugin_signals: {},
    logging_surface_rows: [],
    alerting_surface_rows: [],
    monitoring_surface_rows: [],
    error_tracking_rows: [],
    uptime_surface_rows: [],
    summary: {
      logging_surface_count: 0,
      alerting_surface_count: 0,
      monitoring_surface_count: 0,
      error_tracking_count: 0,
      uptime_surface_count: 0
    },
    failures: []
  };

  let phaseKInventoryArtifact = {
    artifact_type: "wordpress_phase_k_observability_inventory",
    artifact_version: "v1",
    phase_k_gate_status: "blocked",
    phase_k_inventory_status: "blocked",
    inventory_only: true,
    plugin_signals: {},
    summary: {
      logging_surface_count: 0,
      alerting_surface_count: 0,
      monitoring_surface_count: 0,
      error_tracking_count: 0,
      uptime_surface_count: 0
    },
    logging_surface_rows: [],
    alerting_surface_rows: [],
    monitoring_surface_rows: [],
    error_tracking_rows: [],
    uptime_surface_rows: [],
    blocking_reasons: ["phase_k_not_evaluated"],
    failures: []
  };

  let phaseKNormalizedInventory = {
    normalized_logging_surface_rows: [],
    normalized_alerting_surface_rows: [],
    normalized_monitoring_surface_rows: [],
    normalized_error_tracking_rows: [],
    normalized_uptime_surface_rows: [],
    risk_summary: {
      total_count: 0,
      low_risk_count: 0,
      medium_risk_count: 0,
      high_risk_count: 0,
      logging_surface_count: 0,
      alerting_surface_count: 0,
      monitoring_surface_count: 0,
      error_tracking_count: 0,
      uptime_surface_count: 0
    }
  };

  let phaseKNormalizedInventoryArtifact = {
    artifact_type: "wordpress_phase_k_observability_strategy",
    artifact_version: "v1",
    phase_k_gate_status: "blocked",
    risk_summary: {
      total_count: 0,
      low_risk_count: 0,
      medium_risk_count: 0,
      high_risk_count: 0,
      logging_surface_count: 0,
      alerting_surface_count: 0,
      monitoring_surface_count: 0,
      error_tracking_count: 0,
      uptime_surface_count: 0
    },
    normalized_logging_surface_rows: [],
    normalized_alerting_surface_rows: [],
    normalized_monitoring_surface_rows: [],
    normalized_error_tracking_rows: [],
    normalized_uptime_surface_rows: [],
    blocking_reasons: ["phase_k_strategy_not_evaluated"]
  };

  let phaseKReadinessGate = {
    readiness_status: "blocked_for_observability_reconciliation",
    readiness_ready: false,
    high_risk_count: 0,
    medium_risk_count: 0,
    low_risk_count: 0,
    blocking_reasons: ["phase_k_readiness_not_evaluated"]
  };

  let phaseKSafeCandidates = {
    safe_candidate_status: "blocked",
    candidate_count: 0,
    logging_surface_candidates: [],
    alerting_surface_candidates: [],
    monitoring_surface_candidates: [],
    error_tracking_candidates: [],
    uptime_surface_candidates: [],
    blocking_reasons: ["phase_k_safe_candidates_not_evaluated"]
  };

  let phaseKReadinessArtifact = {
    artifact_type: "wordpress_phase_k_readiness_gate",
    artifact_version: "v1",
    readiness_status: "blocked_for_observability_reconciliation",
    readiness_ready: false,
    high_risk_count: 0,
    medium_risk_count: 0,
    low_risk_count: 0,
    safe_candidate_status: "blocked",
    candidate_count: 0,
    logging_surface_candidates: [],
    alerting_surface_candidates: [],
    monitoring_surface_candidates: [],
    error_tracking_candidates: [],
    uptime_surface_candidates: [],
    blocking_reasons: ["phase_k_readiness_not_evaluated"]
  };

  let phaseKReconciliationPayloadPlanner = {
    payload_planner_status: "blocked",
    payload_count: 0,
    logging_surface_payload_rows: [],
    alerting_surface_payload_rows: [],
    monitoring_surface_payload_rows: [],
    error_tracking_payload_rows: [],
    uptime_surface_payload_rows: [],
    blocking_reasons: ["phase_k_payload_planner_not_evaluated"]
  };

  let phaseKReconciliationPayloadArtifact = {
    artifact_type: "wordpress_phase_k_reconciliation_payloads",
    artifact_version: "v1",
    payload_planner_status: "blocked",
    payload_count: 0,
    logging_surface_payload_rows: [],
    alerting_surface_payload_rows: [],
    monitoring_surface_payload_rows: [],
    error_tracking_payload_rows: [],
    uptime_surface_payload_rows: [],
    blocking_reasons: ["phase_k_payload_planner_not_evaluated"]
  };

  let phaseKExecutionPlan = {
    enabled: false,
    apply: false,
    dry_run_only: true,
    candidate_limit: 200
  };

  let phaseKExecutionGuard = {
    execution_guard_status: "blocked_before_observability_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 200,
    blocking_reasons: ["phase_k_execution_guard_not_evaluated"]
  };

  let phaseKExecutionGuardArtifact = {
    artifact_type: "wordpress_phase_k_execution_guard",
    artifact_version: "v1",
    execution_guard_status: "blocked_before_observability_mutation",
    execution_guard_ready: false,
    dry_run_only: true,
    apply_requested: false,
    candidate_limit: 200,
    blocking_reasons: ["phase_k_execution_guard_not_evaluated"]
  };

  let phaseKMutationCandidateSelector = {
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_logging_surface_candidates: [],
    selected_alerting_surface_candidates: [],
    selected_monitoring_surface_candidates: [],
    selected_error_tracking_candidates: [],
    selected_uptime_surface_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_k_mutation_candidates_not_evaluated"]
  };

  let phaseKMutationCandidateArtifact = {
    artifact_type: "wordpress_phase_k_mutation_candidates",
    artifact_version: "v1",
    selector_status: "blocked",
    selected_count: 0,
    rejected_count: 0,
    selected_logging_surface_candidates: [],
    selected_alerting_surface_candidates: [],
    selected_monitoring_surface_candidates: [],
    selected_error_tracking_candidates: [],
    selected_uptime_surface_candidates: [],
    rejected_candidates: [],
    blocking_reasons: ["phase_k_mutation_candidates_not_evaluated"]
  };

  let phaseKMutationPayloadComposer = {
    composer_status: "blocked",
    payload_count: 0,
    logging_surface_composed_payloads: [],
    alerting_surface_composed_payloads: [],
    monitoring_surface_composed_payloads: [],
    error_tracking_composed_payloads: [],
    uptime_surface_composed_payloads: [],
    blocking_reasons: ["phase_k_mutation_payloads_not_evaluated"]
  };

  let phaseKMutationPayloadArtifact = {
    artifact_type: "wordpress_phase_k_mutation_payloads",
    artifact_version: "v1",
    composer_status: "blocked",
    payload_count: 0,
    logging_surface_composed_payloads: [],
    alerting_surface_composed_payloads: [],
    monitoring_surface_composed_payloads: [],
    error_tracking_composed_payloads: [],
    uptime_surface_composed_payloads: [],
    blocking_reasons: ["phase_k_mutation_payloads_not_evaluated"]
  };

  let phaseKDryRunExecutionSimulator = {
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_logging_surface_rows: [],
    simulated_alerting_surface_rows: [],
    simulated_monitoring_surface_rows: [],
    simulated_error_tracking_rows: [],
    simulated_uptime_surface_rows: [],
    evidence_preview_summary: {
      total_rows: 0,
      logging_surface_rows: 0,
      alerting_surface_rows: 0,
      monitoring_surface_rows: 0,
      error_tracking_rows: 0,
      uptime_surface_rows: 0,
      preserve_from_source_count: 0,
      enabled_true_count: 0
    },
    blocking_reasons: ["phase_k_dry_run_execution_not_evaluated"]
  };

  let phaseKDryRunExecutionArtifact = {
    artifact_type: "wordpress_phase_k_dry_run_execution_preview",
    artifact_version: "v1",
    simulator_status: "blocked",
    simulated_count: 0,
    simulated_logging_surface_rows: [],
    simulated_alerting_surface_rows: [],
    simulated_monitoring_surface_rows: [],
    simulated_error_tracking_rows: [],
    simulated_uptime_surface_rows: [],
    evidence_preview_summary: {
      total_rows: 0,
      logging_surface_rows: 0,
      alerting_surface_rows: 0,
      monitoring_surface_rows: 0,
      error_tracking_rows: 0,
      uptime_surface_rows: 0,
      preserve_from_source_count: 0,
      enabled_true_count: 0
    },
    blocking_reasons: ["phase_k_dry_run_execution_not_evaluated"]
  };
  let phaseKFinalOperatorHandoffBundle = {
    phase: "K",
    phase_name: "Observability / Logs / Alerts / Monitoring",
    enabled: false,
    overall_status: "not_evaluated",
    blocking_reasons: ["phase_k_not_evaluated"]
  };

  let phaseLPlan = { enabled: false };
  let phaseLGate = { gate_open: false, skipped: true };
  let phaseLBackupRecoveryInventory = { skipped: true, inventory_rows: [] };
  let phaseLNormalizedInventory = { skipped: true, normalized_backup_scope_rows: [], normalized_recovery_point_rows: [] };
  let phaseLReadinessGate = { gate_open: true, skipped: true, readiness_status: "skipped" };
  let phaseLSafeCandidates = { safe_candidates: [], unsafe_candidates: [], total_safe: 0, total_unsafe: 0 };
  let phaseLReconciliationPayloadPlanner = { skipped: true, reconciliation_items: [] };
  let phaseLExecutionPlan = { skipped: true, execution_steps: [], total_steps: 0 };
  let phaseLExecutionGuard = { guard_passed: true, skipped: true };
  let phaseLMutationCandidateSelector = { selected_mutations: [], total_selected: 0, blocked: true };
  let phaseLMutationCandidateArtifact = { mutations: [], total: 0, blocked: true };
  let phaseLMutationPayloadComposer = { payloads: [], total_payloads: 0, skipped: true };
  let phaseLMutationPayloadArtifact = { payloads: [], total: 0, skipped: true };
  let phaseLDryRunExecutionSimulator = { skipped: true, dry_run_rows: [], summary: {} };
  let phaseLDryRunExecutionArtifact = { skipped: true, dry_run_rows: [], summary: {} };
  let phaseLFinalOperatorHandoffBundle = {
    phase: "L",
    phase_name: "Backup / Recovery",
    enabled: false,
    overall_status: "not_evaluated",
    blocking_reasons: ["phase_l_not_evaluated"]
  };

  let phaseMPlan = { enabled: false };
  let phaseMGate = { gate_open: false, skipped: true };
  let phaseMDeploymentReleaseInventory = { skipped: true, inventory_rows: [] };
  let phaseMNormalizedInventory = { skipped: true, normalized_deployment_scope_rows: [], normalized_rollback_checkpoint_rows: [] };
  let phaseMReadinessGate = { gate_open: true, skipped: true, readiness_status: "skipped" };
  let phaseMSafeCandidates = { safe_candidates: [], unsafe_candidates: [], total_safe: 0, total_unsafe: 0 };
  let phaseMReconciliationPayloadPlanner = { skipped: true, reconciliation_items: [] };
  let phaseMExecutionPlan = { skipped: true, execution_steps: [], total_steps: 0 };
  let phaseMExecutionGuard = { guard_passed: true, skipped: true };
  let phaseMutationCandidateSelector = { selected_mutations: [], total_selected: 0, blocked: true };
  let phaseMutationCandidateArtifact = { mutations: [], total: 0, blocked: true };
  let phaseMutationPayloadComposer = { payloads: [], total_payloads: 0, skipped: true };
  let phaseMutationPayloadArtifact = { payloads: [], total: 0, skipped: true };
  let phaseMDryRunExecutionSimulator = { skipped: true, dry_run_rows: [], summary: {} };
  let phaseMDryRunExecutionArtifact = { skipped: true, dry_run_rows: [], summary: {} };
  let phaseMFinalOperatorHandoffBundle = {
    phase: "M",
    phase_name: "Deployment / Release / Rollback",
    enabled: false,
    overall_status: "not_evaluated",
    blocking_reasons: ["phase_m_not_evaluated"]
  };

  let phaseNPlan = { enabled: false };
  let phaseNGate = { gate_open: false, skipped: true };
  let phaseNDataIntegrityInventory = { skipped: true, inventory_rows: [] };
  let phaseNNormalizedInventory = { skipped: true, normalized_integrity_scope_rows: [], normalized_drift_rows: [] };
  let phaseNReadinessGate = { gate_open: true, skipped: true, readiness_status: "skipped" };
  let phaseNSafeCandidates = { safe_candidates: [], unsafe_candidates: [], total_safe: 0, total_unsafe: 0 };
  let phaseNReconciliationPayloadPlanner = { skipped: true, reconciliation_items: [] };
  let phaseNExecutionPlan = { skipped: true, execution_steps: [], total_steps: 0 };
  let phaseNExecutionGuard = { guard_passed: true, skipped: true };
  let phaseNMutationCandidateSelector = { selected_mutations: [], total_selected: 0, blocked: true };
  let phaseNMutationCandidateArtifact = { mutations: [], total: 0, blocked: true };
  let phaseNMutationPayloadComposer = { payloads: [], total_payloads: 0, skipped: true };
  let phaseNMutationPayloadArtifact = { payloads: [], total: 0, skipped: true };
  let phaseNDryRunExecutionSimulator = { skipped: true, dry_run_rows: [], summary: {} };
  let phaseNDryRunExecutionArtifact = { skipped: true, dry_run_rows: [], summary: {} };
  let phaseNFinalOperatorHandoffBundle = {
    phase: "N",
    phase_name: "Data Integrity / Reconciliation Controls",
    enabled: false,
    overall_status: "not_evaluated",
    blocking_reasons: ["phase_n_not_evaluated"]
  };

  let phaseOPlan = { enabled: false };
  let phaseOGate = { gate_open: false, skipped: true };
  let phaseOQaAcceptanceInventory = { skipped: true, inventory_rows: [] };
  let phaseONormalizedInventory = { skipped: true, normalized_qa_check_rows: [], normalized_failure_rows: [] };
  let phaseOReadinessGate = { gate_open: true, skipped: true, readiness_status: "skipped" };
  let phaseOSafeCandidates = { safe_candidates: [], unsafe_candidates: [], total_safe: 0, total_unsafe: 0 };
  let phaseOReconciliationPayloadPlanner = { skipped: true, reconciliation_items: [] };
  let phaseOExecutionPlan = { skipped: true, execution_steps: [], total_steps: 0 };
  let phaseOExecutionGuard = { guard_passed: true, skipped: true };
  let phaseOMutationCandidateSelector = { selected_mutations: [], total_selected: 0, blocked: true };
  let phaseOMutationCandidateArtifact = { mutations: [], total: 0, blocked: true };
  let phaseOMutationPayloadComposer = { payloads: [], total_payloads: 0, skipped: true };
  let phaseOMutationPayloadArtifact = { payloads: [], total: 0, skipped: true };
  let phaseODryRunExecutionSimulator = { skipped: true, dry_run_rows: [], summary: {} };
  let phaseODryRunExecutionArtifact = { skipped: true, dry_run_rows: [], summary: {} };
  let phaseOFinalOperatorHandoffBundle = {
    phase: "O",
    phase_name: "Quality Assurance / Smoke Tests / Acceptance",
    enabled: false,
    overall_status: "not_evaluated",
    blocking_reasons: ["phase_o_not_evaluated"]
  };
  let phasePPlan = { enabled: false };
  let phasePGate = { gate_open: false, skipped: true };
  let phasePProductionCutoverInventory = { skipped: true, inventory_rows: [] };
  let phasePNormalizedInventory = { skipped: true, normalized_cutover_rows: [], normalized_failure_rows: [] };
  let phasePReadinessGate = { gate_open: true, skipped: true, readiness_status: "skipped" };
  let phasePSafeCandidates = { safe_candidates: [], unsafe_candidates: [], total_safe: 0, total_unsafe: 0 };
  let phasePReconciliationPayloadPlanner = { skipped: true, reconciliation_items: [] };
  let phasePExecutionPlan = { skipped: true, execution_steps: [], total_steps: 0 };
  let phasePExecutionGuard = { guard_passed: true, skipped: true };
  let phasePMutationCandidateSelector = { selected_mutations: [], total_selected: 0, blocked: true };
  let phasePMutationCandidateArtifact = { mutations: [], total: 0, blocked: true };
  let phasePMutationPayloadComposer = { payloads: [], total_payloads: 0, skipped: true };
  let phasePMutationPayloadArtifact = { payloads: [], total: 0, skipped: true };
  let phasePDryRunExecutionSimulator = { skipped: true, dry_run_rows: [], summary: {} };
  let phasePDryRunExecutionArtifact = { skipped: true, dry_run_rows: [], summary: {} };
  let phasePFinalOperatorHandoffBundle = {
    phase: "P",
    phase_name: "Final Orchestration / Production Readiness / Cutover",
    enabled: false,
    overall_status: "not_evaluated",
    blocking_reasons: ["phase_p_not_evaluated"]
  };

  if (apply) {
    deferredParentRepairs = await applyDeferredWordpressParentLinks({
      destinationSiteRef: wpContext?.destination || {},
      state: phaseAState,
      destinationStatuses
    });

    deferredTaxonomyRepairs = await applyDeferredWordpressTaxonomyLinks({
      destinationSiteRef: wpContext?.destination || {},
      state: phaseAState,
      destinationStatuses
    });

    deferredFeaturedMediaRepairs = await applyDeferredWordpressFeaturedMediaLinks({
      destinationSiteRef: wpContext?.destination || {},
      state: phaseAState,
      destinationStatuses
    });

    const parentRepairVerification = await verifyDeferredWordpressParentRepairs({
      destinationSiteRef: wpContext?.destination || {},
      repairs: deferredParentRepairs,
      destinationStatuses
    });

    const taxonomyRepairVerification = await verifyDeferredWordpressTaxonomyRepairs({
      destinationSiteRef: wpContext?.destination || {},
      repairs: deferredTaxonomyRepairs,
      destinationStatuses
    });

    deferredParentReadbackChecks = parentRepairVerification.checks;
    deferredTaxonomyReadbackChecks = taxonomyRepairVerification.checks;
    deferredRepairFailures = [
      ...parentRepairVerification.failures,
      ...taxonomyRepairVerification.failures
    ];
  }

  const readbackChecks = [];
  for (const row of destinationStatuses) {
    const destinationId = Number(row.destination_id);
    if (!Number.isFinite(destinationId) || destinationId < 1) {
      row.readback_verified = false;
      continue;
    }

    const readbackResponse = await executeWordpressRestJsonRequest({
      siteRef: wpContext?.destination || {},
      method: "GET",
      restPath: `/wp/v2/${encodeURIComponent(
        normalizeWordpressCollectionSlug(row.post_type_collection || row.post_type)
      )}/${destinationId}`,
      query: { context: "edit" },
      authRequired: true
    });

    const verified =
      readbackResponse.ok &&
      Number(readbackResponse?.data?.id) === destinationId;

    row.readback_verified = verified;
    const readbackCheck = {
      destination_id: destinationId,
      post_type: row.post_type,
      post_type_collection: row.post_type_collection || row.post_type,
      verified,
      status_code: readbackResponse.status
    };
    row.readback_check = readbackCheck;
    readbackChecks.push(readbackCheck);
  }

  const allFailures = [...failures, ...deferredRepairFailures];

  phaseAPerTypeSummary = buildWordpressPhaseAPerTypeSummary({
    postTypes,
    destinationStatuses,
    failures: allFailures
  });
  phaseAOutcome = classifyWordpressPhaseAOutcome({
    apply,
    perTypeSummary: phaseAPerTypeSummary,
    failures: allFailures
  });

  phaseAOperatorArtifact = buildWordpressPhaseAOperatorArtifact({
    payload,
    phaseAOutcome,
    phaseAPerTypeSummary,
    failures: allFailures,
    postTypeResolution,
    phaseABatchTelemetry,
    phaseARetryTelemetry,
    batchPolicy,
    retryPolicy,
    phaseACheckpoint
  });

  phaseAPromotionGuard = evaluateWordpressPhaseAPromotionReadiness({
    phaseAOutcome,
    phaseAPerTypeSummary,
    destinationStatuses,
    deferredRepairFailures
  });

  selectivePublishCandidates = buildWordpressSelectivePublishCandidates({
    destinationStatuses,
    promotionGuard: phaseAPromotionGuard,
    limit: payload?.migration?.selective_publish_candidate_limit
  });

  selectivePublishPlan = resolveWordpressSelectivePublishPlan(payload);
  selectivePublishExecution = await executeWordpressSelectivePublish({
    destinationSiteRef: wpContext.destination,
    promotionGuard: phaseAPromotionGuard,
    plan: selectivePublishPlan,
    candidateBundle: selectivePublishCandidates
  });
  selectivePublishRollbackPlan = buildWordpressSelectivePublishRollbackPlan({
    execution: selectivePublishExecution
  });
  selectivePublishRollbackExecutionPlan =
    resolveWordpressSelectivePublishRollbackPlan(payload);

  selectivePublishRollbackExecution =
    await executeWordpressSelectivePublishRollback({
      destinationSiteRef: wpContext.destination,
      rollbackPlan: selectivePublishRollbackExecutionPlan,
      executionPlan: selectivePublishRollbackPlan
    });

  phaseACutoverJournal = buildWordpressPhaseACutoverJournal({
    payload,
    phaseAOutcome,
    promotionGuard: phaseAPromotionGuard,
    selectivePublishExecution,
    selectivePublishRollbackExecution,
    phaseACheckpoint,
    phaseAPerTypeSummary
  });

  phaseAFinalCutoverRecommendation =
    classifyWordpressPhaseAFinalCutoverRecommendation({
      phaseAOutcome,
      promotionGuard: phaseAPromotionGuard,
      selectivePublishExecution,
      selectivePublishRollbackExecution,
      phaseAPerTypeSummary
    });

  phaseAFinalOperatorHandoffBundle =
    buildWordpressPhaseAFinalOperatorHandoffBundle({
      payload,
      phaseAOutcome,
      promotionGuard: phaseAPromotionGuard,
      finalCutoverRecommendation: phaseAFinalCutoverRecommendation,
      operatorArtifact: phaseAOperatorArtifact,
      cutoverJournal: phaseACutoverJournal,
      selectivePublishCandidates,
      selectivePublishExecution,
      selectivePublishRollbackPlan,
      selectivePublishRollbackExecution,
      phaseAPerTypeSummary,
      phaseACheckpoint
    });

  phaseBPlan = resolveWordpressPhaseBPlan(payload);
  phaseBPlanStatus = assertWordpressPhaseBPlan(phaseBPlan);
  phaseBGate = buildWordpressBuilderPhaseBGate({
    phaseAFinalCutoverRecommendation,
    phaseBPlan,
    phaseBPlanStatus
  });

  phaseBInventoryAudit = await runWordpressBuilderAssetsInventoryAudit({
    payload,
    wpContext,
    phaseBPlan,
    phaseBGate
  });

  phaseBNormalizedAudit = buildWordpressPhaseBNormalizedAudit({
    auditRows: phaseBInventoryAudit.audit_rows
  });

  phaseBGraphStability = evaluateWordpressPhaseBGraphStability({
    dependencyGraphSummary: phaseBNormalizedAudit.dependency_graph_summary,
    normalizedAuditRows: phaseBNormalizedAudit.normalized_audit_rows,
    migrationBuckets: phaseBNormalizedAudit.migration_buckets
  });

  phaseBReadinessArtifact = buildWordpressPhaseBReadinessArtifact({
    phaseBPlan,
    phaseBGate,
    graphStability: phaseBGraphStability,
    dependencyGraphSummary: phaseBNormalizedAudit.dependency_graph_summary,
    familySummary: phaseBNormalizedAudit.family_summary
  });

  phaseBPlanningCandidates = buildWordpressPhaseBMigrationPlanningCandidates({
    graphStability: phaseBGraphStability,
    migrationBuckets: phaseBNormalizedAudit.migration_buckets,
    limit: payload?.migration?.builder_assets?.planning_candidate_limit
  });

  phaseBPlanningArtifact = buildWordpressPhaseBPlanningArtifact({
    planningCandidates: phaseBPlanningCandidates,
    graphStability: phaseBGraphStability
  });

  phaseBSequencePlanner = buildWordpressPhaseBSequencePlanner({
    planningCandidates: phaseBPlanningCandidates,
    normalizedAuditRows: phaseBNormalizedAudit.normalized_audit_rows
  });

  phaseBSequenceArtifact = buildWordpressPhaseBSequenceArtifact({
    planner: phaseBSequencePlanner
  });

  phaseBMappingPrerequisiteGate = buildWordpressPhaseBMappingPrerequisiteGate({
    sequencePlanner: phaseBSequencePlanner
  });

  phaseBMappingPrerequisiteArtifact = buildWordpressPhaseBMappingPrerequisiteArtifact({
    gate: phaseBMappingPrerequisiteGate
  });

  phaseBMappingPlanSkeleton = buildWordpressPhaseBMappingPlanSkeleton({
    mappingGate: phaseBMappingPrerequisiteGate
  });

  phaseBMappingPlanArtifact = buildWordpressPhaseBMappingPlanArtifact({
    mappingPlan: phaseBMappingPlanSkeleton
  });

  phaseBFieldMappingResolver = buildWordpressPhaseBFieldMappingResolver({
    mappingPlan: phaseBMappingPlanSkeleton
  });

  phaseBFieldMappingArtifact = buildWordpressPhaseBFieldMappingArtifact({
    resolver: phaseBFieldMappingResolver
  });

  phaseBDryRunPlanner = buildWordpressPhaseBDryRunMigrationPayloadPlanner({
    resolver: phaseBFieldMappingResolver,
    limit: payload?.migration?.builder_assets?.dry_run_payload_limit
  });

  phaseBDryRunArtifact = buildWordpressPhaseBDryRunArtifact({
    planner: phaseBDryRunPlanner
  });

  phaseBExecutionPlan = resolveWordpressPhaseBExecutionPlan(payload);
  phaseBExecutionGuard = buildWordpressPhaseBExecutionGuard({
    phaseBPlan,
    graphStability: phaseBGraphStability,
    mappingGate: phaseBMappingPrerequisiteGate,
    dryRunPlanner: phaseBDryRunPlanner,
    executionPlan: phaseBExecutionPlan
  });

  phaseBExecutionGuardArtifact = buildWordpressPhaseBExecutionGuardArtifact({
    guard: phaseBExecutionGuard
  });

  phaseBMutationCandidateSelector = buildWordpressPhaseBMutationCandidateSelector({
    executionGuard: phaseBExecutionGuard,
    fieldMappingResolver: phaseBFieldMappingResolver,
    executionPlan: phaseBExecutionPlan
  });

  phaseBMutationCandidateArtifact = buildWordpressPhaseBMutationCandidateArtifact({
    selector: phaseBMutationCandidateSelector
  });

  phaseBMutationPayloadComposer = buildWordpressPhaseBMutationPayloadComposer({
    selector: phaseBMutationCandidateSelector,
    resolver: phaseBFieldMappingResolver
  });

  phaseBMutationPayloadArtifact = buildWordpressPhaseBMutationPayloadArtifact({
    composer: phaseBMutationPayloadComposer
  });

  phaseBDryRunExecutionSimulator = buildWordpressPhaseBDryRunExecutionSimulator({
    composer: phaseBMutationPayloadComposer
  });

  phaseBDryRunExecutionArtifact = buildWordpressPhaseBDryRunExecutionArtifact({
    simulator: phaseBDryRunExecutionSimulator
  });

  phaseBFinalOperatorHandoffBundle = buildWordpressPhaseBFinalOperatorHandoffBundle({
    payload,
    phaseBPlan,
    phaseBGate,
    readinessArtifact: phaseBReadinessArtifact,
    planningArtifact: phaseBPlanningArtifact,
    sequenceArtifact: phaseBSequenceArtifact,
    mappingPrerequisiteArtifact: phaseBMappingPrerequisiteArtifact,
    mappingPlanArtifact: phaseBMappingPlanArtifact,
    fieldMappingArtifact: phaseBFieldMappingArtifact,
    dryRunArtifact: phaseBDryRunArtifact,
    executionGuardArtifact: phaseBExecutionGuardArtifact,
    mutationCandidateArtifact: phaseBMutationCandidateArtifact,
    mutationPayloadArtifact: phaseBMutationPayloadArtifact,
    dryRunExecutionArtifact: phaseBDryRunExecutionArtifact,
    normalizedAudit: phaseBNormalizedAudit
  });

  phaseCPlan = resolveWordpressPhaseCPlan(payload);
  phaseCPlanStatus = assertWordpressPhaseCPlan(phaseCPlan);
  phaseCGate = buildWordpressPhaseCGate({
    phaseAFinalCutoverRecommendation,
    phaseBFinalOperatorHandoffBundle,
    phaseCPlanStatus,
    phaseCPlan
  });

  phaseCSettingsInventory = await collectWordpressSiteSettingsInventory({
    wpContext,
    phaseCGate,
    phaseCPlan
  });

  phaseCInventoryArtifact = buildWordpressPhaseCInventoryArtifact({
    inventory: phaseCSettingsInventory,
    gate: phaseCGate
  });

  phaseCNormalizedDiff = buildWordpressPhaseCNormalizedDiff({
    inventory: phaseCSettingsInventory
  });

  phaseCDiffArtifact = buildWordpressPhaseCDiffArtifact({
    normalizedDiff: phaseCNormalizedDiff,
    gate: phaseCGate
  });

  phaseCReconciliationReadiness = buildWordpressPhaseCReconciliationReadiness({
    phaseCPlan,
    phaseCGate,
    normalizedDiff: phaseCNormalizedDiff
  });

  phaseCSafeApplyCandidates = buildWordpressPhaseCSafeApplyCandidates({
    readiness: phaseCReconciliationReadiness,
    normalizedDiff: phaseCNormalizedDiff,
    limit: payload?.migration?.site_settings?.safe_apply_limit
  });

  phaseCReadinessArtifact = buildWordpressPhaseCReadinessArtifact({
    readiness: phaseCReconciliationReadiness,
    safeApplyCandidates: phaseCSafeApplyCandidates
  });

  phaseCReconciliationPayloadPlanner = buildWordpressPhaseCReconciliationPayloadPlanner({
    safeApplyCandidates: phaseCSafeApplyCandidates
  });

  phaseCReconciliationPayloadArtifact = buildWordpressPhaseCReconciliationPayloadArtifact({
    planner: phaseCReconciliationPayloadPlanner
  });

  phaseCExecutionPlan = resolveWordpressPhaseCExecutionPlan(payload);
  phaseCExecutionGuard = buildWordpressPhaseCExecutionGuard({
    phaseCPlan,
    phaseCGate,
    readiness: phaseCReconciliationReadiness,
    payloadPlanner: phaseCReconciliationPayloadPlanner,
    executionPlan: phaseCExecutionPlan
  });

  phaseCExecutionGuardArtifact = buildWordpressPhaseCExecutionGuardArtifact({
    guard: phaseCExecutionGuard
  });

  phaseCMutationCandidateSelector = buildWordpressPhaseCMutationCandidateSelector({
    executionGuard: phaseCExecutionGuard,
    payloadPlanner: phaseCReconciliationPayloadPlanner,
    executionPlan: phaseCExecutionPlan
  });

  phaseCMutationCandidateArtifact = buildWordpressPhaseCMutationCandidateArtifact({
    selector: phaseCMutationCandidateSelector
  });

  phaseCMutationPayloadComposer = buildWordpressPhaseCMutationPayloadComposer({
    selector: phaseCMutationCandidateSelector
  });

  phaseCMutationPayloadArtifact = buildWordpressPhaseCMutationPayloadArtifact({
    composer: phaseCMutationPayloadComposer
  });

  phaseCDryRunExecutionSimulator = buildWordpressPhaseCDryRunExecutionSimulator({
    composer: phaseCMutationPayloadComposer
  });

  phaseCDryRunExecutionArtifact = buildWordpressPhaseCDryRunExecutionArtifact({
    simulator: phaseCDryRunExecutionSimulator
  });

  phaseCFinalOperatorHandoffBundle = buildWordpressPhaseCFinalOperatorHandoffBundle({
    payload,
    phaseCPlan,
    phaseCGate,
    inventoryArtifact: phaseCInventoryArtifact,
    diffArtifact: phaseCDiffArtifact,
    readinessArtifact: phaseCReadinessArtifact,
    payloadArtifact: phaseCReconciliationPayloadArtifact,
    executionGuardArtifact: phaseCExecutionGuardArtifact,
    mutationCandidateArtifact: phaseCMutationCandidateArtifact,
    mutationPayloadArtifact: phaseCMutationPayloadArtifact,
    dryRunExecutionArtifact: phaseCDryRunExecutionArtifact,
    normalizedDiff: phaseCNormalizedDiff
  });

  phaseDPlan = resolveWordpressPhaseDPlan(payload);
  phaseDPlanStatus = assertWordpressPhaseDPlan(phaseDPlan);
  phaseDGate = buildWordpressPhaseDGate({
    phaseAFinalCutoverRecommendation,
    phaseBFinalOperatorHandoffBundle,
    phaseCFinalOperatorHandoffBundle,
    phaseDPlan,
    phaseDPlanStatus
  });

  phaseDFormsInventory = await runWordpressFormsIntegrationsInventory({
    wpContext,
    phaseDPlan,
    phaseDGate
  });

  phaseDInventoryArtifact = buildWordpressPhaseDInventoryArtifact({
    inventory: phaseDFormsInventory,
    gate: phaseDGate
  });

  phaseDNormalizedInventory = buildWordpressPhaseDNormalizedInventory({
    inventory: phaseDFormsInventory
  });

  phaseDNormalizedInventoryArtifact = buildWordpressPhaseDNormalizedInventoryArtifact({
    normalizedInventory: phaseDNormalizedInventory,
    gate: phaseDGate
  });

  phaseDReadinessGate = buildWordpressPhaseDReadinessGate({
    phaseDPlan,
    phaseDGate,
    normalizedInventory: phaseDNormalizedInventory
  });

  phaseDSafeCandidates = buildWordpressPhaseDSafeCandidates({
    readiness: phaseDReadinessGate,
    normalizedInventory: phaseDNormalizedInventory,
    limit: payload?.migration?.forms_integrations?.safe_candidate_limit
  });

  phaseDReadinessArtifact = buildWordpressPhaseDReadinessArtifact({
    readiness: phaseDReadinessGate,
    safeCandidates: phaseDSafeCandidates
  });

  phaseDMigrationPayloadPlanner = buildWordpressPhaseDMigrationPayloadPlanner({
    safeCandidates: phaseDSafeCandidates
  });

  phaseDMigrationPayloadArtifact = buildWordpressPhaseDMigrationPayloadArtifact({
    planner: phaseDMigrationPayloadPlanner
  });

  phaseDExecutionPlan = resolveWordpressPhaseDExecutionPlan(payload);
  phaseDExecutionGuard = buildWordpressPhaseDExecutionGuard({
    phaseDPlan,
    phaseDGate,
    readiness: phaseDReadinessGate,
    payloadPlanner: phaseDMigrationPayloadPlanner,
    executionPlan: phaseDExecutionPlan
  });

  phaseDExecutionGuardArtifact = buildWordpressPhaseDExecutionGuardArtifact({
    guard: phaseDExecutionGuard
  });

  phaseDMutationCandidateSelector = buildWordpressPhaseDMutationCandidateSelector({
    executionGuard: phaseDExecutionGuard,
    payloadPlanner: phaseDMigrationPayloadPlanner,
    executionPlan: phaseDExecutionPlan
  });

  phaseDMutationCandidateArtifact = buildWordpressPhaseDMutationCandidateArtifact({
    selector: phaseDMutationCandidateSelector
  });

  phaseDMutationPayloadComposer = buildWordpressPhaseDMutationPayloadComposer({
    selector: phaseDMutationCandidateSelector
  });

  phaseDMutationPayloadArtifact = buildWordpressPhaseDMutationPayloadArtifact({
    composer: phaseDMutationPayloadComposer
  });

  phaseDDryRunExecutionSimulator = buildWordpressPhaseDDryRunExecutionSimulator({
    composer: phaseDMutationPayloadComposer
  });

  phaseDDryRunExecutionArtifact = buildWordpressPhaseDDryRunExecutionArtifact({
    simulator: phaseDDryRunExecutionSimulator
  });

  phaseDFinalOperatorHandoffBundle = buildWordpressPhaseDFinalOperatorHandoffBundle({
    payload,
    phaseDPlan,
    phaseDGate,
    inventoryArtifact: phaseDInventoryArtifact,
    normalizedInventoryArtifact: phaseDNormalizedInventoryArtifact,
    readinessArtifact: phaseDReadinessArtifact,
    migrationPayloadArtifact: phaseDMigrationPayloadArtifact,
    executionGuardArtifact: phaseDExecutionGuardArtifact,
    mutationCandidateArtifact: phaseDMutationCandidateArtifact,
    mutationPayloadArtifact: phaseDMutationPayloadArtifact,
    dryRunExecutionArtifact: phaseDDryRunExecutionArtifact,
    normalizedInventory: phaseDNormalizedInventory
  });

  phaseEPlan = resolveWordpressPhaseEPlan(payload);
  phaseEPlanStatus = assertWordpressPhaseEPlan(phaseEPlan);
  phaseEGate = buildWordpressPhaseEGate({
    phaseAFinalCutoverRecommendation,
    phaseBFinalOperatorHandoffBundle,
    phaseCFinalOperatorHandoffBundle,
    phaseDFinalOperatorHandoffBundle,
    phaseEPlan,
    phaseEPlanStatus
  });

  phaseEMediaInventory = await runWordpressMediaInventory({
    wpContext,
    phaseEPlan,
    phaseEGate
  });

  phaseEInventoryArtifact = buildWordpressPhaseEInventoryArtifact({
    inventory: phaseEMediaInventory,
    gate: phaseEGate
  });

  phaseENormalizedInventory = buildWordpressPhaseENormalizedInventory({
    inventory: phaseEMediaInventory,
    phaseEPlan
  });

  phaseENormalizedInventoryArtifact = buildWordpressPhaseENormalizedInventoryArtifact({
    normalizedInventory: phaseENormalizedInventory,
    gate: phaseEGate
  });

  phaseEReadinessGate = buildWordpressPhaseEReadinessGate({
    phaseEPlan,
    phaseEGate,
    normalizedInventory: phaseENormalizedInventory
  });

  phaseESafeCandidates = buildWordpressPhaseESafeCandidates({
    readiness: phaseEReadinessGate,
    normalizedInventory: phaseENormalizedInventory,
    limit: payload?.migration?.media_assets?.safe_candidate_limit
  });

  phaseEReadinessArtifact = buildWordpressPhaseEReadinessArtifact({
    readiness: phaseEReadinessGate,
    safeCandidates: phaseESafeCandidates
  });

  phaseEMigrationPayloadPlanner = buildWordpressPhaseEMigrationPayloadPlanner({
    safeCandidates: phaseESafeCandidates
  });

  phaseEMigrationPayloadArtifact = buildWordpressPhaseEMigrationPayloadArtifact({
    planner: phaseEMigrationPayloadPlanner
  });

  phaseEExecutionPlan = resolveWordpressPhaseEExecutionPlan(payload);
  phaseEExecutionGuard = buildWordpressPhaseEExecutionGuard({
    phaseEPlan,
    phaseEGate,
    readiness: phaseEReadinessGate,
    payloadPlanner: phaseEMigrationPayloadPlanner,
    executionPlan: phaseEExecutionPlan
  });

  phaseEExecutionGuardArtifact = buildWordpressPhaseEExecutionGuardArtifact({
    guard: phaseEExecutionGuard
  });

  phaseEMutationCandidateSelector = buildWordpressPhaseEMutationCandidateSelector({
    executionGuard: phaseEExecutionGuard,
    payloadPlanner: phaseEMigrationPayloadPlanner,
    executionPlan: phaseEExecutionPlan
  });

  phaseEMutationCandidateArtifact = buildWordpressPhaseEMutationCandidateArtifact({
    selector: phaseEMutationCandidateSelector
  });

  phaseEMutationPayloadComposer = buildWordpressPhaseEMutationPayloadComposer({
    selector: phaseEMutationCandidateSelector
  });

  phaseEMutationPayloadArtifact = buildWordpressPhaseEMutationPayloadArtifact({
    composer: phaseEMutationPayloadComposer
  });

  phaseEDryRunExecutionSimulator = buildWordpressPhaseEDryRunExecutionSimulator({
    composer: phaseEMutationPayloadComposer
  });

  phaseEDryRunExecutionArtifact = buildWordpressPhaseEDryRunExecutionArtifact({
    simulator: phaseEDryRunExecutionSimulator
  });

  phaseEFinalOperatorHandoffBundle = buildWordpressPhaseEFinalOperatorHandoffBundle({
    payload,
    phaseEPlan,
    phaseEGate,
    inventoryArtifact: phaseEInventoryArtifact,
    normalizedInventoryArtifact: phaseENormalizedInventoryArtifact,
    readinessArtifact: phaseEReadinessArtifact,
    migrationPayloadArtifact: phaseEMigrationPayloadArtifact,
    executionGuardArtifact: phaseEExecutionGuardArtifact,
    mutationCandidateArtifact: phaseEMutationCandidateArtifact,
    mutationPayloadArtifact: phaseEMutationPayloadArtifact,
    dryRunExecutionArtifact: phaseEDryRunExecutionArtifact,
    normalizedInventory: phaseENormalizedInventory
  });

  phaseFPlan = resolveWordpressPhaseFPlan(payload);
  phaseFPlanStatus = assertWordpressPhaseFPlan(phaseFPlan);
  phaseFGate = buildWordpressPhaseFGate({
    phaseAFinalCutoverRecommendation,
    phaseBFinalOperatorHandoffBundle,
    phaseCFinalOperatorHandoffBundle,
    phaseDFinalOperatorHandoffBundle,
    phaseEFinalOperatorHandoffBundle,
    phaseFPlan,
    phaseFPlanStatus
  });

  phaseFUsersRolesAuthInventory = await runWordpressUsersRolesAuthInventory({
    wpContext,
    phaseFPlan,
    phaseFGate
  });

  phaseFInventoryArtifact = buildWordpressPhaseFInventoryArtifact({
    inventory: phaseFUsersRolesAuthInventory,
    gate: phaseFGate
  });

  phaseFNormalizedInventory = buildWordpressPhaseFNormalizedInventory({
    inventory: phaseFUsersRolesAuthInventory
  });

  phaseFNormalizedInventoryArtifact = buildWordpressPhaseFNormalizedInventoryArtifact({
    normalizedInventory: phaseFNormalizedInventory,
    gate: phaseFGate
  });

  phaseFReadinessGate = buildWordpressPhaseFReadinessGate({
    phaseFPlan,
    phaseFGate,
    normalizedInventory: phaseFNormalizedInventory
  });

  phaseFSafeCandidates = buildWordpressPhaseFSafeCandidates({
    readiness: phaseFReadinessGate,
    normalizedInventory: phaseFNormalizedInventory,
    limit: payload?.migration?.users_roles_auth?.safe_candidate_limit
  });

  phaseFReadinessArtifact = buildWordpressPhaseFReadinessArtifact({
    readiness: phaseFReadinessGate,
    safeCandidates: phaseFSafeCandidates
  });

  phaseFReconciliationPayloadPlanner = buildWordpressPhaseFReconciliationPayloadPlanner({
    safeCandidates: phaseFSafeCandidates
  });

  phaseFReconciliationPayloadArtifact = buildWordpressPhaseFReconciliationPayloadArtifact({
    planner: phaseFReconciliationPayloadPlanner
  });

  phaseFExecutionPlan = resolveWordpressPhaseFExecutionPlan(payload);
  phaseFExecutionGuard = buildWordpressPhaseFExecutionGuard({
    phaseFPlan,
    phaseFGate,
    readiness: phaseFReadinessGate,
    payloadPlanner: phaseFReconciliationPayloadPlanner,
    executionPlan: phaseFExecutionPlan
  });

  phaseFExecutionGuardArtifact = buildWordpressPhaseFExecutionGuardArtifact({
    guard: phaseFExecutionGuard
  });

  phaseFMutationCandidateSelector = buildWordpressPhaseFMutationCandidateSelector({
    executionGuard: phaseFExecutionGuard,
    payloadPlanner: phaseFReconciliationPayloadPlanner,
    executionPlan: phaseFExecutionPlan
  });

  phaseFMutationCandidateArtifact = buildWordpressPhaseFMutationCandidateArtifact({
    selector: phaseFMutationCandidateSelector
  });

  phaseFMutationPayloadComposer = buildWordpressPhaseFMutationPayloadComposer({
    selector: phaseFMutationCandidateSelector
  });

  phaseFMutationPayloadArtifact = buildWordpressPhaseFMutationPayloadArtifact({
    composer: phaseFMutationPayloadComposer
  });

  phaseFDryRunExecutionSimulator = buildWordpressPhaseFDryRunExecutionSimulator({
    composer: phaseFMutationPayloadComposer
  });

  phaseFDryRunExecutionArtifact = buildWordpressPhaseFDryRunExecutionArtifact({
    simulator: phaseFDryRunExecutionSimulator
  });

  phaseFFinalOperatorHandoffBundle = buildWordpressPhaseFFinalOperatorHandoffBundle({
    payload,
    phaseFPlan,
    phaseFGate,
    inventoryArtifact: phaseFInventoryArtifact,
    normalizedInventoryArtifact: phaseFNormalizedInventoryArtifact,
    readinessArtifact: phaseFReadinessArtifact,
    reconciliationPayloadArtifact: phaseFReconciliationPayloadArtifact,
    executionGuardArtifact: phaseFExecutionGuardArtifact,
    mutationCandidateArtifact: phaseFMutationCandidateArtifact,
    mutationPayloadArtifact: phaseFMutationPayloadArtifact,
    dryRunExecutionArtifact: phaseFDryRunExecutionArtifact,
    normalizedInventory: phaseFNormalizedInventory
  });

  phaseGPlan = resolveWordpressPhaseGPlan(payload);
  phaseGPlanStatus = assertWordpressPhaseGPlan(phaseGPlan);
  phaseGGate = buildWordpressPhaseGGate({
    phaseAFinalCutoverRecommendation,
    phaseBFinalOperatorHandoffBundle,
    phaseCFinalOperatorHandoffBundle,
    phaseDFinalOperatorHandoffBundle,
    phaseEFinalOperatorHandoffBundle,
    phaseFFinalOperatorHandoffBundle,
    phaseGPlan,
    phaseGPlanStatus
  });

  phaseGSeoInventory = await runWordpressSeoInventory({
    wpContext,
    phaseGPlan,
    phaseGGate
  });

  phaseGInventoryArtifact = buildWordpressPhaseGInventoryArtifact({
    inventory: phaseGSeoInventory,
    gate: phaseGGate
  });

  phaseGNormalizedInventory = buildWordpressPhaseGNormalizedInventory({
    inventory: phaseGSeoInventory
  });

  phaseGNormalizedInventoryArtifact = buildWordpressPhaseGNormalizedInventoryArtifact({
    normalizedInventory: phaseGNormalizedInventory,
    gate: phaseGGate
  });

  phaseGReadinessGate = buildWordpressPhaseGReadinessGate({
    phaseGPlan,
    phaseGGate,
    normalizedInventory: phaseGNormalizedInventory
  });

  phaseGSafeCandidates = buildWordpressPhaseGSafeCandidates({
    readiness: phaseGReadinessGate,
    normalizedInventory: phaseGNormalizedInventory,
    limit: payload?.migration?.seo_surfaces?.safe_candidate_limit
  });

  phaseGReadinessArtifact = buildWordpressPhaseGReadinessArtifact({
    readiness: phaseGReadinessGate,
    safeCandidates: phaseGSafeCandidates
  });

  phaseGReconciliationPayloadPlanner = buildWordpressPhaseGReconciliationPayloadPlanner({
    safeCandidates: phaseGSafeCandidates
  });

  phaseGReconciliationPayloadArtifact = buildWordpressPhaseGReconciliationPayloadArtifact({
    planner: phaseGReconciliationPayloadPlanner
  });

  phaseGExecutionPlan = resolveWordpressPhaseGExecutionPlan(payload);
  phaseGExecutionGuard = buildWordpressPhaseGExecutionGuard({
    phaseGPlan,
    phaseGGate,
    readiness: phaseGReadinessGate,
    payloadPlanner: phaseGReconciliationPayloadPlanner,
    executionPlan: phaseGExecutionPlan
  });

  phaseGExecutionGuardArtifact = buildWordpressPhaseGExecutionGuardArtifact({
    guard: phaseGExecutionGuard
  });

  phaseGMutationCandidateSelector = buildWordpressPhaseGMutationCandidateSelector({
    executionGuard: phaseGExecutionGuard,
    payloadPlanner: phaseGReconciliationPayloadPlanner,
    executionPlan: phaseGExecutionPlan
  });

  phaseGMutationCandidateArtifact = buildWordpressPhaseGMutationCandidateArtifact({
    selector: phaseGMutationCandidateSelector
  });

  phaseGMutationPayloadComposer = buildWordpressPhaseGMutationPayloadComposer({
    selector: phaseGMutationCandidateSelector
  });

  phaseGMutationPayloadArtifact = buildWordpressPhaseGMutationPayloadArtifact({
    composer: phaseGMutationPayloadComposer
  });

  phaseGDryRunExecutionSimulator = buildWordpressPhaseGDryRunExecutionSimulator({
    composer: phaseGMutationPayloadComposer
  });

  phaseGDryRunExecutionArtifact = buildWordpressPhaseGDryRunExecutionArtifact({
    simulator: phaseGDryRunExecutionSimulator
  });

  phaseGFinalOperatorHandoffBundle = buildWordpressPhaseGFinalOperatorHandoffBundle({
    payload,
    phaseGPlan,
    phaseGGate,
    inventoryArtifact: phaseGInventoryArtifact,
    normalizedInventoryArtifact: phaseGNormalizedInventoryArtifact,
    readinessArtifact: phaseGReadinessArtifact,
    reconciliationPayloadArtifact: phaseGReconciliationPayloadArtifact,
    executionGuardArtifact: phaseGExecutionGuardArtifact,
    mutationCandidateArtifact: phaseGMutationCandidateArtifact,
    mutationPayloadArtifact: phaseGMutationPayloadArtifact,
    dryRunExecutionArtifact: phaseGDryRunExecutionArtifact,
    normalizedInventory: phaseGNormalizedInventory
  });

  phaseHPlan = resolveWordpressPhaseHPlan(payload);
  phaseHPlanStatus = assertWordpressPhaseHPlan(phaseHPlan);
  phaseHGate = buildWordpressPhaseHGate({
    phaseAFinalCutoverRecommendation,
    phaseBFinalOperatorHandoffBundle,
    phaseCFinalOperatorHandoffBundle,
    phaseDFinalOperatorHandoffBundle,
    phaseEFinalOperatorHandoffBundle,
    phaseFFinalOperatorHandoffBundle,
    phaseGFinalOperatorHandoffBundle,
    phaseHPlan,
    phaseHPlanStatus
  });

  phaseHAnalyticsInventory = await runWordpressAnalyticsTrackingInventory({
    wpContext,
    phaseHPlan,
    phaseHGate
  });

  phaseHInventoryArtifact = buildWordpressPhaseHInventoryArtifact({
    inventory: phaseHAnalyticsInventory,
    gate: phaseHGate
  });

  phaseHNormalizedInventory = buildWordpressPhaseHNormalizedInventory({
    inventory: phaseHAnalyticsInventory
  });

  phaseHNormalizedInventoryArtifact = buildWordpressPhaseHNormalizedInventoryArtifact({
    normalizedInventory: phaseHNormalizedInventory,
    gate: phaseHGate
  });

  phaseHReadinessGate = buildWordpressPhaseHReadinessGate({
    phaseHPlan,
    phaseHGate,
    normalizedInventory: phaseHNormalizedInventory
  });

  phaseHSafeCandidates = buildWordpressPhaseHSafeCandidates({
    readiness: phaseHReadinessGate,
    normalizedInventory: phaseHNormalizedInventory,
    limit: payload?.migration?.analytics_tracking?.safe_candidate_limit
  });

  phaseHReadinessArtifact = buildWordpressPhaseHReadinessArtifact({
    readiness: phaseHReadinessGate,
    safeCandidates: phaseHSafeCandidates
  });

  phaseHReconciliationPayloadPlanner = buildWordpressPhaseHReconciliationPayloadPlanner({
    safeCandidates: phaseHSafeCandidates
  });

  phaseHReconciliationPayloadArtifact = buildWordpressPhaseHReconciliationPayloadArtifact({
    planner: phaseHReconciliationPayloadPlanner
  });

  phaseHExecutionPlan = resolveWordpressPhaseHExecutionPlan(payload);
  phaseHExecutionGuard = buildWordpressPhaseHExecutionGuard({
    phaseHPlan,
    phaseHGate,
    readiness: phaseHReadinessGate,
    payloadPlanner: phaseHReconciliationPayloadPlanner,
    executionPlan: phaseHExecutionPlan
  });

  phaseHExecutionGuardArtifact = buildWordpressPhaseHExecutionGuardArtifact({
    guard: phaseHExecutionGuard
  });

  phaseHMutationCandidateSelector = buildWordpressPhaseHMutationCandidateSelector({
    executionGuard: phaseHExecutionGuard,
    payloadPlanner: phaseHReconciliationPayloadPlanner,
    executionPlan: phaseHExecutionPlan
  });

  phaseHMutationCandidateArtifact = buildWordpressPhaseHMutationCandidateArtifact({
    selector: phaseHMutationCandidateSelector
  });

  phaseHMutationPayloadComposer = buildWordpressPhaseHMutationPayloadComposer({
    selector: phaseHMutationCandidateSelector
  });

  phaseHMutationPayloadArtifact = buildWordpressPhaseHMutationPayloadArtifact({
    composer: phaseHMutationPayloadComposer
  });

  phaseHDryRunExecutionSimulator = buildWordpressPhaseHDryRunExecutionSimulator({
    composer: phaseHMutationPayloadComposer
  });

  phaseHDryRunExecutionArtifact = buildWordpressPhaseHDryRunExecutionArtifact({
    simulator: phaseHDryRunExecutionSimulator
  });

  phaseHFinalOperatorHandoffBundle = buildWordpressPhaseHFinalOperatorHandoffBundle({
    payload,
    phaseHPlan,
    phaseHGate,
    inventoryArtifact: phaseHInventoryArtifact,
    normalizedInventoryArtifact: phaseHNormalizedInventoryArtifact,
    readinessArtifact: phaseHReadinessArtifact,
    reconciliationPayloadArtifact: phaseHReconciliationPayloadArtifact,
    executionGuardArtifact: phaseHExecutionGuardArtifact,
    mutationCandidateArtifact: phaseHMutationCandidateArtifact,
    mutationPayloadArtifact: phaseHMutationPayloadArtifact,
    dryRunExecutionArtifact: phaseHDryRunExecutionArtifact,
    normalizedInventory: phaseHNormalizedInventory
  });

  phaseIPlan = resolveWordpressPhaseIPlan(payload);

  phaseIPlanStatus = assertWordpressPhaseIPlan(phaseIPlan);

  phaseIGate = buildWordpressPhaseIGate({
    phaseAFinalCutoverRecommendation,
    phaseBFinalOperatorHandoffBundle,
    phaseCFinalOperatorHandoffBundle,
    phaseDFinalOperatorHandoffBundle,
    phaseEFinalOperatorHandoffBundle,
    phaseFFinalOperatorHandoffBundle,
    phaseGFinalOperatorHandoffBundle,
    phaseHFinalOperatorHandoffBundle,
    phaseIPlan,
    phaseIPlanStatus
  });

  phaseIPerformanceInventory = await runWordpressPerformanceOptimizationInventory({
    wpContext,
    phaseIPlan,
    phaseIGate
  });

  phaseIInventoryArtifact = buildWordpressPhaseIInventoryArtifact({
    inventory: phaseIPerformanceInventory,
    gate: phaseIGate
  });

  phaseINormalizedInventory = buildWordpressPhaseINormalizedInventory({
    inventory: phaseIPerformanceInventory
  });

  phaseINormalizedInventoryArtifact = buildWordpressPhaseINormalizedInventoryArtifact({
    normalizedInventory: phaseINormalizedInventory,
    gate: phaseIGate
  });

  phaseIReadinessGate = buildWordpressPhaseIReadinessGate({
    phaseIPlan,
    phaseIGate,
    normalizedInventory: phaseINormalizedInventory
  });

  phaseISafeCandidates = buildWordpressPhaseISafeCandidates({
    readiness: phaseIReadinessGate,
    normalizedInventory: phaseINormalizedInventory,
    limit: payload?.migration?.performance_optimization?.safe_candidate_limit
  });

  phaseIReadinessArtifact = buildWordpressPhaseIReadinessArtifact({
    readiness: phaseIReadinessGate,
    safeCandidates: phaseISafeCandidates
  });

  phaseIReconciliationPayloadPlanner = buildWordpressPhaseIReconciliationPayloadPlanner({
    safeCandidates: phaseISafeCandidates
  });

  phaseIReconciliationPayloadArtifact = buildWordpressPhaseIReconciliationPayloadArtifact({
    planner: phaseIReconciliationPayloadPlanner
  });

  phaseIExecutionPlan = resolveWordpressPhaseIExecutionPlan(payload);

  phaseIExecutionGuard = buildWordpressPhaseIExecutionGuard({
    phaseIPlan,
    phaseIGate,
    readiness: phaseIReadinessGate,
    payloadPlanner: phaseIReconciliationPayloadPlanner,
    executionPlan: phaseIExecutionPlan
  });

  phaseIExecutionGuardArtifact = buildWordpressPhaseIExecutionGuardArtifact({
    guard: phaseIExecutionGuard
  });

  phaseIMutationCandidateSelector = buildWordpressPhaseIMutationCandidateSelector({
    executionGuard: phaseIExecutionGuard,
    payloadPlanner: phaseIReconciliationPayloadPlanner,
    executionPlan: phaseIExecutionPlan
  });

  phaseIMutationCandidateArtifact = buildWordpressPhaseIMutationCandidateArtifact({
    selector: phaseIMutationCandidateSelector
  });

  phaseIMutationPayloadComposer = buildWordpressPhaseIMutationPayloadComposer({
    selector: phaseIMutationCandidateSelector
  });

  phaseIMutationPayloadArtifact = buildWordpressPhaseIMutationPayloadArtifact({
    composer: phaseIMutationPayloadComposer
  });

  phaseIDryRunExecutionSimulator = buildWordpressPhaseIDryRunExecutionSimulator({
    composer: phaseIMutationPayloadComposer
  });

  phaseIDryRunExecutionArtifact = buildWordpressPhaseIDryRunExecutionArtifact({
    simulator: phaseIDryRunExecutionSimulator
  });

  phaseIFinalOperatorHandoffBundle = buildWordpressPhaseIFinalOperatorHandoffBundle({
    payload,
    phaseIPlan,
    phaseIGate,
    inventoryArtifact: phaseIInventoryArtifact,
    normalizedInventoryArtifact: phaseINormalizedInventoryArtifact,
    readinessArtifact: phaseIReadinessArtifact,
    reconciliationPayloadArtifact: phaseIReconciliationPayloadArtifact,
    executionGuardArtifact: phaseIExecutionGuardArtifact,
    mutationCandidateArtifact: phaseIMutationCandidateArtifact,
    mutationPayloadArtifact: phaseIMutationPayloadArtifact,
    dryRunExecutionArtifact: phaseIDryRunExecutionArtifact,
    normalizedInventory: phaseINormalizedInventory
  });

  phaseJPlan = resolveWordpressPhaseJPlan(payload);

  phaseJPlanStatus = assertWordpressPhaseJPlan(phaseJPlan);

  phaseJGate = buildWordpressPhaseJGate({
    phaseAFinalCutoverRecommendation,
    phaseBFinalOperatorHandoffBundle,
    phaseCFinalOperatorHandoffBundle,
    phaseDFinalOperatorHandoffBundle,
    phaseEFinalOperatorHandoffBundle,
    phaseFFinalOperatorHandoffBundle,
    phaseGFinalOperatorHandoffBundle,
    phaseHFinalOperatorHandoffBundle,
    phaseIFinalOperatorHandoffBundle,
    phaseJPlan,
    phaseJPlanStatus
  });

  phaseJSecurityInventory = await runWordpressSecurityHardeningInventory({
    wpContext,
    phaseJPlan,
    phaseJGate
  });

  phaseJInventoryArtifact = buildWordpressPhaseJInventoryArtifact({
    inventory: phaseJSecurityInventory,
    gate: phaseJGate
  });

  phaseJNormalizedInventory = buildWordpressPhaseJNormalizedInventory({
    inventory: phaseJSecurityInventory
  });

  phaseJNormalizedInventoryArtifact = buildWordpressPhaseJNormalizedInventoryArtifact({
    normalizedInventory: phaseJNormalizedInventory,
    gate: phaseJGate
  });

  phaseJReadinessGate = buildWordpressPhaseJReadinessGate({
    phaseJPlan,
    phaseJGate,
    normalizedInventory: phaseJNormalizedInventory
  });

  phaseJSafeCandidates = buildWordpressPhaseJSafeCandidates({
    readiness: phaseJReadinessGate,
    normalizedInventory: phaseJNormalizedInventory,
    limit: payload?.migration?.security_hardening?.safe_candidate_limit
  });

  phaseJReadinessArtifact = buildWordpressPhaseJReadinessArtifact({
    readiness: phaseJReadinessGate,
    safeCandidates: phaseJSafeCandidates
  });

  phaseJReconciliationPayloadPlanner = buildWordpressPhaseJReconciliationPayloadPlanner({
    safeCandidates: phaseJSafeCandidates
  });

  phaseJReconciliationPayloadArtifact = buildWordpressPhaseJReconciliationPayloadArtifact({
    planner: phaseJReconciliationPayloadPlanner
  });

  phaseJExecutionPlan = resolveWordpressPhaseJExecutionPlan(payload);

  phaseJExecutionGuard = buildWordpressPhaseJExecutionGuard({
    phaseJPlan,
    phaseJGate,
    readiness: phaseJReadinessGate,
    payloadPlanner: phaseJReconciliationPayloadPlanner,
    executionPlan: phaseJExecutionPlan
  });

  phaseJExecutionGuardArtifact = buildWordpressPhaseJExecutionGuardArtifact({
    guard: phaseJExecutionGuard
  });

  phaseJMutationCandidateSelector = buildWordpressPhaseJMutationCandidateSelector({
    executionGuard: phaseJExecutionGuard,
    payloadPlanner: phaseJReconciliationPayloadPlanner,
    executionPlan: phaseJExecutionPlan
  });

  phaseJMutationCandidateArtifact = buildWordpressPhaseJMutationCandidateArtifact({
    selector: phaseJMutationCandidateSelector
  });

  phaseJMutationPayloadComposer = buildWordpressPhaseJMutationPayloadComposer({
    selector: phaseJMutationCandidateSelector
  });

  phaseJMutationPayloadArtifact = buildWordpressPhaseJMutationPayloadArtifact({
    composer: phaseJMutationPayloadComposer
  });

  phaseJDryRunExecutionSimulator = buildWordpressPhaseJDryRunExecutionSimulator({
    composer: phaseJMutationPayloadComposer
  });

  phaseJDryRunExecutionArtifact = buildWordpressPhaseJDryRunExecutionArtifact({
    simulator: phaseJDryRunExecutionSimulator
  });

  phaseJFinalOperatorHandoffBundle = buildWordpressPhaseJFinalOperatorHandoffBundle({
    payload,
    phaseJPlan,
    phaseJGate,
    inventoryArtifact: phaseJInventoryArtifact,
    normalizedInventoryArtifact: phaseJNormalizedInventoryArtifact,
    readinessArtifact: phaseJReadinessArtifact,
    reconciliationPayloadArtifact: phaseJReconciliationPayloadArtifact,
    executionGuardArtifact: phaseJExecutionGuardArtifact,
    mutationCandidateArtifact: phaseJMutationCandidateArtifact,
    mutationPayloadArtifact: phaseJMutationPayloadArtifact,
    dryRunExecutionArtifact: phaseJDryRunExecutionArtifact,
    normalizedInventory: phaseJNormalizedInventory
  });

  phaseKPlan = resolveWordpressPhaseKPlan(payload);

  phaseKPlanStatus = assertWordpressPhaseKPlan(phaseKPlan);

  phaseKGate = buildWordpressPhaseKGate({
    phaseAFinalCutoverRecommendation,
    phaseBFinalOperatorHandoffBundle,
    phaseCFinalOperatorHandoffBundle,
    phaseDFinalOperatorHandoffBundle,
    phaseEFinalOperatorHandoffBundle,
    phaseFFinalOperatorHandoffBundle,
    phaseGFinalOperatorHandoffBundle,
    phaseHFinalOperatorHandoffBundle,
    phaseIFinalOperatorHandoffBundle,
    phaseJFinalOperatorHandoffBundle,
    phaseKPlan,
    phaseKPlanStatus
  });

  phaseKObservabilityInventory = await runWordpressObservabilityMonitoringInventory({
    wpContext,
    phaseKPlan,
    phaseKGate
  });

  phaseKInventoryArtifact = buildWordpressPhaseKInventoryArtifact({
    inventory: phaseKObservabilityInventory,
    gate: phaseKGate
  });

  phaseKNormalizedInventory = buildWordpressPhaseKNormalizedInventory({
    inventory: phaseKObservabilityInventory
  });

  phaseKNormalizedInventoryArtifact = buildWordpressPhaseKNormalizedInventoryArtifact({
    normalizedInventory: phaseKNormalizedInventory,
    gate: phaseKGate
  });

  phaseKReadinessGate = buildWordpressPhaseKReadinessGate({
    phaseKPlan,
    phaseKGate,
    normalizedInventory: phaseKNormalizedInventory
  });

  phaseKSafeCandidates = buildWordpressPhaseKSafeCandidates({
    readiness: phaseKReadinessGate,
    normalizedInventory: phaseKNormalizedInventory,
    limit: payload?.migration?.observability_monitoring?.safe_candidate_limit
  });

  phaseKReadinessArtifact = buildWordpressPhaseKReadinessArtifact({
    readiness: phaseKReadinessGate,
    safeCandidates: phaseKSafeCandidates
  });

  phaseKReconciliationPayloadPlanner = buildWordpressPhaseKReconciliationPayloadPlanner({
    safeCandidates: phaseKSafeCandidates
  });

  phaseKReconciliationPayloadArtifact = buildWordpressPhaseKReconciliationPayloadArtifact({
    planner: phaseKReconciliationPayloadPlanner
  });

  phaseKExecutionPlan = resolveWordpressPhaseKExecutionPlan(payload);

  phaseKExecutionGuard = buildWordpressPhaseKExecutionGuard({
    phaseKPlan,
    phaseKGate,
    readiness: phaseKReadinessGate,
    payloadPlanner: phaseKReconciliationPayloadPlanner,
    executionPlan: phaseKExecutionPlan
  });

  phaseKExecutionGuardArtifact = buildWordpressPhaseKExecutionGuardArtifact({
    guard: phaseKExecutionGuard
  });

  phaseKMutationCandidateSelector = buildWordpressPhaseKMutationCandidateSelector({
    executionGuard: phaseKExecutionGuard,
    payloadPlanner: phaseKReconciliationPayloadPlanner,
    executionPlan: phaseKExecutionPlan
  });

  phaseKMutationCandidateArtifact = buildWordpressPhaseKMutationCandidateArtifact({
    selector: phaseKMutationCandidateSelector
  });

  phaseKMutationPayloadComposer = buildWordpressPhaseKMutationPayloadComposer({
    selector: phaseKMutationCandidateSelector
  });

  phaseKMutationPayloadArtifact = buildWordpressPhaseKMutationPayloadArtifact({
    composer: phaseKMutationPayloadComposer
  });

  phaseKDryRunExecutionSimulator = buildWordpressPhaseKDryRunExecutionSimulator({
    composer: phaseKMutationPayloadComposer
  });

  phaseKDryRunExecutionArtifact = buildWordpressPhaseKDryRunExecutionArtifact({
    simulator: phaseKDryRunExecutionSimulator
  });
  phaseKFinalOperatorHandoffBundle = buildWordpressPhaseKFinalOperatorHandoffBundle({
    payload,
    phaseKPlan,
    phaseKGate,
    inventoryArtifact: phaseKInventoryArtifact,
    normalizedInventoryArtifact: phaseKNormalizedInventoryArtifact,
    normalizedInventory: phaseKNormalizedInventory,
    readinessArtifact: phaseKReadinessArtifact,
    reconciliationPayloadArtifact: phaseKReconciliationPayloadArtifact,
    executionGuardArtifact: phaseKExecutionGuardArtifact,
    mutationCandidateArtifact: phaseKMutationCandidateArtifact,
    mutationPayloadArtifact: phaseKMutationPayloadArtifact,
    dryRunExecutionArtifact: phaseKDryRunExecutionArtifact
  });

  phaseLPlan = resolveWordpressPhaseLPlan(payload);
  phaseLGate = buildWordpressPhaseLGate({ plan: phaseLPlan, priorPhaseStatus: { phase_k_enabled: phaseKPlan.enabled, phase_k_status: phaseKFinalOperatorHandoffBundle.overall_status } });
  phaseLBackupRecoveryInventory = await runWordpressBackupRecoveryInventory({ plan: phaseLPlan });
  phaseLNormalizedInventory = buildWordpressPhaseLNormalizedInventory(phaseLBackupRecoveryInventory);
  phaseLReadinessGate = buildWordpressPhaseLReadinessGate({ plan: phaseLPlan, normalizedInventory: phaseLNormalizedInventory });
  phaseLSafeCandidates = buildWordpressPhaseLSafeCandidates({ plan: phaseLPlan, normalizedInventory: phaseLNormalizedInventory, readinessGate: phaseLReadinessGate });
  phaseLReconciliationPayloadPlanner = buildWordpressPhaseLReconciliationPayloadPlanner({ plan: phaseLPlan, safeCandidates: phaseLSafeCandidates, normalizedInventory: phaseLNormalizedInventory });
  phaseLExecutionPlan = resolveWordpressPhaseLExecutionPlan({ plan: phaseLPlan, reconciliationPlanner: phaseLReconciliationPayloadPlanner });
  phaseLExecutionGuard = buildWordpressPhaseLExecutionGuard({ plan: phaseLPlan, executionPlan: phaseLExecutionPlan, safeCandidates: phaseLSafeCandidates });
  phaseLMutationCandidateSelector = buildWordpressPhaseLMutationCandidateSelector({ plan: phaseLPlan, executionPlan: phaseLExecutionPlan, executionGuard: phaseLExecutionGuard });
  phaseLMutationCandidateArtifact = buildWordpressPhaseLMutationCandidateArtifact(phaseLMutationCandidateSelector);
  phaseLMutationPayloadComposer = buildWordpressPhaseLMutationPayloadComposer({ plan: phaseLPlan, mutationCandidateArtifact: phaseLMutationCandidateArtifact });
  phaseLMutationPayloadArtifact = buildWordpressPhaseLMutationPayloadArtifact(phaseLMutationPayloadComposer);
  phaseLDryRunExecutionSimulator = buildWordpressPhaseLDryRunExecutionSimulator({ plan: phaseLPlan, mutationPayloadArtifact: phaseLMutationPayloadArtifact });
  phaseLDryRunExecutionArtifact = buildWordpressPhaseLDryRunExecutionArtifact(phaseLDryRunExecutionSimulator);
  phaseLFinalOperatorHandoffBundle = buildWordpressPhaseLFinalOperatorHandoffBundle({
    plan: phaseLPlan,
    gate: phaseLGate,
    normalizedInventory: phaseLNormalizedInventory,
    readinessGate: phaseLReadinessGate,
    safeCandidates: phaseLSafeCandidates,
    reconciliationPlanner: phaseLReconciliationPayloadPlanner,
    executionPlan: phaseLExecutionPlan,
    executionGuard: phaseLExecutionGuard,
    mutationCandidateArtifact: phaseLMutationCandidateArtifact,
    mutationPayloadArtifact: phaseLMutationPayloadArtifact,
    dryRunArtifact: phaseLDryRunExecutionArtifact
  });

  phaseMPlan = resolveWordpressPhaseMPlan(payload);
  phaseMGate = buildWordpressPhaseMGate({ plan: phaseMPlan, priorPhaseStatus: { phase_l_enabled: phaseLPlan.enabled, phase_l_backup_healthy: phaseLFinalOperatorHandoffBundle.overall_status === "ready_for_execution" } });
  phaseMDeploymentReleaseInventory = await runWordpressDeploymentReleaseInventory({ plan: phaseMPlan });
  phaseMNormalizedInventory = buildWordpressPhaseMNormalizedInventory(phaseMDeploymentReleaseInventory);
  phaseMReadinessGate = buildWordpressPhaseMReadinessGate({ plan: phaseMPlan, normalizedInventory: phaseMNormalizedInventory });
  phaseMSafeCandidates = buildWordpressPhaseMSafeCandidates({ plan: phaseMPlan, normalizedInventory: phaseMNormalizedInventory, readinessGate: phaseMReadinessGate });
  phaseMReconciliationPayloadPlanner = buildWordpressPhaseMReconciliationPayloadPlanner({ plan: phaseMPlan, safeCandidates: phaseMSafeCandidates, normalizedInventory: phaseMNormalizedInventory });
  phaseMExecutionPlan = resolveWordpressPhaseMExecutionPlan({ plan: phaseMPlan, reconciliationPlanner: phaseMReconciliationPayloadPlanner });
  phaseMExecutionGuard = buildWordpressPhaseMExecutionGuard({ plan: phaseMPlan, executionPlan: phaseMExecutionPlan, safeCandidates: phaseMSafeCandidates });
  phaseMutationCandidateSelector = buildWordpressPhaseMMutationCandidateSelector({ plan: phaseMPlan, executionPlan: phaseMExecutionPlan, executionGuard: phaseMExecutionGuard });
  phaseMutationCandidateArtifact = buildWordpressPhaseMMutationCandidateArtifact(phaseMutationCandidateSelector);
  phaseMutationPayloadComposer = buildWordpressPhaseMMutationPayloadComposer({ plan: phaseMPlan, mutationCandidateArtifact: phaseMutationCandidateArtifact });
  phaseMutationPayloadArtifact = buildWordpressPhaseMMutationPayloadArtifact(phaseMutationPayloadComposer);
  phaseMDryRunExecutionSimulator = buildWordpressPhaseMDryRunExecutionSimulator({ plan: phaseMPlan, mutationPayloadArtifact: phaseMutationPayloadArtifact });
  phaseMDryRunExecutionArtifact = buildWordpressPhaseMDryRunExecutionArtifact(phaseMDryRunExecutionSimulator);
  phaseMFinalOperatorHandoffBundle = buildWordpressPhaseMFinalOperatorHandoffBundle({
    plan: phaseMPlan,
    gate: phaseMGate,
    normalizedInventory: phaseMNormalizedInventory,
    readinessGate: phaseMReadinessGate,
    safeCandidates: phaseMSafeCandidates,
    reconciliationPlanner: phaseMReconciliationPayloadPlanner,
    executionPlan: phaseMExecutionPlan,
    executionGuard: phaseMExecutionGuard,
    mutationCandidateArtifact: phaseMutationCandidateArtifact,
    mutationPayloadArtifact: phaseMutationPayloadArtifact,
    dryRunArtifact: phaseMDryRunExecutionArtifact
  });

  phaseNPlan = resolveWordpressPhaseNPlan(payload);
  phaseNGate = buildWordpressPhaseNGate({ plan: phaseNPlan, priorPhaseStatus: { phase_m_enabled: phaseMPlan.enabled, phase_m_status: phaseMFinalOperatorHandoffBundle.overall_status } });
  phaseNDataIntegrityInventory = await runWordpressDataIntegrityInventory({ plan: phaseNPlan });
  phaseNNormalizedInventory = buildWordpressPhaseNNormalizedInventory(phaseNDataIntegrityInventory);
  phaseNReadinessGate = buildWordpressPhaseNReadinessGate({ plan: phaseNPlan, normalizedInventory: phaseNNormalizedInventory });
  phaseNSafeCandidates = buildWordpressPhaseNSafeCandidates({ plan: phaseNPlan, normalizedInventory: phaseNNormalizedInventory, readinessGate: phaseNReadinessGate });
  phaseNReconciliationPayloadPlanner = buildWordpressPhaseNReconciliationPayloadPlanner({ plan: phaseNPlan, safeCandidates: phaseNSafeCandidates, normalizedInventory: phaseNNormalizedInventory });
  phaseNExecutionPlan = resolveWordpressPhaseNExecutionPlan({ plan: phaseNPlan, reconciliationPlanner: phaseNReconciliationPayloadPlanner });
  phaseNExecutionGuard = buildWordpressPhaseNExecutionGuard({ plan: phaseNPlan, executionPlan: phaseNExecutionPlan, safeCandidates: phaseNSafeCandidates });
  phaseNMutationCandidateSelector = buildWordpressPhaseNMutationCandidateSelector({ plan: phaseNPlan, executionPlan: phaseNExecutionPlan, executionGuard: phaseNExecutionGuard });
  phaseNMutationCandidateArtifact = buildWordpressPhaseNMutationCandidateArtifact(phaseNMutationCandidateSelector);
  phaseNMutationPayloadComposer = buildWordpressPhaseNMutationPayloadComposer({ plan: phaseNPlan, mutationCandidateArtifact: phaseNMutationCandidateArtifact });
  phaseNMutationPayloadArtifact = buildWordpressPhaseNMutationPayloadArtifact(phaseNMutationPayloadComposer);
  phaseNDryRunExecutionSimulator = buildWordpressPhaseNDryRunExecutionSimulator({ plan: phaseNPlan, mutationPayloadArtifact: phaseNMutationPayloadArtifact });
  phaseNDryRunExecutionArtifact = buildWordpressPhaseNDryRunExecutionArtifact(phaseNDryRunExecutionSimulator);
  phaseNFinalOperatorHandoffBundle = buildWordpressPhaseNFinalOperatorHandoffBundle({
    plan: phaseNPlan,
    gate: phaseNGate,
    normalizedInventory: phaseNNormalizedInventory,
    readinessGate: phaseNReadinessGate,
    safeCandidates: phaseNSafeCandidates,
    reconciliationPlanner: phaseNReconciliationPayloadPlanner,
    executionPlan: phaseNExecutionPlan,
    executionGuard: phaseNExecutionGuard,
    mutationCandidateArtifact: phaseNMutationCandidateArtifact,
    mutationPayloadArtifact: phaseNMutationPayloadArtifact,
    dryRunArtifact: phaseNDryRunExecutionArtifact
  });

  phaseOPlan = resolveWordpressPhaseOPlan(payload);
  phaseOGate = buildWordpressPhaseOGate({ plan: phaseOPlan, priorPhaseStatus: { phase_n_enabled: phaseNPlan.enabled, phase_n_status: phaseNFinalOperatorHandoffBundle.overall_status } });
  phaseOQaAcceptanceInventory = await runWordpressQaAcceptanceInventory({ plan: phaseOPlan });
  phaseONormalizedInventory = buildWordpressPhaseONormalizedInventory(phaseOQaAcceptanceInventory);
  phaseOReadinessGate = buildWordpressPhaseOReadinessGate({ plan: phaseOPlan, normalizedInventory: phaseONormalizedInventory });
  phaseOSafeCandidates = buildWordpressPhaseOSafeCandidates({ plan: phaseOPlan, normalizedInventory: phaseONormalizedInventory, readinessGate: phaseOReadinessGate });
  phaseOReconciliationPayloadPlanner = buildWordpressPhaseOReconciliationPayloadPlanner({ plan: phaseOPlan, safeCandidates: phaseOSafeCandidates, normalizedInventory: phaseONormalizedInventory });
  phaseOExecutionPlan = resolveWordpressPhaseOExecutionPlan({ plan: phaseOPlan, reconciliationPlanner: phaseOReconciliationPayloadPlanner });
  phaseOExecutionGuard = buildWordpressPhaseOExecutionGuard({ plan: phaseOPlan, executionPlan: phaseOExecutionPlan, safeCandidates: phaseOSafeCandidates });
  phaseOMutationCandidateSelector = buildWordpressPhaseOMutationCandidateSelector({ plan: phaseOPlan, executionPlan: phaseOExecutionPlan, executionGuard: phaseOExecutionGuard });
  phaseOMutationCandidateArtifact = buildWordpressPhaseOMutationCandidateArtifact(phaseOMutationCandidateSelector);
  phaseOMutationPayloadComposer = buildWordpressPhaseOMutationPayloadComposer({ plan: phaseOPlan, mutationCandidateArtifact: phaseOMutationCandidateArtifact });
  phaseOMutationPayloadArtifact = buildWordpressPhaseOMutationPayloadArtifact(phaseOMutationPayloadComposer);
  phaseODryRunExecutionSimulator = buildWordpressPhaseODryRunExecutionSimulator({ plan: phaseOPlan, mutationPayloadArtifact: phaseOMutationPayloadArtifact });
  phaseODryRunExecutionArtifact = buildWordpressPhaseODryRunExecutionArtifact(phaseODryRunExecutionSimulator);
  phaseOFinalOperatorHandoffBundle = buildWordpressPhaseOFinalOperatorHandoffBundle({
    plan: phaseOPlan,
    gate: phaseOGate,
    normalizedInventory: phaseONormalizedInventory,
    readinessGate: phaseOReadinessGate,
    safeCandidates: phaseOSafeCandidates,
    reconciliationPlanner: phaseOReconciliationPayloadPlanner,
    executionPlan: phaseOExecutionPlan,
    executionGuard: phaseOExecutionGuard,
    mutationCandidateArtifact: phaseOMutationCandidateArtifact,
    mutationPayloadArtifact: phaseOMutationPayloadArtifact,
    dryRunArtifact: phaseODryRunExecutionArtifact
  });
  phasePPlan = resolveWordpressPhasePPlan(payload);
  phasePGate = buildWordpressPhasePGate({ plan: phasePPlan, priorPhaseStatus: { phase_o_enabled: phaseOPlan.enabled, phase_o_status: phaseOFinalOperatorHandoffBundle.overall_status } });
  phasePProductionCutoverInventory = await runWordpressProductionCutoverInventory({ plan: phasePPlan });
  phasePNormalizedInventory = buildWordpressPhasePNormalizedInventory(phasePProductionCutoverInventory);
  phasePReadinessGate = buildWordpressPhasePReadinessGate({ plan: phasePPlan, normalizedInventory: phasePNormalizedInventory });
  phasePSafeCandidates = buildWordpressPhasePSafeCandidates({ plan: phasePPlan, normalizedInventory: phasePNormalizedInventory, readinessGate: phasePReadinessGate });
  phasePReconciliationPayloadPlanner = buildWordpressPhasePReconciliationPayloadPlanner({ plan: phasePPlan, safeCandidates: phasePSafeCandidates, normalizedInventory: phasePNormalizedInventory });
  phasePExecutionPlan = resolveWordpressPhasePExecutionPlan({ plan: phasePPlan, reconciliationPlanner: phasePReconciliationPayloadPlanner });
  phasePExecutionGuard = buildWordpressPhasePExecutionGuard({ plan: phasePPlan, executionPlan: phasePExecutionPlan, safeCandidates: phasePSafeCandidates });
  phasePMutationCandidateSelector = buildWordpressPhasePMutationCandidateSelector({ plan: phasePPlan, executionPlan: phasePExecutionPlan, executionGuard: phasePExecutionGuard });
  phasePMutationCandidateArtifact = buildWordpressPhasePMutationCandidateArtifact(phasePMutationCandidateSelector);
  phasePMutationPayloadComposer = buildWordpressPhasePMutationPayloadComposer({ plan: phasePPlan, mutationCandidateArtifact: phasePMutationCandidateArtifact });
  phasePMutationPayloadArtifact = buildWordpressPhasePMutationPayloadArtifact(phasePMutationPayloadComposer);
  phasePDryRunExecutionSimulator = buildWordpressPhasePDryRunExecutionSimulator({ plan: phasePPlan, mutationPayloadArtifact: phasePMutationPayloadArtifact });
  phasePDryRunExecutionArtifact = buildWordpressPhasePDryRunExecutionArtifact(phasePDryRunExecutionSimulator);
  phasePFinalOperatorHandoffBundle = buildWordpressPhasePFinalOperatorHandoffBundle({
    plan: phasePPlan,
    gate: phasePGate,
    normalizedInventory: phasePNormalizedInventory,
    readinessGate: phasePReadinessGate,
    safeCandidates: phasePSafeCandidates,
    reconciliationPlanner: phasePReconciliationPayloadPlanner,
    executionPlan: phasePExecutionPlan,
    executionGuard: phasePExecutionGuard,
    mutationCandidateArtifact: phasePMutationCandidateArtifact,
    mutationPayloadArtifact: phasePMutationPayloadArtifact,
    dryRunArtifact: phasePDryRunExecutionArtifact
  });

  const readbackVerified =
    destinationStatuses.length > 0 &&
    destinationStatuses.every(row => row.readback_verified === true) &&
    deferredRepairFailures.length === 0;

  const destinationIds = [
    ...new Set(
      destinationStatuses
        .map(row => Number(row.destination_id))
        .filter(id => Number.isFinite(id) && id > 0)
    )
  ];

  const mutationEvidence = {
    transport: "wordpress_connector",
    apply: true,
    parent_action_key: "wordpress_api",
    execution_stage: classifyWordpressExecutionStage(payload),
    publish_mode: "draft_first",
    phase_a_scope: "content_safe_migration",
    phase_a_scope_classifications: phaseAScopeClassifications,
    phase_a_execution_order: postTypes,
    phase_a_batch_policy: batchPolicy,
    phase_a_batch_telemetry: phaseABatchTelemetry,
    phase_a_retry_policy: retryPolicy,
    phase_a_retry_telemetry: phaseARetryTelemetry,
    phase_a_resume_policy: resumePolicy,
    phase_a_checkpoint: phaseACheckpoint,
    phase_a_per_type_summary: phaseAPerTypeSummary,
    phase_a_outcome: phaseAOutcome.phase_a_outcome,
    phase_a_outcome_message: phaseAOutcome.phase_a_outcome_message,
    phase_a_operator_artifact: phaseAOperatorArtifact,
    phase_a_promotion_guard: phaseAPromotionGuard,
    selective_publish_candidates: selectivePublishCandidates,
    selective_publish_plan: selectivePublishPlan,
    selective_publish_execution: selectivePublishExecution,
    selective_publish_rollback_plan: selectivePublishRollbackPlan,
    selective_publish_rollback_execution_plan: selectivePublishRollbackExecutionPlan,
    selective_publish_rollback_execution: selectivePublishRollbackExecution,
    phase_a_cutover_journal: phaseACutoverJournal,
    phase_a_final_cutover_recommendation: phaseAFinalCutoverRecommendation,
    phase_a_final_operator_handoff_bundle: phaseAFinalOperatorHandoffBundle,
    phase_b_plan: phaseBPlan,
    phase_b_plan_status: phaseBPlanStatus,
    phase_b_gate: phaseBGate,
    phase_b_inventory_audit: phaseBInventoryAudit,
    phase_b_normalized_audit: phaseBNormalizedAudit,
    phase_b_graph_stability: phaseBGraphStability,
    phase_b_readiness_artifact: phaseBReadinessArtifact,
    phase_b_planning_candidates: phaseBPlanningCandidates,
    phase_b_planning_artifact: phaseBPlanningArtifact,
    phase_b_sequence_planner: phaseBSequencePlanner,
    phase_b_sequence_artifact: phaseBSequenceArtifact,
    phase_b_mapping_prerequisite_gate: phaseBMappingPrerequisiteGate,
    phase_b_mapping_prerequisite_artifact: phaseBMappingPrerequisiteArtifact,
    phase_b_mapping_plan_skeleton: phaseBMappingPlanSkeleton,
    phase_b_mapping_plan_artifact: phaseBMappingPlanArtifact,
    phase_b_field_mapping_resolver: phaseBFieldMappingResolver,
    phase_b_field_mapping_artifact: phaseBFieldMappingArtifact,
    phase_b_dry_run_planner: phaseBDryRunPlanner,
    phase_b_dry_run_artifact: phaseBDryRunArtifact,
    phase_b_execution_plan: phaseBExecutionPlan,
    phase_b_execution_guard: phaseBExecutionGuard,
    phase_b_execution_guard_artifact: phaseBExecutionGuardArtifact,
    phase_b_mutation_candidate_selector: phaseBMutationCandidateSelector,
    phase_b_mutation_candidate_artifact: phaseBMutationCandidateArtifact,
    phase_b_mutation_payload_composer: phaseBMutationPayloadComposer,
    phase_b_mutation_payload_artifact: phaseBMutationPayloadArtifact,
    phase_b_dry_run_execution_simulator: phaseBDryRunExecutionSimulator,
    phase_b_dry_run_execution_artifact: phaseBDryRunExecutionArtifact,
    phase_b_final_operator_handoff_bundle: phaseBFinalOperatorHandoffBundle,
    phase_c_plan: phaseCPlan,
    phase_c_plan_status: phaseCPlanStatus,
    phase_c_gate: phaseCGate,
    phase_c_settings_inventory: phaseCSettingsInventory,
    phase_c_inventory_artifact: phaseCInventoryArtifact,
    phase_c_normalized_diff: phaseCNormalizedDiff,
    phase_c_diff_artifact: phaseCDiffArtifact,
    phase_c_reconciliation_readiness: phaseCReconciliationReadiness,
    phase_c_safe_apply_candidates: phaseCSafeApplyCandidates,
    phase_c_readiness_artifact: phaseCReadinessArtifact,
    phase_c_reconciliation_payload_planner: phaseCReconciliationPayloadPlanner,
    phase_c_reconciliation_payload_artifact: phaseCReconciliationPayloadArtifact,
    phase_c_execution_plan: phaseCExecutionPlan,
    phase_c_execution_guard: phaseCExecutionGuard,
    phase_c_execution_guard_artifact: phaseCExecutionGuardArtifact,
    phase_c_mutation_candidate_selector: phaseCMutationCandidateSelector,
    phase_c_mutation_candidate_artifact: phaseCMutationCandidateArtifact,
    phase_c_mutation_payload_composer: phaseCMutationPayloadComposer,
    phase_c_mutation_payload_artifact: phaseCMutationPayloadArtifact,
    phase_c_dry_run_execution_simulator: phaseCDryRunExecutionSimulator,
    phase_c_dry_run_execution_artifact: phaseCDryRunExecutionArtifact,
    phase_c_final_operator_handoff_bundle: phaseCFinalOperatorHandoffBundle,
    phase_d_plan: phaseDPlan,
    phase_d_plan_status: phaseDPlanStatus,
    phase_d_gate: phaseDGate,
    phase_d_forms_inventory: phaseDFormsInventory,
    phase_d_inventory_artifact: phaseDInventoryArtifact,
    phase_d_normalized_inventory: phaseDNormalizedInventory,
    phase_d_normalized_inventory_artifact: phaseDNormalizedInventoryArtifact,
    phase_d_readiness_gate: phaseDReadinessGate,
    phase_d_safe_candidates: phaseDSafeCandidates,
    phase_d_readiness_artifact: phaseDReadinessArtifact,
    phase_d_migration_payload_planner: phaseDMigrationPayloadPlanner,
    phase_d_migration_payload_artifact: phaseDMigrationPayloadArtifact,
    phase_d_execution_plan: phaseDExecutionPlan,
    phase_d_execution_guard: phaseDExecutionGuard,
    phase_d_execution_guard_artifact: phaseDExecutionGuardArtifact,
    phase_d_mutation_candidate_selector: phaseDMutationCandidateSelector,
    phase_d_mutation_candidate_artifact: phaseDMutationCandidateArtifact,
    phase_d_mutation_payload_composer: phaseDMutationPayloadComposer,
    phase_d_mutation_payload_artifact: phaseDMutationPayloadArtifact,
    phase_d_dry_run_execution_simulator: phaseDDryRunExecutionSimulator,
    phase_d_dry_run_execution_artifact: phaseDDryRunExecutionArtifact,
    phase_d_final_operator_handoff_bundle: phaseDFinalOperatorHandoffBundle,
    phase_e_plan: phaseEPlan,
    phase_e_plan_status: phaseEPlanStatus,
    phase_e_gate: phaseEGate,
    phase_e_media_inventory: phaseEMediaInventory,
    phase_e_inventory_artifact: phaseEInventoryArtifact,
    phase_e_normalized_inventory: phaseENormalizedInventory,
    phase_e_normalized_inventory_artifact: phaseENormalizedInventoryArtifact,
    phase_e_readiness_gate: phaseEReadinessGate,
    phase_e_safe_candidates: phaseESafeCandidates,
    phase_e_readiness_artifact: phaseEReadinessArtifact,
    phase_e_migration_payload_planner: phaseEMigrationPayloadPlanner,
    phase_e_migration_payload_artifact: phaseEMigrationPayloadArtifact,
    phase_e_execution_plan: phaseEExecutionPlan,
    phase_e_execution_guard: phaseEExecutionGuard,
    phase_e_execution_guard_artifact: phaseEExecutionGuardArtifact,
    phase_e_mutation_candidate_selector: phaseEMutationCandidateSelector,
    phase_e_mutation_candidate_artifact: phaseEMutationCandidateArtifact,
    phase_e_mutation_payload_composer: phaseEMutationPayloadComposer,
    phase_e_mutation_payload_artifact: phaseEMutationPayloadArtifact,
    phase_e_dry_run_execution_simulator: phaseEDryRunExecutionSimulator,
    phase_e_dry_run_execution_artifact: phaseEDryRunExecutionArtifact,
    phase_e_final_operator_handoff_bundle: phaseEFinalOperatorHandoffBundle,
    phase_f_plan: phaseFPlan,
    phase_f_plan_status: phaseFPlanStatus,
    phase_f_gate: phaseFGate,
    phase_f_users_roles_auth_inventory: phaseFUsersRolesAuthInventory,
    phase_f_inventory_artifact: phaseFInventoryArtifact,
    phase_f_normalized_inventory: phaseFNormalizedInventory,
    phase_f_normalized_inventory_artifact: phaseFNormalizedInventoryArtifact,
    phase_f_readiness_gate: phaseFReadinessGate,
    phase_f_safe_candidates: phaseFSafeCandidates,
    phase_f_readiness_artifact: phaseFReadinessArtifact,
    phase_f_reconciliation_payload_planner: phaseFReconciliationPayloadPlanner,
    phase_f_reconciliation_payload_artifact: phaseFReconciliationPayloadArtifact,
    phase_f_execution_plan: phaseFExecutionPlan,
    phase_f_execution_guard: phaseFExecutionGuard,
    phase_f_execution_guard_artifact: phaseFExecutionGuardArtifact,
    phase_f_mutation_candidate_selector: phaseFMutationCandidateSelector,
    phase_f_mutation_candidate_artifact: phaseFMutationCandidateArtifact,
    phase_f_mutation_payload_composer: phaseFMutationPayloadComposer,
    phase_f_mutation_payload_artifact: phaseFMutationPayloadArtifact,
    phase_f_dry_run_execution_simulator: phaseFDryRunExecutionSimulator,
    phase_f_dry_run_execution_artifact: phaseFDryRunExecutionArtifact,
    phase_f_final_operator_handoff_bundle: phaseFFinalOperatorHandoffBundle,
    phase_g_plan: phaseGPlan,
    phase_g_plan_status: phaseGPlanStatus,
    phase_g_gate: phaseGGate,
    phase_g_seo_inventory: phaseGSeoInventory,
    phase_g_inventory_artifact: phaseGInventoryArtifact,
    phase_g_normalized_inventory: phaseGNormalizedInventory,
    phase_g_normalized_inventory_artifact: phaseGNormalizedInventoryArtifact,
    phase_g_readiness_gate: phaseGReadinessGate,
    phase_g_safe_candidates: phaseGSafeCandidates,
    phase_g_readiness_artifact: phaseGReadinessArtifact,
    phase_g_reconciliation_payload_planner: phaseGReconciliationPayloadPlanner,
    phase_g_reconciliation_payload_artifact: phaseGReconciliationPayloadArtifact,
    phase_g_execution_plan: phaseGExecutionPlan,
    phase_g_execution_guard: phaseGExecutionGuard,
    phase_g_execution_guard_artifact: phaseGExecutionGuardArtifact,
    phase_g_mutation_candidate_selector: phaseGMutationCandidateSelector,
    phase_g_mutation_candidate_artifact: phaseGMutationCandidateArtifact,
    phase_g_mutation_payload_composer: phaseGMutationPayloadComposer,
    phase_g_mutation_payload_artifact: phaseGMutationPayloadArtifact,
    phase_g_dry_run_execution_simulator: phaseGDryRunExecutionSimulator,
    phase_g_dry_run_execution_artifact: phaseGDryRunExecutionArtifact,
    phase_g_final_operator_handoff_bundle: phaseGFinalOperatorHandoffBundle,
    phase_h_plan: phaseHPlan,
    phase_h_plan_status: phaseHPlanStatus,
    phase_h_gate: phaseHGate,
    phase_h_analytics_inventory: phaseHAnalyticsInventory,
    phase_h_inventory_artifact: phaseHInventoryArtifact,
    phase_h_normalized_inventory: phaseHNormalizedInventory,
    phase_h_normalized_inventory_artifact: phaseHNormalizedInventoryArtifact,
    phase_h_readiness_gate: phaseHReadinessGate,
    phase_h_safe_candidates: phaseHSafeCandidates,
    phase_h_readiness_artifact: phaseHReadinessArtifact,
    phase_h_reconciliation_payload_planner: phaseHReconciliationPayloadPlanner,
    phase_h_reconciliation_payload_artifact: phaseHReconciliationPayloadArtifact,
    phase_h_execution_plan: phaseHExecutionPlan,
    phase_h_execution_guard: phaseHExecutionGuard,
    phase_h_execution_guard_artifact: phaseHExecutionGuardArtifact,
    phase_h_mutation_candidate_selector: phaseHMutationCandidateSelector,
    phase_h_mutation_candidate_artifact: phaseHMutationCandidateArtifact,
    phase_h_mutation_payload_composer: phaseHMutationPayloadComposer,
    phase_h_mutation_payload_artifact: phaseHMutationPayloadArtifact,
    phase_h_dry_run_execution_simulator: phaseHDryRunExecutionSimulator,
    phase_h_dry_run_execution_artifact: phaseHDryRunExecutionArtifact,
    phase_h_final_operator_handoff_bundle: phaseHFinalOperatorHandoffBundle,
    phase_i_plan: phaseIPlan,
    phase_i_plan_status: phaseIPlanStatus,
    phase_i_gate: phaseIGate,
    phase_i_performance_inventory: phaseIPerformanceInventory,
    phase_i_inventory_artifact: phaseIInventoryArtifact,
    phase_i_normalized_inventory: phaseINormalizedInventory,
    phase_i_normalized_inventory_artifact: phaseINormalizedInventoryArtifact,
    phase_i_readiness_gate: phaseIReadinessGate,
    phase_i_safe_candidates: phaseISafeCandidates,
    phase_i_readiness_artifact: phaseIReadinessArtifact,
    phase_i_reconciliation_payload_planner: phaseIReconciliationPayloadPlanner,
    phase_i_reconciliation_payload_artifact: phaseIReconciliationPayloadArtifact,
    phase_i_execution_plan: phaseIExecutionPlan,
    phase_i_execution_guard: phaseIExecutionGuard,
    phase_i_execution_guard_artifact: phaseIExecutionGuardArtifact,
    phase_i_mutation_candidate_selector: phaseIMutationCandidateSelector,
    phase_i_mutation_candidate_artifact: phaseIMutationCandidateArtifact,
    phase_i_mutation_payload_composer: phaseIMutationPayloadComposer,
    phase_i_mutation_payload_artifact: phaseIMutationPayloadArtifact,
    phase_i_dry_run_execution_simulator: phaseIDryRunExecutionSimulator,
    phase_i_dry_run_execution_artifact: phaseIDryRunExecutionArtifact,
    phase_i_final_operator_handoff_bundle: phaseIFinalOperatorHandoffBundle,
    phase_j_plan: phaseJPlan,
    phase_j_plan_status: phaseJPlanStatus,
    phase_j_gate: phaseJGate,
    phase_j_security_inventory: phaseJSecurityInventory,
    phase_j_inventory_artifact: phaseJInventoryArtifact,
    phase_j_normalized_inventory: phaseJNormalizedInventory,
    phase_j_normalized_inventory_artifact: phaseJNormalizedInventoryArtifact,
    phase_j_readiness_gate: phaseJReadinessGate,
    phase_j_safe_candidates: phaseJSafeCandidates,
    phase_j_readiness_artifact: phaseJReadinessArtifact,
    phase_j_reconciliation_payload_planner: phaseJReconciliationPayloadPlanner,
    phase_j_reconciliation_payload_artifact: phaseJReconciliationPayloadArtifact,
    phase_j_execution_plan: phaseJExecutionPlan,
    phase_j_execution_guard: phaseJExecutionGuard,
    phase_j_execution_guard_artifact: phaseJExecutionGuardArtifact,
    phase_j_mutation_candidate_selector: phaseJMutationCandidateSelector,
    phase_j_mutation_candidate_artifact: phaseJMutationCandidateArtifact,
    phase_j_mutation_payload_composer: phaseJMutationPayloadComposer,
    phase_j_mutation_payload_artifact: phaseJMutationPayloadArtifact,
    phase_j_dry_run_execution_simulator: phaseJDryRunExecutionSimulator,
    phase_j_dry_run_execution_artifact: phaseJDryRunExecutionArtifact,
    phase_j_final_operator_handoff_bundle: phaseJFinalOperatorHandoffBundle,
    phase_k_plan: phaseKPlan,
    phase_k_plan_status: phaseKPlanStatus,
    phase_k_gate: phaseKGate,
    phase_k_observability_inventory: phaseKObservabilityInventory,
    phase_k_inventory_artifact: phaseKInventoryArtifact,
    phase_k_normalized_inventory: phaseKNormalizedInventory,
    phase_k_normalized_inventory_artifact: phaseKNormalizedInventoryArtifact,
    phase_k_readiness_gate: phaseKReadinessGate,
    phase_k_safe_candidates: phaseKSafeCandidates,
    phase_k_readiness_artifact: phaseKReadinessArtifact,
    phase_k_reconciliation_payload_planner: phaseKReconciliationPayloadPlanner,
    phase_k_reconciliation_payload_artifact: phaseKReconciliationPayloadArtifact,
    phase_k_execution_plan: phaseKExecutionPlan,
    phase_k_execution_guard: phaseKExecutionGuard,
    phase_k_execution_guard_artifact: phaseKExecutionGuardArtifact,
    phase_k_mutation_candidate_selector: phaseKMutationCandidateSelector,
    phase_k_mutation_candidate_artifact: phaseKMutationCandidateArtifact,
    phase_k_mutation_payload_composer: phaseKMutationPayloadComposer,
    phase_k_mutation_payload_artifact: phaseKMutationPayloadArtifact,
    phase_k_dry_run_execution_simulator: phaseKDryRunExecutionSimulator,
    phase_k_dry_run_execution_artifact: phaseKDryRunExecutionArtifact,
    phase_k_final_operator_handoff_bundle: phaseKFinalOperatorHandoffBundle,
    phase_l_plan: phaseLPlan,
    phase_l_gate: phaseLGate,
    phase_l_backup_recovery_inventory: phaseLBackupRecoveryInventory,
    phase_l_normalized_inventory: phaseLNormalizedInventory,
    phase_l_readiness_gate: phaseLReadinessGate,
    phase_l_safe_candidates: phaseLSafeCandidates,
    phase_l_reconciliation_payload_planner: phaseLReconciliationPayloadPlanner,
    phase_l_execution_plan: phaseLExecutionPlan,
    phase_l_execution_guard: phaseLExecutionGuard,
    phase_l_mutation_candidate_artifact: phaseLMutationCandidateArtifact,
    phase_l_mutation_payload_artifact: phaseLMutationPayloadArtifact,
    phase_l_dry_run_execution_simulator: phaseLDryRunExecutionSimulator,
    phase_l_dry_run_execution_artifact: phaseLDryRunExecutionArtifact,
    phase_l_final_operator_handoff_bundle: phaseLFinalOperatorHandoffBundle,
    phase_m_plan: phaseMPlan,
    phase_m_gate: phaseMGate,
    phase_m_deployment_release_inventory: phaseMDeploymentReleaseInventory,
    phase_m_normalized_inventory: phaseMNormalizedInventory,
    phase_m_readiness_gate: phaseMReadinessGate,
    phase_m_safe_candidates: phaseMSafeCandidates,
    phase_m_reconciliation_payload_planner: phaseMReconciliationPayloadPlanner,
    phase_m_execution_plan: phaseMExecutionPlan,
    phase_m_execution_guard: phaseMExecutionGuard,
    phase_m_mutation_candidate_artifact: phaseMutationCandidateArtifact,
    phase_m_mutation_payload_artifact: phaseMutationPayloadArtifact,
    phase_m_dry_run_execution_simulator: phaseMDryRunExecutionSimulator,
    phase_m_dry_run_execution_artifact: phaseMDryRunExecutionArtifact,
    phase_m_final_operator_handoff_bundle: phaseMFinalOperatorHandoffBundle,
    phase_n_plan: phaseNPlan,
    phase_n_gate: phaseNGate,
    phase_n_data_integrity_inventory: phaseNDataIntegrityInventory,
    phase_n_normalized_inventory: phaseNNormalizedInventory,
    phase_n_readiness_gate: phaseNReadinessGate,
    phase_n_safe_candidates: phaseNSafeCandidates,
    phase_n_reconciliation_payload_planner: phaseNReconciliationPayloadPlanner,
    phase_n_execution_plan: phaseNExecutionPlan,
    phase_n_execution_guard: phaseNExecutionGuard,
    phase_n_mutation_candidate_artifact: phaseNMutationCandidateArtifact,
    phase_n_mutation_payload_artifact: phaseNMutationPayloadArtifact,
    phase_n_dry_run_execution_simulator: phaseNDryRunExecutionSimulator,
    phase_n_dry_run_execution_artifact: phaseNDryRunExecutionArtifact,
    phase_n_final_operator_handoff_bundle: phaseNFinalOperatorHandoffBundle,
    phase_o_plan: phaseOPlan,
    phase_o_gate: phaseOGate,
    phase_o_qa_acceptance_inventory: phaseOQaAcceptanceInventory,
    phase_o_normalized_inventory: phaseONormalizedInventory,
    phase_o_readiness_gate: phaseOReadinessGate,
    phase_o_safe_candidates: phaseOSafeCandidates,
    phase_o_reconciliation_payload_planner: phaseOReconciliationPayloadPlanner,
    phase_o_execution_plan: phaseOExecutionPlan,
    phase_o_execution_guard: phaseOExecutionGuard,
    phase_o_mutation_candidate_artifact: phaseOMutationCandidateArtifact,
    phase_o_mutation_payload_artifact: phaseOMutationPayloadArtifact,
    phase_o_dry_run_execution_simulator: phaseODryRunExecutionSimulator,
    phase_o_dry_run_execution_artifact: phaseODryRunExecutionArtifact,
    phase_o_final_operator_handoff_bundle: phaseOFinalOperatorHandoffBundle,
    phase_p_plan: phasePPlan,
    phase_p_gate: phasePGate,
    phase_p_production_cutover_inventory: phasePProductionCutoverInventory,
    phase_p_normalized_inventory: phasePNormalizedInventory,
    phase_p_readiness_gate: phasePReadinessGate,
    phase_p_safe_candidates: phasePSafeCandidates,
    phase_p_reconciliation_payload_planner: phasePReconciliationPayloadPlanner,
    phase_p_execution_plan: phasePExecutionPlan,
    phase_p_execution_guard: phasePExecutionGuard,
    phase_p_mutation_candidate_artifact: phasePMutationCandidateArtifact,
    phase_p_mutation_payload_artifact: phasePMutationPayloadArtifact,
    phase_p_dry_run_execution_simulator: phasePDryRunExecutionSimulator,
    phase_p_dry_run_execution_artifact: phasePDryRunExecutionArtifact,
    phase_p_final_operator_handoff_bundle: phasePFinalOperatorHandoffBundle,
    governed_resolution_domain: "endpoint_registry_adapter",
    governed_resolution_query: governedResolutionRecords.map(x => x.normalized_query),
    governed_resolution_selected_candidate: governedResolutionRecords.map(
      x => x.selected_candidate_key
    ),
    governed_resolution_confidence: governedResolutionRecords.map(
      x => x.selection_confidence
    ),
    governed_resolution_basis: governedResolutionRecords.map(
      x => x.selection_basis
    ),
    governed_resolution_rejected_candidates: governedResolutionRecords.map(
      x => x.rejected_candidate_summary
    ),
    generated_candidate: generatedCandidateEvidence.length > 0,
    generated_candidate_family: generatedCandidateEvidence,
    taxonomy_id_map: phaseAState.taxonomy_id_map,
    hierarchical_id_map: phaseAState.hierarchical_id_map,
    deferred_parent_repairs: deferredParentRepairs,
    deferred_taxonomy_repairs: deferredTaxonomyRepairs,
    deferred_featured_media_repairs: deferredFeaturedMediaRepairs,
    post_types: postTypes,
    post_type_resolution: postTypeResolution,
    publish_status: publishStatus,
    source_items_scanned: sourceItemsScanned,
    created_count: createdCount,
    updated_count: updatedCount,
    failed_count: allFailures.length,
    destination_ids: destinationIds,
    destination_statuses: destinationStatuses,
    readback_verified: readbackVerified,
    readback_checks: readbackChecks,
    deferred_parent_readback_checks: deferredParentReadbackChecks,
    deferred_taxonomy_readback_checks: deferredTaxonomyReadbackChecks,
    deferred_repair_failures: deferredRepairFailures,
    failures: allFailures
  };

  recordWordpressMutationWritebackEvidence(writebackPlan, mutationEvidence);

  wpContext.capability_state = wpContext.capability_state || {};
  wpContext.capability_state.writeback_required = true;
  wpContext.capability_state.writeback_surfaces = [
    ...new Set([
      ...(wpContext.capability_state.writeback_surfaces || []),
      "wordpress_connector_mutation_evidence"
    ])
  ];

  const executionStatus =
    allFailures.length === 0
      ? "success"
      : (createdCount + updatedCount > 0 ? "partial_success" : "failed");

  return {
    ok: phaseAOutcome.phase_a_outcome !== "failed",
    ...resultBase,
    execution_mode: "applied_mutation",
    execution_status: executionStatus,
    apply: true,
    publish_status: publishStatus,
    post_type_resolution: postTypeResolution,
    execution_stage: classifyWordpressExecutionStage(payload),
    publish_mode: "draft_first",
    phase_a_scope: "content_safe_migration",
    phase_a_scope_classifications: phaseAScopeClassifications,
    phase_a_execution_order: postTypes,
    phase_a_batch_policy: batchPolicy,
    phase_a_batch_telemetry: phaseABatchTelemetry,
    phase_a_retry_policy: retryPolicy,
    phase_a_retry_telemetry: phaseARetryTelemetry,
    phase_a_resume_policy: resumePolicy,
    phase_a_checkpoint: phaseACheckpoint,
    phase_a_per_type_summary: phaseAPerTypeSummary,
    phase_a_outcome: phaseAOutcome.phase_a_outcome,
    phase_a_outcome_message: phaseAOutcome.phase_a_outcome_message,
    phase_a_operator_artifact: phaseAOperatorArtifact,
    phase_a_promotion_guard: phaseAPromotionGuard,
    selective_publish_candidates: selectivePublishCandidates,
    selective_publish_plan: selectivePublishPlan,
    selective_publish_execution: selectivePublishExecution,
    selective_publish_rollback_plan: selectivePublishRollbackPlan,
    selective_publish_rollback_execution_plan: selectivePublishRollbackExecutionPlan,
    selective_publish_rollback_execution: selectivePublishRollbackExecution,
    phase_a_cutover_journal: phaseACutoverJournal,
    phase_a_final_cutover_recommendation: phaseAFinalCutoverRecommendation,
    phase_a_final_operator_handoff_bundle: phaseAFinalOperatorHandoffBundle,
    phase_b_plan: phaseBPlan,
    phase_b_plan_status: phaseBPlanStatus,
    phase_b_gate: phaseBGate,
    phase_b_inventory_audit: phaseBInventoryAudit,
    phase_b_normalized_audit: phaseBNormalizedAudit,
    phase_b_graph_stability: phaseBGraphStability,
    phase_b_readiness_artifact: phaseBReadinessArtifact,
    phase_b_planning_candidates: phaseBPlanningCandidates,
    phase_b_planning_artifact: phaseBPlanningArtifact,
    phase_b_sequence_planner: phaseBSequencePlanner,
    phase_b_sequence_artifact: phaseBSequenceArtifact,
    phase_b_mapping_prerequisite_gate: phaseBMappingPrerequisiteGate,
    phase_b_mapping_prerequisite_artifact: phaseBMappingPrerequisiteArtifact,
    phase_b_mapping_plan_skeleton: phaseBMappingPlanSkeleton,
    phase_b_mapping_plan_artifact: phaseBMappingPlanArtifact,
    phase_b_field_mapping_resolver: phaseBFieldMappingResolver,
    phase_b_field_mapping_artifact: phaseBFieldMappingArtifact,
    phase_b_dry_run_planner: phaseBDryRunPlanner,
    phase_b_dry_run_artifact: phaseBDryRunArtifact,
    phase_b_execution_plan: phaseBExecutionPlan,
    phase_b_execution_guard: phaseBExecutionGuard,
    phase_b_execution_guard_artifact: phaseBExecutionGuardArtifact,
    phase_b_mutation_candidate_selector: phaseBMutationCandidateSelector,
    phase_b_mutation_candidate_artifact: phaseBMutationCandidateArtifact,
    phase_b_mutation_payload_composer: phaseBMutationPayloadComposer,
    phase_b_mutation_payload_artifact: phaseBMutationPayloadArtifact,
    phase_b_dry_run_execution_simulator: phaseBDryRunExecutionSimulator,
    phase_b_dry_run_execution_artifact: phaseBDryRunExecutionArtifact,
    phase_b_final_operator_handoff_bundle: phaseBFinalOperatorHandoffBundle,
      phase_c_plan: phaseCPlan,
      phase_c_plan_status: phaseCPlanStatus,
      phase_c_gate: phaseCGate,
      phase_c_settings_inventory: phaseCSettingsInventory,
      phase_c_inventory_artifact: phaseCInventoryArtifact,
      phase_c_normalized_diff: phaseCNormalizedDiff,
      phase_c_diff_artifact: phaseCDiffArtifact,
      phase_c_reconciliation_readiness: phaseCReconciliationReadiness,
      phase_c_safe_apply_candidates: phaseCSafeApplyCandidates,
      phase_c_readiness_artifact: phaseCReadinessArtifact,
      phase_c_reconciliation_payload_planner: phaseCReconciliationPayloadPlanner,
      phase_c_reconciliation_payload_artifact: phaseCReconciliationPayloadArtifact,
      phase_c_execution_plan: phaseCExecutionPlan,
      phase_c_execution_guard: phaseCExecutionGuard,
      phase_c_execution_guard_artifact: phaseCExecutionGuardArtifact,
      phase_c_mutation_candidate_selector: phaseCMutationCandidateSelector,
      phase_c_mutation_candidate_artifact: phaseCMutationCandidateArtifact,
      phase_c_mutation_payload_composer: phaseCMutationPayloadComposer,
      phase_c_mutation_payload_artifact: phaseCMutationPayloadArtifact,
      phase_c_dry_run_execution_simulator: phaseCDryRunExecutionSimulator,
      phase_c_dry_run_execution_artifact: phaseCDryRunExecutionArtifact,
      phase_c_final_operator_handoff_bundle: phaseCFinalOperatorHandoffBundle,
      phase_d_plan: phaseDPlan,
      phase_d_plan_status: phaseDPlanStatus,
      phase_d_gate: phaseDGate,
      phase_d_forms_inventory: phaseDFormsInventory,
      phase_d_inventory_artifact: phaseDInventoryArtifact,
      phase_d_normalized_inventory: phaseDNormalizedInventory,
      phase_d_normalized_inventory_artifact: phaseDNormalizedInventoryArtifact,
      phase_d_readiness_gate: phaseDReadinessGate,
      phase_d_safe_candidates: phaseDSafeCandidates,
      phase_d_readiness_artifact: phaseDReadinessArtifact,
      phase_d_migration_payload_planner: phaseDMigrationPayloadPlanner,
      phase_d_migration_payload_artifact: phaseDMigrationPayloadArtifact,
      phase_d_execution_plan: phaseDExecutionPlan,
      phase_d_execution_guard: phaseDExecutionGuard,
      phase_d_execution_guard_artifact: phaseDExecutionGuardArtifact,
      phase_d_mutation_candidate_selector: phaseDMutationCandidateSelector,
      phase_d_mutation_candidate_artifact: phaseDMutationCandidateArtifact,
      phase_d_mutation_payload_composer: phaseDMutationPayloadComposer,
      phase_d_mutation_payload_artifact: phaseDMutationPayloadArtifact,
      phase_d_dry_run_execution_simulator: phaseDDryRunExecutionSimulator,
      phase_d_dry_run_execution_artifact: phaseDDryRunExecutionArtifact,
      phase_d_final_operator_handoff_bundle: phaseDFinalOperatorHandoffBundle,
      phase_e_plan: phaseEPlan,
      phase_e_plan_status: phaseEPlanStatus,
      phase_e_gate: phaseEGate,
      phase_e_media_inventory: phaseEMediaInventory,
      phase_e_inventory_artifact: phaseEInventoryArtifact,
      phase_e_normalized_inventory: phaseENormalizedInventory,
      phase_e_normalized_inventory_artifact: phaseENormalizedInventoryArtifact,
      phase_e_readiness_gate: phaseEReadinessGate,
      phase_e_safe_candidates: phaseESafeCandidates,
      phase_e_readiness_artifact: phaseEReadinessArtifact,
      phase_e_migration_payload_planner: phaseEMigrationPayloadPlanner,
      phase_e_migration_payload_artifact: phaseEMigrationPayloadArtifact,
      phase_e_execution_plan: phaseEExecutionPlan,
      phase_e_execution_guard: phaseEExecutionGuard,
      phase_e_execution_guard_artifact: phaseEExecutionGuardArtifact,
      phase_e_mutation_candidate_selector: phaseEMutationCandidateSelector,
      phase_e_mutation_candidate_artifact: phaseEMutationCandidateArtifact,
      phase_e_mutation_payload_composer: phaseEMutationPayloadComposer,
      phase_e_mutation_payload_artifact: phaseEMutationPayloadArtifact,
      phase_e_dry_run_execution_simulator: phaseEDryRunExecutionSimulator,
      phase_e_dry_run_execution_artifact: phaseEDryRunExecutionArtifact,
      phase_e_final_operator_handoff_bundle: phaseEFinalOperatorHandoffBundle,
      phase_f_plan: phaseFPlan,
      phase_f_plan_status: phaseFPlanStatus,
      phase_f_gate: phaseFGate,
      phase_f_users_roles_auth_inventory: phaseFUsersRolesAuthInventory,
      phase_f_inventory_artifact: phaseFInventoryArtifact,
      phase_f_normalized_inventory: phaseFNormalizedInventory,
      phase_f_normalized_inventory_artifact: phaseFNormalizedInventoryArtifact,
      phase_f_readiness_gate: phaseFReadinessGate,
      phase_f_safe_candidates: phaseFSafeCandidates,
      phase_f_readiness_artifact: phaseFReadinessArtifact,
      phase_f_reconciliation_payload_planner: phaseFReconciliationPayloadPlanner,
      phase_f_reconciliation_payload_artifact: phaseFReconciliationPayloadArtifact,
      phase_f_execution_plan: phaseFExecutionPlan,
      phase_f_execution_guard: phaseFExecutionGuard,
      phase_f_execution_guard_artifact: phaseFExecutionGuardArtifact,
      phase_f_mutation_candidate_selector: phaseFMutationCandidateSelector,
      phase_f_mutation_candidate_artifact: phaseFMutationCandidateArtifact,
      phase_f_mutation_payload_composer: phaseFMutationPayloadComposer,
      phase_f_mutation_payload_artifact: phaseFMutationPayloadArtifact,
      phase_f_dry_run_execution_simulator: phaseFDryRunExecutionSimulator,
      phase_f_dry_run_execution_artifact: phaseFDryRunExecutionArtifact,
      phase_f_final_operator_handoff_bundle: phaseFFinalOperatorHandoffBundle,
      phase_g_plan: phaseGPlan,
      phase_g_plan_status: phaseGPlanStatus,
      phase_g_gate: phaseGGate,
      phase_g_seo_inventory: phaseGSeoInventory,
      phase_g_inventory_artifact: phaseGInventoryArtifact,
      phase_g_normalized_inventory: phaseGNormalizedInventory,
      phase_g_normalized_inventory_artifact: phaseGNormalizedInventoryArtifact,
      phase_g_readiness_gate: phaseGReadinessGate,
      phase_g_safe_candidates: phaseGSafeCandidates,
      phase_g_readiness_artifact: phaseGReadinessArtifact,
      phase_g_reconciliation_payload_planner: phaseGReconciliationPayloadPlanner,
      phase_g_reconciliation_payload_artifact: phaseGReconciliationPayloadArtifact,
      phase_g_execution_plan: phaseGExecutionPlan,
      phase_g_execution_guard: phaseGExecutionGuard,
      phase_g_execution_guard_artifact: phaseGExecutionGuardArtifact,
      phase_g_mutation_candidate_selector: phaseGMutationCandidateSelector,
      phase_g_mutation_candidate_artifact: phaseGMutationCandidateArtifact,
      phase_g_mutation_payload_composer: phaseGMutationPayloadComposer,
      phase_g_mutation_payload_artifact: phaseGMutationPayloadArtifact,
      phase_g_dry_run_execution_simulator: phaseGDryRunExecutionSimulator,
      phase_g_dry_run_execution_artifact: phaseGDryRunExecutionArtifact,
      phase_g_final_operator_handoff_bundle: phaseGFinalOperatorHandoffBundle,
      phase_h_plan: phaseHPlan,
      phase_h_plan_status: phaseHPlanStatus,
      phase_h_gate: phaseHGate,
      phase_h_analytics_inventory: phaseHAnalyticsInventory,
      phase_h_inventory_artifact: phaseHInventoryArtifact,
      phase_h_normalized_inventory: phaseHNormalizedInventory,
      phase_h_normalized_inventory_artifact: phaseHNormalizedInventoryArtifact,
      phase_h_readiness_gate: phaseHReadinessGate,
      phase_h_safe_candidates: phaseHSafeCandidates,
      phase_h_readiness_artifact: phaseHReadinessArtifact,
      phase_h_reconciliation_payload_planner: phaseHReconciliationPayloadPlanner,
      phase_h_reconciliation_payload_artifact: phaseHReconciliationPayloadArtifact,
      phase_h_execution_plan: phaseHExecutionPlan,
      phase_h_execution_guard: phaseHExecutionGuard,
      phase_h_execution_guard_artifact: phaseHExecutionGuardArtifact,
      phase_h_mutation_candidate_selector: phaseHMutationCandidateSelector,
      phase_h_mutation_candidate_artifact: phaseHMutationCandidateArtifact,
      phase_h_mutation_payload_composer: phaseHMutationPayloadComposer,
      phase_h_mutation_payload_artifact: phaseHMutationPayloadArtifact,
      phase_h_dry_run_execution_simulator: phaseHDryRunExecutionSimulator,
      phase_h_dry_run_execution_artifact: phaseHDryRunExecutionArtifact,
      phase_h_final_operator_handoff_bundle: phaseHFinalOperatorHandoffBundle,
      phase_i_plan: phaseIPlan,
      phase_i_plan_status: phaseIPlanStatus,
      phase_i_gate: phaseIGate,
      phase_i_performance_inventory: phaseIPerformanceInventory,
      phase_i_inventory_artifact: phaseIInventoryArtifact,
      phase_i_inventory_status: phaseIPerformanceInventory.phase_i_inventory_status,
      phase_i_plugin_signals: phaseIPerformanceInventory.plugin_signals,
      phase_i_performance_summary: phaseIPerformanceInventory.summary,
      phase_i_cache_layer_rows: phaseIPerformanceInventory.cache_layer_rows,
      phase_i_asset_optimization_rows: phaseIPerformanceInventory.asset_optimization_rows,
      phase_i_image_optimization_rows: phaseIPerformanceInventory.image_optimization_rows,
      phase_i_cdn_rows: phaseIPerformanceInventory.cdn_rows,
      phase_i_lazyload_rows: phaseIPerformanceInventory.lazyload_rows,
      phase_i_normalized_inventory: phaseINormalizedInventory,
      phase_i_normalized_inventory_artifact: phaseINormalizedInventoryArtifact,
      phase_i_risk_summary: phaseINormalizedInventory.risk_summary,
      phase_i_normalized_cache_layer_rows:
        phaseINormalizedInventory.normalized_cache_layer_rows,
      phase_i_normalized_asset_optimization_rows:
        phaseINormalizedInventory.normalized_asset_optimization_rows,
      phase_i_normalized_image_optimization_rows:
        phaseINormalizedInventory.normalized_image_optimization_rows,
      phase_i_normalized_cdn_rows: phaseINormalizedInventory.normalized_cdn_rows,
      phase_i_normalized_lazyload_rows:
        phaseINormalizedInventory.normalized_lazyload_rows,
      phase_i_readiness_gate: phaseIReadinessGate,
      phase_i_safe_candidates: phaseISafeCandidates,
      phase_i_readiness_artifact: phaseIReadinessArtifact,
      phase_i_safe_candidate_status: phaseISafeCandidates.safe_candidate_status,
      phase_i_safe_cache_layer_candidates: phaseISafeCandidates.cache_layer_candidates,
      phase_i_safe_asset_optimization_candidates:
        phaseISafeCandidates.asset_optimization_candidates,
      phase_i_safe_image_optimization_candidates:
        phaseISafeCandidates.image_optimization_candidates,
      phase_i_safe_cdn_candidates: phaseISafeCandidates.cdn_candidates,
      phase_i_safe_lazyload_candidates: phaseISafeCandidates.lazyload_candidates,
      phase_i_reconciliation_payload_planner: phaseIReconciliationPayloadPlanner,
      phase_i_reconciliation_payload_artifact: phaseIReconciliationPayloadArtifact,
      phase_i_execution_plan: phaseIExecutionPlan,
      phase_i_execution_guard: phaseIExecutionGuard,
      phase_i_execution_guard_artifact: phaseIExecutionGuardArtifact,
      phase_i_mutation_candidate_selector: phaseIMutationCandidateSelector,
      phase_i_mutation_candidate_artifact: phaseIMutationCandidateArtifact,
      phase_i_mutation_payload_composer: phaseIMutationPayloadComposer,
      phase_i_mutation_payload_artifact: phaseIMutationPayloadArtifact,
      phase_i_dry_run_execution_simulator: phaseIDryRunExecutionSimulator,
      phase_i_dry_run_execution_artifact: phaseIDryRunExecutionArtifact,
      phase_i_final_operator_handoff_bundle: phaseIFinalOperatorHandoffBundle,
      phase_j_plan: phaseJPlan,
      phase_j_plan_status: phaseJPlanStatus,
      phase_j_gate: phaseJGate,
      phase_j_security_inventory: phaseJSecurityInventory,
      phase_j_inventory_artifact: phaseJInventoryArtifact,
      phase_j_inventory_status: phaseJSecurityInventory.phase_j_inventory_status,
      phase_j_plugin_signals: phaseJSecurityInventory.plugin_signals,
      phase_j_security_summary: phaseJSecurityInventory.summary,
      phase_j_security_header_rows: phaseJSecurityInventory.security_header_rows,
      phase_j_waf_rows: phaseJSecurityInventory.waf_rows,
      phase_j_hardening_control_rows: phaseJSecurityInventory.hardening_control_rows,
      phase_j_exposed_surface_rows: phaseJSecurityInventory.exposed_surface_rows,
      phase_j_tls_rows: phaseJSecurityInventory.tls_rows,
      phase_j_normalized_inventory: phaseJNormalizedInventory,
      phase_j_normalized_inventory_artifact: phaseJNormalizedInventoryArtifact,
      phase_j_risk_summary: phaseJNormalizedInventory.risk_summary,
      phase_j_normalized_security_header_rows:
        phaseJNormalizedInventory.normalized_security_header_rows,
      phase_j_normalized_waf_rows: phaseJNormalizedInventory.normalized_waf_rows,
      phase_j_normalized_hardening_control_rows:
        phaseJNormalizedInventory.normalized_hardening_control_rows,
      phase_j_normalized_exposed_surface_rows:
        phaseJNormalizedInventory.normalized_exposed_surface_rows,
      phase_j_normalized_tls_rows: phaseJNormalizedInventory.normalized_tls_rows,
      phase_j_readiness_gate: phaseJReadinessGate,
      phase_j_safe_candidates: phaseJSafeCandidates,
      phase_j_readiness_artifact: phaseJReadinessArtifact,
      phase_j_safe_candidate_status: phaseJSafeCandidates.safe_candidate_status,
      phase_j_safe_security_header_candidates:
        phaseJSafeCandidates.security_header_candidates,
      phase_j_safe_waf_candidates: phaseJSafeCandidates.waf_candidates,
      phase_j_safe_hardening_control_candidates:
        phaseJSafeCandidates.hardening_control_candidates,
      phase_j_safe_exposed_surface_candidates:
        phaseJSafeCandidates.exposed_surface_candidates,
      phase_j_safe_tls_candidates: phaseJSafeCandidates.tls_candidates,
      phase_j_reconciliation_payload_planner: phaseJReconciliationPayloadPlanner,
      phase_j_reconciliation_payload_artifact: phaseJReconciliationPayloadArtifact,
      phase_j_execution_plan: phaseJExecutionPlan,
      phase_j_execution_guard: phaseJExecutionGuard,
      phase_j_execution_guard_artifact: phaseJExecutionGuardArtifact,
      phase_j_mutation_candidate_selector: phaseJMutationCandidateSelector,
      phase_j_mutation_candidate_artifact: phaseJMutationCandidateArtifact,
      phase_j_mutation_payload_composer: phaseJMutationPayloadComposer,
      phase_j_mutation_payload_artifact: phaseJMutationPayloadArtifact,
      phase_j_dry_run_execution_simulator: phaseJDryRunExecutionSimulator,
      phase_j_dry_run_execution_artifact: phaseJDryRunExecutionArtifact,
      phase_j_final_operator_handoff_bundle: phaseJFinalOperatorHandoffBundle,
      phase_k_plan: phaseKPlan,
      phase_k_plan_status: phaseKPlanStatus,
      phase_k_gate: phaseKGate,
      phase_k_observability_inventory: phaseKObservabilityInventory,
      phase_k_inventory_artifact: phaseKInventoryArtifact,
      phase_k_inventory_status: phaseKObservabilityInventory.phase_k_inventory_status,
      phase_k_plugin_signals: phaseKObservabilityInventory.plugin_signals,
      phase_k_observability_summary: phaseKObservabilityInventory.summary,
      phase_k_logging_surface_rows: phaseKObservabilityInventory.logging_surface_rows,
      phase_k_alerting_surface_rows: phaseKObservabilityInventory.alerting_surface_rows,
      phase_k_monitoring_surface_rows: phaseKObservabilityInventory.monitoring_surface_rows,
      phase_k_error_tracking_rows: phaseKObservabilityInventory.error_tracking_rows,
      phase_k_uptime_surface_rows: phaseKObservabilityInventory.uptime_surface_rows,
      phase_k_normalized_inventory: phaseKNormalizedInventory,
      phase_k_normalized_inventory_artifact: phaseKNormalizedInventoryArtifact,
      phase_k_risk_summary: phaseKNormalizedInventory.risk_summary,
      phase_k_normalized_logging_surface_rows:
        phaseKNormalizedInventory.normalized_logging_surface_rows,
      phase_k_normalized_alerting_surface_rows:
        phaseKNormalizedInventory.normalized_alerting_surface_rows,
      phase_k_normalized_monitoring_surface_rows:
        phaseKNormalizedInventory.normalized_monitoring_surface_rows,
      phase_k_normalized_error_tracking_rows:
        phaseKNormalizedInventory.normalized_error_tracking_rows,
      phase_k_normalized_uptime_surface_rows:
        phaseKNormalizedInventory.normalized_uptime_surface_rows,
      phase_k_readiness_gate: phaseKReadinessGate,
      phase_k_safe_candidates: phaseKSafeCandidates,
      phase_k_readiness_artifact: phaseKReadinessArtifact,
      phase_k_safe_candidate_status: phaseKSafeCandidates.safe_candidate_status,
      phase_k_safe_logging_surface_candidates:
        phaseKSafeCandidates.logging_surface_candidates,
      phase_k_safe_alerting_surface_candidates:
        phaseKSafeCandidates.alerting_surface_candidates,
      phase_k_safe_monitoring_surface_candidates:
        phaseKSafeCandidates.monitoring_surface_candidates,
      phase_k_safe_error_tracking_candidates:
        phaseKSafeCandidates.error_tracking_candidates,
      phase_k_safe_uptime_surface_candidates:
        phaseKSafeCandidates.uptime_surface_candidates,
      phase_k_reconciliation_payload_planner: phaseKReconciliationPayloadPlanner,
      phase_k_reconciliation_payload_artifact: phaseKReconciliationPayloadArtifact,
      phase_k_execution_plan: phaseKExecutionPlan,
      phase_k_execution_guard: phaseKExecutionGuard,
      phase_k_execution_guard_artifact: phaseKExecutionGuardArtifact,
      phase_k_mutation_candidate_selector: phaseKMutationCandidateSelector,
      phase_k_mutation_candidate_artifact: phaseKMutationCandidateArtifact,
      phase_k_mutation_payload_composer: phaseKMutationPayloadComposer,
      phase_k_mutation_payload_artifact: phaseKMutationPayloadArtifact,
      phase_k_dry_run_execution_simulator: phaseKDryRunExecutionSimulator,
      phase_k_dry_run_execution_artifact: phaseKDryRunExecutionArtifact,
      phase_k_final_operator_handoff_bundle: phaseKFinalOperatorHandoffBundle,
      phase_l_plan: phaseLPlan,
      phase_l_gate: phaseLGate,
      phase_l_backup_recovery_inventory: phaseLBackupRecoveryInventory,
      phase_l_normalized_inventory: phaseLNormalizedInventory,
      phase_l_readiness_gate: phaseLReadinessGate,
      phase_l_safe_candidates: phaseLSafeCandidates,
      phase_l_reconciliation_payload_planner: phaseLReconciliationPayloadPlanner,
      phase_l_execution_plan: phaseLExecutionPlan,
      phase_l_execution_guard: phaseLExecutionGuard,
      phase_l_mutation_candidate_artifact: phaseLMutationCandidateArtifact,
      phase_l_mutation_payload_artifact: phaseLMutationPayloadArtifact,
      phase_l_dry_run_execution_simulator: phaseLDryRunExecutionSimulator,
      phase_l_dry_run_execution_artifact: phaseLDryRunExecutionArtifact,
      phase_l_final_operator_handoff_bundle: phaseLFinalOperatorHandoffBundle,
      phase_m_plan: phaseMPlan,
      phase_m_gate: phaseMGate,
      phase_m_deployment_release_inventory: phaseMDeploymentReleaseInventory,
      phase_m_normalized_inventory: phaseMNormalizedInventory,
      phase_m_readiness_gate: phaseMReadinessGate,
      phase_m_safe_candidates: phaseMSafeCandidates,
      phase_m_reconciliation_payload_planner: phaseMReconciliationPayloadPlanner,
      phase_m_execution_plan: phaseMExecutionPlan,
      phase_m_execution_guard: phaseMExecutionGuard,
      phase_m_mutation_candidate_artifact: phaseMutationCandidateArtifact,
      phase_m_mutation_payload_artifact: phaseMutationPayloadArtifact,
      phase_m_dry_run_execution_simulator: phaseMDryRunExecutionSimulator,
      phase_m_dry_run_execution_artifact: phaseMDryRunExecutionArtifact,
      phase_m_final_operator_handoff_bundle: phaseMFinalOperatorHandoffBundle,
      phase_n_plan: phaseNPlan,
      phase_n_gate: phaseNGate,
      phase_n_data_integrity_inventory: phaseNDataIntegrityInventory,
      phase_n_normalized_inventory: phaseNNormalizedInventory,
      phase_n_readiness_gate: phaseNReadinessGate,
      phase_n_safe_candidates: phaseNSafeCandidates,
      phase_n_reconciliation_payload_planner: phaseNReconciliationPayloadPlanner,
      phase_n_execution_plan: phaseNExecutionPlan,
      phase_n_execution_guard: phaseNExecutionGuard,
      phase_n_mutation_candidate_artifact: phaseNMutationCandidateArtifact,
      phase_n_mutation_payload_artifact: phaseNMutationPayloadArtifact,
      phase_n_dry_run_execution_simulator: phaseNDryRunExecutionSimulator,
      phase_n_dry_run_execution_artifact: phaseNDryRunExecutionArtifact,
      phase_n_final_operator_handoff_bundle: phaseNFinalOperatorHandoffBundle,
      phase_o_plan: phaseOPlan,
      phase_o_gate: phaseOGate,
      phase_o_qa_acceptance_inventory: phaseOQaAcceptanceInventory,
      phase_o_normalized_inventory: phaseONormalizedInventory,
      phase_o_readiness_gate: phaseOReadinessGate,
      phase_o_safe_candidates: phaseOSafeCandidates,
      phase_o_reconciliation_payload_planner: phaseOReconciliationPayloadPlanner,
      phase_o_execution_plan: phaseOExecutionPlan,
      phase_o_execution_guard: phaseOExecutionGuard,
      phase_o_mutation_candidate_artifact: phaseOMutationCandidateArtifact,
      phase_o_mutation_payload_artifact: phaseOMutationPayloadArtifact,
      phase_o_dry_run_execution_simulator: phaseODryRunExecutionSimulator,
      phase_o_dry_run_execution_artifact: phaseODryRunExecutionArtifact,
      phase_o_final_operator_handoff_bundle: phaseOFinalOperatorHandoffBundle,
      phase_p_plan: phasePPlan,
      phase_p_gate: phasePGate,
      phase_p_production_cutover_inventory: phasePProductionCutoverInventory,
      phase_p_normalized_inventory: phasePNormalizedInventory,
      phase_p_readiness_gate: phasePReadinessGate,
      phase_p_safe_candidates: phasePSafeCandidates,
      phase_p_reconciliation_payload_planner: phasePReconciliationPayloadPlanner,
      phase_p_execution_plan: phasePExecutionPlan,
      phase_p_execution_guard: phasePExecutionGuard,
      phase_p_mutation_candidate_artifact: phasePMutationCandidateArtifact,
      phase_p_mutation_payload_artifact: phasePMutationPayloadArtifact,
      phase_p_dry_run_execution_simulator: phasePDryRunExecutionSimulator,
      phase_p_dry_run_execution_artifact: phasePDryRunExecutionArtifact,
      phase_p_final_operator_handoff_bundle: phasePFinalOperatorHandoffBundle,
    phase_b_failures: phaseBInventoryAudit.failures,
    message: phaseAOutcome.phase_a_outcome_message,
    source_items_scanned: sourceItemsScanned,
    created_count: createdCount,
    updated_count: updatedCount,
    destination_ids: destinationIds,
    destination_statuses: destinationStatuses,
    readback_verified: readbackVerified,
    readback_checks: readbackChecks,
    failures: [
      ...allFailures,
      ...(selectivePublishExecution.failures || []),
      ...(selectivePublishRollbackExecution.failures || []),
      ...(phaseBInventoryAudit.failures || [])
    ]
  };
}
