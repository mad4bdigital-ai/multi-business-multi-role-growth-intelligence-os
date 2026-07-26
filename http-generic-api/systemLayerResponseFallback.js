export const SYSTEM_LAYER_INLINE_FALLBACK_MAX_CHARS = 150000;

function boundedInlineLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return SYSTEM_LAYER_INLINE_FALLBACK_MAX_CHARS;
  return Math.min(Math.max(parsed, 5000), SYSTEM_LAYER_INLINE_FALLBACK_MAX_CHARS);
}

function persistenceUnavailable(error) {
  return error?.code === "response_chunk_persistence_unavailable";
}

export function buildBoundedInlineChunkFallback(
  body,
  error,
  {
    sourceToolKey = "system_layer_response",
    maxChars = SYSTEM_LAYER_INLINE_FALLBACK_MAX_CHARS,
  } = {},
) {
  if (!persistenceUnavailable(error)) throw error;

  const limit = boundedInlineLimit(maxChars);
  let serialized;
  try {
    serialized = JSON.stringify(body);
  } catch {
    throw error;
  }

  const serializedChars = serialized.length;
  if (serializedChars > limit) {
    const fallbackError = new Error(
      `Durable response chunk persistence is unavailable and the inline response exceeds ${limit} characters.`,
    );
    fallbackError.name = "SystemLayerResponseFallbackError";
    fallbackError.code = "response_chunk_persistence_unavailable_inline_limit_exceeded";
    fallbackError.status = 503;
    fallbackError.details = {
      source_tool_key: String(sourceToolKey || "system_layer_response"),
      serialized_chars: serializedChars,
      bounded_inline_max_chars: limit,
      cause_code: error?.details?.cause_code || error?.cause?.code || null,
      secrets_included: false,
    };
    throw fallbackError;
  }

  const responseBody = body && typeof body === "object" && !Array.isArray(body)
    ? body
    : { result: body };
  const continuationContract = responseBody.continuation_contract
    && typeof responseBody.continuation_contract === "object"
    && !Array.isArray(responseBody.continuation_contract)
      ? responseBody.continuation_contract
      : {};

  return {
    ...responseBody,
    response_chunked: false,
    continuation_contract: {
      ...continuationContract,
      persistence_degraded: true,
      fallback_mode: "bounded_inline_response",
      fallback_reason: "response_chunk_persistence_unavailable",
      bounded_inline_max_chars: limit,
      serialized_chars: serializedChars,
      source_tool_key: String(sourceToolKey || "system_layer_response"),
      secrets_included: false,
    },
    secrets_included: false,
  };
}
