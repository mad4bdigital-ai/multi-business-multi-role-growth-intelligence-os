import assert from "node:assert/strict";
import express from "express";
import { buildGovernanceRoutes } from "./routes/governanceRoutes.js";

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
      "provider",
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
      "wordpress",
      "ready",
      "ready",
      "active"
    ],
    [
      "allroyalegypt",
      "AllRoyalEgypt Brand",
      "AllRoyalEgypt Brand",
      "hvac_air_conditioning_services",
      "hvac_air_conditioning_services_profile",
      "allroyalegypt-brand-folder-id",
      "allroyalegypt",
      "https://allroyalegypt.com/",
      "allroyalegypt.com",
      "wordpress",
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
      "{\"brand_core_profile\":\"brand-profile-doc-id\"}",
      "arab_cooling",
      "https://arabcooling.com/",
      "active"
    ]
  ],
  "Brand Core Registry": [
    [
      "Brand Name",
      "Asset Type",
      "Document Name",
      "Google Drive Link",
      "Core Function",
      "Used By Systems",
      "Priority",
      "Notes",
      "brand_key",
      "asset_key",
      "asset_class",
      "authoritative_home",
      "read_priority",
      "mirror_policy",
      "linked_json_mirror_refs",
      "validation_status",
      "active_status",
      "registry_role",
      "doc_id",
      "status"
    ],
    [
      "Arab Cooling",
      "brand_core",
      "01 - Brand Core Profile",
      "https://docs.google.com/document/d/brand-profile-doc-id/edit",
      "brand_identity",
      "brand_writing|strategy|seo",
      "critical",
      "Canonical Brand Core profile doc under Shared Drive.",
      "arab_cooling",
      "brand_core_profile",
      "google_doc",
      "surface.brand.arab_cooling.brand_core_folder",
      "1",
      "none",
      "",
      "validated",
      "active",
      "",
      "brand-profile-doc-id",
      "active"
    ],
    [
      "AllRoyalEgypt Brand",
      "brand_core",
      "01 - Brand Core Profile",
      "https://docs.google.com/document/d/allroyalegypt-brand-profile-doc-id/edit",
      "brand_identity",
      "brand_writing|strategy|seo",
      "critical",
      "Canonical Brand Core profile doc under Shared Drive.",
      "allroyalegypt",
      "brand_core_profile",
      "google_doc",
      "surface.brand.allroyalegypt.brand_core_folder",
      "1",
      "none",
      "",
      "validated",
      "active",
      "",
      "allroyalegypt-brand-profile-doc-id",
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
      "surface.brand_path_resolver_sheet",
      "validated",
      "ready",
      "active",
      "2026-05-01T00:00:00Z"
    ]
  ]
};

function makeDeps() {
  return {
    requireBackendApiKey(_req, _res, next) {
      next();
    },
    async getRegistry() {
      return {};
    },
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
    },
    async fetchChunkedTable(sheets, options) {
      const escaped = options.sheetName.replace(/'/g, "''");
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: options.spreadsheetId,
        range: `'${escaped}'!A1:${options.columnEnd || "AZ"}${options.dataEndRow || 2500}`
      });
      return response.data.values || [];
    }
  };
}

const previousRegistryId = process.env.REGISTRY_SPREADSHEET_ID;
process.env.REGISTRY_SPREADSHEET_ID = "registry-sheet-id";

const app = express();
app.use(express.json());
app.use(buildGovernanceRoutes(makeDeps()));

const server = app.listen(0);
try {
  const { port } = server.address();
  async function resolveDiagnostic(body) {
    const response = await fetch(`http://127.0.0.1:${port}/governance/resolve-context-diagnostic`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });

    assert.equal(response.status, 200);
    return response.json();
  }

  const json = await resolveDiagnostic({
    business_type_key: "hvac_air_conditioning_services",
    brand_key: "arab_cooling",
    target_key: "arab_cooling"
  });

  assert.equal(json.ok, true);
  assert.equal(json.diagnostic.path_resolver_load.loaded, true);
  assert.equal(json.diagnostic.resolution_status, "ready");
  assert.equal(json.diagnostic.knowledge_ready, true);
  assert.equal(json.diagnostic.execution_ready, true);
  assert.equal(json.diagnostic.business_type.business_type_key, "hvac_air_conditioning_services");
  assert.equal(json.diagnostic.brand.brand_key, "arab_cooling");
  assert.equal(
    json.diagnostic.brand.brand_folder_path,
    "Growth Intelligence OS - Knowledge Assets/Business Type Assets/HVAC-Air-Conditioning-Services/brands/arab_cooling"
  );
  assert.equal(json.diagnostic.brand_core.docs.brand_core_profile, "brand-profile-doc-id");
  assert.equal(json.diagnostic.validation_state.ready, true);

  const allRoyalEgypt = await resolveDiagnostic({
    business_type_key: "hvac_air_conditioning_services",
    brand_key: "allroyalegypt",
    target_key: "allroyalegypt"
  });

  assert.equal(allRoyalEgypt.ok, true);
  assert.equal(allRoyalEgypt.diagnostic.path_resolver_load.loaded, true);
  assert.equal(allRoyalEgypt.diagnostic.path_resolver_load.row_counts.brandRows, 1);
  assert.equal(allRoyalEgypt.diagnostic.path_resolver_load.row_counts.brandCoreRows, 1);
  assert.equal(allRoyalEgypt.diagnostic.path_resolver_load.row_counts.targetRows, 1);
  assert.equal(allRoyalEgypt.diagnostic.path_resolver_load.row_counts.brandPathRows, 0);
  assert.equal(allRoyalEgypt.diagnostic.path_resolver_load.row_counts.validationRows, 0);
  assert.equal(allRoyalEgypt.diagnostic.knowledge_ready, false);
  assert.equal(allRoyalEgypt.diagnostic.execution_ready, false);
  assert.equal(allRoyalEgypt.diagnostic.validation_state.ready, false);
  assert.equal(
    allRoyalEgypt.diagnostic.validation_state.reason,
    "missing_brand_path_rows|missing_validation_rows"
  );
  assert.equal(
    allRoyalEgypt.diagnostic.brand.brand_folder_path,
    "Growth Intelligence OS - Knowledge Assets/Business Type Assets/HVAC-Air-Conditioning-Services/brands/allroyalegypt"
  );
  assert.equal(allRoyalEgypt.diagnostic.brand_core.docs.brand_core_profile, "allroyalegypt-brand-profile-doc-id");
  assert.equal(allRoyalEgypt.diagnostic.execution_target.auth_status, "");
} finally {
  await new Promise((resolve) => server.close(resolve));
  if (previousRegistryId === undefined) {
    delete process.env.REGISTRY_SPREADSHEET_ID;
  } else {
    process.env.REGISTRY_SPREADSHEET_ID = previousRegistryId;
  }
}

console.log("governance resolve context diagnostic route tests passed");
