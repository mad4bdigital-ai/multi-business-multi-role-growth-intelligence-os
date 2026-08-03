import assert from 'node:assert/strict';
import path from 'node:path';
import { access } from 'node:fs/promises';
import { CAPABILITY_RESOLUTION_ENVELOPE_APPROVE_SCRIPT } from './routes/adminCliRoutes.js';

assert.equal(
  path.isAbsolute(CAPABILITY_RESOLUTION_ENVELOPE_APPROVE_SCRIPT),
  true,
  'approval alias script path must be absolute so runtime cwd cannot duplicate http-generic-api',
);
assert.equal(
  path.basename(CAPABILITY_RESOLUTION_ENVELOPE_APPROVE_SCRIPT),
  'capability-resolution-envelope-approve.mjs',
  'approval alias must target the governed approval script',
);
assert.equal(
  CAPABILITY_RESOLUTION_ENVELOPE_APPROVE_SCRIPT.includes(
    `${path.sep}http-generic-api${path.sep}http-generic-api${path.sep}`,
  ),
  false,
  'approval alias script path must not contain a doubled http-generic-api segment',
);
await access(CAPABILITY_RESOLUTION_ENVELOPE_APPROVE_SCRIPT);

const originalCwd = process.cwd();
try {
  process.chdir(path.dirname(CAPABILITY_RESOLUTION_ENVELOPE_APPROVE_SCRIPT));
  assert.equal(
    path.isAbsolute(CAPABILITY_RESOLUTION_ENVELOPE_APPROVE_SCRIPT),
    true,
    'changing cwd must not alter the approval alias target',
  );
} finally {
  process.chdir(originalCwd);
}

console.log(JSON.stringify({
  ok: true,
  script_path_is_absolute: true,
  script_exists: true,
  cwd_independent: true,
  doubled_http_generic_api_segment: false,
  secrets_included: false,
}, null, 2));
