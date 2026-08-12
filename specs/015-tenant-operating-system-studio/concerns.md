# Concerns and Risk Register

## C-001 — Rebuilding authorities already present

**Risk:** a new package registry duplicates Spec 006 assets or Spec 011 configuration authority.  
**Mitigation:** Phase 0 field-level reuse matrix; new persistence only for proven semantic gaps.

## C-002 — Tenant configuration becomes executable code

**Risk:** arbitrary predicates, transforms, scripts, SQL, templates, or prompts bypass the stable kernel.  
**Mitigation:** bounded registries, certified component types, strict schemas, declarative operators, complexity limits, no network/code execution from package payloads.

## C-003 — Package manifest treated as authority

**Risk:** visibility or inclusion of a capability/action is interpreted as permission.  
**Mitigation:** final principal/resource/capability/policy/approval/readback evaluation remains mandatory.

## C-004 — Cross-client data leakage

**Risk:** an agency reuses a package and accidentally shares data, files, connections, reports, prompts/results, or recipients.  
**Mitigation:** exact installation partitions; Brand/Tenant leading predicates; connection/file-root binding; negative isolation suite.

## C-005 — Package ownership confused with client ownership

**Risk:** agency IP ownership is treated as ownership of client data or installation.  
**Mitigation:** independent ownership dimensions and explicit handover/usage-right contracts.

## C-006 — Client lock-in after agency departure

**Risk:** system stops because only agency principals, connections, or non-transferable services exist.  
**Mitigation:** portability inventory, client operator readiness, client-owned dependency options, tested revocation/handover lifecycle.

## C-007 — Unbounded custom entity model

**Risk:** tenants create arbitrary schemas/tables/indexes causing security, performance, migration, or governance problems.  
**Mitigation:** approved persistence patterns, field/type allowlists, limits, schema compatibility and migration preview, lifecycle registry classification.

## C-008 — Generated UI bypasses service boundaries

**Risk:** generated forms/tables/actions call raw tables/routes or infer authority from manifest.  
**Mitigation:** Resource/Application descriptors, unified frontend dispatch, field/action allowlists, server-side authority, generated-surface tests.

## C-009 — Lifecycle/workflow divergence

**Risk:** package lifecycle definitions create a second execution engine.  
**Mitigation:** lifecycle definitions compile to existing stable transition/workflow primitives; no tenant executor code.

## C-010 — AI-created unsafe systems

**Risk:** AI invents fields, policies, providers, actions, legal claims, or authority.  
**Mitigation:** draft-only output, strict schemas, semantic validation, eligibility checks, human review, no implicit publication/activation.

## C-011 — Upgrade destroys local customization

**Risk:** package updates overwrite tenant overrides/extensions or forks.  
**Mitigation:** three-way comparison, immutable revisions, conflict blocking, migration plan, rollback, no silent fork rewrite.

## C-012 — Package dependency explosion

**Risk:** nested packages/components create cycles, deep graphs, incompatible versions, and slow resolution.  
**Mitigation:** bounded depth/count, acyclic graph, semantic version policy, deterministic compiler, caching by revision vector.

## C-013 — Marketplace supply-chain risk

**Risk:** a shared package contains unsafe behaviors, misleading claims, hidden external dependencies, or prohibited data handling.  
**Mitigation:** stronger review, provenance, signatures, certification, sandbox, package SBOM-like component inventory, no-secret scan, publisher lifecycle.

## C-014 — Export/import becomes credential transfer

**Risk:** export captures connection payloads, signed URLs, grants, or private runtime records.  
**Mitigation:** reference-only connection descriptors, explicit export classifications, secret scan, provenance and trust verification.

## C-015 — Stale profile or policy context

**Risk:** package compiled under old Business Profile, connection, adapter certification, or policy remains active for consequential execution.  
**Mitigation:** version vectors, invalidation, final execution revalidation, fail closed on stale context.

## C-016 — Spec 014 collision

**Risk:** PR #3922, #4432, and other open Spec 014 branches create ambiguous canonical identity and Work Map ownership.  
**Mitigation:** Spec 015 convergence ledger; explicit extraction/reclassification; reconstruct on current main rather than blind merge.

## C-017 — Stale candidate branches

**Risk:** successful CI on diverged branches is used as evidence against current main.  
**Mitigation:** exact current-main reconstruction and exact candidate evidence; preserve ancestry; reject stale reports.

## C-018 — Runtime completion inferred from documentation

**Risk:** merged Spec, generated manifest, or green Docs CI is treated as delivered product.  
**Mitigation:** separate `implemented`, `verified`, `production_verified`, and `closed`; completion gates require runtime/migration/surface/readback evidence.

## C-019 — Uninstall causes data loss

**Risk:** package uninstall cascades to client records/files/audit history.  
**Mitigation:** disable/archive default, independent data lifecycle, backup/retention/legal-hold gates, destructive deletion separately authorized.

## C-020 — Cost and quota abuse

**Risk:** tenant-created workflows, AI, schedules, reports, and providers generate uncontrolled cost or load.  
**Mitigation:** eligibility, quota, budget, concurrency, schedule, fan-out, and environment/effect limits in compiler and runtime.

## C-021 — Incomplete localization/accessibility

**Risk:** schema-generated UI is technically present but unusable for Arabic/mobile/client users.  
**Mitigation:** first-class labels/help/error dictionaries, RTL layout contract, mobile tests, WCAG 2.2 AA gates.

## C-022 — Package retirement breaks client operation

**Risk:** publisher retires a package without continuity.  
**Mitigation:** active-install inventory, support-ended/degraded modes, replacement/migration guidance, exception policy, client export/handover.

## C-023 — Ambiguous Brand model for freelancers

**Risk:** small users are forced into complex agency structures or use one default Brand unsafely.  
**Mitigation:** simple single-Brand onboarding backed by exact canonical scope; no hidden fallback when multiple Brands exist.

## C-024 — Delegation confused with membership

**Risk:** agency delegation broadens persistent membership or ownership.  
**Mitigation:** typed delegated grants, explicit targets/effects/expiry, independent revocation, no credential inheritance.

## C-025 — Package IP and platform mandatory policy conflict

**Risk:** package publisher claims proprietary control over mandatory platform security or runtime primitives.  
**Mitigation:** package rights cover exportable definitions only; platform canonicals and mandatory policies remain separate authorities.