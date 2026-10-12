# Feature 009 — PR #8461 adversarial design and closure

Status: source hardening under Draft PR; Staging and Production acceptance NOT certified.
Owner: MAD4B App Control. Remote Desktop Commander is not an operational dependency.

## 1. Recovery authority state machine

DISCOVER -> EXACT_SCOPE -> CANONICAL_DEVICE -> READ_ONLY_DIAGNOSE -> FAULT_CLASSIFICATION
-> IMMUTABLE_PLAN -> APPROVAL_AND_SIGNED_TICKET -> ONE_FENCED_ACTION
-> SAME_CYCLE_READBACK -> VERIFIED / PARTIAL / FAILED / RECONCILIATION_REQUIRED.

A target is the tuple environment + tenant + user + config + canonical device + device generation + current credential epoch + device-owned route. Missing or stale dimensions never resolve by fuzzy alias, machine hostname, historical tunnel name or platform key.

Critical invariants:
- Stale device: explicit read-only diagnosis; no automatic execution. Revoked/archived: no credential release or identity resurrection.
- A valid signed configuration ID proves scoped-credential possession, not physical hardware generation. Without nonexportable device-generation challenge verification, final RECOVERED is BLOCKED even if both health checks pass.
- Events are tri-state: health_ok promotes, health_failed degrades, restart/rollback/started/skipped never imply a fresh result. Healthy but unattested devices must not be stuck in automatic reinstall loops.
- Installer claims are short-lived, scoped, one-time, and credential-epoch fenced at issuance, claim and final redemption. Legacy raw Admin BAT delivery is disabled.
- No direct global BACKEND_API_KEY or CLOUDFLARE_TUNNEL_TOKEN fallback to device ownership. No shared Admin gateway treated as a device-owned runtime.
- Every write must have a plan, role authority, lock/lease, durable receipt, rollback/compensation path and same-cycle independent readback.
- No command-registry or dynamic plugin discovery result becomes permission to execute.

## 2. Fault hypothesis and response table

| Failure | Safe observation | Allowed continuation | Forbidden |
|---|---|---|---|
| Cloudflare 1033 / 530 | Tunnel ID, DNS, device task status | Diagnose; bounded owned-tunnel restart | Blind service reinstall |
| Device Stale / sleeping | Exact config and heartbeat age | Diagnostic preview only | Auto-select/rebind |
| Device Revoked / Archived | Lifecycle and revocation time | New pairing by separate authority | Old signed installer |
| Duplicate device rows | More than one exact canonical row | Quarantine and reconcile | First match wins |
| Wrong authenticated policy | Config or device mismatch | Fail closed | Declare recovered from HTTP 200 |
| Cloned Windows installation | Same exportable environment file | Generation attestation required | Trust copied IDs as physical proof |
| Credential rotation race | Current epoch differs from signed epoch | Reject, issue fresh capability | Deliver newly rotated secret with old token |
| DNS redirect or wrong host | Noncanonical or redirected endpoint | Block probe | SSRF, wildcard DNS fallback |
| Control Plane down | Independent Hostinger and Store readiness | External controller/host-side bootstrap | Let unhealthy app approve its own recovery |
| Existing nonempty recovery DB | Database and owner/schema inventory | Independent reconciliation plan | CREATE/DROP/overwrite |
| Provider lacks DB privilege | Real hPanel/MySQL capability evidence | Report unsupported and escalate | Arbitrary SSH command |
| Apply committed but readback fails | Durable partial receipt and last committed step | Reinspection and reconciliation | Automatic replay |

## 3. Adversarial test scenarios

1. Heartbeat absent for 1/10/30 minutes, time drift, different time zones, idempotent same-second UPDATE, two concurrent heartbeats.
2. Globally scoped historical alias, canonical name collisions, two active configs, user/tenant mismatch, config revoked between two DB reads.
3. Credential rotation before token issuance, before claim, between claim and final redeem, and after final snapshot.
4. Signed installer URL leakage through logs or Referer, double redemption, obsolete BAT endpoint, copied installer after Windows reinstall.
5. Cloudflare 302/307 to external host, incorrect cf-tunnel identifier, NXDOMAIN, 1033, 530, 502, swapped runtime route and healthy shared Admin host.
6. Health check returns 200 with wrong service, wrong device ID, wrong config ID, matching exportable IDs but wrong device generation.
7. Watchdog service missing, task running but application dead, multiple Watchdogs, repeated restart loop, power-off mid-rollback, corrupted lastgood image.
8. Active Hostinger SSH without MySQL CREATE privilege; absent vs empty vs partially populated Recovery DB, secret-binding write failure.
9. Stale SHA, expired grant/approval, authority graph incomplete, cross-environment source, readback failure after partial apply.
10. SQL/MariaDB collation, duplicate rows, NULL-scope aliases, schema missing, legacy connector without new scoped identity fields.

## 4. Evidence and acceptance gates

G0 — exact SHA and complete source review; no generated file drift.
G1 — native Node unit suite, SQL schema checks on MySQL and MariaDB.
G2 — PowerShell AST syntax, Windows Service/Task and signed installer E2E.
G3 — real scoped heartbeat and authenticated policy bound to the same config.
G4 — stale, revoked, cross-tenant, token replay, duplicate identity negative tests.
G5 — trusted device generation nonexportable key and fresh signed challenge; not implemented.
G6 — durable attempt budget, atomic lease, idempotency and replay reconciliation; pending.
G7 — signed installer proof, secure caching/referrer policy, lifecycle-aware redemption; partial source evidence.
G8 — exact Staging SHA, browser acceptance, rollback/upgrade canary and same-cycle independent readback.
G9 — Production provider-grant authority, independent approvals and exact release cut; not authorized.

Source-only assertions cannot substitute for G1–G9. A queued or disabled CI does not waive acceptance; preserve Draft until independent evidence.

## 5. Backward compatibility

Legacy agents must be inventoried, explicitly enrolled, and upgraded through a signed scoped installer. Missing device ID, config ID, tunnel ID, scoped credential file or nonexportable generation material is a failed prerequisite; never weaken runtime validation to keep an old agent alive. Report compatibility blockers individually and provide a governed transition plan.

## 6. Monitoring and service objectives

Metrics: inventory_age_ms, heartbeat_age_ms, device_generation_proof_age_ms, unauthorized_alias_denials, revoked_attempts, installer_replay_denials, recovery_attempts_by_fault, same_cycle_readback_failures, false_RECOVERED_claims (target zero), secrets_logged (target zero), recoveries_repeated_in_24h. Adopt numerical SLO only after measured Staging failure injections.
