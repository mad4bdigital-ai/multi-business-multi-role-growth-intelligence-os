-- Durable continuation storage for oversized governed tool responses.
-- Additive and backward-compatible: the existing in-process Map remains a hot cache.

CREATE TABLE IF NOT EXISTS governed_tool_response_chunks (
  chunk_id VARCHAR(64) NOT NULL,
  source_tool_key VARCHAR(191) NULL,
  response_sha256 CHAR(64) NOT NULL,
  response_bytes BIGINT UNSIGNED NOT NULL,
  response_json LONGTEXT NOT NULL,
  cursor_policy VARCHAR(64) NOT NULL DEFAULT 'utf16_code_unit_cursor_v1',
  redaction_status VARCHAR(64) NOT NULL DEFAULT 'redacted_or_non_secret',
  secrets_included TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (chunk_id),
  KEY idx_governed_tool_response_chunks_expires_at (expires_at),
  CONSTRAINT chk_governed_tool_response_chunks_no_secrets CHECK (secrets_included = 0),
  CONSTRAINT chk_governed_tool_response_chunks_sha256 CHECK (response_sha256 REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
