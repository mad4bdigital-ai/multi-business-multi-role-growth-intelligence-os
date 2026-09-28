# Staging Recovery Phase B certification closure

This runbook closes live Staging Recovery certification only after the Staging deployment is already healthy and exact-main bound. It does not repair Docker, apply database migrations, mutate Production, or synthesize external evidence.

## PR-B1 acquisition-authority boundary

PR-B1 removes the old static `RECOVERY_EXTERNAL_ACQUISITION_AUTHORITY_AVAILABLE=false` gate and replaces it with a cryptographically verifiable, server-constructed authority.

The acquisition receipt contract is:

`mad4b.recovery-external-acquisition-receipt.v1`

A receipt is Ed25519-signed with the dedicated Staging Recovery acquisition key and binds all of the following:

- exact Staging deployment SHA;
- exact Recovery target fingerprint;
- acquisition run ID;
- acquisition issuer and key ID;
- issued/expiry times with a bounded lifetime;
- Registration, OAuth and Network observation IDs;
- each observation's canonical evidence hash;
- a source-proof hash derived from the evidence provenance and exact SHA/target binding;
- `secrets_included=false`.

The public verification trust is configured through:

- `STAGING_RECOVERY_ACQUISITION_PUBLIC_KEY`;
- `STAGING_RECOVERY_ACQUISITION_KEY_ID`;
- `STAGING_RECOVERY_ACQUISITION_ISSUER`.

The matching private Ed25519 key belongs only to the GitHub Environment `staging-recovery-acquisition`. It must not be persisted in `.env.staging`, the repository, a canary bundle, a readiness record, or an API response.

A caller object with `verified=true`, an environment feature flag, a recomputed evidence hash, operator confirmation, or hand-written JSON cannot create this authority. The application accepts only the branded server-side authority constructed from deployment-owned public trust.

### Current PR-B1 live status

PR-B1 deliberately remains fail-closed for live certification.

- Independent Network acquisition is implemented and executable.
- The OAuth correlation producer and verifier are implemented, but no trusted server-side producer currently exports the complete six-event correlation chain to this workflow.
- ChatGPT registration parity can be verified against the expected schema, but no provider-backed or platform-supplied source attestation currently proves that the observed registration originated from ChatGPT Builder.
- Therefore the PR-B1 acquisition workflow records both unavailable source authorities and does **not** read the acquisition private key or produce `acquisition-receipt.json`.
- Without a valid receipt the local canary, GitHub countersign, certification signing payload and readiness remain blocked.

Do not bypass this hold with manual OAuth events, manually asserted registration parity, a nonce, or operator confirmation.

## Preconditions for a future signable acquisition

Before the certification procedure below becomes executable, all of these must be true:

- Local checkout is `main` and exactly equals `origin/main`.
- Staging app deployment attestation is bound to the same exact SHA.
- The Staging Recovery authority graph is ready.
- Registration evidence is produced by a registered source authority whose authenticity can be independently verified.
- OAuth evidence is exported by the OAuth server as one correlation containing, in order:
  - `authorize_received`;
  - `login_consent_completed`;
  - `authorization_code_issued`;
  - `callback_received`;
  - `token_exchange_completed`;
  - `resource_request_verified`.
- OAuth events share the same correlation, session, client, Staging issuer/resource and server-observed redirect-URI hash, are fresh, and contain no access token, refresh token, authorization code, client secret or credential payload.
- Network evidence independently measures the same `GET /admin/recovery/staging/contract` request at direct origin and Activation Gateway:
  - identical path, method and SHA-256 of the empty body;
  - direct origin returns exactly `403 / RECOVERY_TRUSTED_INGRESS_REQUIRED`;
  - Activation Gateway returns 2xx.
- The acquisition receipt verifies against the dedicated public key and the exact evidence hashes, source-proof hashes, SHA, target fingerprint and TTL.
- Deployed Worker provenance and Activation Gateway ingress-build identity bind to the same exact SHA/target.
- The dedicated Staging Recovery certification signing trust remains independently configured in `staging-recovery-certification`.

The existing `mad4b.recovery-external-observation.v1` evidence contract remains the integrity envelope. The signed acquisition receipt is the separate source-authenticity authority; it does not replace evidence-hash verification.

A direct-origin `404 / RECOVERY_STAGING_HOST_UNAVAILABLE` can remain useful PR-A host-isolation integrity evidence, but it is **not sufficient for PR-B1 acquisition authority**. Receipt signing requires the explicit trusted-ingress `403`.

## 1. Run the external acquisition workflow

