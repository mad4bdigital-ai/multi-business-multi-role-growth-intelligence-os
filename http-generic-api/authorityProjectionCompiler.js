export const AUTHORITY_PROJECTION_COMPILER_VERSION = "authority-projection-compiler-v1";

export const AUTHORITY_PROJECTION_SURFACES = Object.freeze([
  "dynamic_tabs",
  "dashboard",
  "tool_catalog",
]);

const AUTHORITY_DECISIONS = new Set([
  "ready",
  "shadow_ready",
  "canary_ready",
  "blocked",
  "authorization_gated",
  "degraded",
  "ambiguous",
  "stale",
  "not_applicable",
]);
const ACTION_READY_DECISIONS = new Set(["ready", "canary_ready"]);
const SECRET_KEY_PATTERN = /(?:^|_)(?:authorization|cookie|password|passwd|secret|client_secret|api_key|access_key|private_key|token|access_token|refresh_token|id_token|credential|credentials|raw_row|raw_rows)(?:_|$)/iu;
const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/u;
const AUTH_HEADER_PATTERN = /^\s*(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+\s*$/iu;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeString(value) {
  if (PRIVATE_KEY_PATTERN.test(value) || AUTH_HEADER_PATTERN.test(value)) return "[redacted]";
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = "";
      url.password = "";
    }
    for (const key of [...url.searchParams.keys()]) {
      if (SECRET_KEY_PATTERN.test(key)) url.searchParams.set(key, "[redacted]");
    }
    return url.toString();
  } catch {
    return value;
  }
}

function sanitize(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeString(value);
  if (["number", "boolean"].includes(typeof value)) return value;
  if (typeof value !== "object") return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => sanitize(entry, seen)).filter((entry) => entry !== undefined);
  }
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) continue;
    const safe = sanitize(entry, seen);
    if (safe !== undefined) output[key] = safe;
  }
  return output;
}

function text(value, maximum = 191) {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized.slice(0, maximum) : null;
}

function contractError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requiredTimestamp(value, field, code) {
  if (value === null || value === undefined || value === "") {
    throw contractError(code, `${field} is required.`);
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw contractError(code, `${field} must be a valid timestamp.`);
  }
  return parsed;
}

function requireManifest(manifest, now) {
  if (!isPlainObject(manifest)) throw new TypeError("manifest must be an object.");
  const decisionId = text(manifest.decisionId ?? manifest.decision_id, 191);
  if (!decisionId) throw new TypeError("manifest.decisionId is required.");

  const secretAttestation = manifest.secretsIncluded ?? manifest.secrets_included;
  if (secretAttestation === true) {
    throw contractError(
      "AUTHORITY_PROJECTION_SECRET_EVIDENCE_FORBIDDEN",
      "Authority projection manifest contains secret-bearing evidence.",
    );
  }
  if (secretAttestation !== false) {
    throw contractError(
      "AUTHORITY_PROJECTION_SECRET_ATTESTATION_REQUIRED",
      "Authority projection manifest must explicitly attest secretsIncluded=false.",
    );
  }

  const decision = text(manifest.decision, 64);
  if (!decision || !AUTHORITY_DECISIONS.has(decision)) {
    throw contractError(
      "AUTHORITY_PROJECTION_DECISION_INVALID",
      "Authority projection manifest decision is missing or unsupported.",
    );
  }

  const projectionEligibility = manifest.projectionEligibility ?? manifest.projection_eligibility;
  if (!isPlainObject(projectionEligibility)) {
    throw new TypeError("manifest.projectionEligibility must be an object.");
  }

  const evaluatedAt = requiredTimestamp(
    manifest.evaluatedAt ?? manifest.evaluated_at,
    "manifest.evaluatedAt",
    "AUTHORITY_PROJECTION_EVALUATED_AT_REQUIRED",
  );
  const expiresAt = requiredTimestamp(
    manifest.expiresAt ?? manifest.expires_at,
    "manifest.expiresAt",
    "AUTHORITY_PROJECTION_EXPIRY_REQUIRED",
  );
  const expired = expiresAt.getTime() <= now.getTime();

  return {
    decisionId,
    decision,
    readiness: isPlainObject(manifest.readiness) ? manifest.readiness : {},
    projectionEligibility,
    versions: isPlainObject(manifest.versions) ? sanitize(manifest.versions) : {},
    evaluatedAt: evaluatedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    expired,
    stale: decision === "stale",
  };
}

