// Version fence for signed Local Connector installer capabilities.
// A token issued before credential rotation cannot access a new connector identity.
import { createHmac, timingSafeEqual } from "node:crypto";
import { getPool } from "./db.js";

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  error.status = 409;
  return error;
}

function text(value) { return String(value ?? "").trim(); }

export function deriveInstallerCredentialEpoch(config = {}, { secret = process.env.BACKEND_API_KEY } = {}) {
  const parts = ["config_id", "user_id", "tenant_id", "device_id", "connector_secret", "cf_token"]
    .map(key => text(config[key]));
  if (!text(secret) || parts.some(part => !part)) {
    throw failure("installer_credential_epoch_unavailable",
      "The device credential binding cannot be verified. Re-enroll or provision the canonical device.");
  }
  const mac = createHmac("sha256", text(secret));
  mac.update("mad4b.installer.credential-epoch.v1\0");
  for (const part of parts) {
    mac.update(String(Buffer.byteLength(part, "utf8")) + ":" + part);
  }
  return mac.digest("hex");
}

export function compareInstallerCredentialEpoch(actual, expected) {
  if (!/^[0-9a-f]{64}$/i.test(String(actual || "")) ||
      !/^[0-9a-f]{64}$/i.test(String(expected || ""))) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

export async function currentInstallerCredentialEpoch({ config_id, user_id, tenant_id, device_id, pool = getPool() }) {
  if (![config_id, user_id, tenant_id, device_id].every(v => text(v))) {
    throw failure("installer_credential_scope_incomplete",
      "Installer capability is missing its exact canonical device scope.");
  }
  const [rows] = await pool.query(
    `SELECT config_id, user_id, tenant_id, device_id, connector_secret, cf_token
       FROM local_connector_user_configs
      WHERE config_id = ? AND user_id = ? AND tenant_id = ? AND device_id = ?
        AND is_enabled = 1 AND lifecycle_state = 'active'
        AND revoked_at IS NULL AND archived_at IS NULL LIMIT 2`,
    [config_id, user_id, tenant_id, device_id]
  );
  if (rows.length !== 1) throw failure("installer_device_identity_changed",
    "The installer target is missing, revoked or ambiguous.");
  return deriveInstallerCredentialEpoch(rows[0]);
}

export async function assertCurrentInstallerCredentialEpoch(payload, options = {}) {
  const actual = await currentInstallerCredentialEpoch({
    config_id: payload?.config_id, user_id: payload?.user_id,
    tenant_id: payload?.tenant_id, device_id: payload?.device_id, ...options,
  });
  if (!compareInstallerCredentialEpoch(actual, payload?.credential_epoch)) {
    throw failure("installer_credential_epoch_changed",
      "This installer authorization predates the current device credentials. Request a new signed installer.");
  }
  return { ok: true, secrets_included: false };
}