Dispatch `Staging Recovery External Evidence Acquisition` at exact `main` with:

- `expected_sha`;
- `expected_target_fingerprint`.

The PR-B1 workflow:

1. proves `GITHUB_SHA == HEAD == origin/main == expected_sha`;
2. performs the same-request direct-vs-Gateway network probe;
3. validates Network source authority;
4. records the current OAuth and Registration source-authority blockers;
5. enforces `receipt_signed=false`;
6. uploads only bounded, no-secret acquisition evidence;
7. performs no provider, database or Production mutation.

Until trusted OAuth and Registration producers exist, a successful workflow means **the fail-closed acquisition check executed correctly**, not that Recovery certification is ready.

When a future PR adds both trusted producers, the same acquisition architecture may call `.github/scripts/staging-recovery-sign-acquisition-receipt.mjs`. That signer must revalidate all three sources before it is allowed to read the private signing key and emit `acquisition-receipt.json`.

## 2. Produce the genuine local canary

Only after a valid acquisition receipt exists, run from repository root on the Staging Windows host:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\autopilot-portable-staging\Invoke-StagingRecoveryCertificationCanary.ps1 `
  -RegistrationEvidenceFile <registration.json> `
  -OAuthEvidenceFile <oauth.json> `
  -NetworkEvidenceFile <network.json> `
  -AcquisitionReceiptFile <acquisition-receipt.json> `
  -WorkerProviderEvidenceFile <worker-provider-observation.json> `
  -CaptureRuntimeEvidence `
  -DispatchCountersign `
  -CountersignConfirmation COUNTERSIGN_STAGING_RECOVERY
```

The canary re-verifies the signed acquisition receipt against the deployment-owned public trust **before any Recovery Kernel plan or mutable Kernel state is created**.

`-CaptureRuntimeEvidence` does not synthesize Worker or ingress evidence. It binds the provider-observed Cloudflare Worker deployment to the server-managed Staging target fingerprint and captures a fresh verified Activation Gateway ingress-build identity.

The runner refuses a branch other than `main`, local/main drift, an explicit SHA different from current `main`, invalid JSON, an invalid or absent acquisition receipt, or any canary that crosses the no-Production/no-secret boundary.

## 3. GitHub independent countersign

The `Staging Post-Deploy Verification` workflow:

1. checks out the exact requested SHA;
2. proves `GITHUB_SHA`, local checkout and `origin/main` are identical;
3. loads the exact local canary bundle;
4. runs the governed Recovery negative regression suites at that SHA;
5. independently re-verifies the acquisition receipt signature, key ID, issuer, SHA, target, TTL, evidence hashes and source-proof hashes;
6. independently observes current Cloudflare Worker provenance;
7. captures a fresh signed Gateway ingress identity;
8. reruns source/evidence and Kernel bindings;
9. builds the canonical Production-consumable Staging certification;
10. signs it with the independent Staging Recovery certification key.

The acquisition key and certification key are separate trust domains and must never be reused.

A stale, cross-SHA, cross-target, forged-signature, source-drifted, secret-bearing, synthetic, negative-test-incomplete or Production-targeting claim fails closed.

## 4. Publish the successful countersign back to Staging

After the GitHub countersign succeeds, note its run ID and execute:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\autopilot-portable-staging\Invoke-StagingRecoveryCertificationPublish.ps1 `
  -RunId <github-run-id>
```

The publication runner proves the run is a successful `workflow_dispatch` at the exact current `main`, downloads exactly one signed certification, checks its no-Production/no-secret boundary, and invokes the local publisher inside the Staging app.

The app verifies the certification signature and independently re-verifies the embedded acquisition receipt using deployment-owned acquisition public trust before readiness can report `external_acquisition_authority=true`.

No target database connection or provider mutation is performed by publication.

## 5. Readiness decision

Only after publication should the Staging Recovery readiness surface be read again. A valid result requires the authority graph, exact deployment attestation, target fingerprint, external-evidence integrity, signed acquisition authority and signed certification to converge on the same current SHA.

Do not reuse an acquisition receipt or certification after `main` changes. Re-run the entire acquisition → canary → countersign → publication cycle for the new exact SHA.

## Production boundary

This runbook does not enable Production Recovery. Production live composition remains a separate server-managed release gate. A valid Staging certificate is necessary evidence for Production readiness, not sufficient authorization to mutate Production. Every Production recovery step still requires exact deployment binding, durable independent Recovery Store authority, server-side approval resolution, a single-use execution ticket, fencing, and same-cycle independent readback.
