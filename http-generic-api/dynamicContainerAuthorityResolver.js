import { randomUUID } from "node:crypto";
import {
  bindingMatchesDimensionRequest,
  buildContainerResolutionCacheKey,
  enumerateContainerPaths,
  operationPatternMatches,
  resolveContainerDimensionCandidates,
  resolveRoleTemplateComposition,
  stableSha256,
  validateNoSecretMetadata
} from "./dynamicContainerAuthority.js";
import {
  loadContainerAuthorityState,
  persistContainerResolution,
  persistShadowComparison,
  readContainerAuthorityEpoch,
  readContainerRolloutPolicy,
  readIdempotentResult,
  recordContainerPerformanceSample,
  storeIdempotentResult
} from "./dynamicContainerAuthorityRepository.js";

export const CONTAINER_AUTHORITY_RESOLVER_VERSION = "dynamic-container-authority-v1";
const resolutionCache = new Map();

function parseObject(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(String(value || "")); } catch { return fallback; }
}

function stableError(code, message, details = []) {
  const error = new Error(message);
  error.code = code;
  error.status = new Set(["container_not_found"]).has(code) ? 404
    : new Set(["container_cross_tenant_boundary","role_permission_insufficient"]).has(code) ? 403
      : new Set(["container_cycle_detected","container_path_ambiguous","container_authority_epoch_changed","idempotency_key_conflict"]).has(code) ? 409
        : 422;
  error.details = details;
  return error;
}

function normalizePrincipal(principal = {}) {
  const type = String(principal.type || "").trim().toLowerCase();
  const id = String(principal.id || "").trim();
  if (!new Set(["user","agent","service","group"]).has(type) || !id) throw stableError("principal_invalid", "A valid principal type and id are required.");
  return { type, id };
}

function normalizeDimensionRequests(requests) {
  if (!Array.isArray(requests) || requests.length < 1 || requests.length > 50) {
    throw stableError("dimension_requests_invalid", "dimensionRequests must contain between 1 and 50 entries.");
  }
  return requests.map((request, index) => {
    const normalized = {
      dimension: String(request?.dimension || "").trim(),
      resourceType: String(request?.resourceType || request?.resource_type || "").trim(),
      resourceRef: String(request?.resourceRef || request?.resource_ref || "").trim(),
      operation: String(request?.operation || "").trim(),
      capabilityKey: request?.capabilityKey ? String(request.capabilityKey) : null
    };
    if (!normalized.dimension || !normalized.resourceType || !normalized.resourceRef || !normalized.operation) {
      throw stableError("dimension_request_invalid", `dimensionRequests[${index}] is incomplete.`, [{ index }]);
    }
    if (normalized.resourceRef === "*" || normalized.operation === "*") {
      throw stableError("dimension_request_invalid", "Wildcard resources and operations are forbidden.", [{ index }]);
    }
    return normalized;
  });
}

function isReadOperation(operation = "") {
  const normalized = String(operation).toLowerCase();
  return /(^|\.)(get|list|read|search|preview|inspect|metadata|status|catalog|resolve|download)(\.|$)/.test(normalized)
    || normalized.startsWith("read.")
    || normalized.endsWith(".read_only");
}

function validateSimpleSchema(value, schema) {
  const parsed = parseObject(schema, {});
  if (!parsed || typeof parsed !== "object") return true;
  if (Array.isArray(parsed.enum) && !parsed.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) return false;
  if (!parsed.type) return true;
  if (parsed.type === "array") return Array.isArray(value);
  if (parsed.type === "object") return value && typeof value === "object" && !Array.isArray(value);
  if (parsed.type === "string") {
    if (typeof value !== "string") return false;
    if (Number.isFinite(Number(parsed.minLength)) && value.length < Number(parsed.minLength)) return false;
    if (Number.isFinite(Number(parsed.maxLength)) && value.length > Number(parsed.maxLength)) return false;
    return true;
  }
  if (parsed.type === "number" || parsed.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value) || (parsed.type === "integer" && !Number.isInteger(value))) return false;
    if (Number.isFinite(Number(parsed.minimum)) && value < Number(parsed.minimum)) return false;
    if (Number.isFinite(Number(parsed.maximum)) && value > Number(parsed.maximum)) return false;
    return true;
  }
  if (parsed.type === "boolean") return typeof value === "boolean";
  return true;
}

