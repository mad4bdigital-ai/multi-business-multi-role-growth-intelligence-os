# Tenant Docs Reader, Compact Dashboard, and Fast Runtime Audit

Date: 2026-06-02

## Purpose

This document covers the read-only surfaces added after the governance closure baseline:

- tenant-safe live repo docs reader
- compact release dashboard projection
- fast runtime surface coverage audit alias

These surfaces reduce reliance on stale uploaded docs, long readiness responses, and Cloudflare-timeout-prone runtime audits.

## Tenant-safe docs reader

Routes:

```text
GET /tenant/docs
GET /tenant/docs/read?path=<allowlisted_doc>&max_chars=<limit>
```

Authentication:

```text
Bearer user JWT
active tenant membership required
```

The reader is tenant-facing and allowlist-only.

Allowlisted documents:

```text
GPT_Tenant_Connector_Instructions.md
GPT_Tenant_Connector_Knowledge.md
docs/tenant-platform-plugin-self-serve.md
docs/local-manager-n8n-runtime-governance.md
docs/platform-plugin-tenant-install.md
docs/platform-plugin-private-runtime.md
```

Security behavior:

- blocks path traversal
- blocks absolute paths
- blocks non-allowlisted docs
- does not expose admin-only guides
- does not expose migrations or schema dumps
- returns bounded content only
- returns `secrets_included: false`

Source authority:

```text
repo_live_allowlisted
```

## Compact release dashboard

Routes:

```text
GET /release/dashboard
GET /admin/release/dashboard
```

Authentication:

```text
Backend/admin API key
```

The dashboard is a compact read-only projection over `release_readiness`.

It includes:

- overall release status
- governed migration ledger summary
- admin tool registry smoke summary
- migration drift summary
- graph memory summary
- degraded surfaces

It is not a new source of truth.

Source of truth:

```text
release_readiness
```

Dashboard role:

```text
compact_read_only_projection
```

## Fast runtime surface coverage audit

Shell alias:

```text
runtime_surface_coverage_audit_fast
```

Command behavior:

```text
node http-generic-api/scripts/runtime-surface-coverage-audit.mjs --json --code-only --no-samples
```

This avoids DB table scans and sample collection so the audit can complete within short HTTP execution windows.

The full audit remains available through:

```text
runtime_surface_coverage_audit
```

Use the full audit for deeper local or long-running diagnostics. Use the fast audit for release-window sanity checks.

## Safety notes

- Read-only only.
- No SQL apply.
- No provider mutation.
- No connector activation.
- No high-risk admin tool dispatch.
- No secrets returned.
- No `CAST(? AS JSON)` usage introduced.
