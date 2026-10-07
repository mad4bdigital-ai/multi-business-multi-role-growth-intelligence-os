import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const canonical = readFileSync(resolve(root, "autopilot-portable-staging/Staging-Environment.ps1"), "utf8");
const oneClick = readFileSync(resolve(root, "autopilot-portable-staging/One-Click-Staging.ps1"), "utf8");

assert.match(canonical, /function New-StagingHexValue/);
assert.match(canonical, /'TOKEN_ENCRYPTION_KEY' = \{ New-StagingHexValue 32 \}/);
assert.match(canonical, /TOKEN_ENCRYPTION_KEY must be exactly 64 hexadecimal characters \(32 bytes\)/);

assert.match(oneClick, /function New-TokenEncryptionKey/);
assert.match(oneClick, /"TOKEN_ENCRYPTION_KEY" = New-TokenEncryptionKey/);
assert.doesNotMatch(oneClick, /"TOKEN_ENCRYPTION_KEY" = New-Secret/);
assert.match(oneClick, /\^\[0-9a-fA-F\]\{64\}\$/);
assert.match(oneClick, /refusing implicit key rotation/);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.staging-environment-secret-governance.v1",
  canonical_generator: "32_random_bytes_hex",
  one_click_generator: "32_random_bytes_hex",
  invalid_existing_key_policy: "fail_closed_no_implicit_rotation",
  production_mutation: false,
  secrets_included: false,
}));
