# Tasks: Local Connector Runtime/Tunnel/Host Reachability Recovery

## Specification PR

- [x] T001 Define the reachability problem, scope, non-goals, and success criteria.
- [x] T002 Define tenant auth-host and admin break-glass route separation.
- [x] T003 Define canonical device selection and multi-device behavior.
- [x] T004 Define route lifecycle state machine and health dimensions.
- [x] T005 Define data model for devices, aliases, routes, heartbeat, probes, and recovery plans.
- [x] T006 Define operational runbooks and alert types.
- [x] T007 Define testing strategy and simulation matrix.
- [x] T008 Define threat model and detailed risk register.
- [x] T009 Define optimal usage model and UI state guidance.
- [x] T010 Define connection maps and trust boundaries.
- [x] T011 Draft OpenAPI 3.1 contract.
- [x] T012 Define migration and compatibility plan.
- [x] T013 Define parallel rollout PR sequence.
- [x] T014 Create requirements, security, and release-readiness checklists.
- [x] T015 Create manifest and completion tracking.
- [ ] T016 Open Draft PR and capture CI/readback evidence.

## Parallel implementation lane A: Contracts

- [ ] A001 Convert draft OpenAPI into validated implementation contract.
- [ ] A002 Add schema validation tests and examples.
- [ ] A003 Register stable error codes and response examples.
- [ ] A004 Update generated OpenAPI artifacts after implementation.

## Parallel implementation lane B: Persistence

- [ ] B001 Add `local_connector_devices` migration.
- [ ] B002 Add `local_connector_device_aliases` migration.
- [ ] B003 Add `local_connector_routes` migration.
- [ ] B004 Add `local_connector_heartbeats` migration with retention indexes.
- [ ] B005 Add `local_connector_probe_results` migration with retention indexes.
- [ ] B006 Add `local_connector_recovery_plans` migration.
- [ ] B007 Add schema readback and migration ledger evidence.

## Parallel implementation lane C: Read-only diagnostics

- [ ] C001 Implement RouteLifecycleService read model.
- [ ] C002 Implement target candidate resolver.
- [ ] C003 Add additive diagnostics fields.
- [ ] C004 Encode health classification decision table.
- [ ] C005 Add no-secret diagnostics tests.

## Parallel implementation lane D: Local Manager UI

- [ ] D001 Add identity source copy.
- [ ] D002 Add selected target summary.
- [ ] D003 Add public UI states.
- [ ] D004 Add explicit multi-device selector behind flag.
- [ ] D005 Add recovery preview UX behind flag.

## Parallel implementation lane E: Runtime registration and heartbeat

- [ ] E001 Add runtime registration client in shadow mode.
- [ ] E002 Add heartbeat sender in shadow mode.
- [ ] E003 Add local service status collection with redaction.
- [ ] E004 Add generation mismatch handling.
- [ ] E005 Add heartbeat spoofing and stale-heartbeat tests.

## Parallel implementation lane F: Probe orchestration

- [ ] F001 Add auth-host proxy probe adapter.
- [ ] F002 Add break-glass host probe adapter.
- [ ] F003 Add tunnel endpoint probe adapter.
- [ ] F004 Add local runtime health probe adapter.
- [ ] F005 Add bounded timeouts, retries, and structured error mapping.

## Parallel implementation lane G: Recovery planner and auto-install

- [ ] G001 Add recovery preview only.
- [ ] G002 Add fresh authorization eligibility checks.
- [ ] G003 Add scoped installer-token claims.
- [ ] G004 Add canary repair/relink flow.
- [ ] G005 Add cooldown and attempt counters.
- [ ] G006 Add recovery verification readback gate.

## Parallel implementation lane H: Admin break-glass hardening

- [ ] H001 Add admin-only route diagnostics.
- [ ] H002 Add break-glass dry-run mutation contract.
- [ ] H003 Add typed approval and expected-ID readback for mutations.
- [ ] H004 Add admin audit evidence.
- [ ] H005 Add tenant-denial tests.

## Parallel implementation lane I: Production verification and closeout

- [ ] I001 Add synthetic diagnostics and operational alerts.
- [ ] I002 Run canary device route registration verification.
- [ ] I003 Run canary heartbeat/probe verification.
- [ ] I004 Run recovery simulation for repair, relink, reinstall, and replace.
- [ ] I005 Complete post-merge audit and residual-risk tracking.
- [ ] I006 Close out spec completion ledger.

## Parallelization constraints

- A and B can run immediately after Draft PR review.
- D can run against mocked A contracts.
- C requires at least A1 and B1/B3 shape approval.
- E and F can run in shadow mode after B tables exist or against fixtures.
- G must wait for C plus E/F evidence shapes.
- H can run after admin contract review but cannot be exposed to tenant surfaces.
- I waits for all runtime lanes.

## Global stop conditions

- [ ] Stop if tenant route can use break-glass fallback.
- [ ] Stop if ambiguous target can create installer.
- [ ] Stop if stale token creates privileged installer.
- [ ] Stop if recovered status appears without same-cycle readback.
- [ ] Stop if diagnostics expose secrets or signed URLs.
- [ ] Stop if profile overlay can weaken global security floors.
