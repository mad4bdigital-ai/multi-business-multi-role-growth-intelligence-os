import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CAPABILITY_KILL_SWITCHES,
  parseCapabilityKillSwitchValue,
  isCapabilityMutationAction,
  evaluateCapabilityKillSwitch,
  capabilityKillSwitchError,
  assertCapabilityKillSwitchOpen,
  capabilityKillSwitchSnapshot,
} from "./capabilityKillSwitchPolicy.js";

assert.equal(parseCapabilityKillSwitchValue("true"), true);
assert.equal(parseCapabilityKillSwitchValue("ON"), true);
assert.equal(parseCapabilityKillSwitchValue("blocked"), true);
assert.equal(parseCapabilityKillSwitchValue("false"), false);
assert.equal(parseCapabilityKillSwitchValue(undefined), false);

const cases = [
  ["local_shell", "CAPABILITY_KILL_SWITCH_LOCAL_SHELL", ["run", "shell_fetch_upload"], ["status", "list"]],
  ["local_file_mutation", "CAPABILITY_KILL_SWITCH_LOCAL_FILE_MUTATION", ["write", "delete", "remove", "unlink", "move", "rename", "mkdir", "rmdir"], ["list", "list_drives", "locate_repo", "read"]],
  ["cloudflare_mutation", "CAPABILITY_KILL_SWITCH_CLOUDFLARE_MUTATION", ["create_dns", "delete_dns", "purge_cache"], ["list_zones", "list_dns", "list_tunnels", "tunnel_status"]],
  ["n8n_mutation", "CAPABILITY_KILL_SWITCH_N8N_MUTATION", ["start", "stop", "restart", "activate_workflow", "deactivate_workflow", "run_workflow"], ["status", "diagnose", "open", "health", "list_workflows", "get_workflow", "list_executions"]],
  ["raw_credential_intake_creation", "CAPABILITY_KILL_SWITCH_RAW_CREDENTIAL_INTAKE", ["create"], []],
];

for (const [surface, envVar, blockedActions, allowedActions] of cases) {
  assert.equal(CAPABILITY_KILL_SWITCHES[surface].env_var, envVar);
  for (const action of blockedActions) {
    assert.equal(isCapabilityMutationAction(surface, action), true, `${surface}.${action} must remain classified as mutating`);
    const disabled = evaluateCapabilityKillSwitch({ surface, action, env: {} });
    assert.equal(disabled.blocked, false, `${surface}.${action} must remain available while switch is disabled`);
    const enabled = evaluateCapabilityKillSwitch({ surface, action, env: { [envVar]: "true" } });
    assert.equal(enabled.blocked, true, `${surface}.${action} must be blocked while switch is enabled`);
    assert.equal(enabled.switch_key, surface);
    assert.equal(enabled.env_var, envVar);
    assert.equal(enabled.secrets_included, false);
  }
  for (const action of allowedActions) {
    assert.equal(isCapabilityMutationAction(surface, action), false, `${surface}.${action} must remain read-only`);
    const enabled = evaluateCapabilityKillSwitch({ surface, action, env: { [envVar]: "true" } });
    assert.equal(enabled.blocked, false, `${surface}.${action} must remain available for diagnostics/readback`);
  }
}

const isolated = evaluateCapabilityKillSwitch({
  surface: "n8n_mutation",
  action: "run_workflow",
  env: { CAPABILITY_KILL_SWITCH_CLOUDFLARE_MUTATION: "true" },
});
assert.equal(isolated.blocked, false, "kill switches must remain independently scoped");

const blockedDecision = evaluateCapabilityKillSwitch({
  surface: "local_shell",
  action: "run",
  env: { CAPABILITY_KILL_SWITCH_LOCAL_SHELL: "true" },
});
const error = capabilityKillSwitchError(blockedDecision);
assert.equal(error.status, 503);
assert.equal(error.code, "CAPABILITY_KILL_SWITCH_ENABLED");
assert.deepEqual(error.details, {
  switch_key: "local_shell",
  surface: "local_shell",
  action: "run",
  env_var: "CAPABILITY_KILL_SWITCH_LOCAL_SHELL",
  retryable: true,
  secrets_included: false,
});
assert.throws(
  () => assertCapabilityKillSwitchOpen({ surface: "local_shell", action: "run", env: { CAPABILITY_KILL_SWITCH_LOCAL_SHELL: "true" } }),
  (caught) => caught?.code === "CAPABILITY_KILL_SWITCH_ENABLED" && caught?.status === 503,
);
assert.doesNotThrow(() => assertCapabilityKillSwitchOpen({ surface: "local_shell", action: "list", env: { CAPABILITY_KILL_SWITCH_LOCAL_SHELL: "true" } }));

const snapshot = capabilityKillSwitchSnapshot({
  CAPABILITY_KILL_SWITCH_LOCAL_SHELL: "true",
  CAPABILITY_KILL_SWITCH_RAW_CREDENTIAL_INTAKE: "false",
});
assert.equal(snapshot.local_shell.enabled, true);
assert.equal(snapshot.raw_credential_intake_creation.enabled, false);
assert.equal(snapshot.local_shell.secrets_included, false);

const proxySource = await readFile(new URL("./routes/connectorProxyRoutes.js", import.meta.url), "utf8");
for (const expected of [
  'surface: "local_shell", action: req.body?.action',
  'surface: "local_shell", action: "shell_fetch_upload"',
  'surface: "local_file_mutation", action: req.body?.action',
  'surface: "cloudflare_mutation", action: req.body?.action',
  'surface: "n8n_mutation", action: req.body?.action',
]) {
  assert(proxySource.includes(expected), `connector proxy must enforce ${expected}`);
}
assert(proxySource.includes("return sendConnectorProxyError(res, err)"), "kill-switch errors must preserve status and stable error code");

const rawIntakeSource = await readFile(new URL("./routes/credentialIntakeRoutes.js", import.meta.url), "utf8");
assert(rawIntakeSource.includes('surface: "raw_credential_intake_creation", action: "create"'));
assert(rawIntakeSource.includes("...(err.details ? { details: err.details } : {})"), "raw intake must preserve bounded kill-switch evidence");
const tenantIntakeSource = await readFile(new URL("./routes/tenantPlatformPluginRoutes.js", import.meta.url), "utf8");
assert(!tenantIntakeSource.includes("raw_credential_intake_creation"), "tenant-safe intake flow must remain independent from the raw intake kill switch");

console.log("capability kill switch policy tests passed");