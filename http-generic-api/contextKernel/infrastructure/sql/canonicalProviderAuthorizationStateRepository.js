import { createProviderAuthorizationStateRepository as createCompletionRepository } from "./providerAuthorizationStateRepository.js";
import { createProviderConsentStateRepository as createSignedIngressRepository } from "./providerConsentStateRepository.js";

export function createCanonicalProviderAuthorizationStateRepository(options = {}) {
  const signedIngress = createSignedIngressRepository(options);
  const completion = createCompletionRepository(options);

  return Object.freeze({
    issueAuthorizationState: signedIngress.issueAuthorizationState,
    findAuthorizationState: signedIngress.findAuthorizationState,
    claimAuthorizationState: signedIngress.claimAuthorizationState,
    completeClaimedAuthorization: completion.completeClaimedAuthorization,
  });
}

export const _testingCanonicalProviderAuthorizationStateRepository = Object.freeze({
  runtimeAuthority: "canonical_provider_authorization_state_repository",
  signedIngressImplementation: "internal_only",
  completionImplementation: "internal_only",
  weakerClaimExposed: false,
});
