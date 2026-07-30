# Implementation PR-2D: Delivery and Acknowledgement Repository Services

## Status

Implementation slice for Spec 012 task T022. This slice is code and deterministic-test only. It does not authorize migration application, public runtime wiring, provider writes, deployment, restart, or external delivery.

## Scope

The slice adds `http-generic-api/activationDeliveryAcknowledgementRepository.js` with:

- delivery-attempt numbering scoped by `operation_id`, `tenant_id`, and `channel_key`;
- a parent `activation_operation_projections` row lock before reading the next delivery attempt number;
- delivery creation constrained to the initial `prepared` state;
- acknowledgement creation constrained to the initial `pending` state;
- tenant/operation/exact-identity delivery reads;
- tenant/operation/exact-identity acknowledgement reads;
- bounded acknowledgement-state existence checks;
- existing governed delivery and acknowledgement state transitions exposed through an immutable adapter;
- a transaction-bound service that reserves the attempt number and inserts the delivery through the same supplied database connection.

## Read boundary

Delivery reads expose only:

- identifiers and tenant scope;
- channel and attempt number;
- delivery state;
- payload digest;
- bounded response status and stable error code;
- timestamps.

They do not expose `error_message`.

Acknowledgement reads expose only:

- identifiers and tenant scope;
- actor type and actor-reference digest;
- acknowledgement-key digest;
- acknowledgement state;
- timestamps.

They do not expose the raw actor reference or free-form acknowledgement reason.

## Concurrency and idempotency

The caller must supply a transaction-bound MariaDB connection. `prepareDelivery()` uses that same object to:

1. lock the parent operation row;
2. determine the next per-channel delivery attempt number;
3. append the `prepared` delivery record.

The existing schema unique key `(operation_id, channel_key, delivery_attempt_number)` remains the database backstop. Existing acknowledgement-key hashing and uniqueness remain authoritative for duplicate suppression.

## State safety

Repository append methods reject attempts to insert a delivery directly as `sent`, `failed`, or `expired`, or an acknowledgement directly as `acknowledged`, `rejected`, or `expired`. Those states are reachable only through the existing guarded transition functions.

## Verification

Deterministic regression:

- `http-generic-api/test-activation-delivery-acknowledgement-repository.mjs`

The test proves:

- parent locking precedes attempt numbering;
- missing parent scope fails closed;
- attempt numbering is channel-scoped;
- initial states are enforced;
- raw actor references are not persisted;
- free-form error and reason fields are omitted from reads;
- exact tenant/operation identity is present in every read and transition;
- service reservation and insert share the exact same connection;
- caller-supplied attempt numbers and terminal initial states are overridden or rejected;
- no public runtime module imports this slice;
- the additive migration remains explicitly unauthorized for apply.

## Remaining boundary

T022 may be marked complete only after CI, merge, and same-cycle `main` readback. T026 remains open until governed migration dry-run, authorization, apply, ledger registration, and database readback. Runtime wiring and protected-user-path verification remain later tasks.
