import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageJson = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const doc = fs.readFileSync(
  new URL('../docs/dependency-performance-diagnostic-triage.md', import.meta.url),
  'utf8'
);

assert(!packageJson.dependencies?.['js-yaml'], 'js-yaml must not remain a runtime dependency');
assert(packageJson.dependencies?.yaml, 'yaml must remain available for OpenAPI/YAML parsing');

const apiRoot = path.dirname(fileURLToPath(import.meta.url));
const scannedFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
    } else if (/\.(mjs|js)$/.test(entry.name)) {
      scannedFiles.push(fullPath);
    }
  }
}
walk(apiRoot);

const jsYamlImportFiles = scannedFiles.filter((file) => {
  const source = fs.readFileSync(file, 'utf8');
  return /from\s+['"]js-yaml['"]|require\(['"]js-yaml['"]\)/.test(source);
});
assert.deepEqual(jsYamlImportFiles, [], 'repo must not import js-yaml after migration');

for (const dependency of ['js-yaml', 'express', 'jsonwebtoken']) {
  assert(doc.includes(dependency), `diagnostic triage must mention ${dependency}`);
}

assert(doc.includes('Status: replaced'), 'js-yaml replacement must be documented');
assert(doc.includes('Status: deferred'), 'deferred dependency replacements must be documented');
assert(doc.includes('auth contract test') && doc.includes('matrix'), 'jsonwebtoken replacement must require auth contract tests');
assert(doc.includes('route compatibility audit'), 'express replacement must require route compatibility audit');

console.log('dependency performance diagnostic triage tests passed');
