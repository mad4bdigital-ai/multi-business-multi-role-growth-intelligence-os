# Connected Execution Read-Only Tool Execution

Date: 2026-06-05

## Purpose

This phase extends the connected execution worker bridge from read-only `tool_call` preflight into actual read-only execution for a narrow allowlist of GET tools.

Execution remains opt-in and guarded.

## Current diagnostic allowlist

The execution allowlist is intentionally narrow. `read_only_tool_call_allowlist_v2` includes two no-argument diagnostic GET tools suitable for smoke coverage:

```text
platform_data_source_census
platform_graph_status
```

Other allowlisted tools remain preflight/execution-capable only when their required path/query arguments are supplied by the action payload.

## Required opt-in

A `tool_call` resume action executes the read-only tool only when both conditions are true:

```json
{
  "action_payload": { "execute_read_only_tool_call": true },
  "guardrails": { "allow_read_only_tool_execution": true }
}
```

Without both fields, the worker keeps the previous preflight-only behavior.

## Guardrails

The existing preflight must pass before execution:

- `tool_key` is in the read-only allowlist
- registry row exists and is enabled
- method is `GET`
- mutating tags are blocked
- apply-enabled certifications are blocked

Execution then uses one internal governed tool dispatch and records:

```text
tool_call_executed: true
internal_tool_dispatch_executed: true
mutating_call_executed: false
repo_mutation_executed: false
provider_calls_executed: false
local_device_calls_executed: false
apply_operation_executed: false
secrets_included: false
```

## Budget

Each resume action may execute exactly one read-only tool call.

Output is redacted and bounded:

```text
max_tool_calls: 1
used_tool_calls: 1
default max_response_chars: 6000
hard max_response_chars: 10000
output_redaction: key_and_string_pattern_redaction_v1
```

## Redaction

Evidence stores a redacted/truncated result preview. Sensitive keys and common bearer/API-key/token patterns are redacted before evidence writeback.

Safe boolean metadata keys, currently `secrets_included`, are preserved when their value is a boolean so evidence can distinguish `false` from an actual redacted secret. Non-boolean values under sensitive key names remain redacted.

## Out of scope

The worker still does not allow:

- repo mutation
- provider writes/calls
- local-device calls
- apply operations
- POST/PUT/PATCH/DELETE tool execution
- non-allowlisted tools
- secrets in evidence

## Migration

Migration `195_sprint66_connected_execution_read_only_tool_execution.sql` registers certification:

```text
connected_execution_worker_bridge_v3_read_only_tool_execution
```

and updates the enqueue tool description/tags/fixed body to include the read-only execution phase.
