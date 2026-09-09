# Production Recovery control-store boundary (#7999)

This source phase establishes only the configuration boundary for an independent Production Recovery control store.

## Authority boundary

The Recovery control store uses a dedicated `RECOVERY_CONTROL_DB_*` identity. Its logical database and database principal must remain distinct from every canonical target database role registered in `runtime-bootstrap-contract.json`.

A shared physical MySQL host is allowed only when the logical database and principal remain independent. Database-name or principal reuse fails closed before a connection is created.

The control store is not the runtime, governance, or runtime-persistence database and must never silently inherit their database name, user, or password.

## Current scope

This phase provides:

- explicit configuration resolution and bounded pooling;
- canonical role discovery from the runtime bootstrap contract;
- no-secret fail-closed collision diagnostics;
- a synthetic contract check that performs no database connection.

This phase does **not** yet provide the durable Recovery Store schema, fencing/lock implementation, approval or execution-ticket persistence, migration ledger adapter, Production deployment configuration, or live activation.

## Safety

No Production database connection, SQL, grant, migration, deployment, restart, provider mutation, secret provisioning, Recovery activation, or execution ticket issuance is performed by this source phase.

Production Recovery remains blocked until the remaining #7999 acceptance criteria are independently implemented, certified, deployed, read back, and explicitly authorized.
