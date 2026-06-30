import assert from "node:assert/strict";
import {
  assertCapabilityKillSwitchOpen,
  evaluateCapabilityKillSwitch,
  parseCapabilityKillSwitchValue,
} from "./capabilityKillSwitchPolicy.js";

assert.equal(parseCapabilityKillSwitchValue("1"), true);
assert.equal(parseCapabilityKillSwitchValue("enabled"), true);
assert.equal(parseCapabilityKillSwitchValue("0"), false);

const disabled = evaluateCapabilityKillSwitch({
  surface: "local_shell",
  action: "run",
  env: { CAPABILITY_KILL_SWITCH_LOCAL_SHELL: "0" },
});
assert.equal(disabled.blocked, false);
assert.equal(disabled.mutation, true);

const readOnlyAction = evaluateCapabilityKillSwitch({
  surface: "local_file_mutation",
  action: "read",
  env: { CAPABILITY_KILL_SWITCH_LOCAL_FILE_MUTATION: "1" },
});
assert.equal(readOnlyAction.blocked, false);
assert.equal(readOnlyAction.mutation, false);

const blocked = evaluateCapabilityKillSwitch({
  surface: "raw_credential_intake_creation",
  action: "create",
  env: { CAPABILITY_KILL_SWITCH_RAW_CREDENTIAL_INTAKE: "true" },
});
assert.equal(blocked.blocked, true);
assert.equal(blocked.env_var, "CAPABILITY_KILL_SWITCH_RAW_CREDENTIAL_INTAKE");

assert.throws(
  () => assertCapabilityKillSwitchOpen({
    surface: "local_shell",
    action: "shell_fetch_upload",
    env: { CAPABILITY_KILL_SWITCH_LOCAL_SHELL: "enabled" },
  }),
  (error) => error.status === 503 && error.code === "CAPABILITY_KILL_SWITCH_ENABLED"
);

console.log("test-capability-kill-switch-policy passed");
