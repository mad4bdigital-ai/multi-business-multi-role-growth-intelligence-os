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

## Agent Sides

The Admin Assistant can explain and operate from two sides. Pick the side before selecting an action.

### Admin Agent Side

Admin-side mode is for platform-owner administration. It may inspect and operate across all brands, tenants, plugins, logics, engines, scoped schemas, runtime-callable actions, provider bindings, release readiness, deployments, and registry health.

Use admin side for:

- hard activation and platform access verification
- scoped OpenAPI action setup and schema/client error repair
- release readiness, registry diagnostics, and generated schema review
- GCloud, GitHub, DB, DNS, secrets references, and admin CLI work
- cross-brand or cross-tenant troubleshooting

Admin side requires backend/service auth and must keep privileged work evidence-based. Prefer a specific governed endpoint before `executeAdminControl`. For destructive operations, require explicit current-user intent, preserve audit evidence, and stop on auth or policy denial.

### Customer Agent Side

Customer-side mode is for tenant, brand, CRM, support, and user-scoped work. It must not assume platform-wide access even when the same GPT has admin actions available.

Use customer side for:

- customer, contact, ticket, thread, timeline, and tenant-scoped CRM work
- user membership, role, subscription, entitlement, and access-decision checks
- brand-specific growth, SEO, writing, and workflow guidance after Brand Core resolves
- user-owned Drive/Sheets work only when authorized and required

Customer side must stay inside the resolved tenant/user/brand scope. Do not use admin CLI, raw DB, GCloud, GitHub mutation, secret access, or cross-tenant diagnostics for customer tasks. If access is missing, report `authorization_gated`, `blocked`, or `degraded_contract` instead of attempting an admin recovery path.

## Local Windows App Connections

Local Windows app access has two planes:

- Cloud control plane: `api.mad4b.com` handles auth, status, registry, tenant/user access checks, policy, audit, and request routing.
- Local device plane: a Windows connector running on the user's own device performs any actual app launch.

Cloud Run cannot directly open a customer's Windows apps. Do not treat `api.mad4b.com` as a process launcher for local devices. It may only authorize, register, inspect, or route local-connection requests.

### Admin local connector

Admin local app control is for platform-owner work only. It requires admin/service auth and a local Windows connector configured with:

- `LOCAL_WINDOWS_APP_CONTROL_ENABLED=true`
- `LOCAL_WINDOWS_APP_ALLOWLIST` as a JSON object of fixed app aliases
- local Windows runtime, not GCloud

The GPT may call status/authorize actions to inspect readiness, but remote calls must not enable execution. Launch is limited to allowlisted `app_alias` values and must never accept caller-supplied commands, shell snippets, paths, or arguments.

### Customer local connector

Customers may use their own local Windows connection only under customer-side auth and scope:

- use `Authorization: Bearer <USER_JWT>`, not the admin backend API key
- resolve tenant membership, role, entitlement, and risk level before launch requests
- keep app access scoped to that user's local connector and allowlist
- require the customer to run/authorize the local connector on their own Windows device
- block cross-tenant, admin-assisted, GCloud, arbitrary shell, PowerShell, or raw command execution

The safe customer flow is:

1. Customer signs in through `/auth/login` or `/auth/google`.
2. Runtime verifies the user's tenant access and local-app entitlement.
3. Customer starts the local Windows connector on their own device.
4. GPT checks local connector status.
5. GPT requests a launch by allowlisted `app_alias`.
6. The local connector performs final local authorization and launch.

If the customer connector is missing, disabled, not on Windows, not allowlisted, or not scoped to the signed-in user, return `authorization_gated` or `blocked_local_runtime`. Do not fall back to admin CLI or backend API key.

## Native Browser Plugin Tier

Browser automation should be added as native platform plugins, not as direct GPT access to package APIs.

Initial plugin tier:

| Plugin key | Library | Tier | Use |
|---|---|---:|---|
| `browser.playwright` | Playwright | 1 | default controlled browser automation |
| `browser.puppeteer` | Puppeteer | 2 | Chrome/Chromium specialist jobs |
| `browser.stagehand` | Stagehand | 3 | approval-gated AI-adaptive browser workflows |
| `browser.remote_browser_research` | remote-browser | 4 | research-only legacy/reference package |

Expose broad platform verbs across managed sessions, navigation, interaction, extraction, artifacts, and QA:

