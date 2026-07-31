import crypto from "node:crypto";

export const AUTHORITY_PATH_INVENTORY_LIMITS = Object.freeze({
  maxSources: 128,
  maxPaths: 4096,
  maxAliasesPerPath: 32,
  maxGaps: 8192,
});

const AUTHORITY_MODES = Object.freeze(new Set([
  "admin_only",
  "tenant_only",
  "shared",
  "internal",
]));

const OPERATION_MODES = Object.freeze(new Set([
  "read_only",
  "preview",
  "shadow",
  "plan",
  "mutation",
  "internal",
]));

const CALLABILITY_STATES = Object.freeze(new Set([
  "callable",
  "authorization_gated",
  "blocked",
  "deprecated",
  "unknown",
]));

const STATUS_STATES = Object.freeze(new Set([
  "active",
  "inactive",
  "blocked",
  "deprecated",
  "unknown",
]));

const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,190}$/;
const ROUTE_PATTERN = /^\/[A-Za-z0-9_./:{}-]{0,510}$/;
const HTTP_METHODS = Object.freeze(new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]));
const FORBIDDEN_KEY_PATTERN = /(secret|password|private[_-]?key|access[_-]?token|refresh[_-]?token|credential[_-]?payload|authorization[_-]?header)/i;

export class AuthorityPathInventoryError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AuthorityPathInventoryError";
    this.code = code;
    this.details = details;
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

function stableSortObject(value) {
  if (Array.isArray(value)) return value.map(stableSortObject);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableSortObject(value[key]);
    return result;
  }, {});
}

function canonicalHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableSortObject(value))).digest("hex");
}

function assertNoSecretKeys(value, path = "root", seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) {
      throw new AuthorityPathInventoryError(
        "authority_path_secret_field_forbidden",
        "Authority path inventory input contains a forbidden secret-bearing field.",
        { path: `${path}.${key}` },
      );
    }
    assertNoSecretKeys(nested, `${path}.${key}`, seen);
  }
}

function requireToken(value, fieldName) {
  const normalized = String(value ?? "").trim();
  if (!normalized || !TOKEN_PATTERN.test(normalized)) {
    throw new AuthorityPathInventoryError(
      "authority_path_invalid_token",
      `${fieldName} must be a stable bounded token.`,
      { field: fieldName },
    );
  }
  return normalized;
}

function optionalToken(value, fieldName) {
  if (value === null || value === undefined || value === "") return null;
  return requireToken(value, fieldName);
}

function requireEnum(value, allowed, fieldName) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!allowed.has(normalized)) {
    throw new AuthorityPathInventoryError(
      "authority_path_invalid_enum",
      `${fieldName} contains an unsupported value.`,
      { field: fieldName, value: normalized || null },
    );
  }
  return normalized;
}

function normalizeBoolean(value, fieldName) {
  if (typeof value !== "boolean") {
    throw new AuthorityPathInventoryError(
      "authority_path_invalid_boolean",
      `${fieldName} must be boolean.`,
      { field: fieldName },
    );
  }
  return value;
}

function normalizeTimestamp(value, fieldName) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AuthorityPathInventoryError(
      "authority_path_invalid_timestamp",
      `${fieldName} must be a valid timestamp.`,
      { field: fieldName },
    );
  }
  return parsed.toISOString();
}

function normalizeStringList(value, fieldName, maxItems) {
  if (!Array.isArray(value)) {
    throw new AuthorityPathInventoryError(
      "authority_path_invalid_list",
      `${fieldName} must be an array.`,
      { field: fieldName },
    );
  }
  if (value.length > maxItems) {
    throw new AuthorityPathInventoryError(
      "authority_path_limit_exceeded",
      `${fieldName} exceeds its configured bound.`,
      { field: fieldName, max_items: maxItems, observed: value.length },
    );
  }
  const normalized = value.map((item, index) => requireToken(item, `${fieldName}[${index}]`));
  return [...new Set(normalized)].sort();
}

function normalizeRequirements(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthorityPathInventoryError(
      "authority_path_invalid_requirements",
      "requirements must be an object.",
    );
  }
  return {
    approval: normalizeBoolean(value.approval ?? false, "requirements.approval"),
    typed_confirmation: normalizeBoolean(value.typed_confirmation ?? false, "requirements.typed_confirmation"),
    capability_envelope: normalizeBoolean(value.capability_envelope ?? false, "requirements.capability_envelope"),
    idempotency: normalizeBoolean(value.idempotency ?? false, "requirements.idempotency"),
    readback: normalizeBoolean(value.readback ?? false, "requirements.readback"),
    rollback: normalizeBoolean(value.rollback ?? false, "requirements.rollback"),
  };
}

