#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('hostingerStorageDurableTenantEnablementRegistry.js', 'utf8');
const loadRecordStart = source.indexOf('async function loadRecord(');
const loadConsumptionStart = source.indexOf('\nasync function loadConsumption(', loadRecordStart);
const insertRecordStart = source.indexOf('\nasync function insertRecord(', loadConsumptionStart);

assert.ok(loadRecordStart >= 0, 'loadRecord must remain present');
assert.ok(loadConsumptionStart > loadRecordStart, 'loadRecord must remain bounded before loadConsumption');
assert.ok(insertRecordStart > loadConsumptionStart, 'loadConsumption must remain bounded before insertRecord');

const loadRecordSource = source.slice(loadRecordStart, loadConsumptionStart);
const loadConsumptionSource = source.slice(loadConsumptionStart, insertRecordStart);
const directIndexPattern = new RegExp(`${'rows'}(?:\\?\\.)?\\[${'0'}\\]`, 'u');

assert.match(
  loadRecordSource,
  /const boundedRows = Array\.isArray\(rows\) \? rows : \[\];/u,
  'loadRecord must normalize the database response into one bounded collection',
);
assert.match(
  loadRecordSource,
  /if \(boundedRows\.length > 1\)[\s\S]*STORAGE_DURABLE_ENABLEMENT_ROW_AMBIGUOUS/u,
  'loadRecord must reject ambiguous durable enablement identities',
);
assert.match(
  loadRecordSource,
  /if \(boundedRows\.length === 0\) return null;[\s\S]*const \[row\] = boundedRows;/u,
  'loadRecord must prove zero or one row before destructuring',
);
const recordNormalizeIndex = loadRecordSource.indexOf('const boundedRows = Array.isArray(rows) ? rows : [];');
const recordAmbiguityIndex = loadRecordSource.indexOf('if (boundedRows.length > 1)');
const recordEmptyIndex = loadRecordSource.indexOf('if (boundedRows.length === 0) return null;');
const recordSelectionIndex = loadRecordSource.indexOf('const [row] = boundedRows;');
assert.ok(
  recordNormalizeIndex >= 0
    && recordAmbiguityIndex > recordNormalizeIndex
    && recordEmptyIndex > recordAmbiguityIndex
    && recordSelectionIndex > recordEmptyIndex,
  'loadRecord must normalize, reject ambiguity, prove empty, then select the sole row in order',
);
assert.doesNotMatch(loadRecordSource, directIndexPattern, 'loadRecord must not use direct candidate indexing');

assert.match(
  loadConsumptionSource,
  /const boundedConsumptionRows = Array\.isArray\(rows\) \? rows : \[\];/u,
  'loadConsumption must normalize the database response into one bounded collection',
);
assert.match(
  loadConsumptionSource,
  /if \(boundedConsumptionRows\.length > 1\)[\s\S]*STORAGE_DURABLE_ENABLEMENT_CONSUMPTION_AMBIGUOUS/u,
  'loadConsumption must reject ambiguous durable consumption receipts',
);
assert.match(
  loadConsumptionSource,
  /if \(boundedConsumptionRows\.length === 0\) return null;[\s\S]*const \[row\] = boundedConsumptionRows;/u,
  'loadConsumption must prove zero or one row before destructuring',
);
const consumptionNormalizeIndex = loadConsumptionSource.indexOf('const boundedConsumptionRows = Array.isArray(rows) ? rows : [];');
const consumptionAmbiguityIndex = loadConsumptionSource.indexOf('if (boundedConsumptionRows.length > 1)');
const consumptionEmptyIndex = loadConsumptionSource.indexOf('if (boundedConsumptionRows.length === 0) return null;');
const consumptionSelectionIndex = loadConsumptionSource.indexOf('const [row] = boundedConsumptionRows;');
assert.ok(
  consumptionNormalizeIndex >= 0
    && consumptionAmbiguityIndex > consumptionNormalizeIndex
    && consumptionEmptyIndex > consumptionAmbiguityIndex
    && consumptionSelectionIndex > consumptionEmptyIndex,
  'loadConsumption must normalize, reject ambiguity, prove empty, then select the sole row in order',
);
assert.doesNotMatch(loadConsumptionSource, directIndexPattern, 'loadConsumption must not use direct candidate indexing');

console.log('Hostinger durable Tenant enablement row-cardinality regression tests passed');
