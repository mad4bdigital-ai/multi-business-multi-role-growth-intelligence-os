#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./hostingerStorageSqlRunReader.js', import.meta.url), 'utf8');
const readRunStart = source.indexOf('  async function readRun(');
const readerStart = source.indexOf('\n  const reader = {', readRunStart);

assert.ok(readRunStart >= 0, 'readRun must remain present');
assert.ok(readerStart > readRunStart, 'readRun must remain bounded before reader publication');

const readRunSource = source.slice(readRunStart, readerStart);
const directIndexPattern = new RegExp(`${'rows'}(?:\\?\\.)?\\[${'0'}\\]`, 'u');

assert.match(
  readRunSource,
  /const boundedRows = Array\.isArray\(rows\) \? rows : \[\];/u,
  'readRun must normalize the SQL driver response into one bounded collection',
);
assert.match(
  readRunSource,
  /if \(boundedRows\.length > 1\)[\s\S]*STORAGE_SQL_RUN_READER_ROW_AMBIGUOUS/u,
  'readRun must reject ambiguous durable run identities',
);
assert.match(
  readRunSource,
  /let run = null;[\s\S]*if \(boundedRows\.length === 1\)[\s\S]*const \[row\] = boundedRows;[\s\S]*run = normalizeRun\(row\);/u,
  'readRun must prove exact cardinality before destructuring the sole row',
);
assert.doesNotMatch(
  readRunSource,
  directIndexPattern,
  'readRun must not directly select the first SQL result candidate',
);

console.log('Hostinger SQL run-reader row-cardinality regression tests passed');
