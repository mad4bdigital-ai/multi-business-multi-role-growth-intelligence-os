# Acceptance Matrix

| ID | Scenario | Expected evidence |
|---|---|---|
| AC-001 | Create tenant-owned package draft | Stable package ID/key, owner scope, draft version, no authority or secret |
| AC-002 | Publish immutable package version | Exact candidate hash, review/approval, publication policy, readback |
| AC-003 | Edit published package | New draft version; published payload unchanged |
| AC-004 | Missing component reference | Compilation blocked with exact missing key/version |
| AC-005 | Cyclic package dependency | Compilation blocked with cycle path |
| AC-006 | Component contains credential-like field/value | Validation denied; no secret stored in package evidence |
| AC-007 | Arbitrary JavaScript/SQL/network predicate | Validation denied |
| AC-008 | Install package for one Brand | Exact Tenant/Workspace/Brand target and installation ID |
| AC-009 | Same package installed for two Brands | Independent installation revisions, records, files, connections, and permissions |
| AC-010 | Cross-Brand list/search/fetch | Denied before private resource/connection access |
| AC-011 | Client-owned Tenant delegates agency | Exact bounded delegation and client-owned installation |
| AC-012 | Delegation revoked | Future operations denied before credential/provider resolution |
| AC-013 | Client operation after agency revocation | Critical workflows succeed with client principals and client-owned dependencies |
| AC-014 | AI proposes full package | Draft components only; no publication/activation/grant/provider effect |
| AC-015 | AI suggests unsupported field/action | Semantic validation blocks or marks clarification required |
| AC-016 | Custom entity definition | Strict fields, relationships, sensitivity, retention, indexes, and lifecycle refs validate |
| AC-017 | Breaking entity schema change | Compatibility report and migration plan required before activation |
| AC-018 | Form hides internal IDs | Client sees friendly fields; server resolves bound scope |
| AC-019 | Duplicate form submission | Prior receipt returned or same operation resumed idempotently |
| AC-020 | Copied client link used for another scope | Denied; no scope override |
| AC-021 | Lifecycle invalid transition | Typed conflict; current state/version readback |
| AC-022 | Concurrent lifecycle transition | One compare-and-set winner; deterministic conflict for loser |
| AC-023 | Provider effect in workflow | Explicit node, capability, approval/readback contract |
| AC-024 | Unknown provider outcome | Reconciliation/readback before retry |
| AC-025 | File policy uses personal storage for shared Brand silently | Compilation or readiness blocked |
| AC-026 | Restricted file route | Explicit restricted/quarantine state; no broad share |
| AC-027 | UI action visible without authority | Action remains disabled/hidden with reason; API denies independently |
| AC-028 | Generated dashboard across clients | Only allowlisted summaries; private fields absent |
| AC-029 | Installation compilation repeated | Identical normalized hash and lineage |
| AC-030 | Missing required connection | Installation remains configuration/validation required |
| AC-031 | Activation with stale package/component/policy | Denied with freshness findings |
| AC-032 | Activation success | Exact revision pointer compare-and-set and same-cycle readback |
| AC-033 | Package upgrade without local customization | Compatible proposed revision and acceptance plan |
| AC-034 | Upgrade conflicts with local override | Three-way conflict report; no silent winner |
| AC-035 | Rollback | Prior working revision restored through governed revision change; history preserved |
| AC-036 | Fork | Origin lineage preserved; credentials, grants, client data, and files absent |
| AC-037 | Export | Provenance/hashes and definitions included; secrets/signed URLs/runtime records absent |
| AC-038 | Uninstall request | Effects disabled/archived according to plan; business records preserved by default |
| AC-039 | Retire package with active installs | Continuity/migration findings; no automatic breakage |
| AC-040 | Package acceptance run | Exact package/install/component/policy candidate identity and canonical evidence |
| AC-041 | Sandbox test | No production record/provider effect; isolated sample data |
| AC-042 | Arabic RTL client portal | Responsive, accessible, directionally correct, no internal IDs |
| AC-043 | Evidence Intelligence reference pack | Valid package composition and end-to-end intake/review/manual fallback |
| AC-044 | Retail Commerce reference pack | Valid package composition without forcing Commerce components into unrelated systems |
| AC-045 | PR #3922 extraction | Generic substrate and retail child-pack matrix; stale branch not merged blindly |
| AC-046 | PR #4432 extraction | Generic assurance template and evidence child-pack matrix; stale branch not merged blindly |
| AC-047 | Duplicate Spec 014 identities | Resolved canonical identity/path before candidate merge |
| AC-048 | Existing Spec 006/011 assets | Referenced/reused rather than copied or rewritten silently |
| AC-049 | Manual fallback | Representative system operation completes when AI/provider is disabled |
| AC-050 | Completion claim | Requires runtime/migration/surface/health/rollback/handover evidence, not Spec presence alone |

## Pilot release gates

A pilot cannot start until:

- AC-001 through AC-012 pass for package/install/agency isolation;
- AC-014 through AC-024 pass for AI/entity/form/lifecycle safety;
- AC-029 through AC-035 pass for deterministic activation and upgrades;
- backup, rollback, no-secret, observability, and manual fallback evidence exist;
- pilot Tenant/Brands and allowed effect classes are explicitly approved.

## Production release gates

Production requires all applicable acceptance rows, current-main and Production parity, applied migration evidence where needed, generated surface parity, live health/readback, backup/restore rehearsal, support/runbooks, bounded canary, rollback readiness, and explicit unresolved-work classification.