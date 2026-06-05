# Connected Execution Read-Only Tool Call Preflight

Date: 2026-06-05

This phase allows `tool_call` resume actions only as read-only preflight and evidence. The worker does not execute tools.

Allowed preflight checks:

- `tool_key` must be present in `action_payload`.
- `tool_key` must be in the hardcoded read-only allowlist.
- The admin tool registry row must exist and be enabled.
- The tool method must be `GET`.
- The tool tags must not include mutating tags.
- Certification must not allow apply when present.

The worker writes evidence and marks the resume action completed only when the preflight passes. If a guard fails, it writes a blocked evidence report.

The worker never calls the tool dispatcher, providers, repositories, local devices, or apply operations in this phase. Evidence records `tool_call_executed: false`, `external_tool_calls_executed: false`, `repo_mutation_executed: false`, `provider_calls_executed: false`, `local_device_calls_executed: false`, and `secrets_included: false`.

Initial allowlist:

```text
platform_data_source_census
connected_execution_latest_checkpoint_get
schema_import_jobs_list
schema_import_job_get
```

Migration `193_sprint66_connected_execution_read_only_tool_call_preflight.sql` registers certification `connected_execution_worker_bridge_v2_read_only_tool_call_preflight` and updates the enqueue tool description/tags.

Actual read-only tool execution is intentionally out of scope for this phase.
