# DFR-004 — Dynamic Commercial and FinOps Transaction

## Status

**Approved design. Implementation is not authorized.**

The platform adopts a **Reservation-First Double-Entry Commercial Transaction with Registry-Driven Billing, Metering, Rating, and User-Configurable Billing Profiles**.

Commercial configuration is database-authoritative. Billing models, collection modes, units, meters, rating models, price books, profile templates, allowed customization fields, entitlements, quotas, budgets, grace/past-due behavior, and lifecycle rules resolve from versioned registries and scoped policy records. Runtime code executes registered semantics; it does not hardcode customer-specific prices, meter families, billing models, or commercial exceptions.

No runtime enforcement, database migration, provider charge, invoice issuance, payment collection, external write, or production cutover is authorized by this document.

## 1. Authoritative commercial sequence

```text
Commercial context resolution
→ billing owner/account resolution
→ entitlement decision
→ meter/unit/rating resolution
→ included-unit and discount resolution
→ cost estimate
→ atomic reservation
→ execution
→ usage and outcome verification
→ settlement
→ release of unused reservation
→ refund / adjustment / dispute
→ cost attribution and statement projection
```

Authorization, data-use eligibility, commercial entitlement, quota, budget, payment standing, reservation availability, and execution readiness are independent mandatory planes. Success in one does not compensate for failure in another.

## 2. Database-driven configuration model

The design uses typed registries and specialized records rather than hardcoded enums or unrestricted EAV.

Initial registries include:

```text
billing_model_registry
collection_mode_registry
usage_unit_registry
usage_meter_registry
usage_meter_version_registry
meter_aggregation_mode_registry
rating_model_registry
price_book_registry
price_book_versions
price_book_rate_lines
billing_profile_template_registry
billing_profile_customization_field_registry
commercial_policy_operator_registry
commercial_state_transition_registry
currency_registry
credit_unit_registry
commercial_reason_code_registry
```

Each registry row is versioned, effective-dated, status controlled, schema bounded, and checksum protected. New billing models, meter families, units, rating models, or profile options require compatibility, security, accounting, and migration review before activation.

Runtime must reject unknown keys, unsupported combinations, stale versions, ambiguous profile resolution, and unregistered formulas.

## 3. Billing models

Billing models are registry rows. Initial active model families are:

### 3.1 Credits

```text
billing_model_key = credits
```

Credits are internal non-currency units. They may be purchased, granted, promoted, expired, reserved, consumed, released, refunded, or adjusted according to the active credit-unit policy.

Credits are never silently treated as USD or another currency. Conversion between credits and money requires an explicit, versioned conversion contract and price source.

### 3.2 Direct monetary billing

```text
billing_model_key = direct_currency
```

Money is represented with:

```text
amount_minor
currency_key
currency_exponent
```

Initial collection modes are registry-driven:

```text
prepaid_balance
postpaid_invoice
```

Prepaid reserves available monetary balance. Postpaid reserves credit-limit liability before producing an invoice line.

### 3.3 Future billing models

Future models such as committed-spend, subscription-only, outcome-share, hybrid credits-plus-money, or reseller settlement may be added only through registered model/version contracts. Runtime code must not require a code deployment merely to add an approved data-defined model whose semantic engine already exists.

## 4. User-configurable billing profiles

Users receive controlled customization through versioned billing profiles, not arbitrary price or ledger mutation.

### 4.1 Profile hierarchy

```text
Platform commercial hard bounds
→ billing-account contract
→ subscription / plan profile
→ Tenant commercial policy
→ Brand / Workspace delegated budget profile
→ capability / meter override
→ user-selected eligible billing profile
→ user presentation and alert preferences
```

The most restrictive applicable limit wins. A lower scope may choose among eligible options or tighten controls but cannot weaken contract, payment, accounting, tax, security, anti-fraud, legal, or Platform hard bounds.

### 4.2 User-selectable fields

When the governing template marks them customizable, a user may choose or configure:

