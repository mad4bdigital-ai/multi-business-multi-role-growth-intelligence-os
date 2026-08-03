# Demo-to-Production Acceptance Matrix

Status in this file means planned acceptance, not current production completion.

| ID | Demo behavior | Production proof required | Test/evidence |
|---|---|---|---|
| AC-001 | Storefront and POS share stock | Both query/mutate the same authoritative adapter and context | integration test + operation timeline |
| AC-002 | Unique item cannot sell twice | Concurrent reservation race yields one success and deterministic 409 conflicts | database/ERP concurrency test |
| AC-003 | Reservation expires automatically | Due worker releases exactly once after TTL | clock-controlled integration test |
| AC-004 | Failed payment releases stock | Signed/readback-confirmed failure transitions payment and reservation | provider sandbox test |
| AC-005 | Unknown payment is reconciled | No blind retry; bounded hold and later readback classification | timeout/fault injection |
| AC-006 | POS sale updates web availability | POS commit emits Outbox event and web projection refreshes | end-to-end test |
| AC-007 | Live reservation blocks POS/Web | Live uses same reservation service | multi-client test |
| AC-008 | Offline POS protects unique units | Sale succeeds only with valid allocation lease | device/offline contract test |
| AC-009 | Product filters work | API supports safe indexed projections and authoritative reserve revalidation | API/UI tests |
| AC-010 | Arabic responsive storefront | RTL, 360/390/mobile/tablet/desktop, WCAG 2.2 AA | visual/accessibility evidence |
| AC-011 | Supplier receipt creates stock/QC | receipt transaction plus workflow/tasks and readback | integration test |
| AC-012 | Return routes stock automatically | inspection decision produces one allowed state transition | state-machine/integration test |
| AC-013 | Refund does not duplicate | provider idempotency and operation ledger | duplicate webhook/retry test |
| AC-014 | Shot List drives capture | category policy resolves exact required media | domain/UI test |
| AC-015 | Media pipeline starts automatically | completion event enqueues durable SQL-backed job | worker/restart test |
| AC-016 | Image failures are visible/retryable | stage ledger, stable error, retry and dead letter | fault injection |
| AC-017 | AI fields carry confidence/evidence | every sensitive field has source and decision | schema/policy test |
| AC-018 | Publication gate blocks incomplete item | missing media/measurement/defect/approval prevents queue | domain test |
| AC-019 | Channel content differs by profile | channel revision and mapper produce versioned output | contract snapshots |
| AC-020 | Catalog availability updates | committed delta, provider submission, provider issue readback | sandbox adapter test |
| AC-021 | Catalog failures do not roll back sale | provider delivery asynchronous after commit | transaction/failure test |
| AC-022 | GA4 events use valid ecommerce items | schema and event dictionary validation | contract test |
| AC-023 | Browser/server purchase dedupe | same event/transaction counted once per destination | duplicate ingestion test |
| AC-024 | Consent blocks marketing destinations | essential/internal routing remains distinct | policy test |
| AC-025 | PII rejected from analytics | prohibited key/value detector returns stable rejection | security test |
| AC-026 | Ad dashboards show contribution | orders/refunds/cost/spend reconcile with explicit model | data reconciliation fixture |
| AC-027 | Attribution models remain distinct | no silent blending of provider, GA, first/last touch | schema/query test |
| AC-028 | Complaints create finding at threshold | dedupe/window policy creates one finding | clock/data test |
| AC-029 | Discount approval only above threshold | normal sale automatic; high discount creates hold | policy/integration test |
| AC-030 | Cross-tenant requests fail closed | all commerce resources enforce tenant/workspace/context | negative test suite |
| AC-031 | Wrong branch/terminal fails | location/device binding enforced | negative test suite |
| AC-032 | Stale entity version fails | expected version mismatch yields 409 | contract/integration test |
| AC-033 | Same idempotency key replays safely | same payload returns same result; changed payload conflicts | integration test |
| AC-034 | Redis loss does not lose work | SQL pending state reconstructs worker jobs | restart test |
| AC-035 | Outbox consumer crash is safe | retry/readback prevents duplicate business effect | fault injection |
| AC-036 | ERPNext mode is not dual master | platform native write repository refuses external projection | adapter/invariant test |
| AC-037 | ERPNext adapter normalizes errors | version/readiness/conflict/unknown classifications stable | sandbox certification |
| AC-038 | Credentials are absent from domain data | only connection refs stored; scanners pass | security/DB fixture review |
| AC-039 | Audit evidence is bounded/no-secret | safe event fields and payload limits | audit test |
| AC-040 | Operation timeline is truthful | queued, dispatched, delivered, readback, compensated remain distinct | projection test |
| AC-041 | Frontend uses governed surface | discovery/policy/generated catalog includes RetailOS | generator parity test |
| AC-042 | QA controls are isolated | sandbox controls unavailable in production mode | frontend configuration test |
| AC-043 | Migration is governed | dry run, lifecycle registration, ledger, readback, rollback | migration CI/evidence |
| AC-044 | Production version matches main | version/deployment manifest and commit readback | deployment parity gate |
| AC-045 | Runtime smoke covers core path | product -> reserve -> order/POS -> event -> readback | controlled production smoke |

## Completion rule

Every row must have:

- implementation PR and commit;
- automated test reference;
- environment classification;
- authoritative evidence timestamp;
- unresolved limitation or `none`;
- rollback/disable path where applicable.

A demo screenshot may support experience parity, but cannot satisfy domain or runtime proof.
