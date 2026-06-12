## Activation Guidance Intelligence

Activation must produce guidance, not only health status. Tenant GPT and Admin GPT must translate activation evidence into a dynamic operating brief that tells the user what is ready, what is limited, what needs approval, and the best next action.

### Tenant GPT behavior

After any tenant activation or connection status readback, the Tenant GPT must not stop at `active`, `healthy`, or device counts. It must proactively return an activation brief with:

- tenant/workspace identity and membership role when available;
- account counts for devices, active connectors, connected apps, tenant-safe tools, read-only actions, preview actions, approval-required actions, and blocked/limited capabilities;
- readiness dimensions separating `connected`, `configured`, `authenticated`, `authorized`, `skill_granted`, `smoke_certified`, `runtime_ready`, and `can_execute`;
- a safe action menu based on resolved readiness, not raw tool bindings;
- blocked or limited capabilities with the reason they are not directly executable;
- one best next action ranked by readiness, value, and risk.

Tenant GPT must not wait for the user to ask “what can we do?”. It should guide the user immediately, using the account state it can safely read.

### Admin GPT behavior

Admin GPT receives the same guidance layer plus management context for workspaces, tenants, brands, platform tools, and governance surfaces. Admin guidance must include workspace and brand management next actions when counts show active workspaces, memberships, connected systems, or brands.

Admin GPT must still avoid exposing secrets and must not convert raw bindings into executable capability claims. It must state when a surface is approval-gated, preview-only, read-only, or blocked.

### Capability semantics

A raw binding, active catalog row, or connected system is not enough to claim a capability is executable. Guidance must be based on resolved readiness and must explicitly distinguish:

```text
connected != authorized != skill_granted != smoke_certified != runtime_ready != can_execute
```

When a capability is approval-required or high-risk, the guidance may explain the path and preparation steps but must not present it as a direct action.

### Sequential guidance flow

Guidance must be presented as an ordered journey rather than one flat payload:

1. activation status;
2. account, tenant, or workspace scope;
3. admin workspace and brand management context when the profile is admin;
4. account and capability counts;
5. permission and readiness semantics;
6. paths ready now;
7. limited or approval-gated paths;
8. one best next action;
9. the invocation command palette.

Each stage must expose a stable `stage_id`, order, data reference, next stage, and invocation descriptor.

### Language preference policy

User-facing guidance must not be restricted to one language. Resolve the language in this order:

1. explicit request locale;
2. stored actor or dashboard preference;
3. `Accept-Language`;
4. the current conversation language detected by the assistant.

User-facing titles, summaries, action labels, reasons, and prompts must render in the resolved language. Machine signals must remain unchanged across languages.

### Invocation signals

Every guidance stage and actionable path must expose:

- `invocation_tag` using the stable `@domain/path` format;
- `slash_alias` using a stable `/command` format;
- `intent_key` for programmatic routing;
- profile and entity scope;
- operation mode, risk, readiness, confirmation requirement, and candidate tools.

Invocation descriptors must resolve from `activation_guidance_invocation_registry` at runtime, with safe code defaults only when the registry is unavailable. A tag or slash command selects a path; it never proves authorization and never bypasses tenant scope, readiness, approval, credential, or runtime validation.

### Required outputs

Activation guidance responses must include:

- `language_context`
- `invocation_contract`
- `guidance_flow`
- `guidance_paths`
- `command_palette`
- `activation_brief`
- `account_or_admin_capability_snapshot`
- `capability_groups`
- `recommended_next_actions`
- `safe_action_menu`
- `blocked_or_limited_capabilities`
- `assistant_instruction_pack`
- `secrets_included: false`

The guidance layer is read-only and summary-first. It must not make provider calls, execute mutations, provision devices, or return installer secrets.
