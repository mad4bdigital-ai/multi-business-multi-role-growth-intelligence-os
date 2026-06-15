# Tenant Growth Dashboard Product

## Status

Implementation candidate on a governed work branch. Production deployment remains blocked until migration review, CI, development-environment validation, and explicit release approval complete.

## Product goal

The Tenant Growth Dashboard turns platform registries, connected-system state, Brand knowledge, tasks, signals, agents, and governed actions into a customer-facing growth cockpit.

The experience must answer five questions:

1. What changed?
2. What matters to this business?
3. What is blocked or missing?
4. What is the highest-impact next action?
5. Which platform capability can help safely?

## Customer experience

The same backend contract supports:

- Tenant GPT conversational navigation.
- Web and mobile dashboard renderers.
- Compact daily and weekly digests.
- Governed action previews and follow-up execution flows.

The default entry point is `tenant_today`. It presents a bounded summary, typed cards, growth guidance, and no more than three next-best actions.

## Runtime flow

```text
Signed tenant JWT
  -> tenant and user scope
  -> active/preferred workspace
  -> linked Brand and Brand Core readiness
  -> business activity and business type
  -> growth stage and primary goal
  -> relevant product tabs
  -> typed cards and data status
  -> growth guidance
  -> governed action previews
  -> feedback and result observation
```

SQL is the runtime read authority. Sheets remains an asynchronous mirror/recovery surface. Tenant/user identity always comes from the signed JWT.

## Product routes

- `GET /tenant/dashboard`
- `GET /tenant/dashboard/tabs/{tabKey}`
- `GET /tenant/dashboard/preferences`
- `PUT /tenant/dashboard/preferences`
- `GET /tenant/dashboard/digest`
- `GET /tenant/dashboard/actions/{actionRefKey}/preview`
- `POST /tenant/dashboard/recommendations/{recommendationId}/feedback`

Tenant activation through `GET /activation/session-context` includes a compact `product_guidance` overlay and a `dashboard_entry` pointer.

## Dynamic Tabs

The initial customer-facing tabs are:

- Today
- Growth Plan
- Customers & Leads
- Sales & Bookings
- Content & SEO
- Campaigns
- Reputation
- Tasks
- Operations
- Integrations
- Knowledge & Brand
- Reports

Tabs are selected and ordered by registry profiles, business activity, business type, goals, role/scope, connector readiness, Brand Core readiness, available data, and user preferences. The product must not return every operational tab to every customer.

## Typed cards

Cards expose stable IDs and renderer-friendly types such as KPI, score, status, task, connector status, recommendation, funnel, campaign, content opportunity, or lead opportunity.

Each card must preserve:

- title and interpretation
- value and unit when available
- metric identity when available
- status and comparison context
- source system and tenant-authorized scope
- observed time and freshness state
- confidence and partial-data markers
- authorized action references
- governed detail reference when hydration is deferred

Missing data is not zero. The valid states include unavailable, not connected, unknown, stale, partial, failed, and true numeric zero.

## Growth guidance

The product instruction layer leads with business outcomes and avoids internal table or registry terminology. It should:

- explain why the current signal matters
- identify the relevant platform capability
- identify readiness, connection, permission, or confirmation gaps
- rank impact, effort, and confidence
- expose no more than three next actions
- tailor commands and empty states to the resolved business activity

Initial profiles cover general businesses, travel/destination businesses, expert service firms, and B2B product suppliers.

## Actions and safety

Actions may be read-only, advisory, draft-only, or confirmation-required. Preview endpoints never execute providers or write business data.

Consequential execution remains subject to:

- route and workflow authority
- dependency readiness
- capability and action grants
- credential resolution
- Brand Core requirements
- explicit confirmation
- provider readback and audit requirements

## Preferences

Per-user tenant dashboard preferences include active container/tab, pinned and hidden tabs, date range, saved filters, dismissed alerts, favorite metrics, density, language, currency, timezone, and notification preferences.

## Feedback loop

Recommendation events record:

- shown
- opened
- accepted
- dismissed
- executed
- failed
- result observed

Feedback is tenant scoped, no-secret, and may include bounded context and observed metric outcomes. Dismissal reasons support relevance and timing improvements.

## Activation and transport

Tenant activation defaults to `response_profile=evidence`. It returns compact guidance and governed detail references instead of inlining all workspaces, tabs, sections, and rows.

Admin hard activation applies a response-budget projection that keeps the active container navigation and indexes other containers. If a response still exceeds the hard limit, governed chunk continuation is used; arbitrary string truncation is forbidden.

Activation lifecycle preserves validation, evidence preparation, delivery, and consumer acknowledgement as separate states.

## Persistence

Migration `20260615_tenant_growth_dashboard_product.sql` adds additive fields and creates:

- `tenant_dynamic_dashboard_preferences`
- `tenant_growth_recommendation_events`
- `growth_dashboard_metric_registry`
- `growth_dashboard_tab_profile_registry`
- `growth_dashboard_instruction_registry`

The migration also seeds product tabs, metric definitions, instruction profiles, and no-provider-write growth action references.

## Rollout

1. CI validates JavaScript syntax, tests, OpenAPI parsing, canonical source structure, and generated canonical output.
2. Review migration compatibility and query plans.
3. Deploy the branch to `dev.mad4b.com` only.
4. Apply the additive migration to the development database.
5. Run a signed Tenant JWT smoke for activation, dashboard, preferences, action preview, and feedback.
6. Measure response bytes and SQL query counts for admin and tenant activation.
7. Verify tenant isolation and no-secret responses.
8. Complete release-readiness review.
9. Merge and deploy production only after explicit approval.

## Rollback

Before production use, rollback is code-first: remove route mounting and product projection while retaining additive tables. Because feedback/preferences tables are additive and non-authoritative, they may remain dormant. Destructive table or column removal requires a separate reviewed migration and is not part of the initial rollback procedure.
