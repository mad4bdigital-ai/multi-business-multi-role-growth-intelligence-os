import { getPool } from "./db.js";
import { createEffectiveAuthorityEvidenceService } from "./src/application/effectiveAuthority/effectiveAuthorityEvidenceService.js";
import { createEffectiveAuthorityReconciler } from "./src/application/effectiveAuthority/effectiveAuthorityReconciler.js";
import { createEffectiveAuthorityReconciliationScheduler } from "./src/application/effectiveAuthority/effectiveAuthorityReconciliationScheduler.js";
import { createEffectiveAuthorityEvidenceRepository } from "./src/infrastructure/effectiveAuthority/effectiveAuthorityEvidenceRepository.js";
import { createEffectiveAuthorityReconciliationRepository } from "./src/infrastructure/effectiveAuthority/effectiveAuthorityReconciliationRepository.js";
import { createEffectiveAuthorityRepository } from "./src/infrastructure/effectiveAuthority/effectiveAuthorityRepository.js";

export function createEffectiveAuthorityReconciliationRuntime({
  env = process.env,
  logger = console,
  now = () => new Date(),
  resolvePool = async () => getPool(),
} = {}) {
  const authorityRepository = createEffectiveAuthorityRepository({ resolvePool });
  const scopeRepository = createEffectiveAuthorityReconciliationRepository({ resolvePool });
  const evidenceRepository = createEffectiveAuthorityEvidenceRepository({ resolvePool });
  const evidenceService = createEffectiveAuthorityEvidenceService({
    repository: evidenceRepository,
    mode: env.UEACP_SHADOW_EVIDENCE_MODE || "disabled",
    logger,
    now,
  });
  const reconciler = createEffectiveAuthorityReconciler({
    scopeRepository,
    authorityRepository,
    evidenceService,
    now,
  });
  const scheduler = createEffectiveAuthorityReconciliationScheduler({
    runReconciliation: (input) => reconciler.run(input),
    env,
    logger,
    now,
  });
  return Object.freeze({ reconciler, scheduler, evidenceService });
}

let defaultRuntime = null;

export function getEffectiveAuthorityReconciliationRuntime() {
  if (!defaultRuntime) defaultRuntime = createEffectiveAuthorityReconciliationRuntime();
  return defaultRuntime;
}

export async function runEffectiveAuthorityReconciliation(input = {}) {
  return getEffectiveAuthorityReconciliationRuntime().reconciler.run(input);
}

export function startEffectiveAuthorityReconciliationScheduler() {
  return getEffectiveAuthorityReconciliationRuntime().scheduler.start();
}

export function resetEffectiveAuthorityReconciliationRuntimeForTests() {
  defaultRuntime = null;
}
