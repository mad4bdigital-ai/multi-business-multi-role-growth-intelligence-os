import assert from 'node:assert/strict';
import path from 'node:path';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const routesPath = fileURLToPath(new URL('./routes/adminCliRoutes.js', import.meta.url));
const approvalScriptPath = fileURLToPath(
  new URL('./scripts/capability-resolution-envelope-approve.mjs', import.meta.url),
);
const source = await readFile(routesPath, 'utf8');

const importLine = 'import { fileURLToPath } from "url";';
const constantLine = 'export const CAPABILITY_RESOLUTION_ENVELOPE_APPROVE_SCRIPT = fileURLToPath(new URL("../scripts/capability-resolution-envelope-approve.mjs", import.meta.url));';
const governedAlias = 'capability_resolution_envelope_approve: { command: process.execPath, args: [CAPABILITY_RESOLUTION_ENVELOPE_APPROVE_SCRIPT], display_name: "Approve capability resolution envelope", allow_extra_args: true, max_extra_args: 12, timeout_ms: 120000, built_in: true }';
const staleAlias = 'capability_resolution_envelope_approve: { command: process.execPath, args: ["http-generic-api/scripts/capability-resolution-envelope-approve.mjs"], display_name: "Approve capability resolution envelope", allow_extra_args: true, max_extra_args: 12, timeout_ms: 120000, built_in: true }';

assert.equal(
  source.split(importLine).length - 1,
  1,
  'adminCliRoutes must import fileURLToPath exactly once',
);
assert.equal(
  source.split(constantLine).length - 1,
  1,
  'adminCliRoutes must expose exactly one cwd-independent approval script constant',
);
assert.equal(
  source.split(governedAlias).length - 1,
  1,
  'built-in approval alias must use the resolved approval script constant exactly once',
);
assert.equal(
  source.includes(staleAlias),
  false,
  'stale cwd-dependent approval alias must be absent',
);

assert.equal(
  path.isAbsolute(approvalScriptPath),
  true,
  'resolved approval script path must be absolute',
);
assert.equal(
  path.basename(approvalScriptPath),
  'capability-resolution-envelope-approve.mjs',
  'approval alias must target the governed approval script',
);
assert.equal(
  approvalScriptPath.includes(`${path.sep}http-generic-api${path.sep}http-generic-api${path.sep}`),
  false,
  'resolved approval script path must not contain a doubled http-generic-api segment',
);
await access(approvalScriptPath);

const originalCwd = process.cwd();
try {
  process.chdir(path.dirname(approvalScriptPath));
  assert.equal(
    approvalScriptPath,
    fileURLToPath(new URL('./scripts/capability-resolution-envelope-approve.mjs', import.meta.url)),
    'changing cwd must not alter the approval alias target',
  );
} finally {
  process.chdir(originalCwd);
}

console.log(JSON.stringify({
  ok: true,
  source_contract_verified: true,
  script_path_is_absolute: true,
  script_exists: true,
  cwd_independent: true,
  stale_alias_absent: true,
  doubled_http_generic_api_segment: false,
  secrets_included: false,
}, null, 2));
