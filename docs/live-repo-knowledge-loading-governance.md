# Live repo knowledge loading governance

## Purpose

This document defines how Custom GPTs and platform agents should read repository knowledge files live from the repo instead of uploading stale copies into GPT Builder knowledge.

The rule is simple:

```text
Repo files are canonical in Git.
GPT Builder uploads are snapshots and can drift.
Use governed auth-host repo/doc tools when available.
```

## Admin GPT behavior

Admin GPT may read live repo files using governed admin tools:

```text
callAdminTool → repo_inspect
```

Recommended files to read at task start when relevant:

```text
Top Level Instructions.md
AI_Agent_Knowledge_Guide.md
GPT_Admin_Assistant_Knowledge_Guide.md
system_bootstrap.md
memory_schema.json
direct_instructions_registry_patch.md
module_loader.md
prompt_router.md
http-generic-api/openapi.yaml
docs/*.md relevant to the task
```

Admin GPT must still follow activation and bootstrap rules. Reading repo docs is not a substitute for provider bootstrap validation, registry authority, or live DB/tool readiness.

## Tenant GPT behavior

Tenant GPT must not use admin repo tools, native GitHub tools, raw repo URLs, or admin credentials.

Tenant GPT may read live repo knowledge only through tenant-visible `auth.mad4b.com` tools discovered by:

```text
activateSession
listTools
callTool
```

Tenant-safe docs can include:

```text
GPT_Tenant_Connector_Instructions.md
GPT_Tenant_Connector_Knowledge.md
tenant-facing /connect help docs
tenant-visible activation/device/integration docs under docs/
```

Tenant GPT must not read or expose:

```text
AI_Agent_Knowledge_Guide.md
GPT_Admin_Assistant_Knowledge_Guide.md
admin-only runbooks
raw migrations
DB schema dumps
secret names or credential material
cross-tenant diagnostics
```

Admin-only guides may be transformed into a tenant-safe subset by backend code or a governed docs reader, but the tenant GPT must not fetch the raw files directly.

## Missing tenant docs reader behavior

If `listTools` does not show a tenant-safe docs reader, Tenant GPT must continue from compact instructions and live activation evidence.

It must not fall back to:

```text
GPT Builder uploaded repo files
native GitHub browsing
admin repo_inspect
browser scraping of raw GitHub URLs
copy/pasted credentials or secrets
```

## Tenant-safe docs reader contract

A tenant-visible docs reader is implemented and bounded by an allowlist.

Tool key:

```text
tenant_repo_doc_read
```

Route:

```text
POST /tenant/repo-docs/read
```

Behavior:

```text
input: { path, max_chars }
omit path to list allowed docs
allowlist only tenant-safe Markdown docs
no globbing outside allowed docs
no raw migrations or admin guides
no admin repo_inspect
no native GitHub/raw repo fallback
obvious secret-like patterns are redacted defensively
return content, truncated flag, source path, policy, and secrets_included=false
```

Implemented allowlist:

```text
GPT_Tenant_Connector_Instructions.md
GPT_Tenant_Connector_Knowledge.md
docs/tenant-platform-plugin-self-serve.md
docs/local-manager-n8n-runtime-governance.md
docs/platform-plugin-smoke-certification-governance.md only if transformed/summarized for tenant scope
```

## Maintenance rule

When documentation, top instructions, tenant instructions, or GPT action setup changes:

1. Update the repo file.
2. Do not upload a new static copy to GPT Builder unless there is no live reader.
3. If static upload is temporarily required, label it as a fallback snapshot and remove it once live loading is available.
4. Keep the tenant/admin boundary explicit.
5. Validate CI after instruction changes.
