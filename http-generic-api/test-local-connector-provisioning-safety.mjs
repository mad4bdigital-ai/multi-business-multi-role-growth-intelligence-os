import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const installRoutes = readFileSync(new URL("./routes/localConnectorInstallRoutes.js", import.meta.url), "utf8");
const connectRoutes = readFileSync(new URL("./routes/connectRoutes.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/1003_sprint69_tenant_device_install_intent_contract.sql", import.meta.url), "utf8");

const activeProvisioner = installRoutes.slice(
  installRoutes.indexOf("export async function provisionLocalConnectorInstall"),
  installRoutes.indexOf("export function buildLocalConnectorInstallRoutes")
);

assert.match(activeProvisioner, /assertExplicitDeviceInstallIntent/);
assert.match(activeProvisioner, /existing_device_registered/);
assert.match(activeProvisioner, /device_install_confirmation_required/);
assert.match(activeProvisioner, /expectedDeviceInstallConfirmation/);
assert.match(activeProvisioner, /status: "existing_device_reused"/);
assert.match(activeProvisioner, /provider_calls_made: false/);
assert.match(activeProvisioner, /provisioning_performed: false/);
assert.match(activeProvisioner, /short_lived_signed_download_link/);
assert.match(activeProvisioner, /raw_material_returned: false/);
assert.match(activeProvisioner, /secrets_included: false/);

const confirmationGateIndex = activeProvisioner.indexOf("assertExplicitDeviceInstallIntent");
const credentialResolutionIndex = activeProvisioner.indexOf("resolveProvisioningCredentials");
assert.ok(confirmationGateIndex >= 0 && credentialResolutionIndex > confirmationGateIndex,
  "explicit device intent must be validated before credentials are loaded");

const existingReuseIndex = activeProvisioner.indexOf('status: "existing_device_reused"');
assert.ok(existingReuseIndex >= 0 && credentialResolutionIndex > existingReuseIndex,
  "existing device reuse must return before provider credentials or provider mutation");

assert.doesNotMatch(activeProvisioner, /connector_secret:\s*connectorSecret/);
assert.doesNotMatch(activeProvisioner, /install_bat:\s*installScript/);
assert.doesNotMatch(activeProvisioner, /install_ps1:\s*installPowerShell/);
assert.doesNotMatch(activeProvisioner, /"\.env":\s*connectorEnv/);
assert.doesNotMatch(activeProvisioner, /tunnel_command:\s*`cloudflared service install/);

assert.match(connectRoutes, /install_intent = ""/);
assert.match(connectRoutes, /typed_confirmation = ""/);
assert.match(connectRoutes, /reprovision = false/);
assert.match(connectRoutes, /reprovision: reprovision === true/);

assert.match(migration, /connect_device_install/);
assert.match(migration, /install_intent/);
assert.match(migration, /typed_confirmation/);
assert.match(migration, /INSTALL_DEVICE_/);
assert.match(migration, /no_raw_secrets/);
assert.match(migration, /signed_download_link/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);

console.log("local connector provisioning safety guard passed");