function normalizePath(rawPath, sourceKey, limits) {
  if (!rawPath || typeof rawPath !== "object" || Array.isArray(rawPath)) {
    throw new AuthorityPathInventoryError("authority_path_invalid_record", "Each authority path must be an object.");
  }
  assertNoSecretKeys(rawPath, `source:${sourceKey}`);

  const route = rawPath.route === null || rawPath.route === undefined || rawPath.route === ""
    ? null
    : String(rawPath.route).trim();
  if (route !== null && !ROUTE_PATTERN.test(route)) {
    throw new AuthorityPathInventoryError(
      "authority_path_invalid_route",
      "route must be an absolute bounded route template.",
      { route },
    );
  }

  const method = rawPath.method === null || rawPath.method === undefined || rawPath.method === ""
    ? null
    : String(rawPath.method).trim().toUpperCase();
  if (method !== null && !HTTP_METHODS.has(method)) {
    throw new AuthorityPathInventoryError(
      "authority_path_invalid_method",
      "method contains an unsupported HTTP method.",
      { method },
    );
  }

  const normalized = {
    path_key: requireToken(rawPath.path_key, "path_key"),
    canonical_tool_key: optionalToken(rawPath.canonical_tool_key, "canonical_tool_key"),
    route,
    method,
    surface_family: requireToken(rawPath.surface_family, "surface_family"),
    source_registry: requireToken(rawPath.source_registry, "source_registry"),
    handler_key: optionalToken(rawPath.handler_key, "handler_key"),
    authority_mode: requireEnum(rawPath.authority_mode, AUTHORITY_MODES, "authority_mode"),
    operation_mode: requireEnum(rawPath.operation_mode, OPERATION_MODES, "operation_mode"),
    callability: requireEnum(rawPath.callability ?? "unknown", CALLABILITY_STATES, "callability"),
    status: requireEnum(rawPath.status ?? "unknown", STATUS_STATES, "status"),
    actor_source: optionalToken(rawPath.actor_source, "actor_source"),
    subject_source: optionalToken(rawPath.subject_source, "subject_source"),
    tenant_scope_source: optionalToken(rawPath.tenant_scope_source, "tenant_scope_source"),
    workspace_scope_source: optionalToken(rawPath.workspace_scope_source, "workspace_scope_source"),
    resource_authority_source: optionalToken(rawPath.resource_authority_source, "resource_authority_source"),
    capability_authority_source: optionalToken(rawPath.capability_authority_source, "capability_authority_source"),
    provider_scope_source: optionalToken(rawPath.provider_scope_source, "provider_scope_source"),
    credential_scope_source: optionalToken(rawPath.credential_scope_source, "credential_scope_source"),
    risk_class: optionalToken(rawPath.risk_class, "risk_class"),
    revision_source: optionalToken(rawPath.revision_source, "revision_source"),
    freshness_source: optionalToken(rawPath.freshness_source, "freshness_source"),
    revocation_source: optionalToken(rawPath.revocation_source, "revocation_source"),
    invalidation_source: optionalToken(rawPath.invalidation_source, "invalidation_source"),
    atomicity_policy: optionalToken(rawPath.atomicity_policy, "atomicity_policy"),
    replacement_path_key: optionalToken(rawPath.replacement_path_key, "replacement_path_key"),
    aliases: normalizeStringList(rawPath.aliases ?? [], "aliases", limits.maxAliasesPerPath),
    requirements: normalizeRequirements(rawPath.requirements),
    secrets_included: false,
  };

  return normalized;
}

function classifyMissingFields(path) {
  const missing = [];
  const alwaysRequired = [
    "handler_key",
    "actor_source",
    "subject_source",
    "resource_authority_source",
    "capability_authority_source",
    "risk_class",
    "revision_source",
    "freshness_source",
    "revocation_source",
    "invalidation_source",
  ];
  for (const field of alwaysRequired) {
    if (!path[field]) missing.push(field);
  }
  if (path.authority_mode !== "internal" && !path.tenant_scope_source) missing.push("tenant_scope_source");
  if (["mutation", "plan"].includes(path.operation_mode)) {
    if (!path.requirements.readback) missing.push("requirements.readback");
    if (!path.requirements.idempotency) missing.push("requirements.idempotency");
  }
  if (path.operation_mode === "mutation" && !path.requirements.rollback) missing.push("requirements.rollback");
  return missing.sort();
}

