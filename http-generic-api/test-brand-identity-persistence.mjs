import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  canonicalGlobalBrandTargetKey,
  normalizeBrandDomain,
  normalizeBrandInputIdentifiers,
  normalizeBrandUrl,
  publicPersistentBrandIdentityResolution,
  resolvePersistentBrandIdentity,
} from "./brandIdentityResolver.js";

assert.equal(normalizeBrandDomain("HTTPS://WWW.Exämple.com.:443/path"), "xn--exmple-cua.com");
assert.equal(normalizeBrandDomain("https://www.acme.com/path?q=1"), "acme.com");
assert.equal(normalizeBrandUrl("www.acme.com/path/"), "https://acme.com/path");
assert.match(canonicalGlobalBrandTargetKey("550e8400-e29b-41d4-a716-446655440000"), /^brand_[a-f0-9]{32}$/);

const normalized = normalizeBrandInputIdentifiers({
  brandDomain: "https://www.Acme.com/path",
  brandName: "  Acme   Travel ",
  identifiers: [{ type: "provider_native_id", value: " META: 123 ", verification_status: "verified", provider_family: "meta" }],
});
assert.equal(normalized.some((item) => item.identifier_type === "verified_domain" && item.normalized_value === "acme.com"), true);
assert.equal(normalized.find((item) => item.identifier_type === "provider_native_id").verification_status, "unverified", "caller may not self-assert verification");

function executor({ aliases = [], identifiers = [], brands = [] } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/FROM brand_identity_aliases/.test(sql)) {
        return [aliases.filter((row) => row.alias_type === params[0] && row.alias_value_hash === params[1] && row.status === "active")];
      }
      if (/FROM brand_identifiers/.test(sql)) {
        return [identifiers.filter((row) => row.identifier_type === params[0] && row.provider_family === params[1] && row.normalized_value_hash === params[2] && row.status === "active")];
      }
      if (/FROM brands/.test(sql) && /brand_id IN/.test(sql)) {
        const wanted = new Set(params);
        return [brands.filter((row) => wanted.has(row.brand_id))];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

const domainLookup = normalizeBrandInputIdentifiers({ brandDomain: "acme.com" }).find((item) => item.identifier_type === "verified_domain");
{
  const db = executor({
    identifiers: [{ identifier_type: "verified_domain", provider_family: "", normalized_value_hash: domainLookup.normalized_value_hash, verification_status: "verified", confidence_class: "hard", brand_id: "brand-global-a", status: "active" }],
    brands: [{ brand_id: "brand-global-a", status: "active", identity_status: "verified" }],
  });
  const result = await resolvePersistentBrandIdentity(db, { identifiers: [{ type: "verified_domain", value: "https://www.acme.com", verification_status: "verified" }] });
  assert.equal(result.status, "EXACT");
  assert.equal(result.brand_id, "brand-global-a");
  assert.equal(result.cross_tenant_details_included, false);
  assert.equal(result.authority_required, true);
}
{
  const db = executor({
    identifiers: [
      { identifier_type: "verified_domain", provider_family: "", normalized_value_hash: domainLookup.normalized_value_hash, verification_status: "verified", confidence_class: "hard", brand_id: "brand-a", status: "active" },
      { identifier_type: "verified_domain", provider_family: "", normalized_value_hash: domainLookup.normalized_value_hash, verification_status: "verified", confidence_class: "hard", brand_id: "brand-b", status: "active" },
    ],
    brands: [
      { brand_id: "brand-a", status: "active", identity_status: "verified" },
      { brand_id: "brand-b", status: "active", identity_status: "verified" },
    ],
  });
  const result = await resolvePersistentBrandIdentity(db, { identifiers: [{ type: "verified_domain", value: "acme.com" }] });
  assert.equal(result.status, "CONFLICT");
  assert.equal(result.brand_id, null);
}
{
  const nameLookup = normalizeBrandInputIdentifiers({ brandName: "Acme" }).find((item) => item.identifier_type === "brand_name");
  const db = executor({
    identifiers: [{ identifier_type: "brand_name", provider_family: "", normalized_value_hash: nameLookup.normalized_value_hash, verification_status: "unverified", confidence_class: "weak", brand_id: "brand-a", status: "active" }],
    brands: [{ brand_id: "brand-a", status: "active", identity_status: "provisional" }],
  });
  const result = await resolvePersistentBrandIdentity(db, { identifiers: [{ type: "brand_name", value: " ACME " }] });
  assert.equal(result.status, "PROBABLE");
  assert.equal(result.brand_id, "brand-a");
}
{
  const aliasHash = createHash("sha256").update("workspace_brand_legacy").digest("hex");
  const db = executor({
    aliases: [{ alias_type: "legacy_target_key", alias_value_hash: aliasHash, brand_id: "brand-a", status: "active" }],
    brands: [{ brand_id: "brand-a", status: "active", identity_status: "verified" }],
  });
  const result = await resolvePersistentBrandIdentity(db, { aliases: [{ type: "legacy_target_key", value: "workspace_brand_legacy" }] });
  assert.equal(result.status, "EXACT");
  assert.equal(result.brand_id, "brand-a");
  assert.deepEqual(result.matched_alias_types, ["legacy_target_key"]);
}
{
  const db = executor();
  const result = await resolvePersistentBrandIdentity(db, { identifiers: [{ type: "brand_name", value: "Missing" }] });
  assert.equal(result.status, "NONE");
  assert.deepEqual(publicPersistentBrandIdentityResolution(result), { ...result });
}

console.log("brand identity persistence tests passed");