```text
preferred eligible billing model
preferred eligible collection mode
preferred presentation currency
budget alert thresholds
soft-stop / hard-stop preference within allowed bounds
cost-center or attribution tags
included meter bundle preference
statement grouping
invoice or usage display granularity
notification cadence and channels
approval threshold preference within parent limits
preferred reservation ceiling below the authorized maximum
```

A user cannot:

- invent prices, currencies, units, meters, rating formulas, tax rules, FX rates, or ledger accounts;
- select a billing model not allowed by the billing account or contract;
- raise budget, quota, credit limit, overage ceiling, or grace rights beyond delegated authority;
- change the billable owner;
- alter posted ledger entries;
- switch billing asset type after execution begins;
- use profile customization to bypass approval, entitlement, past-due, fraud, or risk controls.

### 4.3 Profile resolution

Each profile records template/version, owner scope, selected billing model, collection mode, meter bundle, rating/price references, allowed customization values, limits, approvals, lifecycle, and checksum.

Equal-ranked incompatible profiles block with explanation. Missing mandatory profile evidence fails closed.

## 5. Billing owner and account

Each cost-bearing operation resolves:

```text
execution_tenant_id
billing_account_id
billable_owner_tenant_id
commercial_relationship_binding_id (optional)
```

The billable owner may differ from the execution Tenant only through a direct, active, non-transitive commercial relationship such as `bills_for` or an approved managed-service contract.

Ownership, management, support, or white-label relationships do not imply billing responsibility. Exactly one billable owner must resolve for each reservation; missing or ambiguous ownership blocks.

Attribution to Workspace, Brand, Department, Group, Campaign, Objective, Principal, or customer project does not create liability or access authority.

## 6. Multi-dimensional metering

Tokens are one meter family, not the platform-wide usage unit.

### 6.1 Meter families

Initial registry-driven families include:

```text
operation_count
time_duration
data_volume
storage_time_integral
compute_resource
ai_text
ai_image
ai_audio
ai_video
retrieval_vector
active_seat_or_entity
capacity_concurrency
communication_channel
business_operation
verified_outcome
```

Representative meters include:

```text
api_call
workflow_run
agent_run
document_processed
page_processed
human_review_minute
agent_runtime_second
audio_input_second
video_output_second
data_ingested_byte
network_egress_byte
storage_byte_hour
vcpu_millisecond
memory_megabyte_second
gpu_millisecond
input_token
cached_input_token
output_token
embedding_token
image_generation
image_megapixel
transcription_second
speech_generation_character
vector_write
vector_query
retrieved_chunk
active_seat_day
active_agent_day
concurrent_agent_slot
email_sent
sms_segment
webhook_delivery
lead_enriched
report_generated
qualified_lead
booked_meeting
resolved_ticket
```

The actual active catalog is always read from `usage_meter_registry` and its versions.

### 6.2 Units

Units resolve through `usage_unit_registry` with:

```text
unit_key
unit_family
canonical_unit_key
conversion_numerator
conversion_denominator
quantity_scale
rounding_policy
minimum_billable_increment
display_symbol
```

Quantities use integers or scaled integers, never binary floating point.

Storage and data volume use explicit byte-based canonical units. Display values must distinguish decimal and binary representations rather than using ambiguous `GB` semantics.

### 6.3 Aggregation modes

Registered aggregation modes include:

```text
sum
maximum
minimum
latest
unique_count
duration
time_integral
verified_count
```

The mode is part of the meter version and cannot be changed retroactively for already measured events.

### 6.4 Technical and billable meters

Technical consumption and customer billing may differ.

Example:

```text
technical meters:
  input_token
  output_token
  vector_query

billable meter:
  document_analysis
```

Technical events support provider-cost, quality, capacity, and margin analysis. Billable records are derived through an approved rating and packaging policy. Raw measurements remain immutable and explainable.

### 6.5 Composite meters

Composite meters package multiple technical meters into a customer-facing unit. Their versioned definitions list components, formula/operator, inclusion rules, rounding, verification, and checksum.

