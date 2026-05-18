# module_loader.clean-v1

Clean-room staging overlay for the platform loader contract.

This file is not runtime authority yet. It defines how loaders should behave after recomposition.

## 1. Loader purpose

The module loader prepares runtime dependencies before execution. It must not invent authority; it loads and validates authority from SQL registry tables, runtime config, and registered schema assets.

## 2. Required load order

1. Runtime bootstrap config from `platform_runtime_config`.
2. Action and endpoint rows from `actions` and `endpoints`.
3. Task route rows from `task_routes` using `intent_key` or route context.
4. Workflow row by unique execution key.
5. Business activity rows from `business_activity_types`.
6. Business type/profile/path resolver rows from SQL after activity resolution.
7. Tenant, relationship, actor role, and scope rows from `tenants`, `tenant_relationships`, and `role_assignments`.
8. Service mode and entitlement rows for self-serve, assisted, managed, paid, limited, or package-gated features.
9. Human oversight rows from `assistance_roles` and `approval_holds` when review, audit, supervisor signoff, or managed execution is required.
10. Brand and Brand Core rows when brand-targeted output is requested.
11. Logic pointer and activity-compatible knowledge profile rows.
12. Credential binding and connected system records.
13. Schema contracts from endpoint-local schema, imported action schema, or governed schema asset.
14. Execution policies and validation/repair rows.

## 3. Activity-first rule

Runtime loaders must not infer tourism/travel as a default. They must resolve the requested or inferred activity through `business_activity_types` first, then load the matching business type profile, knowledge pack, brand expectations, engines, and workflow variant.

If an activity is absent, the loader returns `validating.activity_unresolved` unless the route is explicitly activity-agnostic.

## 4. SQL-first rule

Runtime loaders must not read Google Sheets directly for registry authority.

Allowed Sheets/Drive uses:

- activation provider proof;
- explicit recovery/parity tooling;
- user-facing artifact writes;
- documented Drive knowledge files when registered by SQL rows.

## 4. Context resolution dependency

`runAgentLoop` must receive governed context dependencies by default, not optionally.

Required injected dependencies:

- `buildGovernedContext(plan)`
- `loadPathResolverRows(plan)`
- `engineExecutorRegistry`
- `getCallModelForClass(execution_class)`
- HTTP action dispatcher for action-backed engines
- MCP dispatcher for MCP-backed engines

## 5. Workflow loading

Loaders must avoid `workflow_key LIMIT 1` ambiguity.

Acceptable patterns:

- load by `workflow_id` for execution;
- load by `(workflow_key, workflow_variant_key)`;
- load a group intentionally and return all candidates with disambiguation advice.

## 6. Schema resolution

Schema resolution precedence:

1. endpoint-local schema overlay;
2. imported endpoint `schema_json`;
3. action-level `schema_json`;
4. action `openai_schema_file_id` or governed schema asset;
5. blocked state: `schema_contract_unresolved`.

A runtime-callable action without schema must be classified `degraded_contract` unless it is explicitly native-runtime and has a registered internal contract.

## 7. Credential resolution

Credentials resolve through registry and secret references. Loaders must never accept prompt-supplied tokens as runtime authority.

Resolution order:

1. user/tenant connection credential when request is user-scoped;
2. connected system credential binding;
3. platform-managed credential only when policy allows fallback;
4. blocked state when unresolved.

## 8. Output/sink dependencies

For governed execution, the loader must prepare sink metadata:

- expected `output_artifact_type`;
- `primary_output`;
- linked workflows;
- execution class;
- review requirement;
- write/readback policy.

## 9. Validation result shape

All loader failures return a structured state:

```json
{
  "ok": false,
  "classification": "blocked|degraded_contract|validating",
  "error": {
    "code": "stable_machine_code",
    "message": "human readable summary",
    "details": {}
  }
}
```

## 10. Promotion targets

- `agentRuntime.js`
- `agentLoopRunner.js`
- `connectorExecutor.js`
- `executionPreparation.js`
- `endpointSchemaResolver.js`
- `pathResolverRowsLoader.js`
- `registryResolution.js`
