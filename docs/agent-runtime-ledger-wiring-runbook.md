# Agent Runtime Ledger Wiring Runbook

This runbook tracks the remaining work to persist model and tool-call ledgers.

## Required runtime evidence

- model dispatch smoke without secrets
- `agent_model_runs` insert/readback
- `agent_tool_calls` insert/readback
- usage and cost persistence
- tool-use/tool-result evidence
- no provider credential payloads in logs

## Execution boundary

The scorecard is static and does not call providers. Live model/provider smoke must be a separate governed execution with release-readiness evidence and explicit no-secret readback.

## Completion signal

This area is complete when a live no-secret provider smoke records model and tool-call rows and release readiness includes their policy/readback gates.
