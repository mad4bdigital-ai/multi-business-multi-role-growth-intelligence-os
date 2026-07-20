import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const captureScript = fileURLToPath(new URL("./scripts/tenant-gpt-oauth-live-smoke-capture.mjs", import.meta.url));
const result = spawnSync(process.execPath, [
  captureScript,
  "--user-id=f242960c-2857-4b4d-a504-ee50f8a278b4",
  "--tenant-id=00000000-0000-4000-a000-000000000001",
  "--confirm=NO",
], { encoding: "utf8" });

assert.equal(result.status, 0, result.stderr);
assert.equal(result.stderr, "");
const payload = JSON.parse(result.stdout);
assert.equal(payload.ok, false);
assert.equal(payload.error.code, "live_smoke_confirmation_required");
assert.equal(payload.capture.child_exit_code, 1);
assert.equal(payload.capture.stdout_json_parsed, true);
assert.equal(payload.capture.stderr_present, false);
assert.equal(payload.secrets_included, false);
for (const forbidden of ["access_token", "client_secret", "authorization_code", "raw_token"]) {
  assert.equal(result.stdout.includes(`\"${forbidden}\"`), false);
}

console.log("PASS tenant-gpt-oauth-live-smoke-capture");
