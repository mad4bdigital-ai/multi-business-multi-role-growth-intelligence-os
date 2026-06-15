import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const contracts = readFileSync(
  new URL("../apps/local-manager-windows/SidecarRpcContracts.cs", import.meta.url),
  "utf8",
);
const server = readFileSync(
  new URL("../apps/local-manager-windows/SidecarRpcServer.cs", import.meta.url),
  "utf8",
);
const architecture = readFileSync(
  new URL("../docs/hermes-surface-local-manager-container-architecture.md", import.meta.url),
  "utf8",
);

const allowedOperations = [
  "device.getStatus",
  "device.startLink",
  "device.forget",
  "connector.getControls",
  "connector.requestRepair",
  "connector.requestCapabilities",
  "runtime.getCapabilities",
  "runtime.getRecommendations",
  "runtime.updateSettings",
  "runtime.installProvider",
  "runtime.installModel",
  "runtime.runApprovedJob",
  "runtime.getJob",
  "runtime.cancelJob",
];

for (const operation of allowedOperations) {
  assert.match(contracts, new RegExp(`\\["${operation.replace(".", "\\.")}"\\]`));
}

for (const approval of [
  "device_link_approved",
  "device_forget_approved",
  "repair_approved",
  "capability_change_approved",
  "settings_update_approved",
  "installation_approved",
  "model_installation_approved",
  "delegation_approved",
  "cancellation_approved",
]) {
  assert.match(contracts, new RegExp(`"${approval}"`));
}

assert.match(contracts, /unknown_sidecar_operation/);
assert.match(contracts, /action_specific_approval_required/);
assert.match(contracts, /AssertSecretSafeResponse/);
assert.match(contracts, /ForbiddenResponseKeys/);
assert.match(contracts, /"device_token"/);
assert.match(contracts, /"connector_secret"/);
assert.match(contracts, /"signed_installer_url"/);
assert.match(contracts, /bool SecretsIncluded/);
assert.match(contracts, /new\(SidecarRpcContracts\.ProtocolVersion[\s\S]*false\);/);

for (const forbiddenOperation of [
  "shell.execute",
  "process.spawn",
  "dpapi.decrypt",
  "device.getToken",
  "connector.getSecret",
  "auth.callArbitraryUrl",
]) {
  assert.doesNotMatch(contracts, new RegExp(`\\["${forbiddenOperation.replace(".", "\\.")}"\\]`));
  assert.match(architecture, new RegExp(forbiddenOperation.replace(".", "\\.")));
}

assert.match(architecture, /Windows named pipe/);
assert.match(architecture, /current Windows user/);
assert.match(architecture, /must not cross the named pipe/i);

assert.match(server, /NamedPipeServerStream/);
assert.match(server, /PipeOptions\.CurrentUserOnly/);
assert.match(server, /MaxRequestBytes/);
assert.match(server, /ValidateRequest\(request\)/);
assert.match(server, /AssertSecretSafeResponse\(result\)/);
assert.match(server, /secrets_included = false/);
assert.match(server, /RedactError/);
assert.doesNotMatch(server, /HttpListener|TcpListener|Process\.Start|ProtectedData\.Unprotect/);

console.log("local manager sidecar RPC contract guard passed");
