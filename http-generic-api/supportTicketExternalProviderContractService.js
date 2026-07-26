import { getPool } from "./db.js";

function parseJsonObject(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeLimit(limit = 100) {
  return Math.min(Math.max(Number(limit) || 100, 1), 200);
}

function normalizeChannelKey(channel = null) {
  return channel == null ? null : String(channel).trim().toLowerCase();
}

function defaultExternalAdapterKeyForChannel(channel) {
  const key = normalizeChannelKey(channel || "email");
  if (key === "email") return "smtp_email_adapter";
  if (key === "webhook") return "generic_webhook_adapter";
  return null;
}

function normalizeAdapterKey({ adapter_key = null, provider_key = null, channel = "email" } = {}) {
  const explicit = adapter_key || provider_key;
  const key = explicit || defaultExternalAdapterKeyForChannel(channel);
  if (!key) {
    const err = new Error("External provider adapter key is required for this channel.");
    err.status = 400;
    err.code = "external_delivery_provider_adapter_key_required";
    throw err;
  }
  return String(key).trim();
}

function sanitizeModePolicy(row = {}) {
  return {
    policy_key: row.policy_key,
    adapter_key: row.adapter_key,
    mode_key: row.mode_key,
    mode_status: row.mode_status,
    approval_required: Boolean(row.approval_required),
    credential_required: Boolean(row.credential_required),
    final_approval_required: Boolean(row.final_approval_required),
    provider_dispatch_required: Boolean(row.provider_dispatch_required),
    external_send_performed_default: Boolean(row.external_send_performed_default),
    safety: parseJsonObject(row.safety_json, {}),
    notes: row.notes || null,
    status: row.status,
    external_send_performed: false,
    secret_value_included: false,
    secrets_included: false,
  };
}

function sanitizeAdapter(row = {}) {
  return {
    adapter_key: row.adapter_key,
    provider_key: row.adapter_key,
    family_key: row.family_key,
    channel: row.channel,
    implementation_status: row.implementation_status,
    dispatch_enabled: Boolean(row.dispatch_enabled),
    provider_dispatch_enabled: Boolean(row.provider_dispatch_enabled),
    required_credential_type: row.required_credential_type || null,
    supported_audiences: parseJsonObject(row.supported_audiences_json, []),
    send_modes: parseJsonObject(row.send_modes_json, []),
    payload_schema: parseJsonObject(row.payload_schema_json, {}),
    preflight_schema: parseJsonObject(row.preflight_schema_json, {}),
    rate_limit: parseJsonObject(row.rate_limit_json, {}),
    retry_policy: parseJsonObject(row.retry_policy_json, {}),
    idempotency_policy: parseJsonObject(row.idempotency_policy_json, {}),
    readback_policy: parseJsonObject(row.readback_policy_json, {}),
    audit_policy: parseJsonObject(row.audit_policy_json, {}),
    safety: parseJsonObject(row.safety_json, {}),
    status: row.status,
    external_send_performed: false,
    secret_value_included: false,
    secrets_included: false,
  };
}

async function fetchModePolicies(connection, adapterKeys) {
  if (!adapterKeys.length) return [];
  const placeholders = adapterKeys.map(() => "?").join(",");
  const [modeRows] = await connection.query(
    `SELECT policy_key, adapter_key, mode_key, mode_status, approval_required,
            credential_required, final_approval_required, provider_dispatch_required,
            external_send_performed_default, safety_json, notes, status
       FROM external_delivery_provider_send_mode_policy_registry
      WHERE adapter_key IN (${placeholders})
      ORDER BY adapter_key ASC, mode_key ASC`,
    adapterKeys
  );
  return modeRows.map(sanitizeModePolicy);
}

export async function resolveSupportTicketExternalProviderAdapterContract({ adapter_key = null, provider_key = null, channel = "email", send_mode = "dry_run" } = {}, options = {}) {
  const adapterKey = normalizeAdapterKey({ adapter_key, provider_key, channel });
  const normalizedChannel = normalizeChannelKey(channel);
  const normalizedSendMode = String(send_mode || "dry_run").trim().toLowerCase();
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    const filters = ["adapter_key = ?"];
    const params = [adapterKey];
    if (normalizedChannel) { filters.push("channel = ?"); params.push(normalizedChannel); }
    const [rows] = await connection.query(
      `SELECT adapter_key, family_key, channel, implementation_status, dispatch_enabled,
              provider_dispatch_enabled, required_credential_type, supported_audiences_json,
              send_modes_json, payload_schema_json, preflight_schema_json, rate_limit_json,
              retry_policy_json, idempotency_policy_json, readback_policy_json, audit_policy_json,
              safety_json, status, created_at, updated_at
         FROM external_delivery_provider_adapter_contract_registry
        WHERE ${filters.join(" AND ")}
        LIMIT 1`,
      params
    );
    const row = rows[0] || null;
    if (!row) {
      const err = new Error("External provider adapter contract was not found in the registry.");
      err.status = 404;
      err.code = "external_delivery_provider_adapter_contract_not_found";
      err.adapter_key = adapterKey;
      err.channel = normalizedChannel;
      throw err;
    }

    const adapter = sanitizeAdapter(row);
    const modePolicies = await fetchModePolicies(connection, [adapter.adapter_key]);
    const sendModePolicy = modePolicies.find((mode) => mode.mode_key === normalizedSendMode) || null;
    return {
      ok: true,
      mode: "read_only",
      source: "external_delivery_provider_adapter_contract_registry",
      adapter_contract: { ...adapter, mode_policies: modePolicies },
      send_mode: normalizedSendMode,
      send_mode_policy: sendModePolicy,
      send_mode_allowed: Boolean(sendModePolicy && sendModePolicy.status === "active"),
      external_send_performed: false,
      secret_value_included: false,
      secrets_included: false,
    };
  } finally { if (ownsConnection) connection.release(); }
}