function pathDepthMap(path) {
  const map = new Map();
  const total = path.containerIds.length - 1;
  path.containerIds.forEach((containerId, index) => map.set(String(containerId), total - index));
  return map;
}

function rolePermissionMatches(permission, request) {
  if (String(permission.dimension_key || permission.dimension || "") !== String(request.dimension || "")) return false;
  const patterns = parseObject(permission.operation_patterns_json ?? permission.operations, []);
  if (!Array.isArray(patterns) || patterns.length === 0) return true;
  return patterns.some(pattern => operationPatternMatches(pattern, request.operation));
}

function applicableRoleAssignments(path, state) {
  const depth = pathDepthMap(path);
  const containerById = new Map(state.containers.map(container => [String(container.container_id),container]));
  const templateByKey = new Map((state.roleTemplates || []).map(template => [String(template.role_template_key),template]));
  const assignments = [];
  const blockingCodes = new Set();

  for (const assignment of state.roleAssignments) {
    const assignmentContainerId = String(assignment.container_id);
    if (!depth.has(assignmentContainerId)) continue;
    if (assignment.inheritance_mode === "local_only" && assignmentContainerId !== String(state.target.container_id)) continue;
    const assignmentContainer = containerById.get(assignmentContainerId);
    if (!assignmentContainer) {
      blockingCodes.add("role_assignment_invalid");
      continue;
    }

    const inlinePermissions = parseObject(assignment.inline_permissions_json, []);
    if (assignment.role_template_key) {
      const roleTemplateKey = String(assignment.role_template_key);
      const composition = resolveRoleTemplateComposition({ rootRoleTemplateKey:roleTemplateKey,roleTemplates:state.roleTemplates || [] });
      if (!composition.ok) {
        blockingCodes.add(composition.code || "role_template_not_registered");
        continue;
      }
      const rootTemplate = templateByKey.get(roleTemplateKey);
      const eligibleTypes = parseObject(rootTemplate?.eligible_container_types_json, []);
      if (!rootTemplate || (Array.isArray(eligibleTypes) && eligibleTypes.length > 0 && !eligibleTypes.includes(String(assignmentContainer.container_type_key)))) {
        blockingCodes.add("role_assignment_invalid");
        continue;
      }
      const composedPermissions = (state.rolePermissions || [])
        .filter(permission => composition.templateKeys.includes(String(permission.role_template_key)))
        .map(permission => ({
          source:"role_template",
          roleTemplateKey:permission.role_template_key,
          dimension:permission.dimension_key,
          permissionKey:permission.permission_key,
          effect:permission.effect,
          operations:parseObject(permission.operation_patterns_json, []),
          priority:Number(permission.merge_priority || 0)
        }));
      assignments.push({
        assignmentId:assignment.assignment_id,
        containerId:assignment.container_id,
        roleTemplateKey,
        composedRoleTemplateKeys:composition.templateKeys,
        permissions:[...composedPermissions,...(Array.isArray(inlinePermissions) ? inlinePermissions : [])],
        inheritanceMode:assignment.inheritance_mode,
        depth:depth.get(assignmentContainerId),
        roleRank:Number(rootTemplate.authority_rank || 0)
      });
      continue;
    }

    if (!Array.isArray(inlinePermissions) || inlinePermissions.length === 0) {
      blockingCodes.add("role_assignment_invalid");
      continue;
    }
    assignments.push({
      assignmentId:assignment.assignment_id,
      containerId:assignment.container_id,
      roleTemplateKey:null,
      composedRoleTemplateKeys:[],
      permissions:inlinePermissions,
      inheritanceMode:assignment.inheritance_mode,
      depth:depth.get(assignmentContainerId),
      roleRank:Number(assignment.metadata_json?.authority_rank || 1)
    });
  }
  return { assignments,blockingCodes:[...blockingCodes] };
}

