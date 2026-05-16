import assert from "node:assert/strict";
import {
  extractPathResolverLoadRequest,
  loadPathResolverRowsForRequest
} from "./pathResolverRowsLoader.js";

const sheetData = {
  "Business Activity Type Registry": [
    [
      "business_activity_type_key",
      "default_knowledge_profile_key",
      "supported_route_keys",
      "supported_workflows",
      "brand_core_required",
      "status"
    ],
    [
      "hvac_air_conditioning_services",
      "hvac_air_conditioning_services_profile",
      "content_generation; seo_strategy",
      "wf_content_authority",
      "TRUE",
      "active"
    ]
  ],
  "Business Type Knowledge Profiles": [
    [
      "business_type",
      "knowledge_profile_key",
      "supported_engine_categories",
      "authoritative_read_home",
      "business_type_specific_read_home",
      "shared_knowledge_read_home",
      "compatible_route_keys",
      "compatible_workflows",
      "profile_status",
      "notes"
    ],
    [
      "hvac_air_conditioning_services",
      "hvac_air_conditioning_services_profile",
      "Brand Intelligence|Content Engines",
      "surface.business_type_hvac_shared_drive_folder",
      "Growth Intelligence OS - Knowledge Assets/Business Type Assets/HVAC-Air-Conditioning-Services",
      "Growth Intelligence OS - Knowledge Assets/Business Type Assets/Shared",
      "content_generation; seo_strategy",
      "wf_content_authority",
      "profile_registered",
      "FINAL GOVERNED SHARED DRIVE PATH"
    ]
  ],
  "Brand Registry": [
    [
      "brand_key",
      "Brand Name",
      "Normalized Brand Name",
      "business_type_key",
      "knowledge_profile_key",
      "brand_folder_id",
      "target_key",
      "base_url",
      "brand_domain",
      "auth_status",
      "validation_state",
      "status"
    ],
    [
      "arab_cooling",
      "Arab Cooling",
      "Arab Cooling",
      "hvac_air_conditioning_services",
      "hvac_air_conditioning_services_profile",
      "brand-folder-id",
      "arab_cooling",
      "https://arabcooling.com/",
      "arabcooling.com",
      "ready",
      "ready",
      "active"
    ]
  ],
  "Brand Path Resolver": [
    [
      "brand_key",
      "normalized_brand_name",
      "business_type_key",
      "knowledge_profile_key",
      "brand_folder_id",
      "brand_folder_path",
      "brand_core_docs_json",
      "target_key",
      "base_url",
      "status"
    ],
    [
      "arab_cooling",
      "Arab Cooling",
      "hvac_air_conditioning_services",
      "hvac_air_conditioning_services_profile",
      "brand-folder-id",
      "Growth Intelligence OS - Knowledge Assets/Business Type Assets/HVAC-Air-Conditioning-Services/brands/arab_cooling",
      "{\"profile\":\"brand-profile-doc-id\"}",
      "arab_cooling",
      "https://arabcooling.com/",
      "active"
    ]
  ],
  "Brand Core Registry": [
    [
      "brand_key",
      "asset_key",
      "doc_id",
      "status"
    ],
    [
      "arab_cooling",
      "profile",
      "brand-profile-doc-id",
      "active"
    ]
  ],
  "Validation & Repair Registry": [
    [
      "validation_id",
      "entity_key",
      "surface_id",
      "validation_status",
      "readiness_state",
      "status",
      "last_validated_at"
    ],
    [
      "VAL-ARAB-COOLING",
      "arab_cooling",
      "surface.business_type_hvac_shared_drive_folder",
      "validated",
      "ready",
      "active",
      "2026-05-01T00:00:00Z"
    ]
  ]
};

function makeDeps() {
  return {
    REGISTRY_SPREADSHEET_ID: "registry-sheet-id",
    async getGoogleClientsForSpreadsheet() {
      return {
        sheets: {
          spreadsheets: {
            values: {
              async get({ range }) {
                const match = range.match(/^'(.+)'!/);
                const sheetName = match ? match[1].replace(/''/g, "'") : "";
                return {
                  data: {
                    values: sheetData[sheetName] || []
                  }
                };
              }
            }
          }
        }
      };
    }
  };
}

{
  const request = extractPathResolverLoadRequest({
    business_type_key: "hvac_air_conditioning_services",
    brand_key: "arab_cooling",
    target_key: "arab_cooling",
    mutation_intent: "create_brand_folder"
  });

  assert.equal(request.requested, true);
  assert.equal(request.businessTypeKey, "hvac_air_conditioning_services");
  assert.equal(request.brandKey, "arab_cooling");
  assert.equal(request.targetKey, "arab_cooling");
}

{
  const loaded = await loadPathResolverRowsForRequest(
    {
      business_type_key: "hvac_air_conditioning_services",
      brand_key: "arab_cooling",
      target_key: "arab_cooling",
      mutation_intent: "create_brand_folder"
    },
    makeDeps()
  );

  assert.equal(loaded.requested, true);
  assert.equal(loaded.loaded, true);
  assert.equal(loaded.reason, "loaded");
  assert.equal(loaded.rows.businessActivityRows.length, 1);
  assert.equal(loaded.rows.profileRows.length, 1);
  assert.equal(loaded.rows.brandRows.length, 1);
  assert.equal(loaded.rows.brandPathRows.length, 1);
  assert.equal(loaded.rows.brandCoreRows.length, 1);
  assert.equal(loaded.rows.targetRows.length, 1);
  assert.equal(loaded.rows.validationRows.length, 1);

  assert.equal(
    loaded.rows.profileRows[0].business_type_specific_read_home,
    "Growth Intelligence OS - Knowledge Assets/Business Type Assets/HVAC-Air-Conditioning-Services"
  );
  assert.equal(
    loaded.rows.brandPathRows[0].brand_folder_path,
    "Growth Intelligence OS - Knowledge Assets/Business Type Assets/HVAC-Air-Conditioning-Services/brands/arab_cooling"
  );
}

{
  const loaded = await loadPathResolverRowsForRequest(
    {
      parent_action_key: "google_drive_api",
      endpoint_key: "listDriveFiles"
    },
    makeDeps()
  );

  assert.equal(loaded.requested, false);
  assert.equal(loaded.loaded, false);
  assert.equal(loaded.reason, "not_requested");
}

{
  // SQL authority must win even when Google/Sheets deps are present. This
  // protects governed context resolution from drifting back to Sheets just
  // because spreadsheet clients are wired into the route.
  const loaded = await loadPathResolverRowsForRequest(
    {
      business_type_key: "hvac_air_conditioning_services",
      brand_key: "arab_cooling"
    },
    {
      ...makeDeps(),
      DATA_SOURCE: "sql"
    }
  );

  assert.equal(loaded.requested, true);
  assert.equal(loaded.loaded, true);
  assert.equal(loaded.reason, "loaded_from_db");
}

{
  // When no Google deps are provided, the loader falls back to the DB layer
  // (pathResolverDbLoader.js). DB queries may return empty results in CI, but
  // the function still reports loaded=true with reason "loaded_from_db".
  const loaded = await loadPathResolverRowsForRequest(
    {
      business_type_key: "hvac_air_conditioning_services",
      brand_key: "arab_cooling"
    },
    {}
  );

  assert.equal(loaded.requested, true);
  assert.equal(loaded.loaded, true);
  assert.equal(loaded.reason, "loaded_from_db");
}

console.log("path resolver rows loader tests passed");
