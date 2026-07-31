import { assertExecutionCapsuleIntegrity, deepFreeze } from "../domain/index.js";
import { ExecutionCapsuleValidationStatus } from "../application/executionCapsuleService.js";

const TOKEN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,190}$/u;
const TARGET_FIELDS = Object.freeze([
  "tenantRef",
  "workspaceRef",
  "brandRef",
  "resourceType",
  "resourceRef",
  "connectionRef",
]);
const REQUIRED_DYNAMIC_EVIDENCE_KEYS = Object.freeze([
  "approval_state",
  "capability_envelope",
  "connection_status",
  "owner_authority",
  "resource_version",
]);

function cleanToken(value, fieldName) {
  const token = typeof value === "string" ? value.trim() : "";
  if (!TOKEN_PATTERN.test(token)) {
    throw new TypeError(`${fieldName} must be a bounded token.`);
  }
  return token;
}

function safeTelemetryToken(value, fallback = "unknown") {
  const token = typeof value === "string" ? value.trim() : "";
  return TOKEN_PATTERN.test(token) ? token : fallback;
}

function safeReasonCodes(value, fallback) {
  const source = Array.isArray(value) ? value : [];
  const bounded = [...new Set(source
    .map((entry) => typeof entry === "string" ? entry.trim() : "")
    .filter((entry) => TOKEN_PATTERN.test(entry)))]
    .sort()
    .slice(0, 16);
  return bounded.length > 0 ? bounded : [fallback];
}

function safeClockMilliseconds(clock) {
  try {
    const value = clock();
    if (value instanceof Date) return value.getTime();
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  } catch {
    return null;
  }
}

function durationMilliseconds(clock, startedAt) {
  const finishedAt = safeClockMilliseconds(clock);
  if (!Number.isFinite(startedAt) || !Number.isFinite(finishedAt)) return 0;
  return Math.max(0, Math.round(finishedAt - startedAt));
}

export class ExecutionCapsuleMutationValidationError extends Error {
  constructor(code, reasonCodes = [code]) {
    super(code);
    this.name = "ExecutionCapsuleMutationValidationError";
    this.code = code;
    this.status = 409;
    this.reasonCodes = Object.freeze(safeReasonCodes(reasonCodes, code));
  }
}

function requireMutationOperationContract(operationContract) {
  if (!operationContract || typeof operationContract !== "object" || Array.isArray(operationContract)) {
    throw new TypeError("operationContract must be an object.");
  }
  if (operationContract.operationKind !== "mutation" || operationContract.mutationRequired !== true) {
    throw new ExecutionCapsuleMutationValidationError(
      "execution_capsule_mutation_contract_required",
    );
  }
  if (operationContract.reversible !== true) {
    throw new ExecutionCapsuleMutationValidationError(
      "execution_capsule_reversible_mutation_required",
    );
  }
  if (!Array.isArray(operationContract.dynamicEvidenceKeys)) {
    throw new TypeError("operationContract.dynamicEvidenceKeys must be an array.");
  }
  const dynamicEvidenceKeys = [...new Set(operationContract.dynamicEvidenceKeys
    .map((entry, index) => cleanToken(
      entry,
      `operationContract.dynamicEvidenceKeys[${index}]`,
    )))]
    .sort();
  if (
    dynamicEvidenceKeys.length !== REQUIRED_DYNAMIC_EVIDENCE_KEYS.length ||
    dynamicEvidenceKeys.some((key, index) => key !== REQUIRED_DYNAMIC_EVIDENCE_KEYS[index])
  ) {
    throw new ExecutionCapsuleMutationValidationError(
      "execution_capsule_mutation_dynamic_evidence_contract_incomplete",
    );
  }
  return deepFreeze({
    operationKey: cleanToken(operationContract.operationKey, "operationContract.operationKey"),
    operationKind: "mutation",
    riskClass: cleanToken(operationContract.riskClass || "mutation", "operationContract.riskClass"),
    mutationRequired: true,
    reversible: true,
    dynamicEvidenceKeys,
  });
}

