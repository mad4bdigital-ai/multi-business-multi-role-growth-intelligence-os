#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('hostingerStorageDurableTenantAuthorityStore.js', 'utf8');
const loadCurrentStart = source.indexOf('async function loadCurrent(');
const loadTokenStart = source.indexOf('\nasync function loadToken(', loadCurrentStart);

assert.ok(loadCurrentStart >= 0, 'loadCurrent must remain present');
assert.ok(loadTokenStart > loadCurrentStart, 'loadCurrent must remain bounded before loadToken');

const loadCurrentSource = source.slice(loadCurrentStart, loadTokenStart);

assert.match(
  loadCurrentSource,
  /const boundedRows = Array\.isArray\(rows\) \? rows : \[\];/u,
  'loadCurrent must normalize the database response into one bounded row collection',
);
assert.match(
  loadCurrentSource,
  /if \(boundedRows\.length > 1\)[\s\S]*STORAGE_DURABLE_AUTHORITY_ROW_AMBIGUOUS/u,
  'loadCurrent must fail closed when one authority identity resolves to multiple rows',
);
assert.match(
  loadCurrentSource,
  /if \(boundedRows\.length === 0\) return null;/u,
  'loadCurrent must return null only after proving the result set is empty',
);
assert.match(
  loadCurrentSource,
  /const \[row\] = boundedRows;[\s\S]*parseRecord\(row, table\)[\s\S]*Number\(row\.row_version\)/u,
  'loadCurrent must destructure the sole proven row instead of selecting an arbitrary candidate',
);

const normalizeIndex = loadCurrentSource.indexOf('const boundedRows = Array.isArray(rows) ? rows : [];');
const ambiguityIndex = loadCurrentSource.indexOf('if (boundedRows.length > 1)');
const emptyIndex = loadCurrentSource.indexOf('if (boundedRows.length === 0) return null;');
const destructureIndex = loadCurrentSource.indexOf('const [row] = boundedRows;');
assert.ok(
  normalizeIndex >= 0
    && ambiguityIndex > normalizeIndex
    && emptyIndex > ambiguityIndex
    && destructureIndex > emptyIndex,
  'loadCurrent must prove normalization, ambiguity rejection, empty result, then sole-row selection in that order',
);

assert.doesNotMatch(
  loadCurrentSource,
  /rows\?\.\[0\]|rows\[0\]|boundedRows\[0\]/u,
  'loadCurrent must not directly select the first database candidate',
);

console.log('Hostinger durable Tenant authority row-cardinality regression tests passed');
