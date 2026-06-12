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

### Required outputs

Activation guidance responses must include:

- `activation_brief`
- `account_or_admin_capability_snapshot`
- `capability_groups`
- `recommended_next_actions`
- `safe_action_menu`
- `blocked_or_limited_capabilities`
- `assistant_instruction_pack`
- `secrets_included: false`

The guidance layer is read-only and summary-first. It must not make provider calls, execute mutations, provision devices, or return installer secrets.
