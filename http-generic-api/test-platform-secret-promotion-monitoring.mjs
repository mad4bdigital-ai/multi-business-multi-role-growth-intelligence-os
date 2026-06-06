import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("./migrations/216_sprint67_platform_secret_promotion_monitoring.sql", import.meta.url), "utf8");
const runner = readFileSync(new URL("./scripts/governed-migration-runner.mjs", import.meta.url), "utf8");
const readiness = readFileSync(new URL("./releaseReadiness.js", import.meta.url), "utf8");
const credentialRoutes = readFileSync(new URL("./routes/credentialRoutes.js", import.meta.url), "utf8");

assert.ok(migration.includes("v_platform_secret_promotion_monitoring"));
assert.ok(migration.includes("v_platform_secret_promotion_monitoring_issues"));
assert.ok(migration.includes("v_platform_secret_promotion_monitoring_summary"));
assert.ok(migration.includes("credential_intake_platform_secret_promotion"));
assert.ok(migration.includes("platform_secret_storage_invalid"));
assert.ok(migration.includes("missing_platform_secret_reference"));
assert.ok(migration.includes("platform_secret_reference_invalid"));
assert.ok(migration.includes("source_connection_not_marked_promoted"));
assert.ok(migration.includes("store_type = 'db_encrypted'"));
assert.ok(migration.includes("validation_status <> 'promoted_to_platform_secrets'"));
assert.ok(migration.includes("'secrets_included', false"));
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);

assert.ok(runner.includes("216_sprint67_platform_secret_promotion_monitoring.sql"));
assert.ok(readiness.includes("216_sprint67_platform_secret_promotion_monitoring.sql"));
assert.ok(readiness.includes("checkPlatformSecretPromotionMonitoring"));
assert.ok(readiness.includes("checkPlatformSecretPromotionMonitoringSafe"));
assert.ok(readiness.includes("report.platform_secret_promotion_monitoring = await checkPlatformSecretPromotionMonitoringSafe()"));
assert.ok(readiness.includes("platform_secret_promotion_monitoring"));
assert.ok(readiness.includes("v_platform_secret_promotion_monitoring_summary"));
assert.ok(readiness.includes("v_platform_secret_promotion_monitoring_issues"));
assert.ok(readiness.includes("issue_rows"));
assert.ok(readiness.includes("secrets_included: false"));

assert.ok(credentialRoutes.includes("/credentials/intake/promote-platform-secrets"));
assert.ok(credentialRoutes.includes("secrets_included: false"));
assert.doesNotMatch(
  credentialRoutes,
  /res\.json\([\s\S]{0,500}(value_ciphertext|encrypted_credentials|credentials)\s*[,}]/,
  "platform promotion response must not serialize decrypted credentials or ciphertext"
);

console.log("platform secret promotion monitoring tests passed");
