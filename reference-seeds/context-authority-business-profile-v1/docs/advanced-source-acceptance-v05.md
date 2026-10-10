# Advanced source admission and offline acceptance — 2026-10-10

Status: **DRAFT / NON-AUTHORIZING**. The seed remains standalone and sector-neutral. Existing operational and brand contracts are optional later adapters, not dependencies.

## Source admission changes

- `runtime/context-source-guard.mjs` is now imported by the existing portable runtime, instead of remaining a disconnected example.
- Strict RFC4180-style CSV parser enforces quote placement and UTF-8 byte budgets.
- Sheet matrix import rejects ambiguous duplicate headers, formula-like cells, credential-looking content and obvious personal-email data before returning any candidate records. **Current policy quarantines the entire suspicious batch**; no claim of safe per-row partial import.
- Context projection rejects cross-tenant, cross-brand, cross-site referenced claims, duplicate claim IDs and raw claim values. Approved-looking source strings remain **candidate references**, not certified business facts.
- Evidence preflight requires site, build, source generation, policy digest, **tenant and brand**, exact required checks, trusted verifier identifier and fresh time window. External detached signature verification and atomic replay protection are still host responsibilities. A host callback returning true is not proof of a live signer on its own.
- Independent publication authority remains false in all outputs.

## Offline evidence

- The byte-identical `context-source-guard.mjs` and `context-source-guard.test.mjs` fetched from the PR were tested locally with Node: **18/18 PASS**, independently matched using their Git blob SHA-1 object IDs.
- A separate V8 synthetic integration exercise of portable runtime entry points passed **9/9** before the final mandatory tenant/brand receipt tightening. The full native Node runtime suite still needs execution against the final pinned HEAD.
- The previous generic local PDF/DOCX/image auditor passed four native unit cases, and its bounded follow-up implementation was run on a **private selected set of 76 assets** (22 PDFs, 47 images, 7 DOCX): 124 PDF pages, 67 without text layer, zero render failures, zero quarantined files.
- Heuristic text signals in this selected set identified 7 unfinished-feature markers, 3 percentage-based claims needing evidence and 1 sensitive configuration-field mention. These are **flags**, not verified defects or secrets. No source strings or private source IDs are included.
- Oversized PDF pages and images are rejected before costly raster/decode operations, using conservative pixel budgets.

## Reproducible native gate

```sh
python tools/run_offline_acceptance.py --repo-root . --expected-head <EXACT_40_CHAR_COMMIT_SHA>
```

This invokes seven existing Python/Node suites, requires the local Git HEAD to match the expected head, returns `BLOCKED` for missing runtime/tests, and NEVER sets `operational_acceptance`, `publication_authorized` or `production_authorized` true. Passing native suites cannot replace signed live connector, browser or owner-rights evidence.

## Open blockers (not represented as completed)

1. Complete human semantic review of each visual page and verify source rights, owner and original revision.
2. Implement host-owned durable version/lineage registry, atomic nonce replay store and independent signature trust anchor.
3. Replace suspicious-batch denial with private per-row quarantine only when a reviewed privacy-safe connector exists.
4. Verify complete runtime test suite with exact PR HEAD in an isolated checkout; CI is not assumed functional.
5. Bind and prove a provider-specific read-only staging integration, exact environment and source revisions; browser and publication remain separately authorized.

No merge, production promotion, site write, source mutation or transfer of customer documents occurred.
