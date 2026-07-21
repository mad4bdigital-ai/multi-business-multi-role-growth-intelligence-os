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
const deviceLink = readFileSync(
  new URL("./services/localManagerDeviceLinkService.js", import.meta.url),
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
assert.match(verifier, /VerifyRepairRuntimeReadback\(root, controls\)/);
assert.match(verifier, /GetTrueBoolean\(runtime, "connector_active"\)/);
assert.match(verifier, /GetTrueBoolean\(runtime, "health_recent"\)/);
assert.match(verifier, /GetTrueBoolean\(runtime, "alias_resolved"\)/);
assert.match(verifier, /registered_route_count/);
assert.match(verifier, /RuntimeVerified/);
assert.match(verifier, /"settings" => \(RequireObject\(controls, "capability_consent"\), true\)/);
assert.match(deviceLink, /runtime_readback: runtimeReadback/);
assert.match(deviceLink, /connector_active: connectorActive/);
assert.match(deviceLink, /healthAgeSeconds <= 600/);
assert.match(deviceLink, /registeredRouteCount > 0/);
assert.match(deviceLink, /aliasResolved/);
assert.match(deviceLink, /evidence_source: "mysql_primary_connector_registry"/);

assert.match(dispatcher, /"device\.getStatus"/);
assert.match(dispatcher, /"connector\.getControls"/);
assert.match(dispatcher, /The sidecar operation has no attached dispatcher/);
assert.match(dispatcher, /credential_storage = "Windows DPAPI CurrentUser"/);
assert.match(dispatcher, /_deviceIdentityStore\.Load\(out var loadError\)/);
assert.match(dispatcher, /_connectorCapabilityVerifier\.VerifyAsync\(section, token, cancellationToken\)/);
assert.match(dispatcher, /SidecarRpcContracts\.AssertSecretSafeResponse\(verification\.ControlEnvelope\)/);
assert.doesNotMatch(dispatcher, /device_access_token|device_token|ProtectedData|Process\.Start|RunElevatedAsync/);

console.log("local manager capability verifier and read-only sidecar dispatcher guard passed");
