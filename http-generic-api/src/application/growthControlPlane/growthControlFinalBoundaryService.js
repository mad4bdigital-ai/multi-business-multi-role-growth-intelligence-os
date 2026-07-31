import { stableSha256 } from "../../domain/growthControlPlane/growthControlPlane.js";
import { compileGrowthControlPolicyDecision } from "../../domain/growthControlPlane/growthControlPolicyCompiler.js";
import { readGrowthControlApprovedHold } from "./growthControlApprovalReadbackService.js";

const KEY_RE = /^[a-z][a-z0-9_.-]{2,191}$/;
const OPAQUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,190}$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const SENSITIVE_KEY_RE = /(secret|token|password|passwd|credential|private[_-]?key|client[_-]?secret|api[_-]?key|authorization|cookie|session)/i;
const SENSITIVE_VALUE_RE = /(Bearer\s+[A-Za-z0-9._~+\-/]+=*|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;
const MAX_INPUT_BYTES = 262144;

function boundaryError(code, message, status = 422, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.details = details;
  return error;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((nested) => deepFreeze(nested, seen));
  return Object.freeze(value);
}

function assertSafeInput(value, field = "input", depth = 0) {
  if (depth > 14 || value == null) return;
  if (typeof value === "string") {
    if (SENSITIVE_VALUE_RE.test(value)) {
      throw boundaryError("growth_control_final_boundary_sensitive_input", "Final-boundary input contains a secret-like value.", 422, { field });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeInput(item, `${field}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_KEY_RE.test(key)) {
      throw boundaryError("growth_control_final_boundary_sensitive_input", "Final-boundary input contains a forbidden sensitive field.", 422, { field: `${field}.${key}` });
    }
    assertSafeInput(nested, `${field}.${key}`, depth + 1);
  }
}

function assertBoundedInput(value) {
  let serialized;
  try { serialized = JSON.stringify(value); } catch {
    throw boundaryError("growth_control_final_boundary_input_invalid", "Final-boundary input must be JSON-serializable.");
  }
  if (Buffer.byteLength(serialized || "", "utf8") > MAX_INPUT_BYTES) {
    throw boundaryError("growth_control_final_boundary_input_oversized", "Final-boundary input exceeds the supported byte bound.");
  }
}

function canonical(value, field) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!KEY_RE.test(normalized)) {
    throw boundaryError("growth_control_final_boundary_input_invalid", `${field} must be a canonical key.`, 422, { field });
  }
  return normalized;
}

function identifier(value, field, { nullable = false, maximum = 191 } = {}) {
  if (nullable && (value == null || value === "")) return null;
  const normalized = String(value ?? "").trim();
  if (!OPAQUE_ID_RE.test(normalized) || normalized.length > maximum) {
    throw boundaryError("growth_control_final_boundary_input_invalid", `${field} must be a bounded opaque identifier.`, 422, { field });
  }
  return normalized;
}

function sha256(value, field) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!SHA256_RE.test(normalized)) {
    throw boundaryError("growth_control_final_boundary_input_invalid", `${field} must be SHA-256.`, 422, { field });
  }
  return normalized;
}

function boundedInteger(value, field, minimum, maximum, fallback) {
  const normalized = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < minimum || normalized > maximum) {
    throw boundaryError("growth_control_final_boundary_input_invalid", `${field} is outside the supported bounds.`, 422, { field, minimum, maximum });
  }
  return normalized;
}

function boundedNumber(value, field, minimum, maximum, fallback) {
  const normalized = value == null ? fallback : Number(value);
  if (!Number.isFinite(normalized) || normalized < minimum || normalized > maximum) {
    throw boundaryError("growth_control_final_boundary_input_invalid", `${field} is outside the supported bounds.`, 422, { field, minimum, maximum });
  }
  return normalized;
}

function sortedUnique(values, field, { required = false, normalize = identifier, maximum = 100 } = {}) {
  if (values == null) values = [];
  if (!Array.isArray(values) || values.length > maximum) {
    throw boundaryError("growth_control_final_boundary_input_invalid", `${field} must be a bounded array.`, 422, { field, maximum });
  }
  const normalized = [...new Set(values.map((value, index) => normalize(value, `${field}[${index}]`)))].sort();
  if (required && normalized.length === 0) {
    throw boundaryError("growth_control_final_boundary_input_invalid", `${field} must not be empty.`, 422, { field });
  }
  return normalized;
}

function normalizePrincipal(principal = {}) {
  if (!principal || typeof principal !== "object" || Array.isArray(principal)) {
    throw boundaryError("growth_control_final_boundary_principal_invalid", "principal is required.", 422);
  }
  const tenantRefs = sortedUnique(principal.authorizedTenantRefs, "principal.authorizedTenantRefs", { required: true });
  return {
    principalType: canonical(principal.principalType, "principal.principalType"),
    principalRef: identifier(principal.principalRef, "principal.principalRef", { maximum: 64 }),
    authorizedTenantRefs: tenantRefs,
    actorRoles: sortedUnique(principal.actorRoles ?? principal.roles, "principal.actorRoles", { normalize: canonical }),
    isAdmin: principal.isAdmin === true,
  };
}

function normalizeEffectiveSubject(subject = {}) {
  if (!subject || typeof subject !== "object" || Array.isArray(subject)) {
    throw boundaryError("growth_control_final_boundary_subject_invalid", "effectiveSubject is required.", 422);
  }
  return {
    subjectType: canonical(subject.subjectType, "effectiveSubject.subjectType"),
    subjectRef: identifier(subject.subjectRef, "effectiveSubject.subjectRef", { maximum: 64 }),
    tenantRef: identifier(subject.tenantRef, "effectiveSubject.tenantRef", { maximum: 64 }),
    workspaceRef: identifier(subject.workspaceRef, "effectiveSubject.workspaceRef", { nullable: true, maximum: 64 }),
    delegatedByPrincipalRef: identifier(subject.delegatedByPrincipalRef, "effectiveSubject.delegatedByPrincipalRef", { nullable: true, maximum: 64 }),
  };
}

function normalizeResource(resource = {}) {
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
    throw boundaryError("growth_control_final_boundary_resource_invalid", "resource is required.", 422);
  }
  return {
    nodeRef: identifier(resource.nodeRef, "resource.nodeRef"),
    resourceType: canonical(resource.resourceType, "resource.resourceType"),
    resourceRef: identifier(resource.resourceRef, "resource.resourceRef"),
    approvalResourceId: identifier(resource.approvalResourceId ?? resource.resourceId ?? resource.resourceRef, "resource.approvalResourceId"),
  };
}

function normalizeProviderBinding(binding = {}) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    throw boundaryError("growth_control_final_boundary_provider_binding_invalid", "providerBinding is required.", 422);
  }
  return {
    providerBindingRef: identifier(binding.providerBindingRef ?? binding.bindingRef, "providerBinding.providerBindingRef"),
    appKey: canonical(binding.appKey, "providerBinding.appKey"),
    parentActionKey: canonical(binding.parentActionKey, "providerBinding.parentActionKey"),
    configuredEndpointKey: canonical(binding.configuredEndpointKey ?? binding.endpointKey, "providerBinding.configuredEndpointKey"),
    adapterKey: binding.adapterKey == null ? null : canonical(binding.adapterKey, "providerBinding.adapterKey"),
    connectionId: identifier(binding.connectionId, "providerBinding.connectionId", { nullable: true, maximum: 64 }),
    certificationKeys: sortedUnique(binding.certificationKeys, "providerBinding.certificationKeys", { normalize: canonical }),
  };
}

function clonePolicies(policies) {
  if (!Array.isArray(policies)) return [];
  try {
    return JSON.parse(JSON.stringify(policies));
  } catch {
    throw boundaryError(
      "growth_control_final_boundary_input_invalid",
      "policies must be JSON-serializable.",
      422,
      { field: "policies" },
    );
  }
}

function normalizeInput(input = {}) {
  const inputWithoutPool = { ...input };
  delete inputWithoutPool.pool;
  assertBoundedInput(inputWithoutPool);
  assertSafeInput(inputWithoutPool);
  const principal = normalizePrincipal(input.principal);
  const effectiveSubject = normalizeEffectiveSubject(input.effectiveSubject);
  if (!principal.authorizedTenantRefs.includes("*") && !principal.authorizedTenantRefs.includes(effectiveSubject.tenantRef)) {
    throw boundaryError("growth_control_final_boundary_tenant_not_authorized", "The principal is not authorized for the effective Tenant.", 403);
  }
  const tenantId = identifier(input.tenantId ?? effectiveSubject.tenantRef, "tenantId", { maximum: 64 });
  const workspaceId = identifier(input.workspaceId ?? effectiveSubject.workspaceRef, "workspaceId", { nullable: true, maximum: 64 });
  if (tenantId !== effectiveSubject.tenantRef || (effectiveSubject.workspaceRef && workspaceId !== effectiveSubject.workspaceRef)) {
    throw boundaryError("growth_control_final_boundary_scope_mismatch", "Final-boundary scope does not match the effective subject.", 403);
  }
  const environment = canonical(input.environment, "environment");
  const effectClass = canonical(input.effectClass, "effectClass");
  const resource = normalizeResource(input.resource);
  const resourceIds = sortedUnique(input.resourceIds, "resourceIds", { required: true });
  if (!resourceIds.includes(resource.approvalResourceId)) {
    throw boundaryError("growth_control_final_boundary_resource_binding_mismatch", "The target resource is not present in the approval resource binding.", 409);
  }
  const instant = input.now instanceof Date ? input.now : new Date(input.now ?? Date.now());
  if (Number.isNaN(instant.getTime())) {
    throw boundaryError("growth_control_final_boundary_input_invalid", "now must be a valid instant.", 422);
  }
  return deepFreeze({
    principal,
    effectiveSubject,
    tenantId,
    workspaceId,
    brandId: identifier(input.brandId, "brandId", { nullable: true }),
    activityBindingId: identifier(input.activityBindingId, "activityBindingId", { nullable: true }),
    capabilityKey: canonical(input.capabilityKey, "capabilityKey"),
    operation: canonical(input.operation, "operation"),
    resource,
    resourceIds,
    actionIds: sortedUnique(input.actionIds, "actionIds", { required: true, normalize: canonical }),
    environment,
    effectClass,
    providerBinding: normalizeProviderBinding(input.providerBinding),
    graph: {
      relationTypes: sortedUnique(input.resourceGraph?.relationTypes, "resourceGraph.relationTypes", { required: true, normalize: canonical }),
      inheritancePolicyKeys: sortedUnique(input.resourceGraph?.inheritancePolicyKeys, "resourceGraph.inheritancePolicyKeys", { required: true, normalize: canonical }),
      maxDepth: boundedInteger(input.resourceGraph?.maxDepth, "resourceGraph.maxDepth", 1, 12, 4),
      maxNodes: boundedInteger(input.resourceGraph?.maxNodes, "resourceGraph.maxNodes", 1, 500, 100),
    },
    planId: identifier(input.planId, "planId"),
    planStepId: identifier(input.planStepId, "planStepId"),
    holdId: identifier(input.holdId, "holdId", { nullable: true }),
    nodeId: canonical(input.nodeId, "nodeId"),
    planHashSha256: sha256(input.planHashSha256, "planHashSha256"),
    requestHashSha256: sha256(input.requestHashSha256, "requestHashSha256"),
    policies: clonePolicies(input.policies),
    typedConfirmationKeys: sortedUnique(input.typedConfirmationKeys, "typedConfirmationKeys", { normalize: canonical }),
    plannedReadbackKeys: sortedUnique(input.plannedReadbackKeys, "plannedReadbackKeys", { normalize: canonical }),
    plannedRollbackKeys: sortedUnique(input.plannedRollbackKeys, "plannedRollbackKeys", { normalize: canonical }),
    intent: {
      dispatchRequested: input.intent?.dispatchRequested === true,
      applyRequested: input.intent?.applyRequested === true,
      externalWriteRequested: input.intent?.externalWriteRequested === true,
      concurrency: boundedInteger(input.intent?.concurrency, "intent.concurrency", 1, 1000, 1),
      budgetAmount: boundedNumber(input.intent?.budgetAmount, "intent.budgetAmount", 0, 1_000_000_000, 0),
    },
    now: instant,
  });
}

function dependencyMethod(dependency, method, name) {
  if (!dependency || typeof dependency[method] !== "function") {
    throw new TypeError(`${name}.${method} must be a function.`);
  }
  return dependency[method].bind(dependency);
}

function failureResult(normalized, stage, code, evidence = {}) {
  const withoutHash = {
    contract_version: "growth-control-final-boundary-decision-v1",
    status: "blocked",
    decision: "deny",
    stage,
    reason_codes: [String(code || "FINAL_BOUNDARY_BLOCKED")],
    evidence,
    tenant_id: normalized.tenantId,
    workspace_id: normalized.workspaceId,
    plan_id: normalized.planId,
    plan_step_id: normalized.planStepId,
    request_hash_sha256: normalized.requestHashSha256,
    plan_hash_sha256: normalized.planHashSha256,
    execution_authorized: false,
    dispatch_allowed: false,
    apply_allowed: false,
    external_write_allowed: false,
    authority_granted: false,
    runtime_authority_changed: false,
    provider_call_made: false,
    provider_dispatch_performed: false,
    credential_payload_read: false,
    secrets_included: false,
  };
  return deepFreeze({ ...withoutHash, boundary_decision_sha256: stableSha256(withoutHash) });
}

function stageErrorCode(stage, error) {
  return String(error?.code || `FINAL_BOUNDARY_${stage.toUpperCase()}_FAILED`);
}

function semanticEvidence(result) {
  const items = Array.isArray(result?.items) ? result.items : [];
  const [item] = items;
  return {
    status: result?.status || null,
    ready: result?.ready === true,
    evidence_sha256: result?.evidenceSha256 || null,
    capability_decision_sha256: item?.decisionSha256 || null,
  };
}

function selectionMatches(selection, providerBinding) {
  if (!selection) return false;
  const comparisons = [
    [selection.appKey, providerBinding.appKey],
    [selection.parentActionKey, providerBinding.parentActionKey],
    [selection.configuredEndpointKey, providerBinding.configuredEndpointKey],
  ];
  if (providerBinding.adapterKey) comparisons.push([selection.adapterKey, providerBinding.adapterKey]);
  return comparisons.every(([observed, expected]) => String(observed ?? "") === String(expected ?? ""));
}

function resourceEvidence(result, resource) {
  const nodes = Array.isArray(result?.nodes) ? result.nodes : [];
  return {
    status: result?.status || null,
    target_present: nodes.some((node) => node.nodeRef === resource.nodeRef && node.resourceType === resource.resourceType && node.resourceRef === resource.resourceRef),
    reason_codes: Array.isArray(result?.reasonCodes) ? [...result.reasonCodes].map(String).sort() : [],
    evidence_sha256: stableSha256({
      status: result?.status || null,
      node_refs: nodes.map((node) => node.nodeRef).sort(),
      edge_refs: Array.isArray(result?.edges) ? result.edges.map((edge) => edge.edgeRef).sort() : [],
      blocked_branches: Array.isArray(result?.blockedBranches) ? result.blockedBranches : [],
    }),
  };
}

function policyGrantEvidence(result) {
  return {
    status: result?.status || null,
    decision: result?.decision || null,
    policy_satisfied: result?.policySatisfied === true,
    grant_satisfied: result?.grantSatisfied === true,
    evidence_sha256: stableSha256({
      status: result?.status || null,
      decision: result?.decision || null,
      policy_evidence: result?.policyEvidence || [],
      grant_evidence: result?.grantEvidence || [],
      reason_codes: result?.reasonCodes || [],
    }),
  };
}

function certificationEvidence(result) {
  return {
    status: result?.status || null,
    decision: result?.decision || null,
    canonical_endpoint_key: result?.canonicalEndpointKey || null,
    endpoint_resolved: result?.endpointResolved === true,
    certification_satisfied: result?.certificationSatisfied === true,
    dispatch_certified: result?.dispatchCertified === true,
    apply_certified: result?.applyCertified === true,
    evidence_sha256: stableSha256({
      status: result?.status || null,
      decision: result?.decision || null,
      alias_evidence: result?.aliasEvidence || null,
      endpoint_evidence: result?.endpointEvidence || null,
      certification_evidence: result?.certificationEvidence || null,
      reason_codes: result?.reasonCodes || [],
    }),
  };
}

function requirement(decision, type) {
  return decision.requirements.find((item) => item.type === type) || null;
}

function missingValues(required = [], actual = []) {
  const actualSet = new Set(actual);
  return required.filter((value) => !actualSet.has(value));
}

function evaluatePolicyRequirements(normalized, decision, endpointResult = null) {
  if (decision.decision === "deny") return { code: "FINAL_BOUNDARY_POLICY_DENIED" };
  const forcedEnvironment = requirement(decision, "force_environment");
  if (forcedEnvironment && forcedEnvironment.environment !== normalized.environment) {
    return { code: "FINAL_BOUNDARY_ENVIRONMENT_FORCED", expected: forcedEnvironment.environment };
  }
  if (requirement(decision, "force_provider_write_false") && (normalized.intent.applyRequested || normalized.intent.externalWriteRequested)) {
    return { code: "FINAL_BOUNDARY_PROVIDER_WRITE_FORCED_FALSE" };
  }
  const resourceLimit = requirement(decision, "limit_resources");
  if (resourceLimit && normalized.resourceIds.length > resourceLimit.maximum) {
    return { code: "FINAL_BOUNDARY_RESOURCE_LIMIT_EXCEEDED", maximum: resourceLimit.maximum };
  }
  const concurrencyLimit = requirement(decision, "limit_concurrency");
  if (concurrencyLimit && normalized.intent.concurrency > concurrencyLimit.maximum) {
    return { code: "FINAL_BOUNDARY_CONCURRENCY_LIMIT_EXCEEDED", maximum: concurrencyLimit.maximum };
  }
  const budgetLimit = requirement(decision, "limit_budget");
  if (budgetLimit && normalized.intent.budgetAmount > budgetLimit.maximum) {
    return { code: "FINAL_BOUNDARY_BUDGET_LIMIT_EXCEEDED", maximum: budgetLimit.maximum };
  }
  const confirmations = requirement(decision, "require_typed_confirmation");
  const missingConfirmations = missingValues(confirmations?.confirmation_keys, normalized.typedConfirmationKeys);
  if (missingConfirmations.length > 0) {
    return { code: "FINAL_BOUNDARY_TYPED_CONFIRMATION_MISSING", missing: missingConfirmations };
  }
  const readback = requirement(decision, "require_readback");
  const missingReadback = missingValues(readback?.readback_keys, normalized.plannedReadbackKeys);
  if (missingReadback.length > 0) {
    return { code: "FINAL_BOUNDARY_READBACK_CONTRACT_MISSING", missing: missingReadback };
  }
  const rollback = requirement(decision, "require_rollback");
  const missingRollback = missingValues(rollback?.rollback_keys, normalized.plannedRollbackKeys);
  if (missingRollback.length > 0) {
    return { code: "FINAL_BOUNDARY_ROLLBACK_CONTRACT_MISSING", missing: missingRollback };
  }
  const certifications = requirement(decision, "require_certification");
  const missingCertifications = missingValues(certifications?.certification_keys, normalized.providerBinding.certificationKeys);
  if (missingCertifications.length > 0) {
    return { code: "FINAL_BOUNDARY_CERTIFICATION_BINDING_MISSING", missing: missingCertifications };
  }
  if (certifications && endpointResult && endpointResult.certificationSatisfied !== true) {
    return { code: "FINAL_BOUNDARY_CERTIFICATION_NOT_SATISFIED" };
  }
  return null;
}

export function createGrowthControlFinalBoundaryService({
  semanticCapabilityAdapter,
  resourceGraphResolver,
  policyGrantEvaluator,
  endpointCertificationResolver,
  approvalHoldReader = { read: readGrowthControlApprovedHold },
  policyCompiler = compileGrowthControlPolicyDecision,
} = {}) {
  const previewSemanticCapabilities = dependencyMethod(semanticCapabilityAdapter, "previewSemanticCapabilities", "semanticCapabilityAdapter");
  const resolveResourceGraph = dependencyMethod(resourceGraphResolver, "resolve", "resourceGraphResolver");
  const evaluatePolicyGrant = dependencyMethod(policyGrantEvaluator, "evaluate", "policyGrantEvaluator");
  const resolveEndpointCertification = dependencyMethod(endpointCertificationResolver, "resolve", "endpointCertificationResolver");
  const readApprovalHold = typeof approvalHoldReader === "function"
    ? approvalHoldReader
    : dependencyMethod(approvalHoldReader, "read", "approvalHoldReader");
  if (typeof policyCompiler !== "function") throw new TypeError("policyCompiler must be a function.");

  async function evaluate(input = {}) {
    const pool = input?.pool || null;
    const normalized = normalizeInput(input);
    let semanticResult;
    try {
      semanticResult = await previewSemanticCapabilities({
        capabilityKeys: [normalized.capabilityKey],
        workspaceId: normalized.workspaceId,
        resourceRef: normalized.resource.resourceRef,
        connectionId: normalized.providerBinding.connectionId,
      }, {
        tenantId: normalized.tenantId,
        userId: normalized.principal.principalRef,
        isAdmin: normalized.principal.isAdmin,
      });
    } catch (error) {
      return failureResult(normalized, "semantic_capability", stageErrorCode("semantic_capability", error));
    }
    const semanticItems = Array.isArray(semanticResult?.items) ? semanticResult.items : [];
    const [semanticItem] = semanticItems;
    const semanticSummary = semanticEvidence(semanticResult);
    if (
      semanticResult?.ready !== true ||
      semanticItems.length !== 1 ||
      semanticItem?.ready !== true ||
      semanticItem?.capabilityKey !== normalized.capabilityKey ||
      !selectionMatches(semanticItem.selection, normalized.providerBinding) ||
      semanticResult?.secretsIncluded !== false
    ) {
      return failureResult(normalized, "semantic_capability", "FINAL_BOUNDARY_CAPABILITY_NOT_READY", { semantic: semanticSummary });
    }

    let resourceResult;
    try {
      resourceResult = await resolveResourceGraph({
        principal: normalized.principal,
        effectiveSubject: normalized.effectiveSubject,
        tenantRef: normalized.tenantId,
        workspaceRef: normalized.workspaceId,
        rootResource: {
          nodeRef: normalized.resource.nodeRef,
          resourceType: normalized.resource.resourceType,
          resourceRef: normalized.resource.resourceRef,
        },
        operationIntent: normalized.operation,
        relationTypes: normalized.graph.relationTypes,
        inheritancePolicyKeys: normalized.graph.inheritancePolicyKeys,
        maxDepth: normalized.graph.maxDepth,
        maxNodes: normalized.graph.maxNodes,
        now: normalized.now,
      });
    } catch (error) {
      return failureResult(normalized, "resource_authority", stageErrorCode("resource_authority", error), { semantic: semanticSummary });
    }
    const resourceSummary = resourceEvidence(resourceResult, normalized.resource);
    if (
      resourceResult?.status !== "resolved" ||
      resourceSummary.target_present !== true ||
      resourceResult?.authorityGranted !== false ||
      resourceResult?.secretsIncluded !== false
    ) {
      return failureResult(normalized, "resource_authority", "FINAL_BOUNDARY_RESOURCE_NOT_AUTHORIZED", {
        semantic: semanticSummary,
        resource: resourceSummary,
      });
    }

    let policyGrantResult;
    try {
      policyGrantResult = await evaluatePolicyGrant({
        principal: normalized.principal,
        effectiveSubject: normalized.effectiveSubject,
        tenantRef: normalized.tenantId,
        workspaceRef: normalized.workspaceId,
        capabilityKey: normalized.capabilityKey,
        operation: normalized.operation,
        resource: {
          resourceType: normalized.resource.resourceType,
          resourceRef: normalized.resource.resourceRef,
        },
        now: normalized.now,
      });
    } catch (error) {
      return failureResult(normalized, "policy_grant", stageErrorCode("policy_grant", error), {
        semantic: semanticSummary,
        resource: resourceSummary,
      });
    }
    const policyGrantSummary = policyGrantEvidence(policyGrantResult);
    if (
      policyGrantResult?.status !== "resolved" ||
      policyGrantResult?.decision !== "allow" ||
      policyGrantResult?.policySatisfied !== true ||
      policyGrantResult?.grantSatisfied !== true ||
      policyGrantResult?.authorityGranted !== false ||
      policyGrantResult?.secretsIncluded !== false
    ) {
      return failureResult(normalized, "policy_grant", "FINAL_BOUNDARY_POLICY_GRANT_NOT_SATISFIED", {
        semantic: semanticSummary,
        resource: resourceSummary,
        policy_grant: policyGrantSummary,
      });
    }

    let policyDecision;
    try {
      policyDecision = policyCompiler({
        policies: normalized.policies,
        context: {
          tenant_id: normalized.tenantId,
          workspace_id: normalized.workspaceId,
          brand_id: normalized.brandId,
          activity_binding_id: normalized.activityBindingId,
          operation_key: normalized.operation,
          capability_key: normalized.capabilityKey,
          action_ids: normalized.actionIds,
          resource_ids: normalized.resourceIds,
          resource_count: normalized.resourceIds.length,
          environment: normalized.environment,
          effect_class: normalized.effectClass,
          actor_roles: normalized.principal.actorRoles,
          provider_write: normalized.intent.applyRequested,
          external_write: normalized.intent.externalWriteRequested,
          budget_amount: normalized.intent.budgetAmount,
          concurrency: normalized.intent.concurrency,
          certification_keys: normalized.providerBinding.certificationKeys,
          delegation_requested: Boolean(normalized.effectiveSubject.delegatedByPrincipalRef),
          plan_hash_sha256: normalized.planHashSha256,
          request_hash_sha256: normalized.requestHashSha256,
        },
      });
    } catch (error) {
      return failureResult(normalized, "bounded_policy", stageErrorCode("bounded_policy", error), {
        semantic: semanticSummary,
        resource: resourceSummary,
        policy_grant: policyGrantSummary,
      });
    }
    const policyFailure = evaluatePolicyRequirements(normalized, policyDecision);
    if (policyFailure) {
      return failureResult(normalized, "bounded_policy", policyFailure.code, {
        semantic: semanticSummary,
        resource: resourceSummary,
        policy_grant: policyGrantSummary,
        policy: { decision: policyDecision.decision, decision_sha256: policyDecision.decision_sha256, ...policyFailure },
      });
    }

    let endpointResult;
    try {
      endpointResult = await resolveEndpointCertification({
        principal: normalized.principal,
        effectiveSubject: normalized.effectiveSubject,
        tenantRef: normalized.tenantId,
        workspaceRef: normalized.workspaceId,
        capabilityKey: normalized.capabilityKey,
        providerBinding: normalized.providerBinding,
        now: normalized.now,
      });
    } catch (error) {
      return failureResult(normalized, "endpoint_certification", stageErrorCode("endpoint_certification", error), {
        semantic: semanticSummary,
        resource: resourceSummary,
        policy_grant: policyGrantSummary,
        policy: { decision: policyDecision.decision, decision_sha256: policyDecision.decision_sha256 },
      });
    }
    const endpointSummary = certificationEvidence(endpointResult);
    if (
      endpointResult?.status !== "resolved" ||
      endpointResult?.decision !== "allow" ||
      endpointResult?.endpointResolved !== true ||
      endpointResult?.certificationSatisfied !== true ||
      (normalized.intent.dispatchRequested && endpointResult?.dispatchCertified !== true) ||
      (normalized.intent.applyRequested && endpointResult?.applyCertified !== true) ||
      endpointResult?.authorityGranted !== false ||
      endpointResult?.secretsIncluded !== false ||
      endpointResult?.canonicalEndpointKey !== semanticItem.selection.canonicalEndpointKey
    ) {
      return failureResult(normalized, "endpoint_certification", "FINAL_BOUNDARY_ENDPOINT_NOT_CERTIFIED", {
        semantic: semanticSummary,
        resource: resourceSummary,
        policy_grant: policyGrantSummary,
        policy: { decision: policyDecision.decision, decision_sha256: policyDecision.decision_sha256 },
        certification: endpointSummary,
      });
    }
    const postCertificationPolicyFailure = evaluatePolicyRequirements(normalized, policyDecision, endpointResult);
    if (postCertificationPolicyFailure) {
      return failureResult(normalized, "endpoint_certification", postCertificationPolicyFailure.code, {
        semantic: semanticSummary,
        resource: resourceSummary,
        policy_grant: policyGrantSummary,
        policy: { decision: policyDecision.decision, decision_sha256: policyDecision.decision_sha256 },
        certification: endpointSummary,
        ...postCertificationPolicyFailure,
      });
    }

    const approvalRequirement = requirement(policyDecision, "require_approval");
    const effectful = normalized.intent.dispatchRequested || normalized.intent.applyRequested || normalized.intent.externalWriteRequested;
    let approvalEvidence = null;
    if (effectful || approvalRequirement) {
      if (!normalized.holdId || !pool) {
        return failureResult(normalized, "approval", "FINAL_BOUNDARY_APPROVAL_REQUIRED", {
          semantic: semanticSummary,
          resource: resourceSummary,
          policy_grant: policyGrantSummary,
          policy: { decision: policyDecision.decision, decision_sha256: policyDecision.decision_sha256 },
          certification: endpointSummary,
        });
      }
      try {
        approvalEvidence = await readApprovalHold({
          pool,
          holdId: normalized.holdId,
          planId: normalized.planId,
          planStepId: normalized.planStepId,
          tenantId: normalized.tenantId,
          planHashSha256: normalized.planHashSha256,
          requestHashSha256: normalized.requestHashSha256,
          nodeId: normalized.nodeId,
          capabilityKey: normalized.capabilityKey,
          actionIds: normalized.actionIds,
          resourceIds: normalized.resourceIds,
          environment: normalized.environment,
          effectClass: normalized.effectClass,
          now: normalized.now,
        });
      } catch (error) {
        return failureResult(normalized, "approval", stageErrorCode("approval", error), {
          semantic: semanticSummary,
          resource: resourceSummary,
          policy_grant: policyGrantSummary,
          policy: { decision: policyDecision.decision, decision_sha256: policyDecision.decision_sha256 },
          certification: endpointSummary,
        });
      }
      if (approvalEvidence?.approval_satisfied !== true || approvalEvidence?.secrets_included !== false) {
        return failureResult(normalized, "approval", "FINAL_BOUNDARY_APPROVAL_NOT_SATISFIED", {
          semantic: semanticSummary,
          resource: resourceSummary,
          policy_grant: policyGrantSummary,
          policy: { decision: policyDecision.decision, decision_sha256: policyDecision.decision_sha256 },
          certification: endpointSummary,
        });
      }
    }

    const evidence = {
      semantic: semanticSummary,
      resource: resourceSummary,
      policy_grant: policyGrantSummary,
      policy: {
        decision: policyDecision.decision,
        decision_sha256: policyDecision.decision_sha256,
        matched_policy_versions: policyDecision.matched_policy_versions,
        reason_codes: policyDecision.reason_codes,
      },
      certification: endpointSummary,
      approval: approvalEvidence ? {
        hold_id: approvalEvidence.hold_id,
        binding_sha256: approvalEvidence.binding_sha256,
        evidence_sha256: approvalEvidence.evidence_sha256,
        expires_at: approvalEvidence.expires_at,
      } : null,
    };
    const withoutHash = {
      contract_version: "growth-control-final-boundary-decision-v1",
      status: "ready",
      decision: "allow",
      stage: "complete",
      reason_codes: ["FINAL_BOUNDARY_ALL_CHECKS_SATISFIED"],
      evidence,
      tenant_id: normalized.tenantId,
      workspace_id: normalized.workspaceId,
      plan_id: normalized.planId,
      plan_step_id: normalized.planStepId,
      request_hash_sha256: normalized.requestHashSha256,
      plan_hash_sha256: normalized.planHashSha256,
      capability_key: normalized.capabilityKey,
      resource_ids: normalized.resourceIds,
      action_ids: normalized.actionIds,
      environment: normalized.environment,
      effect_class: normalized.effectClass,
      execution_authorized: true,
      dispatch_allowed: normalized.intent.dispatchRequested,
      apply_allowed: normalized.intent.applyRequested,
      external_write_allowed: normalized.intent.externalWriteRequested,
      authority_granted: false,
      runtime_authority_changed: false,
      provider_call_made: false,
      provider_dispatch_performed: false,
      credential_payload_read: false,
      secrets_included: false,
    };
    return deepFreeze({ ...withoutHash, boundary_decision_sha256: stableSha256(withoutHash) });
  }

  return Object.freeze({ evaluate });
}

export const growthControlFinalBoundaryContract = Object.freeze({
  version: "growth-control-final-boundary-decision-v1",
  stage_order: [
    "semantic_capability",
    "resource_authority",
    "policy_grant",
    "bounded_policy",
    "endpoint_certification",
    "approval",
  ],
  fail_closed: true,
  exact_plan_request_resource_binding: true,
  approval_required_for_provider_effect: true,
  authority_granted: false,
  provider_call_made: false,
  provider_dispatch_performed: false,
  secrets_included: false,
});

export const _testingGrowthControlFinalBoundary = Object.freeze({
  normalizeInput,
  failureResult,
  semanticEvidence,
  selectionMatches,
  resourceEvidence,
  policyGrantEvidence,
  certificationEvidence,
  evaluatePolicyRequirements,
  missingValues,
  deepFreeze,
});
