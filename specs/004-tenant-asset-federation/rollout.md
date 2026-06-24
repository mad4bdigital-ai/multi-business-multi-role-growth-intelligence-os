# Rollout Strategy

## Rollout principles

- shared assets remain the default throughout rollout;
- legacy enforcement remains authoritative until each family is certified;
- Dynamic Container Authority begins in preview/shadow;
- no provider write is introduced by profile, variant, or adaptation rollout;
- every stage has a disable/rollback path;
- current branch repair is preferred over replacement branch creation.

## Stage A0 — Extended plane decision freeze

Before canonical/runtime implementation, freeze the P0 boundaries for identity, tenant lifecycle, data governance, FinOps, model governance, asynchronous consistency, provenance, and temporal/environment/region semantics.

Required evidence:

- source-of-truth owner for each plane;
- fail-closed behavior when evidence is unavailable;
- lifecycle and rollback;
- compatibility and migration contract;
- manifest contribution and versioning;
- security/privacy review;
- initial quality and latency thresholds.

**Runtime effect:** none.

## Stage A1 — Extended read-only diagnostics

Expose Admin-only diagnostics for:

- missing group/service identity authority;
- tenant relationship/lifecycle readiness;
- retention/residency/purpose coverage;
- entitlement/cost-reservation coverage;
- model policy/evaluation coverage;
- operation idempotency/outbox readiness;
- artifact provenance completeness;
- environment/region binding coverage;
- package supply-chain/compatibility evidence;
- export/restore/human-SLA/capability-quality readiness.

Diagnostics cannot grant, reserve cost, execute retention, read credentials, call models/providers, or mutate tenant state.

## Stage A — Design freeze and canonical alignment

Approve terminology, typed algebra, personalization boundaries, variant rules, adaptive classes, data use, and promotion governance. Align with Dynamic Container Authority and Resource API architecture.

**Runtime effect:** none.

## Stage B — Read-only shared catalog

Project shared assets and readiness into Admin-only diagnostics, then Tenant read-only catalog surfaces.

**Allowed:** list/get/search/readiness/changes/revisions.  
**Forbidden:** variants, provider calls, credential reads, execution cutover.

Rollback: disable catalog routes/projections.

## Stage C — Container projection preview

Seed canonical tenant, workspace, brand, activity, and workflow containers. Rebuild closure and run preview resolutions.

**Required:** zero cross-tenant edges, bounded paths, deterministic hashes.  
**Enforcement:** disabled.

Rollback: disable projection consumer; canonical tables remain unchanged.

## Stage D — Legacy bridge shadow

Project current roles, grants, resources, and policies into contextual candidates. Compare legacy versus contextual decisions.

Promotion gates:

- minimum comparable sample count;
- zero critical mismatches;
- explained non-critical mismatches;
- 100% audit coverage;
- latency budgets met.

Rollback: return to legacy-only reads.

## Stage E — Personal presentation preferences

Enable Class A preferences: language, layout, explanation depth, notification settings, and output formatting.

These cannot change authority, shared asset definitions, or provider readiness.

Rollback: reset/disable personal profile while preserving audit history.

## Stage F — Read-only composition profiles

Enable impact preview and user selection for shared catalogs, knowledge, tools, and workflow ranking.

Use guarded union and strict intersection only where registered. Continue legacy execution authority.

Rollback: disable selections and apply platform defaults.

## Stage G — Optional personal variants

Enable explicit variants for low-risk presentation, prompt fragments, output templates, and ordering.

Required:

- modifiable-path validation;
- no-secret validation;
- version conflict handling;
- reset to shared;
- base-upgrade preview.

Rollback: disable variant; shared base becomes effective.

## Stage H — Scoped variants and composition

Expand to role, workspace, brand, activity, and tenant scopes after isolation and delegation tests pass.

Stricter policy customization may be enabled first. Policy loosening remains blocked or override-gated.

Rollback: deactivate scoped profile/variant and invalidate affected manifests.

## Stage I — Read connection readiness

Resolve eligible tenant/user connections, installation, and certification for read-only actions. Credential payload remains unavailable to preview and shadow.

Rollback: disable contextual connection selection and retain current provider path.

## Stage J — Adaptive proposals

Enable proposal generation from explicit feedback and existing telemetry.

Initial classes:

1. Class A presentation;
2. Class B workflow preference;
3. Class C profile recommendation in simulation only.

No automatic provider execution or authority mutation.

Rollback: disable proposal producer; existing accepted settings remain user-controlled.

## Stage K — Bounded canaries

Enable user-confirmed canaries for preferences, read-only profile selection, and low-risk variants.

Every canary has:

- exact cohort;
- baseline;
- success and guardrail metrics;
- minimum sample;
- expiry;
- automatic rollback trigger;
- immutable start snapshot.

Rollback: stop experiment and restore baseline profile/version.

## Stage L — Read-only contextual cutover

Promote certified read-only asset families to contextual authority. Preserve legacy comparison for a monitoring window.

Rollback: feature flag returns family to legacy authority.

## Stage M — Sensitive and write actions

Proceed only after read-only families are stable and exact action/endpoint/resource/connection/approval/certification chains pass.

- discovery may use guarded union;
- executable actions require strict authority intersection/deny-wins;
- Class E remains governed and cannot auto-promote;
- provider writes require existing approval and same-cycle readback.

Rollback: disable write-family contextual consumer and revoke canary manifests.

## Stage N — Platform promotion candidates

Allow privacy-safe, certified tenant-local improvements to become review candidates for new shared asset versions or platform composition templates.

No automatic publication. Promotion requires admin review, tests, certification, release readiness, and a normal repository/deployment release.

## Operational dashboards

Track by stage and family:

- projected versus missing containers;
- path and binding coverage;
- legacy/contextual parity;
- profile and variant use;
- readiness gaps;
- adaptation proposals and experiment outcomes;
- resolution latency;
- audit completeness;
- secret-field rejections;
- cross-tenant and policy violations;
- rollback events.

## Automatic rollback triggers

- critical parity mismatch;
- cross-tenant access evidence;
- secret inclusion;
- mandatory policy bypass;
- unexplained authorization expansion;
- p99 latency beyond approved threshold for the required window;
- canary guardrail regression;
- stale authority epoch used for dispatch;
- missing same-cycle readback.

## Final cutover criteria

A family is complete only when:

- shared assets remain canonical and no automatic copies exist;
- profile, preference, variant, and authority effects are separately explainable;
- isolation and security tests pass;
- runtime manifest attribution covers executions;
- rollback is tested;
- production SHA parity is verified;
- current operational awareness shows no hidden degraded surface.