function resolveRoles(paths, state, requests) {
  const pathRoles = [];
  const blockingCodes = new Set();
  for (const path of paths) {
    const applicable = applicableRoleAssignments(path,state);
    applicable.blockingCodes.forEach(code => blockingCodes.add(code));
    const assignments = applicable.assignments;
    if (!assignments.length) blockingCodes.add("role_assignment_missing");

    const rankByContainer = new Map();
    for (const assignment of assignments) {
      const current = rankByContainer.get(String(assignment.containerId)) || 0;
      rankByContainer.set(String(assignment.containerId),Math.max(current,Number(assignment.roleRank || 0)));
    }
    const minimumRank = rankByContainer.size ? Math.min(...rankByContainer.values()) : 0;
    if (requests.some(request => !isReadOperation(request.operation)) && minimumRank < 2) blockingCodes.add("role_permission_insufficient");

    for (const request of requests) {
      const matchingPermissions = assignments.flatMap(assignment =>
        assignment.permissions
          .filter(permission => rolePermissionMatches(permission,request))
          .map(permission => ({ ...permission,assignmentId:assignment.assignmentId,containerId:assignment.containerId }))
      );
      if (matchingPermissions.some(permission => ["deny","restrict"].includes(String(permission.effect || "").toLowerCase()))) {
        blockingCodes.add("role_permission_insufficient");
      }
    }
    pathRoles.push({ pathHash:path.pathHash,minimumRoleRank:minimumRank,assignments });
  }
  return {
    pathRoles,
    effectiveRoleRank:pathRoles.length ? Math.min(...pathRoles.map(item => item.minimumRoleRank)) : 0,
    blockingCodes:[...blockingCodes]
  };
}

function resolveClassifications(paths, state) {
  const effective = {};
  const blockingCodes = new Set();
  const containerById = new Map(state.containers.map(container => [String(container.container_id),container]));
  for (const type of state.classificationTypes) {
    const candidates = [];
    const eligibleTypes = parseObject(type.eligible_container_types_json, []);
    for (const path of paths) {
      const depth = pathDepthMap(path);
      for (const assignment of state.classifications) {
        if (String(assignment.classification_type_key) !== String(type.classification_type_key)) continue;
        if (!depth.has(String(assignment.container_id))) continue;
        if (assignment.inheritance_mode === "local_only" && String(assignment.container_id) !== String(state.target.container_id)) continue;
        const assignmentContainer = containerById.get(String(assignment.container_id));
        if (!assignmentContainer || (Array.isArray(eligibleTypes) && eligibleTypes.length && !eligibleTypes.includes(String(assignmentContainer.container_type_key)))) {
          blockingCodes.add("classification_invalid");
          continue;
        }
        const value = parseObject(assignment.value_json, assignment.value_json);
        if (!validateSimpleSchema(value, type.value_schema_json)) {
          blockingCodes.add("classification_invalid");
          continue;
        }
        candidates.push({
          sourceId:assignment.classification_id,
          value,
          depth:depth.get(String(assignment.container_id)),
          priority:Number(assignment.merge_priority || 0),
          pathHash:path.pathHash
        });
      }
    }
    if (!candidates.length) continue;
    const result = resolveContainerDimensionCandidates(candidates, type.merge_strategy || "nearest_replace");
    effective[type.classification_type_key] = result;
    if (result.blocked) blockingCodes.add(result.code || "classification_conflict");
  }
  return { effective, blockingCodes:[...blockingCodes] };
}

function candidateForPath(binding, path, targetContainerId, inheritanceCeilingDepth = Number.MAX_SAFE_INTEGER) {
  const depth = pathDepthMap(path);
  const containerId = String(binding.container_id);
  if (!depth.has(containerId)) return null;
  const bindingDepth = depth.get(containerId);
  if (bindingDepth > inheritanceCeilingDepth) return null;
  if (binding.inheritance_mode === "local_only" && containerId !== String(targetContainerId)) return null;
  if (binding.inheritance_mode === "explicit_share") return null;
  if (["share","delegate"].includes(String(binding.effect || "").toLowerCase())) return null;
  return {
    ...binding,
    sourceId:binding.binding_id,
    depth:bindingDepth,
    priority:Number(binding.merge_priority || 0),
    pathHash:path.pathHash
  };
}

function relationshipClassMap(state) {
  return new Map(state.relationshipTypes.map(type => [String(type.relationship_type_key), String(type.relationship_class)]));
}

