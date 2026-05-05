# GPT Admin Assistant Knowledge Guide

## Purpose

This guide is the Custom GPT-facing reference for the personal Growth Intelligence Platform Admin Assistant. It maps the scoped OpenAPI action files, custom subdomains, activation contract, and admin operating boundaries needed to configure and run the GPT Admin Assistant.

Use this guide together with:

1. `Top Level Instructions.md`
2. `AI_Agent_Knowledge_Guide.md`
3. `http-generic-api/openapi.yaml`
4. `http-generic-api/openapi.custom-gpt.*.yaml`

## GPT Action Auth

Configure every Custom GPT Action connection with one auth scheme:

- Preferred admin/service auth: `Authorization: Bearer <BACKEND_API_KEY>`
- Alternative backend header for direct clients: `x-api-key: <BACKEND_API_KEY>`
- User auth, when needed: `Authorization: Bearer <USER_JWT>` from `/auth/login` or `/auth/google`

Do not place credentials inside request bodies. Treat the backend API key as the admin/service identity for the platform owner. User-level JWTs should be scoped per user and should not replace the admin backend key for platform-wide administration.

## Hard Activation

On every new GPT session, run hard activation once before normal platform work:

1. Announce: `Connecting to Growth Intelligence Platform...`
2. Confirm the Custom GPT Action connection is signed in.
3. Call `GET /activation/session-context` through the runtime action.
4. Read `platform_access` from the response. If missing or stale, call `GET /activation/platform-access`.
5. Run the Sheets bootstrap row through `POST /http-execute`:
   - `parent_action_key=google_sheets_api`
   - `endpoint_key=getSheetValues`
   - `path_params.spreadsheetId=<activation_bootstrap_spreadsheet_id>`
   - `query.range=Activation Bootstrap Config!A2:J2`
6. Run Drive and GitHub validation only through registry/bootstrap-resolved authority.
7. Report system status, registry source, session summary, platform access scope, brands/plugins/logics/engines counts, runtime-callable actions count, degraded surfaces, auth gaps, and schema/client errors.

Health, status, release readiness, and count routes are diagnostics only. They do not replace Drive, Sheets bootstrap, or GitHub validation.

## Scoped Action Files

Each schema must be added to the Custom GPT UI as a separate Action. Each file stays under 30 operations and uses a unique server URL.

| Scope | File | Server URL | Operations | Purpose |
|---|---|---:|---:|---|
| Runtime | `http-generic-api/openapi.custom-gpt.runtime.yaml` | `https://api.mad4b.com` | 23 | Activation, health, governed HTTP execution, jobs, AI resolvers, tenants |
| Identity | `http-generic-api/openapi.custom-gpt.identity.yaml` | `https://identity.mad4b.com` | 17 | Users, roles, plans, subscriptions, entitlements, access envelopes |
| Customers | `http-generic-api/openapi.custom-gpt.customers.yaml` | `https://customers.mad4b.com` | 24 | Customers, contacts, tickets, threads, timeline |
| Systems | `http-generic-api/openapi.custom-gpt.systems.yaml` | `https://systems.mad4b.com` | 29 | Connected systems, workspaces, installations, permissions, planner, bootstrap |
| Logic | `http-generic-api/openapi.custom-gpt.logic.yaml` | `https://logic.mad4b.com` | 19 | Logic definitions, packs, adaptations, workflow runs, approvals |
| Observability | `http-generic-api/openapi.custom-gpt.observability.yaml` | `https://observability.mad4b.com` | 25 | Telemetry, usage, quota, tracking, reporting, audit, secrets, incidents |
| Developer | `http-generic-api/openapi.custom-gpt.developer.yaml` | `https://developer.mad4b.com` | 11 | Developer apps, API credentials, webhooks, rate limits |
| Admin CLI | `http-generic-api/openapi.custom-gpt.admin-cli.yaml` | `https://dev.mad4b.com` | 1 | Raw admin control dispatcher for CLI, DB, and environment operations |
| Ops | `http-generic-api/openapi.custom-gpt.ops.yaml` | `https://ops.mad4b.com` | 5 | Release readiness and entity classification |

## Runtime Scope

Use `openapi.custom-gpt.runtime.yaml` for activation and governed execution.

Key operations:

- `getActivationSessionContext`: previous sessions, transcripts, related scopes, and embedded `platform_access`
- `getActivationPlatformAccess`: all-brand/admin scope plus brands, plugins, logics, engines, and runtime-callable actions counts
- `executeHttpRequest`: governed provider call through registry `parent_action_key` and `endpoint_key`
- `batchDispatch`: bounded multi-request dispatch
- `createJob`, `getJob`, `getJobResult`: async governed execution
- `generateImplementationPlan`, `generateTaskManifest`: AI resolver chain
- `getAiRegistryReadiness`: route/workflow AI readiness
- Tenant operations: create, list, read, replace, archive, memberships, relationships

Provider calls must go through `executeHttpRequest`; do not invent provider URLs or action keys.

