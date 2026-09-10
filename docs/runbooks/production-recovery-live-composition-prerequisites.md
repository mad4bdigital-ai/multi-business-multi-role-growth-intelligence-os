# Production Recovery live composition prerequisites

Production Recovery must remain fail-closed until every prerequisite below is server-derived and exact-bound. A healthy Production deployment or external identity parity alone is not sufficient.

## Required release sequence

1. Complete and publish a fresh Staging Recovery Phase B certification for the exact Staging `main` SHA.
2. Verify the certification is Production-consumable: complete Kernel lifecycle trace, all required negative tests, server identity fingerprint, target fingerprint, artifact integrity, canonical payload hash, freshness, and dedicated Ed25519 signature.
3. Configure an independent durable Recovery Store outside the three target databases. `runtime_persistence` cannot be used to bootstrap its own Recovery authority.
4. Configure the complete server-managed Production Recovery adapter graph, including deployment identity, execution-ticket signer/verifier, approval issuer/verifier/store, fenced lock, role-aware same-cycle readback, partial-receipt store, proof resolver, migration ledger and Hostinger host-local mutation executor.
5. Bind the Production deployment attestation to the exact Production branch/SHA and Recovery manifest.
6. Verify Staging→Production artifact parity and target fingerprints.
7. Request Production live composition only through the explicit Hostinger autodeploy server-managed binding mode.
8. Re-run Production activation readiness. Live execution remains unavailable until `activation_eligible=true`.
9. For each consequential recovery step, issue a fresh plan/step-bound approval challenge and require the exact typed human confirmation. Approval material and execution tickets remain server-side.
10. Execute one bounded role step at a time under a single-use ticket and fenced lock; require independent same-cycle readback before finalizing the ticket and approval.

## Current database boundary

An empty `governance` or `runtime_persistence` database is not itself authorization to rebuild it. The role must be proven zero-object by a durable exact-SHA inspection and included in the immutable Recovery plan. The `runtime` database must not be rebuilt when its inspection reports existing objects.

Grant repair is a separate consequential operation from schema rebuild and requires its own binding and approval. The `governed_tool_response_chunks` privilege/readback requirement belongs to the runtime-persistence grant/readiness closure and must not be silently folded into a schema rebuild.

## Failure behavior

Any missing certificate, stale SHA, invalid deployment attestation, incomplete adapter graph, non-independent store, missing approval resolver, ticket replay, lost fence, provider-timeout unknown outcome, or failed same-cycle readback keeps Recovery blocked or moves it to reconciliation-only. Automatic replay after an unknown provider outcome is forbidden.

The Local Connector is not a Production Recovery authority and is not a Production fallback.
