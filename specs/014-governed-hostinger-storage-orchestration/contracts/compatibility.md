# Contract Compatibility and Versioning

## Authority

`contract-compatibility-baseline.json` is the machine-readable compatibility floor for the Spec 014 HTTP surface, external JSON Schemas, and error catalog. It records the contract that downstream Admin, Tenant, worker, audit, and support clients may rely on.

Updating the baseline does not make a breaking change acceptable. A breaking change requires either:

1. a new explicitly versioned contract with a bounded migration and coexistence plan; or
2. a governed compatibility migration approved with exact affected consumers, rollout, rollback, and readback evidence.

## Additive-only changes

Within contract version `0.1.x`, changes must be additive and must not:

- remove or rename a path, HTTP method, or `operationId`;
- change an existing operation from optional to required input;
- remove a success response or change its schema reference;
- remove a required response property;
- narrow an enum accepted or emitted by an existing contract;
- remove, rename, or change the meaning, HTTP/status class, retry rule, or audience-safety behavior of an existing `STORAGE_*` error code;
- weaken top-level authentication, path binding, no-secret rules, or `additionalProperties: false` boundaries;
- replace an opaque reference with a raw credential, provider payload, private path, environment value, or file content.

New optional fields, new success-neutral metadata, new error codes, and new operations may be added only when existing clients remain valid and the test baseline is extended in the same Workstream.

## Error semantics

Error codes are append-only within the version. Tenant-facing errors must preserve non-enumeration behavior. Retryability may only become more restrictive through a new version or governed migration because changing a non-retryable error into a retryable mutation path can create duplicate execution.

`STORAGE_UNKNOWN_OUTCOME` remains reconciliation-only. It must never become an automatic mutation retry signal.

## Schema safety

Every external schema must:

- use JSON Schema Draft 2020-12;
- close object boundaries with `additionalProperties: false`;
- keep every `required` property declared in the same object;
- require root `secrets_included` with `const: false`;
- reject credential-like fields and raw provider or environment payloads;
- keep storage plan paths relative or opaque and forbid absolute or parent-traversal paths.

## Validation

`http-generic-api/test-hostinger-storage-contracts.mjs` validates the positive contract and intentional negative mutations. A passing syntax parse alone is not sufficient. The suite must prove that missing authentication, duplicate operation IDs, unresolved references, malformed required sets, missing no-secret markers, and credential-like fields are rejected.
