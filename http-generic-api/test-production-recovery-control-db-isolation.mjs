import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  resolveRecoveryControlDbConfig,
  _testingRecoveryControlDb,
} from "./recoveryControlDb.js";

const targetBindings = _testingRecoveryControlDb.TARGET_DATABASE_BINDINGS;
assert.ok(targetBindings.length > 0, "canonical target database roles must be registered");

const base = {};
const targetSecrets = [];
for (const [index, binding] of targetBindings.entries()) {
  base[binding.host] = "mysql.internal";
  base[binding.port] = "3306";
  base[binding.database] = `target_${index}_db`;
  base[binding.user] = `target_${index}_user`;
  const passwordKey = `${binding.prefix}_PASSWORD`;
  const password = `target-${index}-secret-value`;
  base[passwordKey] = password;
  targetSecrets.push(password);
}

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
    for (const secret of targetSecrets) {
      assert.ok(!String(error?.message || "").includes(secret));
      assert.ok(!JSON.stringify(error?.details || {}).includes(secret));
    }
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

for (const binding of targetBindings) {
  assert.throws(
    () => resolveRecoveryControlDbConfig({
      ...base,
      RECOVERY_CONTROL_DB_NAME: base[binding.database],
      RECOVERY_CONTROL_DB_USER: "recovery_control_user",
      RECOVERY_CONTROL_DB_PASSWORD: "recovery-control-secret-value",
    }),
    (error) => error?.code === "RECOVERY_CONTROL_DB_DATABASE_NOT_INDEPENDENT"
      && error?.details?.conflicting_roles?.includes(binding.role)
      && error?.details?.target_database_binding === "forbidden"
      && error?.details?.secrets_included === false,
    `Recovery control store must not reuse the ${binding.role} database`,
  );
}

for (const binding of targetBindings) {
  assert.throws(
    () => resolveRecoveryControlDbConfig({
      ...base,
      RECOVERY_CONTROL_DB_NAME: "recovery_control",
      RECOVERY_CONTROL_DB_USER: base[binding.user],
      RECOVERY_CONTROL_DB_PASSWORD: "recovery-control-secret-value",
    }),
    (error) => error?.code === "RECOVERY_CONTROL_DB_IDENTITY_NOT_INDEPENDENT"
      && error?.details?.conflicting_roles?.includes(binding.role)
      && error?.details?.target_identity_reuse_allowed === false
      && error?.details?.secrets_included === false,
    `Recovery control store must not reuse the ${binding.role} database identity`,
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

const source = readFileSync(new URL("./recoveryControlDb.js", import.meta.url), "utf8");
assert.match(source, /RECOVERY_CONTROL_DB_NAME/);
assert.match(source, /RECOVERY_CONTROL_DB_USER/);
assert.match(source, /RECOVERY_CONTROL_DB_PASSWORD/);
assert.match(source, /RECOVERY_CONTROL_DB_DATABASE_NOT_INDEPENDENT/);
assert.match(source, /RECOVERY_CONTROL_DB_IDENTITY_NOT_INDEPENDENT/);
assert.match(source, /target_database_binding: "forbidden"/);
assert.match(source, /target_identity_reuse_allowed: false/);
assert.match(source, /readRuntimeBootstrapContract/);
assert.doesNotMatch(source, /RECOVERY_CONTROL_DB_NAME\s*\|\|\s*(?:env\.)?(?:DB_NAME|GOVERNANCE_DB_NAME|RUNTIME_PERSISTENCE_DB_NAME)/);
assert.doesNotMatch(source, /RECOVERY_CONTROL_DB_USER\s*\|\|\s*(?:env\.)?(?:DB_USER|GOVERNANCE_DB_USER|RUNTIME_PERSISTENCE_DB_USER)/);
assert.doesNotMatch(source, /RECOVERY_CONTROL_DB_PASSWORD\s*\|\|\s*(?:env\.)?(?:DB_PASSWORD|GOVERNANCE_DB_PASSWORD|RUNTIME_PERSISTENCE_DB_PASSWORD)/);

console.log("Production Recovery control DB isolation contract passed");
