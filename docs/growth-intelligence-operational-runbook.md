# Growth Intelligence Operational Runbook

## Baseline

The value path may run only while the platform baseline is pass and healthy. Treat readiness failures, actionable migration drift, or a non-empty governance surface queue as release blockers.

## Governed Admin Entrypoint

Use the virtual Admin tool `growth_intelligence_pilot_run` through `/gpt/tools/call`. It resolves the tenant, brand, active Brand Core assets, and Business Activity Type from MySQL authority; validates route, workflow, engine, and governed-dispatch evidence; runs the existing pilot; persists the report, insights, actions, approval holds, and readiness assessment; and performs same-cycle readback. The tool supports only `persistence_mode=internal_registry`, returns `apply_allowed=false` and `execution_allowed=false`, and rejects provider writes, external sends, live execution, and secret-bearing results.

For the first production pilot, use tenant `65f3f066-eefa-4625-9023-8318c858e94b`, brand key `arab_cooling`, and registry-backed activity `business_and_industrial_products`. The activity selection is an explicit current-registry approximation for HVAC/cooling and must be replaced if a more specific registered activity is added later.

## Status Response

| Signal | Operator action |
|---|---|
| `pass` | Run the pilot and retain readback/audit evidence. |
| `warn` | Identify the warning owner and runbook; do not widen execution authority. |
| `fail` | Stop the value workflow, remediate, and rerun readiness before retrying. |
| health degraded | Verify dependencies and queue state; do not classify the pilot as complete. |
| actionable migration drift > 0 | Run governed migration preflight and reconcile drift before release. |
| surface queue > 0 | Classify and close or defer every item through governance before release. |

## Pilot Checks

Confirm:

- all ten workflow stages are `pass`
- every insight has evidence or explicit assumption state
- every backlog action has score, risk, execution class, and approval state
- all non-advisory actions are held
- provider writes = 0
- external sends = 0
- secrets included = false
- report and audit identifiers are present

When `persistence_mode=internal_registry`, also confirm:

- one workflow run links the report
- all insights and actions link the same report and tenant
- every approval-required action links an open `approval_holds` row
- the transaction completed without partial records
- approval decisions return `execution_dispatched=false`
- Growth Intelligence holds are decided only through the specialized action decision route
- duplicate insights are superseded through the deterministic fingerprint lifecycle
- insight decisions are explicit and superseded insights cannot be decided again
- the latest readiness assessment is retained with its SHA-256 evidence hash
- `review_ready` assessments still return `execution_allowed=false`

## Product Metrics

Review tenant or brand metrics for:

- reports generated and awaiting approval
- evidence-backed versus assumption insights
- accepted, rejected, stale, and superseded insights
- held, approved, and rejected actions
- evidence coverage and insight/action/report approval rates
- blocked versus review-ready assessment history
- provider write, external send, and secret counters

Any non-zero safety counter is a release blocker.

## Readiness Assessment

Before classifying a report as ready for human review, create a readiness
assessment and confirm there are no blocking gaps for report approval, action
approval, insight acceptance, evidence coverage, scoring, readback requirements,
or safety flags. Malformed readback requirements are treated as missing and block
readiness. Readiness is review evidence only; it never authorizes execution.

## Recovery

When brand resolution fails, repair Brand Registry or Brand Core authority. When activity resolution fails, repair the Business Activity Type registry. When a policy or runtime stage fails, keep the action held and attach the failure to audit evidence. Never bypass the hold to make the pilot pass.

## Success Evidence

Retain the JSON report, Markdown report, approval queue view, readback object, audit evidence, and fresh test output.

## Supervisor Monitoring

For supervisor-agent execution, run `npm run supervisor:readiness:live` before widening authority. Treat `execution_ready=true` as prerequisite evidence, not as proof of a completed dispatch.

Run provider-free behavioral certification with:

```bash
npm run supervisor:certify
npm run supervisor:certify:live
```

The live certification uses controlled database fixtures inside a transaction and rolls them back. Confirm persistent fixture plans/events/runs are all zero and provider calls are zero before accepting `behaviorally_certified`.

For a bounded causal provider-lane certification, use the admin-only governed `supervisor_causal_provider_certification` tool through `https://auth.mad4b.com` after list-before-call discovery. The tool requires the exact typed confirmation `CERTIFY_SUPERVISOR_CAUSAL_PROVIDER_LANE`, creates a synthetic certification plan and linked workflow run, permits one bounded provider dispatch, and permits zero tools, local execution, repository mutation, or secret return. Accept the result only after durable readback proves the same correlation identifier and completed terminal states across the plan, workflow run, and execution log.

Multi-agent delegation is optional. Do not schedule `/agent-chain-events/dispatch-pending` or treat `linked_workflows` as automatic work. Through `auth.mad4b.com`, discover and call `agent_chain_event_create_manual`, then dispatch only the selected event with `agent_chain_event_dispatch_manual`. Every call requires `delegation_approved=true`, `delegation_mode=manual_api`, and a meaningful reason. Keep `allow_fallback_agent=false` unless one fallback attempt is explicitly required.

Monitor:

- active routed agents missing `logic.evaluate_pack` grants;
- unavailable or unhealthy configured fallback agents;
- old or growing `pending` chain events;
- unexpected `failed` or `skipped` chain events;
- observed versus configured chain depth;
- workflow-run creation after a controlled supervisor dispatch.

Do not automatically process historical pending chain events. Confirm tenant, workflow, intent, and replay authority first. Events with unresolved workflow identity must be classified, not replayed. The current production checkpoint is recorded in `execution-log-supervisor-production-activation-2026-06-15.md`.

At the 2026-06-15 checkpoint, migration `1007_sprint69_archive_invalid_historical_chain_events.sql` classified 4 unresolved historical events as `skipped`; total pending chain events read back as 0, and the idempotency apply affected 0 rows.

The 2026-06-15 causal provider-lane checkpoint completed with `execution_log.id=15056`. It proves the governed no-tool plan-to-workflow-run-to-provider path only; it does not authorize unrestricted parallel or tenant-mutating execution.
