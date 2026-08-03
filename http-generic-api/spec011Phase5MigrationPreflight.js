import { createHash } from "node:crypto";

export const SPEC011_PHASE5_MIGRATION_PREFLIGHT_VERSION =
  "spec011-phase5-migration-engine-preflight-v1";

const HASH_PATTERN = /^[0-9a-f]{64}$/;

function compact(value, max = 1000) {
  return String(value ?? "").trim().slice(0, max);
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

export function evaluateMigrationEnginePreflight({
  engine = {},
  disposableTarget = false,
  productionAuthorized = false,
  observedAt = new Date().toISOString(),
} = {}) {
  const blockers = [];
  const family = compact(engine.family, 64).toLowerCase();
  const sqlMode = compact(engine.sql_mode, 2000).toUpperCase();
  const characterSet = compact(engine.character_set, 64).toLowerCase();
  const collation = compact(engine.collation, 64).toLowerCase();

  if (!family.includes("mariadb") && !family.includes("mysql")) {
    blockers.push("MIGRATION_PREFLIGHT_ENGINE_FAMILY_INCOMPATIBLE");
  }
  if (!compact(engine.version, 128)) blockers.push("MIGRATION_PREFLIGHT_ENGINE_VERSION_REQUIRED");
  if (!sqlMode.includes("STRICT_TRANS_TABLES") && !sqlMode.includes("STRICT_ALL_TABLES")) {
    blockers.push("MIGRATION_PREFLIGHT_STRICT_SQL_MODE_REQUIRED");
  }
  if (!characterSet.startsWith("utf8mb4")) blockers.push("MIGRATION_PREFLIGHT_UTF8MB4_CHARACTER_SET_REQUIRED");
  if (!collation.startsWith("utf8mb4")) blockers.push("MIGRATION_PREFLIGHT_UTF8MB4_COLLATION_REQUIRED");
  if (engine.check_constraints_enforced !== true) blockers.push("MIGRATION_PREFLIGHT_CHECK_CONSTRAINTS_REQUIRED");
  if (engine.transaction_isolation_verified !== true) blockers.push("MIGRATION_PREFLIGHT_TRANSACTION_ISOLATION_REQUIRED");
  if (engine.json_supported !== true) blockers.push("MIGRATION_PREFLIGHT_JSON_SUPPORT_REQUIRED");
  if (engine.secrets_included !== false) blockers.push("MIGRATION_PREFLIGHT_ENGINE_SECRETS_FLAG_INVALID");
  if (disposableTarget !== true) blockers.push("MIGRATION_PREFLIGHT_DISPOSABLE_TARGET_REQUIRED");
  if (productionAuthorized !== false) blockers.push("MIGRATION_PREFLIGHT_PRODUCTION_AUTHORIZATION_FORBIDDEN");

  const normalized = {
    engine: {
      family,
      version: compact(engine.version, 128),
      sql_mode: compact(engine.sql_mode, 2000),
      character_set: characterSet,
      collation,
      check_constraints_enforced: engine.check_constraints_enforced === true,
      transaction_isolation: compact(engine.transaction_isolation, 128),
      transaction_isolation_verified: engine.transaction_isolation_verified === true,
      json_supported: engine.json_supported === true,
      secrets_included: false,
    },
    disposable_target: disposableTarget === true,
    production_authorized: false,
    observed_at: new Date(observedAt).toISOString(),
    secrets_included: false,
  };
  const uniqueBlockers = [...new Set(blockers)];
  const status = uniqueBlockers.length === 0 ? "pass" : "blocked";
  const evidenceFingerprint = status === "pass" ? sha256(normalized) : null;
  return {
    ok: true,
    report_type: "spec011_phase5_migration_engine_preflight",
    preflight_version: SPEC011_PHASE5_MIGRATION_PREFLIGHT_VERSION,
    status,
    blockers: uniqueBlockers,
    evidence_fingerprint: evidenceFingerprint,
    engine_evidence: normalized,
    apply_prerequisites_satisfied: status === "pass" && HASH_PATTERN.test(evidenceFingerprint || ""),
    production_authorized: false,
    secrets_included: false,
  };
}

export const _testingSpec011Phase5MigrationPreflight = {
  stable,
  sha256,
};
