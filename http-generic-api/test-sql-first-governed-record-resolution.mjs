import assert from 'node:assert/strict';
import {
  readGovernedSheetRecords,
  resolveBrandRegistryBinding,
  hostingerSshRuntimeRead,
} from './governedRecordResolution.js';

function createHttpError(code, message, status = 500) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
}

const sqlRows = [
  {
    brand_name: 'All Royal Egypt',
    target_key: 'allroyalegypt_wp',
    brand_domain: 'allroyalegypt.com',
    base_url: 'https://allroyalegypt.com',
    hosting_account_key: 'hostinger_main',
  },
];

{
  const registry = await readGovernedSheetRecords('Brand Registry', '', {
    createHttpError,
    async readSqlRegistrySurface(surfaceName) {
      assert.equal(surfaceName, 'Brand Registry');
      return sqlRows;
    },
  });

  assert.equal(registry.source, 'sql_primary');
  assert.equal(registry.authority, 'sql_runtime_authority');
  assert.deepEqual(registry.rows, sqlRows);
  assert(registry.header.includes('target_key'));
}

{
  const binding = await resolveBrandRegistryBinding({ target_key: 'allroyalegypt_wp' }, {
    createHttpError,
    firstPopulated(row, keys) {
      for (const key of keys) {
        const value = row?.[key];
        if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
      }
      return '';
    },
    async readSqlRegistrySurface() {
      return sqlRows;
    },
  });

  assert.equal(binding.target_key, 'allroyalegypt_wp');
  assert.equal(binding.hosting_account_key, 'hostinger_main');
}

{
  await assert.rejects(
    () => readGovernedSheetRecords('Brand Registry', 'legacy-sheet-id', {
      createHttpError,
      async readSqlRegistrySurface() {
        throw new Error('sql unavailable');
      },
      async getGoogleClientsForSpreadsheet() {
        throw new Error('should not use sheets without flag');
      },
    }),
    /Legacy sheet fallback is disabled/
  );
}

{
  const result = await hostingerSshRuntimeRead({ input: { target_key: 'site_beta' } }, {
    HOSTING_ACCOUNT_REGISTRY_SHEET: 'Hosting Account Registry',
    createHttpError,
    matchesHostingerSshTarget(rowObj, input) {
      const targets = JSON.parse(rowObj.resolver_target_keys_json || '[]');
      return targets.includes(input.target_key);
    },
    asBool(value) {
      return String(value || '').trim().toUpperCase() === 'TRUE';
    },
    async readSqlRegistrySurface(surfaceName) {
      assert.equal(surfaceName, 'Hosting Account Registry');
      return [
        {
          hosting_provider: 'Hostinger',
          hosting_account_key: 'hostinger_main',
          account_identifier: 'acct_123',
          resolver_target_keys_json: '["site_alpha","site_beta"]',
          brand_sites_json: '[]',
          ssh_available: 'TRUE',
          wp_cli_available: 'TRUE',
          shared_access_enabled: 'FALSE',
          resolver_execution_ready: 'TRUE',
        },
      ];
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.authoritative_source, 'table.hosting_accounts');
  assert.equal(result.legacy_mirror_source, 'Hosting Account Registry');
  assert.equal(result.ssh_available, true);
  assert.equal(result.wp_cli_available, true);
  assert.equal(result.shared_access_enabled, false);
}

console.log('SQL-first governed record resolution tests passed');
