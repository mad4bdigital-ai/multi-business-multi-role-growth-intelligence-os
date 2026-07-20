# Use Cases

## UC-01 — Onboard a tenant with multiple workspaces and brands

A tenant owner creates workspaces, brands, memberships, and brand access grants. Each brand remains inactive for execution until Brand Core, activity binding, provider/resource binding, and readiness requirements are satisfied.

**Expected:** no cross-workspace role inheritance; every brand has canonical IDs and independent readiness.

## UC-02 — Activate an existing Activity Pack for a brand

A brand manager selects an active Activity Pack version, markets, locales, channels, objectives, and allowed capabilities. The platform validates Brand Core assets, knowledge, workflows, policies, and provider compatibility.

**Expected:** a new immutable brand activity binding; ambiguous activities or missing evidence block.

## UC-03 — Add a new business activity

A developer submits an Activity Pack containing schemas, knowledge pointers, KPI definitions, compatible capabilities, workflows, policies, provider compatibility, fixtures, and tests.

**Expected:** package remains draft until completeness, schema, compatibility, security, and regression validation pass; stable kernel unchanged.

## UC-04 — Resolve effective settings with lineage

A tenant administrator previews platform, activity, tenant, workspace, brand, and plan overrides.

**Expected:** final values, winning source, rejected candidates, merge operator, revision vector, conflicts, and SHA-256 are returned without credentials or hidden policy payloads.

## UC-05 — Publish a configuration version

An authorized actor validates and approves a draft configuration revision.

**Expected:** immutable published version, compare-and-set active pointer, audit event, invalidation outbox record, and same-cycle readback. Active versions are not edited.

## UC-06 — Compose an internal Growth Intelligence plan

A strategist requests an organic growth plan for a travel brand. The system resolves semantic capabilities, workflow, knowledge, Brand Core, policy, and provider readiness.

**Expected:** internal artifact nodes may run; provider nodes become approval holds; plan stores exact versions and resolution hashes.

## UC-07 — Promote from internal draft to staging

A reviewer approves selected actions, resources, environment, request hash, and expiry.

**Expected:** fresh policy/resource/provider checks, staging-only dispatch, no production write, and mandatory readback.

## UC-08 — Production canary and rollback

A tenant owner approves one production resource for a limited cohort and time window.

**Expected:** bounded dispatch, event/metric monitoring, same-cycle readback, rollback target, and no automatic expansion.

## UC-09 — Provider failover

The preferred CMS adapter is degraded. A second adapter is certified and compatible.

**Expected:** deterministic selection if one top candidate exists; equal top rank blocks; unknown prior provider effect blocks failover dispatch until reconciliation.

## UC-10 — Multi-activity brand

A brand supports travel services and ecommerce merchandise.

**Expected:** separate activity bindings, schemas, workflows, KPIs, provider resources, and plans; requests missing activity intent block rather than mixing data.

## UC-11 — Cross-brand portfolio analytics

A tenant analyst compares organic growth and qualified conversion across brands.

**Expected:** normalized KPI categories with native definitions and lineage; row-level isolation; no cross-tenant data; confidence/freshness visible.

## UC-12 — Historical replay and audit

An auditor opens a completed run after newer policies and configs are active.

**Expected:** immutable plan, configuration and policy snapshots, capability/workflow/logic/knowledge versions, approvals, transitions, evidence, and readback reproduce the historical decision.

## UC-13 — Schema evolution

A configuration schema adds an optional field and deprecates another.

**Expected:** backward-compatible versions remain readable; migration preview identifies impacted active scope values; incompatible drafts block.

## UC-14 — Tenant-authored workflow

A tenant administrator composes certified tenant-eligible capabilities using approved extension points.

**Expected:** graph remains draft; no authority or credentials inherited; policy/security constraints cannot be removed; activation is cohort-bound.

## UC-15 — Permission revocation during a run

A resource grant is revoked after planning but before provider dispatch.

**Expected:** final execution boundary revalidation denies dispatch; plan and evidence remain; no provider call occurs.

## UC-16 — Configuration conflict

A brand override and workflow-node override have equal precedence and incompatible values.

**Expected:** `CONFIG_CONFLICT`; no arbitrary winner; remediation identifies both sources.

## UC-17 — Cache invalidation after security change

A platform policy disables provider writes for an activity.

**Expected:** immediate invalidation, new plans deny writes, queued dispatch revalidates and blocks, historical reads remain intact.

## UC-18 — Resource and credential separation

Two brands in one tenant use different WordPress installations.

**Expected:** brand A plan cannot resolve brand B resource or credential binding; denial occurs before credential resolution or provider payload assembly.
