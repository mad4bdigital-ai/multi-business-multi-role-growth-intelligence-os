import assert from "node:assert/strict";
import { authorizeMigrationApply } from "./spec011Phase5ValidationCi.js";
import { evaluateMigrationEnginePreflight } from "./spec011Phase5MigrationPreflight.js";

const NOW = "2026-08-03T05:20:00.000Z";

function validEngine() {
  return {
    family: "MariaDB",
    version: "11.4.8-MariaDB",
    sql_mode: "STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION",
    character_set: "utf8mb4",
    collation: "utf8mb4_unicode_ci",
    check_constraints_enforced: true,
    transaction_isolation: "REPEATABLE-READ",
    transaction_isolation_verified: true,
    json_supported: true,
    secrets_included: false,
  };
}

{
  const preflight = evaluateMigrationEnginePreflight({
    engine: validEngine(),
    disposableTarget: true,
    productionAuthorized: false,
    observedAt: NOW,
  });
  assert.equal(preflight.status, "pass");
  assert.equal(preflight.apply_prerequisites_satisfied, true);
  assert.match(preflight.evidence_fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(preflight.production_authorized, false);

  const authorization = authorizeMigrationApply({
    mode: "apply",
    validation: preflight,
    evidenceRef: "artifact://spec011/spec011-phase5-migration-preflight.json",
  });
  assert.equal(authorization.decision, "authorized");
  assert.equal(authorization.apply_authorized, true);
  assert.equal(authorization.validation_fingerprint, preflight.evidence_fingerprint);
}

{
  const preflight = evaluateMigrationEnginePreflight({
    engine: {
      ...validEngine(),
      sql_mode: "NO_ENGINE_SUBSTITUTION",
      character_set: "latin1",
      collation: "latin1_swedish_ci",
      check_constraints_enforced: false,
      transaction_isolation_verified: false,
      json_supported: false,
    },
    disposableTarget: false,
    productionAuthorized: true,
    observedAt: NOW,
  });
  assert.equal(preflight.status, "blocked");
  assert.equal(preflight.apply_prerequisites_satisfied, false);
  assert.equal(preflight.evidence_fingerprint, null);
  assert.ok(preflight.blockers.includes("MIGRATION_PREFLIGHT_STRICT_SQL_MODE_REQUIRED"));
  assert.ok(preflight.blockers.includes("MIGRATION_PREFLIGHT_UTF8MB4_CHARACTER_SET_REQUIRED"));
  assert.ok(preflight.blockers.includes("MIGRATION_PREFLIGHT_UTF8MB4_COLLATION_REQUIRED"));
  assert.ok(preflight.blockers.includes("MIGRATION_PREFLIGHT_CHECK_CONSTRAINTS_REQUIRED"));
  assert.ok(preflight.blockers.includes("MIGRATION_PREFLIGHT_TRANSACTION_ISOLATION_REQUIRED"));
  assert.ok(preflight.blockers.includes("MIGRATION_PREFLIGHT_JSON_SUPPORT_REQUIRED"));
  assert.ok(preflight.blockers.includes("MIGRATION_PREFLIGHT_DISPOSABLE_TARGET_REQUIRED"));
  assert.ok(preflight.blockers.includes("MIGRATION_PREFLIGHT_PRODUCTION_AUTHORIZATION_FORBIDDEN"));

  const authorization = authorizeMigrationApply({
    mode: "apply",
    validation: preflight,
    evidenceRef: null,
  });
  assert.equal(authorization.decision, "blocked");
  assert.equal(authorization.apply_authorized, false);
  assert.ok(authorization.blockers.includes("MIGRATION_ENGINE_VALIDATION_REQUIRED"));
  assert.ok(authorization.blockers.includes("MIGRATION_ENGINE_VALIDATION_FINGERPRINT_REQUIRED"));
  assert.ok(authorization.blockers.includes("MIGRATION_ENGINE_VALIDATION_REFERENCE_REQUIRED"));
}

console.log("Spec 011 Phase 5 migration engine preflight tests passed");
