import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const agent = read("./routes/connectorAgentRoutes.js");
const install = read("./routes/localConnectorInstallRoutes.js");
const admin = read("./routes/adminCliRoutes.js");
const composite = read("./localConnectorCompositeHealth.js");
const selector = read("./adminLocalConnectorTarget.js");
const localServer = read("../local-connector/server.mjs");
const watchdog = read("../local-connector/connector-watchdog.ps1");
const epoch = read("./installerCredentialEpoch.js");
const tokenCap = read("./localConnectorInstallerCapability.js");

test("heartbeat cannot inherit the global backend key or resurrect revoked device", () => {
  const start = agent.indexOf("async function resolveHeartbeatConfig(");
  const end = agent.indexOf("async function syncPrimaryRouteFromHeartbeat", start);
  assert(start >= 0 && end > start);
  const section = agent.slice(start, end);
  assert.match(section, /device_owned_heartbeat_credential_required/);
  assert.match(section, /connectorAuthPredicateForToken\(token\)/);
  assert.match(section, /lifecycle_state = 'active'/);
  assert.match(section, /revoked_at IS NULL AND archived_at IS NULL/);
  assert.match(section, /heartbeat_device_ambiguous/);
  assert.doesNotMatch(section, /if \(backendToken && token === backendToken\) \{\s*sql \+=/);
});
test("only verified health_ok heartbeats can refresh health or promote a route", () => {
  assert.match(agent, /last_health_at = IF\(\? = 'health_ok' AND \? = 'ok', NOW\(\), last_health_at\)/);
  assert.match(agent, /healthTransition = eventType === "health_ok" && status === "ok"/);
  assert.match(agent, /eventType === "health_failed" && status === "failed"/);
  assert.match(agent, /if \(healthTransition\)/);
  assert.doesNotMatch(agent, /status: verifiedHealth \? "ok" : "failed"/);
});
test("signed installer and redemption routes reject revoked or archived identity", () => {
  assert.match(install, /device_reenrollment_required/);
  assert.match(install, /device_config_ambiguous/);
  assert.match(install, /c\.lifecycle_state = 'active'/);
  assert.match(install, /c\.revoked_at IS NULL AND c\.archived_at IS NULL/);
  assert.match(install, /AND lifecycle_state = 'active' AND revoked_at IS NULL AND archived_at IS NULL/);
  const count=(agent.match(/AND lifecycle_state = 'active' AND revoked_at IS NULL AND archived_at IS NULL/g)||[]).length;
  assert(count >= 3);
});
test("privileged installer link does not use ambiguous or historical aliases", () => {
  const start=install.indexOf('router.post("/local-connector/install/device-download-link"');
  const end=install.indexOf('router.post("/local-connector/install/download-link"',start);
  const section=install.slice(start,end);
  assert.match(section, /AND c\.device_id = \?/);
  assert.doesNotMatch(section, /alias_device_id = \?/);
  assert.match(section, /requireFreshLocalManagerDeviceForPrivilegedInstaller\(req\)/);
});
test("diagnosis and installer do not silently auto-select a stale device", () => {
  assert.match(selector, /target_device_required/);
  assert.match(selector, /intent === "diagnosis"/);
  assert.match(selector, /state === "STALE"/);
  assert.match(admin, /intent: "diagnosis", allowMissingCredentials: true/);
  assert.match(admin, /legacy_admin_installer_disabled/);
  assert.match(admin, /requires_signed_expiring_capability: true/);
});
test("recovery probes forbid redirects and require authenticated device and config identity", () => {
  assert((composite.match(/redirect: "manual"/g)||[]).length >= 2);
  assert.match(composite, /config_id: typeof body\?\.config_id === "string"/);
  assert.match(admin, /validateAdminRecoveryEndpoint/);
  assert.match(admin, /observedConfigId: authenticatedCommandHealth\.config_id/);
  assert.match(selector, /device_identity_attested/);
  assert.match(selector, /config_identity_attested/);
});

test("inconclusive, Cloudflare and authorization faults never recommend blind reinstall", () => {
  assert.match(admin, /\["validating", "degraded_tunnel", "authorization_gated"\]\.includes\(compositeHealth\.status\)/);
  assert.match(admin, /installer_eligible: false/);
  assert.match(admin, /inspect_cloudflare_tunnel_and_host_separately/);
  assert.match(admin, /collect_independent_route_and_device_evidence/);
  assert.match(admin, /verify_authorization_binding/);
});

test("signed installer binds canonical config/device in local .env and authenticated policy proves both", () => {
  assert.match(agent, /CONNECTOR_CONFIG_ID=/);
  assert.match(agent, /CONNECTOR_DEVICE_ID=/);
  assert.match(agent, /configId: config\.config_id/);
  assert.match(agent, /deviceId: config\.device_id/);
  assert.match(localServer, /const CONNECTOR_CONFIG_ID =/);
  assert.match(localServer, /const CONNECTOR_DEVICE_ID =/);
  const start = localServer.indexOf("function policyBody()");
  const end = localServer.indexOf("\\n}", start);
  const body = localServer.slice(start, end);
  assert.match(body, /config_id: CONNECTOR_CONFIG_ID/);
  assert.match(body, /device_id: CONNECTOR_DEVICE_ID/);
  assert.match(composite, /device_id: typeof body\?\.device_id === "string"/);
  assert.match(composite, /config_id: typeof body\?\.config_id === "string"/);
});

test("connector policy cannot treat a platform API key as device-owned authority", () => {
  const start=agent.indexOf('router.get("/connector-agent/policy"');
  const end=agent.indexOf('router.post("/connector-agent/heartbeat"',start);
  assert(start>=0 && end>start);
  const policy=agent.slice(start,end);
  assert.match(policy, /device_owned_policy_credential_required/);
  assert.match(policy, /connector_policy_identity_ambiguous/);
  assert.match(policy, /lifecycle_state = 'active'/);
  assert.match(policy, /revoked_at IS NULL AND archived_at IS NULL/);
  assert.match(policy, /connectorAuthPredicateForToken\(token\)/);
  assert.doesNotMatch(policy, /if \(backendToken && token === backendToken\) \{\s*sql \+=/);
});

test("watchdog heartbeat and public probe are bound to enrolled canonical device, not old hostname",()=>{
  assert.match(watchdog, /CONNECTOR_CONFIG_ID/);
  assert.match(watchdog, /CONNECTOR_DEVICE_ID/);
  assert.match(watchdog, /CONNECTOR_SECRET_FILE/);
  assert.match(watchdog, /CONNECTOR_PUBLIC_HEALTH_URL/);
  assert.match(watchdog, /Test-PublicHealthBinding/);
  assert.match(watchdog, /config_id = \$configId/);
  assert.match(watchdog, /device_id = \$deviceId/);
  assert.match(watchdog, /\$response\.event\.event_id/);
  assert.doesNotMatch(watchdog, /device_id = \[Environment\]::MachineName/);
  assert.doesNotMatch(watchdog, /\$PublicHealthUrl = "https:\/\/connector\.mad4b\.com\/health"/);
  assert.match(agent, /CONNECTOR_PUBLIC_HEALTH_URL=/);
  assert.match(agent, /CONNECTOR_TUNNEL_ID=/);
});

test("watchdog has a single complete implementation and cannot follow remote health redirects",()=>{
  for(const name of ["Test-PublicHealthBinding","Test-TransportOwnershipBinding","Publish-Heartbeat","Write-RuntimeState"]) {
    assert((watchdog.match(new RegExp("function " + name + "\\(", "g"))||[]).length === 1,
      "watchdog contains duplicate function: "+name);
  }
  assert(watchdog.split("\n").length < 600, "watchdog unexpectedly duplicated");
  assert.match(watchdog, /MaximumRedirection 0/);
  assert(watchdog.includes('Publish-Heartbeat $status $(if ($publicReady) { "health_ok" } else { "service_restart" })'));
  assert(watchdog.includes('Publish-Heartbeat $status $(if ($publicReady) { "health_ok" } else { "rollback" })'));
});

test("download, canonical PS1 and one-time redeem fence old credential generations",()=>{
  assert((install.match(/credential_epoch: credentialEpoch/g)||[]).length === 2);
  assert.match(install, /assertCurrentInstallerCredentialEpoch\(payload\)/);
  assert.match(agent, /await assertCurrentInstallerCredentialEpoch\(payload\)/);
  assert.match(agent, /credential_epoch: payload\.credential_epoch/);
  assert.match(tokenCap, /\.\.\.\(credential_epoch \?/);
  assert.match(epoch, /timingSafeEqual/);
  assert.match(epoch, /connector_secret, cf_token/);
  assert.match(epoch, /installer_credential_epoch_changed/);
});

test("final redemption and heartbeat update are fenced against concurrent identity mutation",()=>{
  assert.match(agent, /const selectedEpoch = deriveInstallerCredentialEpoch/);
  assert.match(agent, /compareInstallerCredentialEpoch\(selectedEpoch, payload\.credential_epoch\)/);
  assert.match(agent, /device_lifecycle_changed_during_heartbeat/);
  assert.match(agent, /healthWrite\?\.affectedRows/);
  assert.match(agent, /last_reconnect_at = IF\(\? IN/);
  assert.match(agent, /last_health_at = IF\(\? = 'health_ok' AND \? = 'ok'/);
});

test("idempotent heartbeat update checks live unique lifecycle instead of inferring revocation",()=>{
  assert.match(agent, /verifiedRows\.length !== 1/);
  assert.match(agent, /SELECT config_id FROM local_connector_user_configs/);
  assert.match(agent, /device_lifecycle_changed_during_heartbeat/);
});

test("legacy Admin raw installer is retired and recovery advertises signed POST only",()=>{
  const start=admin.indexOf('router.get("/local-connector/install-bundle"');
  const end=admin.indexOf('router.post("/local-connector/self-repair"',start);
  const legacy=admin.slice(start,end);
  assert(start>=0 && end>start);
  assert.match(legacy, /legacy_admin_installer_disabled/);
  assert.match(legacy, /res\.status\(410\)/);
  assert.doesNotMatch(legacy, /generateConnectorInstallerBat/);
  assert.doesNotMatch(legacy, /includeCredentials: true/);
  assert.match(legacy, /includeCredentials: false/);
  assert.match(admin, /requires_signed_expiring_capability: true/);
  assert.match(admin, /path: "\/local-connector\/install\/download-link"/);
});
test("recovery validates enrolled per-device route, never the shared control-plane gateway",()=>{
  const start=selector.indexOf("export function validateAdminRecoveryEndpoint");
  const end=selector.indexOf("export function classifyAdminRecoveryReadback",start);
  const validator=selector.slice(start,end);
  assert.doesNotMatch(validator,/hostname === "connector\.mad4b\.com"/);
  assert.match(validator,/cfargotunnel\.com/);
  assert.match(validator,/configId/);
});