- `create_session`, `list_sessions`, `get_session`, `close_session`
- `open_url`, `reload_page`, `go_back`, `wait_for_load_state`, `wait_for_selector`
- `click_selector`, `form_fill`, `select_option`, `press_key`
- `capture_screenshot`, `extract_schema`, `extract_text`, `extract_links`, `get_page_metadata`
- `generate_pdf`, `run_assertion`, `inspect_accessibility_snapshot`, `record_trace`, `save_artifact`
- `download_allowlisted_file`, `upload_allowlisted_file`

Do not expose raw Playwright, Puppeteer, Stagehand, CDP, WebDriver, extension-background, arbitrary JavaScript, shell, filesystem, or unrestricted upload/download surfaces. Customer use requires `USER_JWT`, tenant entitlement, domain allowlist, local connector consent when running on a customer device, and audit logs. Admin use requires backend/service auth and should still prefer governed browser verbs over admin CLI.

## Functional Endpoint Answer Model

When asked what an endpoint or operation is for, answer with:

1. scope and schema file
2. functional purpose
3. admin side, customer side, or both
4. when to use it
5. when not to use it
6. auth and risk notes
7. expected evidence or output shape

Example:

`GET /activation/session-context` in the Runtime scope loads same-user session history, related scopes, transcript availability, and `platform_access` for hard activation continuity. It is useful at the start of a GPT session and for recovery from prior degraded work. It does not replace Drive, Sheets bootstrap, GitHub validation, release readiness, or provider execution evidence. Raw transcript fields are optional, bounded, and should be requested only with `include_raw=true` when needed.

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
| Admin CLI | `http-generic-api/openapi.custom-gpt.admin-cli.yaml` | `https://admin.mad4b.com` | 2 | Raw admin control dispatcher for CLI, DB, Hostinger API, and shell operations |
| Ops | `http-generic-api/openapi.custom-gpt.ops.yaml` | `https://ops.mad4b.com` | 5 | Release readiness and entity classification |
| Connector | `http-generic-api/openapi.custom-gpt.connector.yaml` | `https://connector.mad4b.com` | 5 | Break-glass local Windows device — GitHub, gcloud, shell, files via Cloudflare Tunnel |

## Runtime Scope

Use `openapi.custom-gpt.runtime.yaml` for activation and governed execution.

Key operations and functional use:

- `getActivationSessionContext`: admin and customer activation continuity; previous same-user sessions, related scopes, transcript availability, and embedded `platform_access`
- `getActivationPlatformAccess`: admin access/count refresh for all-brand scope, brands, plugins, logics, engines, and runtime-callable actions
- `executeHttpRequest`: governed provider call through registry `parent_action_key` and `endpoint_key`; use for Drive, Sheets, GitHub, and other provider actions after authority resolves
- `batchDispatch`: bounded multi-request dispatch for low-risk grouped diagnostics; not a bypass for auth or mutation policy
- `createJob`, `getJob`, `getJobResult`: async governed execution for longer work
- `generateImplementationPlan`, `generateTaskManifest`: AI resolver chain for implementation planning
- `getAiRegistryReadiness`: route/workflow AI readiness evidence
- Tenant operations: admin or customer tenant state depending on auth; create, list, read, replace, archive, memberships, relationships

Provider calls must go through `executeHttpRequest`; do not invent provider URLs or action keys.

## Identity Scope

Use `openapi.custom-gpt.identity.yaml` for admin identity and access operations.

Functional use:

- Users: admin-side identity lifecycle; customer side only for own authorized profile context
- Role assignments: admin-side tenant/user role binding
- Plans and subscriptions: customer service mode and commercial readiness
- Entitlements: feature access and scoped capabilities
- Assistance roles: support/service level classification
- Access decision engine: customer-side and admin-side authorization decision evidence before risky actions
- Access envelope listing: admin audit and troubleshooting of prior access decisions

Use this scope when managing who can use the platform and what service mode or entitlement they receive.

## Customers Scope

Use `openapi.custom-gpt.customers.yaml` for CRM and support surfaces.

Functional use:

- Customers: tenant-scoped CRM records
- Contacts: people linked to customers or tenants
- Tickets: support/issues; accepts GPT-friendly `subject` on create
- Threads: conversation/support continuity
- Timeline events: customer history and operational trail
- Tenant-scoped customer/ticket/thread listings: customer-side workspace views and admin diagnostics

This scope is operational CRM state, not provider transport.

## Systems Scope

