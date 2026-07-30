import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL(
  './migrations/20260730_growth_intelligence_platform_brand_container.sql',
  import.meta.url,
);
const sql = await readFile(migrationUrl, 'utf8');

const normalized = sql.replace(/\s+/g, ' ').trim();
const statements = sql
  .split(';')
  .map((statement) => statement.trim())
  .filter(Boolean);

assert.equal(statements.length, 2, 'migration must contain exactly two SQL statements');
assert.match(statements[0], /^--[\s\S]*INSERT INTO containers\s*\(/i);
assert.match(statements[1], /^INSERT INTO container_relationships\s*\(/i);

assert.match(normalized, /ee4b3966-3afa-5bbb-ad93-563a4a3a1b9f/i);
assert.match(normalized, /2a619ab8-1138-537a-a2c2-352233a70945/i);
assert.match(normalized, /2b387496-c9f3-4f4e-a131-0249dd9714f1/i);
assert.match(normalized, /b50db01b-617e-4b7a-8bda-6bf4876f754f/i);
assert.match(normalized, /brand:growth_intelligence_platform/i);
assert.match(normalized, /brand_target_key/i);
assert.match(normalized, /growth_intelligence_platform/i);
assert.match(normalized, /relationship_type_key\s*=\s*'contains'/i);
assert.match(statements[1], /FROM containers brand_container/i);
assert.match(statements[1], /brand_container\.container_id/i);
assert.doesNotMatch(statements[1], /ee4b3966-3afa-5bbb-ad93-563a4a3a1b9f/i);

const notExistsCount = (normalized.match(/NOT EXISTS\s*\(/gi) ?? []).length;
assert.equal(notExistsCount, 2, 'container and relationship inserts must both be idempotent');

const existsCount = (normalized.match(/EXISTS\s*\(/gi) ?? []).length;
assert.ok(existsCount >= 8, 'migration must guard tenant, brand, type, workspace, and relationship prerequisites');

assert.doesNotMatch(normalized, /\b(?:UPDATE|DELETE|ALTER|DROP|TRUNCATE|REPLACE)\b/i);
assert.doesNotMatch(normalized, /tenant_id\s+IS\s+NULL/i);

console.log('growth intelligence platform brand-container migration contract passed');
