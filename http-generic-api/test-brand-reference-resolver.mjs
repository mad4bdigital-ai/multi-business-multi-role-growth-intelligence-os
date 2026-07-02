import assert from "node:assert/strict";

import {
  brandReferenceScript,
  brandRowMatchesReference,
  extractGoogleFileId,
  normalizeHumanBrandReference,
  normalizeBrandReference,
  resolveBrandReference,
  resolveBrandReferenceCandidates,
} from "./resolvers/brandReferenceResolver.js";

// Canonical platform identity comes from the brands registry. Related values remain
// isolated fixtures; the resolver itself contains no platform- or customer-specific branch.
const platformBrand = {
  brand_name: "Growth Intelligence Platform",
  normalized_brand_name: "growth intelligence platform",
  brand_domain: "mad4b.com",
  target_key: "growth_intelligence_platform",
  base_url: "https://auth.mad4b.com",
  site_aliases_json: '["mad4b.com","auth.mad4b.com","connector.mad4b.com","connect.mad4b.com","n8n.mad4b.com"]',
};

for (const reference of [
  "Growth Intelligence Platform",
  "growth-intelligence-platform",
  "growthintelligenceplatform",
  "mad4b.com",
  "https://auth.mad4b.com/activation/session-context",
  "growth_intelligence_platform",
]) {
  const result = resolveBrandReference({ reference, rows: [platformBrand] });
  assert.equal(result.status, "resolved", reference);
  assert.equal(result.canonical_brand_key, "growth_intelligence_platform", reference);
  assert.equal(brandRowMatchesReference(platformBrand, reference), true, reference);
}

assert.equal(normalizeBrandReference("https://www.DonaTours.com/wp-json"), "donatourscom");
assert.equal(normalizeHumanBrandReference("أُول رويـال إيجيبت"), "اول رويال ايجيبت");
assert.equal(normalizeBrandReference("أُول رويـال إيجيبت"), "اولرويالايجيبت");
assert.equal(normalizeHumanBrandReference("براند ٢٠٢٦"), "براند 2026");
assert.equal(brandReferenceScript("اول رويال ايجيبت"), "Arab");
assert.equal(brandReferenceScript("All Royal Egypt"), "Latn");
assert.equal(
  extractGoogleFileId("https://docs.google.com/document/d/1mGairpFES7rooCuTvL8BwyCrM50rMD2YLZVxF38vqys/edit"),
  "1mGairpFES7rooCuTvL8BwyCrM50rMD2YLZVxF38vqys"
);

const ambiguous = resolveBrandReference({
  reference: "shared-brand",
  rows: [
    { target_key: "brand_a", site_aliases_json: '["shared-brand"]' },
    { target_key: "brand_b", site_aliases_json: '["shared-brand"]' },
  ],
});
assert.equal(ambiguous.status, "ambiguous");
assert.deepEqual(ambiguous.candidate_keys.sort(), ["brand_a", "brand_b"]);

const allRoyal = {
  brand_name: "AllRoyalEgypt Brand",
  normalized_brand_name: "allroyalegypt brand",
  brand_domain: "allroyalegypt.com",
  target_key: "allroyalegypt_wp",
  site_aliases_json: '["all royal egypt","allroyalegypt"]',
};
const interpreted = resolveBrandReferenceCandidates({
  reference: "اول رويال ايجيبت",
  candidate_references: ["all royal egypt", "allroyalegypt"],
  rows: [allRoyal],
});
assert.equal(interpreted.status, "resolved");
assert.equal(interpreted.canonical_brand_key, "allroyalegypt_wp");
assert.equal(interpreted.match_source, "interpreted_candidate");
assert.ok(interpreted.score >= 70);

const interpretedAmbiguous = resolveBrandReferenceCandidates({
  reference: "اسم محلي",
  candidate_references: ["shared brand"],
  rows: [
    { target_key: "brand_a", site_aliases_json: '["shared brand"]' },
    { target_key: "brand_b", site_aliases_json: '["shared brand"]' },
  ],
});
assert.equal(interpretedAmbiguous.status, "ambiguous");
assert.deepEqual(interpretedAmbiguous.candidate_keys.sort(), ["brand_a", "brand_b"]);

console.log("brand reference resolver tests passed");
