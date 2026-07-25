import { deepFreeze } from "../domain/model.js";

const SENSITIVE_EXACT_KEYS = new Set([
  "authorization",
  "authorizationheader",
  "cookie",
  "setcookie",
  "credential",
  "credentials",
  "credentialpayload",
  "secret",
  "secrets",
  "token",
  "tokens",
  "accesstoken",
  "refreshtoken",
  "password",
  "privatekey",
  "apikey",
]);

const SAFE_SECURITY_FLAG_KEYS = new Set([
  "automaticretryperformed",
  "automaticwriteperformed",
  "credentialpayloadread",
  "credentialpayloadreads",
  "providercallmade",
  "readbackperformed",
  "retryallowed",
  "secretsincluded",
]);

function normalizedKey(value) {
  return String(value).replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isSensitiveKey(key) {
  const normalized = normalizedKey(key);
  if (SAFE_SECURITY_FLAG_KEYS.has(normalized)) return false;
  if (normalized.endsWith("ref") || normalized.endsWith("id")) return false;
  return (
    SENSITIVE_EXACT_KEYS.has(normalized) ||
    normalized.includes("credential") ||
    normalized.includes("secret") ||
    normalized.includes("token") ||
    normalized.includes("password") ||
    normalized.includes("privatekey") ||
    normalized.includes("apikey")
  );
}

export class ContextApplicationError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "ContextApplicationError";
    this.code = code;
    this.status = status;
    this.details = deepFreeze({ ...details });
  }
}

export function requireApplicationString(value, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

export function optionalApplicationString(value) {
  if (value == null || value === "") return null;
  return requireApplicationString(value, "value");
}

export function requireApplicationObject(value, fieldName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object.`);
  }
  return value;
}

export function requireApplicationFunction(value, fieldName) {
  if (typeof value !== "function") throw new TypeError(`${fieldName} must be a function.`);
  return value;
}

export function sanitizeApplicationValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeApplicationValue);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (isSensitiveKey(key)) continue;
    const child = value[key];
    if (child !== undefined) result[key] = sanitizeApplicationValue(child);
  }
  return result;
}

export function freezeApplicationValue(value) {
  return deepFreeze(sanitizeApplicationValue(value));
}

export function ensureUniqueCandidateReferences(candidates) {
  const seen = new Map();
  for (const candidate of candidates) {
    const stableRef = requireApplicationString(candidate?.stableRef, "candidate.stableRef");
    const existing = seen.get(stableRef);
    if (existing) {
      throw new ContextApplicationError(
        "context_candidate_reference_ambiguous",
        "More than one authorized candidate uses the same stable reference.",
        409,
        {
          stable_ref: stableRef,
          candidate_types: [existing.candidateType, candidate.candidateType].sort(),
        },
      );
    }
    seen.set(stableRef, candidate);
  }
  return deepFreeze([...candidates]);
}

export function clockIso(clock) {
  requireApplicationFunction(clock, "clock");
  const value = clock();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError("clock must return a valid Date.");
  }
  return value.toISOString();
}

export const _testingApplicationSupport = Object.freeze({
  isSensitiveKey,
  normalizedKey,
  SAFE_SECURITY_FLAG_KEYS,
});
