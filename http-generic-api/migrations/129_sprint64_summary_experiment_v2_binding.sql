INSERT INTO `workflow_runtime_bindings`
  (`binding_key`, `workflow_key`, `runtime_type`, `task_class`, `tenant_id`,
   `n8n_workflow_id`, `n8n_webhook_path`, `n8n_webhook_url`, `execution_mode`,
   `auth_mode`, `credential_env_var`, `auth_header_name`, `input_schema_json`,
   `output_schema_json`, `timeout_ms`, `status`, `metadata_json`)
VALUES
  (
    'summary_n8n_experiment_v2',
    'summary_experiment_v2',
    'n8n',
    'summary',
    '4bc39fca-270e-4daa-b373-db75e1f36ccd',
    'q8cdjvI9pB2paLiZ',
    '/webhook/platform-summary-experiment-v2',
    'https://n8n.mad4b.com/webhook/platform-summary-experiment-v2',
    'sync',
    'bearer_env',
    'N8N_WEBHOOK_TOKEN',
    'Authorization',
    '{"type":"object","required":["text"],"properties":{"text":{"type":"string"},"max_bullets":{"type":"number"},"max_chars":{"type":"number"},"tenant_id":{"type":"string"},"use_case":{"type":"string"}}}',
    '{"type":"object","required":["summary","source"],"properties":{"summary":{"type":"string"},"bullets":{"type":"array","items":{"type":"string"}},"decisions":{"type":"array","items":{"type":"string"}},"blockers":{"type":"array","items":{"type":"string"}},"next_actions":{"type":"array","items":{"type":"string"}},"language":{"type":"string"},"source":{"type":"string"},"method":{"type":"string"},"experimental":{"type":"boolean"}}}',
    30000,
    'active',
    '{"seeded_by":"gpt_admin_assistant","experiment":true,"version":2,"production_replacement":false,"current_summary_path_unchanged":true,"n8n_device_id":"essam-pc","public_url":"https://n8n.mad4b.com/","security":"native n8n Header Auth + platform bearer_env","notes":"Experimental deterministic structured extractive summary workflow. Invoke only by explicit binding_key summary_n8n_experiment_v2.","experiment_policy":{"enabled":true,"enforcement_mode":"block_explicit_denied_use_cases","allowed_use_cases":["quick_preview","fallback_candidate","arabic_quick_preview","evaluation_note","v2_evaluation"],"blocked_use_cases":["production_session_memory","canonical_summary_write","session_summary_autosweep","graph_memory_write","durable_session_memory"],"default_use_case":"quick_preview","promotion_status":"not_promoted","promotion_requires":["manual_quality_review","larger_evaluation_batch","v1_v2_model_comparison"],"decision":"Do not use as production canonical session summary path. Use only for explicit preview/fallback experiments."}}'
  )
ON DUPLICATE KEY UPDATE
  `workflow_key` = VALUES(`workflow_key`),
  `runtime_type` = VALUES(`runtime_type`),
  `task_class` = VALUES(`task_class`),
  `tenant_id` = VALUES(`tenant_id`),
  `n8n_workflow_id` = VALUES(`n8n_workflow_id`),
  `n8n_webhook_path` = VALUES(`n8n_webhook_path`),
  `n8n_webhook_url` = VALUES(`n8n_webhook_url`),
  `execution_mode` = VALUES(`execution_mode`),
  `auth_mode` = VALUES(`auth_mode`),
  `credential_env_var` = VALUES(`credential_env_var`),
  `auth_header_name` = VALUES(`auth_header_name`),
  `input_schema_json` = VALUES(`input_schema_json`),
  `output_schema_json` = VALUES(`output_schema_json`),
  `timeout_ms` = VALUES(`timeout_ms`),
  `status` = VALUES(`status`),
  `metadata_json` = VALUES(`metadata_json`),
  `updated_at` = CURRENT_TIMESTAMP;
