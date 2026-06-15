import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const program = readFileSync(
  new URL("../apps/local-manager-windows/Program.cs", import.meta.url),
  "utf8",
);
const controls = readFileSync(
  new URL("../apps/local-manager-windows/DeviceControlClient.cs", import.meta.url),
  "utf8",
);
const verifier = readFileSync(
  new URL("../apps/local-manager-windows/ConnectorCapabilityVerifier.cs", import.meta.url),
  "utf8",
);
const dispatcher = readFileSync(
  new URL("../apps/local-manager-windows/SidecarReadOnlyDispatcher.cs", import.meta.url),
  "utf8",
);

assert.match(program, /private readonly ConnectorCapabilityVerifier _connectorCapabilityVerifier;/);
assert.match(program, /new ConnectorCapabilityVerifier\(_deviceControlClient\)/);
assert.match(program, /_connectorCapabilityVerifier\.VerifyAsync\(section, token\)/);

assert.match(controls, /"overview"/);
assert.match(verifier, /Connector capability verification returned an invalid or unsafe control envelope/);
assert.match(verifier, /GetTrueBoolean\(root, "ok"\)/);
assert.match(verifier, /GetString\(root, "section"\) != section/);
assert.match(verifier, /GetTrueBoolean\(root, "secrets_included"\)/);
assert.match(verifier, /"repairs" => RequireTrueBoolean\(controls, "elevation_required"\)/);
assert.match(verifier, /"settings" => RequireObject\(controls, "capability_consent"\)/);

assert.match(dispatcher, /"device\.getStatus"/);
assert.match(dispatcher, /"connector\.getControls"/);
assert.match(dispatcher, /The sidecar operation has no attached dispatcher/);
assert.match(dispatcher, /credential_storage = "Windows DPAPI CurrentUser"/);
assert.match(dispatcher, /_deviceIdentityStore\.Load\(out var loadError\)/);
assert.match(dispatcher, /_connectorCapabilityVerifier\.VerifyAsync\(section, token, cancellationToken\)/);
assert.match(dispatcher, /SidecarRpcContracts\.AssertSecretSafeResponse\(verification\.ControlEnvelope\)/);
assert.doesNotMatch(dispatcher, /device_access_token|device_token|ProtectedData|Process\.Start|RunElevatedAsync/);

console.log("local manager capability verifier and read-only sidecar dispatcher guard passed");
