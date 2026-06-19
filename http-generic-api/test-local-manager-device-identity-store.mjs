import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const program = readFileSync(
  new URL("../apps/local-manager-windows/Program.cs", import.meta.url),
  "utf8",
);
const store = readFileSync(
  new URL("../apps/local-manager-windows/DeviceIdentityStore.cs", import.meta.url),
  "utf8",
);

assert.match(program, /private readonly DeviceIdentityStore _deviceIdentityStore = new\(\);/);
assert.match(program, /_deviceIdentityStore\.Save\(token, deviceId, status\)/);
assert.match(program, /_deviceIdentityStore\.Load\(out var error\)/);
assert.match(program, /_deviceIdentityStore\.Delete\(\)/);
assert.match(program, /_deviceIdentityStore\.TokenFileExists/);
assert.doesNotMatch(program, /ProtectedData\.(Protect|Unprotect)/);
assert.doesNotMatch(program, /private static string ProtectedTokenPath/);
assert.doesNotMatch(program, /private static string LinkStatusPath/);
assert.doesNotMatch(program, /File\.WriteAllBytes\(ProtectedTokenPath/);

assert.match(store, /DataProtectionScope\.CurrentUser/);
assert.match(store, /ProtectedData\.Protect/);
assert.match(store, /ProtectedData\.Unprotect/);
assert.match(store, /device-token\.dpapi/);
assert.match(store, /device-link-status\.json/);
assert.match(store, /secrets_included = false/);
assert.match(store, /internal void Delete\(\)/);

console.log("local manager device identity store extraction guard passed");
