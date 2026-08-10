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
const WORKSPACE_ASSET_TYPE_ALIASES = new Map([
  ["document", "doc"],
]);

export function requireWorkspaceAssetType(value) {
  const requestedType = String(value || "").trim().toLowerCase();
  const assetType = WORKSPACE_ASSET_TYPE_ALIASES.get(requestedType) || requestedType;
  if (!WORKSPACE_ASSET_TYPE_SET.has(assetType)) {
    const error = new Error("asset_type is not supported by the canonical workspace_assets schema.");
    error.code = "workspace_asset_type_invalid";
    error.status = 400;
    error.details = {
      requested_asset_type: requestedType || null,
      allowed_asset_types: WORKSPACE_ASSET_TYPES,
      accepted_aliases: Object.fromEntries(WORKSPACE_ASSET_TYPE_ALIASES),
    };
    throw error;
  }
  return assetType;
}

export const _testingWorkspaceAssetTypeContract = {
  WORKSPACE_ASSET_TYPE_SET,
  WORKSPACE_ASSET_TYPE_ALIASES,
};
