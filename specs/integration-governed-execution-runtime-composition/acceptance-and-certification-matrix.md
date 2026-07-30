# Acceptance and Certification Matrix

## 1. Purpose

This matrix defines the minimum deterministic, integration, fault-injection, security, compatibility, performance, and production-readback evidence required before each rollout gate.

A check marked `required before mutation` must pass before any composed provider mutation pilot. A check marked `required before retirement` must pass before a legacy path is removed.

## 2. Certification levels

- **C0 Contract**: schemas, ownership, hashes, state machines, static guards.
- **C1 Shadow**: composed decisions compared without provider dispatch.
- **C2 Read**: selected read operations authoritative through composed path.
- **C3 Preparation/DAG**: server-side non-mutating plan execution and concurrency.
- **C4 Mutation**: reversible low-risk mutation with receipt/readback/reconciliation.
- **C5 Durable**: restart-safe long-running execution.
- **C6 Public Surface**: Spec 013 operations exposed to bounded cohorts.
- **C7 Production Closure**: percent rollout, benchmarks, rollback, closeout.

## 3. Contract and ownership tests

| ID | Level | Scenario | Expected evidence |
|---|---|---|---|
| AC-C-001 | C0 | Every responsibility maps to exactly one owner Spec | ownership guard passes; no duplicate authoritative requirement |
| AC-C-002 | C0 | Integration kit declares no runtime/functional authority | manifest validation passes |
| AC-C-003 | C0 | IDs and hashes use declared formats and versions | schema tests pass |
| AC-C-004 | C0 | Unknown authority-bearing request fields rejected | `request_schema_invalid` |
| AC-C-005 | C0 | Canonical JSON hashing stable across key order | identical hash |
| AC-C-006 | C0 | Material field change alters relevant hash | mismatch/invalidation |
| AC-C-007 | C0 | Volatile non-authority field normalization stable | canonical parity |
| AC-C-008 | C0 | All contracts serialize with `secrets_included=false` | secret scan passes |
| AC-C-009 | C0 | Generic shell cannot statically declare mutation non-consequential | consequence guard passes |
| AC-C-010 | C0 | Served/runtime schemas cannot drift from descriptor contracts | parity CI fails closed on mismatch |

## 4. Descriptor and intent resolution

| ID | Level | Scenario | Expected evidence |
|---|---|---|---|
| AC-I-001 | C1 | Exact descriptor after catalog item 200 | direct lookup without page traversal |
| AC-I-002 | C1 | Hidden descriptor lookup | non-enumerating not found |
| AC-I-003 | C1 | Unique intent over visible descriptors | one bounded interpretation, no authority granted |
| AC-I-004 | C1 | Two materially valid intents | `interpretation_required`, zero provider calls |
| AC-I-005 | C1 | Intent matches hidden privileged descriptor | candidate excluded/hidden |
| AC-I-006 | C1 | Compatibility alias resolves exact certified operation | descriptor/version fixed |
| AC-I-007 | C1 | Uncertified legacy tool | remains legacy-only; no silent translation |
| AC-I-008 | C1 | Descriptor consequence metadata changed | snapshot/plan/approval invalidated |
| AC-I-009 | C1 | Descriptor handler missing or mismatched | dispatch blocked |
| AC-I-010 | C6 | Custom GPT operation budget/schema guard | published operations fit constraints and remain valid |

## 5. Execution Capsule and context

| ID | Level | Scenario | Expected evidence |
|---|---|---|---|
| AC-E-001 | C1 | Tenant and authorized Admin resolve same exact target | same canonical execution-set hash; projection differs safely |
| AC-E-002 | C1 | Ambiguous resource/connection | unresolved/interpretation required; no first-row fallback |
| AC-E-003 | C1 | Cross-tenant JWT/path mismatch | blocked before resolution/dispatch |
| AC-E-004 | C1 | Missing effective subject for Tenant mutation | blocked |
| AC-E-005 | C1 | Repeated unchanged revision vector | capsule reused; full enumeration reduced |
| AC-E-006 | C1 | Authority revision changes | affected capsule invalidated |
| AC-E-007 | C1 | Unrelated tenant registry changes | unrelated capsule remains valid |
| AC-E-008 | C1 | Selected connection expires | mutation blocked; no automatic substitution |
| AC-E-009 | C1 | Capsule expired | re-resolution required |
| AC-E-010 | C2 | Permitted stale-while-revalidate read | visibility cannot widen; original candidate set preserved |
| AC-E-011 | C4 | Branch/resource version changes after preparation | mutation frontier drift block |
| AC-E-012 | C0 | Capsule serialization | no credentials/JWT/raw grant/provider payload |

## 6. Governance and approval

