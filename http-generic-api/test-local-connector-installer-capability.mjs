import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  LOCAL_CONNECTOR_INSTALLER_DOWNLOAD_PURPOSE,
  LOCAL_CONNECTOR_INSTALLER_CAPABILITY_MAX_TTL_SECONDS,
  LOCAL_CONNECTOR_INSTALLER_REDEEM_PURPOSE,
  assertNoInstallerAuthorityOverrides,
  createInstallerCapability,
  installerControlPlaneBinding,
  signInstallerDownloadToken,
  verifyInstallerDownloadToken,
} from "./localConnectorInstallerCapability.js";

// frontend-surface-operation: post /connector-agent/installer/redeem

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
  assert.equal(payload.purpose, LOCAL_CONNECTOR_INSTALLER_DOWNLOAD_PURPOSE);
  assert.equal(payload.aud, "connector_agent");
  assert.ok(payload.jti);
  assert.equal(payload.exp - payload.iat, LOCAL_CONNECTOR_INSTALLER_CAPABILITY_MAX_TTL_SECONDS);
  assert.equal(installerControlPlaneBinding(env).baseUrl, "https://dev.mad4b.com");
  const token = signInstallerDownloadToken(payload, { env });
  const verified = verifyInstallerDownloadToken(token, { env, expectedFormat: "ps1", now_seconds: now + 5 });
  assert.equal(verified.config_id, "config-1");
  assert.equal(verified.tenant_id, "tenant-1");
});

test("installer download capability cannot redeem secrets and redeem capability cannot download an installer", () => {
  const now = 2_000_000_000;
  const scope = { config_id: "config-1", user_id: "user-1", tenant_id: "tenant-1", device_id: "device-1", env, now_seconds: now };
  const downloadToken = signInstallerDownloadToken(createInstallerCapability(scope), { env });
  const redeemToken = signInstallerDownloadToken(createInstallerCapability({ ...scope, purpose: LOCAL_CONNECTOR_INSTALLER_REDEEM_PURPOSE, ttl_minutes: 5 }), { env });
  assert.throws(
    () => verifyInstallerDownloadToken(downloadToken, { env, expectedPurpose: LOCAL_CONNECTOR_INSTALLER_REDEEM_PURPOSE, now_seconds: now }),
    /outside the current environment/,
  );
  assert.throws(
    () => verifyInstallerDownloadToken(redeemToken, { env, expectedPurpose: LOCAL_CONNECTOR_INSTALLER_DOWNLOAD_PURPOSE, now_seconds: now }),
    /outside the current environment/,
  );
});

test("canonical installer is long-lived-secret-free and redeems through POST bearer", () => {
  const source = readFileSync(new URL("./routes/connectorAgentRoutes.js", import.meta.url), "utf8");
  const resilienceSource = readFileSync(new URL("./operationResilienceController.js", import.meta.url), "utf8");
  const builder = source.slice(source.indexOf("function buildInstallPowerShell"), source.indexOf("async function loadAgentFile"));
  assert.doesNotMatch(builder, /CONNECTOR_SECRET=|CONNECTOR_LOCAL_API_KEY=|\$CfToken\s*=\s*'/);
  assert.match(builder, /CONNECTOR_SECRET_FILE=/);
  assert.match(builder, /CONNECTOR_LOCAL_API_KEY_FILE=/);
  assert.match(builder, /Authorization = .*Bearer \$RedeemToken/);
  assert.match(builder, /-Method Post/);
  assert.doesNotMatch(builder, /material=runtime_credentials|\?token=/);
  assert.match(builder, /2025\.4\.0/);
  assert.match(builder, /cloudflared_token_file_unsupported_version/);
  assert.match(builder, /Remove-Item -LiteralPath \$PSCommandPath/);
  assert.equal((source.match(/await claimInstallerCapability\(config, payload\);/g) || []).length, 2, "download and redemption JTIs must each be claimed exactly once");
  assert.match(resilienceSource, /originalUrl[\s\S]{0,160}split\("\?", 1\)\[0\]/, "runtime operation identity must redact capability query values");
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
