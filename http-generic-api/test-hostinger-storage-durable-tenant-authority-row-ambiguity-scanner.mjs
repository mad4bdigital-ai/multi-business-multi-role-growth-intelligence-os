#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { scanRepository } from './scripts/context-kernel-hardcoding-scan.mjs';

const target = 'http-generic-api/hostingerStorageDurableTenantAuthorityStore.js';
const report = scanRepository({
  repositoryRoot: path.resolve('.'),
  changedFiles: [target],
  changedLineRanges: new Map([
    [target, [{ start: 1, end: Number.MAX_SAFE_INTEGER }]],
  ]),
});

const activeRuntimeFindings = report.findings.filter(
  (finding) => finding.zone === 'runtime' && !finding.suppressed,
);

assert.equal(
  report.summary.runtime_finding_count,
  0,
  `durable authority row selection must be scanner-clean: ${JSON.stringify(activeRuntimeFindings)}`,
);
assert.equal(
  activeRuntimeFindings.some((finding) => finding.rule_id === 'first_candidate_selection'),
  false,
  'exact-cardinality reads must not expose a first-candidate selection finding',
);

console.log('Hostinger durable Tenant authority ambiguity scanner regression tests passed');