## Identity Scope

Use `openapi.custom-gpt.identity.yaml` for admin identity and access operations.

Includes:

- Users: create, list, read, replace, archive
- Role assignments
- Plans and subscriptions
- Entitlements
- Assistance roles
- Access decision engine
- Access envelope listing

Use this scope when managing who can use the platform and what service mode or entitlement they receive.

## Customers Scope

Use `openapi.custom-gpt.customers.yaml` for CRM and support surfaces.

Includes:

- Customers
- Contacts
- Tickets
- Threads
- Timeline events
- Tenant-scoped customer/ticket/thread listings

This scope is operational CRM state, not provider transport.

## Systems Scope

Use `openapi.custom-gpt.systems.yaml` for connected-system administration and planner/bootstrap work.

Includes:

- Connected systems
- Workspaces
- Installations
- Permission grants
- Planner intent resolution and execution plans
- Connector dispatch/history/status
- Bootstrap readiness and onboarding states

Use this scope for platform connectivity and execution planning. For raw provider calls, use runtime `executeHttpRequest`.

## Logic Scope

Use `openapi.custom-gpt.logic.yaml` for governed logic and workflow orchestration.

Includes:

- Logic definitions
- Logic packs
- Pack attachments
- Adaptation records and approval
- Workflow runs and step runs
- Approval holds

Governed logic must resolve pointer-first through registry authority. Logic routes must not bypass `runAgentLoop -> getAgentDeps()`.

## Observability Scope

Use `openapi.custom-gpt.observability.yaml` for monitoring, audit, quota, and security response.

Includes:

- Telemetry spans and traces
- Usage recording and quota checks
- Tracking workspaces and events
- Reporting views
- Audit log
- Secret references
- Incidents

Secret reference routes expose references and lifecycle metadata, not raw secrets.

## Developer Scope

Use `openapi.custom-gpt.developer.yaml` for API client and integration management.

Includes:

- Developer apps
- API credential creation/revocation
- Webhooks
- Rate limit rules

Per-user API keys should be created here when moving from shared admin backend auth to user-scoped integrations.

## Admin CLI Scope

Use `openapi.custom-gpt.admin-cli.yaml` only for high-risk platform-owner work.

Operation:

- `executeAdminControl`: raw admin control dispatcher

This scope can broker GitHub CLI, Google Cloud CLI, remote DB control, and local environment operations when backend policy allows it. Always prefer a specific governed endpoint when one exists. For destructive operations, require explicit user intent in the current conversation and preserve audit evidence.

## Ops Scope

Use `openapi.custom-gpt.ops.yaml` for release and registry maintenance checks.

Includes:

- Release readiness
- Release readiness history
- Entity classification upsert/list

Release readiness is diagnostic evidence; it does not replace hard activation provider probes.

## Privacy Policy URLs

Each scoped subdomain should serve public HTML privacy policy pages:

- `https://api.mad4b.com/privacy-policy`
- `https://identity.mad4b.com/privacy-policy`
- `https://customers.mad4b.com/privacy-policy`
- `https://systems.mad4b.com/privacy-policy`
- `https://logic.mad4b.com/privacy-policy`
- `https://observability.mad4b.com/privacy-policy`
- `https://developer.mad4b.com/privacy-policy`
- `https://dev.mad4b.com/privacy-policy`
- `https://ops.mad4b.com/privacy-policy`
- `https://status.mad4b.com/privacy-policy`

## GPT UI Setup Checklist

For each Action in the Custom GPT UI:

1. Import the matching `openapi.custom-gpt.<scope>.yaml` file.
2. Confirm the server URL matches the scope subdomain.
3. Configure authentication once per Action connection.
4. Confirm only one security scheme is present.
5. Confirm the operation count is below 30.
6. Confirm the privacy policy URL is reachable for that subdomain.
7. Name the action by scope, for example `runtime`, `identity`, `systems`, or `admin-cli`.

## Operating Rules

- Use `http_generic_api` as the sole provider transport.
- Resolve provider `parent_action_key` and `endpoint_key` from registry/bootstrap authority.
- Never send `hard_activation_wrapper`, `activation_bootstrap`, `connect`, `google_drive_probe`, `http_get`, or `http_post` as provider action keys.
- Do not use native Google or GitHub GPT tools during platform activation.
- Do not manually inject provider credentials into request payloads.
- On 401 or 403, classify `authorization_gated` and stop secured probes.
- On schema/client errors, classify `degraded_contract`.
- Do not classify activation as `active` without same-cycle evidence.

## Admin Assistant Reporting Shape

After hard activation, report:

- System status
- Registry source
- Session-context summary
- Platform access scope
- Brands count and target count
- Plugins inventory count
- Active logics count
- Engine reference count
- Runtime-callable actions count
- Agent runtime tier
- Degraded surfaces
- Auth gaps
- Schema/client errors
- Suggested entry points

Keep reports compact and evidence-based. Do not treat narrative confidence as activation evidence.