Composite meters do not delete or overwrite their component events and may not execute arbitrary SQL, JavaScript, shell, or freeform expressions. Only registered typed operators are allowed.

## 7. Meter event and billable usage lifecycle

A raw meter event contains:

```text
meter_event_id
tenant_id
billing_account_id
operation_id
manifest_id
meter_key
meter_version
unit_key
quantity_scaled
measurement_started_at
measurement_ended_at
source_authority
source_event_id
deduplication_key
verification_status
evidence_checksum
```

Lifecycle:

```text
received
→ validated
→ normalized
→ verified|rejected|review_required
→ aggregated
→ rated
→ billable|included|non_billable|disputed
→ settled
```

Duplicate source events must not create duplicate usage. Corrections append a new correction event and never mutate the original event.

Late events are processed only within the meter version's late-event policy and may create an adjustment rather than rewriting a closed statement.

## 8. Rating and price books

Measurement is separate from rating and settlement.

```text
raw usage
→ normalized quantity
→ included-unit deduction
→ package / tier / commitment application
→ billable quantity
→ credits or monetary charge
```

Registered rating models may include:

```text
flat
per_unit
tiered_graduated
tiered_volume
package
minimum_commitment
included_then_overage
time_of_use
outcome_based
pass_through_plus_margin
```

Price books are versioned and effective-dated. Each rate line binds an eligible billing model, meter/version, unit, quantity range, price, tax/discount treatment, rounding, minimum increment, currency or credit unit, contract scope, and validity.

No price or rating change applies retroactively to an already reserved operation.

## 9. Included usage, bundles, and overage

Included plan usage is a benefit applied before charge calculation, not a third settlement asset.

```text
measured quantity
- eligible included quantity
= billable quantity
```

Included units are scoped by meter/version, billing account, subscription, period, carry-over policy, and profile. They cannot be applied to an unrelated meter by display-name similarity.

Overage defaults to denied. When allowed, the policy records ceiling, price/version, approval threshold, hard maximum, notification thresholds, and applicable billing model.

## 10. Estimate

A cost estimate is immutable and versioned. It contains separate lines for:

```text
raw meter quantity
normalized quantity
included quantity
billable quantity
expected and maximum authorized units
expected and maximum customer charge
expected provider/internal cost
tax
discount
credit offset
billing model
collection mode
currency or credit unit
price-book and rating versions
confidence
expiry
```

Provider/internal cost and customer charge are separate concepts. A provider cost does not automatically become customer liability.

## 11. Atomic reservation

Every consequential cost-bearing operation requires an active reservation unless the registered commercial policy explicitly permits bounded postpaid metering.

Reservation state:

```text
pending
→ active
→ partially_consumed
→ settled
```

Terminal alternatives:

```text
released
expired
cancelled
invalidated
```

Rules:

- idempotency key plus request checksum identifies one logical reservation;
- the same key with different input returns conflict;
- reservation creation atomically consumes available budget, quota, credit units, prepaid money, or postpaid liability capacity;
- available capacity subtracts posted settlements, active reservations, and unresolved committed liabilities;
- concurrency uses row locking, atomic conditional update, or version compare-and-swap, never an unprotected read-then-write;
- reservation binds one billing asset type and cannot switch between credits and money after execution begins;
- streaming or unknown usage uses bounded reservation windows and explicit extension;
- failed extension stops further cost-bearing work at the next safe boundary;
- expiry, commercial epoch drift, billing-account suspension, or manifest mismatch blocks dispatch.

## 12. Currency, credits, and FX

Money, credits, and usage units are separate assets.

- a monetary ledger entry uses one registered currency;
- a credit ledger entry uses one registered credit-unit key;
- a usage event uses one registered usage unit;
- one ledger transaction cannot balance credits against money;
- conversion requires an explicit registered conversion contract and quote/version;
- FX quotes record currencies, rate, source, quoted/expiry time, and checksum;
- the customer-authorized price is locked at reservation;
- unauthorized provider-cost or FX drift is absorbed or reviewed and is not silently charged to the customer.

