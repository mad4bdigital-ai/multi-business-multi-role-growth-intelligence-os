import { createHash } from "node:crypto";
import { getPool } from "../db.js";
import { encryptToken } from "../tokenEncryption.js";
import { writeAuditLogAsync } from "../auditLogger.js";

function sha256(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function promotionError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = 409;
  error.details = { ...details, secrets_included: false };
  return error;
}

export async function promoteCredentialIntakePlatformSecrets({ session, credentials = {}, metadata = {}, mappings = [], connectionId, req, context = {}, pool = getPool() } = {}) {
  const transaction = await pool.getConnection();
  const promoted = [];
  const { systemId = null, ownerId = "growth_intelligence_platform", providerFamily = null, connectorFamily = null, targetKey = null, promotionReason = "" } = context;
  try {
    await transaction.beginTransaction();
    for (const mapping of mappings) {
      const value = String(credentials[mapping.credential_field] || "").trim();
      const secretType = mapping.secret_type || mapping.credential_field;
      const hash = sha256(value);
      const [referenceRows] = await transaction.query(
        `SELECT ref_id FROM secret_references
          WHERE secret_key COLLATE utf8mb4_unicode_ci = CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci
            AND owner_type = 'platform' FOR UPDATE`,
        [mapping.secret_key]
      );
      if (referenceRows.length !== 1) {
        throw promotionError(referenceRows.length ? "platform_secret_reference_ambiguous" : "platform_secret_reference_missing", "Platform secret promotion requires exactly one governed platform secret reference.", { secret_key: mapping.secret_key, reference_count: referenceRows.length });
      }
      const metadataJson = JSON.stringify({ provisioning_status: "provisioned_pending_validation", stored_at: new Date().toISOString(), provider_family: providerFamily, connector_family: connectorFamily, credential_type: secretType, source: "credential_intake_auto_platform_secret_promotion", connection_id: connectionId, target_key: targetKey, promotion_reason: promotionReason });
      await transaction.query(
        `INSERT INTO platform_secrets
           (secret_key, secret_type, storage_backend, secret_ref, value_sha256, value_ciphertext, metadata_json, status, created_by)
         VALUES (?, ?, 'db_encrypted', NULL, ?, ?, ?, 'active', ?)
         ON DUPLICATE KEY UPDATE secret_type = VALUES(secret_type), storage_backend = 'db_encrypted', secret_ref = NULL,
           value_sha256 = VALUES(value_sha256), value_ciphertext = VALUES(value_ciphertext), metadata_json = VALUES(metadata_json), status = 'active', updated_at = CURRENT_TIMESTAMP`,
        [mapping.secret_key, secretType, hash, encryptToken(value), metadataJson, metadata.created_by || "credential_intake_auto_platform_secret_promotion"]
      );
      const [referenceUpdate] = await transaction.query(
        `UPDATE secret_references SET owner_type = 'platform', owner_id = ?, system_id = COALESCE(?, system_id),
           provider_family = COALESCE(?, provider_family), connector_family = COALESCE(?, connector_family), credential_type = ?,
           store_type = 'db_encrypted', env_var_name = NULL, vault_path = NULL, rotation_status = 'provisioned_pending_validation',
           validation_status = 'stored', last_validated_at = NULL, status = 'active'
         WHERE ref_id = ? AND owner_type = 'platform'`,
        [ownerId, systemId, providerFamily, connectorFamily, secretType, referenceRows[0].ref_id]
      );
      if (Number(referenceUpdate?.affectedRows || 0) !== 1) {
        throw promotionError("platform_secret_reference_update_failed", "Platform secret reference was not updated exactly once.", { secret_key: mapping.secret_key, affected_rows: Number(referenceUpdate?.affectedRows || 0) });
      }
      const [readbackRows] = await transaction.query(
        `SELECT
           (SELECT COUNT(*) FROM platform_secrets WHERE secret_key COLLATE utf8mb4_unicode_ci = CONVERT(? USING utf8mb4) COLLATE utf8mb4_unicode_ci
             AND status = 'active' AND storage_backend = 'db_encrypted' AND value_ciphertext IS NOT NULL AND value_sha256 = ?) AS platform_secret_rows,
           (SELECT COUNT(*) FROM secret_references WHERE ref_id = ? AND owner_type = 'platform' AND store_type = 'db_encrypted'
             AND rotation_status = 'provisioned_pending_validation' AND validation_status = 'stored' AND status = 'active'
             AND env_var_name IS NULL AND vault_path IS NULL) AS valid_reference_rows`,
        [mapping.secret_key, hash, referenceRows[0].ref_id]
      );
      const readback = readbackRows[0] || {};
      if (Number(readback.platform_secret_rows || 0) !== 1 || Number(readback.valid_reference_rows || 0) !== 1) {
        throw promotionError("platform_secret_promotion_invariant_failed", "Platform secret promotion readback invariant failed.", { secret_key: mapping.secret_key, platform_secret_rows: Number(readback.platform_secret_rows || 0), valid_reference_rows: Number(readback.valid_reference_rows || 0) });
      }
      promoted.push({ secret_key: mapping.secret_key, credential_field: mapping.credential_field, value_sha256: hash });
    }
    const [connectionUpdate] = await transaction.query(
      `UPDATE user_app_connections SET validation_status = 'promoted_to_platform_secrets', last_used_at = NOW()
        WHERE connection_id = ? AND user_id = ? AND tenant_id = ?`,
      [connectionId, session.user_id, session.tenant_id]
    );
    if (Number(connectionUpdate?.affectedRows || 0) !== 1) {
      throw promotionError("platform_secret_source_connection_update_failed", "Source credential connection was not marked promoted exactly once.", { connection_id: connectionId, affected_rows: Number(connectionUpdate?.affectedRows || 0) });
    }
    await transaction.commit();
  } catch (error) {
    try { await transaction.rollback(); } catch {}
    throw error;
  } finally {
    transaction.release();
  }
  writeAuditLogAsync({ tenant_id: session.tenant_id, actor_id: session.user_id, actor_type: "credential_intake_link", action: "credential_intake.platform_secrets_auto_promoted", resource_type: "user_app_connection", resource_id: connectionId, after_json: { system_id: systemId, owner_id: ownerId, target_key: targetKey, auth_type: session.auth_type, promoted_count: promoted.length, secret_keys: promoted.map((item) => item.secret_key), transaction_committed: true, invariant_readback_passed: true, secrets_included: false }, ip_address: req?.ip || null, user_agent: req?.headers?.["user-agent"] || null });
  return { ok: true, promoted_count: promoted.length, promoted, secrets_included: false };
}
