import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const banned = [
  'LEGACY_SHEET_REGISTRY_RUNTIME_ENABLED',
  'allowLegacySheetRegistryRead',
  'legacy_sheet_mirror',
  'legacy_mirror_source',
  'legacy_mirror_spreadsheet_id',
  'legacy_mirror_worksheet_gid',
  'legacy_mirror_sheet_name',
  'legacy_mirror_sheet_title',
  'legacy_mirror_gid',
  'legacy_mirror_sheet_bindings',
  'legacy_registry_workbook_mirror',
  'legacy_operations_workbook_mirror',
  'legacy_operations_workbook_runtime_mirror',
  'legacy_brand_playbook_sheet_gid',
  'brand_playbook_sheet_gid',
  'operations_log_unified_sheet',
  'target_spreadsheet_id',
  'target_sheet_name',
  'worksheet_gid',
  'spreadsheet_id',
  'sheet_name',
  'source_sheet',
  'direct_sheet',
  'active_sheet_bindings',
  'approved_registry_tabs',
  'operations_workbook',
  'metrics_warehouse_workbook',
  'live_data_workbook',
  'review_workbook',
];

const files = [
  'governedRecordResolution.js',
  'hostinger.js',
  'test-connectors.mjs',
  'test-sql-first-governed-record-resolution.mjs',
  '../schemas/analytics.schema.json',
  '../schemas/business_identity.schema.json',
  '../schemas/execution.schema.json',
  '../schemas/operations.schema.json',
  '../schemas/wordpress_api.schema.json',
];

for (const file of files) {
  const content = readFileSync(file, 'utf8');
  for (const term of banned) {
    assert(!content.includes(term), `${file} must not contain removed sheet runtime evidence term: ${term}`);
  }
}

console.log('sheet runtime evidence removal guard passed');
