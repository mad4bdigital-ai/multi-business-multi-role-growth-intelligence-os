#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const helper = fs.readFileSync(
  path.join(root, "autopilot-portable-staging", "Staging-WindowsCloudflared.ps1"),
  "utf8",
);

assert.match(helper, /function Reset-StagingCloudflaredLog/);
assert.match(helper, /\[IO\.FileShare\]::None/);
assert.match(helper, /Start-Sleep -Milliseconds 250/);
assert.match(helper, /Reset-StagingCloudflaredLog \$logFile 15/);
assert.match(helper, /did not become exclusively writable within \$TimeoutSeconds seconds/);
assert.doesNotMatch(helper, /\[IO\.File\]::WriteAllText\(\$logFile, '', \$encoding\)/);
assert.doesNotMatch(helper, /Stop-Service\s+Cloudflared/);
assert.doesNotMatch(helper, /Stop-Process[\s\S]{0,120}cloudflared/i);


assert.match(helper, /\[wmiclass\]'Win32_Service'/);
assert.match(helper, /\$serviceClass\.Create\(/);
assert.match(helper, /Win32_Service\.Create returned \$createCode/);
assert.match(helper, /reconciliation_transport = if \(\$null -eq \$service\) \{ 'win32_service_create' \}/);
assert.doesNotMatch(helper, /sc\.exe\s+create\s+\$serviceName/);

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.staging-cloudflared-log-release-regression.v1",
  bounded_retry: true,
  exclusive_file_ownership: true,
  structured_service_create: true,
  generic_cloudflared_untouched: true,
  production_mutation: false,
  provider_mutation: false,
  database_mutation: false,
  secrets_included: false,
}, null, 2));
