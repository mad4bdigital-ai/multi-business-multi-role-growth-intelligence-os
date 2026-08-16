import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const inventory = JSON.parse(readFileSync(new URL("../../http-generic-api/remote-mcp-write-scope-inventory.generated.json", import.meta.url)));
const partition = JSON.parse(readFileSync(new URL("../../docs/staging-write-route-partition-2026-08-14.json", import.meta.url)));

assert.equal(partition.environment, "staging");
assert.equal(partition.activation_policy, "deny_by_default_shadow_only");
assert.equal(partition.production_allowed, false);
assert.equal(partition.write_activation_allowed, false);
assert.equal(partition.provider_mutation_allowed, false);
assert.equal(partition.migration_apply_allowed, false);
assert.equal(partition.route_count, inventory.classified_write_route_count);
assert.equal(partition.route_count, 652);
assert.equal(new Set(partition.routes.map((route) => route.route_id)).size, partition.route_count);

for (const route of partition.routes) {
  assert.equal(route.staging_mode, "shadow");
  assert.equal(route.default_request, false);
  assert.equal(route.activation_allowed, false);
  assert.equal(route.provider_mutation_allowed, false);
  assert.equal(route.migration_apply_allowed, false);
  assert.equal(route.rollback_required, true);
  assert.equal(route.readback_required, true);
  assert.equal(route.approval_required, true);
  assert.ok(["critical-shadow", "high-shadow", "manual-confirmation-shadow"].includes(route.staging_risk_bucket));
}

console.log(JSON.stringify({
  ok: true,
  contract: "mad4b.staging-write-route-partition.v1",
  environment: partition.environment,
  route_count: partition.route_count,
  bundle_counts: partition.bundle_counts,
  risk_bucket_counts: partition.risk_bucket_counts,
  activation_allowed: partition.write_activation_allowed,
  provider_mutation_allowed: partition.provider_mutation_allowed,
  secrets_included: false,
}, null, 2));
