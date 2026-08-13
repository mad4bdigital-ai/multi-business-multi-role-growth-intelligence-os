import assert from "node:assert/strict";
import { buildTrackBMigrationReadinessManifest, TRACK_B_MIGRATION_PINS } from "./migrationReadinessManifest.js";

const manifest = buildTrackBMigrationReadinessManifest();
assert.equal(manifest.repository_preflight_pass, true);
assert.equal(manifest.entries.length, 2);
assert.equal(manifest.entries[0].checksum_sha256, "8689a9440be9224e1b19ee1d88c983feb10f4056cc7a83d59790e9230ed28faf");
assert.equal(manifest.entries[0].statement_count, 4);
assert.equal(manifest.entries[1].checksum_sha256, "a11dff751fca4df19a6acfc188ca7310d8e1a90aa5c3f06fe0c3efeb1213a2a9");
assert.equal(manifest.entries[1].git_blob_sha, "7f3e0152bcdfba36a659ff4a1df8e30d82024c8c");
assert.equal(manifest.entries[1].statement_count, 4);
for (const entry of manifest.entries) {
  assert.equal(entry.authorization_status, "pending_separate_authorization");
  assert.equal(entry.apply_sent, false);
  assert.equal(entry.migration_applied, false);
  assert.equal(entry.database_mutated, false);
  assert.equal(entry.same_cycle_readback_complete, false);
  assert.equal(entry.runtime_consumers_enabled, false);
}
assert.equal(manifest.migration_applied, false);
assert.equal(manifest.database_mutated, false);

const drifted = buildTrackBMigrationReadinessManifest({ connection_ownership: { ...TRACK_B_MIGRATION_PINS.connection_ownership, statement_count: 5 } });
assert.equal(drifted.repository_preflight_pass, false);
assert.ok(drifted.entries[0].blockers.includes("MIGRATION_STATEMENT_COUNT_MISMATCH"));

console.log("track B migration readiness manifest tests passed");
