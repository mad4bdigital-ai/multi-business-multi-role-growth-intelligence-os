import assert from "node:assert/strict";
import {
  canonicalResourceIdentity,
  resolveBrandIdentity,
  validateIdentityDescriptor,
  validateResourceRelationship,
} from "./platformResourceIdentityContract.js";
import {
  buildBrandIdentityCandidate,
  buildTenantBrandRelationship,
  resolveVisibleBrandIdentity,
} from "./brandIdentityResolver.js";
import {
  adaptAssetIdentity,
  adaptProviderAccountIdentity,
} from "./platformResourceIdentityAdapters.js";
import {
  analyzeBrandIdentityReconciliation,
  readBrandIdentityReconciliationDiagnostics,
} from "./brandIdentityReconciliation.js";

const verifiedDomain = (value) => ({
  type: "verified_domain",
  value,
  verification_status: "verified",
  evidence_fresh: true,
  is_exclusive: true,
});
const brandName = (value) => ({
  type: "brand_name",
  value,
  verification_status: "unverified",
  evidence_fresh: true,
  is_exclusive: false,
});

const globalA = canonicalResourceIdentity({ resourceType: "brand", identityScope: "global", canonicalValue: "acme" });
const globalB = canonicalResourceIdentity({ resourceType: "brand", identityScope: "global", canonicalValue: "ACME" });
assert.equal(globalA.canonical_id, globalB.canonical_id, "global identity must be deterministic and tenant-independent");
assert.equal(globalA.identity_scope, "global");
assert.equal(globalA.provider_family, null);
assert.equal(
  canonicalResourceIdentity({ resourceType: "brand", identityScope: "global", canonicalValue: "acme", providerFamily: "" }).canonical_id,
  globalA.canonical_id,
);
assert.equal(
  canonicalResourceIdentity({ resourceType: "site", identityScope: "global", canonicalValue: "https://WWW.Acme.com/path" }).canonical_value,
  "www.acme.com",
);

const invalidGlobal = validateIdentityDescriptor({
  resource_type: "brand",
  identity_scope: "global",
  canonical_id: "brand_1",
  tenant_id: "tenant_a",
  authority_implied: false,
});
assert.equal(invalidGlobal.valid, false);
assert.ok(invalidGlobal.errors.includes("global_identity_must_not_carry_tenant_scope"));

const authorityLeak = validateIdentityDescriptor({
  resource_type: "brand",
  identity_scope: "global",
  canonical_id: "brand_1",
  authority_implied: true,
});
assert.equal(authorityLeak.valid, false);
assert.ok(authorityLeak.errors.includes("identity_must_not_imply_authority"));

const exact = resolveBrandIdentity({
  identifiers: [{ type: "verified_domain", value: "https://acme.com/", verification_status: "verified", evidence_fresh: true }],
  candidates: [
    { brand_id: "brand_acme", identifiers: [verifiedDomain("acme.com")] },
    { brand_id: "brand_other", identifiers: [verifiedDomain("other.com")] },
  ],
});
assert.equal(exact.status, "EXACT");
assert.equal(exact.brand_id, "brand_acme");

const probable = resolveBrandIdentity({
  identifiers: [brandName("Acme")],
  candidates: [{ brand_id: "brand_acme", identifiers: [brandName("Acme")] }],
});
assert.equal(probable.status, "PROBABLE");
assert.equal(probable.brand_id, "brand_acme");

const conflict = resolveBrandIdentity({
  identifiers: [verifiedDomain("shared.example")],
  candidates: [
    { brand_id: "brand_a", identifiers: [verifiedDomain("shared.example")] },
    { brand_id: "brand_b", identifiers: [verifiedDomain("shared.example")] },
  ],
});
assert.equal(conflict.status, "CONFLICT");
assert.equal(conflict.brand_id, null);

const ambiguous = resolveBrandIdentity({
  identifiers: [brandName("Acme")],
  candidates: [
    { brand_id: "brand_a", identifiers: [brandName("Acme")] },
    { brand_id: "brand_b", identifiers: [brandName("Acme")] },
  ],
});
assert.equal(ambiguous.status, "AMBIGUOUS");
assert.equal(ambiguous.brand_id, null);

const none = resolveBrandIdentity({ identifiers: [verifiedDomain("missing.example")], candidates: [] });
assert.equal(none.status, "NONE");

const visible = resolveVisibleBrandIdentity({
  tenantId: "tenant_a",
  identifiers: [verifiedDomain("acme.com")],
  candidates: [
    { brand_id: "brand_a", tenant_id: "tenant_a", identifiers: [verifiedDomain("acme.com")] },
    { brand_id: "brand_secret", tenant_id: "tenant_b", identifiers: [verifiedDomain("acme.com")] },
  ],
});
assert.equal(visible.status, "EXACT");
assert.equal(visible.brand_id, "brand_a");
assert.equal(visible.disclosure_policy, "identity_result_only");
assert.equal(visible.authority_required, true);
assert.equal(visible.candidates[0].brand_id, "brand_a");
assert.equal("tenant_id" in visible.candidates[0], false, "identity result must not disclose owner tenant");

