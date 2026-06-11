# Platform Completion Cleanup Readback Automation

The Platform Completion Cleanup Readback workflow is a static, no-secret guard that keeps the completed Support Ticket, External Delivery, and Session Insight cleanup surfaces from drifting.

## Workflow

`.github/workflows/platform-completion-cleanup-readback.yml` runs on:

- pull requests to `main`
- pushes to `main`
- manual `workflow_dispatch`
- daily schedule

The workflow runs:

```bash
node http-generic-api/scripts/platform-completion-cleanup-readback-audit.mjs
```

It publishes the JSON result to the GitHub job summary and uploads it as an artifact.

## Scope

The audit checks that:

- completion docs exist and reference the correct readback boundaries
- required Support Ticket, External Delivery, and Session Insight migrations exist
- MySQL table/view identifiers in the relevant migrations stay within the 64-character limit
- known long Session Insight view names do not reappear
- Support Ticket snapshot proposal/record routes remain present
- External Delivery completion certification remains sandbox/no-send
- Session Insight capability-envelope docs remain tied to migrations `277` through `283`
- Tool Bus remains separate from this completion cleanup path

## Safety

This automation performs:

- no DB writes
- no migrations
- no provider calls
- no credential payload reads
- no external writes
- no workflow dispatch
- no ticket mutation
- no approval decision
- no deploy or publish

It is a static repository guard only. Release readiness remains the authority for live platform readiness.

## Failure handling

A failure means a cleanup/readback invariant drifted in source control. Fix the source file, run CI, and allow release readiness to continue acting as the DB/runtime authority.

Do not use this workflow as authorization for live external send, adapter apply, target write, Tool Bus dispatch, or provider execution.