Refund returns to the original settlement asset by default.

## 13. Execution verification and settlement

Settlement requires:

```text
execution evidence
+ verified meter evidence
+ billability policy
+ reservation
+ price/rating version
+ outcome verification where required
```

Allowed settlement classifications include:

```text
full_charge
partial_charge
included_usage_only
zero_customer_charge
platform_absorbed_cost
manual_review
```

Settlement is logically idempotent, linked to the exact operation, manifest, reservation, billing owner, and evidence set. It cannot exceed the authorized amount or units without a separately approved overage reservation.

Unused reservation is released automatically after settlement.

## 14. Double-entry ledger

Commercial posting is append-only and double-entry.

```text
sum(debits) = sum(credits)
```

Ledger account families may include:

```text
customer_credit_available
customer_credit_reserved
customer_credit_consumed
customer_cash_balance
customer_reserved_funds
accounts_receivable
customer_usage_expense
platform_provider_cost
platform_revenue
tax_payable
discount_expense
refund_liability
```

Posted entries are never updated or deleted. Refund, correction, dispute, chargeback, expiry, or reconciliation creates compensating entries.

`credit_balances`, `credit_ledger`, `tenant_usage`, and similar current tables remain compatibility inputs/projections during migration. Rebuildable balance projections are not the accounting source of truth.

## 15. Refunds, adjustments, disputes, and chargebacks

Lifecycle:

```text
requested
→ eligible|rejected|review_required
→ approved
→ posted
→ completed|failed
```

A refund cannot exceed the net settled customer charge after prior refunds. Provider refund and customer refund are separate events. Every adjustment records source transaction, reason code, authority, approval, currency/credit unit, amount, tax effect, and evidence.

Closed ledger periods are not rewritten; late corrections create current-period adjustment entries linked to the original event.

## 16. Grace, past-due, paused, and cancelled behavior

Standing and behavior are registry-driven by billing-account policy.

Recommended defaults:

- `active` and `trialing`: operate within entitlements, quotas, budgets, and reservations;
- `grace`: preserve read/export/recovery and allow only explicitly bounded new reservations;
- `past_due`: block new cost-bearing reservations by default while allowing payment recovery, legal export, and support flows;
- `paused` or `cancelled`: block new reservations, release unexecuted reservations, and settle already incurred authorized cost;
- fraud/security freeze may be stricter than commercial grace.

Policies cannot erase posted financial evidence or block mandatory legal export solely because of past-due status.

## 17. Effective Runtime Manifest linkage

The manifest binds:

```text
commercial_decision_id
billing_account_id
billable_owner_tenant_id
billing_profile_id/version
billing_model_key/version
collection_mode_key/version
entitlement snapshot/version
meter definitions and versions
unit definitions and versions
rating model/version
price-book/version
estimate ID/checksum
reservation ID/checksum
authorized amount and units
currency, credit unit, and FX quote where applicable
budget/quota policy versions
overage and standing policy
commercial epoch
expiry
```

Before dispatch, runtime revalidates reservation state, manifest match, billing account standing, commercial epoch, expiry, and authorized scope. The manifest is evidence, not a financial mutation authority.

## 18. Proposed database authorities

```text
billing_accounts
billing_owner_assignments
commercial_relationship_bindings
billing_model_registry
collection_mode_registry
billing_account_model_bindings
billing_profile_template_registry
billing_profile_customization_field_registry
billing_profiles
billing_profile_selections
billing_profile_meter_rules
billing_profile_alert_rules
currency_registry
credit_unit_registry
credit_conversion_contracts
fx_quote_registry
usage_unit_registry
usage_meter_registry
usage_meter_versions
usage_meter_dimension_registry
meter_aggregation_mode_registry
usage_meter_events
usage_meter_event_corrections
usage_meter_aggregates
composite_meter_definitions
composite_meter_components
usage_verification_runs
billable_usage_records
rating_model_registry
price_book_registry
price_book_versions
price_book_rate_lines
commercial_entitlement_decisions
runtime_cost_estimates
runtime_cost_estimate_lines
runtime_cost_reservations
runtime_cost_reservation_lines
runtime_cost_settlements
runtime_cost_settlement_lines
commercial_ledger_accounts
commercial_ledger_transactions
commercial_ledger_entries
commercial_refund_adjustment_runs
usage_dispute_runs
invoice_accounts
invoice_runs
invoice_lines
payment_collection_events
cost_attribution_ledger
commercial_policy_epochs
commercial_balance_projections
```

