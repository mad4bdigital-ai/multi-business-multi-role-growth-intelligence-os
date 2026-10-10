# Portable content runtime (developer preview)

Implemented as an **offline ES module**, with no Google OAuth, CMS mutation, database writes, scheduling or content generation. It accepts provided bounded CSV text or already-read Sheet matrices: `importCsv`, `importMatrix`. It emits candidate rows, quarantines obvious secret-looking cells without echoing them, and raises QA flags. It does not use title/filename as evidence of calendar duration.

`compileContext` creates a fail-closed **PREVIEW_ONLY** projection under exact tenant/brand scope, required channel/locale/style restrictions, and a list of candidate claim references; even a caller-labelled APPROVED claim is **not** independently certified by this module. Output never authorizes publication.

`verifyHostReceipt` is a narrow *integration boundary* for an approved independent verifier. It requires exact commit, artifact hash, site, environment, source generation, policy digest, time, verifier allowlist, externally verified detached signature, and an **atomic non-replayable** host-owned nonce store. When all external callbacks approve, its result is still `ATTESTED_FOR_REVIEW_ONLY`, **not** release approval. Test stubs must never be used in Staging/Production. It does not provide signatures or durable evidence retention itself.

## Data isolation

The seed contains only synthetic fixtures and source class patterns. Real source text is not checked into GitHub. Connector binding, content-owner attestation, evidence keys, tenant authorization and publishing all belong to a separately reviewed host adapter.

## Developer commands

```sh
node --test runtime/portable-content-runtime.test.mjs
```

This exercises only in-memory synthetic cases. Static V8 smoke tests run before this commit but native Node tests must be executed independently and are not marked PASS until results can be read back.

## Known limits

- CSV only comma-separated; spreadsheets must be supplied as a bounded matrix from an authorized connector.
- No trusted source-signature verification in the importer; source revision is *declared* and must be independently checked by the host.
- Title/brief heuristics are warnings, not proof that all false claims or secrets were detected. No bulk PII detection, media analysis, perceptual deduplication or Arabic semantic classification.
- Template inheritance is not an active business policy runtime. This module is the first safe in-memory implementation layer, not complete operational acceptance.

## Additional source adapters

`importPersonaMatrix` reads six verified header-pairs from a user-scoped persona tab, preserving `why_it_matters` and keeping all candidates unapproved. `assessEditorialRow` separates content/SEO completeness from publication authority and treats any `Publish Ready?` source field as unverified. `assessDocumentFidelity` flags blank/Arabic PDF extraction for independent page review; it does not render pages or certify extraction quality.
