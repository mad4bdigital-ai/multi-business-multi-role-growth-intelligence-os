import { resolveBrandReference } from './brandReferenceResolver.js';

const CANONICAL_BUSINESS_TYPE_ROOT =
  'Growth Intelligence OS - Knowledge Assets/Business Type Assets';

const LEGACY_PATH_MARKERS = [
  'Knowlege/Business-Type',
  'knowledge/business-activity-types',
  'GitHub',
  'github',
  'My Drive',
  '.md placeholder'
];

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeKey(value) {
  return stringValue(value).toLowerCase();
}

function isRegisteredProfileStatus(value) {
  const status = normalizeKey(value);
  return status === 'profile_registered' || status === 'active' || status === 'validated';
}

function hasLegacyMarker(value) {
  const text = stringValue(value);
  return LEGACY_PATH_MARKERS.some((marker) => text.includes(marker));
}

function isCanonicalBusinessTypePath(value) {
  return stringValue(value).startsWith(`${CANONICAL_BUSINESS_TYPE_ROOT}/`);
}

function isSharedDriveSurface(surfaceId) {
  return normalizeKey(surfaceId).includes('shared_drive_folder');
}

function scoreBusinessTypeProfileRow(row) {
  let score = 0;
  if (isRegisteredProfileStatus(row.profile_status)) score += 10;
  if (isCanonicalBusinessTypePath(row.business_type_specific_read_home)) score += 100;
  if (isSharedDriveSurface(row.authoritative_read_home)) score += 50;
  if (hasLegacyMarker(row.business_type_specific_read_home)) score -= 100;
  if (hasLegacyMarker(row.notes)) score -= 20;
  if (normalizeKey(row.notes).includes('final governed shared drive path')) score += 25;
  return score;
}

function assertNonEmpty(value, fieldName) {
  if (!stringValue(value)) {
    throw new Error(`Missing required ${fieldName}`);
  }
}

export function resolveBusinessTypePath({ businessTypeKey, profileRows }) {
  assertNonEmpty(businessTypeKey, 'businessTypeKey');
  if (!Array.isArray(profileRows)) {
    throw new Error('profileRows must be an array');
  }

  const targetKey = normalizeKey(businessTypeKey);
  const candidates = profileRows
    .filter((row) => normalizeKey(row.business_type) === targetKey)
    .filter((row) => isRegisteredProfileStatus(row.profile_status))
    .map((row) => ({
      row,
      score: scoreBusinessTypeProfileRow(row)
    }))
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    throw new Error(`No registered Business Type profile found for ${businessTypeKey}`);
  }

  const selected = candidates[0].row;
  const folderPath = stringValue(selected.business_type_specific_read_home);

  if (!isCanonicalBusinessTypePath(folderPath)) {
    throw new Error(
      `Business Type ${businessTypeKey} resolved to non-canonical path: ${folderPath}`
    );
  }

  return {
    businessTypeKey: selected.business_type,
    knowledgeProfileKey: selected.knowledge_profile_key,
    authoritativeReadHome: selected.authoritative_read_home,
    folderPath,
    sharedKnowledgeReadHome: selected.shared_knowledge_read_home,
    compatibleRouteKeys: selected.compatible_route_keys,
    compatibleWorkflows: selected.compatible_workflows,
    profileStatus: selected.profile_status
  };
}

export function buildBrandFolderPath({ businessTypeResolution, brandKey }) {
  if (!businessTypeResolution || typeof businessTypeResolution !== 'object') {
    throw new Error('businessTypeResolution is required');
  }
  assertNonEmpty(businessTypeResolution.folderPath, 'businessTypeResolution.folderPath');
  assertNonEmpty(brandKey, 'brandKey');

  const normalizedBrandKey = normalizeKey(brandKey).replace(/[^a-z0-9_-]/g, '_');
  if (!normalizedBrandKey) {
    throw new Error('brandKey did not produce a valid normalized key');
  }

  return {
    businessTypeKey: businessTypeResolution.businessTypeKey,
    knowledgeProfileKey: businessTypeResolution.knowledgeProfileKey,
    brandsFolderPath: `${businessTypeResolution.folderPath}/brands`,
    brandFolderPath: `${businessTypeResolution.folderPath}/brands/${normalizedBrandKey}`,
    brandKey: normalizedBrandKey
  };
}

