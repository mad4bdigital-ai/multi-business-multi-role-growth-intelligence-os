UPDATE `workflow_runtime_bindings`
SET
  `input_schema_json` = JSON_OBJECT(
    'type', 'object',
    'required', JSON_ARRAY('text'),
    'properties', JSON_OBJECT(
      'text', JSON_OBJECT('type', 'string'),
      'max_bullets', JSON_OBJECT('type', 'number'),
      'max_chars', JSON_OBJECT('type', 'number'),
      'tenant_id', JSON_OBJECT('type', 'string'),
      'use_case', JSON_OBJECT('type', 'string')
    )
  ),
  `metadata_json` = JSON_SET(
    COALESCE(`metadata_json`, JSON_OBJECT()),
    '$.experiment', true,
    '$.production_replacement', false,
    '$.current_summary_path_unchanged', true,
    '$.experiment_policy', JSON_OBJECT(
      'enabled', true,
      'enforcement_mode', 'block_explicit_denied_use_cases',
      'allowed_use_cases', JSON_ARRAY('quick_preview', 'fallback_candidate', 'arabic_quick_preview', 'evaluation_note'),
      'blocked_use_cases', JSON_ARRAY('production_session_memory', 'canonical_summary_write', 'session_summary_autosweep', 'graph_memory_write', 'durable_session_memory'),
      'default_use_case', 'quick_preview',
      'promotion_status', 'not_promoted',
      'promotion_requires', JSON_ARRAY('manual_quality_review', 'larger_evaluation_batch', 'language_policy_decision'),
      'decision', 'Do not use as production canonical session summary path. Use only for explicit preview/fallback experiments.'
    )
  )
WHERE `binding_key` = 'summary_n8n_experiment_v1'
  AND `runtime_type` = 'n8n';
