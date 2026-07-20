import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("./migrations/20260715_operation_managed_git_worker_leases.sql", import.meta.url),
  "utf8",
);

const workerStatusOffset = migration.indexOf("worker_status ENUM(");
const activeLeaseKeyOffset = migration.indexOf("active_lease_key CHAR(64)");

assert.ok(workerStatusOffset >= 0, "worker_status must be declared");
assert.ok(
  activeLeaseKeyOffset > workerStatusOffset,
  "generated active_lease_key must follow worker_status for MariaDB compatibility",
);
assert.match(migration, /GENERATED ALWAYS AS/);
assert.match(migration, /UNIQUE KEY uq_operation_managed_git_worker_active_lease/);
assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i);

console.log("managed Git worker migration compatibility test passed");
