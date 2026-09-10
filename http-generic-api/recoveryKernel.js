// Canonical Recovery durability facade.
//
// The implementation core keeps the existing Recovery lifecycle unchanged, while every
// public store-dependent entrypoint is qualified here through recoveryDurableStoreContract.
// This makes evidence-grade durability and mutation-grade authority distinct by contract,
// and degrades read paths to memory-only when an observed control-store readiness check
// says the durable inspection store is not currently usable.
export * from "./recoveryKernelCore.js";

import * as Core from "./recoveryKernelCore.js";
import {
  isDurableInspectionStore,
  isMutationGradeRecoveryStore,
  isReadOnlyRecoveryStoreReady,
} from "./recoveryDurableStoreContract.js";

const STORE_BACKED_READ_CAPABILITIES = new Set([
  "database_full_inspection",
  "production_host_local_database_inspect",
  "finding_details",
  "remediation_plan_create",
  "host_breakglass_plan",
  "remediation_plan_preview",
  "host_breakglass_preview",
  "remediation_step_verify",
  "host_breakglass_verify",
  "recovery_run_get",
  "host_breakglass_run_get",
  "recovery_evidence_get",
  "recovery_evidence_export",
  "recovery_incident_create",
]);

const MUTATION_GRADE_CAPABILITIES = new Set([
  "remediation_step_execute",
  "host_breakglass_execute",
  "unsupported_capability_execute",
]);

function compactReadiness(readiness) {
  if (!readiness || typeof readiness !== "object" || Array.isArray(readiness)) return null;
  return Object.freeze({
    contract: readiness.contract || null,
    ready: readiness.ready === true,
    scope: readiness.scope || null,
    database_mutation_performed: readiness.database_mutation_performed === true,
    schema_auto_apply: readiness.schema_auto_apply === true,
    secrets_included: readiness.secrets_included === true,
  });
}

async function resolveDurableInspectionStore(recoveryStore) {
  const structurallyQualified = isDurableInspectionStore(recoveryStore);
  if (!structurallyQualified) {
    return Object.freeze({
      store: null,
      structurally_qualified: false,
      readiness_observed: false,
      ready: false,
      readiness: null,
    });
  }

  // Backward compatibility is structural only: older injected stores that predate the
  // optional readiness probe remain usable if they satisfy the canonical durability
  // contract. Once getReadiness exists, its live observation is authoritative.
  if (typeof recoveryStore.getReadiness !== "function") {
    return Object.freeze({
      store: recoveryStore,
      structurally_qualified: true,
      readiness_observed: false,
      ready: true,
      readiness: null,
    });
  }

  try {
    const readiness = await recoveryStore.getReadiness();
    const ready = isReadOnlyRecoveryStoreReady(readiness);
    return Object.freeze({
      store: ready ? recoveryStore : null,
      structurally_qualified: true,
      readiness_observed: true,
      ready,
      readiness: compactReadiness(readiness),
    });
  } catch (error) {
    return Object.freeze({
      store: null,
      structurally_qualified: true,
      readiness_observed: true,
      ready: false,
      readiness: Object.freeze({
        contract: "mad4b.recovery-control-store-readiness.v1",
        ready: false,
        scope: "durable_inspection",
        database_mutation_performed: false,
        schema_auto_apply: false,
        secrets_included: false,
        error_code: String(error?.code || "RECOVERY_CONTROL_STORE_READINESS_FAILED").slice(0, 128),
      }),
    });
  }
}

async function resolveMutationGradeStore(recoveryStore) {
  if (!isMutationGradeRecoveryStore(recoveryStore)) return null;
  const inspection = await resolveDurableInspectionStore(recoveryStore);
  return inspection.store ? recoveryStore : null;
}

function withRecoveryStore(deps = {}, recoveryStore = null) {
  return { ...(deps || {}), recoveryStore };
}

function normalizedDurability(result, sourceStore, resolution) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const inspectionDurable = Boolean(resolution?.store);
  const mutationGradeDurable = inspectionDurable && isMutationGradeRecoveryStore(sourceStore);
  const current = result.durability && typeof result.durability === "object" && !Array.isArray(result.durability)
    ? result.durability
    : {};
  return {
    ...result,
    durability: {
      ...current,
      store_present: Boolean(sourceStore),
      store_contract_valid: isDurableInspectionStore(sourceStore),
      inspection_durable: inspectionDurable,
      mutation_grade_durable: mutationGradeDurable,
      readiness_observed: resolution?.readiness_observed === true,
      store_ready: resolution?.ready === true,
      ...(resolution?.readiness ? { readiness: resolution.readiness } : {}),
      mode: inspectionDurable
        ? "canonical_durable_inspection_store"
        : (sourceStore ? "degraded_memory_only_store_not_ready_or_unqualified" : "degraded_memory_only_test_state"),
    },
  };
}

