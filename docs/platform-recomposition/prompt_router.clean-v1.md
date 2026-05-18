# prompt_router.clean-v1

Clean-room staging overlay for prompt and intent routing.

This file is not runtime authority yet. It defines the desired routing behavior after recomposition.

## 1. Router purpose

The prompt router converts user/request intent into a governed route, never into a direct model call or unregistered provider call.

## 2. Resolution order

1. Normalize request envelope and actor context.
2. Resolve `intent_key` from explicit request or conversational inference.
3. Resolve active `task_routes` row by `intent_key`.
4. Resolve workflow execution row.
5. Resolve business activity type when the request concerns business/brand/growth output.
6. Resolve business type path and brand path when path-sensitive.
7. Resolve brand and Brand Core when brand-targeted.
8. Resolve logic pointer and knowledge profile.
9. Resolve action/endpoint/schema/credential contract.
10. Run validation and dispatch.

## 3. Task routes authority

`task_routes` is the authority for intent dispatch.

Required route fields:

- `intent_key`
- `workflow_key`
- `target_module`
- `active = '1'`
- `enabled = 'true'`
- `execution_layer`
- `route_mode`

Changing a live `intent_key` is forbidden. Deprecate old routes and add a new route instead.

## 4. Degraded and blocked behavior

The router must return structured states instead of guessing.

| Condition | State |
|---|---|
| no active task route | `blocked.route_not_found` |
| multiple matching workflow rows without unique selector | `blocked.workflow_ambiguous` |
| schema missing for runtime-callable action | `degraded_contract.schema_unresolved` |
| brand target required but unresolved | `blocked.brand_target_resolution_required` |
| path resolver rows missing for path-sensitive mutation | `blocked.missing_required_path_resolver_rows` |
| agent skill missing | `blocked.skill_not_granted` |
| local intent missing device_id | `blocked.missing_device_id` |

## 5. AI execution routing

AI execution must route through `runAgentLoop -> getAgentDeps()`.

The router may not call model adapters directly.

## 6. Local connector routing

Local connector intents must use `/dispatch`:

- `local.health.check`
- `local.shell.run`
- `local.file.read`
- `local.file.write`
- `local.device.install`

All require `device_id` and SQL-resolved local connector config.

## 7. Review routing

`review_required` is enforced when a workflow writes governed content or public-facing output.

Recommended policy:

- `authority`: review required unless explicitly diagnostic-only.
- `complex`: review required for public output.
- `standard`: review required for governed writebacks.
- `rule_based`: review optional, validation/readback required.
- `tool_orchestrated`: schema/readback required; review depends on output type.

## 8. Sink routing

For successful governed execution:

1. route primary output to `output_artifacts`;
2. route reports/analysis to reporting views when enabled;
3. route rule-based decisions to adaptation records when applicable;
4. route linked workflows to `agent_chain_events`;
5. write `sink_dispatch_log` for every sink attempt.

## 9. Workbook-aware routing

Workbook reads are allowed only for explicit recovery/parity operations. Runtime routing must use SQL tables and registered Drive/Sheets evidence as diagnostic context.

## 10. Promotion targets

- `prompt_router` canonical source files
- `governedContextResolution.js`
- `executionRouting.js`
- `executionPreparation.js`
- `routes/dispatchRoutes.js`
- `connectorExecutor.js`