export async function listSupportTicketExternalProviderContracts({ family_key = null, channel = null, include_disabled = true, limit = 100 } = {}, options = {}) {
  const pool = options.pool || getPool();
  const connection = options.connection || await pool.getConnection();
  const ownsConnection = !options.connection;
  try {
    const max = normalizeLimit(limit);
    const familyWhere = [];
    const familyParams = [];
    if (family_key) { familyWhere.push("family_key = ?"); familyParams.push(family_key); }
    if (channel) { familyWhere.push("channel = ?"); familyParams.push(channel); }
    if (!include_disabled) familyWhere.push("status = 'active'");
    const [families] = await connection.query(
      `SELECT family_key, display_name, channel, delivery_scope, status, dispatch_default_enabled,
              external_send_supported, description, safety_json, created_at, updated_at
         FROM external_delivery_provider_family_registry
        ${familyWhere.length ? `WHERE ${familyWhere.join(" AND ")}` : ""}
        ORDER BY sort_order ASC, family_key ASC
        LIMIT ?`,
      [...familyParams, max]
    );

    const adapterWhere = [];
    const adapterParams = [];
    if (family_key) { adapterWhere.push("family_key = ?"); adapterParams.push(family_key); }
    if (channel) { adapterWhere.push("channel = ?"); adapterParams.push(channel); }
    if (!include_disabled) adapterWhere.push("status = 'active'");
    const [adapterRows] = await connection.query(
      `SELECT adapter_key, family_key, channel, implementation_status, dispatch_enabled,
              provider_dispatch_enabled, required_credential_type, supported_audiences_json,
              send_modes_json, payload_schema_json, preflight_schema_json, rate_limit_json,
              retry_policy_json, idempotency_policy_json, readback_policy_json, audit_policy_json,
              safety_json, status, created_at, updated_at
         FROM external_delivery_provider_adapter_contract_registry
        ${adapterWhere.length ? `WHERE ${adapterWhere.join(" AND ")}` : ""}
        ORDER BY family_key ASC, adapter_key ASC
        LIMIT ?`,
      [...adapterParams, max]
    );

    const adapterKeys = adapterRows.map((row) => row.adapter_key);
    const modes = await fetchModePolicies(connection, adapterKeys);

    const adapters = adapterRows.map(sanitizeAdapter).map((adapter) => ({
      ...adapter,
      mode_policies: modes.filter((mode) => mode.adapter_key === adapter.adapter_key),
    }));

    const familiesOut = families.map((row) => ({
      family_key: row.family_key,
      display_name: row.display_name,
      channel: row.channel,
      delivery_scope: row.delivery_scope,
      status: row.status,
      dispatch_default_enabled: Boolean(row.dispatch_default_enabled),
      external_send_supported: Boolean(row.external_send_supported),
      description: row.description,
      safety: parseJsonObject(row.safety_json, {}),
      adapters: adapters.filter((adapter) => adapter.family_key === row.family_key),
      external_send_performed: false,
      secrets_included: false,
    }));

    return {
      ok: true,
      mode: "read_only",
      family_count: familiesOut.length,
      adapter_count: adapters.length,
      mode_policy_count: modes.length,
      families: familiesOut,
      external_send_performed: false,
      secret_value_included: false,
      secrets_included: false,
    };
  } finally { if (ownsConnection) connection.release(); }
}