export async function inspectProductionDatabase(input = {}, deps = {}) {
  const sourceStore = deps?.recoveryStore || null;
  const resolution = await resolveDurableInspectionStore(sourceStore);
  const result = await Core.inspectProductionDatabase(input, withRecoveryStore(deps, resolution.store));
  return normalizedDurability(result, sourceStore, resolution);
}

export async function createRemediationPlan(input = {}, deps = {}) {
  const resolution = await resolveDurableInspectionStore(deps?.recoveryStore || null);
  return Core.createRemediationPlan(input, withRecoveryStore(deps, resolution.store));
}

export async function previewRemediationPlan(input = {}, deps = {}) {
  const resolution = await resolveDurableInspectionStore(deps?.recoveryStore || null);
  return Core.previewRemediationPlan(input, withRecoveryStore(deps, resolution.store));
}

export async function verifyRemediationStep(input = {}, deps = {}) {
  const resolution = await resolveDurableInspectionStore(deps?.recoveryStore || null);
  return Core.verifyRemediationStep(input, withRecoveryStore(deps, resolution.store));
}

export async function getRecoveryRun(input = {}, deps = {}) {
  const sourceStore = deps?.recoveryStore || null;
  const resolution = await resolveDurableInspectionStore(sourceStore);
  const result = await Core.getRecoveryRun(input, withRecoveryStore(deps, resolution.store));
  return normalizedDurability(result, sourceStore, resolution);
}

export async function getRecoveryEvidence(input = {}, deps = {}) {
  const sourceStore = deps?.recoveryStore || null;
  const resolution = await resolveDurableInspectionStore(sourceStore);
  const result = await Core.getRecoveryEvidence(input, withRecoveryStore(deps, resolution.store));
  return normalizedDurability(result, sourceStore, resolution);
}

export async function createExecutionTicket(input = {}, deps = {}) {
  const recoveryStore = await resolveMutationGradeStore(deps?.recoveryStore || null);
  return Core.createExecutionTicket(input, withRecoveryStore(deps, recoveryStore));
}

export async function executeRemediationStep(input = {}, deps = {}) {
  const recoveryStore = await resolveMutationGradeStore(deps?.recoveryStore || null);
  return Core.executeRemediationStep(input, withRecoveryStore(deps, recoveryStore));
}

export async function callRecoveryKernelCapability(capabilityKey, input = {}, deps = {}) {
  const key = String(capabilityKey || "").trim();
  const sourceStore = deps?.recoveryStore || null;

  if (MUTATION_GRADE_CAPABILITIES.has(key)) {
    const recoveryStore = await resolveMutationGradeStore(sourceStore);
    return Core.callRecoveryKernelCapability(key, input, withRecoveryStore(deps, recoveryStore));
  }

  if (STORE_BACKED_READ_CAPABILITIES.has(key)) {
    const resolution = await resolveDurableInspectionStore(sourceStore);
    const result = await Core.callRecoveryKernelCapability(key, input, withRecoveryStore(deps, resolution.store));
    if (["database_full_inspection", "production_host_local_database_inspect", "recovery_run_get", "host_breakglass_run_get", "recovery_evidence_get", "recovery_evidence_export"].includes(key)) {
      return normalizedDurability(result, sourceStore, resolution);
    }
    if (key === "finding_details" && result && typeof result === "object") {
      return {
        ...result,
        durable_read: Boolean(resolution.store),
        durability: normalizedDurability({}, sourceStore, resolution).durability,
      };
    }
    return result;
  }

  return Core.callRecoveryKernelCapability(key, input, deps);
}

export const recoveryKernelDurabilityFacadeInternals = Object.freeze({
  STORE_BACKED_READ_CAPABILITIES,
  MUTATION_GRADE_CAPABILITIES,
  resolveDurableInspectionStore,
  resolveMutationGradeStore,
  normalizedDurability,
});
