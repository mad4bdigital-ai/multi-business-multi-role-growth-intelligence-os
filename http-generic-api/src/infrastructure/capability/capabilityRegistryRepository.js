export class CapabilityRegistryRepository {
  constructor(pool) {
    if (!pool || typeof pool.query !== "function") throw new TypeError("CapabilityRegistryRepository requires a SQL pool.");
    this.pool = pool;
  }

  async listCanonicalCapabilities({ limit = 500 } = {}) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 500, 1000));
    const [rows] = await this.pool.query(
      `SELECT canonical_capability_id AS id, capability_key AS \`key\`, display_name, risk_level, effect,
              state_changing, credential_policy_id, device_policy_id, approval_policy_id, smoke_policy_id,
              status, policy_version, created_at, updated_at
         FROM canonical_capabilities
        ORDER BY capability_key
        LIMIT ?`,
      [safeLimit]
    );
    return rows || [];
  }

  async listAliases({ limit = 1000 } = {}) {
    const safeLimit = Math.max(1, Math.min(Number(limit) || 1000, 2000));
    const [rows] = await this.pool.query(
      `SELECT alias_id AS id, selector_type, selector_value, canonical_capability_id, surface,
              surface_restriction_policy_id, status, registry_version, created_at, updated_at
         FROM capability_aliases
        ORDER BY selector_type, selector_value, surface
        LIMIT ?`,
      [safeLimit]
    );
    return rows || [];
  }

  async integrityFindings() {
    const [rows] = await this.pool.query(
      `SELECT finding_code, selector_type, selector_value, canonical_capability_id,
              affected_rows, details_json
         FROM v_capability_alias_integrity
        ORDER BY finding_code, selector_type, selector_value`
    );
    return rows || [];
  }
}
