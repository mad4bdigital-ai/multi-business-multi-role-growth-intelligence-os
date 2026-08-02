#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const rules = Object.freeze([
  Object.freeze({
    token: 'hostingerStorageSyntheticAdapterBase.js',
    allowed: Object.freeze(['hostingerStorageSyntheticAdapter.js']),
  }),
  Object.freeze({
    token: 'hostingerStorageSyntheticExecutorBase.js',
    allowed: Object.freeze(['hostingerStorageSyntheticExecutor.js']),
  }),
]);

async function collectJavaScriptFiles(directory, relative = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.posix.join(relative, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectJavaScriptFiles(absolutePath, relativePath));
      continue;
    }
    if (entry.isFile() && /\.(?:js|mjs)$/u.test(entry.name)) files.push(relativePath);
  }
  return files.sort();
}

const files = await collectJavaScriptFiles(root);
const violations = [];
const observations = [];

for (const relativePath of files) {
  const source = await readFile(path.join(root, relativePath), 'utf8');
  for (const rule of rules) {
    if (!source.includes(rule.token)) continue;
    observations.push(Object.freeze({ token: rule.token, file: relativePath }));
    if (!rule.allowed.includes(relativePath)) {
      violations.push(Object.freeze({
        code: 'SYNTHETIC_BASE_IMPORT_BOUNDARY_VIOLATION',
        token: rule.token,
        file: relativePath,
        allowed: [...rule.allowed],
        secrets_included: false,
      }));
    }
  }
}

assert.deepEqual(violations, [], `Synthetic Base ownership violations: ${JSON.stringify(violations)}`);
for (const rule of rules) {
  assert.deepEqual(
    observations.filter((entry) => entry.token === rule.token).map((entry) => entry.file),
    [...rule.allowed],
    `Synthetic Base ownership observations drifted for ${rule.token}`,
  );
}

console.log(JSON.stringify({
  ok: true,
  gate: 'hostinger_storage_synthetic_factory_import_boundary',
  scanned_file_count: files.length,
  observations,
  violation_count: 0,
  canonical_wrappers_only: true,
  repository_mutation_performed: false,
  provider_dispatch_performed: false,
  credential_access_performed: false,
  secrets_included: false,
}));
