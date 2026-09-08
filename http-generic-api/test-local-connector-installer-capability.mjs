import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCAL_CONNECTOR_INSTALLER_CAPABILITY_MAX_TTL_SECONDS,
  assertNoInstallerAuthorityOverrides,
  createInstallerCapability,
  installerControlPlaneBinding,
  signInstallerDownloadToken,
  verifyInstallerDownloadToken,
} from "./localConnectorInstallerCapability.js";

const env = {
  BACKEND_API_KEY: "installer-capability-test-key",
  DEPLOYMENT_ENVIRONMENT: "staging_local_windows_docker",
};

test("installer capability is exact-scope, staging-bound and short lived", () => {
  const now = 2_000_000_000;
  const payload = createInstallerCapability({
    config_id: "config-1",
    user_id: "user-1",
    tenant_id: "tenant-1",
    device_id: "device-1",
    format: "ps1",
    ttl_minutes: 99,
    env,
    now_seconds: now,
  });
  assert.equal(payload.environment, "staging");
  assert.equal(payload.config_id, "config-1");
  assert.equal(payload.purpose, "local_connector_installer");
  assert.equal(payload.aud, "connector_agent");
  assert.ok(payload.jti);
  assert.equal(payload.exp - payload.iat, LOCAL_CONNECTOR_INSTALLER_CAPABILITY_MAX_TTL_SECONDS);
  assert.equal(installerControlPlaneBinding(env).baseUrl, "https://dev.mad4b.com");
  const token = signInstallerDownloadToken(payload, { env });
  const verified = verifyInstallerDownloadToken(token, { env, expectedFormat: "ps1", now_seconds: now + 5 });
  assert.equal(verified.config_id, "config-1");
  assert.equal(verified.tenant_id, "tenant-1");
});

test("installer capability rejects caller-selected permission authority", () => {
  assert.throws(
    () => assertNoInstallerAuthorityOverrides({ capabilities: ["windows_control"] }),
    /server-managed/,
  );
  assert.throws(
    () => assertNoInstallerAuthorityOverrides({ permission_grants: { allowed_paths: ["C:\\work"] } }),
    /server-managed/,
  );
  assert.doesNotThrow(() => assertNoInstallerAuthorityOverrides({ capabilities: [], permission_grants: {} }));
});

test("installer capability rejects tamper, wrong environment and stale replay window", () => {
  const now = 2_000_000_000;
  const payload = createInstallerCapability({
    config_id: "config-1",
    user_id: "user-1",
    tenant_id: "tenant-1",
    device_id: "device-1",
    format: "bat",
    env,
    now_seconds: now,
  });
  const token = signInstallerDownloadToken(payload, { env });
  assert.throws(() => verifyInstallerDownloadToken(`${token}tampered`, { env, now_seconds: now }), /Invalid installer capability/);
  assert.throws(
    () => verifyInstallerDownloadToken(token, {
      env: { ...env, DEPLOYMENT_ENVIRONMENT: "production_hostinger_autodeploy" },
      now_seconds: now,
    }),
    /outside the current environment/,
  );
  assert.throws(
    () => verifyInstallerDownloadToken(token, { env, now_seconds: payload.exp + 1 }),
    /invalid, expired/,
  );
});
