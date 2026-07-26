# Brand Core Surface Authority Gate

## Purpose

This phase makes Brand Core evidence depend on `registry_surfaces_catalog` authority before the agent loop can treat Brand Core as resolved.

The Brand Core guard already blocks writing-like workflows when Brand Core evidence is missing. This change ensures that evidence is valid only when the Brand Core Registry surface itself is active, authoritative, and required for execution.

## Runtime flow

`agentLoopRunner.js` now resolves Brand Core like this:

```text
loadBrandCoreEvidence(brand_key)
→ resolveSurfaceAuthority(SURFACE_KEYS.BRAND_CORE_REGISTRY, { requireExecution: true })
→ query SQL brand_core only if surface authority passes
→ return ready=true only when rows exist
→ context.brand_core_resolved=true only when ready=true
→ evaluateAgentLoopPreflight(...)
```

If the surface authority check fails, the lookup returns secret-free failure evidence and `context.brand_core_resolved` remains false.

## Evidence contract

Successful evidence includes:

- `ready: true`
- `brand_key`
- `brand_name`
- `document_count`
- `active_document_count`
- `valid_document_count`
- `validation_statuses`
- `asset_types`
- `core_functions`
- `latest_updated_at`
- `surface_authority`
- `secrets_included: false`

Failed evidence includes:

- `ready: false`
- `brand_key`
- `resolution_error`
- `surface_authority` when available
- `secrets_included: false`

## Why this matters

The runtime no longer trusts table presence alone. It now follows the migrated governance chain:

```text
registry_surfaces_catalog
→ Brand Core Registry authority
→ brand_core evidence
→ Agent Loop Governance / Brand Writing Requires Brand Core
```

This is the same authority pattern already used by:

```text
registry_surfaces_catalog
→ Execution Policy Registry
→ execution_policies
→ governedExecutionPreflight
```

## Safety

The resolver does not expose raw Brand Core content, Drive links, file IDs, folder IDs, or worksheet IDs.
