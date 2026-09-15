import { _testingRecoveryKernel } from "./recoveryKernel.js";

export const RECOVERY_KERNEL_INSPECTION_BRIDGE_CONTRACT = "mad4b.recovery-kernel-inspection-bridge.v1";

function unavailable(name) {
  throw Object.assign(new Error(`Canonical Recovery Kernel inspection primitive is unavailable: ${name}`), {
    code: "RECOVERY_KERNEL_INSPECTION_PRIMITIVE_UNAVAILABLE",
    status: 503,
    details: { primitive: name, database_mutation_performed: false, production_authority: false, secrets_included: false },
  });
}

export function deriveCanonicalRecoveryFindingsFromInspection(inspection = {}) {
  const primitive = _testingRecoveryKernel?.findingsFromInspection;
  if (typeof primitive !== "function") unavailable("findingsFromInspection");
  return structuredClone(primitive(structuredClone(inspection)));
}

export function classifyCanonicalRecoveryFinding(finding = {}) {
  const primitive = _testingRecoveryKernel?.classifyFinding;
  if (typeof primitive !== "function") unavailable("classifyFinding");
  return structuredClone(primitive(structuredClone(finding)));
}

export function assertCanonicalRoleRebuildFinding(finding = {}) {
  const classification = classifyCanonicalRecoveryFinding(finding);
  const role = classification.target_role;
  const expectedCapability = `${role}.baseline.rebuild_empty`;
  if (!["runtime", "governance", "runtime_persistence"].includes(role)
    || classification.classification !== "empty_uninitialized_database"
    || classification.operation !== "database.rebuild_empty"
    || classification.capability_key !== expectedCapability
    || finding.candidate_capability !== expectedCapability) {
    throw Object.assign(new Error("Staging selective rebuild requires a canonical role-specific Recovery Kernel rebuild finding."), {
      code: "RECOVERY_ROLE_REBUILD_FINDING_INVALID",
      status: 409,
      details: { role: role || null, capability_key: classification.capability_key || null, database_mutation_performed: false, production_authority: false, secrets_included: false },
    });
  }
  return classification;
}
