import assert from "node:assert/strict";
import {
  canonicalBrandCreateOperation,
  canonicalOperationDescriptor,
  conservativeFallbackOperationInference,
  resolveOperationGovernance,
  validateOperationDescriptor,
} from "./platformOperationGovernanceContract.js";
import { resolveCanonicalBusinessOperation } from "./canonicalBusinessOperationRegistry.js";

const brandCreate = canonicalBrandCreateOperation();
const valid = validateOperationDescriptor(brandCreate);
assert.equal(valid.valid, true);
assert.equal(valid.normalized.operation_key, "brand.create");
assert.equal(valid.normalized.effect_class, "internal_write");
assert.equal(valid.normalized.risk_class, "high");
assert.equal(valid.normalized.readback_contract, "same_cycle_required");
assert.equal(valid.normalized.tool_discovery_required, false);
assert.equal(valid.normalized.identity_resolution_contract, "brand_identity_v2");
assert.equal(valid.normalized.relationship_resolution_contract, "tenant_brand_claim_v1");
assert.equal(valid.normalized.capability_profile, "brand_identity_mutation");

const registeredBrandCreate = resolveCanonicalBusinessOperation("brand.create");
assert.equal(registeredBrandCreate.risk_class, brandCreate.risk_class);
assert.equal(registeredBrandCreate.executor_ref, brandCreate.executor_ref);
assert.equal(registeredBrandCreate.approval_contract, brandCreate.approval_contract);
assert.equal(registeredBrandCreate.readback_contract, brandCreate.readback_contract);

const brandIdentityResolve = canonicalOperationDescriptor("brand.identity.resolve");
assert.equal(brandIdentityResolve.effect_class, "read_only");
assert.equal(brandIdentityResolve.canonical_registry_status, "shadow");
assert.equal(brandIdentityResolve.executor_ref, "brandIdentityResolver.resolvePersistentBrandIdentity");
assert.equal(brandIdentityResolve.tool_discovery_required, false);

const claimVerify = canonicalOperationDescriptor("brand.claim.verify");
assert.equal(claimVerify.effect_class, "internal_write");
assert.equal(claimVerify.approval_contract, "explicit");
assert.equal(claimVerify.expected_revision_required, true);
assert.equal(claimVerify.relationship_resolution_contract, "tenant_brand_claim_v1");

const assetIdentity = canonicalOperationDescriptor("asset.identity.resolve");
assert.equal(assetIdentity.identity_resolution_contract, "asset_identity_v1");
assert.equal(assetIdentity.effect_class, "read_only");

const providerIdentity = canonicalOperationDescriptor("provider_account.identity.resolve");
assert.equal(providerIdentity.identity_resolution_contract, "provider_account_identity_v1");
assert.equal(providerIdentity.capability_profile, "provider_account_identity_read");

const resolved = resolveOperationGovernance({
  descriptor: brandCreate,
  caller: { risk_class: "low", approval_contract: "none" },
});
assert.equal(resolved.status, "ready");
assert.equal(resolved.risk_class, "high");
assert.equal(resolved.approval_contract, "policy_resolved");
assert.equal(resolved.approval_required, true);
assert.equal(resolved.caller_attempted_lowering, true);
assert.equal(resolved.tool_discovery_required, false);
assert.equal(resolved.canonical_registry_status, "shadow");

const elevated = resolveOperationGovernance({
  descriptor: brandCreate,
  policy: { minimum_risk: "critical", approval_contract: "explicit" },
});
assert.equal(elevated.risk_class, "critical");
assert.equal(elevated.approval_contract, "explicit");
assert.equal(elevated.approval_required, true);

const invalidDiscovery = validateOperationDescriptor({
  ...brandCreate,
  tool_discovery_required: true,
});
assert.equal(invalidDiscovery.valid, false);
assert.ok(invalidDiscovery.errors.includes("known_brand_create_must_not_discover_tools"));

const invalidExternal = validateOperationDescriptor({
  operation_key: "provider.publish",
  resource_type: "asset",
  effect_class: "external_write",
  risk_class: "medium",
  approval_contract: "policy_resolved",
  readback_contract: "same_cycle_required",
  authority_required: true,
  idempotency_required: true,
});
assert.equal(invalidExternal.valid, false);
assert.ok(invalidExternal.errors.includes("risk_below_effect_floor"));
assert.ok(invalidExternal.errors.includes("approval_below_effect_floor"));
assert.ok(invalidExternal.errors.includes("readback_below_effect_floor"));

const fallback = conservativeFallbackOperationInference("brand.create");
assert.equal(fallback.source, "compatibility_text_fallback");
assert.equal(fallback.risk_class, "high");
assert.equal(fallback.approval_required, true);
assert.equal(fallback.dispatch_allowed, false);

const unknownRead = conservativeFallbackOperationInference("brand.preview");
assert.equal(unknownRead.risk_class, "low");
assert.equal(unknownRead.dispatch_allowed, true);

assert.equal(canonicalOperationDescriptor("brand.claim.missing"), null);

console.log("platform operation governance contract tests passed");
