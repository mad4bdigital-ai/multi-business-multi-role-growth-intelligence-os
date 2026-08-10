export const WORKSPACE_ASSET_TYPES = Object.freeze([
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

const WORKSPACE_ASSET_TYPE_SET = new Set(WORKSPACE_ASSET_TYPES);

export function requireWorkspaceAssetType(value) {
  const assetType = String(value || "").trim();
  if (!WORKSPACE_ASSET_TYPE_SET.has(assetType)) {
    const error = new Error("asset_type is not supported by the canonical workspace_assets schema.");
    error.code = "workspace_asset_type_invalid";
    error.status = 400;
    error.details = { allowed_asset_types: WORKSPACE_ASSET_TYPES };
    throw error;
  }
  return assetType;
}

export const _testingWorkspaceAssetTypeContract = {
  WORKSPACE_ASSET_TYPE_SET,
};
