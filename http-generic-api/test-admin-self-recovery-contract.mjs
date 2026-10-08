import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const agent = read("./routes/connectorAgentRoutes.js");
const install = read("./routes/localConnectorInstallRoutes.js");
const admin = read("./routes/adminCliRoutes.js");
const composite = read("./localConnectorCompositeHealth.js");
const selector = read("./adminLocalConnectorTarget.js");

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
  assert.match(agent, /verifiedHealth = eventType === "health_ok" && status === "ok"/);
  assert.match(agent, /status: verifiedHealth \? "ok" : "failed"/);
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
  assert.match(admin, /confirm_device_id/);
  assert.match(admin, /expected_config_id/);
});
test("recovery probes forbid redirects and require authenticated device and config identity", () => {
  assert((composite.match(/redirect: "manual"/g)||[]).length >= 2);
  assert.match(composite, /config_id: typeof body\?\.config_id === "string"/);
  assert.match(admin, /validateAdminRecoveryEndpoint/);
  assert.match(admin, /observedConfigId: authenticatedCommandHealth\.config_id/);
  assert.match(selector, /device_identity_attested/);
  assert.match(selector, /config_identity_attested/);
});