function resolveDimensionRequest(request, paths, state) {
  const dimension = state.dimensions.find(row => String(row.dimension_key) === request.dimension);
  if (!dimension) return { request, decision:"deny", blockingCodes:["resource_binding_missing"], candidates:[], pathResults:[] };
  const pathResults = [];
  const allCandidates = [];
  const blockingCodes = new Set();
  const relationshipClasses = relationshipClassMap(state);
  const sharingSupported = Number(dimension.supports_sharing || 0) === 1;
  const delegationSupported = Number(dimension.supports_delegation || 0) === 1;
  const incomingShares = sharingSupported ? state.relationships.filter(row =>
    String(row.to_container_id) === String(state.target.container_id)
      && relationshipClasses.get(String(row.relationship_type_key)) === "sharing"
  ) : [];
  const incomingDelegations = delegationSupported ? state.relationships.filter(row =>
    String(row.to_container_id) === String(state.target.container_id)
      && relationshipClasses.get(String(row.relationship_type_key)) === "delegation"
  ) : [];

  for (const path of paths) {
    const depth = pathDepthMap(path);
    const matchingBindings = state.bindings.filter(binding => bindingMatchesDimensionRequest(binding,request));
    const blockerDepths = matchingBindings
      .filter(binding => binding.inheritance_mode === "block_inheritance" && depth.has(String(binding.container_id)))
      .map(binding => depth.get(String(binding.container_id)));
    const inheritanceCeilingDepth = blockerDepths.length ? Math.min(...blockerDepths) : Number.MAX_SAFE_INTEGER;
    const candidates = matchingBindings
      .map(binding => candidateForPath(binding,path,state.target.container_id,inheritanceCeilingDepth))
      .filter(Boolean);

    for (const share of incomingShares) {
      for (const sourceBinding of state.bindings.filter(binding =>
        String(binding.container_id) === String(share.from_container_id)
          && bindingMatchesDimensionRequest(binding,request)
          && ["allow","share"].includes(String(binding.effect || "").toLowerCase())
          && (binding.inheritance_mode === "explicit_share" || String(binding.effect || "").toLowerCase() === "share")
      )) {
        candidates.push({ ...sourceBinding,effect:"share",sourceId:sourceBinding.binding_id,depth:Number.MAX_SAFE_INTEGER,priority:Number(share.priority || 0),pathHash:path.pathHash,relationshipId:share.relationship_id });
      }
    }
    for (const delegation of incomingDelegations) {
      for (const sourceBinding of state.bindings.filter(binding =>
        String(binding.container_id) === String(delegation.from_container_id)
          && String(binding.effect) === "delegate"
          && binding.delegator_resolution_id
          && String(binding.delegation_relationship_id || "") === String(delegation.relationship_id)
          && bindingMatchesDimensionRequest(binding, request)
      )) {
        candidates.push({ ...sourceBinding, sourceId:sourceBinding.binding_id, depth:Number.MAX_SAFE_INTEGER, priority:Number(delegation.priority || 0), pathHash:path.pathHash, relationshipId:delegation.relationship_id });
      }
    }

    const authorizationResult = resolveContainerDimensionCandidates(candidates, "deny_wins");
    if (!candidates.length) blockingCodes.add("resource_binding_missing");
    if (authorizationResult.blocked) blockingCodes.add(authorizationResult.code || "resource_binding_conflict");
    const hasShare = candidates.some(candidate => String(candidate.effect) === "share");
    const hasExactDelegation = candidates.some(candidate =>
      String(candidate.effect) === "delegate"
        && candidate.delegator_resolution_id
        && candidate.delegation_relationship_id
        && bindingMatchesDimensionRequest(candidate, request)
    );
    if (hasShare && !isReadOperation(request.operation) && !hasExactDelegation) blockingCodes.add("sharing_write_not_delegated");
    pathResults.push({
      pathHash:path.pathHash,
      result:authorizationResult,
      declaredMergeStrategy:dimension.default_merge_strategy || "deny_wins",
      candidateIds:candidates.map(candidate => candidate.binding_id)
    });
    allCandidates.push(...candidates);
  }

  const uniqueCandidates = [...new Map(allCandidates.map(candidate => [candidate.binding_id, candidate])).values()];
  if (request.dimension === "connections" && !uniqueCandidates.some(candidate => ["allow","delegate"].includes(String(candidate.effect)))) {
    blockingCodes.add("connection_not_bound_to_effective_context");
  }
  const decision = blockingCodes.size
    ? "deny"
    : pathResults.some(path => path.result.decision === "restrict") ? "restrict" : "allow";
  return { request, dimension, decision, blockingCodes:[...blockingCodes], candidates:uniqueCandidates, pathResults };
}

