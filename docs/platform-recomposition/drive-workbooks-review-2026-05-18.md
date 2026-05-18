# Production Drive Workbooks Review - 2026-05-18

This document records the current workbook review evidence for Drive folder `1gNYX47P4TNuMXEbWvLNCvV4XRocH41K2` (`Production`).

It is a staging note, not runtime authority.

## Evidence sources used

- Current governed Drive probe: connectivity succeeded, but the available probe response only returned a sample count, not a full live folder listing.
- Stored SQL evidence in `json_assets` from previous `listDriveFiles` traces for the same folder.
- Stored `getSpreadsheet` metadata captures in `json_assets`.
- SQL runtime mirror/census for registry surfaces.

## Folder workbook inventory

| Workbook | Spreadsheet ID | Captured sheet count | Current role assessment |
|---|---|---:|---|
| Growth Intelligence OS - Registry Workbook | `1RV185rQo58pGppg27r81eD9hPE8pXPyBY1pfHANip4o` | 48 | Legacy registry workbook; SQL mirror is runtime authority. Keep as recovery and human audit surface. |
| Activity Log | `1Ksge5czL99W7nwm8XxNT9X34mBoxWcl4gPOBbgamNDw` | 7 | Operations/audit workbook. SQL `execution_log`, `audit_log`, telemetry, and session tables should remain runtime authority. |
| Tourism Growth Intelligence Layer | `16uSyKEWEn_vQwfp0Sx393a4hhZhwJfuptYBKrXNurUY` | 0 captured | Workbook exists in folder listing, but no sheet metadata capture was found in SQL evidence. Requires live read or recovery capture. |
| AllRoyalEgypt Publish Preparation Store | `1hX7a6RQzaJ1FP0z8xN9Krds4VluqilkSRAxYXHKR4sE` | 15 | Brand/site publishing preparation workbook. Treat as brand-specific planning/import surface, not global runtime authority. |
| Logic Sanitization Audit & Generalization Registry | `1TUJ92hJW3KR-_73tA7j7Bjli8DtcFTRHJXc-6R5lsBY` | 3 | Logic sanitation/audit workbook. Compare with SQL `logic_definitions`, `logic_packs`, and related governance rows before promotion. |
| Growth Intelligence OS - Operations Workbook | `1D0uiZteobSqPL9c6zygq3UVWTe56H3R7IHL1yJcwP5k` | 10 | Operations/control workbook. Should become dashboard/review helper, not runtime routing authority. |
| Business Live Data Hub | `1BQz5KIcub66n6PQf_Qui9wkYVt8WsiyUGEocNbDddTc` | 6 | Live signal/feed workbook. Requires classification against analytics warehouse and connector feeds. |
| Business Metrics Warehouse | `1NsQ2dfGKpNX12k3LoclPvscW3kSyB5_anuXDLd1fgJs` | 9 | Metrics warehouse workbook. Should be mapped to SQL/warehouse tables or retained as historical mirror. |

## Captured sheet titles

### Growth Intelligence OS - Registry Workbook

Captured sheets:

- Actions Registry
- Activation Bootstrap Config
- Actor Role Capability Registry
- API Actions Endpoint Registry
- API Endpoint Registry Repair Staging
- Brand Core Asset Intake
- Brand Core Registry
- Brand Core Write Rules
- Brand Path Resolver
- Brand Registry
- Business Activity Type Registry
- Business Intelligence Scoreboard
- Business Type Knowledge Profiles
- Conversation Starter
- Conversation Starters - Main
- Conversation Starters - System
- Decision Engine Registry
- Engines Registry
- Execution Access Resolution Registry
- Execution Bindings
- Execution Chains Registry
- Execution Policy Registry
- Field Contract Registry
- Growth Loop Engine Registry
- Hosting Account Registry
- JSON Asset Registry
- Knowledge Graph Node Registry
- Logic Canonical Pointer Registry
- Logic Knowledge Profiles
- Plugin Inventory Registry
- Registry Surfaces Catalog
- Relationship Graph Registry
- Repair Mapping Registry
- Request Envelope Model Adapter Registry
- Review Component Registry
- Review Stage Registry
- Row Audit Conflict Review
- Row Audit Decision Layer
- Row Audit Overrides
- Row Audit Rules
- Row Audit Schema
- Site Runtime Inventory Registry
- Site Settings Inventory Registry
- System Enforcement
- Task Routes
- Validation & Repair Registry
- Variable Contract Registry
- Workflow Registry

SQL mirror note: the platform data-source census reported all 18 mapped registry surfaces seeded in SQL. The workbook remains recovery/human-audit authority, not runtime authority.

### Activity Log

Captured sheets:

- Anomaly Detection
- Dashboard
- Execution Log Unified
- Governance Import
- Query Engine Events
- Repair Execution Import
- System Enforcement Events

### AllRoyalEgypt Publish Preparation Store

Captured sheets:

- 00_README
- 01_INDEX
- 10_TOURS_POSTS
- 11_TOURS_TAXONOMIES
- 12_TOURS_FILTERS
- 13_TOURS_FORMS
- 14_TOURS_TEMPLATES
- 15_TOURS_MEDIA_MAP
- 16_TOURS_WPML_IMPORT
- 17_TOURS_CHILD_LINKS
- 20_SHARED_TAXONOMIES
- 21_SHARED_FILTERS
- 22_SHARED_FORMS
- 23_SHARED_TEMPLATES
- 90_LOOKUPS

### Logic Sanitization Audit & Generalization Registry

Captured sheets:

- Audit
- Gap_Analysis
- Normalization_Rules

### Growth Intelligence OS - Operations Workbook

Captured sheets:

- Autopilot Engine
- Business Intelligence Query Engine
- Business Scenario Simulation Engine
- Control Center
- Execution Decision
- Product Engine
- Review Task Queue
- Tourism AI Decision Engine
- Tourism Intelligence Control Center
- Tourism Strategy Autopilot

### Business Live Data Hub

Captured sheets:

- Brand Analytics Mapping
- GA Metrics Feed
- Live Data Sources
- Live Signal Rules
- real intelligence layer???
- Search Console Feed

### Business Metrics Warehouse

Captured sheets:

- Alert Snapshot
- Brand Daily KPI Summary
- Conversion Summary
- Execution Scoring Engine
- GA4 Data
- GSC Data
- Pipeline Performance Dashboard
- Revenue Summary
- SEO Daily Summary

### Tourism Growth Intelligence Layer

No stored sheet metadata capture was found in SQL evidence. This workbook should be live-read or recovered before any promotion decision.

## Required follow-up review

For each workbook and each sheet:

1. Capture current sheet metadata live through a governed Sheets read tool.
2. Capture headers and populated row counts.
3. Classify each sheet as one of:
   - SQL runtime authority mirror
   - recovery-only
   - human audit/review
   - brand-specific import/planning
   - deprecated/archive
   - candidate for migration
4. Compare rows against SQL tables or intended warehouse tables.
5. Produce a sheet-by-sheet repair plan before any runtime promotion.

## Immediate findings

- The Registry Workbook is already substantially represented in SQL runtime tables.
- The workbook folder still contains old canonical files (`system_bootstrap.md`, `prompt_router.md`, `module_loader.md`, `memory_schema.json`, `direct_instructions_registry_patch.md`), but repo root canonicals are now generated indexes and should not be replaced by Drive copies without canonical-source promotion.
- `Tourism Growth Intelligence Layer` is the most important evidence gap because the folder listing proves the workbook exists, but no metadata capture was found.
- The AllRoyalEgypt workbook is brand/site-specific and should not be promoted into global runtime contracts.
