import assert from "node:assert/strict";
import { WORKSPACE_ASSET_TYPES, requireWorkspaceAssetType } from "./workspaceAssetTypeContract.js";
import { _testingResourceApiService } from "./src/application/resourceApi/resourceApiService.js";

assert.deepEqual(WORKSPACE_ASSET_TYPES, [
  "drive_file",
  "drive_folder",
  "drive_shortcut",
  "doc",
  "sheet",
  "image",
  "report",
  "session",
  "knowledge",
  "approval",
  "external_ref",
]);

for (const assetType of WORKSPACE_ASSET_TYPES) {
  assert.equal(requireWorkspaceAssetType(assetType), assetType);
  const input = {
    asset_type: assetType,
    asset_ref: `ref-${assetType}`,
    display_name: `Asset ${assetType}`,
  };
  assert.doesNotThrow(() => _testingResourceApiService.requireAssetInput(input));
  assert.equal(input.asset_type, assetType);
}

assert.equal(requireWorkspaceAssetType("document"), "doc");
const legacyDocumentInput = {
  asset_type: "document",
  asset_ref: "legacy-document-ref",
  display_name: "Legacy document",
};
assert.doesNotThrow(() => _testingResourceApiService.requireAssetInput(legacyDocumentInput));
assert.equal(legacyDocumentInput.asset_type, "doc");

assert.throws(
  () => requireWorkspaceAssetType("url"),
  (error) => error?.code === "workspace_asset_type_invalid"
    && error?.status === 400
    && Array.isArray(error?.details?.allowed_asset_types)
    && error.details.allowed_asset_types.includes("external_ref")
    && !error.details.allowed_asset_types.includes("url"),
);

assert.throws(
  () => _testingResourceApiService.requireAssetInput({
    asset_type: "url",
    asset_ref: "https://example.test",
    display_name: "Invalid URL type",
  }),
  (error) => error?.code === "workspace_asset_type_invalid" && error?.status === 400,
);

assert.throws(
  () => _testingResourceApiService.requireAssetInput({ asset_type: "doc", display_name: "Missing ref" }),
  (error) => error?.code === "asset_fields_required" && error?.status === 400,
);

console.log("workspace asset type contract tests passed");
