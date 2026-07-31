import { createProviderConsentActivationPilotService as createCorePilotService } from "./providerConsentActivationPilotService.js";
import { requireApplicationString } from "./applicationSupport.js";

function normalizeSha256(value, fieldName, { nullable = false } = {}) {
  if (nullable && (value == null || value === "")) return null;
  const normalized = requireApplicationString(value, fieldName).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new TypeError(`${fieldName} must be a SHA-256 value.`);
  }
  return normalized;
}

function assertProviderCertification(resolved, providerKey) {
  const certification = resolved?.certification || resolved?.adapter?.certification;
  if (!certification || certification.status !== "certified") return resolved;
  requireApplicationString(
    certification.versionRef,
    "providerExchange.certification.versionRef",
  );
  if (certification.providerKey !== providerKey) {
    throw new TypeError("Provider exchange certification does not match providerKey.");
  }
  return resolved;
}

function wrapProviderExchangeResolver(providerExchangeResolver) {
  const resolve = typeof providerExchangeResolver === "function"
    ? providerExchangeResolver
    : providerExchangeResolver?.resolveProviderExchange;
  if (typeof resolve !== "function") {
    throw new TypeError("providerExchangeResolver is required.");
  }
  return async (context) => assertProviderCertification(
    await resolve(context),
    context.providerKey,
  );
}

function wrapAuthorizationRepository(repository) {
  if (!repository || typeof repository !== "object") {
    throw new TypeError("providerAuthorizationStateRepository is required.");
  }
  return Object.freeze({
    issueAuthorizationState: (...args) => repository.issueAuthorizationState(...args),
    claimAuthorizationState: (...args) => repository.claimAuthorizationState(...args),
    completeClaimedAuthorization: (...args) => repository.completeClaimedAuthorization(...args),
    async findAuthorizationState(...args) {
      const state = await repository.findAuthorizationState(...args);
      if (state?.expectedProviderAccountBindingHash != null) {
        normalizeSha256(
          state.expectedProviderAccountBindingHash,
          "state.expectedProviderAccountBindingHash",
        );
      }
      return state;
    },
  });
}

function wrapCredentialEnvelopeService(service) {
  if (!service || typeof service !== "object" || typeof service.sealProviderCredential !== "function") {
    throw new TypeError("credentialEnvelopeService with sealProviderCredential is required.");
  }
  return Object.freeze({
    certification: service.certification,
    async sealProviderCredential(...args) {
      const envelope = await service.sealProviderCredential(...args);
      if (envelope?.providerAccountBindingHash != null) {
        normalizeSha256(
          envelope.providerAccountBindingHash,
          "credentialEnvelope.providerAccountBindingHash",
        );
      }
      return envelope;
    },
  });
}

export function createProviderConsentActivationPilotService(options = {}) {
  return createCorePilotService({
    ...options,
    providerAuthorizationStateRepository: wrapAuthorizationRepository(
      options.providerAuthorizationStateRepository,
    ),
    providerExchangeResolver: wrapProviderExchangeResolver(
      options.providerExchangeResolver,
    ),
    credentialEnvelopeService: wrapCredentialEnvelopeService(
      options.credentialEnvelopeService,
    ),
  });
}

export const _testingProviderConsentActivationPilotCertifiedService = Object.freeze({
  assertProviderCertification,
  normalizeSha256,
  wrapAuthorizationRepository,
  wrapCredentialEnvelopeService,
  wrapProviderExchangeResolver,
});
