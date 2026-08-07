const SOURCE_TYPES = new Set(["manual", "import", "provider", "generated", "external"]);
const SENSITIVE_FRAGMENT = /(?:^|[?&#;,\s])(token|access[_-]?token|api[_-]?key|apikey|secret|password|signature|sig|x-amz-signature|x-goog-signature)=/i;
const AUTHORIZATION_FRAGMENT = /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/i;

function provenanceError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function normalize(value, max) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value).normalize("NFKC").trim();
  if (!normalized || normalized.length > max) {
    throw provenanceError(400, "workspace_asset_provenance_invalid", "Asset provenance field is invalid or exceeds its allowed length.");
  }
  return normalized;
}

function normalizeSourceType(value) {
  const normalized = String(value || "manual").trim().toLowerCase();
  if (!SOURCE_TYPES.has(normalized)) {
    throw provenanceError(
      400,
      "workspace_asset_source_type_invalid",
      "source_type must be one of manual, import, provider, generated, or external."
    );
  }
  return normalized;
}

function normalizeChecksum(value) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw provenanceError(
      400,
      "workspace_asset_checksum_invalid",
      "content_sha256 must be a 64-character hexadecimal SHA-256 digest."
    );
  }
  return normalized;
}

function normalizeSourceUri(value) {
  const normalized = normalize(value, 1024);
  if (!normalized) return null;
  if (SENSITIVE_FRAGMENT.test(normalized) || AUTHORIZATION_FRAGMENT.test(normalized)) {
    throw provenanceError(
      400,
      "workspace_asset_source_uri_sensitive",
      "source_uri must not contain credentials, access tokens, signatures, or authorization material."
    );
  }
  if (/^https?:\/\//i.test(normalized) && /[?#]/.test(normalized)) {
    throw provenanceError(
      400,
      "workspace_asset_source_uri_sensitive",
      "HTTP source_uri values must be stable credential-free locators without query strings or fragments."
    );
  }
  return normalized;
}

export function parseWorkspaceAssetMetadata(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return { ...value };
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function buildWorkspaceAssetProvenance(input = {}, {
  tenantId,
  brandRef,
  actorId,
  assetType,
  assetRef,
} = {}) {
  const metadata = parseWorkspaceAssetMetadata(input.metadata_json);
  const sourceType = normalizeSourceType(input.source_type ?? metadata.source_type ?? "manual");
  const sourceProvider = normalize(input.source_provider ?? metadata.source_provider, 128);
  const sourceUri = normalizeSourceUri(input.source_uri ?? metadata.source_uri);
  const sourceRevision = normalize(input.source_revision ?? metadata.source_revision, 255);
  const contentSha256 = normalizeChecksum(input.content_sha256 ?? metadata.content_sha256);
  const identity = contentSha256
    ? `sha256:${contentSha256}`
    : `asset_ref:${String(assetType)}:${String(assetRef)}`;

  return {
    schema_version: "workspace-asset-provenance-v1",
    source_type: sourceType,
    source_provider: sourceProvider,
    source_uri: sourceUri,
    source_revision: sourceRevision,
    content_sha256: contentSha256,
    content_identity: identity,
    ingestion_mode: ["import", "provider", "external"].includes(sourceType) ? "import" : "create",
    tenant_id: String(tenantId),
    brand_target_key: brandRef ? String(brandRef) : null,
    created_by_user_id: String(actorId || "platform_admin"),
    secrets_included: false,
  };
}

export function mergeWorkspaceAssetMetadata(value, provenance) {
  return {
    ...parseWorkspaceAssetMetadata(value),
    ...provenance,
    secrets_included: false,
  };
}

function sameWhenBothPresent(left, right) {
  if (left === undefined || left === null || left === "" || right === undefined || right === null || right === "") return true;
  return String(left).trim().toLowerCase() === String(right).trim().toLowerCase();
}

export function assertWorkspaceAssetIdentityCompatible(existing, expectedProvenance) {
  if (String(existing?.lifecycle_status || "").toLowerCase() === "deleted") {
    throw provenanceError(
      409,
      "workspace_asset_identity_deleted",
      "Asset identity already exists in deleted state and cannot be silently reactivated."
    );
  }

  const existingBrand = String(existing?.brand_ref || "").trim();
  const expectedBrand = String(expectedProvenance?.brand_target_key || "").trim();
  if (existingBrand !== expectedBrand) {
    throw provenanceError(
      409,
      "workspace_asset_identity_brand_conflict",
      "Asset identity already belongs to a different Brand scope."
    );
  }

  const metadata = parseWorkspaceAssetMetadata(existing?.metadata_json);
  if (metadata.brand_target_key && String(metadata.brand_target_key).trim() !== expectedBrand) {
    throw provenanceError(
      409,
      "workspace_asset_identity_brand_conflict",
      "Persisted Asset provenance points to a different Brand scope."
    );
  }
  if (!sameWhenBothPresent(metadata.source_type, expectedProvenance.source_type)
      || !sameWhenBothPresent(metadata.source_provider, expectedProvenance.source_provider)
      || !sameWhenBothPresent(metadata.source_uri, expectedProvenance.source_uri)
      || !sameWhenBothPresent(metadata.source_revision, expectedProvenance.source_revision)) {
    throw provenanceError(
      409,
      "workspace_asset_identity_provenance_conflict",
      "Asset identity already has incompatible source provenance."
    );
  }
  if (!sameWhenBothPresent(metadata.content_sha256, expectedProvenance.content_sha256)) {
    throw provenanceError(
      409,
      "workspace_asset_identity_checksum_conflict",
      "Asset identity already has a different content checksum."
    );
  }
  return metadata;
}

export function safeWorkspaceAssetProvenance(value) {
  const metadata = parseWorkspaceAssetMetadata(value);
  return {
    schema_version: metadata.schema_version || null,
    source_type: metadata.source_type || null,
    source_provider: metadata.source_provider || null,
    source_revision: metadata.source_revision || null,
    content_sha256: metadata.content_sha256 || null,
    content_identity: metadata.content_identity || null,
    ingestion_mode: metadata.ingestion_mode || null,
    source_locator_present: Boolean(metadata.source_uri),
    secrets_included: false,
  };
}

export const _testingWorkspaceAssetProvenance = {
  SOURCE_TYPES,
  normalizeSourceType,
  normalizeChecksum,
  normalizeSourceUri,
  sameWhenBothPresent,
};
