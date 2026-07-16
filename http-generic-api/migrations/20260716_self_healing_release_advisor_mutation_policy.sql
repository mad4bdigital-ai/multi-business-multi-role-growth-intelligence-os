-- Declare the internal mutation governance contract for advisory run creation.
-- This update changes tool-dispatch metadata only. It does not execute a recommendation or call a provider.

UPDATE admin_platform_endpoint_tools
SET tags = CONCAT_WS(',',
      NULLIF(tags, ''),
      IF(FIND_IN_SET('mutation_policy_required', tags) = 0, 'mutation_policy_required', NULL),
      IF(FIND_IN_SET('capability_envelope', tags) = 0, 'capability_envelope', NULL),
      IF(FIND_IN_SET('approval_required', tags) = 0, 'approval_required', NULL),
      IF(FIND_IN_SET('readback', tags) = 0, 'readback', NULL),
      IF(FIND_IN_SET('same_cycle_readback', tags) = 0, 'same_cycle_readback', NULL)
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE tool_key = 'release_advisor_run_create';
