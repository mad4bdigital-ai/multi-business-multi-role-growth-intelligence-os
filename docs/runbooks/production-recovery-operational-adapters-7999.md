# Production Recovery operational authority adapters — #7999

This phase extends the merged Production Recovery authority foundation with a complete **non-live** adapter graph.

It adds deployment-owned wrappers for the six authorities that remained deferred after the MVP foundation:

- capability mutation executor;
- Hostinger host-local mutation handoff;
- independent role-aware readback verifier;
- immutable partial-mutation receipt store;
- durable inspection proof resolver;
- Governance Migration Ledger finalizer.

The wrappers accept only server-produced Recovery execution bindings. Caller-selected repository, workflow, ref, host, filesystem path, shell/SSH, credential, password, private-key, or token fields fail closed.

The operational composition is constructed through the existing canonical server-managed authority binding and `createProductionRecoveryComposition({ mode: "injected_non_live" })`. It must be fully configured while remaining:

- `live_activation=false`;
- `production_live_enabled=false`;
- `activation_eligible=false`;
- disconnected from deployment configuration;
- disconnected from Production runtime during source tests.

Construction invokes none of the consequential authorities. Tests use injected in-memory functions only and prove that the adapter graph can be composed without provider access, database access, workflow dispatch, deployment, migration, grant, or Production mutation.

## Still blocked

This phase does not configure `RECOVERY_SERVER_MANAGED_BINDING_MODULE` and does not provide a Production live authorization envelope.

The next canary phase still requires fresh signed non-Production certification of the deployment-owned implementation, exact deployment attestation, durable Recovery Control Store provisioning, independent readback certification, and the canonical activation-readiness evidence.

A later Production phase still requires separate explicit Production activation authorization. Source merge, #6813 reconstruction authorization, or a generic continue instruction cannot satisfy that boundary.
