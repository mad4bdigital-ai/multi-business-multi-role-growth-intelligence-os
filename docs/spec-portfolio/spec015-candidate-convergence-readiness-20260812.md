# Spec 015 Candidate Convergence Readiness

## Scope

This evidence package covers the read-only portion of T080-T085. It inspects the candidate pull requests identified by the Spec 015 portfolio and records their current GitHub state, head/base references, mergeability, and touched-file inventory. It does not merge, copy artifacts, change `main`, or claim runtime reconstruction.

## Observed candidate set

| Candidate PR | Intended target | State observed | Safe disposition |
|---:|---|---|---|
| #3922 | Generic Business Profile / Activity / Blueprint substrate and Retail Commerce child package | Open draft candidate | Requires exact-head reconstruction against current `main` |
| #4432 | Evidence Intelligence child package | Open draft candidate | Requires exact-head reconstruction and duplicate-identity review |
| #4386 | Hostinger Storage | Open draft candidate | Requires bounded service reconstruction and external storage readback |
| #2385 | Local Connector Recovery | Open draft candidate | Deferred while Cloudflare/connector recovery is postponed |
| #2284 | Repository delivery/development substrate | Open draft candidate | Requires current-main comparison |
| #2949 | Database-driven Operation Fabric | Open draft candidate | Requires authority and migration boundary review |
| #3139 | System Tool Catalog v2 reconciliation | Closed draft, conflicting | Must not be copied as-is |
| #3145 | System Tool Catalog reconciliation helper | Closed draft, conflicting | Test helper only; requires reconstruction if reused |
| #3159 | System Tool Catalog v2 resolution | Closed draft, conflicting | Must not be copied as-is |

The live snapshot contains **9 candidate PRs**, of which **4 are open**, **5 are closed**, **8 are draft**, and **3 report conflicting mergeability**. The snapshot is anchored to current `origin/main` SHA `33f1861f9cb93351e348d191894077f087c35ddd`; the source snapshot is stored in `spec015-candidate-pr-readonly-evidence-20260812.jsonl`.

## Acceptance evidence

The following conditions are now represented by local validators and evidence artifacts:

| Condition | Result |
|---|---|
| Full candidate head SHA captured | Yes, in the raw read-only snapshot |
| Base branch and base SHA captured | Yes, in the raw read-only snapshot |
| Open/draft/closed classification | Yes |
| Mergeability/conflict classification | Yes |
| Duplicate identity gate | Implemented as a fail-closed validator; no identity is copied automatically |
| Stale artifact gate | Implemented as a fail-closed validator |
| Canonical path gate | Implemented as a fail-closed validator |
| Spec 016 exposure gate | Implemented as a fail-closed validator |
| Merge or artifact reconstruction | Not executed |
| Provider or database mutation | Not executed |

## Honest closure status

T080-T085 are **closed for read-only candidate classification and readiness evidence**, but remain **open for runtime reconstruction and integration**. The remaining work requires an explicit reconstruction plan per package, current-main compatibility review, canonical identity decisions, and—where applicable—provider or migration readback. The branch deliberately does not copy stale artifacts or treat a closed/conflicting PR as an authoritative source.
