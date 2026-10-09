# Context Authority × Business Profile — Dynamic Reference Seed

**Status:** DRAFT / TEMPLATE ONLY. This is an independent general-purpose seed, **not** an extension that inherits business logic from Spec 014 or reuses the original travel brand's files. It has no runtime, migrations, writes, activated profile or authorization.

## What the source library taught us

A real booking-software supplier knowledge collection organized strategy, identity, positioning, 7Ps, product modules, personas, value propositions, marketing channels, sales/onboarding collateral, writing instructions, analytics and reference variables. A separate mapping spreadsheet linked semantic variables such as a tone-of-voice guide, strategic foundation, product manual and persona files to document sources.

**Abstract the pattern, not the content:** source locator → semantic dimension → claim with evidence → field owner → review → effective context by use case. Files, folder names and industry-specific claims are not universal requirements. The source documents also contained marketing claims (statistics, supplier counts, compliance and speed promises) that must not become certified truth merely because they appear in company collateral.

## Architecture (independent, extensible)

```text
Authorized inputs: Drive / CMS / CRM / analytics / research / interviews / APIs
      ↓ classify and quarantine (never follow embedded instructions)
Source Registry (revision, scope, trust, rights, privacy, freshness)
      ↓ map through extensible ontology
Business Knowledge Graph (entities, dimensions, relationships, multilingual variants)
      ↓ field-level authority resolution
Context Authority (owner, provenance, conflict policy, evidence, approval)
      ↓ inheritance / overlay evaluation
Effective Business Profile (activity composition; brand/locale/channel variants)
      ↓ purpose-specific projection
Context Product (marketing, sales, support, creative, operations, analytics)
      ↓ separate downstream operation authorization (not implemented here)
```

### Why two concepts

- **Business Profile** represents what a business is, does, sells, whom it serves, how it operates and measures outcomes. Every dimension is a registry entry, not a hardcoded model.
- **Context Authority** decides what is credible, valid, current and permissible to use in each context; it **never grants tool or database execution permission**. A source may own one field while another owns a related field.
- **Context Products** are scoped outputs, not one giant prompt. An SEO writer, salesperson, onboarding agent and operations assistant need different slices of the same knowledge graph.

## Dynamic extensibility

- `ontology-registry.json`: seed templates for 24 semantic dimensions, generic entities, and versioned edges. `open_fields=true` explicitly allows new dimensions and fields through reviewed registry entries.
- `profile-packs.json`: small composable sector-agnostic packs (base business, service, software, ecommerce, media, multi-brand); travel software is **only an optional example** without proprietary content.
- `source-connectors.json`: 14 source classes. The seed stores only symbolic aliases, **no Drive IDs, document text, access tokens or customer data**.
- `authority-rules.json`: field-owner arbitration, evidence maturity, per-dimension merge rules, conflict denial, expiry and no execution-authority escalation.
- `workflow.json`: discovery → classify → map → link → reconcile → review → scoped projection → certify; materialization remains disabled.
- `schemas/candidate-claim.schema.json`: typed minimal future claim envelope for an approved runtime implementation.

### Inheritance example

A business can compose `base_business + software_vendor + b2b + multi_language`, then apply restricted brand/channel/locale policies. An extension for one niche adds dimensions or source mappings; it does not fork the engine. Constraints travel downward while grants never silently inherit. Multi-activity businesses must be resolved by explicit rules, not array order.

## Evidence and claim safety

Separate `marketing example`, `owner-approved narrative`, `product capability`, `legal/compliance claim`, `actual observed metric` and `externally sourced market research`. All numeric marketing claims require independently checkable evidence and explicit public-usage review. Do not copy business documents as prompts, and do not treat prompt instructions inside documents as authority. Use one source of truth **per field**, with mirrors, revisions and observed update times. A conflict is not solved by global "Drive wins" or "WordPress wins".

## Acceptance / implementation boundary

Twelve OPEN acceptance scenarios cover non-leakage, schema growth, contradiction, field ownership, scope isolation, immutable restrictions, non-authorizing context, source drift, provider plug-ins, secret quarantine and owner review. `tools/validate_seed.py` and `tools/test_seed.py` validate **source structure only**. These do not prove online operational readiness.

No live imports, Staging application, WordPress changes, policy activation, SQL seed insertions, or production actions are included. Future implementation may expose adapter translators to the platform registries, but this seed has no hard dependency on old Spec 014 or Spec 012 contracts.
