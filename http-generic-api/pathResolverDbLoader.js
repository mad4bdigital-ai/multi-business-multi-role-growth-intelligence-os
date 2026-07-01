import { getPool } from "./db.js";
import {
  brandHost,
  extractGoogleFileId,
  normalizeBrandReference,
  resolveBrandReference,
} from "./resolvers/brandReferenceResolver.js";

function str(v) {
  return v == null ? "" : String(v);
}

function lower(v) {
  return str(v).trim().toLowerCase();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

async function query(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

function brandNeedles(req = {}) {
  return unique([req.brandKey, req.targetKey].flatMap((value) => {
    const raw = lower(value);
    if (!raw) return [];
    return [
      raw,
      brandHost(raw),
      raw.replace(/[-_]+/g, " "),
      normalizeBrandReference(raw),
    ];
  }));
}

async function loadBusinessActivityRows(req) {
  const keys = [req.businessActivityTypeKey, req.businessTypeKey, req.knowledgeProfileKey].filter(Boolean);
  if (!keys.length) return [];
  const placeholders = keys.map(() => "?").join(", ");
  const rows = await query(
    `SELECT * FROM \`business_activity_types\` WHERE business_activity_type_key IN (${placeholders}) OR business_type_key IN (${placeholders})`,
    [...keys, ...keys]
  );
  return rows.map(r => ({
    business_activity_type_key: str(r.business_activity_type_key),
    business_type_key: str(r.business_type_key),
    activity_key: str(r.activity_key),
    label: str(r.label),
    parent_activity_type: str(r.parent_activity_type),
    default_knowledge_profile_key: str(r.default_knowledge_profile_key),
    supported_engine_categories: str(r.supported_engine_categories),
    supported_route_keys: str(r.supported_route_keys),
    supported_workflows: str(r.supported_workflows),
    brand_core_required: str(r.brand_core_required),
    status: str(r.status),
  }));
}

async function loadProfileRows(req) {
  const keys = [req.businessTypeKey, req.knowledgeProfileKey, req.businessActivityTypeKey].filter(Boolean);
  if (!keys.length) return [];
  const placeholders = keys.map(() => "?").join(", ");
  const rows = await query(
    `SELECT * FROM \`business_type_profiles\` WHERE business_type_key IN (${placeholders}) OR knowledge_profile_key IN (${placeholders})`,
    [...keys, ...keys]
  );
  return rows.map(r => ({
    business_type: str(r.business_type_key),
    knowledge_profile_key: str(r.knowledge_profile_key),
    supported_engine_categories: str(r.supported_engine_categories),
    authoritative_read_home: str(r.authoritative_read_home),
    business_type_specific_read_home: str(r.business_type_specific_read_home),
    shared_knowledge_read_home: str(r.shared_knowledge_read_home),
    compatible_route_keys: str(r.compatible_route_keys),
    compatible_workflows: str(r.compatible_workflows),
    profile_status: str(r.profile_status),
    notes: str(r.notes),
  }));
}

async function findBrandCandidates(req) {
  const needles = brandNeedles(req);
  if (!needles.length) return [];
  const clauses = needles.map(() => `LOWER(CONCAT_WS(' ', target_key, brand_name, normalized_brand_name, brand_domain, base_url, site_aliases_json)) LIKE ?`);
  const rows = await query(
    `SELECT * FROM \`brands\` WHERE ${clauses.join(" OR ")} ORDER BY id ASC LIMIT 50`,
    needles.map((value) => `%${value}%`)
  );
  return rows;
}

function mapBrandRow(r) {
  return {
    brand_key: str(r.target_key || r.brand_key),
    brand_name: str(r.brand_name),
    normalized_brand_name: str(r.normalized_brand_name),
    business_type_key: str(r.business_type_key),
    knowledge_profile_key: str(r.knowledge_profile_key),
    brand_folder_id: str(r.brand_folder_id),
    target_key: str(r.target_key),
    base_url: str(r.base_url),
    website_url: str(r.base_url),
    brand_domain: str(r.brand_domain),
    site_aliases_json: str(r.site_aliases_json),
    primary_site_key: str(r.primary_site_key),
    brand_core_required: str(r.brand_core_required || r.brand_core_ready),
    transport_action_key: str(r.transport_action_key),
    auth_type: str(r.auth_type),
    auth_validation_status: str(r.auth_validation_status),
    credential_resolution: str(r.credential_resolution),
    transport_enabled: str(r.transport_enabled),
    write_allowed: str(r.write_allowed),
    destructive_allowed: str(r.destructive_allowed),
    resolver_status: str(r.resolver_status),
    resolver_writeback_status: str(r.resolver_writeback_status),
    resolver_last_checked_at: str(r.resolver_last_checked_at),
    status: str(r.status),
  };
}

async function loadBrandRows(req) {
  const candidates = (await findBrandCandidates(req)).map(mapBrandRow);
  const references = unique([req.brandKey, req.targetKey]);
  const selected = [];
  for (const reference of references) {
    const resolution = resolveBrandReference({ reference, rows: candidates });
    if (resolution.status === "resolved" && resolution.row) selected.push(resolution.row);
  }
  return unique(selected.map((row) => row.target_key || row.brand_key))
    .map((key) => selected.find((row) => (row.target_key || row.brand_key) === key));
}

function canonicalBrandRefs(req, brandRows = []) {
  return unique([
    req.brandKey,
    req.targetKey,
    ...brandRows.flatMap((row) => [
      row.brand_key,
      row.target_key,
      row.brand_name,
      row.normalized_brand_name,
      row.brand_domain,
      brandHost(row.base_url),
    ]),
  ]);
}

async function loadBrandPathRows(req, brandRows = []) {
  const refs = canonicalBrandRefs(req, brandRows).map(lower).filter(Boolean);
  if (!refs.length) return [];
  const placeholders = refs.map(() => "?").join(", ");
  const rows = await query(
    `SELECT * FROM \`brand_paths\`
      WHERE LOWER(COALESCE(brand_key, '')) IN (${placeholders})
         OR LOWER(COALESCE(target_key, '')) IN (${placeholders})
         OR LOWER(COALESCE(normalized_brand_name, '')) IN (${placeholders})`,
    [...refs, ...refs, ...refs]
  );
  return rows.map(r => ({
    brand_key: str(r.brand_key),
    normalized_brand_name: str(r.normalized_brand_name),
    business_type_key: str(r.business_type_key),
    knowledge_profile_key: str(r.knowledge_profile_key),
    brand_folder_id: str(r.brand_folder_id),
    brand_folder_path: str(r.brand_folder_path),
    brand_core_docs_json: str(r.brand_core_docs_json),
    target_key: str(r.target_key),
    base_url: str(r.base_url),
    status: str(r.status),
  }));
}

async function loadBrandCoreRows(req, brandRows = []) {
  const refs = canonicalBrandRefs(req, brandRows).map(lower).filter(Boolean);
  if (!refs.length) return [];
  const placeholders = refs.map(() => "?").join(", ");
  const rows = await query(
    `SELECT * FROM \`brand_core\`
      WHERE LOWER(COALESCE(brand_key, '')) IN (${placeholders})
         OR LOWER(COALESCE(brand_name, '')) IN (${placeholders})`,
    [...refs, ...refs]
  );
  return rows.map(r => ({
    brand_key: str(r.brand_key),
    brand_name: str(r.brand_name),
    asset_key: str(r.asset_key),
    doc_key: str(r.doc_key || r.asset_key || r.asset_type),
    doc_id: str(r.doc_id || extractGoogleFileId(r.google_drive_link)),
    file_id: str(r.file_id || extractGoogleFileId(r.google_drive_link)),
    google_doc_id: str(r.google_doc_id || extractGoogleFileId(r.google_drive_link)),
    google_drive_link: str(r.google_drive_link),
    asset_type: str(r.asset_type),
    document_name: str(r.document_name),
    priority: str(r.priority),
    read_priority: str(r.read_priority),
    brand_core_docs_json: str(r.brand_core_docs_json),
    active_status: str(r.active_status),
    validation_status: str(r.validation_status),
    status: str(r.status || r.validation_status || r.active_status),
  }));
}

function loadTargetRowsFromBrands(brandRows = []) {
  return brandRows.map(r => ({
    target_key: str(r.target_key),
    brand_key: str(r.brand_key || r.target_key),
    base_url: str(r.base_url),
    brand_domain: str(r.brand_domain),
    provider: str(r.transport_action_key),
    auth_status: str(r.auth_validation_status || r.auth_type),
    validation_state: str(r.resolver_status),
    resolver_status: str(r.resolver_status),
    resolver_writeback_status: str(r.resolver_writeback_status),
    resolver_last_checked_at: str(r.resolver_last_checked_at),
    credential_resolution: str(r.credential_resolution),
    transport_enabled: str(r.transport_enabled),
    write_allowed: str(r.write_allowed),
    destructive_allowed: str(r.destructive_allowed),
    auth_type: str(r.auth_type),
    blocking_reason: str(r.resolver_writeback_status || r.resolver_status),
    status: str(r.status),
  }));
}

async function loadValidationRows(req) {
  const keys = [
    req.brandKey,
    req.targetKey,
    req.businessTypeKey,
    req.businessActivityTypeKey,
    req.knowledgeProfileKey,
    req.surfaceId,
    req.targetSurfaceId,
  ].filter(Boolean);

  if (!keys.length) return [];

  const placeholders = keys.map(() => "?").join(", ");
  const rows = await query(
    `SELECT *
       FROM \`validation_repair\`
      WHERE entity_key IN (${placeholders})
         OR validation_target IN (${placeholders})
         OR target_surface_id IN (${placeholders})
         OR surface_id IN (${placeholders})
      ORDER BY required_for_execution DESC, surface_id, validation_id`,
    [...keys, ...keys, ...keys, ...keys]
  );

  return rows.map(r => ({
    validation_id: str(r.validation_id),
    entity_key: str(r.entity_key),
    surface_id: str(r.surface_id),
    surface_name: str(r.surface_name),
    rule_id: str(r.rule_id),
    validation_target: str(r.validation_target),
    target_surface_id: str(r.target_surface_id),
    validation_type: str(r.validation_type),
    validation_method: str(r.validation_method),
    required_for_execution: str(r.required_for_execution),
    validation_status: str(r.validation_status),
    readiness_state: str(r.result_state || r.execution_readiness_status),
    result_state: str(r.result_state),
    repair_required: str(r.repair_required),
    repair_recommended: str(r.repair_recommended),
    repair_status: str(r.repair_status),
    status: str(r.validation_status || r.result_state),
    execution_readiness_status: str(r.execution_readiness_status),
    last_validated_at: str(r.last_validated_at),
    blocking_reason: str(r.blocking_reason),
    summary: str(r.summary),
    notes: str(r.notes),
  }));
}

export async function loadPathResolverRowsFromDb(loadRequest = {}) {
  const brandRows = await loadBrandRows(loadRequest).catch(() => []);
  const brandPathRows = await loadBrandPathRows(loadRequest, brandRows).catch(() => []);
  const inferred = brandPathRows[0] || brandRows[0] || {};
  const effectiveRequest = {
    ...loadRequest,
    brandKey: inferred.brand_key || inferred.target_key || loadRequest.brandKey,
    targetKey: inferred.target_key || inferred.brand_key || loadRequest.targetKey,
    businessTypeKey: loadRequest.businessTypeKey || inferred.business_type_key,
    knowledgeProfileKey: loadRequest.knowledgeProfileKey || inferred.knowledge_profile_key,
  };

  const [businessActivityRows, profileRows, brandCoreRows, validationRows] = await Promise.all([
    loadBusinessActivityRows(effectiveRequest).catch(() => []),
    loadProfileRows(effectiveRequest).catch(() => []),
    loadBrandCoreRows(effectiveRequest, brandRows).catch(() => []),
    loadValidationRows(effectiveRequest).catch(() => []),
  ]);

  return {
    requested: true,
    loaded: true,
    reason: "loaded_from_db",
    load_request: { ...loadRequest, resolved_brand_key: effectiveRequest.brandKey || "" },
    rows: {
      businessActivityRows,
      profileRows,
      brandRows,
      brandPathRows,
      brandCoreRows,
      targetRows: loadTargetRowsFromBrands(brandRows),
      validationRows,
    },
  };
}
