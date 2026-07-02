# Dynamic Brand Workspace Context

## Purpose

`brand_workspace_context_resolve` is the shared read-only entry point for Admin and Tenant requests that identify a Brand by a human-facing value but require governed Workspace, Asset, CMS, or WordPress diagnostic identifiers.

The resolver avoids asking users for internal IDs when the platform can derive them from SQL authority.

```text
request Brand reference
  -> deterministic direct/cache match
  -> prompt candidate generation only when required
  -> deterministic canonical Brand validation
  -> principal and resource authorization
  -> Workspace / Asset / Brand Core / CMS context
  -> WordPress diagnostic handoff
```

The tool performs no provider call, mutation, external send, credential decryption, or secret return.

## Accepted references

One field is sufficient:

- `brand_name`
- `brand_ref`
- `target_key`
- `site_url`

Example:

```json
{
  "name": "brand_workspace_context_resolve",
  "tool_args": {
    "brand_name": "منصة ذكاء النمو"
  }
}
```

Unicode normalization preserves letters from all scripts. Arabic normalization removes marks and tatweel, normalizes common Alef/Ya/Hamza forms, and converts Arabic-Indic digits to ASCII digits. It does not translate a Brand name.

## Two-pass interpretation

Deterministic matching always runs first.

When the supplied value does not directly match an authorized Brand, the resolver returns:

```json
{
  "status": "interpretation_required",
  "skill": {
    "skill_key": "brand_reference_interpreter_v1",
    "role": "candidate_generation_only",
    "next_call_field": "candidate_refs"
  },
  "authorized_brand_catalog": []
}
```

The agent applies the registered text skill to the original value and the returned authorized catalog. It may generate up to eight spelling, spacing, script, or transliteration variants, then repeats the same tool call:

```json
{
  "name": "brand_workspace_context_resolve",
  "tool_args": {
    "brand_name": "اول رويال ايجيبت",
    "candidate_refs": [
      "all royal egypt",
      "allroyalegypt"
    ]
  }
}
```

`candidate_refs` are hints only. The backend must find an exact canonical registry match after normalization. The model cannot create a Brand, select authority, bypass ambiguity, or invent a valid `target_key`.

If the top deterministic score belongs to multiple Brands, the resolver returns `BRAND_MATCH_AMBIGUOUS` and does not select one arbitrarily.

## Tenant and Admin scope

### Tenant

Tenant identity comes only from the signed JWT.

Caller-supplied `tenant_id` and `user_id` are ignored. Before returning an interpretation catalog or resolved context, the tool requires:

- active membership; and
- Brand evidence from an authorized Workspace, Workspace Asset, effective resource grant, or active CMS site grant.

The prompt skill sees only the Tenant-authorized Brand catalog.

### Admin

Admin may pass explicit `tenant_id` and `user_id` diagnostic overrides. Without an override, Admin may resolve across the platform catalog, but downstream grants and connection metadata remain explicit in the response.

## Temporary cache

A successful mapping from the normalized requested value to a canonical `target_key` is cached in process memory for 15 minutes.

The cache:

- is an optimization only;
- stores no credentials;
- is scoped by principal/tenant context;
- is never authority;
- is accepted only when the cached Brand remains inside the currently authorized catalog;
- does not cache or bypass membership, grants, connection status, or WordPress diagnostics.

The response exposes only `cache_hit`, `cache_ttl_seconds`, and `cache_scope`.

## Virtual Assets

Missing `workspace_assets` rows do not erase existing governed evidence.

The resolver derives read-only virtual assets from:

- `brand_core`
- `cms_sites`

Virtual assets are marked:

```json
{
  "persisted": false,
  "derivation_status": "derived_read_only",
  "source_registry": "brand_core"
}
```

They are response projections only. The resolver does not backfill or mutate `workspace_assets`.

## Connection state

Connection evidence is split into independent states:

```json
{
  "configuration_status": "configured",
  "credential_status": "present",
  "authority_status": "authorized",
  "connectivity_status": "not_checked",
  "live_verified_at": null
}
```

A stored connection row is not live connectivity proof. Only a successful same-cycle `wordpress_auth_context_diagnostic` may change the operational interpretation to live verified.

The resolver returns safe metadata and `credential_material_present: true|false`; encrypted credentials, credential references, passwords, tokens, headers, and application passwords are never returned.

## Collation strategy

The live MariaDB schema contains both `utf8mb4_unicode_ci` and `utf8mb4_uca1400_ai_ci` tables. This resolver does not trigger a broad schema conversion.

Known cross-family CMS relations are resolved through separate bounded reads and application joins by `site_id`. Exact identifiers are passed as query parameters. This avoids mixed-collation SQL joins while a separate database-governance project decides whether and how to standardize join-key collations.

Human-language Brand matching is performed by Unicode normalization and deterministic application logic, not SQL fuzzy comparison.

## Statuses

- `interpretation_required`: direct matching failed; generate candidate references using the registered skill.
- `ready_for_live_diagnostic`: canonical Brand, CMS site, active grant, connection, and credential presence metadata were resolved. Live connectivity is still not checked.
- `validating`: Brand and authority resolved, but one or more supporting surfaces are missing.
- `not_found`: candidates did not resolve to an authorized canonical Brand.
- `authorization_gated`: signed Tenant scope, membership, or Brand authority is missing.
- `blocked`: invalid or ambiguous request.

Missing persisted Workspace Assets may produce `workspace_assets_derived_not_persisted` while the WordPress diagnostic context remains usable.

## Required agent behavior

1. Call the resolver before asking for Tenant, user, Workspace, connection, or target IDs.
2. On `interpretation_required`, use `brand_reference_interpreter_v1` with only the returned catalog.
3. Repeat the resolver call with `candidate_refs`.
4. Use only returned `wordpress_diagnostic_contexts` for downstream WordPress diagnostics.
5. Do not claim live WordPress connectivity from registry metadata alone.
6. Do not write aliases or duplicate translated Brand rows as part of normal resolution.