export function resolveBrandPath({ brandKey, brandPathRows, businessTypeResolution }) {
  assertNonEmpty(brandKey, 'brandKey');
  if (!Array.isArray(brandPathRows)) {
    throw new Error('brandPathRows must be an array');
  }

  const resolution = resolveBrandReference({ reference: brandKey, rows: brandPathRows });
  const row = resolution.row;

  if (!row) {
    return {
      ...buildBrandFolderPath({ businessTypeResolution, brandKey }),
      resolutionStatus: resolution.status === 'ambiguous' ? 'ambiguous' : 'planned',
      candidateKeys: resolution.candidate_keys || [],
      pathReady: false
    };
  }

  const brandFolderPath = stringValue(row.brand_folder_path);
  if (!brandFolderPath) {
    return {
      brandKey: row.brand_key || row.target_key,
      normalizedBrandName: row.normalized_brand_name,
      businessTypeKey: row.business_type_key || businessTypeResolution.businessTypeKey,
      knowledgeProfileKey: row.knowledge_profile_key || businessTypeResolution.knowledgeProfileKey,
      brandFolderId: row.brand_folder_id,
      brandFolderPath: '',
      brandCoreDocsJson: row.brand_core_docs_json,
      targetKey: row.target_key,
      baseUrl: row.base_url,
      resolutionStatus: 'validating',
      pathReady: false
    };
  }
  if (!brandFolderPath.includes('/brands/')) {
    throw new Error(`Brand ${brandKey} is not stored under a business type brands folder`);
  }
  if (!isCanonicalBusinessTypePath(brandFolderPath)) {
    throw new Error(`Brand ${brandKey} resolved to non-canonical path: ${brandFolderPath}`);
  }

  return {
    brandKey: row.brand_key,
    normalizedBrandName: row.normalized_brand_name,
    businessTypeKey: row.business_type_key,
    knowledgeProfileKey: row.knowledge_profile_key,
    brandFolderId: row.brand_folder_id,
    brandFolderPath,
    brandCoreDocsJson: row.brand_core_docs_json,
    targetKey: row.target_key,
    baseUrl: row.base_url,
    resolutionStatus: row.status || 'resolved',
    pathReady: true
  };
}

export function validateBusinessTypeCompletionGate(record) {
  const required = [
    'business_type_key',
    'knowledge_profile_key',
    'folder_id',
    'folder_path',
    'json_asset_id',
    'validation_status'
  ];
  for (const field of required) {
    assertNonEmpty(record?.[field], field);
  }
  if (!isCanonicalBusinessTypePath(record.folder_path)) {
    throw new Error(`Invalid canonical Business Type folder path: ${record.folder_path}`);
  }
  if (normalizeKey(record.validation_status) !== 'validated') {
    throw new Error(`Business Type completion gate is not validated: ${record.validation_status}`);
  }
  return true;
}

export function validateBrandCompletionGate(record) {
  const required = [
    'brand_key',
    'business_type_key',
    'knowledge_profile_key',
    'brand_folder_id',
    'brand_folder_path',
    'json_asset_id',
    'validation_status'
  ];
  for (const field of required) {
    assertNonEmpty(record?.[field], field);
  }
  if (!isCanonicalBusinessTypePath(record.brand_folder_path)) {
    throw new Error(`Invalid canonical brand folder path: ${record.brand_folder_path}`);
  }
  if (!record.brand_folder_path.includes('/brands/')) {
    throw new Error(`Brand folder must be under the business type brands folder`);
  }
  if (normalizeKey(record.validation_status) !== 'validated') {
    throw new Error(`Brand completion gate is not validated: ${record.validation_status}`);
  }
  return true;
}

export { CANONICAL_BUSINESS_TYPE_ROOT, LEGACY_PATH_MARKERS };
