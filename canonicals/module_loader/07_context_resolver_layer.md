# Context Resolver Layer Loader Dependencies

## Required Inputs for resolveContext
The loader must supply these row collections to resolveContext:

- `activityTypeRegistryRows` — Business Activity Type Registry
- `profileRows` — Business Type Knowledge Profiles
- `brandRegistryRows` — Brand Registry
- `brandCoreRegistryRows` — Brand Core Registry
- `brandPathRows` — JSON Asset Registry brand path entries
- `jsonAssetRows` — JSON Asset Registry knowledge profile entries

## Loading Order
Load in this sequence to satisfy resolver dependencies:

1. Business Activity Type Registry
2. Business Type Knowledge Profiles (required for knowledge profile resolution)
3. JSON Asset Registry (required for JSON asset linkage in knowledge profile and brand path)
4. Brand Registry (required for brand core resolution)
5. Brand Core Registry (required for brand core doc resolution)
6. Registry Surfaces Catalog (required for surface resolution)

## Dependency Failure Handling
If Business Type Knowledge Profiles cannot be loaded:
- Mark context as `blocked_missing_profile_rows`
- Do not call resolveContext with an empty profileRows array when business_type_key is required

If Brand Registry cannot be loaded:
- resolveContext will return `brand_core: null`
- Brand-targeted write operations must be blocked at the operation level

## Completion Gate
The loader may call resolveContext only after all required row collections are loaded.
An empty row collection is valid input only when the corresponding key (business_type_key or brand_key) is absent from the request.
## Growth Intelligence Pilot Dependencies

Before loading `tenant_brand_growth_intelligence_pilot_v1`, the module loader must
resolve tenant scope, Brand Core, Business Activity Type, compatible engines, and
available evidence. Missing brand or activity authority blocks the workflow.

The loader must preserve read-only/dry-run mode through all downstream modules and
must not load provider-write or external-send capability for this workflow.

## Sequential Plan Loader Dependencies

Before a compiled step is marked ready, the loader must resolve the step workflow
identity, dependency completion state, required execution context, approval
policy, and compatible executor. Missing dependencies or ambiguous workflow
identity block the step instead of skipping it.
