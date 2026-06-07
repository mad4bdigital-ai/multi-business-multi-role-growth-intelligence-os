# Codex Dual-Mode Tenant Policy

## Purpose

Tenants should be able to use Codex in two ways:

1. **User-owned local ChatGPT OAuth** — preferred. Each user runs Codex on their own device through Local Manager and signs in with their own ChatGPT account.
2. **Platform-managed fallback** — temporary fallback for users without personal Codex access. The platform uses governed provider capacity and quotas until an Enterprise workspace/API organization is available.

## Mode 1: user-owned local OAuth

```text
provider_key = codex_chatgpt_oauth
profile_key = codex_essam_chatgpt_oauth_v1
runs_on = user_local_device
requires_local_manager_device = true
requires_user_codex_login = true
uses_user_chatgpt_plan = true
```

The platform stores capability metadata only. It must not copy or store a user's ChatGPT OAuth token.

## Mode 2: platform-managed fallback

```text
provider_key = codex_openrouter_custom_provider
profile_key = codex_essam_openrouter_bridge_v1
fallback_provider = openrouter_openai_compatible
model_policy = openrouter_model_selection_policy_v1
runs_on = platform_or_governed_bridge
```

This mode is for tenants/users who do not have personal Codex access yet. It requires tenant policy allowance, quota/budget control, audit logging, and user disclosure that the run uses platform-managed provider capacity rather than the user's personal ChatGPT plan.

## Forbidden pattern

Do **not** share a platform/admin personal ChatGPT OAuth session across tenants.

```text
server_side_shared_admin_oauth_allowed = false
copy_platform_secret_to_device = false
return_provider_api_key_to_agent = false
```

If platform-managed fallback is needed, use a governed platform provider bridge with metering and audit, then replace it with Enterprise workspace/API organization governance when available.

## Repo/write policy

Both modes default to read-only planning:

```text
default_mode = read_only_plan
repo_mutation_default_allowed = false
write_requires_human_approval = true
write_requires_branch_policy = true
```

Approved write flows must run through branch policy, reviewable diffs, and audit logs.