| ID | Level | Scenario | Expected evidence |
|---|---|---|---|
| AC-G-001 | C1 | Legacy and composed governance decisions | same disposition/reason/revisions |
| AC-G-002 | C1 | Preference scoring favors ineligible binding | hard constraint still denies |
| AC-G-003 | C1 | Capability ready but resource authority absent | deny |
| AC-G-004 | C1 | Descriptor visible but capability not ready | block before provider |
| AC-G-005 | C4 | Exact approval covers five compatible steps | one approval, five exact consumptions |
| AC-G-006 | C4 | Sixth unapproved step introduced | approval binding mismatch before mutation |
| AC-G-007 | C4 | Plan hash changes | approval invalidated |
| AC-G-008 | C4 | Context/resource/provider/SHA/risk/readback drift | approval invalidated |
| AC-G-009 | C4 | Approval expires/revokes between preparation and dispatch | mutation blocked |
| AC-G-010 | C4 | Renewal attempts to widen operations/resources/limits | rejected |
| AC-G-011 | C4 | Delegated Agent acts outside grant | denied and audited as Agent action |
| AC-G-012 | C4 | High/critical action without exact policy/grant | user-controlled block |

## 7. Plan compiler and state machines

| ID | Level | Scenario | Expected evidence |
|---|---|---|---|
| AC-P-001 | C0 | Valid DAG | deterministic plan/hash |
| AC-P-002 | C0 | Cycle | `plan_cycle_detected` |
| AC-P-003 | C0 | Missing dependency/output mapping | plan invalid |
| AC-P-004 | C0 | Duplicate step key | plan invalid |
| AC-P-005 | C0 | Mutation lacks lock/idempotency/readback | plan invalid unless explicit safe exception |
| AC-P-006 | C0 | Illegal operation transition | rejected |
| AC-P-007 | C0 | Illegal step transition | rejected |
| AC-P-008 | C0 | Terminal operation resumes | `operation_terminal` |
| AC-P-009 | C0 | Optimistic state-version conflict | 409 typed conflict |
| AC-P-010 | C0 | Every non-terminal state | exactly one canonical next action |
| AC-P-011 | C3 | Ordinary workflow step | remains in parent plan; no child plan by default |
| AC-P-012 | C3 | Explicit isolation-required step | governed child operation with lineage allowed |

## 8. Scheduler, claims, and concurrency

| ID | Level | Scenario | Expected evidence |
|---|---|---|---|
| AC-S-001 | C3 | Three independent ready reads | overlapping spans under bound |
| AC-S-002 | C3 | Downstream result aggregation | deterministic output/hash independent of completion order |
| AC-S-003 | C3 | Same mutation lock key | no overlap |
| AC-S-004 | C4 | Disjoint mutations but policy forbids parallel consequence | serialized |
| AC-S-005 | C4 | Disjoint mutations and policy allows | bounded overlap |
| AC-S-006 | C3 | Worker loses lease | stale worker fenced from commit |
| AC-S-007 | C3 | Worker crashes before dispatch | safe reclaim/retry |
| AC-S-008 | C4 | Worker crashes after possible dispatch | reconciliation, not blind retry |
| AC-S-009 | C3 | Tenant/provider/global concurrency limits differ | effective minimum enforced |
| AC-S-010 | C3 | Cancellation while queued | no new claims; steps cancelled/skipped |
| AC-S-011 | C3 | Lost claim heartbeat | lease recovery event and valid state |
| AC-S-012 | C3 | Scheduler restart | ready set reconstructed from durable state |

## 9. Lane selection

| ID | Level | Scenario | Expected evidence |
|---|---|---|---|
| AC-L-001 | C2 | Short exact read | fast lane allowed |
| AC-L-002 | C5 | External CI wait | durable lane selected |
| AC-L-003 | C5 | Approval pause | durable lane selected |
| AC-L-004 | C5 | Requested sync exceeds budget before mutation | promoted/rejected to durable safely |
| AC-L-005 | C5 | Fast-to-durable promotion | same operation/plan/context/idempotency identity |
| AC-L-006 | C4 | Policy forces durable for risk class | durable selected despite short estimate |
| AC-L-007 | C2 | Same connector, short vs long operations | different lanes based on plan |
| AC-L-008 | C0 | Unsupported lane/consequence combination | plan/selection blocked |

## 10. Idempotency and resource locks

| ID | Level | Scenario | Expected evidence |
|---|---|---|---|
| AC-D-001 | C4 | Unsafe mutation begins | reservation and pending receipt exist before dispatch |
| AC-D-002 | C4 | Same key/same target/input after success | returns prior operation/result |
| AC-D-003 | C4 | Same key/different target/input | `idempotency_conflict` |
| AC-D-004 | C4 | Unknown outcome | reservation remains blocked |
| AC-D-005 | C4 | Confirmed absence | safe retry permitted under policy |
| AC-D-006 | C4 | Provider-native idempotency available | internal reservation still recorded |
| AC-D-007 | C4 | Lock expires during possible mutation | logical mutation guard/reconciliation retained |
| AC-D-008 | C4 | Late fencing token commit | rejected |
| AC-D-009 | C4 | Approval consumption duplicate replay | prior result returned; no extra mutation |
| AC-D-010 | C4 | Raw idempotency key inspection | not stored/logged; hash only |