Specialized authorities remain specialized. Registries define semantics, compatibility, and allowed customization without becoming an unrestricted generic financial write surface.

## 19. API direction

```text
GET  /tenant/billing/models
GET  /tenant/billing/collection-modes
GET  /tenant/billing/profile-templates
GET  /tenant/billing/profiles
POST /tenant/billing/profiles
PATCH /tenant/billing/profiles/{profileId}
POST /tenant/billing/profiles/{profileId}/preview
POST /tenant/billing/profile-selections
DELETE /tenant/billing/profile-selections/{selectionId}
GET  /tenant/usage/meters
GET  /tenant/usage/meters/{meterKey}/versions
GET  /tenant/usage/units
GET  /tenant/usage/summary
GET  /tenant/usage/events
POST /tenant/commercial-entitlement-decisions/preview
POST /tenant/runtime-cost-estimates
POST /tenant/runtime-cost-reservations
GET  /tenant/runtime-cost-reservations/{reservationId}
POST /tenant/runtime-cost-reservations/{reservationId}/extend
POST /tenant/runtime-cost-reservations/{reservationId}/release
GET  /tenant/runtime-cost-settlements/{settlementId}
GET  /tenant/commercial-statements
GET  /tenant/cost-attribution
POST /tenant/usage-disputes
GET  /tenant/usage-disputes/{disputeId}
```

Profile and estimate previews perform no reservation, charge, invoice, payment, provider call, credential read, or external write.

Mutations require exact object-level authority, template/version preconditions, bounded schemas, idempotency, audit, commercial-epoch invalidation, approval where required, and same-cycle readback.

## 20. Stable blocking conditions

```text
BILLING_MODEL_MISSING
BILLING_MODEL_AMBIGUOUS
BILLING_MODEL_NOT_ALLOWED
COLLECTION_MODE_NOT_ALLOWED
BILLING_PROFILE_MISSING
BILLING_PROFILE_AMBIGUOUS
BILLING_PROFILE_FIELD_NOT_CUSTOMIZABLE
BILLING_OWNER_MISSING
BILLING_OWNER_AMBIGUOUS
BILLING_ACCOUNT_NOT_ACTIVE
COMMERCIAL_ENTITLEMENT_MISSING
COMMERCIAL_ENTITLEMENT_DENIED
METER_NOT_REGISTERED
METER_VERSION_MISSING
UNIT_NOT_REGISTERED
UNIT_NOT_ALLOWED_FOR_METER
METER_QUANTITY_INVALID
METER_EVENT_DUPLICATE
METER_SOURCE_NOT_AUTHORIZED
METER_EVIDENCE_MISSING
METER_EVENT_TOO_LATE
COMPOSITE_METER_COMPONENT_MISSING
OUTCOME_NOT_VERIFIED
PRICE_BOOK_MISSING
PRICE_BOOK_VERSION_STALE
RATING_MODEL_NOT_ALLOWED
CURRENCY_NOT_SUPPORTED
FX_QUOTE_REQUIRED
FX_QUOTE_EXPIRED
CREDIT_CURRENCY_CONVERSION_NOT_ALLOWED
COST_ESTIMATE_EXPIRED
COST_ESTIMATE_STALE
RESERVATION_REQUIRED
RESERVATION_EXPIRED
RESERVATION_INSUFFICIENT
CREDIT_BALANCE_INSUFFICIENT
MONETARY_BALANCE_INSUFFICIENT
INVOICE_CREDIT_LIMIT_EXCEEDED
BUDGET_EXCEEDED
QUOTA_EXCEEDED
OVERAGE_NOT_ALLOWED
COMMERCIAL_APPROVAL_REQUIRED
COMMERCIAL_ACCOUNT_PAST_DUE
IDEMPOTENCY_CONFLICT
SETTLEMENT_ASSET_TYPE_MISMATCH
SETTLEMENT_EVIDENCE_MISSING
SETTLEMENT_EXCEEDS_AUTHORIZED_AMOUNT
REFUND_EXCEEDS_SETTLED_AMOUNT
COMMERCIAL_EPOCH_CHANGED
```

