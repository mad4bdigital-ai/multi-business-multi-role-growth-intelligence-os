# Repository Source Materialization Phase

## Purpose

This phase closes the preparation gap between a successful no-secret authority source snapshot artifact and the reviewed repository source documents required by the governed operational evidence cycle.

It does not execute a live collector, query Production, write to GitHub, commit files, finalize human ownership, close T001/T002, generate migration SQL, apply migrations, or change runtime authority.

## Inputs

The materializer accepts one JSON array containing exactly one complete snapshot for each canonical source family:

1. `system_tool_registry`
2. `admin_endpoint_catalog`
3. `direct_http_routes`
4. `runtime_action_registry`
5. `descriptor_catalog`
6. `provider_binding_catalog`
7. `local_device_catalog`
8. `compatibility_alias_registry`

The snapshots must already satisfy the canonical `authorityEvidenceSourceAdapters.js` contract. Materialization fails closed when a family is missing or duplicated, pagination is incomplete, counts differ, path contracts conflict, required path controls are absent, unsafe effects are declared, or sensitive values appear.

## Module boundary

`authorityEvidenceRepositorySourceMaterializer.js` is the public canonical boundary. It emits Pagination-aware source documents, owns the exact report/document round-trip, and returns the final manifest result.

`authorityEvidenceRepositorySourceMaterializerStrict.js` remains an internal compatibility verifier for structural, repository, reviewed-ref, blob, content, source-adapter, bundle, and inventory checks. The public boundary derives a bounded compatibility report only for that internal replay, then independently re-materializes the original Pagination-aware documents and requires exact canonical equality. The compatibility report is never returned, published, or treated as reviewed evidence.

## Source document materialization

The materializer converts the validated normalized bundle into eight deterministic JSON documents using:

`mad4b.ueacp.authority-evidence-repository-source.v1`

Each document contains:

- canonical source family, source key, and source identity;
- original observation timestamp for review context;
- the canonical pagination identity: expected count, observed count, page count, completion state, and terminal cursor;
- bounded evidence references;
- normalized no-secret authority path records;
- explicit read-only/no-provider/no-credential/no-external-write/no-secret safety markers.

Pagination is review evidence, not disposable transport metadata. It is included in the reviewed document bytes and therefore in each document content hash and in the source-bundle identity.

The module produces exact canonical JSON bytes, record hashes, file-content hashes, bundle hash, inventory hash, and a materialization report using:

`mad4b.ueacp.authority-evidence-repository-source-materialization.v1`

The output status is only `ready_for_repository_review`. It does not claim that the documents were reviewed or committed.

## CLI stage one

`http-generic-api/scripts/authority-evidence-repository-source-materialize.mjs` requires:

- `--sources-file`
- `--output-dir`
- `--report-file`
- optional `--repository-root`

Before writing, the CLI validates every destination as one unique safe repository-relative path, rejects existing files, and rejects any existing intermediate component that is a symbolic link or non-directory. No output file is created until the complete output set passes preflight.

The CLI writes each completed temporary file through an exclusive hard-link publication step, never overwrites a raced destination, and removes every file and newly created empty directory when a later publication fails. Therefore the eight documents and report are published as one fail-closed local batch rather than a partially materialized review set.

It performs no Git add, commit, push, API call, database query, provider call, credential read, or external publication.

## Reviewed commit boundary

The eight generated documents must be reviewed and committed in a dedicated source-document commit before a manifest is finalized.

This two-stage boundary prevents a self-referential manifest. The reviewed source commit becomes `observed_ref`; the later manifest commit may descend from that ref while the source bytes remain unchanged.

## Manifest finalization

`http-generic-api/scripts/authority-evidence-repository-manifest-finalize.mjs` requires:

- `--materialization-report`
- `--repository`
- `--observed-ref`
- `--manifest-output`
- optional `--repository-root`

The finalizer verifies:

- the observed ref is a full commit SHA and an ancestor of current HEAD;
- every report safety field remains at its canonical no-effect value;
- the report declares exactly eight documents and exactly one canonical family path for every registered source family;
- every source path remains repository-relative, regular, non-symlinked, realpath-contained, and at most 8 MiB;
- current source bytes match the reviewed materialization hashes;
- each document still uses the canonical source contract, matching family, declared record count, and explicit pagination identity;
- bytes committed at `observed_ref` are exactly identical to current source bytes;
- the strict internal replay validates exact Git blobs, source records, and no-effect controls;
- the public boundary replays all eight documents with their original pagination through the canonical source-adapter contract;
- rebuilding the reviewed source bundle reproduces the report's exact `source_bundle_sha256`;
- rebuilding the authority inventory reproduces the report's exact `inventory_sha256`;
- public re-materialization produces byte-identical source documents and a structurally identical canonical report;
- reports with extra fields, reordered source entries, forged hashes, stale digests, or recomputed but noncanonical identities fail closed.

Only after those checks does it emit a canonical repository manifest using:

`mad4b.ueacp.authority-evidence-repository-manifest.v1`

The manifest destination is separately preflighted for lexical containment, intermediate symlinks/non-directories, and overwrite races. Publication uses an exclusive temporary-file link and rolls back the new file and any newly created empty directories on failure. The CLI performs no Git mutation.

## Review and execution sequence

```text
successful no-secret source snapshot artifact
  -> materialize eight deterministic Pagination-aware repository source documents
  -> review source records, pagination, and evidence references
  -> commit the eight documents and materialization report
  -> use that source commit as observed_ref
  -> run strict reviewed-ref/blob/content compatibility verification
  -> replay original pagination and re-materialize exact canonical documents/report
  -> finalize exact blob/content manifest
  -> review and commit the manifest separately
  -> configure protected ueacp-live-evidence Environment
  -> explicitly authorize the existing bounded read-only operational cycle
  -> human ownership review
  -> separate T001/T002 closeout decision
```

## Fail-closed conditions

The phase blocks for incomplete or conflicting snapshots, sensitive values, unsafe paths, duplicate output paths, existing destinations, intermediate symlinks/non-directories, partial publication, missing files, source symlinks, path escapes, oversized documents, invalid safety markers, missing or altered pagination, noncanonical family paths, stale or forged report identity, source-bundle mismatch, inventory mismatch, noncanonical source bytes, malformed source JSON, source contract or record-count mismatch, invalid or non-ancestor reviewed refs, missing reviewed blobs, or any difference between reviewed and current source bytes.

## Regression coverage

The Spec-local E2E journey executes both:

- `test-authority-evidence-repository-source-materializer.mjs` for atomic publication, path safety, drift, rollback, and concurrency behavior;
- `test-authority-evidence-repository-pagination-roundtrip.mjs` for a valid three-page source round-trip and rejection of a recomputed report carrying a forged bundle identity.

## Safety and task state

All outputs declare:

- `repository_mutation_performed=false`
- `read_only=true`
- `applies_sql=false`
- `runtime_authority_changed=false`
- `provider_calls=false`
- `credential_payload_read=false`
- `external_writes=false`
- `secrets_included=false`

T001, T002, and T021–T024 remain open. No live workflow is dispatched by this phase.
