-- Sprint 64: keep Codex runtime on the canonical connector device id and
-- resolve Local Manager hostname/device-token names through aliases.
--
-- Canonical device id: essam-pc
-- Local Manager / Windows hostname aliases: ESSAM, Essam

UPDATE `dev_agent_runtime_registry`
SET `device_id` = 'essam-pc',
    `notes` = CONCAT(
      COALESCE(`notes`, ''),
      '\n2026-05-26: canonicalized Codex Local Manager runtime device_id to essam-pc; Local Manager token hostnames such as ESSAM must resolve through local_connector_device_aliases.'
    ),
    `updated_at` = NOW()
WHERE `runtime_key` = 'codex_essam_chatgpt_v1';

INSERT INTO `local_connector_device_aliases`
  (`alias_device_id`, `canonical_device_id`, `canonical_config_id`, `user_id`, `tenant_id`, `reason`, `status`, `created_at`, `updated_at`)
VALUES
  (
    'ESSAM',
    'essam-pc',
    '8db63b00-4fce-11f1-b256-614c56cd019b',
    'f242960c-2857-4b4d-a504-ee50f8a278b4',
    '00000000-0000-4000-a000-000000000001',
    'Local Manager Windows hostname/device-token alias for canonical connector device essam-pc.',
    'active',
    NOW(),
    NOW()
  ),
  (
    'Essam',
    'essam-pc',
    '8db63b00-4fce-11f1-b256-614c56cd019b',
    'f242960c-2857-4b4d-a504-ee50f8a278b4',
    '00000000-0000-4000-a000-000000000001',
    'Case-preserving Local Manager hostname alias for canonical connector device essam-pc.',
    'active',
    NOW(),
    NOW()
  )
ON DUPLICATE KEY UPDATE
  `canonical_device_id` = VALUES(`canonical_device_id`),
  `canonical_config_id` = COALESCE(VALUES(`canonical_config_id`), `canonical_config_id`),
  `reason` = VALUES(`reason`),
  `status` = 'active',
  `updated_at` = NOW();
