import { getPool } from "./db.js";

function str(v) {
  return v == null ? "" : String(v);
}

async function query(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return rows;
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

async function loadBrandRows(req) {
  const keys = [req.brandKey, req.targetKey].filter(Boolean);
  if (!keys.length) return [];
  const placeholders = keys.map(() => "?").join(", ");
  const rows = await query(
    `SELECT * FROM \`brands\` WHERE target_key IN (${placeholders}) OR normalized_brand_name IN (${placeholders})`,
    [...keys, ...keys]
  );
  return rows.map(r => ({
    brand_key: str(r.target_key),
    brand_name: str(r.brand_name),
    normalized_brand_name: str(r.normalized_brand_name),
    business_type_key: str(r.business_type_key),
    knowledge_profile_key: str(r.knowledge_profile_key),
    brand_folder_id: str(r.brand_folder_id),
    target_key: str(r.target_key),
    base_url: str(r.base_url),
    website_url: str(r.base_url),
    brand_domain: str(r.brand_domain),
    status: str(r.status),
  }));
}

async function loadBrandPathRows(req) {
  const keys = [req.brandKey, req.targetKey].filter(Boolean);
  if (!keys.length) return [];
  const placeholders = keys.map(() => "?").join(", ");
  const rows = await query(
    `SELECT * FROM \`brand_paths\` WHERE brand_key IN (${placeholders}) OR target_key IN (${placeholders})`,
    [...keys, ...keys]
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

async function loadBrandCoreRows(req) {
  const keys = [req.brandKey, req.targetKey].filter(Boolean);
  if (!keys.length) return [];
  const placeholders = keys.map(() => "?").join(", ");
  const rows = await query(
    `SELECT * FROM \`brand_core\` WHERE brand_key IN (${placeholders})`,
    keys
  );
  return rows.map(r => ({
    brand_key: str(r.brand_key),
    asset_key: str(r.asset_key),
    doc_key: str(r.doc_key || r.asset_key),
    doc_id: str(r.doc_id),
    file_id: str(r.doc_id),
    google_doc_id: str(r.doc_id),
    brand_core_docs_json: str(r.brand_core_docs_json),
    status: str(r.status),
  }));
}

async function loadTargetRows(req) {
  const keys = [req.targetKey, req.brandKey].filter(Boolean);
  if (!keys.length) return [];
  const placeholders = keys.map(() => "?").join(", ");
  const rows = await query(
    `SELECT * FROM \`brands\` WHERE target_key IN (${placeholders}) OR normalized_brand_name IN (${placeholders})`,
    [...keys, ...keys]
  );
  return rows.map(r => ({
    target_key: str(r.target_key),
    brand_key: str(r.target_key),
    base_url: str(r.base_url),
    brand_domain: str(r.brand_domain),
    provider: str(r.transport_action_key),
    auth_status: str(r.auth_validation_status || r.auth_type),
    validation_state: str(r.resolver_status),
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
  const [businessActivityRows, profileRows, brandRows, brandPathRows, brandCoreRows, targetRows, validationRows] =
    await Promise.all([
      loadBusinessActivityRows(loadRequest).catch(() => []),
      loadProfileRows(loadRequest).catch(() => []),
      loadBrandRows(loadRequest).catch(() => []),
      loadBrandPathRows(loadRequest).catch(() => []),
      loadBrandCoreRows(loadRequest).catch(() => []),
      loadTargetRows(loadRequest).catch(() => []),
      loadValidationRows(loadRequest).catch(() => []),
    ]);

  return {
    requested: true,
    loaded: true,
    reason: "loaded_from_db",
    load_request: loadRequest,
    rows: {
      businessActivityRows,
      profileRows,
      brandRows,
      brandPathRows,
      brandCoreRows,
      targetRows,
      validationRows,
    },
  };
}
