const NON_PRODUCTION_ENVIRONMENTS = new Set([
  "test",
  "development",
  "staging",
  "non_production",
]);

function adapterError(code, message, status = 409, details = {}) {
  const error = new Error(message);
  error.name = "ProviderConsentNonProductionProviderExchangeError";
  error.code = code;
  error.status = status;
  error.details = Object.freeze({ ...details, secrets_included: false });
  return error;
}

function requiredString(value, fieldName) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function assertNonProduction(environment) {
  const normalized = requiredString(environment, "environment").toLowerCase();
  if (!NON_PRODUCTION_ENVIRONMENTS.has(normalized)) {
    throw adapterError(
      "provider_consent_nonprod_adapter_environment_forbidden",
      "Provider exchange simulation cannot be constructed for Production.",
      403,
      { environment: normalized },
    );
  }
  return normalized;
}

function normalizeScopes(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError("requestedProviderScopes must be an array.");
  return [...new Set(value.map(
    (scope) => requiredString(scope, "requestedProviderScopes[]"),
  ))].sort();
}

function classifyProviderError(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  if (status === 429) {
    return Object.freeze({
      code: "provider_rate_limited",
      retryable: true,
      classification: "rate_limited",
    });
  }
  if (
    status >= 500
    || error?.code === "ETIMEDOUT"
    || error?.code === "ECONNRESET"
  ) {
    return Object.freeze({
      code: "provider_transient_error",
      retryable: true,
      classification: "transient_transport",
    });
  }
  return Object.freeze({
    code: "provider_exchange_rejected",
    retryable: false,
    classification: "provider_rejected",
  });
}

function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  if (!value || typeof value !== "object") return value;
  return Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, freeze(entry)]),
  ));
}

export function createNonProductionProviderExchangeAdapter({
  providerKey,
  simulationTransport,
  environment = "non_production",
  versionRef = "provider-exchange-simulation.v2",
  transportRef = "provider-simulation-transport.v1",
  timeoutMs = 15000,
  retryClassificationVersion = "provider-retry-classification.v1",
} = {}) {
  const normalizedEnvironment = assertNonProduction(environment);
  const provider = requiredString(providerKey, "providerKey");
  if (typeof simulationTransport !== "function") {
    throw new TypeError("simulationTransport must be a function.");
  }
  if (
    !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1000
    || timeoutMs > 60000
  ) {
    throw new TypeError("timeoutMs must be between 1000 and 60000.");
  }

  async function exchangeAuthorizationCode(input = {}) {
    if (input.providerKey !== provider) {
      throw adapterError(
        "provider_exchange_simulation_provider_mismatch",
        "Simulation provider does not match the certified adapter.",
      );
    }
    const idempotencyKey = requiredString(
      input.idempotencyKey,
      "idempotencyKey",
    );
    const authorizationCode = requiredString(
      input.authorizationCode,
      "authorizationCode",
    );
    try {
      const result = await simulationTransport(Object.freeze({
        providerKey: provider,
        authorizationCode,
        redirectTargetRef: requiredString(
          input.redirectTargetRef,
          "redirectTargetRef",
        ),
        requestedProviderScopes: normalizeScopes(input.requestedProviderScopes),
        idempotencyKey,
        timeoutMs: Math.min(Number(input.timeoutMs || timeoutMs), timeoutMs),
        simulationOnly: true,
      }));
      if (
        !result
        || typeof result !== "object"
        || Array.isArray(result)
        || result.providerKey !== provider
      ) {
        throw adapterError(
          "provider_exchange_simulation_result_invalid",
          "Provider simulation returned an invalid provider-bound result.",
          502,
        );
      }
      return result;
    } catch (cause) {
      if (cause?.name === "ProviderConsentNonProductionProviderExchangeError") {
        throw cause;
      }
      const classification = classifyProviderError(cause);
      const error = adapterError(
        classification.code,
        "Provider simulation exchange failed without exposing provider payloads.",
        classification.retryable ? 503 : 409,
        {
          retryable: classification.retryable,
          classification: classification.classification,
          upstream_status: Number(cause?.status || cause?.statusCode || 0) || null,
          upstream_code: typeof cause?.code === "string"
            ? cause.code.slice(0, 64)
            : null,
        },
      );
      error.retryable = classification.retryable;
      throw error;
    }
  }

  return Object.freeze({
    certification: freeze({
      status: "certified",
      providerKey: provider,
      versionRef: requiredString(versionRef, "versionRef"),
      mode: "simulation",
      environment: normalizedEnvironment,
      transportRef: requiredString(transportRef, "transportRef"),
      supportsIdempotency: true,
      unknownOutcomeSafe: true,
      rawCauseRetained: false,
      timeoutMs,
      retryClassificationVersion: requiredString(
        retryClassificationVersion,
        "retryClassificationVersion",
      ),
      liveProviderCalled: false,
      secretsIncluded: false,
    }),
    exchangeAuthorizationCode,
  });
}

export const _testingProviderConsentNonProductionProviderExchange = Object.freeze({
  assertNonProduction,
  classifyProviderError,
});
