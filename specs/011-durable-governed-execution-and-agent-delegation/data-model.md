# Proposed Data Model

The names below are design candidates. Implementation must first inventory and reuse existing platform operation, plan, approval, capability, receipt, audit, and evidence tables. New persistence requires an explicit gap analysis and additive migration.

## Core entities

### Durable operation

Proposed surface: `platform_operations`

- operation ID;
- tenant, workspace, user, and principal type;
- semantic intent and operation mode;
- plan ID and plan hash;
- resource URI and snapshot hash;
- idempotency key and scope;
- approval mode;
- current state and terminal classification;
- risk tier;
- next action;
- created, updated, expiry, and completion timestamps.

### Operation step

Proposed surface: `platform_operation_steps`

- operation and step ID;
- ordered step key;
- state and attempt count;
- execution contract version;
- capability envelope reference;
- dispatch and reconciliation timestamps;
- error and next-action codes;
- no-secret evidence references.

### Mutation receipt

Proposed surface: `platform_mutation_receipts`

- receipt ID;
- operation and step ID;
- idempotency key;
- provider or adapter identity;
- request fingerprint hash;
- pending, dispatched, reconciled, completed, or failed state;
- external reference hash or safe identifier;
- outcome classification;
- readback fingerprint;
- retry allowed flag.

A pending receipt is created transactionally before dispatch.

### Execution contract

Proposed surface: `operation_execution_contract_registry`

- semantic intent;
- resource type;
- allowed modes;
- action and endpoint identity;
- capability and runtime surface;
- approval, retry, readback, evidence, and risk policy keys;
- active revision and effective dates.

### Execution session

Proposed surface: `platform_execution_sessions`

- session and plan ID;
- principal and resource bindings;
- allowed intents and modes;
- risk ceiling;
- mutation and retry limits;
- consumed counts;
- expiry and status;
- parent approval and delegation references.

### Delegation grant

Proposed surface: `platform_agent_delegation_grants`

- grant ID;
- delegating user and delegated Agent;
- approval mode;
- plan and resource bindings;
- allowed and denied intents;
- risk ceiling and limits;
- readback and stop-on-drift flags;
- active, revoked, expired, exhausted, or completed state.

### Delegation decision

Proposed surface: `platform_agent_delegation_decisions`

- operation and step ID;
- grant and policy version;
- allow, deny, await user, or await reviewer;
- evaluated bindings;
- reason code;
- drift details;
- decision timestamp.

### Evidence reference

Proposed surface: `platform_operation_evidence_refs`

- operation and step ID;
- evidence type and source;
- safe reference ID;
- content fingerprint;
- completeness and freshness;
- tenant visibility class;
- secrets included must be false.

## State model

```text
requested
→ context_loading
→ preflight
→ awaiting_approval | ready
→ executing
→ reconciling
→ verifying
→ completed
```

Alternative states:

```text
failed_recoverable
failed_terminal
cancel_requested
cancelled
compensation_required
compensating
```

## Constraints

- unique idempotency scope for active or completed mutation;
- immutable request fingerprint after dispatch;
- append-only decision and receipt history;
- terminal-state transition guard;
- revoked and expired grants cannot dispatch;
- tenant and workspace identity are server derived for Tenant callers;
- no plaintext tokens, credentials, confirmations, or raw provider payloads;
- all JSON columns have bounded schemas and explicit versions.

## Retention

Operation summaries and audit references are durable. Raw diagnostic detail, if permitted, is short-lived and stored behind governed references. Secret material is never stored in operation evidence.