export function compileAuthorityPathInventory({
  source_snapshots: sourceSnapshots,
  expected_source_keys: expectedSourceKeys = [],
  limits = AUTHORITY_PATH_INVENTORY_LIMITS,
} = {}) {
  if (!Array.isArray(sourceSnapshots)) {
    throw new AuthorityPathInventoryError(
      "authority_path_invalid_sources",
      "source_snapshots must be an array.",
    );
  }
  if (sourceSnapshots.length > limits.maxSources) {
    throw new AuthorityPathInventoryError(
      "authority_path_limit_exceeded",
      "source_snapshots exceeds its configured bound.",
      { max_sources: limits.maxSources, observed: sourceSnapshots.length },
    );
  }
  assertNoSecretKeys(sourceSnapshots, "source_snapshots");

  const expected = normalizeStringList(expectedSourceKeys, "expected_source_keys", limits.maxSources);
  const sources = [];
  const byPathKey = new Map();
  const gaps = [];
  let observedPathRows = 0;

  for (let sourceIndex = 0; sourceIndex < sourceSnapshots.length; sourceIndex += 1) {
    const source = sourceSnapshots[sourceIndex];
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new AuthorityPathInventoryError("authority_path_invalid_source", "Each source snapshot must be an object.");
    }
    const sourceKey = requireToken(source.source_key, `source_snapshots[${sourceIndex}].source_key`);
    const paths = Array.isArray(source.paths) ? source.paths : null;
    if (!paths) {
      throw new AuthorityPathInventoryError(
        "authority_path_invalid_source_paths",
        "Each source snapshot must provide a paths array.",
        { source_key: sourceKey },
      );
    }
    observedPathRows += paths.length;
    if (observedPathRows > limits.maxPaths) {
      throw new AuthorityPathInventoryError(
        "authority_path_limit_exceeded",
        "Combined authority path rows exceed their configured bound.",
        { max_paths: limits.maxPaths, observed_at_least: observedPathRows },
      );
    }

    const normalizedSource = {
      source_key: sourceKey,
      source_identity: requireToken(source.source_identity, `source_snapshots[${sourceIndex}].source_identity`),
      observed_at: normalizeTimestamp(source.observed_at, `source_snapshots[${sourceIndex}].observed_at`),
      complete: normalizeBoolean(source.complete ?? false, `source_snapshots[${sourceIndex}].complete`),
      path_count: paths.length,
      secrets_included: false,
    };
    sources.push(normalizedSource);

    for (const rawPath of paths) {
      const path = normalizePath(rawPath, sourceKey, limits);
      const existing = byPathKey.get(path.path_key);
      const comparable = { ...path, source_keys: undefined };
      const pathHash = canonicalHash(comparable);
      if (!existing) {
        byPathKey.set(path.path_key, { ...path, source_keys: [sourceKey], contract_sha256: pathHash });
        continue;
      }
      if (existing.contract_sha256 !== pathHash) {
        gaps.push({
          code: "conflicting_path_contract",
          path_key: path.path_key,
          source_keys: [...new Set([...existing.source_keys, sourceKey])].sort(),
          blocking: true,
        });
        continue;
      }
      existing.source_keys = [...new Set([...existing.source_keys, sourceKey])].sort();
    }
  }

  const sourceKeys = sources.map((source) => source.source_key).sort();
  for (const expectedSource of expected) {
    if (!sourceKeys.includes(expectedSource)) {
      gaps.push({ code: "missing_expected_source", source_key: expectedSource, blocking: true });
    }
  }
  for (const source of sources) {
    if (!source.complete) gaps.push({ code: "source_snapshot_incomplete", source_key: source.source_key, blocking: true });
  }

  const paths = [...byPathKey.values()].sort((left, right) => left.path_key.localeCompare(right.path_key));
  for (const path of paths) {
    const missingFields = classifyMissingFields(path);
    if (missingFields.length) {
      gaps.push({
        code: "path_classification_incomplete",
        path_key: path.path_key,
        missing_fields: missingFields,
        blocking: true,
      });
    }
    if (path.status === "deprecated" && !path.replacement_path_key) {
      gaps.push({ code: "deprecated_path_without_replacement", path_key: path.path_key, blocking: true });
    }
  }

  if (gaps.length > limits.maxGaps) {
    throw new AuthorityPathInventoryError(
      "authority_path_limit_exceeded",
      "Authority path inventory gaps exceed their configured bound.",
      { max_gaps: limits.maxGaps, observed: gaps.length },
    );
  }

  const blockingGaps = gaps.filter((gap) => gap.blocking);
  const report = {
    contract: "mad4b.ueacp.authority-path-inventory.v1",
    status: blockingGaps.length === 0 ? "ready_for_human_closure_review" : "incomplete",
    sources: sources.sort((left, right) => left.source_key.localeCompare(right.source_key)),
    expected_source_keys: expected,
    summary: {
      source_count: sources.length,
      expected_source_count: expected.length,
      observed_path_row_count: observedPathRows,
      canonical_path_count: paths.length,
      admin_only_count: paths.filter((path) => path.authority_mode === "admin_only").length,
      tenant_only_count: paths.filter((path) => path.authority_mode === "tenant_only").length,
      shared_count: paths.filter((path) => path.authority_mode === "shared").length,
      internal_count: paths.filter((path) => path.authority_mode === "internal").length,
      mutation_count: paths.filter((path) => path.operation_mode === "mutation").length,
      blocking_gap_count: blockingGaps.length,
    },
    paths,
    gaps: gaps.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    closure_state: {
      t001_complete: false,
      t001_ready_for_human_review: blockingGaps.length === 0 && expected.length > 0,
      reason: blockingGaps.length === 0
        ? "Machine inventory is internally complete; human verification against every registered and unregistered runtime surface is still required."
        : "Blocking inventory gaps remain.",
    },
    provider_calls: false,
    credential_payload_read: false,
    external_writes: false,
    secrets_included: false,
  };
  report.inventory_sha256 = canonicalHash(report);
  return deepFreeze(report);
}

export const _testingAuthorityPathInventoryCompiler = {
  canonicalHash,
  classifyMissingFields,
  deepFreeze,
  normalizePath,
};