function requireMutationDescriptor(mutationDescriptor) {
  if (!mutationDescriptor || typeof mutationDescriptor !== "object" || Array.isArray(mutationDescriptor)) {
    throw new TypeError("mutationDescriptor must be an object.");
  }
  if (mutationDescriptor.reversible !== true || mutationDescriptor.rollbackMode !== "required") {
    throw new ExecutionCapsuleMutationValidationError(
      "execution_capsule_mutation_rollback_contract_required",
    );
  }
  return deepFreeze({
    mutationRef: cleanToken(mutationDescriptor.mutationRef, "mutationDescriptor.mutationRef"),
    expectedResourceVersion: cleanToken(
      mutationDescriptor.expectedResourceVersion,
      "mutationDescriptor.expectedResourceVersion",
    ),
    nextResourceVersion: cleanToken(
      mutationDescriptor.nextResourceVersion,
      "mutationDescriptor.nextResourceVersion",
    ),
    reversible: true,
    rollbackMode: "required",
  });
}

function requireGovernanceDecision(governanceDecision, operationContract, capsule) {
  if (!governanceDecision || typeof governanceDecision !== "object" || Array.isArray(governanceDecision)) {
    throw new ExecutionCapsuleMutationValidationError(
      "execution_capsule_mutation_governance_missing",
    );
  }
  if (
    governanceDecision.status !== "allowed" ||
    governanceDecision.dispatchAllowed !== true ||
    governanceDecision.mutationAllowed !== true
  ) {
    throw new ExecutionCapsuleMutationValidationError(
      "execution_capsule_mutation_governance_blocked",
      governanceDecision.reasonCodes,
    );
  }
  const operationKey = cleanToken(
    governanceDecision.operationKey,
    "governanceDecision.operationKey",
  );
  const contextHash = cleanToken(
    governanceDecision.contextHash,
    "governanceDecision.contextHash",
  );
  if (operationKey !== operationContract.operationKey) {
    throw new ExecutionCapsuleMutationValidationError(
      "execution_capsule_mutation_operation_mismatch",
    );
  }
  if (contextHash !== capsule.contextHash) {
    throw new ExecutionCapsuleMutationValidationError(
      "execution_capsule_mutation_governance_context_mismatch",
    );
  }
  return deepFreeze({
    decisionRef: cleanToken(governanceDecision.decisionRef, "governanceDecision.decisionRef"),
    decisionRevision: cleanToken(
      governanceDecision.decisionRevision,
      "governanceDecision.decisionRevision",
    ),
    operationKey,
    contextHash,
    status: "allowed",
    dispatchAllowed: true,
    mutationAllowed: true,
  });
}

function requireApprovalDecision(approvalDecision, operationContract, capsule) {
  if (!approvalDecision || typeof approvalDecision !== "object" || Array.isArray(approvalDecision)) {
    throw new ExecutionCapsuleMutationValidationError(
      "execution_capsule_mutation_approval_missing",
    );
  }
  if (approvalDecision.status !== "approved" || approvalDecision.mutationAllowed !== true) {
    throw new ExecutionCapsuleMutationValidationError(
      "execution_capsule_mutation_approval_blocked",
      approvalDecision.reasonCodes,
    );
  }
  const operationKey = cleanToken(
    approvalDecision.operationKey,
    "approvalDecision.operationKey",
  );
  const contextHash = cleanToken(
    approvalDecision.contextHash,
    "approvalDecision.contextHash",
  );
  if (operationKey !== operationContract.operationKey) {
    throw new ExecutionCapsuleMutationValidationError(
      "execution_capsule_mutation_approval_operation_mismatch",
    );
  }
  if (contextHash !== capsule.contextHash) {
    throw new ExecutionCapsuleMutationValidationError(
      "execution_capsule_mutation_approval_context_mismatch",
    );
  }
  return deepFreeze({
    approvalRef: cleanToken(approvalDecision.approvalRef, "approvalDecision.approvalRef"),
    approvalRevision: cleanToken(
      approvalDecision.approvalRevision,
      "approvalDecision.approvalRevision",
    ),
    operationKey,
    contextHash,
    status: "approved",
    mutationAllowed: true,
  });
}

