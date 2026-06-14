import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const installRoutes = readFileSync(new URL("./routes/localConnectorInstallRoutes.js", import.meta.url), "utf8");
const connectRoutes = readFileSync(new URL("./routes/connectRoutes.js", import.meta.url), "utf8");
const migration = readFileSync(new URL("./migrations/1003_sprint69_tenant_device_install_intent_contract.sql", import.meta.url), "utf8");
const openapi = readFileSync(new URL("./openapi.yaml", import.meta.url), "utf8");

const activeProvisioner = installRoutes.slice(
  installRoutes.indexOf("export async function provisionLocalConnectorInstall"),
  installRoutes.indexOf("export function buildLocalConnectorInstallRoutes")
);

assert.match(activeProvisioner, /assertExplicitDeviceInstallIntent/);
assert.match(installRoutes, /existing_device_registered/);
assert.match(installRoutes, /device_install_confirmation_required/);
assert.match(installRoutes, /expectedDeviceInstallConfirmation/);
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
assert.match(connectRoutes, /const status = Number\(err\?\.status \|\| 500\)/);
assert.match(connectRoutes, /code: err\?\.code \|\| "device_install_failed"/);
assert.match(connectRoutes, /err\?\.details \? \{ details: err\.details \} : \{\}/);

assert.match(migration, /connect_device_install/);
assert.match(migration, /install_intent/);
assert.match(migration, /typed_confirmation/);
assert.match(migration, /INSTALL_DEVICE_/);
assert.match(migration, /no_raw_secrets/);
assert.match(migration, /signed_download_link/);
assert.doesNotMatch(migration, /DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i);

const deviceInstallOpenApi = openapi.slice(
  openapi.indexOf("  /connect/device-install:"),
  openapi.indexOf("  /local-connector/health:")
);
assert.match(deviceInstallOpenApi, /x-openai-isConsequential: true/);
assert.match(deviceInstallOpenApi, /install_intent:/);
assert.match(deviceInstallOpenApi, /enum: \[add, replace, reinstall\]/);
assert.match(deviceInstallOpenApi, /typed_confirmation:/);
assert.match(deviceInstallOpenApi, /reprovision:/);
assert.match(deviceInstallOpenApi, /existing_device_reused/);
assert.match(deviceInstallOpenApi, /provider_calls_made/);
assert.match(deviceInstallOpenApi, /provisioning_performed/);
assert.match(deviceInstallOpenApi, /raw_material_returned/);
assert.match(deviceInstallOpenApi, /secrets_included/);
assert.match(deviceInstallOpenApi, /"409":/);
assert.match(deviceInstallOpenApi, /device_install_confirmation_required/);

console.log("local connector provisioning safety guard passed");
