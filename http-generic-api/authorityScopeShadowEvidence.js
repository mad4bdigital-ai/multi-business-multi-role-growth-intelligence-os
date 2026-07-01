import { getPool } from "./db.js";
import { createAuthorityScopeShadowEvidenceRepository } from "./src/infrastructure/authorityScope/authorityScopeShadowEvidenceRepository.js";

let defaultRepository = null;

function getRepository() {
  if (defaultRepository) return defaultRepository;
  defaultRepository = createAuthorityScopeShadowEvidenceRepository({
    resolvePool: async () => getPool()
  });
  return defaultRepository;
}

export async function persistAuthorityScopeShadowEvidence(input) {
  return getRepository().insert(input);
}

export function resetAuthorityScopeShadowEvidenceForTests() {
  defaultRepository = null;
}