function requireExactSelectedTarget(selectedTarget, capsule) {
  if (!selectedTarget || typeof selectedTarget !== "object" || Array.isArray(selectedTarget)) {
    throw new TypeError("dynamicEvidence.selectedTarget must be an object.");
  }
  const mismatches = TARGET_FIELDS.filter((field) =>
    (selectedTarget[field] ?? null) !== (capsule[field] ?? null)
  );
  if (mismatches.length > 0) {
    throw new ExecutionCapsuleMutationValidationError(
      "context_re_resolution_required",
      ["execution_capsule_mutation_target_substitution_blocked"],
    );
  }
  return deepFreeze(Object.fromEntries(TARGET_FIELDS.map((field) => [
    field,
    capsule[field] ?? null,
  ])));
}

function requireDynamicEvidence(value, {
  operationContract,
  capsule,
  approval,
  mutationDescriptor,
}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("dynamicEvidenceProvider must return an object.");
  }
  if (!value.currentContext || typeof value.currentContext !== "object") {
    throw new TypeError("dynamicEvidence.currentContext must be an object.");
  }
  if (!Array.isArray(value.currentDependencies)) {
    throw new TypeError("dynamicEvidence.currentDependencies must be an array.");
  }
  if (!Array.isArray(value.refreshedEvidence)) {
    throw new TypeError("dynamicEvidence.refreshedEvidence must be an array.");
  }

  const selectedTarget = requireExactSelectedTarget(value.selectedTarget, capsule);
  const evidenceByKey = new Map();
  for (const [index, entry] of value.refreshedEvidence.entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError(`dynamicEvidence.refreshedEvidence[${index}] must be an object.`);
    }
    const key = cleanToken(entry.key, `dynamicEvidence.refreshedEvidence[${index}].key`);
    if (evidenceByKey.has(key)) {
      throw new ExecutionCapsuleMutationValidationError(
        "execution_capsule_mutation_dynamic_evidence_duplicate",
      );
    }
    if (entry.status !== "current") {
      throw new ExecutionCapsuleMutationValidationError(
        "execution_capsule_mutation_dynamic_evidence_not_current",
        entry.reasonCodes,
      );
    }
    evidenceByKey.set(key, deepFreeze({
      key,
      revision: cleanToken(
        entry.revision,
        `dynamicEvidence.refreshedEvidence[${index}].revision`,
      ),
      status: "current",
    }));
  }

  const actualKeys = [...evidenceByKey.keys()].sort();
  if (
    actualKeys.length !== operationContract.dynamicEvidenceKeys.length ||
    actualKeys.some((key, index) => key !== operationContract.dynamicEvidenceKeys[index])
  ) {
    throw new ExecutionCapsuleMutationValidationError(
      "execution_capsule_mutation_dynamic_evidence_incomplete",
    );
  }

  const expectedRevisions = new Map([
    ["approval_state", approval.approvalRevision],
    ["capability_envelope", capsule.capabilityRevision],
    ["connection_status", capsule.credentialReadinessRevision],
    ["owner_authority", capsule.authorityRevision],
    ["resource_version", mutationDescriptor.expectedResourceVersion],
  ]);
  const mismatchReasonCodes = [];
  for (const [key, expectedRevision] of expectedRevisions.entries()) {
    if (evidenceByKey.get(key)?.revision !== expectedRevision) {
      mismatchReasonCodes.push(`execution_capsule_mutation_${key}_revision_mismatch`);
    }
  }
  if (mismatchReasonCodes.length > 0) {
    throw new ExecutionCapsuleMutationValidationError(
      "execution_capsule_mutation_dynamic_evidence_binding_mismatch",
      mismatchReasonCodes,
    );
  }

  return {
    currentContext: value.currentContext,
    currentDependencies: value.currentDependencies,
    dynamicRefreshComplete: value.dynamicRefreshComplete === true,
    interpretationRequired: value.interpretationRequired === true,
    blockedReasonCodes: Array.isArray(value.blockedReasonCodes)
      ? value.blockedReasonCodes
      : [],
    now: value.now,
    selectedTarget,
    refreshedEvidence: deepFreeze(operationContract.dynamicEvidenceKeys.map(
      (key) => evidenceByKey.get(key),
    )),
  };
}

