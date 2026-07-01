import assert from "node:assert/strict";

import {
  brandRowMatchesReference,
  extractGoogleFileId,
  normalizeBrandReference,
  resolveBrandReference,
} from "./resolvers/brandReferenceResolver.js";

const dona = {
  brand_name: "Dona tours",
  normalized_brand_name: "dona tours",
  brand_domain: "donatours.com",
  target_key: "donatours_wp",
  base_url: "https://donatours.com/wp-json",
  site_aliases_json: '["donatours","dona tours","donatours.com"]',
};

for (const reference of [
  "DONA Tours",
  "dona-tours",
  "donatours",
  "donatours.com",
  "https://www.donatours.com/plan-your-trip/",
  "donatours_wp",
]) {
  const result = resolveBrandReference({ reference, rows: [dona] });
  assert.equal(result.status, "resolved", reference);
  assert.equal(result.canonical_brand_key, "donatours_wp", reference);
  assert.equal(brandRowMatchesReference(dona, reference), true, reference);
}

assert.equal(normalizeBrandReference("https://www.DonaTours.com/wp-json"), "donatourscom");
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

console.log("brand reference resolver tests passed");
