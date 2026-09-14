# Production Recovery control-store boundary (#7999)

This workstream now contains three source-governed phases for the independent Production Recovery control store: the dedicated database identity boundary, the operational durable store/fenced-lock adapter, and resilient certification against disposable non-Production MariaDB. None of these phases activates Production Recovery or applies schema to a live database.

## Authority boundary

The Recovery control store uses a dedicated `RECOVERY_CONTROL_DB_*` identity. Its logical database and database principal must remain distinct from every canonical target database role registered in `runtime-bootstrap-contract.json`.

A shared physical MySQL host is allowed only when the logical database and principal remain independent. Database-name or principal reuse fails closed before a connection is created.

The control store is not the runtime, governance, or runtime-persistence database and must never silently inherit their database name, user, or password.

## Implemented source scope

The configuration phase provides:

- explicit configuration resolution and bounded pooling;
- canonical role discovery from the runtime bootstrap contract;
- no-secret fail-closed collision diagnostics;
- a synthetic isolation check that performs no database connection.

The operational phase adds `productionRecoveryControlStore.js` with:

- the canonical `mad4b.recovery-durable-store.v1` method surface required by `recoveryComposition.js`;
- an explicit InnoDB schema plan for Recovery records, run idempotency, receipts, approval indexes/reservations/finalizations, execution claims, execution tickets, append-only evidence and fenced locks;
- immutable execution-ticket identity checks;
- single-winner execution claims and approval reservations;
- transactional execution-ticket reservation, release and finalization;
- a durable lock generation row with a monotonic `fence_counter`, `SELECT ... FOR UPDATE` ownership serialization, heartbeat, stale-fence rejection and release without resetting the fence generation;
- `schema_auto_apply=false` and a schema-plan contract that performs no connection or mutation merely to describe the required durable store.

Construction of the store and lock adapters is lazy with respect to the database pool. Merely importing the module, constructing the adapters or reading the schema plan does not connect to MySQL.

## Resilient phase

The resilient phase is certified only against a disposable non-Production MariaDB 11.4 service created by GitHub Actions for the exact pull-request candidate. The certification workflow uses fixed CI-only credentials and does not consume repository or environment secrets.

The certification creates the already-declared control-store schema only inside that disposable database and proves:

- two independent connection pools competing for the same approval reservation produce exactly one winner;
- two independent connection pools competing for the same execution-ticket reservation produce exactly one winner;
- a finalized execution ticket cannot be reserved again, including after all original pools are destroyed and a new pool is created;
- an expired fenced lease can be taken over only with a strictly higher durable `fence_counter`;
- the stale fencing token is rejected after takeover while the new fence remains valid;
- run/idempotency and idempotency-receipt state survive connection-pool recreation;
- retry after a deliberately discarded execution-claim response resolves the existing durable claim instead of creating a second claim;
- identical append-only evidence is replay-safe;
- the bounded certification artifact contains no approval token, private key, password, ticket signature, credential material, or Production authorization.

The workflow and certification artifact explicitly state:

```text
production_authorized=false
production_database_connection_performed=false
production_database_mutation_performed=false
provider_mutation_performed=false
deployment_or_restart_executed=false
live_activation_performed=false
secrets_included=false
```

These fields refer to Production. The workflow intentionally creates and mutates only its ephemeral CI MariaDB service and destroys it with the job.

## Still intentionally missing

This phase does **not**:

- provision the Recovery control database or database principal on Hostinger;
- apply the schema statements to Production;
- bind the store into the complete Production Recovery adapter graph;
- configure `RECOVERY_SERVER_MANAGED_BINDING_MODULE` for Production;
- configure `RECOVERY_SERVER_MANAGED_BINDING_MODE=production_live` in Production;
- provide the remaining Production deployment-owned approval, ticket-signing, mutation-execution, independent-readback, deployment-attestation, proof-resolver and migration-ledger authorities;
- issue Production approvals or execution tickets;
- deploy or restart Hostinger;
- enable `production_live`;
- authorize any Production mutation.

The next `canary` phase must bind the complete concrete adapter graph to fresh signed Staging certification and exact Production deployment evidence while keeping Production mutation disabled. Only after that evidence converges may a separately authorized Production activation/promotion path be considered.

## Safety

No Production database connection, SQL, grant, migration Apply, deployment, restart, provider mutation, secret provisioning, Recovery activation, or execution-ticket issuance is performed by this source phase.

Production Recovery remains blocked until the remaining #7999 acceptance criteria are independently implemented, certified, deployed, read back, and explicitly authorized.
