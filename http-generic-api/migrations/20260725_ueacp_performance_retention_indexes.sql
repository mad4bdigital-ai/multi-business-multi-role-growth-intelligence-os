CREATE INDEX IF NOT EXISTS idx_ueacp_connected_systems_tenant_cursor
  ON connected_systems (tenant_id, system_id, status);

CREATE INDEX IF NOT EXISTS idx_ueacp_installations_system_tenant_state
  ON installations (system_id, tenant_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_ueacp_shadow_decisions_expires
  ON effective_authority_shadow_decisions (expires_at);
