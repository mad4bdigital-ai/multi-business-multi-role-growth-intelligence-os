# End-to-End Operation Flows

## Common flow

1. Receive natural-language request.
2. Load authenticated principal and authorized Workspace.
3. Resolve or clarify Brand/resource.
4. Resolve Business Activity.
5. Resolve intent candidates.
6. Build ECE candidates from governance, resource, connection, readiness, and schema evidence.
7. Remove unsafe, shadow, stale, foreign, or non-callable candidates.
8. Run contradiction detection.
9. Ask one context-aware question or return a bounded blocker.
10. Collect only missing schema fields.
11. For mutations, show preview and approval requirements.
12. Execute through the operation orchestrator.
13. Read back the effect.
14. Persist bounded context and update support continuity.

## A — Brand-scoped manager invitation

Resolve `AllRoyalEgypt Brand` to `allroyalegypt_wp`; identify the invitee without creating access; prefer Brand/Site/App grants and disclose Workspace invitation only as a broader alternative; preview direct/inherited access and existing grants; require approval; apply idempotently; read back effective access; link blocked state to the existing ticket and preserve retry context.

## B — WordPress travel content

Resolve Brand, Site, exact Connection, and authority; discover live content types/schema; treat indexed CPT snapshots as hints; map “trip or activity” to verified `tour`, `trip`, or `activity`; ask only verified/missing fields; resolve draft and publish separately; preview target, status, fields, taxonomy, connection, approval, and readback; execute through the governed operation; reconcile ambiguous outcomes without blind resend.

## C — Ads campaign

Resolve Brand, provider, account, and campaign resource; validate credential scope, reachability, schema, authority, and certification; resolve budget/quota authority before spend questions; preview objective, targeting, creative references, schedule, budget, currency, approval, and measurement; read back campaign hierarchy and status; keep spend activation separately approved.

## D — CRM

Resolve Brand/Connection; discover authorized objects, pipelines, stages, owners, and fields; distinguish search/read/create/update/transition/archive; preview exact record and changes; enforce object-level authority and idempotency; read back record revision and allowlisted values.

## E — Analytics and reports

Resolve Brand, property/account, data source, and read capability; resolve metrics/dimensions/date ranges; display source and verification time; never label indexed results as live; return bounded results, freshness, sampling/partial flags, and detail references; never inherit write authority.

## F — Workflows and automation

Resolve workflow ownership; distinguish inspect, preview, activate, deactivate, and run; validate instance mode, inputs, approval, timeout, compensation, and readback; execute once; read back status/output summary; keep activation/deactivation separate.

## G — Local devices

Resolve requested capability and candidate devices; validate Tenant ownership, lifecycle, heartbeat, connector identity, supported capability, and local consent; suppress reinstall when a healthy enabled device already satisfies the need; use Local Manager for management, repair, consent, or adding a device; execute only allowlisted actions with readback.

## H — Connection setup or repair

Resolve resource/provider capability; inspect existing links; prefer exact-connection repair over duplicates; use dedicated credential intake and never request secrets in chat; validate reachability/schema; refresh ECE and resume the blocked operation.

## I — Future capability onboarding

Register canonical capability and adapter metadata; compile governance manifest/gaps; keep shadow-only until resource binding, exposure, schema, certification, readiness, approval, and readback are complete; add localized labels; run shadow/isolation tests; promote by bounded cohort.

## J — Support escalation and retry

Create or reuse ticket by operation fingerprint; store no-secret evidence references, public blocker, ECE revision, and intended action; link execution plan/diagnostic workflow; notify only through approved channels; expose retry after remediation; re-resolve fresh evidence; reuse valid answers; close only after verified operation or diagnostic readback.