function buildResolutionEvidence({ input, state, paths, roleResult, classificationResult, dimensionResults, blockingCodes, durationMs }) {
  const effectiveBindings = dimensionResults.flatMap(result => result.candidates.map(candidate => ({
    bindingId:candidate.binding_id,
    containerId:candidate.container_id,
    dimension:candidate.dimension_key,
    resourceType:candidate.resource_type,
    resourceRef:candidate.resource_ref,
    effect:candidate.effect,
    permissionKey:candidate.permission_key,
    operationPatterns:parseObject(candidate.operation_patterns_json, []),
    pathHash:candidate.pathHash,
    delegatorResolutionId:candidate.delegator_resolution_id || null
  })));
  const appliedDenies = effectiveBindings.filter(binding => ["deny","restrict"].includes(String(binding.effect)));
  const appliedDelegations = effectiveBindings.filter(binding => String(binding.effect) === "delegate");
  const requestContext = {
    principal:input.principal,
    tenantId:input.tenantId,
    targetContainerId:input.targetContainerId,
    dimensionRequests:input.dimensionRequests,
    mode:input.mode,
    expectedAuthorityEpoch:input.expectedAuthorityEpoch ?? null,
    expectedRegistrySnapshotHash:input.expectedRegistrySnapshotHash || null
  };
  const registrySnapshot = {
    containerTypeVersions:state.containerTypes.map(row => [row.container_type_key,Number(row.version || 1)]).sort(),
    containerVersions:state.containers.map(row => [row.container_id,Number(row.version || 1)]).sort(),
    relationshipTypeVersions:state.relationshipTypes.map(row => [row.relationship_type_key,Number(row.version || 1)]).sort(),
    relationshipVersions:state.relationships.map(row => [row.relationship_id,Number(row.version || 1)]).sort(),
    classificationTypeVersions:state.classificationTypes.map(row => [row.classification_type_key,Number(row.version || 1)]).sort(),
    classificationVersions:state.classifications.map(row => [row.classification_id,Number(row.version || 1)]).sort(),
    roleTemplateVersions:(state.roleTemplates || []).map(row => [row.role_template_key,Number(row.version || 1),Number(row.authority_rank || 0),row.composition_json,row.eligible_container_types_json]).sort(),
    rolePermissionVersions:(state.rolePermissions || []).map(row => [row.role_template_key,row.dimension_key,row.permission_key,row.effect,row.operation_patterns_json,Number(row.merge_priority || 0)]).sort(),
    roleAssignmentVersions:state.roleAssignments.map(row => [row.assignment_id,Number(row.version || 1)]).sort(),
    dimensionVersions:state.dimensions.map(row => [row.dimension_key,Number(row.version || 1),row.default_merge_strategy,Number(row.override_allowed || 0)]).sort(),
    bindingVersions:state.bindings.map(row => [row.binding_id,Number(row.version || 1)]).sort(),
    authorityEpoch:state.authorityEpoch,
    resolverVersion:CONTAINER_AUTHORITY_RESOLVER_VERSION
  };
  const registrySnapshotHash = stableSha256(registrySnapshot);
  const containerPathHash = stableSha256(paths.map(path => path.pathHash));
  const decision = blockingCodes.length
    ? blockingCodes.includes("container_path_ambiguous") ? "ambiguous"
      : blockingCodes.some(code => code.startsWith("override_")) ? "requires_override"
        : "deny"
    : dimensionResults.some(result => result.pathResults.some(path => path.result.decision === "restrict")) ? "restrict" : "allow";
  const core = {
    principal:input.principal,tenantId:input.tenantId,targetContainerId:input.targetContainerId,mode:input.mode,
    decision,authorityEpoch:state.authorityEpoch,resolverVersion:CONTAINER_AUTHORITY_RESOLVER_VERSION,
    containerPaths:paths,effectiveClassifications:classificationResult.effective,effectiveRoles:roleResult.pathRoles,
    effectiveBindings,appliedDenies,appliedDelegations,blockingCodes:[...new Set(blockingCodes)].sort(),
    registrySnapshotHash,containerPathHash,requestSha256:stableSha256(requestContext)
  };
  return {
    ...core,
    resolutionSha256:stableSha256(core),
    requestContext,
    durationMs,
    providerCallMade:false,
    credentialPayloadRead:false,
    secretsIncluded:false
  };
}

