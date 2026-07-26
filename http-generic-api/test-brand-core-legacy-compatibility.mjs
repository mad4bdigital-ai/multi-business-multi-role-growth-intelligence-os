import assert from "node:assert/strict";

import { resolveBrandCore } from "./resolvers/brandCoreResolver.js";

const result = resolveBrandCore({
  brandKey: "https://www.donatours.com/",
  brandRegistryRows: [
    {
      brand_name: "Dona tours",
      normalized_brand_name: "dona tours",
      brand_domain: "donatours.com",
      target_key: "donatours_wp",
      base_url: "https://donatours.com/wp-json",
      site_aliases_json: '["donatours","dona tours","donatours.com"]',
      brand_core_ready: "TRUE",
      status: "active",
    },
  ],
  brandCoreRegistryRows: [
    {
      brand_name: "DONA Tours",
      brand_key: null,
      asset_type: "Brand Positioning",
      document_name: "DONA Tours - Brand Positioning",
      google_drive_link: "https://docs.google.com/document/d/1mGairpFES7rooCuTvL8BwyCrM50rMD2YLZVxF38vqys/edit",
      active_status: "TRUE",
      priority: "1",
    },
    {
      brand_name: "DONA Tours",
      brand_key: "",
      asset_key: "pricing_psychology",
      asset_type: "Pricing Psychology",
      document_name: "DONA Tours - Pricing Psychology",
      google_drive_link: "https://docs.google.com/document/d/1-uYHeB3kAROjq8NhUJD5HMGjmIDgGUcsdUHhCfB4Ywg/edit",
      validation_status: "validated",
      priority: "2",
    },
  ],
});

assert.equal(result.resolutionStatus, "resolved");
assert.equal(result.targetKey, "donatours_wp");
assert.equal(result.brandCoreRequired, true);
assert.equal(result.brandCoreStatus, "ready");
assert.equal(result.strategyReady, true);
assert.equal(result.contentReady, true);
assert.equal(result.coreRowCount, 2);
assert.equal(
  result.brandCoreDocs["Brand Positioning"],
  "1mGairpFES7rooCuTvL8BwyCrM50rMD2YLZVxF38vqys"
);
assert.equal(
  result.brandCoreDocs.pricing_psychology,
  "1-uYHeB3kAROjq8NhUJD5HMGjmIDgGUcsdUHhCfB4Ywg"
);
assert.equal(result.brandCoreAssets.every((asset) => asset.doc_id), true);

console.log("legacy Brand Core compatibility tests passed");