## 11. Provider dispatch, readback, and receipts

| ID | Level | Scenario | Expected evidence |
|---|---|---|---|
| AC-R-001 | C4 | Adapter fails before invocation | `not_dispatched`; retry safe |
| AC-R-002 | C4 | Provider rejects before mutation | confirmed classification and code |
| AC-R-003 | C4 | Provider success and matched readback | receipt/result completed |
| AC-R-004 | C4 | Provider success but readback unavailable | no completed state; wait/reconcile |
| AC-R-005 | C4 | Readback mismatch | reconciliation/failure; no false success |
| AC-R-006 | C4 | 502/503/504 after send | structured possible-mutation unknown outcome |
| AC-R-007 | C4 | Connection reset/worker crash during call | reconciliation required |
| AC-R-008 | C4 | Ledger commit result unknown | ledger readback before retry |
| AC-R-009 | C4 | Eventual consistency within window | waiting/polling then complete |
| AC-R-010 | C4 | Eventual consistency exceeds window | typed timeout/reconciliation |
| AC-R-011 | C4 | Provider target differs from capsule | security block |
| AC-R-012 | C4 | Raw provider error contains HTML/secret | structured bounded envelope, no leak |

## 12. Cancellation and compensation

| ID | Level | Scenario | Expected evidence |
|---|---|---|---|
| AC-X-001 | C3 | Cancel before dispatch | terminal cancelled, no effect |
| AC-X-002 | C3 | Cancel during read/preparation | downstream stopped; late output fenced |
| AC-X-003 | C4 | Cancel during possible mutation | reconcile; no false cancelled/no-effect claim |
| AC-X-004 | C5 | Cancel during external wait | observation cancelled safely; provider work classified separately |
| AC-X-005 | C4 | Committed effect has compensation contract | compensation required/executed/read back |
| AC-X-006 | C4 | Compensation fails | explicit failed/partial outcome |
| AC-X-007 | C4 | Compensation unknown outcome | reconciliation model reused |
| AC-X-008 | C4 | No compensation possible | explicit manual next action and confirmed effects retained |

## 13. Ledger, result, and projections

| ID | Level | Scenario | Expected evidence |
|---|---|---|---|
| AC-O-001 | C4 | Terminal mutation commit | receipt/readback/result/outbox atomic |
| AC-O-002 | C4 | Drive outage | provider success unchanged; projection pending/retry |
| AC-O-003 | C4 | JSONL worker crash | retry/idempotent delivery/order preserved |
| AC-O-004 | C4 | Duplicate projection delivery | idempotent success, no duplicate semantic record |
| AC-O-005 | C4 | Payload/hash mismatch | delivery blocked/dead-lettered |
| AC-O-006 | C4 | Projection destination wrong tenant | security block |
| AC-O-007 | C4 | Dead letter | visible repair action and reconciliation |
| AC-O-008 | C4 | Legacy/new projection shadow | 100% payload/order/hash parity before cutover |
| AC-O-009 | C4 | Segmented JSONL reconstruction | equals authoritative ordered events/hash |
| AC-O-010 | C4 | Projection failure | never triggers provider mutation replay |

## 14. Results and public surface

| ID | Level | Scenario | Expected evidence |
|---|---|---|---|
| AC-U-001 | C6 | `executeOperation` exact read | no catalog traversal; correct result |
| AC-U-002 | C6 | `executeIntent` ambiguous | 202/structured interpretation, no dispatch |
| AC-U-003 | C6 | Durable acceptance | operation identity returned and execution begins |
| AC-U-004 | C6 | `getExecution` | state/blocker/progress/next action authorized |
| AC-U-005 | C6 | compact completed mutation result | receipt/readback/projection/full ref included |
| AC-U-006 | C6 | full result retrieval | authorized, bounded, hash matched |
| AC-U-007 | C6 | unauthorized result reference | non-enumerating not found |
| AC-U-008 | C6 | expired result reference | typed expiry where safe |
| AC-U-009 | C6 | chunk continuation | snapshot/hash bound; outcome already visible in compact result |
| AC-U-010 | C6 | cancel/resume with stale state version | typed conflict |
| AC-U-011 | C6 | resume attempts target/input change | rejected |
| AC-U-012 | C6 | mutation through generic shell | correct consequential/approval projection |

## 15. Legacy compatibility

