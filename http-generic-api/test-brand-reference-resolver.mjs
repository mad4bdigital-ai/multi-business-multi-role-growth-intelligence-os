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

assert.equal(normalizeBrandReference("https://www.Mad4B.com/platform"), "mad4bcom");
assert.equal(normalizeHumanBrandReference("مَنصّـة ذَكاء النُّمو"), "منصة ذكاء النمو");
assert.equal(normalizeBrandReference("مَنصّـة ذَكاء النُّمو"), "منصةذكاءالنمو");
assert.equal(normalizeHumanBrandReference("منصة ٢٠٢٦"), "منصة 2026");
assert.equal(brandReferenceScript("منصة ذكاء النمو"), "Arab");
assert.equal(brandReferenceScript("Growth Intelligence Platform"), "Latn");
assert.equal(
  extractGoogleFileId("https://docs.google.com/document/d/1PlatformFixtureDocId20260702/edit"),
  "1PlatformFixtureDocId20260702"
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

const interpreted = resolveBrandReferenceCandidates({
  reference: "منصة ذكاء النمو",
  candidate_references: ["growth intelligence platform", "mad4b.com"],
  rows: [platformBrand],
});
assert.equal(interpreted.status, "resolved");
assert.equal(interpreted.canonical_brand_key, "growth_intelligence_platform");
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