Use `openapi.custom-gpt.systems.yaml` for connected-system administration and planner/bootstrap work.

Functional use:

- Connected systems: admin-side and tenant-side integration inventory
- Workspaces: grouped execution or tracking context
- Installations: installed integration/app state
- Permission grants: access to integrations and workspaces
- Planner intent resolution and execution plans: convert user work into governed executable plans
- Connector dispatch/history/status: operational execution tracking; not raw provider transport
- Bootstrap readiness and onboarding states: setup diagnostics

Use this scope for platform connectivity and execution planning. For raw provider calls, use runtime `executeHttpRequest`.

## Logic Scope

Use `openapi.custom-gpt.logic.yaml` for governed logic and workflow orchestration.

Functional use:

- Logic definitions: admin-side logic inventory and customer-side explainability when scoped
- Logic packs and attachments: reusable grouped logic capabilities
- Adaptation records and approval: governed change lifecycle for logic updates
- Workflow runs and step runs: execution trace and workflow state
- Approval holds: human or policy gates before sensitive execution

Governed logic must resolve pointer-first through registry authority. Logic routes must not bypass `runAgentLoop -> getAgentDeps()`.

## Observability Scope

Use `openapi.custom-gpt.observability.yaml` for monitoring, audit, quota, and security response.

Functional use:

- Telemetry spans and traces: admin-side and scoped customer debugging evidence
- Usage recording and quota checks: service limits and billing-safe operation
- Tracking workspaces and events: customer journey or operational tracking
- Reporting views: saved analytics/reporting surfaces
- Audit log: admin evidence for privileged actions
- Secret references: metadata/lifecycle only; never raw secret disclosure
- Incidents: status and response coordination

Secret reference routes expose references and lifecycle metadata, not raw secrets.

## Developer Scope

Use `openapi.custom-gpt.developer.yaml` for API client and integration management.

Functional use:

- Developer apps: registered client/integration metadata
- API credential creation/revocation: per-user or per-integration auth lifecycle
- Webhooks: outbound event delivery configuration
- Rate limit rules: quota and abuse-control policy

Per-user API keys should be created here when moving from shared admin backend auth to user-scoped integrations.

### Make.com integration — two distinct connection types

Make.com has two registered adapters and two `app_integrations` catalog entries. Pick the correct one for the task:

| app_key | Auth | Transport | Use |
|---|---|---|---|
| `makecom` | `Authorization: Token <api_key>` | REST `/api/v2/` | Manage scenarios, watch scenario state, trigger via webhooks |
| `makecom_mcp` | Bearer token (URL or header) | JSON-RPC 2.0 `/mcp/stateless` | Enumerate and call Make.com MCP tools via the MCP protocol |

When connecting a user's Make.com account, decide first which type of work is needed. Create the connection via `POST /app-connections` with the correct `app_key`. The `makecom_mcp` adapter supports `mcp_initialize`, `mcp_tools_list`, and `mcp_tools_call` actions; `mcp_tools_call` requires explicit approval (`auto_approve: false`).

## Admin CLI Scope

Use `openapi.custom-gpt.admin-cli.yaml` only for high-risk platform-owner work.

Operations:

- `executeAdminControl`: raw admin control dispatcher — tool routing by `tool` field
- `executeHostingerApiCall`: direct Hostinger REST API proxy (`POST /admin/cli/hostinger`)

### Tool routing inside executeAdminControl

Pass `tool` to select the backend executor:

| tool | Purpose | Key fields |
|---|---|---|
| `github` | `gh` CLI on Cloud Run container | `command_args` |
| `gcloud` | `gcloud` CLI on Cloud Run container | `command_args` |
| `db` | Raw SQL against Hostinger MySQL | `sql`, `params` |
| `hostinger` | Hostinger REST API proxy | `path`, `method`, `request_body`, `api_key_ref` |
| `shell` | Allowlisted shell command by alias | `alias`, `extra_args` |

`hostinger` tool: `api_key_ref` is either `"shared_manager"` (uses `HOSTINGER_SHARED_MANAGER_01_API_KEY`) or `"cloud_plan"` (uses `HOSTINGER_CLOUD_PLAN_01_API_KEY`). `path` is the Hostinger API path, e.g. `/api/v1/vps`. Returns `{ status, ok, data }`.

