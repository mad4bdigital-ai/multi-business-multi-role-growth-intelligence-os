# Repository Source Candidate Builder

## Purpose

This phase bridges the merged fixed live authority collectors and the merged governed repository snapshot cycle without inventing evidence or creating a self-referential manifest.

It converts one already captured, no-secret set of eight canonical source snapshots into eight deterministic repository source-document candidates plus a review index. It does not execute the collectors, query Production, create the final repository manifest, close `T001` or `T002`, or authorize migration work.

## Two-stage review model

The repository manifest cannot safely be created in the same commit as new source documents because it must bind each source path to the Git blob SHA at a reviewed ancestor commit.

The governed sequence is therefore:

1. An explicitly authorized read-only evidence operation captures all eight source snapshots.
2. The candidate builder validates and renders eight deterministic source documents.
3. Humans review the records, capture metadata, safety markers, and content hashes.
4. The eight source documents and candidate index are merged without a final manifest.
5. A separate manifest-finalization change binds the merged source files to:
   - the reviewed ancestor commit SHA;
   - the exact source path;
   - the Git blob SHA at that ancestor;
   - the exact current content SHA-256;
   - the canonical source family.
6. Only after the manifest is reviewed and merged may the protected live evidence workflow be explicitly authorized.

## Inputs

The builder accepts an array of source snapshots, or an object containing that array under `snapshots`, `sources`, or `source_bundle.sources`.

Every snapshot must provide:

- exactly one of the eight registered source families;
- a bounded source key and source identity;
- a valid observation timestamp;
- complete pagination whose expected and observed counts equal the records array length;
- one or more bounded evidence references;
- no more than 8,192 records;
- explicit safety markers proving read-only behavior, no provider call, no credential payload read, no external write, and no included secret.

The builder rejects missing or duplicate families, incomplete pagination, sensitive values, unsafe markers, invalid identifiers, invalid timestamps, unsafe output directories, excessive record counts, and any rendered source document larger than 8 MiB.

## Outputs

For each canonical family, the builder renders one deterministic JSON document using contract:

`mad4b.ueacp.authority-evidence-repository-source.v1`

Each document contains:

- the source family, key, and identity;
- deduplicated evidence references;
- capture time, complete pagination evidence, and records SHA-256;
- the canonical records;
- explicit no-effect and no-secret safety markers.

It also produces a candidate index using contract:

`mad4b.ueacp.authority-evidence-repository-candidate-index.v1`

The index records every source path, content SHA-256, record count, and capture timestamp. It deliberately contains:

- `manifest_status = requires_post_commit_blob_binding`;
- `review_required = true`;
- `closes_t001 = false`;
- `closes_t002 = false`;
- `migration_apply_authorized = false`.

The builder never emits `blob_sha` and never emits a final manifest contract. This prevents an unreviewed candidate from being mistaken for dispatch-ready evidence.

## CLI behavior

`http-generic-api/scripts/authority-evidence-repository-candidates.mjs` is dry-run by default. It validates and reports candidate hashes without writing files.

Repository writes occur only when the operator adds `--write`. Output paths must remain inside the declared repository root, and the index must remain inside the source directory. Writes are atomic file replacements and do not commit, push, dispatch workflows, or mutate protected refs.

## Safety and task state

This phase performs no live workflow dispatch, SQL query or mutation, database change, provider call, credential payload read, external send, deployment, Production promotion, runtime authority change, PEP activation, migration design or Apply, legacy removal, or automatic task closure.

`T001`, `T002`, and `T021`–`T024` remain open. A future source-capture operation, human review, source-document merge, manifest finalization, and separately authorized governed operational cycle are still required.
