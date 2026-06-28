export const SAFE_FALSE_SECRET_METADATA_KEYS = new Set([
  "secrets_included",
  "secrets_returned_to_agent",
  "secret_value_included",
  "raw_secret_values_included",
]);

const SENSITIVE_FIELD_PATTERN = /secret|token|api[_-]?key|private[_-]?key|ciphertext|password/i;

export function isSafeFalseSecretMetadata(key, value) {
  if (!SAFE_FALSE_SECRET_METADATA_KEYS.has(String(key || ""))) return false;
  if (value === false || value === 0) return true;
  if (typeof value !== "string") return false;
  return ["false", "0", "no", "off"].includes(value.trim().toLowerCase());
}

export function assertNoSecretBearingFields(value, path = "root") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretBearingFields(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, nested] of Object.entries(value)) {
    const safeFalseMetadata = isSafeFalseSecretMetadata(key, nested);
    if (SENSITIVE_FIELD_PATTERN.test(key) && !safeFalseMetadata) {
      const err = new Error(`Capability envelope refuses sensitive field at ${path}.${key}`);
      err.code = "capability_envelope_sensitive_field_rejected";
      throw err;
    }
    assertNoSecretBearingFields(nested, `${path}.${key}`);
  }
}