const candidate = buildBrandIdentityCandidate({ brandId: "brand_acme", tenantId: "tenant_a", identifiers: [brandName("Acme")] });
assert.equal(candidate.brand_id, "brand_acme");
assert.equal(candidate.tenant_id, "tenant_a");

const relationship = buildTenantBrandRelationship({ tenantId: "tenant_a", brandId: "brand_acme", relationshipType: "references" });
assert.equal(relationship.authority_implied, false);
assert.equal(relationship.grant_created, false);
assert.equal(relationship.authority_source, "separate_grant_and_policy_required");

const invalidRelationship = validateResourceRelationship({
  relationship_type: "owns",
  from_resource_id: "tenant_a",
  to_resource_id: "brand_acme",
  authority_implied: true,
});
assert.equal(invalidRelationship.valid, false);
assert.ok(invalidRelationship.errors.includes("relationship_must_not_imply_authority"));

const assetByContent = adaptAssetIdentity({
  asset_id: "asset_a",
  tenant_id: "tenant_a",
  content_sha256: "A".repeat(64),
  brand_ref: "brand:acme",
  visibility: "tenant",
});
assert.equal(assetByContent.identity.identity_scope, "content_addressed");
assert.equal(assetByContent.rights.authority_implied, false);
assert.equal(assetByContent.identifiers[0].type, "content_sha256");

const tenantAsset = adaptAssetIdentity({ asset_id: "asset_b", tenant_id: "tenant_a" });
assert.equal(tenantAsset.identity.identity_scope, "tenant");
assert.equal(tenantAsset.rights.tenant_id, "tenant_a");

const providerAccount = adaptProviderAccountIdentity({
  provider_family: "Meta",
  provider_account_id: "act_123-456",
  account_label: "Primary Ads",
  credential_binding_ref: "connection_1",
  access_token: "must-not-leak",
});
assert.equal(providerAccount.identity.identity_scope, "provider_native");
assert.equal(providerAccount.identity.provider_family, "meta");
assert.equal(providerAccount.credential_binding.part_of_identity, false);
assert.equal(providerAccount.credential_binding.credential_material_included, false);
assert.equal(JSON.stringify(providerAccount).includes("must-not-leak"), false);

const reconciliation = analyzeBrandIdentityReconciliation({
  brands: [
    { brand_id: "brand_a", target_key: "legacy-a", status: "active" },
    { brand_id: "brand_b", target_key: "legacy-a", status: "active" },
  ],
  links: [{ link_id: "link_1", tenant_id: "tenant_a", brand_id: null, brand_target_key: "legacy-a", relationship_status: "active" }],
  aliases: [
    { alias_type: "target_key", alias_value_hash: "hash_a", brand_id: "brand_a", status: "active" },
    { alias_type: "target_key", alias_value_hash: "hash_a", brand_id: "brand_b", status: "active" },
  ],
  identifiers: [
    { identifier_type: "verified_domain", provider_family: "", normalized_value_hash: "domain_hash", verification_status: "verified", confidence_class: "hard", brand_id: "brand_a", status: "active" },
    { identifier_type: "verified_domain", provider_family: "", normalized_value_hash: "domain_hash", verification_status: "verified", confidence_class: "hard", brand_id: "brand_b", status: "active" },
  ],
});
assert.equal(reconciliation.read_only, true);
assert.equal(reconciliation.destructive_repair_performed, false);
assert.ok(reconciliation.findings.some((item) => item.code === "target_key_maps_to_multiple_brand_ids"));
assert.ok(reconciliation.findings.some((item) => item.code === "tenant_brand_link_missing_brand_id"));
assert.ok(reconciliation.findings.some((item) => item.code === "brand_identity_alias_collision"));
assert.ok(reconciliation.findings.some((item) => item.code === "verified_hard_identifier_collision"));

const reconciliationQueries = [];
const fakeExecutor = {
  async query(sql) {
    reconciliationQueries.push(sql.trim());
    if (/FROM brands/u.test(sql)) return [[{ brand_id: "brand_a", target_key: "legacy-a", status: "active" }]];
    return [[]];
  },
};
const persistedDiagnostics = await readBrandIdentityReconciliationDiagnostics(fakeExecutor, { limit: 25 });
assert.equal(persistedDiagnostics.read_only, true);
assert.equal(reconciliationQueries.length, 4);
assert.equal(reconciliationQueries.every((sql) => /^SELECT\b/u.test(sql)), true, "reconciliation adapter must remain SELECT-only");

console.log("platform resource identity contract tests passed");