function safeExecutionContext(capsule) {
  return deepFreeze({
    capsuleRef: capsule.capsuleRef,
    contextHash: capsule.contextHash,
    contextRevision: capsule.contextRevision,
    tenantRef: capsule.tenantRef,
    workspaceRef: capsule.workspaceRef,
    brandRef: capsule.brandRef ?? null,
    resourceType: capsule.resourceType,
    resourceRef: capsule.resourceRef,
    connectionRef: capsule.connectionRef,
  });
}

function requireReversibleMutationReceipt(receipt) {
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new ExecutionCapsuleMutationValidationError(
      "execution_capsule_mutation_receipt_missing",
    );
  }
  const allowedKeys = new Set([
    "mutationApplied",
    "reversible",
    "rollbackRef",
    "providerDispatchPerformed",
    "databaseWritePerformed",
  ]);
  if (Reflect.ownKeys(receipt).some((key) => typeof key !== "string" || !allowedKeys.has(key))) {
    throw new ExecutionCapsuleMutationValidationError(
      "execution_capsule_mutation_receipt_unbounded",
    );
  }
  if (
    receipt.mutationApplied !== true ||
    receipt.reversible !== true ||
    receipt.providerDispatchPerformed !== false ||
    receipt.databaseWritePerformed !== false
  ) {
    throw new ExecutionCapsuleMutationValidationError(
      "execution_capsule_mutation_receipt_invalid",
    );
  }
  cleanToken(receipt.rollbackRef, "mutationReceipt.rollbackRef");
  return receipt;
}

async function emitSafely(emitTelemetry, event) {
  try {
    await emitTelemetry(deepFreeze(event));
  } catch {
    // Telemetry cannot alter mutation validation or executor behavior.
  }
}

function createDisabledPilot({ executeReversibleMutation }) {
  return Object.freeze({
    enabled: false,
    mode: "legacy_mutation_execution",
    execute({ legacyInput } = {}) {
      return executeReversibleMutation(legacyInput);
    },
    rollback() {
      return createDisabledPilot({ executeReversibleMutation });
    },
  });
}

