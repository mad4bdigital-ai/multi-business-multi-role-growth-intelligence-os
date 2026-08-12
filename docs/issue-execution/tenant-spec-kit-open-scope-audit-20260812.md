# Tenant / Spec Kit Open Scope Audit — 2026-08-12

## Sources

The scope was supplied by `/home/ubuntu/upload/pasted_content_2.txt` and cross-checked against the repository at the current synchronized branch and GitHub issue list for `mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os`.

The expanded local route-hardening batch now covers activation guidance, agent surfaces, container team, registry data management, tenant infrastructure, support tickets, and repository-conflict dry-run Tenant endpoints in addition to resource, docs, evolution, lifecycle, workspace, and platform-plugin routes. Every covered route consumes the canonical User-JWT parser and the governance registry now protects these files against local verifier/fallback reintroduction.

Open Tenant-related issue URLs observed:

- [#6871](https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/issues/6871) Governed readiness: remaining tenant runtime lifecycle migration
- [#4451](https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/issues/4451) Tenant and admin self-repair capability discovery and safe execution surfaces
- [#4446](https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/issues/4446) Tenant WordPress and Hostinger provisioning self-repair lifecycle
- [#4450](https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/issues/4450) Tenant operation monitoring, verification, SLA, and customer-safe readback
- [#4448](https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/issues/4448) Growth Audit execution, scheduling, evidence, and tenant report delivery
- [#4447](https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/issues/4447) Brand Core tenant operations: create, assets, profile inheritance, invitations
- [#4445](https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/issues/4445) Program: decompose tenant self-service and managed repair
- [#5021](https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/issues/5021) Protected-main merges bypassing Draft/Ready gates
- [#6813](https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/issues/6813) Governance DB writer authority blocks governed migration readiness
- [#6913](https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/issues/6913) Activate governed repository reconciliation apply surface
- [#5872](https://github.com/mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os/issues/5872) Finalization review-state TOCTOU before merge

## Attachment findings to preserve

The attachment reports 169 capability gap rows across 679 capabilities, but explicitly warns these are gap rows rather than independent bugs. The reported categories are dispatch_not_allowed (51), active_export_missing (46), readback_evidence_missing (37), resource_binding_missing (16), provenance_missing (12), and certification_missing (7). A separate operational view reports 186 rows and must not be merged with the 169 figure.

The attachment classifies Governance DB authority (#6813), session/archive/chunk persistence write authority, SQL-cache/Redis configuration mismatch, GitHub main protection (#5021/#5872/#6391/#6612/#6625/#6628), Cloudflare/local connector (#4957), Tenant Connection promotion, high-risk provider actions, and Hostinger deploy/restart certification as external/runtime/governance gates rather than missing route code. It identifies product/spec implementation gaps in Spec 015 including T006, T008, T010, T023, T030, forms/surveys/files/client-link model, publication/installation lifecycle, and agency/client handover.

## Repository Spec Kit task-file inventory

Spec Kit task files with open checkboxes and Tenant references include at least:

- `specs/004-tenant-asset-federation/tasks.md`
- `specs/005-dynamic-mcp-schema-surfaces/tasks.md`
- `specs/006-platform-dynamic-workflow-runtime/tasks.md`
- `specs/007-dynamic-capability-governance/tasks.md`
- `specs/008-p1-operational-remediation/tasks.md`
- `specs/009-local-connector-reachability-recovery/tasks.md`
- `specs/010-unified-platform-frontend/tasks.md`
- `specs/011-dynamic-multi-tenant-growth-control-plane/tasks.md`
- `specs/011-unified-effective-authority-control-plane/tasks.md`
- `specs/012-tenant-activation-lifecycle/tasks.md`
- `specs/015-tenant-operating-system-studio/tasks.md`
- `specs/017-tenant-managed-execution-lifecycle/tasks.md`
- plus cross-cutting Spec Kits 001/002/003/006/008/011/014/016/017/018 and integration work maps that mention Tenant.

Representative open groups observed include read-only diagnostics, projection/compiler/manifest work, schema and OpenAPI parity, cross-tenant tests, no-effect previews, local connector shadow/recovery contracts, Hostinger certification, Tenant activation lifecycle evidence, Dynamic Growth Control Plane repositories/resolvers, and Spec 015 product entities/compiler/persistence/lifecycle/handover work. Many entries explicitly require approvals, live census, migration apply/readback, staging/production canaries, provider certification, or external authority and therefore cannot be truthfully closed by source-only edits.

## Local implementation evidence added in this expansion

The source-only changes remove route-local `jsonwebtoken` verifiers and development secrets from the additional Tenant-facing route families listed above. Membership, role, idempotency, no-secret, dry-run, and provider-mutation semantics were intentionally left unchanged. The canonical route regression and User-JWT governance script now cover the expanded set.

The remaining `dynamicContainerAuthorityRoutes.js` and `platformEvolutionRoutes.js` JWT usage is intentionally not classified as a Tenant-only route-local verifier: the former is a mixed user/admin authority resolver, and the latter creates an internal tenant-smoke token for a platform self-call. Removing those fallbacks without preserving their mixed/admin or internal-smoke contracts would be a semantic change and is not claimed as part of this local-only hardening batch.

## Current branch baseline

At the start of this expanded audit, the synchronized branch was `feat/tenant-brand-asset-scope`, clean and pushed, with PR #6959 open. The branch had previously passed the relevant auth, E2E, evaluation, inventory, frontend, and governance checks at its then-current head. Subsequent scope expansion must preserve fail-closed semantics, avoid Production/Cloudflare/provider mutations, and never claim runtime closure without actual readback.
