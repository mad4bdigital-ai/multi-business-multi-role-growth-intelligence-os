## Semantic Capability Resolution Direct Instructions

Direct instructions must resolve semantic capability authority before invoking a provider-specific action, endpoint, or exported tool.

### Required behavior

- Resolve the authenticated tenant and user principal first.
- Resolve a canonical workspace and active membership.
- Resolve the semantic capability and ordered provider binding from SQL authority.
- Select only workspace-linked connections.
- Reject equal highest-ranked connections as `ambiguous_connection`.
- Require active action grant and resource authority.
- Resolve endpoint aliases to one canonical endpoint key.
- Require one ready canonical endpoint row and current runtime certification.
- Treat tool exports as derived projections, not independent execution authority.
- Return structured layer-specific blocked statuses when any dependency is missing.

### Forbidden behavior

- Do not invent semantic capability keys, parent action keys, endpoint keys, adapter keys, or policy keys.
- Do not call a parent action as though it were an exported tool.
- Do not select an arbitrary primary connection when multiple candidates have equal rank.
- Do not accept tenant or user overrides from tenant principals.
- Do not expose or log credentials, encrypted credential values, tokens, authorization headers, or provider secrets.
- Do not activate an export for a `shadow` binding.
- Do not dispatch a provider call from `tenant_effective_capability_preview` or `tenant_capability_shadow_compare`.
- Do not recursively call `/system/tools/call` or `/gpt/tools/call` from descriptor-backed resolver handlers.

### Rollout enforcement

`shadow` means resolution and comparison only. `canary` requires explicit bounded scope and approval. `active` remains subject to same-cycle effective authority, certification, audit, approval, and readback rules. `disabled` is never selectable.

The initial `content.article.create_draft` WordPress binding must remain draft-only and shadow-only until a separately reviewed promotion changes its rollout mode and validates the derived export.
