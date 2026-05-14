import { getPool } from "./db.js";

const _DATA_SOURCE = String(process.env.DATA_SOURCE || "").trim().toLowerCase() || "sheets";

export async function resolveKnowledgeSurfaces({ business_type_key = "", brand_key = "" } = {}) {
  if (_DATA_SOURCE === "sheets") return { surfaces: [], reason: "sheets_mode" };
  if (!business_type_key && !brand_key) return { surfaces: [], reason: "no_brand_context" };

  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT surface_id, surface_name, surface_type, file_id, folder_id,
            surface_scope, business_type_scope, runtime_consumption_status
     FROM platform_contract_surfaces
     WHERE runtime_consumption_status = 'knowledge_candidate_runtime_enforced'
       AND active_status = 'active'
       AND (
         business_type_scope IS NULL
         OR business_type_scope = ''
         OR FIND_IN_SET(?, business_type_scope) > 0
       )
     ORDER BY surface_name`,
    [business_type_key]
  );

  return {
    surfaces: rows.map(r => ({
      surface_id: r.surface_id,
      surface_name: r.surface_name,
      surface_type: r.surface_type,
      file_id: r.file_id || null,
      folder_id: r.folder_id || null,
      business_type_scope: r.business_type_scope || null
    })),
    reason: "resolved",
    business_type_key,
    brand_key
  };
}

export function isBrandOrBusinessTypeRequest(requestPayload = {}, governedContext = {}) {
  const brand = governedContext.brand || {};
  const pathRes = governedContext.path_resolution || {};
  const bizActivity = governedContext.business_activity || {};
  return Boolean(
    brand.required ||
    brand.brand_key ||
    requestPayload.brand_key ||
    requestPayload.brand_name ||
    requestPayload.target_key ||
    pathRes.business_type_key ||
    pathRes.businessType?.businessTypeKey ||
    bizActivity.requested
  );
}
