import { createAuthenticatedProviderConsentUseCaseService as createCoreService } from "./authenticatedProviderConsentUseCaseService.js";
import { assertProviderConsentReadinessRepository } from "./repositoryPorts.js";
import { requireApplicationObject } from "./applicationSupport.js";

export function createAuthenticatedProviderConsentUseCaseService(options = {}) {
  const source = requireApplicationObject(options, "authenticatedProviderConsentUseCaseOptions");
  const readinessRepository = assertProviderConsentReadinessRepository(
    source.providerConsentReadinessRepository,
  );
  const globalReadinessBoundary = Object.freeze({
    async findProviderConsentReadiness(input = {}) {
      return readinessRepository.findProviderConsentReadiness({
        operation: input.operation,
      });
    },
  });
  return createCoreService({
    ...source,
    providerConsentReadinessRepository: globalReadinessBoundary,
  });
}
