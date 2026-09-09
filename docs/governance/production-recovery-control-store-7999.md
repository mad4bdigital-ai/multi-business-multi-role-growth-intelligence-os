# Production Recovery control-store boundary (#7999)

This workstream now contains two source-only phases for the independent Production Recovery control store: the dedicated database identity boundary and the operational durable store/fenced-lock adapter. Neither phase activates Production Recovery or applies schema to a live database.

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

## Still intentionally missing

This phase does **not**:

- provision the Recovery control database or database principal;
- apply the schema statements;
- run live concurrent writers or restart-durability tests;
- bind the store into the complete Production Recovery adapter graph;
- configure `RECOVERY_SERVER_MANAGED_BINDING_MODULE` for Production;
- issue Production approvals or execution tickets;
- deploy or restart Hostinger;
- enable `production_live`;
- authorize any Production mutation.

The next `resilient` phase must exercise replay prevention, concurrent reservation races, fence takeover, restart durability and ambiguous-outcome behavior against a disposable non-Production control store. Only after that should the remaining Production authority adapters and fresh activation evidence be composed.

## Safety

No Production database connection, SQL, grant, migration Apply, deployment, restart, provider mutation, secret provisioning, Recovery activation, or execution-ticket issuance is performed by this source phase.

Production Recovery remains blocked until the remaining #7999 acceptance criteria are independently implemented, certified, deployed, read back, and explicitly authorized.
