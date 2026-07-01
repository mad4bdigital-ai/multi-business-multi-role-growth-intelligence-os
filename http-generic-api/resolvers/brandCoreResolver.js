import {
  brandRowMatchesReference,
  extractGoogleFileId,
  resolveBrandReference,
} from './brandReferenceResolver.js';

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeKey(value) {
  return stringValue(value).toLowerCase();
}

function isTrueish(value) {
  const s = normalizeKey(value);
  return s === 'true' || s === 'yes' || s === '1';
}

function isFalseish(value) {
  const s = normalizeKey(value);
  return s === 'false' || s === 'no' || s === '0';
}

function isActiveStatus(value) {
  const s = normalizeKey(value);
  return s === 'active' || s === 'validated' || s === 'ready' || isTrueish(value);
}

function resolveBrandCoreStatus(coreRows, brandCoreRequired) {
  if (!brandCoreRequired) return 'not_required';
  if (coreRows.length === 0) return 'missing';
  const allActive = coreRows.every((row) =>
    isActiveStatus(row.status || row.core_status || row.validation_status || row.active_status)
  );
  return allActive ? 'ready' : 'validating';
}

function rowDocKey(row = {}) {
  return stringValue(
    row.doc_key ||
    row.core_doc_key ||
    row.asset_key ||
    row.asset_type ||
    row.doc_type ||
    row.document_name
  );
}

function rowDocId(row = {}) {
  return stringValue(
    row.doc_id ||
    row.file_id ||
    row.google_doc_id ||
    extractGoogleFileId(row.google_drive_link)
  );
}

function buildBrandCoreDocs(coreRows) {
  return coreRows.reduce((acc, row) => {
    const docKey = rowDocKey(row);
    const docId = rowDocId(row);
    if (docKey && docId) acc[docKey] = docId;
    return acc;
  }, {});
}

function buildBrandCoreAssets(coreRows) {
  return coreRows.map((row) => ({
    asset_key: rowDocKey(row),
    asset_type: stringValue(row.asset_type || row.doc_type),
    document_name: stringValue(row.document_name),
    doc_id: rowDocId(row),
    google_drive_link: stringValue(row.google_drive_link),
    status: stringValue(row.status || row.validation_status || row.active_status),
    priority: stringValue(row.read_priority || row.priority),
  }));
}

function coreRowMatchesBrand(row, brandKey, brandRow) {
  const canonicalKey = stringValue(brandRow?.target_key || brandRow?.brand_key);
  const canonicalName = stringValue(brandRow?.brand_name || brandRow?.normalized_brand_name);
  return (
    brandRowMatchesReference(row, brandKey) ||
    (canonicalKey && brandRowMatchesReference(row, canonicalKey)) ||
    (canonicalName && brandRowMatchesReference(row, canonicalName))
  );
}

export function resolveBrandCore({ brandKey, brandRegistryRows, brandCoreRegistryRows = [] }) {
  if (!stringValue(brandKey)) {
    throw new Error('Missing required brandKey');
  }
  if (!Array.isArray(brandRegistryRows)) {
    throw new Error('brandRegistryRows must be an array');
  }

  const brandResolution = resolveBrandReference({ reference: brandKey, rows: brandRegistryRows });
  const brandRow = brandResolution.row;

  if (!brandRow) {
    return {
      brandKey,
      resolutionStatus: brandResolution.status,
      candidateKeys: brandResolution.candidate_keys || [],
      brandCoreRequired: false,
      contentReady: false,
      strategyReady: false
    };
  }

  const coreRows = brandCoreRegistryRows.filter((row) =>
    coreRowMatchesBrand(row, brandKey, brandRow)
  );

  const brandCoreRequiredRaw = brandRow.brand_core_required ?? brandRow.requires_brand_core ?? 'true';
  const brandCoreRequired = !isFalseish(brandCoreRequiredRaw);
  const isReadable = !isFalseish(brandRow.is_readable ?? brandRow.readable ?? 'true');
  const isWritable = isTrueish(brandRow.is_writable ?? brandRow.writable ?? 'false');

  const brandCoreStatus = resolveBrandCoreStatus(coreRows, brandCoreRequired);
  const brandCoreDocs = buildBrandCoreDocs(coreRows);
  const brandCoreAssets = buildBrandCoreAssets(coreRows);

  const contentReady = brandCoreStatus === 'ready' || !brandCoreRequired;
  const strategyReady = brandCoreStatus === 'ready' && isReadable;

  return {
    brandKey: stringValue(brandRow.brand_key || brandRow.target_key),
    brandName: stringValue(brandRow.brand_name || brandRow.normalized_brand_name),
    businessTypeKey: stringValue(brandRow.business_type_key),
    knowledgeProfileKey: stringValue(brandRow.knowledge_profile_key),
    targetKey: stringValue(brandRow.target_key),
    baseUrl: stringValue(brandRow.base_url || brandRow.site_url),
    brandDomain: stringValue(brandRow.brand_domain),
    matchedReference: brandResolution.reference,
    brandCoreRequired,
    brandCoreStatus,
    brandCoreDocs,
    brandCoreAssets,
    coreRowCount: coreRows.length,
    isReadable,
    isWritable,
    contentReady,
    strategyReady,
    resolutionStatus: 'resolved'
  };
}
