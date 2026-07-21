import { getPool } from "./db.js";
import { createAuthorityScopeService } from "./src/application/authorityScope/authorityScopeService.js";
import { createEffectiveAuthorityService } from "./src/application/effectiveAuthority/effectiveAuthorityService.js";
import { createAuthorityScopeRepository } from "./src/infrastructure/authorityScope/authorityScopeRepository.js";
import { createEffectiveAuthorityRepository } from "./src/infrastructure/effectiveAuthority/effectiveAuthorityRepository.js";

let defaultService = null;

export function getEffectiveAuthorityRuntimeService() {
  if (defaultService) return defaultService;
  const resolvePool = async () => getPool();
  const authorityScopeRepository = createAuthorityScopeRepository({ resolvePool });
  const authorityScopeService = createAuthorityScopeService({ repository: authorityScopeRepository });
  const repository = createEffectiveAuthorityRepository({ resolvePool });
  defaultService = createEffectiveAuthorityService({ authorityScopeService, repository });
  return defaultService;
}

export function resetEffectiveAuthorityRuntimeForTests() {
  defaultService = null;
}
