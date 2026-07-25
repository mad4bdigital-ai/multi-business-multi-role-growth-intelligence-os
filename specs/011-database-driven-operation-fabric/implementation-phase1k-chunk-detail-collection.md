# Phase 1K Implementation — Transparent Chunk Collection and Bounded Detail References

## Purpose

Implement Spec 011 task T304 by collecting governed chunked tool responses transparently while returning bounded, durable detail references when full bodies exceed projection limits.

## Authority reuse

The implementation reuses the existing `response_chunk_read` action and `governed_tool_response_chunks` durable store. It does not introduce another cache, table, blob store, or retrieval authority.

## Collector behavior

`operationChunkDetailCollector.js`:

1. normalizes the initial dispatcher response;
2. rejects any unsafe `secrets_included` marker;
3. follows only `response_chunk_read` continuations;
4. verifies a stable chunk ID, response SHA-256, and cursor policy;
5. rejects repeated, regressing, or mismatched cursors;
6. bounds chunk count and total collected characters;
7. reconstructs JSON or text for internal operation use;
8. verifies the reconstructed response hash;
9. emits one bounded durable detail reference for the full governed response.

## Bounded projection

`projectBoundedOperationDetail` keeps small results inline. Large chunked results omit the full body and return the durable detail reference with response hash, cursor policy, collection policy, size, expiry, and safety metadata.

A large response without a governed detail reference returns `blocked_missing_detail_reference`. Details are never silently dropped or represented by an invented reference.

## Security and integrity

- no secret-bearing chunk is accepted;
- detail references contain no response payload, credentials, URLs, provider data, or raw headers;
- collection fails closed on hash, identity, cursor, or safety-marker drift;
- detail reference count and inline body size are bounded.

## Scope boundaries

This phase adds application-level collection and projection only. It introduces no migration, route, OpenAPI change, database write, provider call, credential payload read, runtime activation, deployment, or merge. Existing repository automation delegation remains a separate compatibility patch within the same Draft PR.
