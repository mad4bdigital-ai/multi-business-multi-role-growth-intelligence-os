# Acceptance Matrix

| Case | Required result |
|---|---|
| Caller supplies another Tenant ID | Ignore/reject before discovery |
| Brand alias resolves uniquely | Return canonical authorized Brand |
| Brand alias ambiguous | Clarify; no capability selection |
| Untrusted `allroyallegypt_wp` | Block/clarify; no inherited authority |
| WordPress app matches but Site differs | Block Connection |
| `metadata_only` or invalid credentials | `operation_ready=false` |
| Indexed CPT differs from live schema | Live wins; affected answers invalidated |
| Verified travel CPT exists | Offer localized verified options |
| No verified CPT exists | Inferred, non-executable option |
| Draft-only authority | Offer draft; block direct publish |
| Brand manager requested; only Workspace invite callable | Suppress widening |
| Existing broader grant | Preview existing access before duplicate |
| Healthy enabled devices | Suppress reinstall |
| Stale device heartbeat | Do not claim readiness |
| Descriptor exists but export/readback missing | Not callable; typed blocker |
| Admin/shadow tool | Never executable for Tenant |
| Preview | No provider write; complete target/effect/readback plan |
| Duplicate mutation | Return existing operation |
| Provider acknowledgement without readback | Unverified, not success |
| Unknown outcome | Readback only; no blind retry |
| Existing support fingerprint | Append event, no duplicate ticket |
| Blocker repaired | Retry with fresh ECE and stored valid context |
| Arabic locale | Arabic labels; stable technical keys |
| Large diagnostics | Bounded summary plus durable detail reference |
| Tenant response | No secrets, internal tables/graphs, foreign data, or raw upstream errors |
