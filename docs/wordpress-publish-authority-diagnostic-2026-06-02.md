# WordPress Publish Authority Diagnostic Pilot

Date: 2026-06-02

## Purpose

This pilot adds a safe diagnostic endpoint and admin tool for WordPress publish authority.

It verifies whether a WordPress draft/publish operation would be allowed by the platform resource-authority model without sending a WordPress POST request and without returning secrets.

## Endpoint

```text
POST /wordpress/publish-authority/diagnose
```

## Admin tool

```text
wordpress_publish_authority_diagnostic
```

## Behavior

The diagnostic checks:

- brand/target resolution
- target write-enabled flag
- requested post status (`draft` or `publish`)
- CMS site registration when present
- active `cms_site_access_grants` row
- `draft_allowed` or `publish_allowed` according to requested status

The diagnostic does not:

- resolve or return credential secrets
- send any WordPress request
- create or update WordPress content
- mutate CMS grant rows
- perform Cloudflare, connector, or GitHub actions

## Response contract

Key fields:

```text
ok
decision
status
target_key
requested_status
post_type
site_id
grant_id
grant_status
grant_required
authority_checks
executes_publish=false
applies_wordpress_post=false
secrets_included=false
```

## Compatibility note

The existing runtime publish path still preserves its current legacy behavior when a site is not registered in `cms_sites`.

This diagnostic exposes that state as:

```text
decision: legacy_allowed
status: wordpress_publish_authority_legacy_allowed
```

Future enforcement can make registered-site authority mandatory after a separate rollout decision and migration plan.

## Migration

```text
180_sprint66_wordpress_publish_authority_diagnostic_tool.sql
```

The migration registers the admin tool and adds a `diagnostic_certified` runtime dispatch certification row.

## Safety

- Additive only.
- Diagnostic only.
- No WordPress POST.
- No secret values.
- No destructive SQL.
- No broad enforcement toggle.
- Governed migration runner required for production apply.