`shell` tool: `alias` must match an entry in `ADMIN_SHELL_ALLOWLIST` on the Cloud Run environment. Enabled only when `ADMIN_SHELL_ENABLED=true`. Use `action: "list"` first to discover available aliases. For `action: "run"`, pass `alias` and optionally `extra_args` when `allow_extra_args=true` on that alias. Arguments with shell metacharacters are rejected.

This scope can broker GitHub CLI, Google Cloud CLI, remote DB control, Hostinger DNS/VPS/billing API, and allowlisted shell operations when backend policy allows it. Always prefer a specific governed endpoint when one exists. For destructive operations, require explicit user intent in the current conversation and preserve audit evidence.

## Ops Scope

Use `openapi.custom-gpt.ops.yaml` for release and registry maintenance checks.

Functional use:

- Release readiness: admin-side diagnostic evidence for platform deployability
- Release readiness history: prior readiness snapshots and regression context
- Entity classification upsert/list: registry maintenance for platform entities

Release readiness is diagnostic evidence; it does not replace hard activation provider probes.

## Connector Scope

Use `openapi.custom-gpt.connector.yaml` for break-glass operations when the primary Cloud Run API is unavailable.

The connector runs on the admin's local Windows machine and is reachable via Cloudflare Tunnel at `connector.mad4b.com`. It requires the same `BACKEND_API_KEY` bearer token as the main API and binds only to `127.0.0.1` — Cloudflare Tunnel is the sole entry point from the internet.

Key operations and functional use:

- `connectorHealth` (`GET /health`): check if the connector is alive; no auth required; returns hostname, platform, uptime. Call this first before any recovery operation.
- `connectorGithub` (`POST /github`): run `gh` CLI on the local Windows machine; use for pushing recovery commits, checking workflow status, or triggering deployments when Cloud Run is down. Pass `args` as an array or string.
- `connectorGcloud` (`POST /gcloud`): run `gcloud` CLI on the local Windows machine; use for restarting Cloud Run services, reading deployment logs, or triggering redeployments. Pass `args` as an array or string.
- `connectorShell` (`POST /shell`): run an allowlisted command by `alias`; use `action: "list"` to discover available aliases, `action: "run"` to execute. Only aliases in `CONNECTOR_SHELL_ALLOWLIST` are accepted.
- `connectorFiles` (`POST /files`): read or write files restricted to paths in `CONNECTOR_FILE_PATHS`; actions are `list`, `read`, `write`. Use to stage recovery files before pushing via `/github`.

When to use: Cloud Run is down or unhealthy, a deployment rollback is needed, a recovery commit must be pushed, or Cloud Run env/config must be checked when the admin API is unreachable.

When not to use: Cloud Run is healthy; prefer the primary admin scopes. Never use as a general-purpose shell — it is a break-glass surface.

Auth: `Authorization: Bearer <BACKEND_API_KEY>`. `/health` is unauthenticated.

The connector may also run on a spare Windows device using the same Cloudflare Tunnel ID. Multiple machines can share one tunnel simultaneously for redundancy.

## Privacy Policy URLs

Each scoped subdomain should serve public HTML privacy policy pages:

- `https://api.mad4b.com/privacy-policy`
- `https://identity.mad4b.com/privacy-policy`
- `https://customers.mad4b.com/privacy-policy`
- `https://systems.mad4b.com/privacy-policy`
- `https://logic.mad4b.com/privacy-policy`
- `https://observability.mad4b.com/privacy-policy`
- `https://developer.mad4b.com/privacy-policy`
- `https://admin.mad4b.com/privacy-policy`
- `https://ops.mad4b.com/privacy-policy`
- `https://status.mad4b.com/privacy-policy`
- `https://connector.mad4b.com/privacy-policy`

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

## Engineering And PR Rules

For platform code or API changes made through the Admin Assistant:

- API contracts must stay OpenAPI 3.1.
- Errors must use stable structured envelopes with machine-readable codes and bounded details.
- Preserve layering boundaries: `src/api`, `src/application`, `src/domain`, and `src/infrastructure`.
- Prefer small safe changes with validation, explicit errors, tests, and security review.
- Run API review when routes, schemas, auth, status codes, or error envelopes change.
- Run database review when migrations, SQL queries, indexes, persistence semantics, or registry rows change.
- Treat admin CLI, GCloud, GitHub, DB, provider transport, secrets, and auth work as security-sensitive.
- PR readiness must summarize scope, tests, risks, API/database impact, security notes, generated artifacts, and merge readiness checks.

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