function compareShadowDecision(legacyDecision, containerDecision) {
  const legacy = String(legacyDecision || "unknown").toLowerCase();
  if (legacy === "unknown") return { status:"not_comparable", mismatchCodes:[] };
  const normalizedLegacy = ["allow","ready","pass","authorized"].includes(legacy) ? "allow" : ["deny","blocked","fail","unauthorized"].includes(legacy) ? "deny" : legacy;
  const normalizedContainer = containerDecision === "restrict" ? "allow" : containerDecision;
  return normalizedLegacy === normalizedContainer
    ? { status:"match", mismatchCodes:[] }
    : { status:"mismatch", mismatchCodes:[`legacy_${normalizedLegacy}_container_${normalizedContainer}`] };
}

function cacheGet(key, epoch, nowMs) {
  const item = resolutionCache.get(key);
  if (!item || item.authorityEpoch !== epoch || item.expiresAtMs <= nowMs) {
    if (item) resolutionCache.delete(key);
    return null;
  }
  return item.value;
}

export function invalidateContainerAuthorityCache(tenantId = null) {
  if (!tenantId) { const size = resolutionCache.size; resolutionCache.clear(); return size; }
  let removed = 0;
  for (const [key, item] of resolutionCache.entries()) {
    if (item.tenantId === tenantId) { resolutionCache.delete(key); removed += 1; }
  }
  return removed;
}

