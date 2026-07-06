-- GitHub Actions diagnostics endpoint registry seed
-- Purpose: make PR CI diagnostics durable after adding runtime endpoints for workflow jobs and pending deployments.
-- Safety: endpoint definitions only; no provider execution, no secrets, no CI bypass.

INSERT INTO endpoints (
  endpoint_id,
  parent_action_key,
  endpoint_key,
  endpoint_operation,
  provider_domain,
  method,
  endpoint_path_or_function,
  module_binding,
  connector_family,
  status,
  spec_validation_status,
  auth_validation_status,
  privacy_validation_status,
  execution_readiness,
  endpoint_role,
  execution_mode,
  transport_required,
  transport_action_key,
  inventory_role,
  inventory_source,
  notes,
  schema_json
)
VALUES
(
  'ACT-GH-REST-JOBS-001',
  'github_api_mcp',
  'github_list_jobs_for_workflow_run',
  'listJobsForWorkflowRun',
  'https://api.github.com',
  'GET',
  '/repos/{owner}/{repo}/actions/runs/{run_id}/jobs',
  'github_com_connector',
  'github_com_connector',
  'active',
  'validated',
  'validated',
  'validated',
  'ready',
  'primary',
  'http_delegated',
  'TRUE',
  'http_generic_api',
  'endpoint_inventory',
  'official_rest_candidate',
  'Read-only GitHub Actions endpoint for listing jobs in one workflow run. Used to diagnose action_required or missing check-run states. No mutation and no secret response.',
  JSON_OBJECT(
    'operationId','listJobsForWorkflowRun',
    'summary','GitHub List Jobs For Workflow Run',
    'method','get',
    'path','/repos/{owner}/{repo}/actions/runs/{run_id}/jobs',
    'parameters',JSON_ARRAY(
      JSON_OBJECT('name','owner','in','path','required',true,'schema',JSON_OBJECT('type','string','pattern','^[A-Za-z0-9_.-]+$')),
      JSON_OBJECT('name','repo','in','path','required',true,'schema',JSON_OBJECT('type','string','pattern','^[A-Za-z0-9_.-]+$')),
      JSON_OBJECT('name','run_id','in','path','required',true,'schema',JSON_OBJECT('type','integer','minimum',1)),
      JSON_OBJECT('name','filter','in','query','required',false,'schema',JSON_OBJECT('type','string','enum',JSON_ARRAY('latest','all'))),
      JSON_OBJECT('name','page','in','query','required',false,'schema',JSON_OBJECT('type','integer','minimum',1)),
      JSON_OBJECT('name','per_page','in','query','required',false,'schema',JSON_OBJECT('type','integer','minimum',1,'maximum',100))
    ),
    'responses',JSON_OBJECT(
      '200',JSON_OBJECT('description','Successful response','content',JSON_OBJECT('application/json',JSON_OBJECT('schema',JSON_OBJECT('type','object','additionalProperties',true)))) ,
      '401',JSON_OBJECT('description','Authentication failed'),
      '403',JSON_OBJECT('description','Authorization failed'),
      '404',JSON_OBJECT('description','Repository or workflow run not found'),
      '422',JSON_OBJECT('description','Invalid request'),
      '429',JSON_OBJECT('description','Rate limited')
    )
  )
),
(
  'ACT-GH-REST-PENDING-DEPLOYMENTS-GET-001',
  'github_api_mcp',
  'github_get_pending_deployments_for_workflow_run',
  'getPendingDeploymentsForWorkflowRun',
  'https://api.github.com',
  'GET',
  '/repos/{owner}/{repo}/actions/runs/{run_id}/pending_deployments',
  'github_com_connector',
  'github_com_connector',
  'active',
  'validated',
  'validated',
  'validated',
  'ready',
  'primary',
  'http_delegated',
  'TRUE',
  'http_generic_api',
  'endpoint_inventory',
  'official_rest_candidate',
  'Read-only GitHub Actions endpoint for pending deployment environments waiting on protection rules. Used before any environment approval attempt. No mutation and no secret response.',
  JSON_OBJECT(
    'operationId','getPendingDeploymentsForWorkflowRun',
    'summary','GitHub Get Pending Deployments For Workflow Run',
    'method','get',
    'path','/repos/{owner}/{repo}/actions/runs/{run_id}/pending_deployments',
    'parameters',JSON_ARRAY(
      JSON_OBJECT('name','owner','in','path','required',true,'schema',JSON_OBJECT('type','string','pattern','^[A-Za-z0-9_.-]+$')),
      JSON_OBJECT('name','repo','in','path','required',true,'schema',JSON_OBJECT('type','string','pattern','^[A-Za-z0-9_.-]+$')),
      JSON_OBJECT('name','run_id','in','path','required',true,'schema',JSON_OBJECT('type','integer','minimum',1))
    ),
    'responses',JSON_OBJECT(
      '200',JSON_OBJECT('description','Successful response','content',JSON_OBJECT('application/json',JSON_OBJECT('schema',JSON_OBJECT('type','array','items',JSON_OBJECT('type','object','additionalProperties',true))))),
      '401',JSON_OBJECT('description','Authentication failed'),
      '403',JSON_OBJECT('description','Authorization failed'),
      '404',JSON_OBJECT('description','Repository or workflow run not found'),
      '429',JSON_OBJECT('description','Rate limited')
    )
  )
),
(
  'ACT-GH-REST-PENDING-DEPLOYMENTS-REVIEW-001',
  'github_api_mcp',
  'github_review_pending_deployments_for_workflow_run',
  'reviewPendingDeploymentsForWorkflowRun',
  'https://api.github.com',
  'POST',
  '/repos/{owner}/{repo}/actions/runs/{run_id}/pending_deployments',
  'github_com_connector',
  'github_com_connector',
  'active',
  'validated',
  'validated',
  'validated',
  'ready',
  'primary',
  'http_delegated',
  'TRUE',
  'http_generic_api',
  'endpoint_inventory',
  'official_rest_candidate',
  'GitHub Actions endpoint to approve or reject pending deployments for one workflow run after readback. Requires deployments write permission and typed governance approval before use.',
  JSON_OBJECT(
    'operationId','reviewPendingDeploymentsForWorkflowRun',
    'summary','GitHub Review Pending Deployments For Workflow Run',
    'method','post',
    'path','/repos/{owner}/{repo}/actions/runs/{run_id}/pending_deployments',
    'parameters',JSON_ARRAY(
      JSON_OBJECT('name','owner','in','path','required',true,'schema',JSON_OBJECT('type','string','pattern','^[A-Za-z0-9_.-]+$')),
      JSON_OBJECT('name','repo','in','path','required',true,'schema',JSON_OBJECT('type','string','pattern','^[A-Za-z0-9_.-]+$')),
      JSON_OBJECT('name','run_id','in','path','required',true,'schema',JSON_OBJECT('type','integer','minimum',1))
    ),
    'requestBody',JSON_OBJECT(
      'required',true,
      'content',JSON_OBJECT('application/json',JSON_OBJECT('schema',JSON_OBJECT(
        'type','object',
        'required',JSON_ARRAY('environment_ids','state','comment'),
        'additionalProperties',false,
        'properties',JSON_OBJECT(
          'environment_ids',JSON_OBJECT('type','array','minItems',1,'maxItems',50,'items',JSON_OBJECT('type','integer','minimum',1)),
          'state',JSON_OBJECT('type','string','enum',JSON_ARRAY('approved','rejected')),
          'comment',JSON_OBJECT('type','string','minLength',1,'maxLength',1000)
        )
      )))
    ),
    'responses',JSON_OBJECT(
      '200',JSON_OBJECT('description','Successful response','content',JSON_OBJECT('application/json',JSON_OBJECT('schema',JSON_OBJECT('type','array','items',JSON_OBJECT('type','object','additionalProperties',true))))),
      '401',JSON_OBJECT('description','Authentication failed'),
      '403',JSON_OBJECT('description','Authorization failed or reviewer not permitted'),
      '404',JSON_OBJECT('description','Repository or workflow run not found'),
      '422',JSON_OBJECT('description','Invalid or non-pending deployment review request'),
      '429',JSON_OBJECT('description','Rate limited')
    )
  )
)
ON DUPLICATE KEY UPDATE
  endpoint_operation=VALUES(endpoint_operation),
  provider_domain=VALUES(provider_domain),
  method=VALUES(method),
  endpoint_path_or_function=VALUES(endpoint_path_or_function),
  module_binding=VALUES(module_binding),
  connector_family=VALUES(connector_family),
  status=VALUES(status),
  spec_validation_status=VALUES(spec_validation_status),
  auth_validation_status=VALUES(auth_validation_status),
  privacy_validation_status=VALUES(privacy_validation_status),
  execution_readiness=VALUES(execution_readiness),
  endpoint_role=VALUES(endpoint_role),
  execution_mode=VALUES(execution_mode),
  transport_required=VALUES(transport_required),
  transport_action_key=VALUES(transport_action_key),
  inventory_role=VALUES(inventory_role),
  inventory_source=VALUES(inventory_source),
  notes=VALUES(notes),
  schema_json=VALUES(schema_json),
  updated_at=CURRENT_TIMESTAMP;
