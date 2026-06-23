# Acceptance Matrix

| Scenario | Expected result |
|---|---|
| Tenant views active tenant-safe platform assets | Catalog is visible; platform internals are excluded |
| Tenant adopts an agent | Tenant instance is created; platform agent remains unchanged |
| Tenant edits adopted workflow | Copy-on-write overlay version is created |
| Tenant chooses fork | Full tenant snapshot is created and marked detached |
| Workspace allows, brand allows, activity allows, role allows under intersection | Asset included |
| One required scope missing under intersection | Resolution blocked with `composition_scope_missing` |
| Workspace allows under union while other scopes are silent | Asset included, subject to safety gates |
| Mandatory platform policy denies | Asset execution blocked in both modes |
| Equal-specificity overlays conflict | Resolution blocked with `composition_conflict` |
| Role can edit but cannot grant | Version creation allowed; grant mutation denied |
| Tenant supplies credentials | Secret remains in vault/connection authority; asset stores opaque binding only |
| Adopted plugin lacks installation | Visible as adopted but operationally pending |
| Installation exists but smoke certification expired | Execution blocked with `certification_required` |
| Approval-sensitive skill is granted | Badge says approval-sensitive active grant, not pending request |
| Sensitive skill invoked without approval | Invocation blocked and hold/approval flow offered |
| Tenant policy weakens mandatory safety | Publish or resolution blocked |
| Platform base upgrades without overlay conflict | Upgrade preview succeeds and may be applied with readback |
| Platform base upgrade conflicts with tenant patch | State becomes `conflict`; no silent overwrite |
| Cross-tenant instance/connection reference attempted | Rejected before provider or secret access |
| Existing specialized grant and generic resolver disagree | Generic authority remains shadow; parity gap recorded |
