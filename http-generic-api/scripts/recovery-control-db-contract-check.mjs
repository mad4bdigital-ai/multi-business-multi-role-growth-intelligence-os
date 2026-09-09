import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveRecoveryControlDbConfig } from "../recoveryControlDb.js";

const base = {
  DB_HOST: "mysql.internal",
  DB_PORT: "3306",
  DB_NAME: "runtime_platform",
  DB_USER: "runtime_user",
  DB_PASSWORD: "runtime-secret-value",
  GOVERNANCE_DB_HOST: "mysql.internal",
  GOVERNANCE_DB_NAME: "governance_platform",
  GOVERNANCE_DB_USER: "governance_user",
  GOVERNANCE_DB_PASSWORD: "governance-secret-value",
  RUNTIME_PERSISTENCE_DB_HOST: "mysql.internal",
  RUNTIME_PERSISTENCE_DB_NAME: "runtime_persistence_platform",
  RUNTIME_PERSISTENCE_DB_USER: "runtime_persistence_user",
  RUNTIME_PERSISTENCE_DB_PASSWORD: "runtime-persistence-secret-value",
};

assert.throws(
  () => resolveRecoveryControlDbConfig(base),
  (error) => {
    assert.equal(error?.code, "RECOVERY_CONTROL_DB_CONFIG_MISSING");
    assert.equal(error?.details?.independent_store_required, true);
    assert.equal(error?.details?.target_database_binding, "forbidden");
    assert.equal(error?.details?.runtime_database_fallback_allowed, false);
    assert.equal(error?.details?.governance_database_fallback_allowed, false);
    assert.equal(error?.details?.runtime_persistence_database_fallback_allowed, false);
    assert.equal(error?.details?.target_identity_reuse_allowed, false);
    assert.equal(error?.details?.secrets_included, false);
    assert.ok(error?.details?.missing?.includes("RECOVERY_CONTROL_DB_NAME"));
    assert.ok(error?.details?.missing?.includes("RECOVERY_CONTROL_DB_USER"));
    assert.ok(error?.details?.missing?.includes("RECOVERY_CONTROL_DB_PASSWORD"));
    assert.doesNotMatch(String(error?.message || ""), /runtime-secret-value|governance-secret-value|runtime-persistence-secret-value/);
    assert.doesNotMatch(JSON.stringify(error?.details || {}), /runtime-secret-value|governance-secret-value|runtime-persistence-secret-value/);
    return true;
  },
  "target DB configuration must never satisfy the Recovery control-store identity",
);

const dedicated = resolveRecoveryControlDbConfig({
  ...base,
  RECOVERY_CONTROL_DB_NAME: "recovery_control",
  RECOVERY_CONTROL_DB_USER: "recovery_control_user",
  RECOVERY_CONTROL_DB_PASSWORD: "recovery-control-secret-value",
  RECOVERY_CONTROL_DB_CONNECTION_LIMIT: "99",
  RECOVERY_CONTROL_DB_CONNECT_TIMEOUT_MS: "100",
});
assert.equal(dedicated.host, "mysql.internal", "physical host reuse is allowed while database and identity remain independent");
assert.equal(dedicated.port, 3306);
assert.equal(dedicated.database, "recovery_control");
assert.equal(dedicated.user, "recovery_control_user");
assert.equal(dedicated.password, "recovery-control-secret-value");
assert.equal(dedicated.connectionLimit, 5);
assert.equal(dedicated.connectTimeout, 1000);

