import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./authCredentialResolution.js", import.meta.url), "utf8");

assert(
  source.includes('extractCredentialValue(credentials, "application_password", "app_password", "password", "secret", "token")'),
  "Basic Auth credential resolution must recognize WordPress application_password before legacy aliases"
);
assert(
  source.includes('if (mode === "basic_auth")'),
  "auth contract builder must retain basic_auth mode handling"
);
assert(
  source.includes('contract.header_name = "Authorization"'),
  "basic_auth contract must still use Authorization header"
);

console.log("wordpress application password auth contract test passed");
