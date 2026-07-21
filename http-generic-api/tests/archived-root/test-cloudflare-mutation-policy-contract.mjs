import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  resolveGptToolInvocationMutationRequirement,
  hasDeclaredMutationPolicy,
} from "./governedExecutionPreflight.js";

const migration = await readFile(
  new URL("./migrations/1032_sprint69_cloudflare_mutation_policy_contract.sql", import.meta.url),
  "utf8",
);

assert.equal(resolveGptToolInvocationMutationRequirement({
  toolKey: "admin_cloudflare",
  method: "POST",
  args: { method: "GET" },
}), false);
assert.equal(resolveGptToolInvocationMutationRequirement({
  toolKey: "admin_cloudflare",
  method: "POST",
  args: { method: "PATCH" },
}), true);
assert.equal(hasDeclaredMutationPolicy({
  tags: ["mutation_policy_required", "capability_envelope", "approval_required", "readback", "rollback_required"],
}), true);

for (const expected of [
  "Cloudflare Mutation Governance",
  "cloudflare_zone_record_mutation_policy_v1",
  "zone_ownership_required",
  "record_protection_required",
  "protected_record_classes",
  "preview_required_before_mutation",
  "same_cycle_readback_required",
  "rollback_metadata_required",
  "approval_hold_required",
  "capability_envelope_required",
  "reuse_existing_approval_path",
  "direct_provider_mutation_enabled_by_policy', FALSE",
  "credential_payload_read_allowed', FALSE",
  "secrets_included', FALSE",
  "v_cloudflare_mutation_policy_readiness",
  "missing_cloudflare_mutation_policy_contract",
  "additionalProperties', FALSE",
]) {
  assert(migration.includes(expected), `Cloudflare mutation policy migration must include ${expected}`);
}

assert.doesNotMatch(migration, /DROP\s+|DELETE\s+FROM|TRUNCATE\s+/i);
assert.doesNotMatch(migration, /fetch\s*\(|axios|cloudflare\.|dns_records\/[^']*DELETE/i);

console.log("cloudflare mutation policy contract tests passed");
