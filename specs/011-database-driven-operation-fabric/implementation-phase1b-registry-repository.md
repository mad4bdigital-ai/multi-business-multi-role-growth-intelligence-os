# Phase 1B Implementation — Registry Contracts and Repository

## Purpose

Add the first production repository boundary for Spec 011 without exposing routes, applying migrations, activating runtime behavior, or exporting GPT tools.

## Deliverables

- `http-generic-api/operationRegistryContracts.js`
- `http-generic-api/operationRegistryRepository.js`
- `http-generic-api/test-operation-registry-repository.mjs`
- canonical test-manifest registration

## Contract validation

The validator rejects unknown fields, non-JSON values, secret-bearing names, duplicated transport authority, open object schemas, invalid required-property references, duplicate steps, and cyclic dependencies. Canonical SHA-256 revision hashes cover semantic contract content while lifecycle and actor metadata remain separate.

## Repository behavior

The repository supports create, read, and optimistic replacement of `draft` or `shadow` operation versions. Writes use transactions, row locks, same-cycle readback, semantic hash verification, and rollback on any mismatch. Non-mutable versions require a new version instead of in-place mutation.

## Testing

A scripted fake pool verifies deterministic hashing, strict validation, create/readback/commit behavior, immutable-state rejection, optimistic revision conflict, and rollback. Tests perform no live database or provider calls.

## Scope boundaries

No migration application, live database write, seed row, route, OpenAPI change, compiled manifest, dynamic binding activation, GPT tool projection, provider call, deployment, or merge is included.
