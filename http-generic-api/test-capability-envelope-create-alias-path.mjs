import assert from 'node:assert/strict';
import path from 'node:path';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const routesPath = fileURLToPath(new URL('./routes/adminCliRoutes.js', import.meta.url));
const source = await readFile(routesPath, 'utf8');
const cases = [
  {
    name: 'dry_run',
    constant: 'CAPABILITY_RESOLUTION_DRY_RUN_SCRIPT',
    file: 'capability-resolution-dry-run.mjs',
    stale: 'args: ["http-generic-api/scripts/capability-resolution-dry-run.mjs"]',
  },
  {
    name: 'envelope_create',
    constant: 'CAPABILITY_RESOLUTION_ENVELOPE_CREATE_SCRIPT',
    file: 'capability-resolution-envelope-create.mjs',
    stale: 'args: ["http-generic-api/scripts/capability-resolution-envelope-create.mjs"]',
  },
];

for (const item of cases) {
  const declaration = `export const ${item.constant} = fileURLToPath(new URL("../scripts/${item.file}", import.meta.url));`;
  assert.equal(source.split(declaration).length - 1, 1, `${item.name} constant must exist exactly once`);
  assert.equal(source.includes(`args: [${item.constant}]`), true, `${item.name} alias must use resolved path`);
  assert.equal(source.includes(item.stale), false, `${item.name} stale relative alias must be absent`);
  const scriptPath = fileURLToPath(new URL(`./scripts/${item.file}`, import.meta.url));
  assert.equal(path.isAbsolute(scriptPath), true);
  assert.equal(scriptPath.includes(`${path.sep}http-generic-api${path.sep}http-generic-api${path.sep}`), false);
  await access(scriptPath);
}

console.log(JSON.stringify({
  ok: true,
  cwd_independent_aliases: cases.map((item) => item.name),
  doubled_segment: false,
  secrets_included: false,
}, null, 2));