## 21. Hard invariants

- Commercial configuration is registry-driven and database-authoritative.
- Runtime does not hardcode customer-specific prices, meters, units, models, or exceptions.
- User customization is constrained by an approved template and field allowlist.
- Credits, money, and usage units are distinct assets.
- Tokens are one meter family, never the universal billing unit.
- Measurement, billable usage, rating, reservation, and settlement remain separately explainable.
- A cost-bearing operation cannot dispatch without a compatible active reservation unless an explicit bounded postpaid policy allows it.
- One reservation binds one billing owner, one billing model, one asset type, one manifest, and one commercial epoch.
- Posted ledger entries are immutable and balanced.
- Provider/internal cost and customer charge remain separate.
- Attribution does not create liability or authority.
- Missing, stale, conflicting, ambiguous, or unregistered commercial evidence fails closed.

## 22. Acceptance examples

- A user chooses Credits instead of direct currency because both are allowed by the billing-account template; preview shows the different price and reservation asset before activation.
- A user attempts to select postpaid invoicing where the contract permits prepaid only; profile validation blocks without changing billing state.
- A Tenant admin defines a lower monthly budget and alert threshold for a Workspace; the lower limit is effective while the parent contract ceiling remains unchanged.
- A user cannot edit a price, tax rule, FX rate, ledger account, or non-customizable template field.
- Technical token and vector-query events are rated into one customer-facing `document_analysis` meter while raw events remain queryable and immutable.
- Audio, video, storage, compute, seats, API calls, messages, and verified business outcomes use their own registered units and aggregation modes.
- Two concurrent operations cannot reserve the same remaining balance or quota.
- A streaming Agent operation extends reservation windows and stops at the next safe boundary when extension is denied.
- A provider cost exceeds estimate without authorized overage; the customer charge remains capped and the difference enters review or Platform-absorbed cost.
- Credits cannot settle a monetary reservation and money cannot settle a credit reservation.
- A late meter event after statement close creates an adjustment rather than rewriting the closed period.
- A past-due account cannot create a new cost-bearing reservation but may access payment recovery and legally required export.
- A profile, price-book, meter, contract, or standing change advances the commercial epoch and invalidates stale manifests.

## 23. Migration and compatibility

Existing `plans`, `subscriptions`, `entitlements`, `credit_balances`, `credit_ledger`, `usage_limits`, `tenant_usage`, `usage_meters`, `quota_rules`, and `budget_quota_authority_registry` remain authoritative inputs or compatibility projections until shadow parity, ledger reconciliation, balance rebuild, concurrency tests, accounting review, and cutover certification pass.

The first implementation phase is read-only registry projection and preview. No posted balance or historical ledger is rewritten during design adoption.

## 24. Final decision

> **Dynamic Reservation-First Double-Entry Commercial Transaction.** The platform supports database-registered billing models, initially Credits and Direct Monetary Billing, database-registered collection modes, multi-dimensional meters and units beyond tokens, typed rating models, versioned price books, and user-configurable billing profiles constrained by contract and policy. Every consequential cost-bearing operation resolves one billing owner and profile, estimates and atomically reserves one asset type, executes against one manifest and commercial epoch, verifies usage/outcome evidence, settles through an immutable balanced ledger, releases unused capacity, and records refunds or adjustments as compensating entries. Missing, stale, ambiguous, conflicting, or unregistered commercial evidence fails closed.
