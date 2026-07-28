import { deepFreeze } from "../domain/model.js";

export class ContextApiValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "ContextApiValidationError";
    this.code = "VALIDATION_ERROR";
    this.status = 400;
    this.details = deepFreeze(Array.isArray(details) ? [...details] : [details]);
  }
}

export function requirePlainObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ContextApiValidationError(`${fieldName} must be an object.`, [
      { field: fieldName, issue: "must be an object" },
    ]);
  }
  return value;
}

export function assertAllowedKeys(value, allowedKeys, fieldName) {
  const object = requirePlainObject(value, fieldName);
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(object).filter((key) => !allowed.has(key)).sort();
  if (unknown.length > 0) {
    throw new ContextApiValidationError(`${fieldName} contains unsupported fields.`, unknown.map((key) => ({
      field: `${fieldName}.${key}`,
      issue: "unsupported field",
    })));
  }
  return object;
}

export function requireString(value, fieldName, { minLength = 1, maxLength = 191 } = {}) {
  if (typeof value !== "string") {
    throw new ContextApiValidationError(`${fieldName} must be a string.`, [
      { field: fieldName, issue: "must be a string" },
    ]);
  }
  const normalized = value.trim();
  if (normalized.length < minLength || normalized.length > maxLength) {
    throw new ContextApiValidationError(`${fieldName} has an invalid length.`, [
      { field: fieldName, issue: `length must be between ${minLength} and ${maxLength}` },
    ]);
  }
  return normalized;
}

export function optionalString(value, fieldName, options = {}) {
  if (value == null || value === "") return null;
  return requireString(value, fieldName, options);
}

export function requireEnum(value, fieldName, allowedValues) {
  const normalized = requireString(value, fieldName);
  if (!allowedValues.includes(normalized)) {
    throw new ContextApiValidationError(`${fieldName} is not supported.`, [
      { field: fieldName, issue: `must be one of: ${allowedValues.join(", ")}` },
    ]);
  }
  return normalized;
}

export function requireInteger(value, fieldName, { min = 1, max = 100 } = {}) {
  const parsed = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ContextApiValidationError(`${fieldName} must be an integer between ${min} and ${max}.`, [
      { field: fieldName, issue: `must be an integer between ${min} and ${max}` },
    ]);
  }
  return parsed;
}

export function optionalIsoDateTime(value, fieldName) {
  if (value == null || value === "") return null;
  const normalized = requireString(value, fieldName, { maxLength: 64 });
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new ContextApiValidationError(`${fieldName} must be an ISO 8601 timestamp.`, [
      { field: fieldName, issue: "must be a valid ISO 8601 timestamp" },
    ]);
  }
  return date.toISOString();
}

export function normalizeReasonCodes(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry) => typeof entry === "string" && entry.trim() !== "").map((entry) => entry.trim()))].sort();
}

export function freezeApiValue(value) {
  return deepFreeze(value);
}
