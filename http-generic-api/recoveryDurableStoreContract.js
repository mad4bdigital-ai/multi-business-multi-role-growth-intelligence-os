export const RECOVERY_DURABLE_STORE_CONTRACT = "mad4b.recovery-durable-store.v1";
export const RECOVERY_DURABLE_STORE_QUALIFICATION_CONTRACT = "mad4b.recovery-durable-store-qualification.v1";

export const DURABLE_INSPECTION_STORE_METHODS = Object.freeze([
  "putRun",
  "getRun",
  "putPlan",
  "getPlan",
  "putFinding",
  "getFinding",
  "getRunByIdempotency",
  "appendEvidenceEvent",
  "putIdempotencyReceipt",
]);

export const MUTATION_GRADE_STORE_METHODS = Object.freeze([
  "claimExecution",
  "reserveApproval",
  "getExecutionTicket",
  "putExecutionTicket",
  "reserveExecutionTicket",
  "releaseExecutionTicket",
  "finalizeExecutionTicket",
  "releaseExecutionClaim",
  "releaseApprovalReservation",
]);

function hasMethods(store, names) {
  return names.every((name) => typeof store?.[name] === "function");
}

export function isIndependentRecoveryStoreBoundary(store) {
  return Boolean(
    store
      && store.recovery_store_contract === RECOVERY_DURABLE_STORE_CONTRACT
      && store.independent_of_target_databases === true
      && store.target_database_binding === "forbidden"
      && store.provider_accessed === false
  );
}

export function isDurableInspectionStore(store) {
  return Boolean(
    isIndependentRecoveryStoreBoundary(store)
      && hasMethods(store, DURABLE_INSPECTION_STORE_METHODS)
  );
}

export function isMutationGradeRecoveryStore(store) {
  return Boolean(
    isDurableInspectionStore(store)
      && hasMethods(store, MUTATION_GRADE_STORE_METHODS)
      && (typeof store?.finalizeApproval === "function" || typeof store?.markApprovalUsed === "function")
      && store?.executionTicketVerifier
      && typeof store.executionTicketVerifier.verify === "function"
  );
}

export function describeRecoveryStoreQualification(store) {
  const boundary = isIndependentRecoveryStoreBoundary(store);
  const missingInspectionMethods = DURABLE_INSPECTION_STORE_METHODS.filter((name) => typeof store?.[name] !== "function");
  const missingMutationMethods = MUTATION_GRADE_STORE_METHODS.filter((name) => typeof store?.[name] !== "function");
  const inspection = boundary && missingInspectionMethods.length === 0;
  const mutation = inspection
    && missingMutationMethods.length === 0
    && (typeof store?.finalizeApproval === "function" || typeof store?.markApprovalUsed === "function")
    && Boolean(store?.executionTicketVerifier && typeof store.executionTicketVerifier.verify === "function");
  return {
    contract: RECOVERY_DURABLE_STORE_QUALIFICATION_CONTRACT,
    boundary_valid: boundary,
    durable_inspection_store: inspection,
    mutation_grade_recovery_store: mutation,
    missing_inspection_methods: missingInspectionMethods,
    missing_mutation_methods: missingMutationMethods,
    provider_accessed: store?.provider_accessed ?? null,
    independent_of_target_databases: store?.independent_of_target_databases === true,
    target_database_binding: store?.target_database_binding ?? null,
    secrets_included: false,
  };
}