export function createExecutionCapsuleMutationValidationPilot({
  enabled = false,
  capsuleService = null,
  dynamicEvidenceProvider = null,
  executeReversibleMutation = null,
  emitTelemetry = null,
  clock = () => Date.now(),
} = {}) {
  if (typeof executeReversibleMutation !== "function") {
    throw new TypeError("executeReversibleMutation must be a function.");
  }
  if (enabled !== true) return createDisabledPilot({ executeReversibleMutation });
  if (!capsuleService || typeof capsuleService.validate !== "function") {
    throw new TypeError("capsuleService.validate must be a function when the pilot is enabled.");
  }
  if (typeof dynamicEvidenceProvider !== "function") {
    throw new TypeError("dynamicEvidenceProvider must be a function when the pilot is enabled.");
  }
  if (typeof emitTelemetry !== "function") {
    throw new TypeError("emitTelemetry must be a function when the pilot is enabled.");
  }
  if (typeof clock !== "function") throw new TypeError("clock must be a function.");

  return Object.freeze({
    enabled: true,
    mode: "execution_capsule_mutation_validation_pilot",
    async execute({
      capsule,
      operationContract,
      governanceDecision,
      approvalDecision,
      mutationDescriptor,
    } = {}) {
      const startedAt = safeClockMilliseconds(clock);
      let normalizedOperation = null;
      let validation = null;
      let governance = null;
      let approval = null;
      let dynamicRefreshComplete = false;
      let exactTargetRetained = true;
      let executorInvoked = false;
      try {
        normalizedOperation = requireMutationOperationContract(operationContract);
        const normalizedMutation = requireMutationDescriptor(mutationDescriptor);
        const canonicalCapsule = assertExecutionCapsuleIntegrity(capsule);
        governance = requireGovernanceDecision(
          governanceDecision,
          normalizedOperation,
          canonicalCapsule,
        );
        approval = requireApprovalDecision(
          approvalDecision,
          normalizedOperation,
          canonicalCapsule,
        );
        const dynamicEvidence = requireDynamicEvidence(
          await dynamicEvidenceProvider({
            capsule: canonicalCapsule,
            operationContract: normalizedOperation,
            governanceDecision: governance,
            approvalDecision: approval,
            mutationDescriptor: normalizedMutation,
          }),
          {
            operationContract: normalizedOperation,
            capsule: canonicalCapsule,
            approval,
            mutationDescriptor: normalizedMutation,
          },
        );
        dynamicRefreshComplete = dynamicEvidence.dynamicRefreshComplete;
        validation = capsuleService.validate({
          capsule: canonicalCapsule,
          currentContext: dynamicEvidence.currentContext,
          currentDependencies: dynamicEvidence.currentDependencies,
          operationKind: "mutation",
          dynamicRefreshComplete,
          interpretationRequired: dynamicEvidence.interpretationRequired,
          blockedReasonCodes: dynamicEvidence.blockedReasonCodes,
          now: dynamicEvidence.now ?? clock(),
        });
        if (validation.status !== ExecutionCapsuleValidationStatus.VALID) {
          throw new ExecutionCapsuleMutationValidationError(
            validation.requiresContextReresolution
              ? "context_re_resolution_required"
              : `execution_capsule_mutation_${validation.status}`,
            validation.reasonCodes,
          );
        }

        const executionEnvelope = deepFreeze({
          operationContract: normalizedOperation,
          governanceDecision: governance,
          approvalDecision: approval,
          executionContext: safeExecutionContext(canonicalCapsule),
          mutationDescriptor: normalizedMutation,
          dynamicEvidence: dynamicEvidence.refreshedEvidence,
        });
        executorInvoked = true;
        const receipt = await executeReversibleMutation(executionEnvelope);
        requireReversibleMutationReceipt(receipt);
        await emitSafely(emitTelemetry, {
          eventType: "execution_capsule_mutation_validation",
          operationKey: normalizedOperation.operationKey,
          validationStatus: validation.status,
          governanceStatus: governance.status,
          approvalStatus: approval.status,
          dynamicRefreshComplete: true,
          exactTargetRetained: true,
          executorInvoked: true,
          mutationApplied: true,
          reversible: true,
          providerDispatchPerformed: false,
          databaseWritePerformed: false,
          capsuleGrantedAuthority: false,
          durationMs: durationMilliseconds(clock, startedAt),
          reasonCodes: [],
          secretsIncluded: false,
        });
        return receipt;
      } catch (error) {
        if (
          error?.code === "context_re_resolution_required" &&
          error?.reasonCodes?.includes("execution_capsule_mutation_target_substitution_blocked")
        ) {
          exactTargetRetained = false;
        }
        await emitSafely(emitTelemetry, {
          eventType: "execution_capsule_mutation_validation",
          operationKey: normalizedOperation?.operationKey ||
            safeTelemetryToken(operationContract?.operationKey),
          validationStatus: validation?.status || null,
          governanceStatus: governance?.status || null,
          approvalStatus: approval?.status || null,
          dynamicRefreshComplete,
          exactTargetRetained,
          executorInvoked,
          mutationApplied: false,
          reversible: true,
          providerDispatchPerformed: false,
          databaseWritePerformed: false,
          capsuleGrantedAuthority: false,
          durationMs: durationMilliseconds(clock, startedAt),
          reasonCodes: safeReasonCodes(
            error?.reasonCodes || [error?.code],
            "execution_capsule_mutation_validation_failed",
          ),
          secretsIncluded: false,
        });
        throw error;
      }
    },
    rollback() {
      return createDisabledPilot({ executeReversibleMutation });
    },
  });
}
