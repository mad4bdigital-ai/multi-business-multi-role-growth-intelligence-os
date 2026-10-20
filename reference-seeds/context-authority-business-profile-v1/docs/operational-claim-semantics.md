# Operational claims and context authority — reusable semantic pattern

Status: DESIGN CANDIDATE. Not a product certification, connector permission, or deployment instruction.

## Evidence dimensions

When extracting source manuals, sales decks, interface screenshots, spreadsheets, or API documents, never treat their labels as equivalent to live operational truth.

- `source_maturity`: IDEA | DRAFT | MARKETING_EXAMPLE | PRODUCT_GUIDE | HISTORICAL_UI | HOST_OBSERVED.
- `claim_maturity`: MISSING | PROPOSED | DOCUMENTED | DEMONSTRATED | OWNER_APPROVED | INDEPENDENTLY_VERIFIED | STALE | CONTRADICTED | RETIRED.
- `feature_lifecycle`: PLANNED | PARTIAL | ENABLED_AT_SOURCE_DATE | BLOCKED | DEPRECATED | UNKNOWN_CURRENT_STATE.
- `field_sensitivity`: PUBLIC | INTERNAL | PERSONAL | FINANCIAL | SECURITY_SENSITIVE | CREDENTIAL_REFERENCE.
- `evidence_granularity`: document | section | page | image | control | field | transition | transaction | revision.
- `context_use`: analysis | internal_planning | marketing_copy | public_product_claim | regulated_claim | runtime_configuration.
- `scope`: tenant, business, brand, site, deployment, environment, locale, channel, supplier and effective date.

Each observation has an independently resolved source version and field owner; absent proof means CANDIDATE, not VERIFIED.

## State-machine safety

A generic platform may expose several orthogonal lifecycle machines for the same business object. Treat payment authorization, payment capture, booking reservation, fulfillment, refunds, customer communication and agent assignment as **different axes**.

State labels in the source are source-specific; do not globally equate `payment_succeeded` to `service_fulfilled` or `record_created` to `booked`. Preserve transition evidence, required permission, effect, reversibility and compensating operation.

## Feature verification

A feature mentioned in an old guide may be planned, disabled for a supplier/role/brand, or incompatible with a current runtime. To promote a public product claim require independent live readback matching exact site/environment/build, a time-bounded approved capability receipt and human/owner review. Historical screenshots can support user-interface ontology but cannot pass a release or product availability gate.

Treat lists of credential-setting field names as SECURITY_SENSITIVE metadata; never materialize secret values into the general-purpose seed.

## Reconciliation and priority

A 2023 product guide, later editable article and newer marketing deck may disagree. Date ordering alone does not establish authority. Determine per-field ownership, content maturity, source revision, live capability evidence and intended context; leave unresolved contradictions as CONTESTED.

## Seed usage

This document teaches *reusable semantics* and does not authorize hard-coded values, real product features, external writes, data reuse between tenants or publishing.
