#!/usr/bin/env node

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isSubset,
  parseBoolean,
  renderTemplate,
  requiredConfirmation,
  resolveMigrationPath,
  validateApplyGate,
  validateSha,
  validateTargetPlan,
} from './production-runtime-recovery.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';

test('renderTemplate replaces only known placeholders recursively', () => {
  const rendered = renderTemplate(
    {
      ref: '{{sha}}',
      nested: ['{{branch}}', '{{unknown}}'],
      untouched: true,
    },
    { sha: SHA, branch: 'main' },
  );
  assert.deepEqual(rendered, {
    ref: SHA,
    nested: ['main', '{{unknown}}'],
    untouched: true,
  });
});

test('isSubset validates nested expected contracts without requiring exact response equality', () => {
  assert.equal(isSubset(
    { already_applied: true, nested: { applies_sql: false } },
    { already_applied: true, nested: { applies_sql: false, extra: 'ok' }, extra: 1 },
  ), true);
  assert.equal(isSubset({ already_applied: true }, { already_applied: false }), false);
});

test('validateSha accepts only full lowercase-normalized commit SHAs', () => {
  assert.equal(validateSha(SHA.toUpperCase()), SHA);
  assert.throws(() => validateSha('abc123'), (error) => error.code === 'invalid_sha');
});

test('mutation confirmation is bound to strategy and exact SHA', () => {
  assert.equal(requiredConfirmation('primary', SHA), `RECOVER:primary:${SHA}`);
  assert.doesNotThrow(() => validateApplyGate({
    strategy: 'fallback',
    sha: SHA,
    applyExecution: true,
    confirmation: `RECOVER:fallback:${SHA}`,
  }));
  assert.throws(() => validateApplyGate({
    strategy: 'fallback',
    sha: SHA,
    applyExecution: true,
    confirmation: `RECOVER:primary:${SHA}`,
  }), (error) => error.code === 'confirmation_mismatch');
});

test('dry-run does not require a mutation confirmation', () => {
  assert.doesNotThrow(() => validateApplyGate({
    strategy: 'primary',
    sha: SHA,
    applyExecution: false,
    confirmation: '',
  }));
  assert.equal(parseBoolean('TRUE'), true);
  assert.equal(parseBoolean('false', true), false);
});

test('migration path is confined to canonical repository migrations directory', () => {
  const safe = resolveMigrationPath('http-generic-api/migrations/20260815_custom_gpt_mcp_catalog_levels.sql');
  assert.match(safe.repoPath, /^http-generic-api\/migrations\//);
  assert.throws(
    () => resolveMigrationPath('../../.github/workflows/production-runtime-recovery.yml'),
    (error) => error.code === 'unsafe_migration_path',
  );
});

test('target plan remains explicit and rejects unsafe database or migration configuration', () => {
  assert.doesNotThrow(() => validateTargetPlan({
    key: 'runtime',
    database: 'u338416126_growthOS',
    principal: 'u338416126_growthOS',
    principal_host: '%',
    migrations: [
      {
        file: 'http-generic-api/migrations/20260815_custom_gpt_mcp_catalog_levels.sql',
        expected_checksum: '528143808adac23eb457058c4c34dd95c4c5d462bca9ac4b170b1f19b2006681',
      },
    ],
  }));
  assert.throws(
    () => validateTargetPlan({ key: 'runtime', database: 'growthOS;DROP DATABASE x', migrations: [] }),
    (error) => error.code === 'target_invalid',
  );
});