export async function resolveEffectiveContainerContext(rawInput, dependencies = {}) {
  const now = dependencies.now || (() => new Date());
  const loadState = dependencies.loadState || loadContainerAuthorityState;
  const readEpoch = dependencies.readEpoch || readContainerAuthorityEpoch;
  const persistResolution = dependencies.persistResolution || persistContainerResolution;
  const persistComparison = dependencies.persistComparison || persistShadowComparison;
  const recordPerformance = dependencies.recordPerformance || recordContainerPerformanceSample;
  const readPolicy = dependencies.readPolicy || readContainerRolloutPolicy;
  const readIdempotency = dependencies.readIdempotency || readIdempotentResult;
  const storeIdempotency = dependencies.storeIdempotency || storeIdempotentResult;
  const enforcementEnabled = dependencies.enforcementEnabled ?? String(process.env.DYNAMIC_CONTAINER_AUTHORITY_ENFORCEMENT || "false").toLowerCase() === "true";

  const input = {
    principal:normalizePrincipal(rawInput?.principal),
    tenantId:String(rawInput?.tenantId || "").trim(),
    targetContainerId:String(rawInput?.targetContainerId || "").trim(),
    dimensionRequests:normalizeDimensionRequests(rawInput?.dimensionRequests),
    mode:String(rawInput?.mode || "preview").toLowerCase(),
    expectedAuthorityEpoch:rawInput?.expectedAuthorityEpoch,
    expectedRegistrySnapshotHash:rawInput?.expectedRegistrySnapshotHash || null,
    legacyDecision:rawInput?.legacyDecision || "unknown",
    legacyEvidenceRef:rawInput?.legacyEvidenceRef || null,
    requestId:rawInput?.requestId || null,
    idempotencyKey:rawInput?.idempotencyKey || null
  };
  if (!input.tenantId || !input.targetContainerId) throw stableError("container_not_found", "tenantId and targetContainerId are required.");
  if (!new Set(["preview","shadow","enforce"]).has(input.mode)) throw stableError("mode_invalid", "mode must be preview, shadow, or enforce.");
  if (input.mode === "enforce" && !enforcementEnabled) throw stableError("effective_context_blocked", "Container authority enforcement is disabled; use preview or shadow mode.");
  const secretCheck = validateNoSecretMetadata(rawInput);
  if (!secretCheck.ok) throw stableError("container_secret_field_forbidden", "Secret-like fields are forbidden in container authority requests.", secretCheck.violations);

  const startedAt = performance.now();
  let evidence;
  let cacheHit = false;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const state = await loadState({ tenantId:input.tenantId,targetContainerId:input.targetContainerId,principal:input.principal });
    if (!state.target) throw stableError("container_not_found", "Target container was not found in the authenticated tenant.");
    if (String(state.target.tenant_id) !== input.tenantId) throw stableError("container_cross_tenant_boundary", "Target container is outside the authenticated tenant.");
    if (input.expectedAuthorityEpoch !== undefined && Number(input.expectedAuthorityEpoch) !== Number(state.authorityEpoch)) {
      throw stableError("container_authority_epoch_changed", "Authority epoch differs from the expected value.", [{ expected:input.expectedAuthorityEpoch,actual:state.authorityEpoch }]);
    }
    const cacheKey = buildContainerResolutionCacheKey({ ...input, authorityEpoch:state.authorityEpoch,resolverVersion:CONTAINER_AUTHORITY_RESOLVER_VERSION });
    const cached = cacheGet(cacheKey,state.authorityEpoch,Date.now());
    if (cached) { evidence = { ...cached }; cacheHit = true; break; }

    const pathResult = enumerateContainerPaths({ targetContainerId:input.targetContainerId,relationships:state.relationships,relationshipTypes:state.relationshipTypes });
    if (!pathResult.ok) throw stableError(pathResult.code || "container_resolution_limit_exceeded", "Container path resolution failed.", [pathResult]);
    const roleResult = resolveRoles(pathResult.paths,state,input.dimensionRequests);
    const classificationResult = resolveClassifications(pathResult.paths,state);
    const dimensionResults = input.dimensionRequests.map(request => resolveDimensionRequest(request,pathResult.paths,state));
    const blockingCodes = [
      ...roleResult.blockingCodes,
      ...classificationResult.blockingCodes,
      ...dimensionResults.flatMap(result => result.blockingCodes)
    ];
    evidence = buildResolutionEvidence({ input,state,paths:pathResult.paths,roleResult,classificationResult,dimensionResults,blockingCodes,durationMs:performance.now()-startedAt });
    if (input.expectedRegistrySnapshotHash && input.expectedRegistrySnapshotHash !== evidence.registrySnapshotHash) {
      throw stableError("container_authority_epoch_changed", "Registry snapshot differs from the expected value.");
    }
    const endingEpoch = await readEpoch(input.tenantId);
    if (Number(endingEpoch.authority_epoch) !== Number(state.authorityEpoch)) {
      if (attempt === 0 && input.mode !== "enforce") continue;
      throw stableError("container_authority_epoch_changed", "Authority changed during resolution.");
    }
    resolutionCache.set(cacheKey,{ tenantId:input.tenantId,authorityEpoch:state.authorityEpoch,expiresAtMs:Date.now()+30000,value:evidence });
    break;
  }
  if (!evidence) throw stableError("container_authority_epoch_changed", "Resolution could not stabilize on one authority epoch.");

  const resolution = {
    ...evidence,
    resolutionId:randomUUID(),
    requestId:input.requestId,
    idempotencyKey:input.idempotencyKey,
    expiresAt:new Date(now().getTime()+5*60*1000).toISOString(),
    cacheHit
  };
  await persistResolution(resolution);
  const policy = await readPolicy().catch(() => null);
  const durationMs = performance.now()-startedAt;
  await recordPerformance({
    resolutionId:resolution.resolutionId,tenantId:input.tenantId,mode:input.mode,
    containerCount:resolution.containerPaths.flatMap(path => path.containerIds).length,
    relationshipCount:resolution.containerPaths.flatMap(path => path.relationshipIds).length,
    pathCount:resolution.containerPaths.length,candidateBindingCount:resolution.effectiveBindings.length,
    durationMs,withinBudget:!policy || durationMs<=Number(policy.p99_budget_ms || 400),metadata:{ cacheHit }
  }).catch(() => null);
  if (input.mode === "shadow") {
    const comparison = compareShadowDecision(input.legacyDecision,resolution.decision);
    await persistComparison({
      resolutionId:resolution.resolutionId,tenantId:input.tenantId,targetContainerId:input.targetContainerId,
      capabilityKey:input.dimensionRequests.find(item => item.capabilityKey)?.capabilityKey || null,
      legacyDecision:input.legacyDecision,containerDecision:resolution.decision,comparisonStatus:comparison.status,
      mismatchCodes:comparison.mismatchCodes,legacyEvidenceRef:input.legacyEvidenceRef,latencyMs:durationMs
    });
  }
  return resolution;
}

export const _testingDynamicContainerAuthorityResolver = {
  normalizePrincipal,
  normalizeDimensionRequests,
  isReadOperation,
  validateSimpleSchema,
  resolveRoles,
  resolveClassifications,
  resolveDimensionRequest,
  compareShadowDecision,
  resolutionCache
};