for (const [role, databaseKey] of [
  ["runtime", "DB_NAME"],
  ["governance", "GOVERNANCE_DB_NAME"],
  ["runtime_persistence", "RUNTIME_PERSISTENCE_DB_NAME"],
]) {
  assert.throws(
    () => resolveRecoveryControlDbConfig({
      ...base,
      RECOVERY_CONTROL_DB_NAME: base[databaseKey],
      RECOVERY_CONTROL_DB_USER: "recovery_control_user",
      RECOVERY_CONTROL_DB_PASSWORD: "recovery-control-secret-value",
    }),
    (error) => error?.code === "RECOVERY_CONTROL_DB_DATABASE_NOT_INDEPENDENT"
      && error?.details?.conflicting_roles?.includes(role)
      && error?.details?.target_database_binding === "forbidden"
      && error?.details?.secrets_included === false,
    `Recovery control store must not reuse the ${role} database`,
  );
}

for (const [role, userKey] of [
  ["runtime", "DB_USER"],
  ["governance", "GOVERNANCE_DB_USER"],
  ["runtime_persistence", "RUNTIME_PERSISTENCE_DB_USER"],
]) {
  assert.throws(
    () => resolveRecoveryControlDbConfig({
      ...base,
      RECOVERY_CONTROL_DB_NAME: "recovery_control",
      RECOVERY_CONTROL_DB_USER: base[userKey],
      RECOVERY_CONTROL_DB_PASSWORD: "recovery-control-secret-value",
    }),
    (error) => error?.code === "RECOVERY_CONTROL_DB_IDENTITY_NOT_INDEPENDENT"
      && error?.details?.conflicting_roles?.includes(role)
      && error?.details?.target_identity_reuse_allowed === false
      && error?.details?.secrets_included === false,
    `Recovery control store must not reuse the ${role} database identity`,
  );
}

const explicitEndpoint = resolveRecoveryControlDbConfig({
  ...base,
  RECOVERY_CONTROL_DB_HOST: "recovery-db.internal",
  RECOVERY_CONTROL_DB_PORT: "3310",
  RECOVERY_CONTROL_DB_NAME: "recovery_control",
  RECOVERY_CONTROL_DB_USER: "recovery_control_user",
  RECOVERY_CONTROL_DB_PASSWORD: "recovery-control-secret-value",
  RECOVERY_CONTROL_DB_CONNECTION_LIMIT: "0",
  RECOVERY_CONTROL_DB_CONNECT_TIMEOUT_MS: "999999",
});
assert.equal(explicitEndpoint.host, "recovery-db.internal");
assert.equal(explicitEndpoint.port, 3310);
assert.equal(explicitEndpoint.connectionLimit, 1);
assert.equal(explicitEndpoint.connectTimeout, 60000);

const source = readFileSync(new URL("../recoveryControlDb.js", import.meta.url), "utf8");
assert.match(source, /RECOVERY_CONTROL_DB_NAME/);
assert.match(source, /RECOVERY_CONTROL_DB_USER/);
assert.match(source, /RECOVERY_CONTROL_DB_PASSWORD/);
assert.match(source, /RECOVERY_CONTROL_DB_DATABASE_NOT_INDEPENDENT/);
assert.match(source, /RECOVERY_CONTROL_DB_IDENTITY_NOT_INDEPENDENT/);
assert.match(source, /target_database_binding: "forbidden"/);
assert.match(source, /target_identity_reuse_allowed: false/);
assert.doesNotMatch(source, /RECOVERY_CONTROL_DB_NAME\s*\|\|\s*(?:env\.)?(?:DB_NAME|GOVERNANCE_DB_NAME|RUNTIME_PERSISTENCE_DB_NAME)/);
assert.doesNotMatch(source, /RECOVERY_CONTROL_DB_USER\s*\|\|\s*(?:env\.)?(?:DB_USER|GOVERNANCE_DB_USER|RUNTIME_PERSISTENCE_DB_USER)/);
assert.doesNotMatch(source, /RECOVERY_CONTROL_DB_PASSWORD\s*\|\|\s*(?:env\.)?(?:DB_PASSWORD|GOVERNANCE_DB_PASSWORD|RUNTIME_PERSISTENCE_DB_PASSWORD)/);

console.log("Production Recovery control DB isolation contract passed");