function normalizeRegistration(item, surface) {
  if (!isPlainObject(item)) throw new TypeError(`${surface} projection registrations must contain objects.`);
  const key = text(item.key ?? item.projection_key ?? item.tool_key ?? item.tab_key ?? item.widget_key, 191);
  if (!key) throw new TypeError(`${surface} projection registration key is required.`);
  return Object.freeze({
    key,
    label: text(item.label ?? item.title, 255),
    description: text(item.description, 1000),
    capability_key: text(item.capability_key ?? item.capabilityKey, 191),
    operation: text(item.operation, 191),
    resource_type: text(item.resource_type ?? item.resourceType, 128),
    resource_id: text(item.resource_id ?? item.resourceId, 255),
    public_metadata: sanitize(isPlainObject(item.public_metadata) ? item.public_metadata : {}),
  });
}

function normalizeRegistrations(items, surface) {
  if (items === undefined || items === null) return [];
  if (!Array.isArray(items)) throw new TypeError(`${surface} registrations must be an array.`);
  const normalized = items.map((item) => normalizeRegistration(item, surface));
  const seen = new Set();
  for (const item of normalized) {
    if (seen.has(item.key)) {
      const error = new Error(`Duplicate ${surface} projection registration: ${item.key}`);
      error.code = "AUTHORITY_PROJECTION_REGISTRATION_AMBIGUOUS";
      throw error;
    }
    seen.add(item.key);
  }
  return normalized.sort((left, right) => left.key.localeCompare(right.key));
}

function readinessIsReady(readiness, key) {
  return String(readiness?.[key] ?? "").trim().toLowerCase() === "ready";
}

function toolActionEligible(manifest) {
  if (manifest.expired || manifest.stale) return false;
  if (!ACTION_READY_DECISIONS.has(String(manifest.decision).toLowerCase())) return false;
  if (manifest.projectionEligibility.execution !== true) return false;
  return readinessIsReady(manifest.readiness, "execution");
}

function compileSurface({ surface, manifest, registrations }) {
  const surfaceEligible = !manifest.expired
    && !manifest.stale
    && manifest.projectionEligibility[surface] === true;
  const genericReason = manifest.expired
    ? "AUTHORITY_MANIFEST_EXPIRED"
    : manifest.stale
      ? "AUTHORITY_MANIFEST_STALE"
      : surfaceEligible
        ? null
        : "AUTHORITY_PROJECTION_NOT_ELIGIBLE";

  if (!surfaceEligible) {
    return Object.freeze({
      surface,
      visible: false,
      reason_codes: [genericReason],
      items: [],
      candidate_count_disclosed: false,
      creates_authority: false,
      execution_authorized: false,
      action_grant_emitted: false,
      secrets_included: false,
    });
  }

  // Candidate registration validation is intentionally deferred until after
  // visibility is established. An unauthorized, expired, or stale surface must
  // not reveal candidate existence through validation errors, duplicate keys,
  // malformed registration shapes, or counts.
  const normalizedRegistrations = normalizeRegistrations(registrations, surface);
  const actionEligible = surface === "tool_catalog" && toolActionEligible(manifest);
  const items = normalizedRegistrations.map((item) => Object.freeze({
    ...item,
    visible: true,
    ...(surface === "tool_catalog" ? {
      action_eligible: actionEligible,
      action_blocked_reason_codes: actionEligible ? [] : ["AUTHORITY_EXECUTION_NOT_ELIGIBLE"],
    } : {}),
    creates_authority: false,
    execution_authorized: false,
    action_grant_emitted: false,
    secrets_included: false,
  }));

  return Object.freeze({
    surface,
    visible: true,
    reason_codes: [],
    items,
    candidate_count_disclosed: true,
    creates_authority: false,
    execution_authorized: false,
    action_grant_emitted: false,
    secrets_included: false,
  });
}

export function compileAuthoritySurfaceProjections({ manifest, registrations = {}, now = new Date() } = {}) {
  const instant = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(instant.getTime())) throw new TypeError("now must be a valid timestamp.");
  if (!isPlainObject(registrations)) throw new TypeError("registrations must be an object.");
  const normalizedManifest = requireManifest(manifest, instant);

  const surfaces = {};
  for (const surface of AUTHORITY_PROJECTION_SURFACES) {
    surfaces[surface] = compileSurface({
      surface,
      manifest: normalizedManifest,
      registrations: registrations[surface],
    });
  }

  return Object.freeze({
    schema_version: 1,
    contract: AUTHORITY_PROJECTION_COMPILER_VERSION,
    authority_decision_id: normalizedManifest.decisionId,
    manifest_decision: normalizedManifest.decision,
    manifest_expired: normalizedManifest.expired,
    manifest_stale: normalizedManifest.stale,
    evaluated_at: normalizedManifest.evaluatedAt,
    expires_at: normalizedManifest.expiresAt,
    versions: normalizedManifest.versions,
    surfaces: Object.freeze(surfaces),
    projection_only: true,
    creates_authority: false,
    runtime_enforcement_enabled: false,
    execution_authorized: false,
    action_grant_emitted: false,
    provider_called: false,
    database_mutated: false,
    secrets_included: false,
  });
}
