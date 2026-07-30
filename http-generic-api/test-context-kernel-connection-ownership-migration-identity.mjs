import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildConnectionOwnershipMigrationDryRunInput,
  inspectConnectionOwnershipMigrationArtifact,
} from "./contextKernel/migration/connectionOwnershipMigrationPreflight.js";

const identity = JSON.parse(readFileSync(
  "../specs/012-unified-admin-tenant-context-kernel/connection-ownership-migration-identity.json",
  "utf8",
));
const inspection = await inspectConnectionOwnershipMigrationArtifact();
const dryRunInput = buildConnectionOwnershipMigrationDryRunInput(inspection);

assert.equal(identity.schema_version, "connection_ownership_migration_identity.v1");
assert.equal(identity.feature_key, "012-unified-admin-tenant-context-kernel");
assert.equal(identity.migration_file, inspection.migration);
assert.equal(identity.source_implementation_merge_sha, inspection.source_merge_sha);
assert.equal(identity.migration_checksum_sha256, inspection.migration_checksum_sha256);
assert.equal(identity.expected_statement_count, inspection.statement_count);
assert.equal(identity.typed_apply_confirmation, inspection.required_confirmation);
assert.equal(identity.resource_uri, inspection.resource_uri);
assert.deepEqual(identity.reviewed_top_level_statements, inspection.statement_identities);
assert.equal(dryRunInput.expected_checksum_sha256, identity.migration_checksum_sha256);
assert.equal(dryRunInput.expected_statement_count, identity.expected_statement_count);
assert.equal(identity.authorization_status, "pending_separate_authorization");
assert.equal(identity.live_dry_run_executed, false);
assert.equal(identity.migration_applied, false);
assert.equal(identity.database_mutated, false);
assert.equal(identity.same_cycle_readback_complete, false);
assert.equal(identity.runtime_consumers_enabled, false);
assert.equal(identity.provider_called, false);
assert.equal(identity.credential_mutated, false);
assert.equal(identity.production_deployed, false);
assert.equal(identity.rollback_strategy, "disable_consumers_and_retain_additive_schema");
assert.equal(identity.secrets_included, false);

console.log("connection ownership migration checksum identity tests passed");