| ID | Level | Scenario | Expected evidence |
|---|---|---|---|
| AC-K-001 | C2/C4 | certified legacy call vs exact operation | same descriptor/context/authority/approval/provider/readback/receipt/result hashes |
| AC-K-002 | C1 | uncertified legacy call | legacy path unchanged |
| AC-K-003 | C6 | legacy list/call usage metrics | tracked without secrets |
| AC-K-004 | C6 | composed path disabled | legacy fallback works for new request |
| AC-K-005 | C5 | rollback with active composed operation | status/result/receipt remain available |
| AC-K-006 | C7 | legacy retirement candidate | zero/threshold usage and separate review |
| AC-K-007 | C7 | versioned removal | OpenAPI/docs/tests/readback updated |
| AC-K-008 | C7 | rollback after removal release | declared compatible recovery path passes |

## 16. Security and privacy

| ID | Level | Scenario | Expected evidence |
|---|---|---|---|
| AC-Z-001 | all | Tenant A accesses Tenant B operation/result | denied/non-enumerating |
| AC-Z-002 | all | Admin visibility reused as Tenant mutation authority | blocked |
| AC-Z-003 | C4 | Agent self-widens grant | denied |
| AC-Z-004 | C4 | approval replay after drift | denied |
| AC-Z-005 | C6 | guessed result reference | denied/non-enumerating |
| AC-Z-006 | all | secret-like field/value in capsule/plan/metric/error/result | test fails |
| AC-Z-007 | C2 | recursive generic/local tool handler | blocked |
| AC-Z-008 | C2/C4 | caller-supplied internal URL | not handler authority/SSRF blocked |
| AC-Z-009 | C3 | output attempts to change target/operation | schema/plan block |
| AC-Z-010 | all | oversized intent/plan/result | bounded rejection/pagination |
| AC-Z-011 | C4 | projection poison changes execution truth | impossible; authoritative hash prevails |
| AC-Z-012 | all | audit event parity | no unexplained missing event |

## 17. Performance and resilience

| ID | Level | Scenario | Expected evidence |
|---|---|---|---|
| AC-B-001 | C2 | in-process read | zero internal HTTP hops |
| AC-B-002 | C2 | unchanged context reuse | >=40% median context-stage improvement target |
| AC-B-003 | C3/C6 | six-step workflow | >=60% fewer caller round trips target |
| AC-B-004 | C7 | repository workflow | >=80% fewer Agent tool calls target |
| AC-B-005 | C4 | async projections | >=20% lower post-provider median target where material |
| AC-B-006 | C2 | single read p95 | no >10% regression after warm-up |
| AC-B-007 | C3 | concurrency | independent overlap and identical final hash |
| AC-B-008 | C5 | process restart/disconnect | operation survives without duplicate mutation |
| AC-B-009 | C4 | projection outage | operation/result availability retained |
| AC-B-010 | all | benchmark safety vector | equal or stricter; otherwise invalid |

## 18. Migration, rollout, and production evidence

| ID | Level | Scenario | Expected evidence |
|---|---|---|---|
| AC-M-001 | C0 | feature flags default off | configuration test |
| AC-M-002 | C1 | shadow cannot dispatch | provider mock count zero |
| AC-M-003 | C4 | migration required | static + engine-native dry-run + checksum |
| AC-M-004 | C4 | migration apply | authorization, ledger, schema readback |
| AC-M-005 | C4 | backfill interruption | resumable/idempotent checkpoint |
| AC-M-006 | each rollout | kill switch | readback confirms traffic returns |
| AC-M-007 | each rollout | rollback drill | receipts/results retained |
| AC-M-008 | C7 | production cohort expansion | safety/performance gates pass |
| AC-M-009 | C7 | exact deployed SHA/readback | recorded |
| AC-M-010 | C7 | closeout | Specs 011/012/013 and integration evidence updated |

## 19. Required CI groupings

- contract/schema/hash suite;
- ownership/traceability guard;
- context/capsule/invalidation suite;
- descriptor/runtime/consequence parity suite;
- governance/approval/delegation suite;
- plan/state-machine model suite;
- scheduler/concurrency/locking suite;
- idempotency/receipt/readback/reconciliation fault suite;
- cancellation/compensation suite;
- ledger/outbox/projection suite;
- public surface/OpenAPI/Custom GPT contract suite;
- compatibility equivalence suite;
- security/no-secret/cross-tenant suite;
- benchmark/safety-vector suite;
- migration/rollout/rollback evidence suite.

## 20. Human review checklist

Reviewers confirm:

- ownership boundaries remain clear;
- no hidden runtime authority in integration package;
- no caching of mutable approval/authority/provider state;
- no automatic retry after unknown outcome;
- no target/connection substitution;
- no feature/evidence loss through compact responses or async projections;
- migrations are additive and rollback-aware;
- public consequence metadata is accurate;
- performance claims are evidence-backed;
- rollout cannot advance with safety mismatch.