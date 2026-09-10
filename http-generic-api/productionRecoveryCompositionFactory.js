// Canonical Production Recovery composition authority facade.
//
// The existing composition factory remains the implementation core. This facade adds
// the missing final authority invariant: a Production live result cannot expose
// mutation authority unless its Recovery store satisfies the canonical mutation-grade
// contract. A false-positive live candidate is converted to an explicit fail-closed
// composition before it reaches server consumers.
export * from "./productionRecoveryCompositionFactoryCore.js";

import { createProductionRecoveryComposition as createCoreProductionRecoveryComposition } from "./productionRecoveryCompositionFactoryCore.js";
import { isMutationGradeRecoveryStore } from "./recoveryDurableStoreContract.js";

function failClosedMutationGradeResult(result) {
  const factory = result?.productionRecoveryCompositionFactory || {};
  const readiness = factory.authority_readiness || {};
  const kernelDependencies = result?.kernelDependencies && typeof result.kernelDependencies === "object"
    ? Object.freeze({ ...result.kernelDependencies, recoveryStore: null })
    : result?.kernelDependencies;
  const authorityInventory = result?.authority_inventory && typeof result.authority_inventory === "object"
    ? Object.freeze({ ...result.authority_inventory, live_activation: false, mutation_authority_available: false })
    : result?.authority_inventory;

  return Object.freeze({
    ...result,
    mode: "injected_non_live",
    live_activation: false,
    mutation_authority_available: false,
    ...(kernelDependencies !== undefined ? { kernelDependencies } : {}),
    ...(authorityInventory !== undefined ? { authority_inventory: authorityInventory } : {}),
    productionRecoveryCompositionFactory: Object.freeze({
      ...factory,
      live_activation: false,
      authority_readiness: Object.freeze({
        ...readiness,
        mutation_grade_recovery_store: false,
        live_ready: false,
        activation_eligible: false,
        live_activation: false,
      }),
      denial_reason: "mutation_grade_recovery_store_required",
      provider_accessed: false,
      database_mutation_performed: false,
      secrets_included: false,
    }),
  });
}

export function createProductionRecoveryComposition(options = {}) {
  const result = createCoreProductionRecoveryComposition(options);
  if (result?.live_activation !== true) return result;
  if (isMutationGradeRecoveryStore(result?.components?.recoveryStore)) return result;
  return failClosedMutationGradeResult(result);
}

export const productionRecoveryCompositionAuthorityFacadeInternals = Object.freeze({
  failClosedMutationGradeResult,
});
