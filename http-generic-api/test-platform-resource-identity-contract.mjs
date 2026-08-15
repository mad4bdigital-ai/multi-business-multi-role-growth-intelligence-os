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

console.log("platform resource identity contract tests passed");
