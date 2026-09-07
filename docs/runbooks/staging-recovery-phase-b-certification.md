# Staging Recovery Phase B certification closure

This runbook closes the live Staging Recovery certification after the Staging deployment is already healthy and exact-main bound. It does not repair Docker, apply database migrations, mutate Production, or synthesize external evidence.

## Preconditions

- Local checkout is `main` and exactly equals `origin/main`.
- Staging app deployment attestation is bound to the same exact SHA.
- The Staging Recovery authority graph is ready.
- The five external evidence files are genuine live evidence and all bind to the same Staging SHA and target fingerprint:
  - actual ChatGPT registration evidence;
  - OAuth browser round-trip evidence;
  - origin network-isolation evidence;
  - deployed Worker provenance evidence;
  - Activation Gateway ingress-build identity evidence.
- The dedicated Staging Recovery Ed25519 public trust is configured in the Staging app and the corresponding private signing key is configured only in the `staging-recovery-certification` GitHub environment.

## 1. Produce the genuine local canary and dispatch countersign

From repository root on the Staging Windows host:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\autopilot-portable-staging\Invoke-StagingRecoveryCertificationCanary.ps1 `
  -RegistrationEvidenceFile <registration.json> `
  -OAuthEvidenceFile <oauth.json> `
  -NetworkEvidenceFile <network.json> `
  -WorkerEvidenceFile <worker.json> `
  -IngressBuildIdentityFile <ingress-build.json> `
  -DispatchCountersign `
  -CountersignConfirmation COUNTERSIGN_STAGING_RECOVERY
```

The runner refuses a branch other than `main`, local/main drift, an explicit SHA different from current `main`, invalid JSON, or a canary that crosses the no-Production/no-secret boundary.

The countersign dispatch transports only the six bounded canary/Kernel JSON artifacts in a compressed no-secret bundle. If the bundle exceeds the bounded workflow-dispatch transport size, use the existing `evidence_run_id` artifact fallback instead.

## 2. GitHub independent verification

The `Staging Post-Deploy Verification` workflow:

1. checks out the exact requested SHA;
2. proves `GITHUB_SHA`, local checkout and `origin/main` are identical;
3. loads the exact local canary bundle;
4. runs the governed Recovery negative regression suites at that SHA;
5. binds negative-test evidence to the same `GITHUB_SHA`;
6. independently recomputes the Kernel plan, approval, ticket, run, receipt and event-chain bindings;
7. validates the real external-evidence envelope;
8. builds the canonical Production-consumable Staging certification;
9. signs it with the dedicated Staging Recovery certification key.

A stale, cross-SHA, cross-target, secret-bearing, synthetic, negative-test-incomplete, or Production-targeting claim fails closed.

## 3. Publish the successful countersign back to Staging

After the GitHub workflow succeeds, note its run ID and execute:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\autopilot-portable-staging\Invoke-StagingRecoveryCertificationPublish.ps1 `
  -RunId <github-run-id>
```

The publication runner proves the run is a successful `workflow_dispatch` of `Staging Post-Deploy Verification` at the exact current `main`, downloads exactly one `signed-certification.json`, checks its no-Production/no-secret boundary, then invokes the local publisher inside the Staging app.

The app verifies the Ed25519 signature again using deployment-owned public trust and persists the certification immutably in the independent Recovery readiness evidence store. No target database connection or provider mutation is performed by publication.

## 4. Readiness decision

Only after publication should the Staging Recovery readiness surface be read again. A valid result requires the authority graph, exact deployment attestation, target fingerprint, six external-evidence checks and signed certification to converge on the same current SHA.

Do not reuse a certificate after `main` changes. Re-run the entire canary → countersign → publication cycle for the new exact SHA.

## Production boundary

This runbook does not enable Production Recovery. Production live composition remains a separate server-managed release gate. A valid Staging certificate is necessary evidence for Production readiness, not sufficient authorization to mutate Production. Every Production recovery step still requires exact deployment binding, durable independent Recovery Store authority, server-side approval resolution, a single-use execution ticket, fencing, and same-cycle independent readback.
