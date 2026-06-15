# Tenant Growth Dashboard Product Contract

## Status

Implementation branch only. Not production-enabled until migration, tests, dev verification, PR review, and release readiness pass.

## Product purpose

The Tenant Growth Dashboard turns governed platform state into a customer-facing growth cockpit. It is available through Tenant GPT activation and through visual web/mobile renderers using the same backend contract.

The product answers five questions:

1. What changed?
2. What matters to the business?
3. What is blocked or missing?
4. What is the next best action?
5. Which governed platform capability can help?

## Runtime flow

```text
signed tenant JWT
  -> tenant and user scope
  -> active workspace and linked Brand
  -> business activity resolution
  -> Brand Core readiness
  -> growth goal and data readiness
  -> relevant Dynamic Tabs
  -> typed cards and growth guidance
  -> governed action preview
  -> explicit confirmation and runtime authority for consequential execution
  -> recommendation feedback and result readback
```

SQL remains runtime read authority. Google Sheets is an asynchronous mirror and recovery surface, not the runtime dashboard source.

## Public tenant surfaces

- `GET /activation/session-context` returns bounded `product_guidance` for a signed non-admin Tenant GPT principal.
- `GET /tenant/dashboard` returns the full customer-facing dashboard contract.
- `GET /tenant/dashboard/tabs/{tabKey}` returns one selected tab.
- `GET /tenant/dashboard/preferences` reads the signed-in user's dashboard state.
- `PUT /tenant/dashboard/preferences` replaces that user's dashboard state.
- `GET /tenant/dashboard/digest` returns a compact in-app or delivery-adapter digest.
- `GET /tenant/dashboard/actions/{actionRefKey}/preview` resolves readiness without execution.
- `POST /tenant/dashboard/recommendations/{recommendationId}/feedback` records recommendation lifecycle feedback and observed outcomes.

Tenant and user identity always come from the signed JWT. Request bodies must not override identity scope.

## Customer-facing tabs

The registry-backed initial product set is:

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

Tab selection is contextual. It considers business type, business activity, goal tags, data availability, Brand Core, role, and saved user preferences. The interface should normally display five to seven high-relevance tabs first and may expose the remainder through progressive disclosure.

## Today contract

Today is the default mobile and conversational entry point. It contains:

- key readiness and performance cards
- changed-since-last-visit attention items
- highest-priority gap or opportunity
- no more than three next-best actions
- quick commands
- links to relevant tabs and governed details

Today must not inline every operational row. Activation returns navigation and guidance; detailed rows remain cursor-loaded.

## Typed cards

Cards include:

- stable `card_id`
- `card_type`
- title, value, unit, and status
- stable metric key when applicable
- business interpretation
- related governed actions
- freshness and observation timestamp
- source system and tenant-authorized scope
- confidence and partial-data flags
- optional detail reference

Missing data is not zero. The renderer must distinguish `not_connected`, `unavailable`, `unknown`, `stale`, `partial`, and an observed numeric zero.

## Growth guidance

Tenant GPT instructions must:

- lead with business outcomes rather than registry terminology
- explain why a signal matters
- identify the capability that can help
- disclose readiness or blockers
- rank no more than three actions
- state impact, effort, confidence, and missing-data assumptions
- keep customer-facing content blocked when required Brand Core is unresolved

## Action governance

Actions may be:

- read-only
- advisory
- draft-only
- write-requires-confirmation

Preview never executes a provider. A consequential action requires same-cycle validation of:

- route and workflow authority
- tenant/object scope
- capability readiness
- required integrations and credentials
- Brand Core when applicable
- approval policy
- explicit confirmation
- success readback and failure recovery contract

## Preferences and feedback

Preferences store active container, active tab, pinned and hidden tabs, date range, filters, dismissed alerts, favorite metrics, density, language, currency, timezone, and notification choices.

Recommendation events support:

- shown
- opened
- accepted
- dismissed
- executed
- failed
- result observed

Dismissal reasons and observed metric values support future recommendation ordering. These records must not contain credentials, tokens, raw private conversations, or unrestricted provider payloads.

## Response budget

Tenant activation defaults to the `evidence` response profile. It returns one active container, relevant navigation, Today, guidance, and governed detail references. Large responses use the existing governed chunk-continuation contract.

Admin activation uses the same response budget semantics. When a full Dynamic Tabs manifest exceeds the hard budget, the runtime keeps active-container navigation and a compact container index instead of expanding every tab for every container.

## Migration and rollback

The migration is additive. It creates product registries, preference state, recommendation events, metrics, instruction profiles, tab profiles, and additive metadata columns on existing activation registries.

Rollback should first disable seeded product rows and route exposure. Physical column or table removal requires a separately reviewed destructive migration after data retention and export decisions.

## Release gates

Before merge or deployment:

- OpenAPI 3.1 parses and matches all public routes.
- Unit and contract tests pass.
- Tenant JWT isolation is verified.
- Migration applies cleanly on development DB and additive rollback strategy is recorded.
- `node build-canonicals.mjs` completes after canonical edits.
- Activation response sizes are measured for admin and tenant fixtures.
- PR merge preview reports no conflicts.
- Required CI checks pass.
- Dev deployment and tenant smoke verify navigation, cards, preferences, preview, feedback, and degraded states.
- Production deployment requires explicit release approval.
