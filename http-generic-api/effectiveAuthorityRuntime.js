import { getPool } from "./db.js";
import { createAuthorityScopeService } from "./src/application/authorityScope/authorityScopeService.js";
import { createEffectiveAuthorityEvidenceService } from "./src/application/effectiveAuthority/effectiveAuthorityEvidenceService.js";
import { createEffectiveAuthorityService } from "./src/application/effectiveAuthority/effectiveAuthorityService.js";
import { createAuthorityScopeRepository } from "./src/infrastructure/authorityScope/authorityScopeRepository.js";
import { createEffectiveAuthorityEvidenceRepository } from "./src/infrastructure/effectiveAuthority/effectiveAuthorityEvidenceRepository.js";
import { createEffectiveAuthorityRepository } from "./src/infrastructure/effectiveAuthority/effectiveAuthorityRepository.js";

let defaultService = null;

export function getEffectiveAuthorityRuntimeService() {
  if (defaultService) return defaultService;
  const resolvePool = async () => getPool();
  const authorityScopeRepository = createAuthorityScopeRepository({ resolvePool });
  const authorityScopeService = createAuthorityScopeService({ repository: authorityScopeRepository });
  const repository = createEffectiveAuthorityRepository({ resolvePool });
  const evidenceRepository = createEffectiveAuthorityEvidenceRepository({ resolvePool });
  const evidenceService = createEffectiveAuthorityEvidenceService({
    repository: evidenceRepository,
    mode: process.env.UEACP_SHADOW_EVIDENCE_MODE || "disabled",
    logger: console,
  });
  defaultService = createEffectiveAuthorityService({
    authorityScopeService,
    repository,
    evidenceService,
  });
  return defaultService;
}

export function resetEffectiveAuthorityRuntimeForTests() {
  defaultService = null;
}
