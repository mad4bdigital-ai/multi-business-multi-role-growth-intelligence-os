export const SAFE_FALSE_SECRET_METADATA_KEYS = new Set([
  "secrets_included",
  "secrets_returned_to_agent",
  "secret_value_included",
  "raw_secret_values_included",
]);

const SENSITIVE_FIELD_PATTERN = /secret|token|api[_-]?key|private[_-]?key|ciphertext|credential_value|password/i;
const REDACTED_LEDGER_VALUE = "[redacted_by_capability_envelope_ledger]";

export function sanitizeCapabilityEnvelopeForLedger(value) {
  if (Array.isArray(value)) return value.map(sanitizeCapabilityEnvelopeForLedger);
  if (!value || typeof value !== "object") return value;

  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    const safeFalseMetadata = SAFE_FALSE_SECRET_METADATA_KEYS.has(key) && nested === false;
    if (safeFalseMetadata) {
      out[key] = false;
    } else if (SENSITIVE_FIELD_PATTERN.test(key)) {
      out[key] = REDACTED_LEDGER_VALUE;
    } else {
      out[key] = sanitizeCapabilityEnvelopeForLedger(nested);
    }
  }
  return out;
}

export function assertNoSecretBearingFields(value, path = "root") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretBearingFields(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, nested] of Object.entries(value)) {
    const safeFalseMetadata = SAFE_FALSE_SECRET_METADATA_KEYS.has(key) && nested === false;
    if (SENSITIVE_FIELD_PATTERN.test(key) && !safeFalseMetadata) {
      const err = new Error(`Capability envelope refuses sensitive field at ${path}.${key}`);
      err.code = "capability_envelope_sensitive_field_rejected";
      throw err;
    }
    assertNoSecretBearingFields(nested, `${path}.${key}`);
  }
}
