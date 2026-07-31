# Risk Register

| ID | Risk | Likelihood | Impact | Mitigation | Evidence / Gate |
|---|---|---:|---:|---|---|
| R-01 | A second registry becomes a competing authority | Medium | Critical | Map logical resources to existing MySQL registries; source-link only | architecture review; census |
| R-02 | Excessive generic JSON becomes unmaintainable | High | High | strict schemas, typed families, bounded extension points | schema CI; unknown-field tests |
| R-03 | Configuration precedence is misunderstood | Medium | High | per-field merge operator and lineage preview | resolver golden tests |
| R-04 | Lower scopes weaken security | Medium | Critical | deny-wins and immutable platform controls | policy strictness tests |
| R-05 | Activity Packs duplicate Brand Core | Medium | High | reference evidence and brand assets; no tenant facts in pack | package validation |
| R-06 | Capabilities are too broad to govern | High | High | semantic, small, effect-aware contracts | capability review checklist |
| R-07 | Workflow graphs hide external side effects | Medium | Critical | explicit provider nodes and effect classes | DAG/effect tests |
| R-08 | Tenant-authored workflows bypass controls | Medium | Critical | certified tenant-eligible capabilities and mandatory policy inheritance | activation gate |
| R-09 | Provider adapter ambiguity causes wrong target | Medium | Critical | deterministic ranking and block-on-tie | resolver tests |
| R-10 | Credential scope crosses brands | Low | Critical | resource authority and adapter-time credential resolution | isolation tests |
| R-11 | Cached policy/grant is stale | Medium | Critical | invalidation events and final-boundary revalidation | revocation tests |
| R-12 | Dynamic UI drifts from backend schema | Medium | Medium | manifest references exact schema version; backend rejects unknowns | contract tests |
| R-13 | Schema evolution breaks active configurations | Medium | High | compatibility declarations and migration preview | version compatibility CI |
| R-14 | Rollout changes behavior for all tenants | Medium | High | shadow, allowlist, canary, cohort snapshots | rollout evidence |
| R-15 | Rollback invalidates in-flight runs | Low | High | plans pin versions; rollback affects new resolutions unless emergency policy says otherwise | replay tests |
| R-16 | Cross-activity KPI normalization is misleading | High | Medium | preserve native definitions, unit, confidence, freshness, lineage | analytics review |
| R-17 | Large graphs or rules cause latency/DoS | Medium | High | bounded nodes, edges, rule depth, payload size, timeouts, quotas | load tests |
| R-18 | Unknown provider effect leads to duplicate mutation | Medium | Critical | reconcile only; no blind retry | timeout/effect tests |
| R-19 | Approval is too broad or reusable | Medium | Critical | hash, resources, environment, expiry, action IDs, effect | approval replay tests |
| R-20 | Event consumers cause unintended mutations | Low | High | events never grant authority; consumers re-evaluate policies | consumer contract tests |
| R-21 | Spec 011 duplicates Specs 006/007 | Medium | Medium | explicit dependency and boundary mapping | traceability review |
| R-22 | Implementation becomes a big-bang refactor | Medium | Critical | additive multi-PR sequence, shadow parity, no global cutover | release checklist |
| R-23 | Historical runs become unreproducible | Low | High | immutable snapshots and version pins | replay acceptance test |
| R-24 | Operational evidence is incomplete | Medium | High | stable reason codes, transitions, metrics, readback requirements | SLO and audit gate |
| R-25 | Active version edited in place | Low | Critical | immutable version storage and CAS pointer | DB constraints/tests |
| R-26 | Tenant data appears in Admin diagnostics unnecessarily | Medium | High | scoped access, field allowlists, purpose-bound diagnostics | security review |
| R-27 | Configuration values expose secrets | Medium | Critical | schemas forbid secret fields; credential references only | secret scanning |
| R-28 | Auto-generated workflows are trusted prematurely | Medium | Critical | draft-only, compile/validate/approve, no auto activation | workflow lifecycle tests |
| R-29 | Policy operator semantics drift | Low | High | fixed operator registry and versioned tests | canonical/operator CI |
| R-30 | Missing resource readback falsely reports success | Medium | Critical | same-cycle readback and typed incomplete state | end-to-end tests |

## Risk acceptance

Critical risks cannot be accepted silently. Any temporary exception requires an owner, bounded scope, expiry, evidence, rollback, and explicit approval. Specification completion does not accept implementation risk.
