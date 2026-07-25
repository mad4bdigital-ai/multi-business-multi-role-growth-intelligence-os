import assert from "node:assert/strict";
import {
  buildBoundedInlineChunkFallback,
  SYSTEM_LAYER_INLINE_FALLBACK_MAX_CHARS,
} from "./systemLayerResponseFallback.js";

const persistenceError = Object.assign(
  new Error("Durable response chunk persistence is unavailable."),
  {
    code: "response_chunk_persistence_unavailable",
    status: 503,
    details: { cause_code: "DB_CONFIG_MISSING" },
  },
);

const body = {
  ok: true,
  tools: [{ name: "runtime_endpoint_preview" }],
  continuation_contract: {
    response_chunked_when_large: true,
    required_tool: "response_chunk_read",
    secrets_included: false,
  },
  secrets_included: false,
};

const fallback = buildBoundedInlineChunkFallback(body, persistenceError, {
  sourceToolKey: "system_tools_catalog",
});
assert.equal(fallback.ok, true);
assert.equal(fallback.response_chunked, false);
assert.equal(fallback.tools[0].name, "runtime_endpoint_preview");
assert.equal(fallback.continuation_contract.persistence_degraded, true);
assert.equal(fallback.continuation_contract.fallback_mode, "bounded_inline_response");
assert.equal(
  fallback.continuation_contract.fallback_reason,
  "response_chunk_persistence_unavailable",
);
assert.equal(
  fallback.continuation_contract.bounded_inline_max_chars,
  SYSTEM_LAYER_INLINE_FALLBACK_MAX_CHARS,
);
assert.equal(fallback.continuation_contract.source_tool_key, "system_tools_catalog");
assert.equal(fallback.continuation_contract.secrets_included, false);
assert.equal(fallback.secrets_included, false);

const unrelatedError = Object.assign(new Error("Unrelated failure."), {
  code: "unexpected_failure",
});
assert.throws(
  () => buildBoundedInlineChunkFallback(body, unrelatedError),
  (error) => error === unrelatedError,
  "non-persistence failures must not be converted into inline responses",
);

assert.throws(
  () => buildBoundedInlineChunkFallback(
    { ok: true, payload: "x".repeat(6000) },
    persistenceError,
    { maxChars: 5000 },
  ),
  (error) => error?.code === "response_chunk_persistence_unavailable_inline_limit_exceeded"
    && error?.status === 503
    && error?.details?.bounded_inline_max_chars === 5000
    && error?.details?.cause_code === "DB_CONFIG_MISSING"
    && error?.details?.secrets_included === false,
  "oversized inline fallbacks must fail closed with a structured 503",
);

console.log("system layer response fallback tests passed");
