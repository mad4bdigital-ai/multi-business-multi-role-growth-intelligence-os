import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const program = readFileSync(
  new URL("../apps/local-manager-windows/Program.cs", import.meta.url),
  "utf8",
);
const client = readFileSync(
  new URL("../apps/local-manager-windows/DeviceControlClient.cs", import.meta.url),
  "utf8",
);

assert.match(program, /private readonly DeviceControlClient _deviceControlClient = new\(BaseUrl\);/);
assert.match(program, /_deviceControlClient\.GetAsync\(section, token\)/);
assert.match(program, /_deviceControlClient\.GetAsync\("n8n", token\)/);
assert.match(program, /_connectorCapabilityVerifier\.VerifyAsync\(section, token\)/);
assert.doesNotMatch(program, /DeviceControlsUrl/);
assert.doesNotMatch(program, /CallDeviceApiAsync/);

for (const section of ["routes", "backups", "settings", "repairs", "n8n"]) {
  assert.match(client, new RegExp(`"${section}"`));
}
assert.match(client, /AllowedSections\.Contains\(section\)/);
assert.match(client, /\/local-manager\/device\/controls/);
assert.match(client, /HttpMethod\.Get/);
assert.match(client, /new AuthenticationHeaderValue\("Bearer", deviceAccessToken\)/);
assert.doesNotMatch(client, /HttpMethod\.Post|HttpMethod\.Put|HttpMethod\.Delete|Process\.Start|ProtectedData/);

console.log("local manager device control client extraction guard passed");
