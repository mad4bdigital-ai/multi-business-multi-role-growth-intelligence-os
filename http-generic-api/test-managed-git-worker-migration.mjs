import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("./migrations/20260715_operation_managed_git_worker_leases.sql", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("./managedGitWorkerLifecycleService.js", import.meta.url),
  "utf8",
);

assert.match(migration, /active_lease_key CHAR\(64\) NULL/);
assert.match(migration, /UNIQUE KEY uq_operation_managed_git_worker_active_lease/);
assert.doesNotMatch(migration, /GENERATED ALWAYS AS/);
assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i);

assert.match(service, /lease_key_sha256, active_lease_key, principal_scope/);
assert.match(service, /workerId, leaseKey, leaseKey, actor\.scope/);
assert.match(service, /worker_status = \?, active_lease_key = NULL/);
assert.match(service, /worker_status = 'expired', active_lease_key = NULL/);

console.log("managed Git worker migration compatibility test passed");
